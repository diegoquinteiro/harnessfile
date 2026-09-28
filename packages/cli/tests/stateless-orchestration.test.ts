import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { StatelessLangGraphProvider } from "../src/providers/langgraph-stateless/index.js";
import { FilesystemTaskMemory } from "../src/services/task-memory/filesystem.js";
import { canonicalTaskKey } from "../src/services/task-memory/key.js";
import type { Harnessfile } from "../src/ir/types.js";
import type { DetachedTask } from "../src/services/execution/detached.js";
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
const task = { id: "42", key: canonicalTaskKey("gitlab/v1", "https://gitlab.com/api/v4", "team/repo", "42") };
const ir: Harnessfile = {
  version: "0.2", agents: { engineer: { runtime: "coding", instructions: "Implement" }, reviewer: { runtime: "coding", instructions: "Review" } },
  runtimes: { coding: { protocol: "claude-code/v1" } },
  orchestration: { provider: "langgraph-stateless/v1" }, taskMemory: { provider: { type: "filesystem/v1", path: ".state" } },
  steps: { build: { type: "agent", agent: "engineer", next: "review" }, review: { type: "agent", agent: "reviewer" } },
};
async function fixture(definition = ir) {
  const root = await mkdtemp(join(tmpdir(), "hf-stateless-")); roots.push(root);
  const memory = new FilesystemTaskMemory({ type: "filesystem/v1", path: root }, { workspaceRoot: root });
  const submissions: DetachedTask[] = [];
  const detached = { async submit(value: DetachedTask) { submissions.push(value); return { id: value.id, provider: "fake/v1", state: "accepted" as const }; } };
  const compile = () => new StatelessLangGraphProvider().compile(definition, { taskMemory: memory, detachedExecution: detached, runtimeExecutor: {} as any });
  async function complete(value: DetachedTask, output: string) {
    await memory.publishHandoff(task, { id: value.id, dispatchId: value.id, runId: task.key, step: value.context.step, agent: value.agent,
      status: "completed", summary: output, createdAt: new Date().toISOString(), result: { status: "completed", output, durationMs: 1 } });
  }
  return { memory, submissions, compile, complete };
}
describe("stateless orchestration", () => {
  it("survives fresh hosts between agents and passes the result to the reviewer", async () => {
    const f = await fixture(); const first = await f.compile();
    expect((await (await first.createRun({ task, prompt: "Implement feature" })).result).status).toBe("suspended");
    expect(f.submissions).toHaveLength(1); await first.shutdown();
    await f.complete(f.submissions[0], "Implementation at commit abc123; tests pass");
    const second = await f.compile(); const result = await (await second.resumeRun(task.key, { task })).result;
    expect(result.status).toBe("suspended"); expect(f.submissions).toHaveLength(2);
    expect(f.submissions[1].agent).toBe("reviewer"); expect(f.submissions[1].prompt).toContain("abc123");
    await second.shutdown(); await f.complete(f.submissions[1], "Approved");
    const third = await f.compile();
    expect((await (await third.resumeRun(task.key, { task })).result).status).toBe("completed");
    expect((await (await third.createRun({ task, prompt: "duplicate event" })).result).status).toBe("completed");
    expect(f.submissions).toHaveLength(2); await third.shutdown();
  });
  it("replays the same durable dispatch after uncertain submission without changing its deadline", async () => {
    const f = await fixture(); const first = await f.compile();
    await (await first.createRun({ task })).result; await first.shutdown();
    const second = await f.compile(); await (await second.createRun({ task })).result;
    expect(f.submissions[1]).toEqual(f.submissions[0]);
  });
  it("serializes overlapping invocations using task-memory CAS", async () => {
    const f = await fixture(); const a = await f.compile(); const b = await f.compile();
    const results = await Promise.allSettled([(await a.createRun({ task })).result, (await b.createRun({ task })).result]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1); expect(f.submissions).toHaveLength(1);
  });
  it("rejects fan-out instead of resuming the wrong interrupted task", () => {
    const definition = structuredClone(ir); definition.steps!.build.next = ["review", "other"];
    expect(new StatelessLangGraphProvider().validate(definition).errors.some(e => e.path.endsWith(".next"))).toBe(true);
  });
  it("requires provider-scoped keys and prevents resuming under a changed definition", async () => {
    const f = await fixture(); const a = await f.compile();
    await expect(a.createRun({ task: { id: "42" } })).rejects.toThrow("canonical");
    await (await a.createRun({ task })).result;
    const changed = structuredClone(ir); changed.agents.engineer.instructions = "Different instructions";
    const b = await new StatelessLangGraphProvider().compile(changed, { taskMemory: f.memory, detachedExecution: { async submit() { throw new Error("must not dispatch"); } }, runtimeExecutor: {} as any });
    await expect((await b.resumeRun(task.key, { task })).result).rejects.toThrow("different harness");
  });
  it("restores every leader/member interruption inside a squad node", async () => {
    const definition = structuredClone(ir);
    definition.steps = { delivery: { type: "squad", squad: "team" } };
    definition.squads = { team: { leader: "engineer", members: [{ agent: "engineer" }, { agent: "reviewer" }], instructions: "Delegate a review" } };
    const f = await fixture(definition);
    const replies = [JSON.stringify({ action: "dispatch", member: "reviewer", instruction: "Review commit abc" }), "Review complete", JSON.stringify({ action: "done", summary: "Delivered" })];
    for (let n = 0; n < replies.length; n++) {
      const host = await f.compile();
      const result = await (await host.createRun({ task, prompt: "Ship it" })).result;
      expect(result.status, JSON.stringify({ n, result, agents: f.submissions.map(d => d.agent) })).toBe("suspended");
      expect(f.submissions).toHaveLength(n + 1);
      await host.shutdown();
      await f.complete(f.submissions[n], replies[n]);
    }
    const last = await f.compile();
    expect((await (await last.resumeRun(task.key, {})).result).status).toBe("completed");
    expect(f.submissions.map(d => d.agent)).toEqual(["engineer", "reviewer", "engineer"]);
    expect(f.submissions[2].prompt).toContain("Review complete");
  });
  it("times out an abandoned dispatch on reconciliation without re-executing it", async () => {
    const f = await fixture(); const first = await f.compile();
    await (await first.createRun({ task })).result; await first.shutdown();
    const state = await f.memory.read(task);
    const checkpoint = state.checkpoint!;
    (checkpoint.pending as DetachedTask).deadlineAt = new Date(Date.now() - 1000).toISOString();
    await f.memory.compareAndSwap(task, state.revision, checkpoint);
    const second = await f.compile();
    expect((await (await second.resumeRun(task.key, {})).result).status).toBe("failed");
    expect(f.submissions).toHaveLength(1);
  });
  it("persists gate suspension and accepts only explicit approval", async () => {
    const definition = structuredClone(ir);
    definition.steps = { approval: { type: "gate", next: "build" }, build: { type: "agent", agent: "engineer" } };
    const f = await fixture(definition); const first = await f.compile();
    const gate = await (await first.createRun({ task })).result;
    expect(gate.suspendedAt).toBe("approval");
    await first.shutdown(); const second = await f.compile();
    expect((await (await second.resumeRun(task.key, {})).result).status).toBe("suspended");
    expect(f.submissions).toHaveLength(0);
    expect((await (await second.resumeRun(task.key, { approval: { approved: true, resumeToken: gate.resumeToken } })).result).status).toBe("suspended");
    expect(f.submissions).toHaveLength(1);
  });

  it("binds approval to an interruption and durably consumes event IDs", async () => {
    const definition = structuredClone(ir);
    definition.steps = { first: { type: "gate", next: "second" }, second: { type: "gate", next: "build" }, build: { type: "agent", agent: "engineer" } };
    const f = await fixture(definition); const a = await f.compile();
    const gate = await (await a.createRun({ task, eventId: "opened" })).result;
    const approval = { eventId: "approve-first", approval: { approved: true, resumeToken: gate.resumeToken } };
    const second = await (await a.resumeRun(task.key, approval)).result;
    expect(second.suspendedAt).toBe("second");
    await a.shutdown(); const b = await f.compile();
    expect(await (await b.resumeRun(task.key, approval)).result).toEqual(second);
    expect(f.submissions).toHaveLength(0);
    await expect((await b.resumeRun(task.key, { ...approval, eventId: "replayed-with-new-id" })).result).rejects.toThrow("resumeToken");
    await (await b.resumeRun(task.key, { eventId: "approve-second", approval: { approved: true, resumeToken: second.resumeToken } })).result;
    expect(f.submissions).toHaveLength(1);
    const redelivery = await (await b.resumeRun(task.key, approval)).result;
    expect(redelivery.status).toBe("suspended");
    expect(redelivery.resumeToken).toBeUndefined();
    expect(redelivery.suspendedAt).toBe("build");
    expect(new Set(f.submissions.map(dispatch => dispatch.id)).size).toBe(1);
  });

});
