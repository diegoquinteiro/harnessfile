import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { executeWorker } from "../src/services/execution/worker.js";
import type { WorkerMessage } from "../src/services/execution/protocol.js";

const exec = promisify(execFile);
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

describe("remote worker bridge", () => {
  it("runs an installed protocol plugin and exports committed and untracked changes against the original checkout", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "harnessfile-worker-test-")); directories.push(workspace);
    await exec("git", ["init", workspace]);
    const git = (args: string[]) => exec("git", ["-c", "user.name=Worker Test", "-c", "user.email=worker@example.test", ...args], { cwd: workspace });
    await writeFile(join(workspace, "file.txt"), "before\n");
    await git(["add", "."]); await git(["commit", "-m", "Initial commit"]);
    const baseCommit = (await git(["rev-parse", "HEAD"])).stdout.trim();
    const plugins = await mkdtemp(join(tmpdir(), "harnessfile-worker-plugins-")); directories.push(plugins);
    const pluginPath = join(plugins, "fixture.mjs");
    await writeFile(pluginPath, `
      import { writeFile } from 'node:fs/promises';
      import { execFile } from 'node:child_process';
      import { promisify } from 'node:util';
      import { join } from 'node:path';
      const exec = promisify(execFile);
      export default { apiVersion: 1, register(registry) {
        registry.registerRuntime({
          protocol: 'fixture/v1', defaultCommand: process.execPath,
          async probe() { return { protocol: 'fixture/v1', command: process.execPath, streaming: true, resume: false, cancel: true, structuredEvents: ['text'] }; },
          async start(task) {
            await writeFile(join(task.workspaceRoot, 'file.txt'), 'committed change\\n');
            const opts = { cwd: task.workspaceRoot };
            await exec('git', ['add', '.'], opts);
            await exec('git', ['-c', 'user.name=Worker Test', '-c', 'user.email=worker@example.test', 'commit', '-m', 'Agent commit'], opts);
            await writeFile(join(task.workspaceRoot, 'new.txt'), 'untracked change\\n');
            return { taskId: task.taskId, instance: task.instance,
              events: (async function* () { yield { type: 'text', content: task.prompt }; })(),
              result: Promise.resolve({ status: 'completed', output: task.agent.instructions, durationMs: 1 }), cancel: async () => {} };
          }
        });
      } };
    `);
    const messages: WorkerMessage[] = [];
    await executeWorker({ version: 1, taskId: "task", agentName: "coder", prompt: "user request", repository: "https://example.test/repo.git", timeoutMs: 5000,
      ir: { version: "0.2", agents: { coder: { runtime: "test", instructions: "role instructions" } }, runtimes: { test: { protocol: "fixture/v1" } } }, plugins: [pluginPath] }, workspace, message => messages.push(message));
    expect(messages[0]).toEqual({ version: 1, type: "event", event: { type: "text", content: "user request" } });
    const last = messages.at(-1)!;
    expect(last.type).toBe("result");
    if (last.type !== "result") throw new Error("Missing result");
    expect(last.result).toMatchObject({ status: "completed", output: "role instructions", metadata: { workspaceBaseCommit: baseCommit } });
    expect(last.result.metadata?.workspacePatch).toContain("+committed change");
    expect(last.result.metadata?.workspacePatch).toContain("+untracked change");
    expect(last.result.resume).toBeUndefined();
  });
});
