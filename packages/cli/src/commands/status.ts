import { logInfo, logError } from "../runtime/logger.js";

export interface StatusOptions {
  port?: string;
}

export async function status(options: StatusOptions): Promise<void> {
  const port = options.port ? parseInt(options.port, 10) : 8081;

  try {
    const res = await fetch(`http://localhost:${port}/runs`);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const data = (await res.json()) as { runs: Array<{ threadId: string; status: string; startedAt: string; suspendedAt?: string }> };

    if (data.runs.length === 0) {
      logInfo("No runs");
      return;
    }

    console.log("\n  Runs:");
    for (const run of data.runs) {
      const thread = run.threadId.slice(0, 8);
      const status = run.status.padEnd(10);
      const suspended = run.suspendedAt
        ? ` (suspended at ${run.suspendedAt})`
        : "";
      console.log(`    ${thread}  ${status}${suspended}`);
    }
    console.log();
  } catch {
    logError(
      `Cannot connect to harness server on port ${port}. Is it running?`,
    );
    process.exit(1);
  }
}
