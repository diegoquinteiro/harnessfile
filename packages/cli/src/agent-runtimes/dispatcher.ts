import { randomUUID } from "node:crypto";
import type { Harnessfile } from "../ir/types.js";
import type {
  RuntimeExecutor,
  RuntimeTaskResult,
  RuntimeExecuteOptions,
  RuntimeSession,
} from "./interface.js";
import { LocalRuntimeRegistry } from "./registry.js";
import type { AgentRuntimeDriver } from "./interface.js";
import { prepareRuntimeEnvironment } from "./environment.js";

export interface RuntimeDispatcherOptions {
  workspaceRoot?: string;
  drivers?: AgentRuntimeDriver[];
  registry?: LocalRuntimeRegistry;
}

export class RuntimeDispatcher implements RuntimeExecutor {
  private workspaceRoot: string;
  private registry: LocalRuntimeRegistry;

  constructor(
    private ir: Harnessfile,
    options: RuntimeDispatcherOptions = {},
  ) {
    this.workspaceRoot = options.workspaceRoot ?? process.cwd();
    this.registry = options.registry ?? new LocalRuntimeRegistry({ drivers: options.drivers });
  }

  async start(
    agentName: string,
    prompt: string,
    options: RuntimeExecuteOptions = {},
  ): Promise<RuntimeSession> {
    const agent = this.ir.agents[agentName];
    if (!agent) throw new Error(`Runtime dispatch references unknown agent '${agentName}'`);
    if (!agent.runtime) {
      throw new Error(
        `Agent '${agentName}' has no runtime profile. Add runtime: <profile> or let the execution target own placement.`,
      );
    }
    const profile = this.ir.runtimes?.[agent.runtime];
    if (!profile) {
      throw new Error(
        `Agent '${agentName}' references undefined runtime profile '${agent.runtime}'.`,
      );
    }
    const instance = await this.registry.resolve(agent.runtime, profile);
    const driver = this.registry.driver(instance.protocol);
    if (!driver) throw new Error(`Runtime instance '${instance.id}' has no protocol driver.`);
    const resumeCompatible = !options.resume || (
      options.resume.instanceId === instance.id &&
      options.resume.workspaceRoot === this.workspaceRoot
    );
    const env = await prepareRuntimeEnvironment(instance, this.workspaceRoot);
    const rawSession = await driver.start({
      taskId: options.taskId ?? randomUUID(),
      agentName,
      agent,
      profileName: agent.runtime,
      profile,
      instance,
      workspaceRoot: this.workspaceRoot,
      prompt,
      resumeSessionId: resumeCompatible ? options.resume?.sessionId : undefined,
      timeoutMs: options.timeoutMs,
      signal: options.signal,
      env,
    });
    let session: RuntimeSession = {
      ...rawSession,
      result: rawSession.result.then((result) => ({
        ...result,
        resume: result.sessionId
          ? {
              sessionId: result.sessionId,
              instanceId: instance.id,
              workspaceRoot: this.workspaceRoot,
            }
          : undefined,
      })),
    };
    if (options.resume && !resumeCompatible) {
      session = {
        ...session,
        events: prependEvent(session.events, {
          type: "warning",
          content: "Saved runtime session is incompatible with the selected instance or workspace; starting fresh.",
        }),
      };
    }
    return options.onEvent
      ? { ...session, events: tapEvents(session.events, options.onEvent) }
      : session;
  }

  async execute(
    agentName: string,
    prompt: string,
    options: RuntimeExecuteOptions = {},
  ): Promise<RuntimeTaskResult> {
    const session = await this.start(agentName, prompt, options);
    for await (const _event of session.events) {
      // Drain the structured stream; consumers can observe it through onEvent.
    }
    return session.result;
  }
}

async function* tapEvents<T>(events: AsyncIterable<T>, onEvent: (event: T) => void): AsyncIterable<T> {
  for await (const event of events) {
    onEvent(event);
    yield event;
  }
}

async function* prependEvent<T>(events: AsyncIterable<T>, event: T): AsyncIterable<T> {
  yield event;
  yield* events;
}
