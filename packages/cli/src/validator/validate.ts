import type { Harnessfile, StepDef } from "../ir/types.js";
import type {
  ValidationResult,
  ValidationError,
  ValidationWarning,
} from "../providers/interface.js";

// Structural validation of a normalized Harnessfile IR.
// Checks graph connectivity, reference integrity, and cycle constraints.

export function validateHarnessfile(ir: Harnessfile): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  validateVersion(ir, errors);
  validateAgents(ir, errors);
  if (ir.steps) {
    validateStepRefs(ir, errors);
    validateGraphConnectivity(ir, errors, warnings);
    validateCycles(ir, errors);
  }

  return { valid: errors.length === 0, errors, warnings };
}

const SUPPORTED_VERSIONS = new Set(["0.1", "0.2"]);

function validateVersion(ir: Harnessfile, errors: ValidationError[]) {
  if (!SUPPORTED_VERSIONS.has(ir.version)) {
    errors.push({
      path: "harnessfile",
      message: `Unsupported version "${ir.version}". Supported: ${[...SUPPORTED_VERSIONS].join(", ")}.`,
    });
  }
}

function validateAgents(ir: Harnessfile, errors: ValidationError[]) {
  // v0.1 requires at least one agent. v0.2 makes agents optional when steps
  // use inline execution modes (prompt/bash/command/loop).
  if (ir.version === "0.1" && Object.keys(ir.agents).length === 0) {
    errors.push({
      path: "agents",
      message: "At least one agent must be defined.",
    });
  }
  for (const [name, agent] of Object.entries(ir.agents)) {
    if (!agent.model) {
      errors.push({
        path: `agents.${name}.model`,
        message: `Agent '${name}' is missing a model.`,
      });
    }
    if (!agent.instructions) {
      errors.push({
        path: `agents.${name}.instructions`,
        message: `Agent '${name}' is missing instructions.`,
      });
    }
  }
}

function validateStepRefs(ir: Harnessfile, errors: ValidationError[]) {
  const steps = ir.steps!;
  const stepNames = new Set(Object.keys(steps));
  const agentNames = new Set(Object.keys(ir.agents));

  for (const [name, step] of Object.entries(steps)) {
    // Agent reference
    if (step.agent && !agentNames.has(step.agent)) {
      errors.push({
        path: `steps.${name}.agent`,
        message: `Step '${name}' references undefined agent '${step.agent}'.`,
      });
    }

    // Next references (forward edges)
    const nextTargets = step.next
      ? Array.isArray(step.next)
        ? step.next
        : [step.next]
      : [];
    for (const target of nextTargets) {
      if (!stepNames.has(target)) {
        errors.push({
          path: `steps.${name}.next`,
          message: `Step '${name}' targets undefined step '${target}'.`,
        });
      }
    }

    // depends_on references (backward edges, v0.2)
    if (step.dependsOn) {
      for (const source of step.dependsOn) {
        if (!stepNames.has(source)) {
          errors.push({
            path: `steps.${name}.depends_on`,
            message: `Step '${name}' depends on undefined step '${source}'.`,
          });
        }
      }
    }

    // Route references
    if (step.routes) {
      for (const [route, target] of Object.entries(step.routes)) {
        if (!stepNames.has(target)) {
          errors.push({
            path: `steps.${name}.routes.${route}`,
            message: `Route '${route}' in step '${name}' targets undefined step '${target}'.`,
          });
        }
      }
    }

    // Pool references
    if (step.pool) {
      for (const agentRef of step.pool) {
        if (!agentNames.has(agentRef)) {
          errors.push({
            path: `steps.${name}.pool`,
            message: `Pool in step '${name}' references undefined agent '${agentRef}'.`,
          });
        }
      }
    }

    // Agent step must have an agent, unless it has an inline execution mode
    // (prompt/bash/command/loop) or a provider-specific raw execution mode
    // (e.g., Archon's `approval:` interactive gate block).
    const hasInlineMode =
      step.prompt != null ||
      step.bash != null ||
      step.command != null ||
      step.loop != null ||
      (step.raw != null && Object.keys(step.raw).length > 0);
    if (step.type === "agent" && !step.agent && !hasInlineMode) {
      errors.push({
        path: `steps.${name}`,
        message: `Agent step '${name}' must reference an agent or provide an inline execution mode (prompt, bash, command, loop, or provider-specific mode).`,
      });
    }
  }
}

function validateGraphConnectivity(
  ir: Harnessfile,
  errors: ValidationError[],
  warnings: ValidationWarning[],
) {
  const steps = ir.steps!;
  const stepNames = Object.keys(steps);

  // Build the forward adjacency list, folding in both `next:` (forward) and
  // `depends_on:` (backward, v0.2) into a single outgoing edge view.
  const outgoing: Record<string, Set<string>> = {};
  for (const n of stepNames) outgoing[n] = new Set();

  for (const [from, step] of Object.entries(steps)) {
    for (const t of getForwardTargets(step)) {
      if (stepNames.includes(t)) outgoing[from].add(t);
    }
    if (step.dependsOn) {
      for (const source of step.dependsOn) {
        if (stepNames.includes(source)) outgoing[source].add(from);
      }
    }
  }

  // Find entry points: trigger steps, or if none exist the graph must be single-entry
  const triggers = stepNames.filter((n) => steps[n].type === "trigger");

  if (triggers.length === 0) {
    // No explicit triggers — warn but don't error (minimal harness)
    // Try to find a natural entry: step that nothing points to
    const targeted = new Set<string>();
    for (const from of stepNames) {
      for (const t of outgoing[from]) targeted.add(t);
    }
    const entries = stepNames.filter((n) => !targeted.has(n));
    if (entries.length === 0 && stepNames.length > 0) {
      warnings.push({
        path: "steps",
        message:
          "No trigger steps and no natural entry point found. All steps are targeted by another step.",
      });
    } else if (entries.length > 1) {
      warnings.push({
        path: "steps",
        message: `Multiple entry points detected without explicit triggers: ${entries.join(", ")}. Consider adding trigger steps.`,
      });
    }
  }

  // Check for unreachable steps
  const reachable = new Set<string>();
  const entryPoints =
    triggers.length > 0
      ? triggers
      : stepNames.filter((n) => {
          const targeted = new Set<string>();
          for (const from of stepNames) {
            for (const t of outgoing[from]) targeted.add(t);
          }
          return !targeted.has(n);
        });

  const queue = [...entryPoints];
  while (queue.length > 0) {
    const current = queue.pop()!;
    if (reachable.has(current)) continue;
    reachable.add(current);
    for (const target of outgoing[current] ?? []) {
      queue.push(target);
    }
  }

  for (const name of stepNames) {
    if (!reachable.has(name)) {
      warnings.push({
        path: `steps.${name}`,
        message: `Step '${name}' is unreachable from any entry point.`,
      });
    }
  }
}

function validateCycles(ir: Harnessfile, errors: ValidationError[]) {
  const steps = ir.steps!;
  const stepNames = Object.keys(steps);

  // Build the same outgoing adjacency view used by connectivity — folding
  // next: and depends_on: into a unified forward graph.
  const outgoing: Record<string, string[]> = {};
  for (const n of stepNames) outgoing[n] = [];
  for (const [from, step] of Object.entries(steps)) {
    for (const t of getForwardTargets(step)) {
      if (stepNames.includes(t)) outgoing[from].push(t);
    }
    if (step.dependsOn) {
      for (const source of step.dependsOn) {
        if (stepNames.includes(source)) outgoing[source].push(from);
      }
    }
  }

  // DFS cycle detection — cycles are only allowed for eval loops
  const visited = new Set<string>();
  const inStack = new Set<string>();

  function dfs(name: string, path: string[]): void {
    if (inStack.has(name)) {
      // Found a cycle — check if ALL steps in the cycle have eval + maxIterations
      const cycleStart = path.indexOf(name);
      const cycle = path.slice(cycleStart);
      const hasEvalLoop = cycle.every((stepName) => {
        const step = steps[stepName];
        return step?.eval && step.maxIterations;
      });
      if (!hasEvalLoop) {
        errors.push({
          path: `steps.${name}`,
          message: `Cycle detected: ${[...cycle, name].join(" → ")}. Cycles are only allowed when all steps in the cycle have eval + max-iterations.`,
        });
      }
      return;
    }
    if (visited.has(name)) return;

    visited.add(name);
    inStack.add(name);

    for (const target of outgoing[name] ?? []) {
      dfs(target, [...path, name]);
    }

    inStack.delete(name);
  }

  for (const name of stepNames) {
    if (!visited.has(name)) {
      dfs(name, []);
    }
  }
}

/** Forward edges declared on the source step (next + routes). */
function getForwardTargets(step: StepDef): string[] {
  const targets: string[] = [];
  if (step.next) {
    if (Array.isArray(step.next)) {
      targets.push(...step.next);
    } else {
      targets.push(step.next);
    }
  }
  if (step.routes) {
    targets.push(...Object.values(step.routes));
  }
  return targets;
}
