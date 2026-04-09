import { HarnessServer } from "../runtime/server.js";
import { logError } from "../runtime/logger.js";

export interface UpOptions {
  provider?: string;
  port?: string;
  gatePort?: string;
  watch?: boolean;
  checkpointer?: string;
}

export async function up(file: string | undefined, options: UpOptions): Promise<void> {
  const server = new HarnessServer();

  try {
    await server.start({
      file,
      provider: options.provider,
      port: options.port ? parseInt(options.port, 10) : undefined,
      gatePort: options.gatePort ? parseInt(options.gatePort, 10) : undefined,
      watch: options.watch,
      checkpointer: (options.checkpointer as "memory" | "sqlite") ?? "memory",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logError(message);
    process.exit(1);
  }
}
