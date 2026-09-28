import type { ProviderRef } from "../../ir/types.js";
import type { FactoryContext } from "../contracts.js";
import { RemoteExecutionEnvironment, remoteConfig, type SandboxConnector } from "./remote.js";
import { credential, optionalSdk, stringOption } from "./sdk.js";

interface ModalProcess { stdout: AsyncIterable<string>; stderr: AsyncIterable<string>; wait(): Promise<number> }
interface ModalSandbox {
  sandboxId: string;
  exec(command: string[], params?: Record<string, unknown>): Promise<ModalProcess>;
  terminate(): Promise<void>;
}
export interface ModalSdk {
  ModalClient: new (options: Record<string, unknown>) => {
    apps: { fromName(name: string, options: { createIfMissing: boolean }): Promise<unknown> };
    images: { fromRegistry(name: string): unknown };
    sandboxes: { create(app: unknown, image: unknown, options: Record<string, unknown>): Promise<ModalSandbox> };
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
  try { return new RemoteExecutionEnvironment(ref, context, connector); }
  catch (error) { client.close(); throw error; }
}
