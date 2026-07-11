import type {
  Harnessfile,
  AgentDef,
  SquadDef,
  SquadMember,
  TargetDef,
  StepDef,
  StepType,
  EvalDef,
  RetryDef,
  HooksDef,
  HookEntry,
  ObservabilityDef,
  MemoryDef,
  SecurityDef,
  ResilienceDef,
  ToolRef,
  ProviderRef,
} from "./types.js";

// Normalizes a raw parsed harness (assembled from the .agents/ directory) into a typed IR.
// Handles kebab-case → camelCase, default inference, shorthand expansion, and the
// `triggers:` sugar (merged into steps as type: trigger).

const AGENT_KNOWN_KEYS = new Set([
  "name",
  "description",
  "model",
  "instructions",
  "tools",
  "skills",
]);

const SQUAD_KNOWN_KEYS = new Set([
  "name",
  "description",
  "leader",
  "members",
  "instructions",
]);

export function normalize(raw: Record<string, unknown>): Harnessfile {
  const version = expectString(raw, "harnessfile", "harnessfile version");
  const name = optString(raw, "name");

  const rawAgents = optObject(raw, "agents") ?? {};
  const agents: Record<string, AgentDef> = {};
  for (const [key, value] of Object.entries(rawAgents)) {
    agents[key] = normalizeAgent(value, key);
  }

  let squads: Record<string, SquadDef> | undefined;
  const rawSquads = optObject(raw, "squads");
  if (rawSquads && Object.keys(rawSquads).length > 0) {
    squads = {};
    for (const [key, value] of Object.entries(rawSquads)) {
      squads[key] = normalizeSquad(value, key);
    }
  }

  const skills = Array.isArray(raw["skills"])
    ? (raw["skills"] as string[])
    : undefined;

  // Steps + triggers sugar
  let steps: Record<string, StepDef> | undefined;
  const rawSteps = optObject(raw, "steps");
  const rawTriggers = optObject(raw, "triggers");
  if (rawSteps || rawTriggers) {
    steps = {};
    if (rawTriggers) {
      for (const [key, value] of Object.entries(rawTriggers)) {
        const step = normalizeStep(value, key);
        step.type = "trigger";
        steps[key] = step;
      }
    }
    if (rawSteps) {
      for (const [key, value] of Object.entries(rawSteps)) {
        if (steps[key]) {
          throw new Error(
            `Step '${key}' is defined both in triggers and steps`,
          );
        }
        steps[key] = normalizeStep(value, key);
      }
    }
  }

  let targets: Record<string, TargetDef> | undefined;
  const rawTargets = optObject(raw, "targets");
  if (rawTargets) {
    targets = {};
    for (const [key, value] of Object.entries(rawTargets)) {
      targets[key] = normalizeTarget(value, key);
    }
  }

  return {
    version,
    name,
    agents,
    squads,
    skills,
    steps,
    targets,
    hooks: raw["hooks"] ? normalizeHooks(raw["hooks"]) : undefined,
    observability: raw["observability"]
      ? normalizeObservability(raw["observability"] as Record<string, unknown>)
      : undefined,
    memory: raw["memory"]
      ? normalizeMemory(raw["memory"] as Record<string, unknown>)
      : undefined,
    security: raw["security"]
      ? normalizeSecurity(raw["security"] as Record<string, unknown>)
      : undefined,
    resilience: raw["resilience"]
      ? normalizeResilience(raw["resilience"] as Record<string, unknown>)
      : undefined,
  };
}

// ---- Agents ----

function normalizeAgent(raw: unknown, name: string): AgentDef {
  const obj = asObject(raw, `agent '${name}'`);
  const agent: AgentDef = {
    name: optString(obj, "name") ?? name,
    description: optString(obj, "description"),
    model: optString(obj, "model"),
    instructions: optString(obj, "instructions") ?? "",
    tools: obj["tools"] ? normalizeTools(obj["tools"] as unknown[]) : undefined,
    skills: obj["skills"] ? (obj["skills"] as string[]) : undefined,
  };
  const passthrough = collectPassthrough(obj, AGENT_KNOWN_KEYS);
  if (passthrough) agent.passthrough = passthrough;
  return agent;
}

function normalizeTools(raw: unknown[]): ToolRef[] {
  return raw.map((t) => {
    if (typeof t === "string") return t;
    const obj = t as Record<string, unknown>;
    return { mcp: obj["mcp"] as string };
  });
}

// ---- Squads ----

function normalizeSquad(raw: unknown, name: string): SquadDef {
  const obj = asObject(raw, `squad '${name}'`);
  const members: SquadMember[] = Array.isArray(obj["members"])
    ? (obj["members"] as unknown[]).map((m) => {
        const mo = asObject(m, `squad '${name}' member`);
        return {
          agent: mo["agent"] as string,
          role: optString(mo, "role"),
        };
      })
    : [];
  const squad: SquadDef = {
    name: optString(obj, "name") ?? name,
    description: optString(obj, "description"),
    leader: (optString(obj, "leader") ?? "") as string,
    members,
    instructions: optString(obj, "instructions") ?? "",
  };
  const passthrough = collectPassthrough(obj, SQUAD_KNOWN_KEYS);
  if (passthrough) squad.passthrough = passthrough;
  return squad;
}

// ---- Targets ----

function normalizeTarget(raw: unknown, name: string): TargetDef {
  const obj = asObject(raw, `target '${name}'`);
  const target: TargetDef = {
    provider: obj["provider"] as string | ProviderRef | undefined,
    owns: Array.isArray(obj["owns"]) ? (obj["owns"] as string[]) : undefined,
  };
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key.startsWith("x-")) extra[key] = value;
  }
  if (Object.keys(extra).length > 0) target.extra = extra;
  return target;
}

// ---- Steps ----

function normalizeStep(raw: unknown, name: string): StepDef {
  const obj = asObject(raw, `step '${name}'`);
  const type = inferStepType(obj);

  const step: StepDef = { type };

  if (obj["agent"] != null) step.agent = obj["agent"] as string;
  if (obj["squad"] != null) step.squad = obj["squad"] as string;
  if (obj["next"] != null) step.next = obj["next"] as string | string[];
  if (obj["context"] != null) step.context = obj["context"] as string;
  if (obj["output"] != null)
    step.output = obj["output"] as Record<string, string>;
  if (obj["timeout"] != null) step.timeout = obj["timeout"] as string;
  if (obj["on-error"] != null)
    step.onError = obj["on-error"] as "fail" | "skip" | "continue";
  if (obj["max-iterations"] != null)
    step.maxIterations = obj["max-iterations"] as number;

  // Retry shorthand
  if (obj["retry"] != null) step.retry = normalizeRetry(obj["retry"]);

  // Eval
  if (obj["eval"] != null)
    step.eval = (obj["eval"] as unknown[]).map(normalizeEval);

  // Trigger
  if (obj["event"] != null) step.event = obj["event"] as string;
  if (obj["filter"] != null) step.filter = obj["filter"] as string;
  if (obj["schedule"] != null) step.schedule = obj["schedule"] as string;
  if (obj["timezone"] != null) step.timezone = obj["timezone"] as string;
  if (obj["prompt"] != null) step.prompt = obj["prompt"] as string;
  if (obj["promptPath"] != null)
    step.promptPath = obj["promptPath"] as string;

  // Gate
  if (obj["approve"] != null) step.approve = obj["approve"] as "human";
  if (obj["channel"] != null) step.channel = obj["channel"] as string;
  if (obj["fallback"] != null)
    step.fallback = obj["fallback"] as "reject" | "approve" | "escalate";

  // Router
  if (obj["routes"] != null)
    step.routes = obj["routes"] as Record<string, string>;

  // Orchestrator (v0.1 legacy)
  if (obj["pool"] != null) step.pool = obj["pool"] as string[];
  if (obj["max-agents"] != null) step.maxAgents = obj["max-agents"] as number;

  // Output step
  if (obj["input"] != null)
    step.input = obj["input"] as Record<string, string>;

  // Provider
  if (obj["provider"] != null)
    step.provider = obj["provider"] as string | ProviderRef;

  // Per-step hooks
  if (obj["hooks"] != null) step.hooks = normalizeHooks(obj["hooks"]);

  return step;
}

function inferStepType(obj: Record<string, unknown>): StepType {
  if (obj["type"] != null) return obj["type"] as StepType;
  if (obj["schedule"] != null) return "trigger";
  if (obj["event"] != null) return "trigger";
  if (obj["approve"] != null) return "gate";
  if (obj["routes"] != null) return "router";
  if (obj["squad"] != null) return "squad";
  if (obj["pool"] != null) return "orchestrator";
  if (obj["input"] != null && obj["agent"] == null) return "output";
  return "agent";
}

// ---- Eval ----

function normalizeEval(raw: unknown): EvalDef {
  const obj = raw as Record<string, unknown>;
  return {
    metric: obj["metric"] as string,
    type: (obj["type"] as EvalDef["type"]) ?? "code",
    pass: (obj["pass"] as EvalDef["pass"]) ?? true,
    aggregate: (obj["aggregate"] as EvalDef["aggregate"]) ?? "all",
    prompt: obj["prompt"] as string | undefined,
    dataset: obj["dataset"] as string | undefined,
    expected: obj["expected"] as string | undefined,
  };
}

// ---- Retry ----

function normalizeRetry(raw: unknown): RetryDef {
  if (typeof raw === "number") {
    return { max: raw, backoff: "none" };
  }
  const obj = raw as Record<string, unknown>;
  return {
    max: (obj["max"] as number) ?? 0,
    backoff: (obj["backoff"] as RetryDef["backoff"]) ?? "none",
  };
}

// ---- Hooks ----

function normalizeHooks(raw: unknown): HooksDef {
  const obj = raw as Record<string, unknown>;
  const hooks: HooksDef = {};
  if (obj["on-start"] != null)
    hooks.onStart = normalizeHookEntry(obj["on-start"]);
  if (obj["before-step"] != null)
    hooks.beforeStep = normalizeHookEntry(obj["before-step"]);
  if (obj["after-step"] != null)
    hooks.afterStep = normalizeHookEntry(obj["after-step"]);
  if (obj["on-error"] != null)
    hooks.onError = normalizeHookEntry(obj["on-error"]);
  if (obj["on-gate-pending"] != null)
    hooks.onGatePending = normalizeHookEntry(obj["on-gate-pending"]);
  if (obj["on-gate-resolved"] != null)
    hooks.onGateResolved = normalizeHookEntry(obj["on-gate-resolved"]);
  if (obj["on-complete"] != null)
    hooks.onComplete = normalizeHookEntry(obj["on-complete"]);
  return hooks;
}

function normalizeHookEntry(raw: unknown): HookEntry {
  if (typeof raw === "string") return raw;
  const obj = raw as Record<string, unknown>;
  return {
    run: obj["run"] as string,
    can: obj["can"] as Array<"abort" | "modify"> | undefined,
  };
}

// ---- Observability ----

function normalizeObservability(
  obj: Record<string, unknown>,
): ObservabilityDef {
  return {
    tracing: obj["tracing"] as string | undefined,
    metrics: obj["metrics"] as string | undefined,
    sampling: obj["sampling"] as number | undefined,
    level: obj["level"] as ObservabilityDef["level"] | undefined,
  };
}

// ---- Memory ----

function normalizeMemory(obj: Record<string, unknown>): MemoryDef {
  return {
    backend: obj["backend"] as string,
    scope: obj["scope"] as MemoryDef["scope"] | undefined,
    type: obj["type"] as MemoryDef["type"] | undefined,
    ttl: obj["ttl"] as string | undefined,
  };
}

// ---- Security ----

function normalizeSecurity(obj: Record<string, unknown>): SecurityDef {
  const sec: SecurityDef = {};
  if (obj["guardrails"]) {
    const g = obj["guardrails"] as Record<string, unknown>;
    sec.guardrails = {
      input: g["input"] as string[] | undefined,
      output: g["output"] as string[] | undefined,
      provider: g["provider"] as string | undefined,
    };
  }
  if (obj["budget"]) {
    const b = obj["budget"] as Record<string, unknown>;
    sec.budget = {
      maxTokens: b["max-tokens"] as number | undefined,
      maxCost: b["max-cost"] as string | undefined,
    };
  }
  if (obj["audit"]) {
    const a = obj["audit"] as Record<string, unknown>;
    sec.audit = {
      destination: a["destination"] as string | undefined,
      level: a["level"] as "actions" | "reasoning" | "full" | undefined,
    };
  }
  return sec;
}

// ---- Resilience ----

function normalizeResilience(obj: Record<string, unknown>): ResilienceDef {
  return {
    timeout: obj["timeout"] as string | undefined,
    checkpoint: obj["checkpoint"] as boolean | undefined,
  };
}

// ---- Helpers ----

function collectPassthrough(
  obj: Record<string, unknown>,
  known: Set<string>,
): Record<string, unknown> | undefined {
  const passthrough: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (!known.has(key)) passthrough[key] = value;
  }
  return Object.keys(passthrough).length > 0 ? passthrough : undefined;
}

function asObject(
  raw: unknown,
  label: string,
): Record<string, unknown> {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`Expected object for ${label}, got ${typeof raw}`);
  }
  return raw as Record<string, unknown>;
}

function expectString(
  obj: Record<string, unknown>,
  key: string,
  label: string,
): string {
  const val = obj[key];
  if (typeof val !== "string") {
    throw new Error(`${label} is required and must be a string`);
  }
  return val;
}

function optString(
  obj: Record<string, unknown>,
  key: string,
): string | undefined {
  const val = obj[key];
  return typeof val === "string" ? val : undefined;
}

function optObject(
  obj: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const val = obj[key];
  if (val == null) return undefined;
  if (typeof val !== "object" || Array.isArray(val)) return undefined;
  return val as Record<string, unknown>;
}
