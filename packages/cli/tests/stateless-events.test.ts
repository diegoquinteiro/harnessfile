import { createHmac } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { processEvent } from "../src/commands/event.js";
import { createServiceRegistry } from "../src/services/builtins.js";
import { FilesystemTaskMemory } from "../src/services/task-memory/filesystem.js";
import { handoffNoteMarker } from "../src/services/task-memory/handoff-note.js";
import type { Harnessfile } from "../src/ir/types.js";
import type { DetachedTask } from "../src/services/execution/detached.js";
import type { TaskHandoff } from "../src/services/contracts.js";
const paths: string[] = [];
afterEach(async () => { await Promise.all(paths.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
describe.each(["gitlab", "github"] as const)("stateless %s event composition", provider => {
  it("authenticates issue and bot handoff across fresh hosts without waiting for agents", async () => {
    const path = await mkdtemp(join(tmpdir(), "hf-event-")); paths.push(path);
    const registry = createServiceRegistry(); const submissions: DetachedTask[] = [];
    registry.register("execution", "test/v1", () => ({
      async start() { throw new Error("Must not await a live runtime session"); },
      async execute() { throw new Error("Must not await a live runtime result"); },
      async submit(task: DetachedTask) { submissions.push(task); return { id: task.id, provider: "test/v1", state: "accepted" as const }; },
    }));
    const ir: Harnessfile = { version: "0.2", name: "events", agents: { engineer: { instructions: "Work", description: "Engineer", runtime: "coding" } }, runtimes: { coding: { protocol: "claude-code/v1" } },
      orchestration: { provider: "langgraph-stateless/v1" }, execution: { provider: "test/v1" },
      projectManagement: { provider: { type: `${provider}/v1`, ...(provider === "gitlab" ? { project: "org/repo" } : { repository: "org/repo" }), webhook: { secret: "WEBHOOK_SECRET", taskLabel: "ready", agent: "engineer", handoffAgents: { engineer: "engineer-bot" } } } },
      taskMemory: { provider: { type: "filesystem/v1", path } },
      steps: { ready: { type: "trigger", provider: `${provider}/v1`, next: "implement" }, implement: { type: "agent", agent: "engineer" } },
    };
    const options = { registry, webhook: true, async secret() { return "test-secret"; } };
    const envelope = (payload: object, event: string, id: string) => {
      const body = JSON.stringify(payload);
      const headers = provider === "gitlab" ? { "x-gitlab-token": "test-secret", "x-gitlab-event": event, "x-gitlab-event-uuid": id }
        : { "x-hub-signature-256": `sha256=${createHmac("sha256", "test-secret").update(body).digest("hex")}`, "x-github-event": event, "x-github-delivery": id };
      return { body, headers };
    };
    const issue = provider === "gitlab" ? { object_kind: "issue", project: { id: 1, path_with_namespace: "org/repo" }, user: { username: "human" }, labels: [{ title: "ready" }], object_attributes: { iid: 42, action: "open", state: "opened", title: "Implement feature", description: "Details", url: "https://gitlab.com/org/repo/-/issues/42" } }
      : { action: "opened", repository: { full_name: "org/repo" }, sender: { login: "human", type: "User" }, issue: { number: 42, state: "open", title: "Implement feature", body: "Details", html_url: "https://github.com/org/repo/issues/42", labels: [{ name: "ready" }] } };
    expect((await processEvent(ir, envelope(issue, provider === "gitlab" ? "Issue Hook" : "issues", "opened-1"), options))[0].status).toBe("suspended");
    expect(submissions).toHaveLength(1);
    const dispatch = submissions[0];
    const memory = new FilesystemTaskMemory({ type: "filesystem/v1", path }, { workspaceRoot: path });
    const handoff: TaskHandoff = { id: dispatch.id, dispatchId: dispatch.id, runId: dispatch.context.runId, step: "implement", agent: "engineer", status: "completed", summary: "Delivered", createdAt: new Date().toISOString() };
    await memory.publishHandoff(dispatch.delivery.task, handoff);
    const note = handoffNoteMarker(dispatch.delivery.task, handoff);
    const payload = provider === "gitlab" ? { object_kind: "note", project: { id: 1, path_with_namespace: "org/repo" }, user: { username: "engineer-bot" }, issue: { iid: 42, url: "https://gitlab.com/org/repo/-/issues/42" }, object_attributes: { noteable_type: "Issue", note, action: "create" } }
      : { action: "created", repository: { full_name: "org/repo" }, sender: { login: "engineer-bot", type: "Bot" }, issue: { number: 42, html_url: "https://github.com/org/repo/issues/42" }, comment: { body: note, user: { login: "engineer-bot" } } };
    const completed = envelope(payload, provider === "gitlab" ? "Note Hook" : "issue_comment", "handoff-1");
    expect((await processEvent(ir, completed, options))[0].status).toBe("completed");
    expect((await processEvent(ir, completed, options))[0].status).toBe("completed");
    expect(submissions).toHaveLength(1);
    await expect(processEvent(ir, { ...completed, headers: {} }, options)).rejects.toThrow();
  });
});
