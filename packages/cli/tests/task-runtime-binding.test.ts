import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { RuntimeDispatcher } from "../src/agent-runtimes/dispatcher.js";
import { TaskExecutor } from "../src/services/task-executor.js";
import { canonicalTaskKey } from "../src/services/task-memory/key.js";
import type { AgentRuntimeDriver } from "../src/agent-runtimes/interface.js";
import type { FactoryContext, ProjectManagementService } from "../src/services/contracts.js";
import type { Harnessfile } from "../src/ir/types.js";

it("injects the selected task account and tools into a continuous local runtime and cleans its scope", async () => {
  const root = await mkdtemp(join(tmpdir(), "hf-binding-"));
  let scopePath = "";
  const ir: Harnessfile = { version: "0.2", agents: { engineer: { instructions: "Implement carefully", runtime: "fake" } }, runtimes: { fake: { protocol: "fake/v1" } },
    projectManagement: { provider: { type: "gitlab/v1", project: "org/repo" } },
    identity: { provider: { type: "gitlab-service-account/v1", default: { tokenSecret: "DEFAULT_TOKEN", subject: "coordinator" }, agents: { engineer: { tokenSecret: "ENGINEER_TOKEN", subject: "engineer-account" }, reviewer: { tokenSecret: "REVIEW_TOKEN", subject: "reviewer-account" } } } },
  };
  const context: FactoryContext = { ir, workspaceRoot: root, drivers: [], async secret(name) { expect(name).toBe("ENGINEER_TOKEN"); return "private-engineer-token"; } };
  const driver: AgentRuntimeDriver = {
    protocol: "fake/v1", defaultCommand: "node",
    async probe() { return { protocol: "fake/v1", command: "node", streaming: true, resume: false, cancel: true, structuredEvents: [] }; },
    async start(task) {
      scopePath = task.env!.HARNESSFILE_TASK_SCOPE_FILE!;
      const file = await readFile(scopePath, "utf8");
      expect(file).not.toContain("private-engineer-token");
      // The selected delivery mapping excludes other agents, while the portable IR stays unchanged.
      const delivery = JSON.parse(file).taskScope.delivery;
      expect(delivery.identity.provider.agents).toEqual({ engineer: { tokenSecret: "ENGINEER_TOKEN", subject: "engineer-account" } });
      expect(Object.values(task.env!)).toContain("private-engineer-token");
      expect(task.agent.instructions).toContain("harnessfile-task tools");
      expect(task.prompt).toContain("https://gitlab.com/org/repo/-/issues/42");
      return { taskId: task.taskId, instance: task.instance, async cancel() {}, events: { async *[Symbol.asyncIterator]() {} }, result: Promise.resolve({ status: "completed", output: "Done", durationMs: 1 }) };
    },
  };
  const board: ProjectManagementService = {
    capabilities: { agentTools: true },
    async createTask() { return { id: "42", key: canonicalTaskKey("gitlab/v1", "https://gitlab.com/api/v4", "org/repo", "42"), url: "https://gitlab.com/org/repo/-/issues/42" }; },
    async updateTask() {}, async comment() {},
  };
  const runtime = new RuntimeDispatcher(ir, { workspaceRoot: root, drivers: [driver], context });
  const executor = new TaskExecutor(runtime, board, { async resolve() { return { subject: "engineer-account" }; } }, "gitlab/v1", context);
  try {
    expect((await executor.execute("engineer", "Implement", { context: { runId: "run", step: "implement" } })).status).toBe("completed");
    await expect(stat(scopePath)).rejects.toThrow();
    expect(ir.agents.engineer.instructions).toBe("Implement carefully");
  } finally { await executor.close(); await runtime.close(); await rm(root, { recursive: true, force: true }); }
});
