import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import type { Harnessfile } from "../ir/types.js";
import type { RunManager } from "./run-manager.js";
import { cronMatches, minuteKey } from "./cron.js";
import { logInfo, logError } from "./logger.js";

// Starts listeners for each trigger step in the harness:
//   - webhook/provider triggers → HTTP server (POST /trigger/<name>)
//   - scheduled triggers (cron) → in-process scheduler checked every 30s
//   - no triggers at all → immediate single run

const SCHEDULER_INTERVAL_MS = 30_000;

export interface TriggerListenerOptions {
  port?: number;
}

interface WebhookTrigger {
  event: string;
  filter?: string;
}

interface ScheduledTrigger {
  schedule: string;
  timezone?: string;
  prompt?: string;
}

export class TriggerListener {
  private server: Server | null = null;
  private schedulerTimer: NodeJS.Timeout | null = null;
  private triggers: Map<string, WebhookTrigger> = new Map();
  private scheduled: Map<string, ScheduledTrigger> = new Map();
  private lastFired: Map<string, string> = new Map();

  constructor(
    private ir: Harnessfile,
    private runManager: RunManager,
  ) {
    // Collect trigger steps
    if (ir.steps) {
      for (const [name, step] of Object.entries(ir.steps)) {
        if (step.type !== "trigger") continue;
        if (step.schedule) {
          this.scheduled.set(name, {
            schedule: step.schedule,
            timezone: step.timezone,
            prompt: step.prompt,
          });
        } else {
          this.triggers.set(name, {
            event: step.event ?? "webhook",
            filter: step.filter,
          });
        }
      }
    }
  }

  hasTriggers(): boolean {
    return this.triggers.size > 0 || this.scheduled.size > 0;
  }

  async start(options: TriggerListenerOptions = {}): Promise<void> {
    if (!this.hasTriggers()) {
      // No triggers — run once immediately
      logInfo("No triggers defined — running harness once");
      const handle = await this.runManager.startRun({});
      const result = await handle.result;
      if (result.status === "failed") {
        logError(`Run failed: ${result.error}`);
      }
      return;
    }

    if (this.scheduled.size > 0) {
      this.startScheduler();
    }

    if (this.triggers.size > 0) {
      const port = options.port ?? 8080;
      await this.startHttpServer(port);
    }
  }

  async stop(): Promise<void> {
    if (this.schedulerTimer) {
      clearInterval(this.schedulerTimer);
      this.schedulerTimer = null;
    }
    if (this.server) {
      await new Promise<void>((resolve, reject) => {
        this.server!.close((err) => (err ? reject(err) : resolve()));
      });
      this.server = null;
    }
  }

  // ---- Scheduled triggers ----

  private startScheduler(): void {
    for (const [name, trigger] of this.scheduled) {
      logInfo(
        `Scheduled trigger '${name}': ${trigger.schedule}${trigger.timezone ? ` (${trigger.timezone})` : ""}`,
      );
    }
    this.schedulerTimer = setInterval(() => {
      void this.checkScheduledTriggers();
    }, SCHEDULER_INTERVAL_MS);
  }

  /**
   * Fires any scheduled trigger whose cron expression matches `now` and that has
   * not already fired this minute. Exposed for tests (injectable clock).
   */
  async checkScheduledTriggers(now: Date = new Date()): Promise<string[]> {
    const fired: string[] = [];
    for (const [name, trigger] of this.scheduled) {
      let matches: boolean;
      try {
        matches = cronMatches(trigger.schedule, now, trigger.timezone);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logError(`Scheduled trigger '${name}': ${message}`);
        continue;
      }
      if (!matches) continue;

      const key = minuteKey(now, trigger.timezone);
      if (this.lastFired.get(name) === key) continue;
      this.lastFired.set(name, key);

      fired.push(name);
      logInfo(`Scheduled trigger '${name}' fired (${trigger.schedule})`);
      try {
        await this.runManager.startRun({
          prompt: trigger.prompt ?? "",
          scheduled: true,
          trigger: name,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logError(`Scheduled trigger '${name}' error: ${message}`);
      }
    }
    return fired;
  }

  // ---- Webhook triggers ----

  private async startHttpServer(port: number): Promise<void> {
    this.server = createServer((req, res) => {
      this.handleRequest(req, res);
    });

    await new Promise<void>((resolve) => {
      this.server!.listen(port, () => {
        logInfo(`Webhook listener on port ${port}`);
        for (const [name, trigger] of this.triggers) {
          logInfo(`  POST /trigger/${name} (${trigger.event})`);
        }
        resolve();
      });
    });
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? "/", `http://localhost`);

    if (req.method === "POST" && url.pathname.startsWith("/trigger/")) {
      const triggerName = url.pathname.slice("/trigger/".length);
      this.handleTrigger(triggerName, req, res);
      return;
    }

    // Gate endpoint is handled by GateResolver, but if it hits here, 404
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  }

  private handleTrigger(
    triggerName: string,
    req: IncomingMessage,
    res: ServerResponse,
  ): void {
    if (!this.triggers.has(triggerName)) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: `Unknown trigger '${triggerName}'`,
          available: [...this.triggers.keys()],
        }),
      );
      return;
    }

    // Read request body
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      try {
        const input = body ? JSON.parse(body) : {};
        const handle = await this.runManager.startRun(input);

        res.writeHead(202, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            threadId: handle.threadId,
            status: "started",
          }),
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        logError(`Trigger '${triggerName}' error: ${message}`);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: message }));
      }
    });
  }
}
