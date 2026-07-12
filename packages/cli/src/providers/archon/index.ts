import type { Harnessfile, StepDef, LoopDef } from "../../ir/types.js";
import type {
  CompileProvider,
  CompileResult,
  Warning,
} from "../compile.js";
import { emitArchonYaml, type ArchonNode, type ArchonWorkflow } from "./emit.js";
import { mapModel } from "./models.js";
import { makeWarning, makeInfo, makeError, WARNING_CODES } from "./warnings.js";

// ---- Archon compile provider ----
//
// Translates Harnessfile IR → Archon workflow YAML (coleam00/Archon format).
// The translation is designed for round-trip fidelity with the 20 default
// workflows shipped in .archon/workflows/defaults/. Harnessfile-only features
// (runspace, observability, memory, security, top-level hooks, etc.) are
// dropped with info/warning-level diagnostics.
//
// Passthrough: any non-standard top-level or step-level field declared in the
// Harnessfile is preserved in the ir.raw / step.raw bags by the normalizer
// and emitted verbatim by this compiler. This lets authors express
// Archon-specific constructs (approval, skills, mcp, idle_timeout, hooks,
// interactive, context: fresh) without bloating the Harnessfile spec.

export class ArchonProvider implements CompileProvider {
  target = "archon/v1";
  displayName = "Archon workflow v1 (coleam00/Archon)";

  compile(ir: Harnessfile): CompileResult {
    const warnings: Warning[] = [];
    const workflow = buildWorkflow(ir, warnings);
    const yaml = emitArchonYaml(workflow);
    const name = ir.name ?? "harnessfile";

    return {
      files: [
        {
          path: `${name}.yaml`,
          content: yaml,
        },
      ],
      warnings,
    };
  }
}

// ---- Main translation ----

function buildWorkflow(
  ir: Harnessfile,
  warnings: Warning[],
): ArchonWorkflow {
  // Top-level sections that have no Archon equivalent — report as info/warning
  if (ir.observability) {
    warnings.push(
      makeInfo(
        WARNING_CODES.FEATURE_IGNORED,
        "observability block has no Archon equivalent — dropped.",
        { path: "observability" },
      ),
    );
  }
  if (ir.memory) {
    warnings.push(
      makeInfo(
        WARNING_CODES.FEATURE_IGNORED,
        "memory block has no Archon equivalent — dropped.",
        { path: "memory" },
      ),
    );
  }
  if (ir.security) {
    warnings.push(
      makeWarning(
        WARNING_CODES.FEATURE_IGNORED,
        "security block has no Archon equivalent — dropped.",
        { path: "security" },
      ),
    );
  }
  if (ir.resilience) {
    warnings.push(
      makeInfo(
        WARNING_CODES.FEATURE_IGNORED,
        "resilience block has no Archon equivalent — dropped.",
        { path: "resilience" },
      ),
    );
  }
  if (ir.hooks) {
    warnings.push(
      makeWarning(
        WARNING_CODES.FEATURE_IGNORED,
        "top-level hooks have no Archon equivalent — per-step hooks can be expressed via step.raw.",
        { path: "hooks" },
      ),
    );
  }

  // Agents: skills warning
  for (const [name, agent] of Object.entries(ir.agents)) {
    if (agent.skills && agent.skills.length > 0) {
      warnings.push(
        makeWarning(
          WARNING_CODES.SKILLS_NOT_SUPPORTED,
          `Agent '${name}' declares skills — Archon consumes skills via node-level 'skills:' field, not agent-level.`,
          { path: `agents.${name}.skills` },
        ),
      );
    }
  }

  // Build the workflow object
  const workflow: ArchonWorkflow = {
    name: ir.name ?? "harnessfile",
  };

  if (ir.description) {
    workflow.description = ir.description;
  }

  // Preserve top-level raw fields (provider, interactive, env, …) verbatim
  if (ir.raw) {
    for (const [key, value] of Object.entries(ir.raw)) {
      workflow[key] = value;
    }
  }

  // Top-level provider/model come from the harness IR itself (standard keys)
  if (ir.provider) {
    // If the harness declared a provider like "archon/v1", the Archon top-level
    // field is just "claude" (the LLM provider). Only emit top-level provider
    // if it was something Archon would understand (not "archon/v1"); otherwise
    // preserve whatever was in raw.
    if (ir.provider !== "archon/v1" && !("provider" in workflow)) {
      workflow.provider = ir.provider;
    }
  }
  if (ir.model && !("model" in workflow)) {
    const mapped = mapModel(ir.model);
    if (!mapped.mapped) {
      warnings.push(
        makeWarning(
          WARNING_CODES.MODEL_NOT_MAPPED,
          `Top-level model '${ir.model}' has no entry in MODEL_MAP; passing through unchanged.`,
          { path: "model" },
        ),
      );
    }
    workflow.model = mapped.value;
  }

  // Steps → nodes (preserve insertion order)
  if (ir.steps) {
    const nodes: ArchonNode[] = [];
    for (const [stepName, step] of Object.entries(ir.steps)) {
      const node = buildNode(stepName, step, ir, warnings);
      if (node) nodes.push(node);
    }
    workflow.nodes = nodes;
  }

  return workflow;
}

// ---- Step → node ----

function buildNode(
  stepName: string,
  step: StepDef,
  ir: Harnessfile,
  warnings: Warning[],
): ArchonNode | null {
  // Handle step types that have no Archon equivalent
  if (step.type === "trigger") {
    warnings.push(
      makeInfo(
        WARNING_CODES.TRIGGER_NOT_TRANSLATED,
        `Step '${stepName}' is a trigger node — Archon uses platform adapters instead of inline triggers; node dropped.`,
        { path: `steps.${stepName}` },
      ),
    );
    return null;
  }
  if (step.type === "output") {
    warnings.push(
      makeInfo(
        WARNING_CODES.OUTPUT_NOT_TRANSLATED,
        `Step '${stepName}' is an output node — Archon has no explicit output nodes; node dropped.`,
        { path: `steps.${stepName}` },
      ),
    );
    return null;
  }
  if (step.type === "orchestrator") {
    warnings.push(
      makeError(
        WARNING_CODES.ORCHESTRATOR_NOT_SUPPORTED,
        `Step '${stepName}' is an orchestrator — Archon has no equivalent dynamic agent pool construct.`,
        { path: `steps.${stepName}` },
      ),
    );
    return null;
  }

  const node: ArchonNode = { id: stepName };

  // depends_on: explicit backward edges, or inverted next: forward edges
  const depsFromThis = step.dependsOn ? [...step.dependsOn] : [];
  // Also pick up forward edges: for each other step S with S.next containing
  // this step, add S to our depends_on.
  if (ir.steps) {
    for (const [otherName, other] of Object.entries(ir.steps)) {
      if (otherName === stepName) continue;
      const nexts = other.next
        ? Array.isArray(other.next)
          ? other.next
          : [other.next]
        : [];
      if (nexts.includes(stepName) && !depsFromThis.includes(otherName)) {
        depsFromThis.push(otherName);
      }
    }
  }
  if (depsFromThis.length > 0) {
    node.depends_on = depsFromThis;
  }

  // when: opaque string
  if (step.when) {
    node.when = step.when;
  }

  // context: fresh (etc.) — archon-specific per-node context marker
  if (step.context) {
    node.context = step.context;
  }

  // trigger_rule: from waitFor or from raw passthrough
  if (step.waitFor === "any-done") {
    warnings.push(
      makeWarning(
        WARNING_CODES.WAIT_FOR_ANY_DONE_UNSUPPORTED,
        `Step '${stepName}' uses wait-for: any-done — Archon has no equivalent; falling back to one_success.`,
        { path: `steps.${stepName}.wait-for` },
      ),
    );
    node.trigger_rule = "one_success";
  } else if (step.waitFor === "any") {
    node.trigger_rule = "one_success";
  } else if (step.waitFor === "all-done") {
    node.trigger_rule = "all_done";
  } else if (step.waitFor === "all") {
    // all is the default; only emit if the Harnessfile declared it explicitly.
    // We can't easily tell the difference, so omit.
  }

  // Router → prompt with output_format (warning if no structured output)
  if (step.type === "router") {
    if (!step.outputFormat && !step.output) {
      warnings.push(
        makeWarning(
          WARNING_CODES.ROUTER_NEEDS_STRUCTURED_OUTPUT,
          `Step '${stepName}' is a router but has no output_format; Archon expects structured outputs for conditional routing.`,
          { path: `steps.${stepName}` },
        ),
      );
    }
  }

  // Execution mode (prompt/bash/command/loop) — preserve whichever was set
  if (step.command != null) {
    node.command = step.command;
  }
  if (step.bash != null) {
    node.bash = step.bash;
  }
  if (step.prompt != null) {
    node.prompt = step.prompt;
  }
  if (step.loop != null) {
    node.loop = buildLoop(step.loop);
  }

  // If step uses an agent reference, inline the agent's instructions as prompt
  if (step.agent != null && step.prompt == null && step.bash == null && step.command == null && step.loop == null) {
    const agent = ir.agents[step.agent];
    if (agent) {
      node.prompt = agent.instructions;
    }
  }

  // Model override — with mapping
  if (step.model) {
    const mapped = mapModel(step.model);
    if (!mapped.mapped) {
      warnings.push(
        makeWarning(
          WARNING_CODES.MODEL_NOT_MAPPED,
          `Step '${stepName}' model '${step.model}' has no entry in MODEL_MAP; passing through unchanged.`,
          { path: `steps.${stepName}.model` },
        ),
      );
    }
    node.model = mapped.value;
  }

  // Tool allow/deny
  if (step.allowedTools !== undefined) {
    node.allowed_tools = step.allowedTools;
  }
  if (step.deniedTools !== undefined) {
    node.denied_tools = step.deniedTools;
  }

  // Output format
  if (step.outputFormat !== undefined) {
    node.output_format = step.outputFormat;
  } else if (step.output !== undefined && isLikelyJsonSchema(step.output)) {
    node.output_format = step.output as Record<string, unknown>;
  }

  // Timeout (pass through as-is; Archon wants ms numbers for bash, strings otherwise)
  if (step.timeout !== undefined) {
    node.timeout = step.timeout;
  }

  // Eval → warning (not translated)
  if (step.eval && step.eval.length > 0) {
    warnings.push(
      makeWarning(
        WARNING_CODES.EVAL_NOT_SUPPORTED,
        `Step '${stepName}' declares eval metrics — Archon has no native eval retry loop; wrap with a bash validation node instead.`,
        { path: `steps.${stepName}.eval` },
      ),
    );
  }
  if (step.maxIterations !== undefined && !step.loop && !step.eval) {
    warnings.push(
      makeInfo(
        WARNING_CODES.RETRY_AS_LOOP,
        `Step '${stepName}' has max-iterations without loop: or eval: — Archon can't express standalone retry counts.`,
        { path: `steps.${stepName}.max-iterations` },
      ),
    );
  }

  // Preserve step raw passthrough (approval, skills, mcp, hooks, idle_timeout,
  // context, interactive, trigger_rule if author used snake_case directly, …)
  if (step.raw) {
    for (const [key, value] of Object.entries(step.raw)) {
      // Skip trigger_rule if waitFor already produced it
      if ((key === "trigger_rule" || key === "trigger-rule") && node.trigger_rule) {
        continue;
      }
      // Normalize kebab → snake for well-known Archon fields
      const normalizedKey = archonKey(key);
      if (!(normalizedKey in node)) {
        node[normalizedKey] = value;
      }
    }
  }

  return node;
}

// ---- Loop translation ----

function buildLoop(loop: LoopDef): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (loop.prompt !== undefined) out.prompt = loop.prompt;
  if (loop.until !== undefined) out.until = loop.until;
  if (loop.untilBash !== undefined) out.until_bash = loop.untilBash;
  if (loop.maxIterations !== undefined) out.max_iterations = loop.maxIterations;
  if (loop.freshContext !== undefined) out.fresh_context = loop.freshContext;
  if (loop.interactive !== undefined) out.interactive = loop.interactive;
  if (loop.gateMessage !== undefined) out.gate_message = loop.gateMessage;
  // Preserve unknown loop fields
  if (loop.raw) {
    for (const [key, value] of Object.entries(loop.raw)) {
      if (!(key in out)) out[archonKey(key)] = value;
    }
  }
  return out;
}

// ---- Helpers ----

function isLikelyJsonSchema(obj: unknown): boolean {
  if (!obj || typeof obj !== "object") return false;
  const o = obj as Record<string, unknown>;
  return (
    "type" in o ||
    "properties" in o ||
    "required" in o ||
    "enum" in o
  );
}

/** Convert kebab-case or camelCase keys to snake_case (Archon's convention). */
function archonKey(key: string): string {
  // camelCase → snake_case
  let s = key.replace(/([A-Z])/g, (m) => "_" + m.toLowerCase());
  // kebab-case → snake_case
  s = s.replace(/-/g, "_");
  // Strip leading underscore if the camelCase handling produced one
  if (s.startsWith("_")) s = s.slice(1);
  return s;
}

// ---- Register with the compile provider registry ----

import { registerCompileProvider } from "../compile.js";
registerCompileProvider(new ArchonProvider());

export { mapModel } from "./models.js";
export { WARNING_CODES } from "./warnings.js";
