import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { interrupt } from "@langchain/langgraph";
import type { Harnessfile, StepDef, AgentDef } from "../../ir/types.js";
import { createChatModel } from "./model-factory.js";
import type { HarnessState } from "./state-builder.js";

// Builds LangGraph node functions from harnessfile step definitions.
// Each node function takes state, performs its action, and returns partial state updates.

type StateType = { messages: any[]; _currentStep: string; _stepOutputs: Record<string, unknown>; _evalIterations: Record<string, number>; _triggerData: Record<string, unknown> };
type NodeFn = (state: StateType) => Promise<Partial<StateType>>;

export function buildNodeFunctions(
  ir: Harnessfile,
): Map<string, NodeFn> {
  const nodes = new Map<string, NodeFn>();

  if (!ir.steps) return nodes;

  for (const [stepName, step] of Object.entries(ir.steps)) {
    switch (step.type) {
      case "trigger":
        nodes.set(stepName, buildTriggerNode(stepName));
        break;
      case "output":
        nodes.set(stepName, buildOutputNode(stepName, step));
        break;
      case "gate":
        nodes.set(stepName, buildGateNode(stepName, step));
        break;
      case "router":
        nodes.set(stepName, buildRouterNode(stepName, step, ir.agents));
        break;
      case "orchestrator":
        nodes.set(stepName, buildOrchestratorNode(stepName, step, ir.agents));
        break;
      case "agent":
      default:
        nodes.set(stepName, buildAgentNode(stepName, step, ir.agents));
        break;
    }
  }

  return nodes;
}

function buildTriggerNode(stepName: string): NodeFn {
  return async (state) => {
    // Trigger node passes through — trigger data is already in state from createRun
    return { _currentStep: stepName };
  };
}

function buildOutputNode(stepName: string, step: StepDef): NodeFn {
  return async (state) => {
    // Output node: extract expected fields from state
    const output: Record<string, unknown> = {};
    if (step.input) {
      for (const field of Object.keys(step.input)) {
        output[field] = state._stepOutputs[field];
      }
    }
    return {
      _currentStep: stepName,
      _stepOutputs: { [stepName]: output },
    };
  };
}

function buildGateNode(stepName: string, step: StepDef): NodeFn {
  return async (state) => {
    // Use LangGraph's interrupt() to pause execution and wait for human input
    const approval = interrupt({
      type: "gate",
      step: stepName,
      channel: step.channel,
      timeout: step.timeout ?? "24h",
      fallback: step.fallback ?? "reject",
      context: state._stepOutputs,
    });

    // This code executes after resumeRun() is called
    const approved =
      approval === true ||
      approval === "approve" ||
      (typeof approval === "object" && approval?.approved === true);

    if (!approved) {
      throw new Error(`Gate '${stepName}' rejected`);
    }

    return {
      _currentStep: stepName,
      _stepOutputs: { [`${stepName}_approved`]: true },
    };
  };
}

function buildRouterNode(
  stepName: string,
  step: StepDef,
  agents: Record<string, AgentDef>,
): NodeFn {
  const agentDef = step.agent ? agents[step.agent] : undefined;
  if (!agentDef) {
    throw new Error(`Router step '${stepName}' must reference an agent`);
  }

  const model = createChatModel(agentDef.model);
  const routes = step.routes ?? {};
  const routeNames = Object.keys(routes);

  return async (state) => {
    const systemPrompt = [
      agentDef.instructions,
      "",
      `Classify the input into exactly one of these categories: ${routeNames.join(", ")}`,
      `Respond with ONLY the category name, nothing else.`,
    ].join("\n");

    const response = await model.invoke([
      new SystemMessage(systemPrompt),
      ...state.messages,
    ]);

    const classification = (
      typeof response.content === "string"
        ? response.content
        : ""
    ).trim().toLowerCase();

    return {
      messages: [response],
      _currentStep: stepName,
      _stepOutputs: { [`${stepName}_route`]: classification },
    };
  };
}

function buildOrchestratorNode(
  stepName: string,
  step: StepDef,
  agents: Record<string, AgentDef>,
): NodeFn {
  const agentDef = step.agent ? agents[step.agent] : undefined;
  if (!agentDef) {
    throw new Error(`Orchestrator step '${stepName}' must reference an agent`);
  }

  const model = createChatModel(agentDef.model);
  const poolNames = step.pool ?? [];

  // Build descriptions of pool agents for the orchestrator prompt
  const poolDescriptions = poolNames
    .map((name) => {
      const a = agents[name];
      return a ? `- ${name}: ${a.instructions}` : `- ${name}: (unknown)`;
    })
    .join("\n");

  return async (state) => {
    const systemPrompt = [
      agentDef.instructions,
      "",
      "You have the following sub-agents available:",
      poolDescriptions,
      "",
      `Coordinate research using these agents. Max parallel agents: ${step.maxAgents ?? 5}.`,
      `Timeout: ${step.timeout ?? "none"}.`,
      "",
      "Synthesize all findings into a comprehensive result.",
    ].join("\n");

    // For v0.1, orchestrator runs as a single agent call that considers pool agents
    // True dynamic spawning would require LangGraph's Command API
    const response = await model.invoke([
      new SystemMessage(systemPrompt),
      ...state.messages,
    ]);

    return {
      messages: [response],
      _currentStep: stepName,
      _stepOutputs: {
        [stepName]: typeof response.content === "string" ? response.content : "",
      },
    };
  };
}

function buildAgentNode(
  stepName: string,
  step: StepDef,
  agents: Record<string, AgentDef>,
): NodeFn {
  const agentDef = step.agent ? agents[step.agent] : undefined;
  if (!agentDef) {
    throw new Error(`Step '${stepName}' must reference an agent`);
  }

  const model = createChatModel(agentDef.model);

  return async (state) => {
    // Build context: use step.context to select from previous outputs, or full output
    let contextMessages = state.messages;
    if (step.context) {
      const parts = step.context.split(".");
      const stepOutput = state._stepOutputs[parts[0]];
      if (stepOutput != null) {
        const contextValue =
          parts.length > 1 && typeof stepOutput === "object"
            ? (stepOutput as Record<string, unknown>)[parts[1]]
            : stepOutput;
        contextMessages = [
          ...state.messages,
          new HumanMessage(
            typeof contextValue === "string"
              ? contextValue
              : JSON.stringify(contextValue),
          ),
        ];
      }
    }

    const response = await model.invoke([
      new SystemMessage(agentDef.instructions),
      ...contextMessages,
    ]);

    return {
      messages: [response],
      _currentStep: stepName,
      _stepOutputs: {
        [stepName]: typeof response.content === "string" ? response.content : "",
      },
    };
  };
}
