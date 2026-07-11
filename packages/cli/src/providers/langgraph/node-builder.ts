import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { interrupt } from "@langchain/langgraph";
import type { Harnessfile, StepDef, AgentDef, SquadDef } from "../../ir/types.js";
import type { HarnessEvent } from "../interface.js";
import { createChatModel } from "./model-factory.js";

// Builds LangGraph node functions from harness step definitions.
// Each node function takes state, performs its action, and returns partial state updates.

type StateType = {
  messages: any[];
  _currentStep: string;
  _stepOutputs: Record<string, unknown>;
  _evalIterations: Record<string, number>;
  _triggerData: Record<string, unknown>;
};
type NodeFn = (state: StateType, config?: any) => Promise<Partial<StateType>>;

/** Emits a harness event for the run identified by threadId (no-op when unset). */
export type EventEmitter = (
  threadId: string | undefined,
  event: Omit<HarnessEvent, "threadId" | "timestamp">,
) => void;

const SQUAD_MAX_ITERATIONS = 25;

export function buildNodeFunctions(
  ir: Harnessfile,
  emit: EventEmitter = () => {},
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
      case "squad":
        nodes.set(stepName, buildSquadNode(stepName, step, ir, emit));
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

function requireModel(agent: AgentDef, agentName: string): string {
  if (!agent.model) {
    throw new Error(
      `Agent '${agentName}' has no model. The langgraph runtime requires a portable model default on every agent it executes.`,
    );
  }
  return agent.model;
}

function threadIdOf(config: any): string | undefined {
  return config?.configurable?.thread_id;
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

  const model = createChatModel(requireModel(agentDef, step.agent!));
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

// ---- Squad node (D40) ----
//
// A squad step compiles to a leader orchestration loop: the leader model is invoked with
// its role card, the squad's orchestration instructions, and the member list, and must
// reply JSON {action: "dispatch", member, instruction} or {action: "done", summary}.
// On dispatch, the member agent's model runs with its role card + instruction + the
// conversation so far; the output is appended and control returns to the leader.

interface LeaderDecision {
  action: "dispatch" | "done";
  member?: string;
  instruction?: string;
  summary?: string;
}

export function parseLeaderDecision(content: unknown): LeaderDecision | null {
  if (typeof content !== "string") return null;
  const candidates: string[] = [];
  const trimmed = content.trim();
  candidates.push(trimmed);
  // Fenced code block
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) candidates.push(fenced[1].trim());
  // First {...} block
  const braces = trimmed.match(/\{[\s\S]*\}/);
  if (braces) candidates.push(braces[0]);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object") {
        if (parsed.action === "dispatch" && typeof parsed.member === "string") {
          return {
            action: "dispatch",
            member: parsed.member,
            instruction:
              typeof parsed.instruction === "string" ? parsed.instruction : "",
          };
        }
        if (parsed.action === "done") {
          return {
            action: "done",
            summary: typeof parsed.summary === "string" ? parsed.summary : "",
          };
        }
      }
    } catch {
      // try next candidate
    }
  }
  return null;
}

function buildSquadNode(
  stepName: string,
  step: StepDef,
  ir: Harnessfile,
  emit: EventEmitter,
): NodeFn {
  const squad: SquadDef | undefined = step.squad
    ? ir.squads?.[step.squad]
    : undefined;
  if (!squad) {
    throw new Error(`Squad step '${stepName}' must reference a squad`);
  }

  const leaderAgent = ir.agents[squad.leader];
  if (!leaderAgent) {
    throw new Error(
      `Squad '${step.squad}' leader '${squad.leader}' is not a defined agent`,
    );
  }
  const leaderModel = createChatModel(requireModel(leaderAgent, squad.leader));

  const memberModels = new Map<
    string,
    { agent: AgentDef; model: ReturnType<typeof createChatModel>; role?: string }
  >();
  for (const member of squad.members) {
    const agent = ir.agents[member.agent];
    if (!agent) {
      throw new Error(
        `Squad '${step.squad}' member '${member.agent}' is not a defined agent`,
      );
    }
    memberModels.set(member.agent, {
      agent,
      model: createChatModel(requireModel(agent, member.agent)),
      role: member.role,
    });
  }

  const memberList = squad.members
    .map((m) => {
      const agent = ir.agents[m.agent];
      const role = m.role ? ` — ${m.role}` : "";
      const description = agent?.description ? `: ${agent.description}` : "";
      return `- ${m.agent}${role}${description}`;
    })
    .join("\n");

  const leaderSystem = [
    leaderAgent.instructions,
    "",
    "# Squad orchestration instructions",
    squad.instructions,
    "",
    "# Squad members",
    memberList,
    "",
    "# Protocol",
    "You are the squad leader. On every turn reply with ONLY a JSON object, no prose:",
    `  {"action": "dispatch", "member": "<member-slug>", "instruction": "<what they should do>"}`,
    `  {"action": "done", "summary": "<final outcome>"}`,
    "Dispatch one member at a time. When the work is complete, reply with action done.",
  ].join("\n");

  return async (state, config) => {
    const threadId = threadIdOf(config);
    const transcript = [...state.messages];
    const newMessages: any[] = [];
    const dispatches: Array<{ member: string; instruction: string }> = [];
    let summary: string | undefined;

    for (let i = 0; i < SQUAD_MAX_ITERATIONS; i++) {
      const leaderResponse = await leaderModel.invoke([
        new SystemMessage(leaderSystem),
        ...transcript,
      ]);
      const content =
        typeof leaderResponse.content === "string"
          ? leaderResponse.content
          : JSON.stringify(leaderResponse.content);

      const decision = parseLeaderDecision(content);

      if (!decision) {
        emit(threadId, {
          type: "warning",
          step: stepName,
          data: {
            message: `Squad '${step.squad}' leader replied with non-JSON output — treating it as the final summary.`,
          },
        });
        summary = content;
        transcript.push(leaderResponse);
        newMessages.push(leaderResponse);
        break;
      }

      if (decision.action === "done") {
        summary = decision.summary ?? "";
        const doneMessage = new AIMessage(summary);
        transcript.push(doneMessage);
        newMessages.push(doneMessage);
        break;
      }

      // Dispatch
      const member = memberModels.get(decision.member!);
      if (!member) {
        const note = new AIMessage(
          `[harness] Member '${decision.member}' is not part of squad '${step.squad}'. Members: ${[...memberModels.keys()].join(", ")}.`,
        );
        transcript.push(note);
        emit(threadId, {
          type: "warning",
          step: stepName,
          data: {
            message: `Squad leader dispatched unknown member '${decision.member}'.`,
          },
        });
        continue;
      }

      dispatches.push({
        member: decision.member!,
        instruction: decision.instruction ?? "",
      });
      emit(threadId, {
        type: "step-start",
        step: `${stepName}:${decision.member}`,
        data: { member: decision.member, instruction: decision.instruction },
      });

      const memberSystem = [
        member.agent.instructions,
        "",
        `# Your role in squad '${squad.name ?? step.squad}'`,
        member.role ?? "Squad member.",
      ].join("\n");

      const memberResponse = await member.model.invoke([
        new SystemMessage(memberSystem),
        ...transcript,
        new HumanMessage(
          `[${squad.leader} → ${decision.member}] ${decision.instruction ?? ""}`,
        ),
      ]);
      const memberContent =
        typeof memberResponse.content === "string"
          ? memberResponse.content
          : JSON.stringify(memberResponse.content);

      const memberMessage = new AIMessage(
        `[${decision.member}] ${memberContent}`,
      );
      transcript.push(memberMessage);
      newMessages.push(memberMessage);

      emit(threadId, {
        type: "step-end",
        step: `${stepName}:${decision.member}`,
        data: { member: decision.member, output: memberContent },
      });
    }

    if (summary === undefined) {
      emit(threadId, {
        type: "warning",
        step: stepName,
        data: {
          message: `Squad '${step.squad}' hit the ${SQUAD_MAX_ITERATIONS}-iteration cap without a done action — finishing with the transcript so far.`,
        },
      });
      summary = `Squad '${step.squad}' reached the iteration cap (${SQUAD_MAX_ITERATIONS}) before the leader declared done.`;
    }

    return {
      messages: newMessages,
      _currentStep: stepName,
      _stepOutputs: {
        [stepName]: summary,
        [`${stepName}_dispatches`]: dispatches,
      },
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

  const model = createChatModel(requireModel(agentDef, step.agent!));
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

    // Orchestrator runs as a single agent call that considers pool agents.
    // Superseded by squads in v0.2 — kept for backward parsing compatibility.
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

  const model = createChatModel(requireModel(agentDef, step.agent!));

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
