import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import type { RunManager } from "./run-manager.js";
import { logInfo, logError } from "./logger.js";

// HTTP endpoint for resolving gates (human approval).
// Listens for POST /gate/:threadId to resume suspended runs.

export interface GateResolverOptions {
  port?: number;
}

export class GateResolver {
  private server: Server | null = null;

  constructor(private runManager: RunManager) {}

  async start(options: GateResolverOptions = {}): Promise<void> {
    const port = options.port ?? 8081;

    this.server = createServer((req, res) => {
      this.handleRequest(req, res);
    });

    await new Promise<void>((resolve) => {
      this.server!.listen(port, () => {
        logInfo(`Gate resolver on port ${port}`);
        logInfo(`  POST /gate/:threadId — resume a suspended run`);
        logInfo(`  GET  /runs — list all runs`);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    if (this.server) {
      await new Promise<void>((resolve, reject) => {
        this.server!.close((err) => (err ? reject(err) : resolve()));
      });
      this.server = null;
    }
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? "/", `http://localhost`);

    if (req.method === "POST" && url.pathname.startsWith("/gate/")) {
      const threadId = url.pathname.slice("/gate/".length);
      this.handleGateApproval(threadId, req, res);
      return;
    }

    if (req.method === "GET" && url.pathname === "/runs") {
      this.handleListRuns(res);
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  }

  private handleGateApproval(
    threadId: string,
    req: IncomingMessage,
    res: ServerResponse,
  ): void {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      try {
        const input = body ? JSON.parse(body) : { approved: true };
        const handle = await this.runManager.resumeRun(threadId, input);

        res.writeHead(202, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            threadId: handle.threadId,
            status: "resumed",
          }),
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        logError(`Gate resume error for ${threadId.slice(0, 8)}: ${message}`);
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: message }));
      }
    });
  }

  private async handleListRuns(res: ServerResponse): Promise<void> {
    try {
      const runs = await this.runManager.listRuns();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ runs }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: message }));
    }
  }
}
