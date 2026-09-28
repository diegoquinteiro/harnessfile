import { randomUUID } from "node:crypto";
import type { ProviderRef } from "../../ir/types.js";
import type { RuntimeExecuteOptions, RuntimeSession, RuntimeTaskResult, RuntimeEvent } from "../../agent-runtimes/interface.js";
import { RuntimeSessionController } from "../../agent-runtimes/session.js";
import type { ExecutionEnvironment, FactoryContext } from "../contracts.js";
import { WorkerDecoder, shellQuote, type WorkerRequest } from "./protocol.js";
import { taskSecretEnvironment } from "./task-services.js";
import type { TaskRuntimeScope } from "./detached.js";

/** SDK-specific adapters own infrastructure only, never coding-agent protocol logic. */
export interface RemoteSandbox {
  id: string;
  writeFile(path: string, contents: string): Promise<void>;
  run(command: string[], stdout: (chunk: string) => void, stderr: (chunk: string) => void): Promise<number>;
  destroy(): Promise<void>;
}

export interface SandboxRequest { env: Record<string, string>; timeoutMs: number }
export interface SandboxConnector {
  create(request: SandboxRequest): Promise<RemoteSandbox>;
  close?(): Promise<void>;
}

export interface RemoteConfig {
  repository: string;
  ref?: string;
  timeoutMs: number;
  workerCommand: string[];
  workerPlugins: string[];
  envSecrets: Record<string, string>;
}

export function remoteConfig(ref: ProviderRef): RemoteConfig {
  if (typeof ref.repository !== "string") throw new Error(`${ref.type} requires a repository HTTPS URL`);
  const url = new URL(ref.repository);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("Remote repository must be an HTTPS URL without credentials, query, or fragment");
  }
  const timeoutMs = ref.timeoutMs ?? 15 * 60_000;
  if (typeof timeoutMs !== "number" || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 24 * 60 * 60_000) {
    throw new Error("Remote timeoutMs must be a positive integer no greater than 24 hours");
  }
  const workerCommand = ref.workerCommand ?? ["node", "/opt/harnessfile/dist/src/services/execution/worker.js"];
  const workerPlugins = ref.workerPlugins ?? [];
  for (const [name, value] of Object.entries({ workerCommand, workerPlugins })) {
    if (!Array.isArray(value) || value.some(v => typeof v !== "string" || !v || v.includes("\0"))) {
      throw new Error(`${name} must be an array of nonempty strings`);
    }
  }
  if (!(workerCommand as string[]).length) throw new Error("workerCommand cannot be empty");
  if (ref.ref !== undefined && (typeof ref.ref !== "string" || !ref.ref || ref.ref.startsWith("-") || ref.ref.includes("\0"))) {
    throw new Error("Remote ref must be a nonempty Git ref or commit without a leading dash");
  }
  const envSecrets = ref.envSecrets ?? {};
  if (!envSecrets || typeof envSecrets !== "object" || Array.isArray(envSecrets)) throw new Error("envSecrets must map environment variables to secret names");
  for (const [key, value] of Object.entries(envSecrets)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || typeof value !== "string" || !value) throw new Error("Invalid envSecrets entry");
  }
  return { repository: url.href, ref: ref.ref as string | undefined, timeoutMs, workerCommand: workerCommand as string[], workerPlugins: workerPlugins as string[], envSecrets: envSecrets as Record<string, string> };
}

export class RemoteExecutionEnvironment implements ExecutionEnvironment {
  private sessions = new Set<RuntimeSession>();
  private background = new Set<Promise<void>>();
  private cleanupFailures = new Set<string>();
  private closed = false;
  private config: RemoteConfig;

  constructor(private provider: ProviderRef, private context: FactoryContext, private connector: SandboxConnector) {
    this.config = remoteConfig(provider);
  }

  async start(agentName: string, prompt: string, options: RuntimeExecuteOptions = {}): Promise<RuntimeSession> {
    if (this.closed) throw new Error("Remote execution environment is closed");
    const agent = this.context.ir.agents[agentName];
    if (!agent) throw new Error(`Unknown agent '${agentName}'`);
    const profile = agent.runtime && this.context.ir.runtimes?.[agent.runtime];
    if (!profile) throw new Error(`Agent '${agentName}' requires a defined runtime profile for remote execution`);
    const timeoutMs = options.timeoutMs ?? this.config.timeoutMs;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 86_400_000) throw new Error("Invalid remote task timeoutMs");
    const taskId = options.taskId ?? randomUUID();
    const instance = {
      id: `${this.provider.type}:${randomUUID()}`, profileName: agent.runtime!, protocol: profile.protocol,
      command: profile.command ?? profile.protocol, fixedArgs: profile.args ?? [], status: "online" as const,
      capabilities: { protocol: profile.protocol, command: profile.command ?? profile.protocol, streaming: true, resume: false, cancel: true,
        structuredEvents: ["status", "text", "thinking", "tool-use", "tool-result", "log", "warning", "error"] as RuntimeEvent["type"][] },
    };
    let stopReason: "cancelled" | "timeout" | undefined;
    let stop!: () => void;
    const stopped = new Promise<void>(resolve => { stop = resolve; });
    const cancel = async (reason: "cancelled" | "timeout" = "cancelled") => { stopReason ??= reason; stop(); };
    const controller = new RuntimeSessionController(taskId, instance, () => cancel());
    const emit = (event: RuntimeEvent) => {
      controller.emit(event);
      // Observers cannot interrupt resource cleanup or fail an otherwise valid task.
      try { options.onEvent?.(event); } catch { /* Consumer owns observer failures. */ }
    };
    const session = controller.session();
    this.sessions.add(session);
    const onAbort = () => { void cancel(); };
    options.signal?.addEventListener("abort", onAbort, { once: true });
    if (options.signal?.aborted) void cancel();
    const timer = setTimeout(() => { void cancel("timeout"); }, timeoutMs);
    const startedAt = Date.now();
    void (async () => {
      let sandbox: RemoteSandbox | undefined;
      let result: RuntimeTaskResult | undefined;
      let cleanupError = false;
      const destroy = async (resource: RemoteSandbox) => {
        try { await resource.destroy(); } catch { cleanupError = true; this.cleanupFailures.add(resource.id); }
      };
      try {
        emit({ type: "status", status: "starting" });
        if (options.resume) emit({ type: "warning", content: "Remote sandboxes are ephemeral; starting a new session instead of resuming." });
        const work = async () => {
          const env: Record<string, string> = {};
          const secretEnv: Record<string, string> = {};
          for (const [name, secret] of Object.entries(this.config.envSecrets)) { env[name] = await this.context.secret(secret); secretEnv[secret] = name; }
          const scope = (options as RuntimeExecuteOptions & { taskScope?: TaskRuntimeScope }).taskScope;
          const prepared = scope ? await taskSecretEnvironment(scope, this.context) : undefined;
          if (prepared) { Object.assign(env, prepared.env); Object.assign(secretEnv, prepared.secretEnv); }
          if (stopReason) return;
          const created = await this.connector.create({ env, timeoutMs });
          // Cancellation can win while provisioning; never leak a late sandbox.
          if (stopReason) { await destroy(created); return; }
          sandbox = created;
          const request: WorkerRequest = { version: 1, taskId, ir: this.context.ir, agentName, prompt,
            repository: this.config.repository, ref: this.config.ref, timeoutMs, plugins: this.config.workerPlugins,
            taskScope: prepared?.task, secretEnv };
          const requestPath = `/tmp/harnessfile-${randomUUID()}.json`;
          await sandbox.writeFile(requestPath, JSON.stringify(request));
          if (stopReason) return;
          const decoder = new WorkerDecoder(message => {
            if (stopReason) return;
            if (message.type === "event") emit(message.event);
            else result = message.result;
          });
          let rejectProtocol!: (error: unknown) => void;
          const protocolFailure = new Promise<never>((_resolve, reject) => { rejectProtocol = reject; });
          const exitCode = await Promise.race([
            sandbox.run([...this.config.workerCommand, requestPath], chunk => {
              // Some SDKs invoke callbacks from socket events outside their promise chain.
              // Never let invalid remote output become an uncaught host exception.
              try { decoder.push(chunk); } catch (error) { rejectProtocol(error); }
            }, () => {
              // SDK stderr can contain commands or credentials. Never forward it to persisted logs.
            }),
            protocolFailure,
          ]);
          decoder.end();
          if (exitCode !== 0 && result?.status === "completed") throw new Error("Remote worker exited unsuccessfully");
        };
        const operation = work();
        this.background.add(operation);
        void operation.finally(() => this.background.delete(operation)).catch(() => {});
        await Promise.race([operation, stopped]);
      } catch {
        // Provider errors may contain authorization headers, command payloads, or tokens.
        result = { status: "failed", output: "", error: "Remote execution failed during provisioning, transport, or worker protocol handling. Verify the configured image, worker, SDK, and credentials.", durationMs: Date.now() - startedAt };
      } finally {
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", onAbort);
        if (sandbox) await destroy(sandbox);
        const finalResult: RuntimeTaskResult = stopReason
          ? { status: stopReason, output: "", durationMs: Date.now() - startedAt }
          : result ?? { status: "failed", output: "", error: "Remote worker returned no result", durationMs: Date.now() - startedAt };
        // A destroyed sandbox cannot satisfy the local resume identity contract.
        delete finalResult.resume;
        finalResult.metadata = { ...finalResult.metadata, executionProvider: this.provider.type, sandboxId: sandbox?.id,
          ...(cleanupError ? { cleanupFailed: true } : {}) };
        if (cleanupError) emit({ type: "warning", content: "Sandbox cleanup failed; check the provider console. The configured lifetime remains the fallback." });
        emit({ type: "status", status: finalResult.status });
        controller.complete(finalResult);
        this.sessions.delete(session);
      }
    })();
    return session;
  }

  async execute(agentName: string, prompt: string, options?: RuntimeExecuteOptions): Promise<RuntimeTaskResult> {
    const session = await this.start(agentName, prompt, options);
    for await (const _event of session.events) { /* Drain events for bounded buffering. */ }
    return session.result;
  }

  async close(): Promise<void> {
    this.closed = true;
    await Promise.all([...this.sessions].map(async session => { await session.cancel(); await session.result; }));
    // Keep SDK clients alive until late provisioning has been cleaned up.
    await Promise.allSettled([...this.background]);
    await this.connector.close?.();
    if (this.cleanupFailures.size) throw new Error(`Failed to clean up ${this.cleanupFailures.size} remote sandbox(s); check the provider console.`);
  }
}

/** Used by adapters whose process API accepts a shell command. */
export function commandString(argv: string[]): string { return argv.map(shellQuote).join(" "); }
