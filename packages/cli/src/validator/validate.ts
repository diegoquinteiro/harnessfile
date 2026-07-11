import { KNOWN_OWNED_FIELDS, type Harnessfile, type StepDef } from "../ir/types.js";
import type {
  ValidationResult,
  ValidationError,
  ValidationWarning,
} from "../providers/interface.js";

// Structural validation of a normalized Harnessfile IR (spec v0.2).
// Checks version, entity integrity, graph connectivity, reference integrity,
// cycle constraints, squads, skills, scheduled triggers, and targets.

export function validateHarnessfile(ir: Harnessfile): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  validateVersion(ir, errors);
  validateName(ir, errors);
  validateAgents(ir, errors, warnings);
  validateSquads(ir, errors);
  validateTargets(ir, errors, warnings);
  if (ir.steps) {
    validateStepRefs(ir, errors, warnings);
    validateGraphConnectivity(ir, errors, warnings);
    validateCycles(ir, errors);
  }

  return { valid: errors.length === 0, errors, warnings };
}

function validateVersion(ir: Harnessfile, errors: ValidationError[]) {
  if (ir.version !== "0.2") {
    errors.push({
      path: "harnessfile",
      message: `Unsupported version "${ir.version}". Only "0.2" is supported.`,
    });
  }
}

function validateName(ir: Harnessfile, errors: ValidationError[]) {
  if (!ir.name) {
    errors.push({
      path: "name",
      message: "Harness name is required.",
    });
  }
}

function validateAgents(
  ir: Harnessfile,
  errors: ValidationError[],
  warnings: ValidationWarning[],
) {
  if (Object.keys(ir.agents).length === 0) {
    errors.push({
      path: "agents",
      message: "At least one agent must be defined in agents/.",
    });
  }
  const skillNames = new Set(ir.skills ?? []);
  for (const [name, agent] of Object.entries(ir.agents)) {
    if (!agent.description) {
      errors.push({
        path: `agents.${name}.description`,
        message: `Agent '${name}' is missing a description.`,
      });
    }
    if (!agent.instructions) {
      errors.push({
        path: `agents.${name}.instructions`,
        message: `Agent '${name}' is missing instructions (the Markdown body).`,
      });
    }
    for (const skill of agent.skills ?? []) {
      if (!skillNames.has(skill)) {
        errors.push({
          path: `agents.${name}.skills`,
          message: `Agent '${name}' references skill '${skill}' with no skills/${skill}/SKILL.md.`,
        });
      }
    }
  }
}

function validateSquads(ir: Harnessfile, errors: ValidationError[]) {
  if (!ir.squads) return;
  const agentNames = new Set(Object.keys(ir.agents));

  for (const [name, squad] of Object.entries(ir.squads)) {
    if (!squad.leader) {
      errors.push({
        path: `squads.${name}.leader`,
        message: `Squad '${name}' is missing a leader.`,
      });
      continue;
    }
    if (!agentNames.has(squad.leader)) {
      errors.push({
        path: `squads.${name}.leader`,
        message: `Squad '${name}' leader '${squad.leader}' is not a defined agent.`,
      });
    }
    if (squad.members.length === 0) {
      errors.push({
        path: `squads.${name}.members`,
        message: `Squad '${name}' has no members.`,
      });
    }
    for (const member of squad.members) {
      if (!agentNames.has(member.agent)) {
        errors.push({
          path: `squads.${name}.members`,
          message: `Squad '${name}' member '${member.agent}' is not a defined agent.`,
        });
      }
    }
    if (
      squad.members.length > 0 &&
      !squad.members.some((m) => m.agent === squad.leader)
    ) {
      errors.push({
        path: `squads.${name}.leader`,
        message: `Squad '${name}' leader '${squad.leader}' must also appear in members.`,
      });
    }
  }
}

function validateTargets(
  ir: Harnessfile,
  errors: ValidationError[],
  warnings: ValidationWarning[],
) {
  if (!ir.targets) return;
  const knownFields = new Set<string>(KNOWN_OWNED_FIELDS);

  for (const [name, target] of Object.entries(ir.targets)) {
    if (!target.provider) {
      errors.push({
        path: `targets.${name}.provider`,
        message: `Target '${name}' is missing a provider.`,
      });
    }
    for (const field of target.owns ?? []) {
      if (!knownFields.has(field)) {
        warnings.push({
          path: `targets.${name}.owns`,
          message: `Target '${name}' owns unknown field '${field}'. Known fields: ${[...knownFields].join(", ")}.`,
        });
      }
    }
  }
}

function validateStepRefs(
  ir: Harnessfile,
  errors: ValidationError[],
  warnings: ValidationWarning[],
) {
  const steps = ir.steps!;
  const stepNames = new Set(Object.keys(steps));
  const agentNames = new Set(Object.keys(ir.agents));
  const squadNames = new Set(Object.keys(ir.squads ?? {}));

  for (const [name, step] of Object.entries(steps)) {
    // Agent reference
    if (step.agent && !agentNames.has(step.agent)) {
      errors.push({
        path: `steps.${name}.agent`,
        message: `Step '${name}' references undefined agent '${step.agent}'.`,
      });
    }

    // Squad reference
    if (step.squad && !squadNames.has(step.squad)) {
      errors.push({
        path: `steps.${name}.squad`,
        message: `Step '${name}' references undefined squad '${step.squad}'.`,
      });
    }

    if (step.agent && step.squad) {
      errors.push({
        path: `steps.${name}`,
        message: `Step '${name}' declares both agent and squad — pick one.`,
      });
    }

    // Next references
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

    // Orchestrator is superseded by squads in v0.2 — still parsed, but flagged
    if (step.type === "orchestrator") {
      warnings.push({
        path: `steps.${name}`,
        message: `Step '${name}': type 'orchestrator' is superseded by squads in v0.2. Define a squad in squads/ and reference it with 'squad: <name>'.`,
      });
    }

    // Pool references (legacy orchestrator)
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

    // Scheduled trigger constraints (D41)
    if (step.type === "trigger" && step.schedule && !step.next) {
      errors.push({
        path: `steps.${name}.next`,
        message: `Scheduled trigger '${name}' must declare a next step.`,
      });
    }

    // Agent step must reference an agent
    if (step.type === "agent" && !step.agent) {
      errors.push({
        path: `steps.${name}`,
        message: `Agent step '${name}' must reference an agent.`,
      });
    }

    // Squad step must reference a squad
    if (step.type === "squad" && !step.squad) {
      errors.push({
        path: `steps.${name}`,
        message: `Squad step '${name}' must reference a squad.`,
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

  // Find entry points: trigger steps, or if none exist the graph must be single-entry
  const triggers = stepNames.filter((n) => steps[n].type === "trigger");

  if (triggers.length === 0) {
    // No explicit triggers — warn but don't error (minimal harness)
    // Try to find a natural entry: step that nothing points to
    const targeted = new Set<string>();
    for (const step of Object.values(steps)) {
      for (const t of getNextTargets(step)) {
        targeted.add(t);
      }
    }
    const entries = stepNames.filter((n) => !targeted.has(n));
    if (entries.length === 0) {
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
          for (const step of Object.values(steps)) {
            for (const t of getNextTargets(step)) {
              targeted.add(t);
            }
          }
          return !targeted.has(n);
        });

  const queue = [...entryPoints];
  while (queue.length > 0) {
    const current = queue.pop()!;
    if (reachable.has(current)) continue;
    reachable.add(current);
    const step = steps[current];
    if (step) {
      for (const target of getNextTargets(step)) {
        queue.push(target);
      }
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

    const step = steps[name];
    if (step) {
      for (const target of getNextTargets(step)) {
        dfs(target, [...path, name]);
      }
    }

    inStack.delete(name);
  }

  for (const name of Object.keys(steps)) {
    if (!visited.has(name)) {
      dfs(name, []);
    }
  }
}

function getNextTargets(step: StepDef): string[] {
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
