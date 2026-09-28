import type { ProviderRef } from "../../ir/types.js";
import type { FactoryContext } from "../contracts.js";
import { RemoteExecutionEnvironment, remoteConfig, type SandboxConnector } from "./remote.js";
import { credential, optionalSdk, stringOption } from "./sdk.js";
import { createHash } from "node:crypto";
import type { DetachedTask, DetachedReceipt } from "./detached.js";
import type { WorkerRequest } from "./protocol.js";
import { loadTaskServices, taskSecretEnvironment } from "./task-services.js";
import { providerConfig } from "../registry.js";

interface ModalProcess { stdout: AsyncIterable<string>; stderr: AsyncIterable<string>; wait(): Promise<number> }
interface ModalSandbox {
  sandboxId: string;
  exec(command: string[], params?: Record<string, unknown>): Promise<ModalProcess>;
  terminate(): Promise<void>;
  detach?(): void;
}
export interface ModalSdk {
  ModalClient: new (options: Record<string, unknown>) => {
    apps: { fromName(name: string, options: { createIfMissing: boolean }): Promise<unknown> };
    images: { fromRegistry(name: string): unknown };
    sandboxes: { create(app: unknown, image: unknown, options: Record<string, unknown>): Promise<ModalSandbox>; fromName?(app: string, name: string): Promise<ModalSandbox> };
    close(): void;
  };
}

export async function createModalExecution(ref: ProviderRef, context: FactoryContext, sdk?: ModalSdk) {
  remoteConfig(ref);
  const imageName = stringOption(ref, "image");
  const module = sdk ?? await optionalSdk<ModalSdk>("modal", context.workspaceRoot);
  const client = new module.ModalClient({
    tokenId: await credential(context, ref, "tokenIdSecret", "MODAL_TOKEN_ID"),
    tokenSecret: await credential(context, ref, "tokenSecretSecret", "MODAL_TOKEN_SECRET"),
    timeoutMs: 60_000,
  });
  const connector: SandboxConnector = {
    async create({ env, timeoutMs }) {
      const app = await client.apps.fromName(stringOption(ref, "app", "harnessfile"), { createIfMissing: true });
      const sandbox = await client.sandboxes.create(app, client.images.fromRegistry(imageName), { env, timeoutMs });
      const run = async (command: string[], stdout: (chunk: string) => void, stderr: (chunk: string) => void) => {
        const proc = await sandbox.exec(command, { timeoutMs });
        const read = async (stream: AsyncIterable<string>, consume: (chunk: string) => void) => { for await (const chunk of stream) consume(chunk); };
        const [, , code] = await Promise.all([read(proc.stdout, stdout), read(proc.stderr, stderr), proc.wait()]);
        return code;
      };
      return {
        id: sandbox.sandboxId,
        async writeFile(path, contents) {
          const code = await run(["node", "-e", "require('node:fs').writeFileSync(process.argv[1],Buffer.from(process.argv[2],'base64'),{mode:0o600})", path, Buffer.from(contents).toString("base64")], () => {}, () => {});
          if (code !== 0) throw new Error("Modal request upload failed");
        },
        run,
        destroy: () => sandbox.terminate(),
      };
    },
    async close() { client.close(); },
  };
  try {
    const environment = new RemoteExecutionEnvironment(ref, context, connector);
    return Object.assign(environment, { async submit(task: DetachedTask): Promise<DetachedReceipt> {
      const configuration = remoteConfig(ref);
      if (providerConfig(task.delivery.memory.provider).type === "filesystem/v1") throw new Error("Detached Modal workers require shared task memory; a host-local filesystem is not accessible in their sandbox");
      if (!task.id || !task.context.runId || !task.context.step || !context.ir.agents[task.agent]?.runtime) throw new Error("Invalid detached task identity or runtime profile");
      const deadline = Date.parse(task.deadlineAt);
      if (!Number.isFinite(deadline)) throw new Error("Detached task requires a stable absolute deadlineAt");
      const prepared = await taskSecretEnvironment(task, context);
      const services = await loadTaskServices(prepared.task, context);
      try {
        if (!services.memory) throw new Error("Detached execution requires durable task memory");
        const memory = await services.memory.read(task.delivery.task);
        if (memory.handoffs.some(h => h.dispatchId === task.id && h.runId === task.context.runId && h.agent === task.agent && h.step === task.context.step)) {
          return { id: task.id, provider: ref.type, state: "completed" };
        }
        const claims = memory.checkpoint?.workerClaims as Record<string, unknown> | undefined;
        const remaining = deadline - Date.now();
        if (remaining <= 0 || remaining > 86_400_000) throw new Error("Detached task deadline expired or exceeds 24 hours; reconcile it instead of dispatching again");
        if (!client.sandboxes.fromName) throw new Error("Installed Modal SDK does not support named sandbox reconciliation");
        const appName = stringOption(ref, "app", "harnessfile");
        const name = `hfd-${createHash("sha256").update(task.id).digest("hex").slice(0, 48)}`;
        const lookup = async () => {
          try { return await client.sandboxes.fromName!(appName, name); }
          catch (error) { if (error instanceof Error && error.name === "NotFoundError") return undefined; throw error; }
        };
        const receipt = (sandbox: ModalSandbox): DetachedReceipt => {
          const resourceId = sandbox.sandboxId; sandbox.detach?.();
          return { id: task.id, provider: ref.type, resourceId, state: "accepted" };
        };
        const existing = await lookup();
        if (existing) return receipt(existing);
        // A preempted claimed worker is never silently re-executed. The engine reconciles its deadline.
        if (claims?.[task.id]) return { id: task.id, provider: ref.type, state: "accepted" };
        const env = { ...prepared.env };
        const secretEnv = { ...prepared.secretEnv };
        for (const [variable, secret] of Object.entries(configuration.envSecrets)) { env[variable] = await context.secret(secret); secretEnv[secret] ??= variable; }
        const request: WorkerRequest = { version: 1, taskId: task.id, ir: context.ir, agentName: task.agent, prompt: task.prompt,
          repository: configuration.repository, ref: configuration.ref, timeoutMs: Math.max(1, remaining - 30_000), plugins: configuration.workerPlugins,
          detached: prepared.task, secretEnv };
        env.HARNESSFILE_DETACHED_REQUEST = Buffer.from(JSON.stringify(request)).toString("base64");
        // Creation starts the worker atomically: no accepted-sandbox / missing-exec crash gap.
        // A durable worker claim fences replay after this named sandbox has exited.
        const bootstrap = "const fs=require('node:fs');const cp=require('node:child_process');const p='/tmp/harnessfile-detached.json';fs.writeFileSync(p,Buffer.from(process.env.HARNESSFILE_DETACHED_REQUEST,'base64'),{mode:0o600});delete process.env.HARNESSFILE_DETACHED_REQUEST;const argv=JSON.parse(process.argv[1]);const child=cp.spawn(argv[0],[...argv.slice(1),p],{stdio:'ignore',env:process.env});child.on('error',()=>{process.exitCode=1});child.on('exit',code=>{process.exitCode=code??1});";
        const app = await client.apps.fromName(appName, { createIfMissing: true });
        try {
          const sandbox = await client.sandboxes.create(app, client.images.fromRegistry(imageName), {
            name, env, timeoutMs: Math.min(86_400_000, remaining + 60_000),
            command: ["node", "-e", bootstrap, JSON.stringify(configuration.workerCommand)],
          });
          return receipt(sandbox);
        } catch (error) {
          // Includes create success followed by transport failure and competing named creates.
          const recovered = await lookup(); if (recovered) return receipt(recovered); throw error;
        }
      } finally { await services.close(); }
    } });
  }
  catch (error) { client.close(); throw error; }
}
