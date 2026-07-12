import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { Harnessfile, StepDef } from "../../ir/types.js";
import { runtimeProtocol } from "../../agent-runtimes/registry.js";
import { splitFrontmatter } from "../../parser/frontmatter.js";
import { isOwned, planOwnedFields } from "../ownership.js";
import type { SyncAdapter, SyncContext, SyncResult } from "../types.js";

// multica/v1 — pushes the canonical .agents/ definitions to a Multica workspace by
// shelling out to the `multica` CLI (generalizes AltaVox's multica-push.py).
//
// Order: skills → agents → squads → autopilots, so member/assignee references resolve.
// Ownership (D42): owned fields (targets.multica.owns) are seeded at bootstrap from the
// portable defaults and NEVER touched on update. Skills are synced iff assigned to some
// agent; remote skills (and stale skill files) absent from that union are deleted ONLY
// with --prune — without it they are reported as skipped deletions. Webhook triggers
// carry server-generated secrets and are never reconciled — only schedule triggers are.
// Mutating (--apply) requires an explicit workspace binding (MULTICA_WORKSPACE_ID env
// or targets.<name>.x-workspace) so the ambient CLI login's workspace is never touched.

export interface MulticaRunner {
  /** True when the multica CLI is reachable. */
  available(): Promise<boolean>;
  /**
   * Run a multica command and return its stdout. Throws on non-zero exit.
   * `extraEnv` is exported to the child process (e.g. MULTICA_WORKSPACE_ID).
   */
  run(args: string[], extraEnv?: Record<string, string>): Promise<string>;
}

export class CliMulticaRunner implements MulticaRunner {
  async available(): Promise<boolean> {
    const res = spawnSync("multica", ["--version"], { encoding: "utf-8" });
    return !res.error;
  }

  async run(
    args: string[],
    extraEnv?: Record<string, string>,
  ): Promise<string> {
    const res = spawnSync("multica", args, {
      encoding: "utf-8",
      maxBuffer: 32 * 1024 * 1024,
      env: extraEnv ? { ...process.env, ...extraEnv } : process.env,
    });
    if (res.error) throw res.error;
    if (res.status !== 0) {
      throw new Error(
        `multica ${args.slice(0, 3).join(" ")} failed (exit ${res.status}): ${res.stderr}`,
      );
    }
    return res.stdout;
  }
}

const DEFAULT_RUNTIME_PROVIDER = "claude";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** The bootstrap model for an agent: opaque portable default, then env, then runtime default. */
export function bootstrapModel(
  portableModel: string | undefined,
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  if (portableModel) {
    return portableModel;
  }
  return env["MULTICA_DEFAULT_MODEL"];
}

export class MulticaAdapter implements SyncAdapter {
  provider = "multica/v1";

  constructor(
    private runner: MulticaRunner = new CliMulticaRunner(),
    private env: Record<string, string | undefined> = process.env,
  ) {}

  async sync(ctx: SyncContext): Promise<SyncResult> {
    const session = new MulticaSyncSession(ctx, this.runner, this.env);
    return session.sync();
  }
}

class MulticaSyncSession {
  private result: SyncResult = {
    actions: [],
    warnings: [],
    notes: [],
    skippedDeletions: 0,
  };
  private remoteAvailable = false;
  private workspace: string | undefined;

  constructor(
    private ctx: SyncContext,
    private runner: MulticaRunner,
    private env: Record<string, string | undefined>,
  ) {
    const xWorkspace = ctx.target.extra?.["x-workspace"];
    this.workspace =
      this.env["MULTICA_WORKSPACE_ID"] ??
      (typeof xWorkspace === "string" ? xWorkspace : undefined);
  }

  async sync(): Promise<SyncResult> {
    this.remoteAvailable = await this.runner.available();
    if (!this.remoteAvailable) {
      if (this.ctx.apply) {
        throw new Error(
          "multica CLI not found — cannot apply. Install and authenticate the multica CLI, then re-run.",
        );
      }
      this.result.notes.push(
        "multica CLI not found — remote state unknown; plan assumes an empty workspace.",
      );
    }

    // Refuse to mutate whatever workspace the ambient login happens to point at (D42
    // in spirit: the environment binding must be explicit before we write to it).
    if (!this.workspace) {
      if (this.ctx.apply) {
        throw new Error(
          `multica target requires an explicit workspace: set MULTICA_WORKSPACE_ID or targets.${this.ctx.targetName}.x-workspace — refusing to mutate the ambient login's workspace`,
        );
      }
      if (this.remoteAvailable) {
        this.result.notes.push(
          `no explicit workspace binding — this plan reads the ambient multica login's workspace; --apply will refuse until MULTICA_WORKSPACE_ID or targets.${this.ctx.targetName}.x-workspace is set.`,
        );
      }
    }

    await this.pushSkills();
    await this.pushAgents();
    await this.pushSquads();
    await this.pushAutopilots();

    return this.result;
  }

  // ---- Plumbing ----

  private get workspaceEnv(): Record<string, string> | undefined {
    return this.workspace
      ? { MULTICA_WORKSPACE_ID: this.workspace }
      : undefined;
  }

  private async mcRead(args: string[]): Promise<unknown> {
    if (!this.remoteAvailable) return [];
    const stdout = await this.runner.run(args, this.workspaceEnv);
    try {
      return JSON.parse(stdout);
    } catch {
      return [];
    }
  }

  private async mcWrite(
    args: string[],
    summary: string,
    kind: "create" | "update" | "delete" | "run" = "run",
  ): Promise<Record<string, unknown> | null> {
    const shown = args.map((a) => (a.length > 80 ? `<${a.length} chars>` : a));
    this.result.actions.push({
      kind,
      description: `multica ${shown.join(" ")} — ${summary}`,
    });
    if (!this.ctx.apply) return null;
    const stdout = await this.runner.run(args, this.workspaceEnv);
    try {
      return JSON.parse(stdout) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  private warn(message: string): void {
    this.result.warnings.push(message);
  }

  /** Records a deletion that is omitted because --prune was not passed. */
  private skipDeletion(what: string): void {
    this.result.actions.push({
      kind: "skip",
      description: `would delete ${what} (pass --prune to include)`,
    });
    this.result.skippedDeletions = (this.result.skippedDeletions ?? 0) + 1;
  }

  private plan(message: string): void {
    this.result.actions.push({ kind: "run", description: message });
  }

  private get ir(): Harnessfile {
    return this.ctx.ir;
  }

  private displayName(entity: {
    name?: string;
    passthrough?: Record<string, unknown>;
  }): string {
    const multica = entity.passthrough?.["multica"] as
      | Record<string, unknown>
      | undefined;
    const display = multica?.["display_name"];
    return typeof display === "string" ? display : (entity.name ?? "");
  }

  // ---- Skills ----

  private agentSkillUnion(): Set<string> {
    const assigned = new Set<string>();
    for (const agent of Object.values(this.ir.agents)) {
      for (const skill of agent.skills ?? []) assigned.add(skill);
    }
    return assigned;
  }

  private async pushSkills(): Promise<void> {
    const skillsDir = join(this.ctx.agentsDir, "skills");
    const assigned = this.agentSkillUnion();
    const remote = asArray(
      await this.mcRead(["skill", "list", "--output", "json"]),
    );
    const existing = new Map(remote.map((s) => [str(s, "name"), s]));

    for (const name of this.ir.skills ?? []) {
      if (!assigned.has(name)) {
        this.result.actions.push({
          kind: "skip",
          description: `skill ${name} (not assigned to any agent)`,
        });
        continue;
      }
      const dir = join(skillsDir, name);
      const skillMd = join(dir, "SKILL.md");
      if (!existsSync(skillMd)) {
        this.warn(`skill ${name}: no SKILL.md, skipping`);
        continue;
      }
      const content = readFileSync(skillMd, "utf-8");
      const { frontmatter } = splitFrontmatter(content);
      const description =
        typeof frontmatter["description"] === "string"
          ? (frontmatter["description"] as string)
          : "";

      let skillId: string | null = null;
      const remoteSkill = existing.get(name);
      if (remoteSkill) {
        skillId = str(remoteSkill, "id");
        await this.mcWrite(
          ["skill", "update", skillId, "--name", name, "--content", content, "--description", description],
          `update skill ${name}`,
          "update",
        );
      } else {
        const created = await this.mcWrite(
          ["skill", "create", "--name", name, "--content", content, "--description", description, "--output", "json"],
          `create skill ${name}`,
          "create",
        );
        skillId = created ? str(created, "id") : null;
      }

      // Supporting files travel with the skill directory.
      const supportingFiles = listFilesRecursive(dir).filter(
        (f) => f !== skillMd,
      );
      const localPaths = new Set<string>();
      for (const file of supportingFiles) {
        const rel = relative(dir, file).split("\\").join("/");
        localPaths.add(rel);
        let fileContent: string;
        try {
          fileContent = readFileSync(file, "utf-8");
          if (fileContent.includes("�")) throw new Error("binary");
        } catch {
          this.warn(
            `skill ${name}/${rel}: binary file not supported by Multica skill files, skipping`,
          );
          continue;
        }
        if (skillId) {
          await this.mcWrite(
            ["skill", "files", "upsert", skillId, "--path", rel, "--content", fileContent],
            `upsert ${name}/${rel}`,
            "update",
          );
        } else {
          this.plan(`(after create) upsert ${name}/${rel}`);
        }
      }

      // Delete remote files no longer present locally — git owns contents.
      // Destructive: only planned with --prune.
      if (skillId) {
        const remoteFiles = asArray(
          await this.mcRead(["skill", "files", "list", skillId, "--output", "json"]),
        );
        for (const rf of remoteFiles) {
          const path = str(rf, "path");
          if (!localPaths.has(path)) {
            if (!this.ctx.prune) {
              this.skipDeletion(`stale skill file ${name}/${path}`);
              continue;
            }
            await this.mcWrite(
              ["skill", "files", "delete", skillId, str(rf, "id")],
              `delete stale ${name}/${path}`,
              "delete",
            );
          }
        }
      }
    }

    // Delete remote skills absent from the union of agent skills.
    // Destructive: only planned with --prune.
    for (const [name, remoteSkill] of existing) {
      if (!assigned.has(name)) {
        if (!this.ctx.prune) {
          this.skipDeletion(`remote skill ${name}`);
          continue;
        }
        await this.mcWrite(
          ["skill", "delete", str(remoteSkill, "id")],
          `delete remote skill ${name} (not assigned to any agent)`,
          "delete",
        );
      }
    }
  }

  // ---- Agents ----

  private runtimeFamily(profileName: string | undefined): string | undefined {
    if (!profileName) return undefined;
    const profile = this.ir.runtimes?.[profileName];
    const protocol = runtimeProtocol(profile);
    if (protocol === "claude-code/v1") return "claude";
    if (protocol === "codex-app-server/v1") return "codex";
    return protocol ? protocol.replace(/\/v\d+$/, "") : undefined;
  }

  private async pickBootstrapRuntime(
    profileName?: string,
  ): Promise<Record<string, unknown> | null> {
    const raw = await this.mcRead(["runtime", "list", "--output", "json"]);
    const runtimes = Array.isArray(raw)
      ? (raw as Array<Record<string, unknown>>)
      : asArray((raw as Record<string, unknown>)?.["runtimes"]);
    const online = runtimes.filter((r) => r["status"] === "online");
    const requestedProvider = this.runtimeFamily(profileName);
    const boundRuntimeID = profileName
      ? this.env[`MULTICA_RUNTIME_${profileName.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_ID`]
      : undefined;
    if (boundRuntimeID) {
      const bound = online.find((runtime) => str(runtime, "id") === boundRuntimeID);
      if (!bound) return null;
      if (requestedProvider && str(bound, "provider") !== requestedProvider) return null;
      return bound;
    }
    const preferredProvider =
      requestedProvider ??
      this.env["MULTICA_DEFAULT_RUNTIME_PROVIDER"] ??
      DEFAULT_RUNTIME_PROVIDER;
    const preferred = online.filter((r) => r["provider"] === preferredProvider);
    return preferred[0] ?? (requestedProvider ? null : online[0] ?? null);
  }

  private async pushAgents(): Promise<void> {
    const owns = this.ctx.target.owns;
    const remoteAgents = asArray(
      await this.mcRead(["agent", "list", "--output", "json"]),
    );
    const byName = new Map(remoteAgents.map((a) => [str(a, "name"), a]));
    const remoteSkills = asArray(
      await this.mcRead(["skill", "list", "--output", "json"]),
    );
    const skillIdByName = new Map(
      remoteSkills.map((s) => [str(s, "name"), str(s, "id")]),
    );
    const repoSkills = new Set(this.ir.skills ?? []);

    for (const [slug, agent] of Object.entries(this.ir.agents)) {
      const display = this.displayName(agent) || slug;
      const description = agent.description ?? "";
      const skillNames = agent.skills ?? [];

      // Ownership (D42): git-owned fields always sync; owned fields only at bootstrap.
      const { updateFields } = planOwnedFields(
        {
          model: bootstrapModel(agent.model, this.env),
          runtime: agent.runtime,
          "thinking-level": agent.thinkingLevel,
        },
        owns,
      );

      let agentId: string | null = null;
      const remote = byName.get(display);
      if (remote) {
        agentId = str(remote, "id");
        const args = [
          "agent", "update", agentId,
          "--instructions", agent.instructions,
          "--description", description,
        ];
        let summary = `update agent ${display} (instructions + description`;
        if (updateFields.model) {
          args.push("--model", updateFields.model);
          summary += " + model";
        }
        if (updateFields["thinking-level"]) {
          args.push("--thinking-level", updateFields["thinking-level"]);
          summary += " + thinking-level";
        }
        if (updateFields.runtime) {
          const runtime = await this.pickBootstrapRuntime(updateFields.runtime);
          if (runtime) {
            args.push("--runtime-id", str(runtime, "id"));
            summary += ` + runtime '${str(runtime, "name")}'`;
          } else {
            this.warn(
              `agent '${display}' requests runtime profile '${updateFields.runtime}' but no matching ONLINE runtime exists — placement unchanged.`,
            );
          }
        }
        summary += isOwned("model", owns) || isOwned("runtime", owns)
          ? "; target-owned operational fields untouched)"
          : ")";
        await this.mcWrite(args, summary, "update");
      } else {
        const runtime = await this.pickBootstrapRuntime(agent.runtime);
        if (this.remoteAvailable && !runtime) {
          this.warn(
            `agent '${display}' not on Multica and no ONLINE runtime to host it — skipping. Bring a runtime online (or create the agent on Multica), then re-push.`,
          );
          continue;
        }
        const model = bootstrapModel(agent.model, this.env);
        const runtimeId = runtime ? str(runtime, "id") : "<runtime>";
        const runtimeName = runtime ? str(runtime, "name") : "(unknown — dry run)";
        const createArgs = [
            "agent", "create",
            "--name", display,
            "--runtime-id", runtimeId,
            "--description", description,
            "--instructions", agent.instructions,
            "--output", "json",
          ];
        if (model) createArgs.push("--model", model);
        if (agent.thinkingLevel) {
          createArgs.push("--thinking-level", agent.thinkingLevel);
        }
        const created = await this.mcWrite(
          createArgs,
          `create agent ${display} on runtime '${runtimeName}' (${model ? `bootstrap model ${model}` : "runtime default model"}; owned fields are Multica's after this)`,
          "create",
        );
        agentId = created ? str(created, "id") : null;
        if (agentId === null) {
          this.plan(
            `(after create) set ${skillNames.length} skill(s) on ${display}`,
          );
          continue;
        }
      }

      // Skill assignment — always git-owned.
      const ids: string[] = [];
      const pending: string[] = [];
      const missing: string[] = [];
      for (const n of skillNames) {
        const id = skillIdByName.get(n);
        if (id) ids.push(id);
        else if (repoSkills.has(n)) pending.push(n);
        else missing.push(n);
      }
      if (missing.length > 0) {
        this.warn(
          `agent '${display}': skills not in repo or workspace: ${missing.join(", ")}`,
        );
      }
      if (!this.ctx.apply && pending.length > 0) {
        this.plan(
          `assign ${ids.length + pending.length} skill(s) to ${display} (incl. ${pending.join(", ")}, created earlier this run)`,
        );
      } else {
        await this.mcWrite(
          ["agent", "skills", "set", agentId, "--skill-ids", ids.join(",")],
          `set ${ids.length} skill(s) on ${display}`,
          "update",
        );
      }
    }
  }

  // ---- Squads ----

  private async pushSquads(): Promise<void> {
    if (!this.ir.squads) return;
    const remoteSquads = asArray(
      await this.mcRead(["squad", "list", "--output", "json"]),
    );
    const byName = new Map(remoteSquads.map((s) => [str(s, "name"), s]));
    const remoteAgents = asArray(
      await this.mcRead(["agent", "list", "--output", "json"]),
    );
    const agentIdBySlug = new Map(
      remoteAgents.map((a) => [slugify(str(a, "name")), str(a, "id")]),
    );

    for (const [slug, squad] of Object.entries(this.ir.squads)) {
      const display = this.displayName(squad) || slug;
      const description = squad.description ?? "";
      const leaderId = agentIdBySlug.get(squad.leader) ?? squad.leader;

      let squadId: string | null = null;
      const remote = byName.get(display);
      if (remote) {
        squadId = str(remote, "id");
        await this.mcWrite(
          [
            "squad", "update", squadId,
            "--name", display,
            "--description", description,
            "--instructions", squad.instructions,
            "--leader", leaderId,
          ],
          `update squad ${display}`,
          "update",
        );
      } else {
        const created = await this.mcWrite(
          [
            "squad", "create",
            "--name", display,
            "--leader", leaderId,
            "--description", description,
            "--output", "json",
          ],
          `create squad ${display}`,
          "create",
        );
        squadId = created ? str(created, "id") : null;
        if (squadId && squad.instructions) {
          await this.mcWrite(
            ["squad", "update", squadId, "--instructions", squad.instructions],
            `set instructions on ${display}`,
            "update",
          );
        }
      }

      if (!squadId) {
        this.plan(
          `(after create) reconcile ${squad.members.length} agent member(s) of ${display}`,
        );
        continue;
      }

      // Reconcile agent members only — humans are never added or removed.
      const currentMembers = asArray(
        await this.mcRead(["squad", "member", "list", squadId, "--output", "json"]),
      );
      const currentById = new Map(
        currentMembers.map((m) => [str(m, "member_id"), m]),
      );
      const keep = new Set<string>([leaderId]);
      for (const member of squad.members) {
        const agentId = agentIdBySlug.get(member.agent);
        const role = member.role ?? "member";
        if (!agentId) {
          if (this.remoteAvailable) {
            this.warn(
              `squad ${display}: agent '${member.agent}' not found, skipping member`,
            );
          } else {
            this.plan(
              `(after create) add ${member.agent} to ${display} (role: ${role})`,
            );
          }
          continue;
        }
        keep.add(agentId);
        const current = currentById.get(agentId);
        if (!current) {
          await this.mcWrite(
            ["squad", "member", "add", squadId, "--member-id", agentId, "--type", "agent", "--role", role],
            `add ${member.agent} to ${display}`,
            "update",
          );
        } else if ((str(current, "role") || "") !== role) {
          await this.mcWrite(
            ["squad", "member", "set-role", squadId, "--member-id", agentId, "--member-type", "agent", "--role", role],
            `set role of ${member.agent} in ${display}`,
            "update",
          );
        }
      }
      for (const [memberId, current] of currentById) {
        const type = str(current, "member_type") || str(current, "type");
        if (type === "agent" && !keep.has(memberId)) {
          await this.mcWrite(
            ["squad", "member", "remove", squadId, "--member-id", memberId, "--type", "agent"],
            `remove agent member from ${display}`,
            "delete",
          );
        }
      }
    }
  }

  // ---- Autopilots (scheduled triggers with a prompt, D41) ----

  private scheduledTriggers(): Array<[string, StepDef]> {
    if (!this.ir.steps) return [];
    return Object.entries(this.ir.steps).filter(
      ([, step]) =>
        step.type === "trigger" && !!step.schedule && step.prompt != null,
    );
  }

  private resolveAssignee(step: StepDef): string | undefined {
    const next = Array.isArray(step.next) ? step.next[0] : step.next;
    if (!next) return undefined;
    const target = this.ir.steps?.[next];
    if (!target) return undefined;
    if (target.agent) return target.agent;
    if (target.squad) return this.ir.squads?.[target.squad]?.leader;
    return undefined;
  }

  private async pushAutopilots(): Promise<void> {
    const triggers = this.scheduledTriggers();
    if (triggers.length === 0) return;

    const rawList = await this.mcRead(["autopilot", "list", "--output", "json"]);
    const autopilots = Array.isArray(rawList)
      ? (rawList as Array<Record<string, unknown>>)
      : asArray((rawList as Record<string, unknown>)?.["autopilots"]);
    const byTitle = new Map(autopilots.map((a) => [str(a, "title"), a]));
    const remoteAgents = asArray(
      await this.mcRead(["agent", "list", "--output", "json"]),
    );
    const agentIdBySlug = new Map(
      remoteAgents.map((a) => [slugify(str(a, "name")), str(a, "id")]),
    );

    for (const [name, step] of triggers) {
      const title = name;
      const description = (step.prompt ?? "").trim();
      const assigneeSlug = this.resolveAssignee(step);
      if (!assigneeSlug) {
        this.warn(
          `autopilot '${title}': cannot resolve an assignee agent from next step — skipping.`,
        );
        continue;
      }
      const agentId = agentIdBySlug.get(assigneeSlug);
      if (!agentId) {
        if (this.ctx.apply) {
          this.warn(
            `autopilot '${title}': assignee agent '${assigneeSlug}' not resolvable — it is bootstrapped by the agent push on --apply. Skipping autopilot.`,
          );
          continue;
        }
        if (!(assigneeSlug in this.ir.agents)) {
          this.warn(
            `autopilot '${title}': assignee agent '${assigneeSlug}' is not defined in agents/. Skipping autopilot.`,
          );
          continue;
        }
        // Dry run: the agent is created earlier in the same push — plan with a placeholder.
      }

      const common = [
        "--agent", agentId ?? assigneeSlug,
        "--description", description,
        "--mode", "run_only",
        "--priority", "none",
      ];

      let autopilotId: string | null = null;
      const remote = byTitle.get(title);
      if (remote) {
        autopilotId = str(remote, "id");
        await this.mcWrite(
          ["autopilot", "update", autopilotId, "--title", title, ...common, "--status", "active"],
          `update autopilot ${title}`,
          "update",
        );
      } else {
        const created = await this.mcWrite(
          ["autopilot", "create", "--title", title, ...common, "--output", "json"],
          `create autopilot ${title}`,
          "create",
        );
        autopilotId = created ? str(created, "id") : null;
      }

      const cron = step.schedule!;
      const timezone = step.timezone ?? "UTC";

      if (!autopilotId) {
        this.plan(
          `(after create) add schedule trigger to ${title} (${cron} ${timezone})`,
        );
        continue;
      }

      // Reconcile SCHEDULE triggers only — webhook triggers carry secret URLs
      // and stay Multica-managed.
      const detail = (await this.mcRead([
        "autopilot", "get", autopilotId, "--output", "json",
      ])) as Record<string, unknown>;
      const remoteTriggers = asArray(detail?.["triggers"]).filter(
        (t) => t["kind"] === "schedule",
      );
      const have = new Map(
        remoteTriggers.map((t) => [
          `${str(t, "cron_expression")}|${str(t, "timezone")}`,
          t,
        ]),
      );
      const wantKey = `${cron}|${timezone}`;
      const current = have.get(wantKey);
      if (current) {
        if (current["enabled"] === false) {
          await this.mcWrite(
            ["autopilot", "trigger-update", autopilotId, str(current, "id"), "--cron", cron, "--timezone", timezone, "--enabled"],
            `update schedule trigger on ${title}`,
            "update",
          );
        }
      } else {
        await this.mcWrite(
          ["autopilot", "trigger-add", autopilotId, "--kind", "schedule", "--cron", cron, "--timezone", timezone],
          `add schedule trigger to ${title}`,
          "create",
        );
      }
      for (const [key, t] of have) {
        if (key !== wantKey) {
          await this.mcWrite(
            ["autopilot", "trigger-delete", autopilotId, str(t, "id")],
            `remove stale schedule trigger from ${title}`,
            "delete",
          );
        }
      }
    }
  }
}

// ---- Small helpers ----

function asArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? (value as Array<Record<string, unknown>>) : [];
}

function str(obj: Record<string, unknown> | undefined, key: string): string {
  const value = obj?.[key];
  return typeof value === "string" ? value : String(value ?? "");
}

function listFilesRecursive(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listFilesRecursive(full));
    } else {
      out.push(full);
    }
  }
  return out;
}
