import { randomUUID } from "node:crypto";
import type { ProviderRef } from "../../ir/types.js";
import type { FactoryContext } from "../contracts.js";
import { commandString, RemoteExecutionEnvironment, remoteConfig } from "./remote.js";
import { credential, optionalSdk, stringOption } from "./sdk.js";

export interface DaytonaSandbox {
  id: string;
  fs: { uploadFile(contents: Buffer, path: string): Promise<void> };
  process: {
    createSession(id: string): Promise<void>;
    executeSessionCommand(id: string, request: { command: string; runAsync: boolean; suppressInputEcho: boolean }): Promise<{ cmdId?: string }>;
    getSessionCommandLogs(id: string, commandId: string, stdout: (chunk: string) => void, stderr: (chunk: string) => void): Promise<void>;
    getSessionCommand(id: string, commandId: string): Promise<{ exitCode?: number }>;
  };
}
export interface DaytonaSdk {
  Daytona: new (options: Record<string, unknown>) => {
    create(options: Record<string, unknown>, timeout: { timeout: number }): Promise<DaytonaSandbox>;
    delete(sandbox: DaytonaSandbox, timeout?: number, wait?: boolean): Promise<void>;
    [Symbol.asyncDispose]?(): Promise<void>;
  };
}

export async function createDaytonaExecution(ref: ProviderRef, context: FactoryContext, sdk?: DaytonaSdk) {
  remoteConfig(ref);
  const snapshot = stringOption(ref, "snapshot");
  const module = sdk ?? await optionalSdk<DaytonaSdk>("@daytona/sdk", context.workspaceRoot);
  const client = new module.Daytona({ apiKey: await credential(context, ref, "apiKeySecret", "DAYTONA_API_KEY"), requestTimeoutMs: 60_000,
    ...(ref.apiUrl ? { apiUrl: stringOption(ref, "apiUrl") } : {}), ...(ref.target ? { target: stringOption(ref, "target") } : {}) });
  return new RemoteExecutionEnvironment(ref, context, {
    async create({ env, timeoutMs }) {
      const sandbox = await client.create({ snapshot, envVars: env, ephemeral: true, autoStopInterval: Math.max(1, Math.ceil(timeoutMs / 60_000)),
        ttlMinutes: Math.max(1, Math.ceil(timeoutMs / 60_000)) }, { timeout: 60 });
      return {
        id: sandbox.id,
        writeFile: (path, contents) => sandbox.fs.uploadFile(Buffer.from(contents), path),
        async run(command, stdout, stderr) {
          const session = `harnessfile-${randomUUID()}`;
          await sandbox.process.createSession(session);
          const result = await sandbox.process.executeSessionCommand(session, { command: commandString(command), runAsync: true, suppressInputEcho: true });
          if (!result.cmdId) throw new Error("Daytona returned no command ID");
          await sandbox.process.getSessionCommandLogs(session, result.cmdId, stdout, stderr);
          const completed = await sandbox.process.getSessionCommand(session, result.cmdId);
          if (completed.exitCode === undefined) throw new Error("Daytona stream ended before command completion");
          return completed.exitCode;
        },
        destroy: () => client.delete(sandbox, 60, true),
      };
    },
    async close() { await client[Symbol.asyncDispose]?.(); },
  });
}
