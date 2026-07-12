import { StateGraph, START, END } from "@langchain/langgraph";
import { MemorySaver } from "@langchain/langgraph";
import type { Harnessfile, StepDef } from "../../ir/types.js";
import { buildStateAnnotation } from "./state-builder.js";
import { buildNodeFunctions, type EventEmitter } from "./node-builder.js";
import type { ProviderOptions } from "../interface.js";
import { RuntimeDispatcher } from "../../agent-runtimes/dispatcher.js";

// Builds a compiled LangGraph StateGraph from the harnessfile IR.
// The compiled graph can be invoked multiple times with different thread IDs.

export function buildGraph(
  ir: Harnessfile,
  options: ProviderOptions,
  emit: EventEmitter = () => {},
) {
  const StateAnnotation = buildStateAnnotation(ir);
  // Use `any` for the graph type because node names are dynamic strings
  // determined at runtime from the harnessfile YAML
  const graph: any = new StateGraph(StateAnnotation);

  // Build and add all node functions
  const runtime =
    options.runtimeExecutor ??
    new RuntimeDispatcher(ir, { workspaceRoot: options.workspaceRoot });
  const nodeFns = buildNodeFunctions(ir, emit, runtime);
  for (const [name, fn] of nodeFns) {
    graph.addNode(name, fn);
  }

  // Wire edges
  if (ir.steps) {
    wireEdges(graph, ir);
  }

  // Compile with checkpointer
  const checkpointer =
    options.checkpointer === "sqlite"
      ? new MemorySaver() // TODO: switch to SqliteSaver when available
      : new MemorySaver();

  return graph.compile({ checkpointer });
}

function wireEdges(graph: any, ir: Harnessfile) {
  const steps = ir.steps!;
  const stepNames = Object.keys(steps);

  // Find entry points
  const triggers = stepNames.filter((n) => steps[n].type === "trigger");

  if (triggers.length > 0) {
    // Wire START → each trigger
    for (const trigger of triggers) {
      graph.addEdge(START, trigger);
    }
  } else {
    // No triggers — find natural entry (step that nothing points to)
    const targeted = new Set<string>();
    for (const step of Object.values(steps)) {
      for (const t of getNextTargets(step)) {
        targeted.add(t);
      }
    }
    const entries = stepNames.filter((n) => !targeted.has(n));
    if (entries.length > 0) {
      graph.addEdge(START, entries[0]);
    }
  }

  // Wire step edges
  for (const [name, step] of Object.entries(steps)) {
    if (step.type === "router") {
      wireRouterEdges(graph, name, step);
    } else if (step.eval && step.maxIterations) {
      wireEvalLoopEdges(graph, name, step);
    } else if (step.next) {
      wireNextEdges(graph, name, step);
    } else if (step.type !== "output") {
      // No next and not output — this is an implicit end
      graph.addEdge(name, END);
    }

    // Output steps always end
    if (step.type === "output") {
      graph.addEdge(name, END);
    }
  }
}

function wireNextEdges(graph: any, name: string, step: StepDef) {
  if (Array.isArray(step.next)) {
    // Fan-out: use conditional edges that return all targets
    const targets = step.next;
    const mapping: Record<string, string> = {};
    for (const t of targets) {
      mapping[t] = t;
    }
    graph.addConditionalEdges(name, () => targets, mapping);
  } else if (step.next) {
    graph.addEdge(name, step.next);
  }
}

function wireRouterEdges(
  graph: any,
  name: string,
  step: StepDef,
) {
  const routes = step.routes ?? {};
  const mapping: Record<string, string> = {};
  for (const [_label, target] of Object.entries(routes)) {
    mapping[target] = target;
  }

  // Router: read the classification from state and map to target step
  graph.addConditionalEdges(
    name,
    (state: any) => {
      const classification = state._stepOutputs[`${name}_route`] as string;
      // Find matching route
      for (const [label, target] of Object.entries(routes)) {
        if (classification.includes(label.toLowerCase())) {
          return target;
        }
      }
      // Default to first route if no match
      const firstTarget = Object.values(routes)[0];
      return firstTarget ?? END;
    },
    mapping,
  );
}

function wireEvalLoopEdges(
  graph: any,
  name: string,
  step: StepDef,
) {
  const maxIter = step.maxIterations!;
  const nextTarget = step.next
    ? Array.isArray(step.next)
      ? step.next[0]
      : step.next
    : END;

  const mapping: Record<string, string> = {
    [name]: name, // retry
  };
  if (nextTarget !== END) {
    mapping[nextTarget] = nextTarget;
  }

  graph.addConditionalEdges(
    name,
    (state: any) => {
      const iterations = (state._evalIterations[name] ?? 0) + 1;

      // TODO: actually run evals and check pass criteria
      // For v0.1, we simulate eval pass after maxIterations
      if (iterations >= maxIter) {
        return nextTarget;
      }

      // Increment iteration counter (done via state update in the node)
      return name; // retry
    },
    mapping,
  );
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
