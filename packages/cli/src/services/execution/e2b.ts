import type { ProviderRef } from "../../ir/types.js";
import type { FactoryContext } from "../contracts.js";
import { commandString, RemoteExecutionEnvironment, remoteConfig } from "./remote.js";
import { credential, optionalSdk, stringOption } from "./sdk.js";

export interface E2bSdk {
  Sandbox: { create(template: string, options: Record<string, unknown>): Promise<{
    sandboxId: string;
    files: { write(path: string, contents: string): Promise<unknown> };
    commands: { run(command: string, options: { timeoutMs: number; onStdout: (chunk: string) => void; onStderr: (chunk: string) => void }): Promise<{ exitCode: number }> };
    kill(): Promise<boolean>;
  }> };
}

export async function createE2bExecution(ref: ProviderRef, context: FactoryContext, sdk?: E2bSdk) {
  remoteConfig(ref);
  const template = stringOption(ref, "template");
  const module = sdk ?? await optionalSdk<E2bSdk>("e2b", context.workspaceRoot);
  const apiKey = await credential(context, ref, "apiKeySecret", "E2B_API_KEY");
  return new RemoteExecutionEnvironment(ref, context, {
    async create({ env, timeoutMs }) {
      const sandbox = await module.Sandbox.create(template, { apiKey, envs: env, timeoutMs, requestTimeoutMs: 60_000 });
      return {
        id: sandbox.sandboxId,
        async writeFile(path, contents) { await sandbox.files.write(path, contents); },
        async run(command, onStdout, onStderr) {
          try { return (await sandbox.commands.run(commandString(command), { timeoutMs, onStdout, onStderr })).exitCode; }
          catch (error) {
            // E2B rejects nonzero exits, including workers returning a structured failure.
            if (error && typeof error === "object" && "exitCode" in error && typeof error.exitCode === "number") return error.exitCode;
            throw error;
          }
        },
        async destroy() { await sandbox.kill(); },
      };
    },
  });
}
