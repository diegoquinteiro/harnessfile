import { mkdtemp, rm, readdir, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { canonicalTaskKey, FilesystemTaskMemory, GitHubTaskMemory, GitLabTaskMemory, TaskMemoryConflictError, taskReferenceFromKey } from "../src/services/task-memory/index.js";
import type { TaskCapabilityScope, TaskHandoff, TaskReference } from "../src/services/contracts.js";

const roots: string[] = [];
afterEach(async () => { for (const path of roots.splice(0)) await rm(path, { recursive: true, force: true }); });
const task: TaskReference = { id: "7", key: canonicalTaskKey("gitlab/v1", "https://gitlab.com/api/v4", "group/project", "7") };
const handoff = (id: string): TaskHandoff => ({ id, dispatchId: id, runId: task.key!, step: "build", agent: "engineer", status: "completed", summary: "Implemented the task", createdAt: "2026-01-01T00:00:00.000Z", result: { status: "completed", output: "Done", durationMs: 1 } });
const scope: TaskCapabilityScope = { task, dispatchId: "dispatch-1", runId: task.key!, step: "build", agent: "engineer", board: { provider: "gitlab/v1" }, memory: { provider: "filesystem/v1" } };
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });

async function filesystem() {
  const path = await mkdtemp(join(tmpdir(), "harness-task-memory-"));
  roots.push(path);
  const config = { type: "filesystem/v1", path, lockTimeoutMs: 100 };
  return { path, config, memory: new FilesystemTaskMemory(config, { workspaceRoot: path }) };
}

describe("canonical task identity", () => {
  it("separates providers, API hosts, projects and issues and restores the reference", () => {
    const keys = [
      canonicalTaskKey("gitlab/v1", "https://gitlab.com/api/v4", "one", "1"),
      canonicalTaskKey("gitlab/v1", "https://gitlab.com/api/v4", "two", "1"),
      canonicalTaskKey("gitlab/v1", "https://gitlab.example/api/v4", "one", "1"),
      canonicalTaskKey("github/v1", "https://gitlab.com/api/v4", "one", "1"),
      canonicalTaskKey("gitlab/v1", "https://gitlab.com/api/v4", "one", "2"),
    ];
    expect(new Set(keys).size).toBe(keys.length);
    expect(taskReferenceFromKey(keys[0])).toEqual({ id: "1", key: keys[0] });
    expect(canonicalTaskKey("github/v1", "https://api.github.com/", "ACME/App", "7")).toBe(canonicalTaskKey("github/v1", "https://api.github.com", "acme/app", "7"));
    expect(() => taskReferenceFromKey("7")).toThrow("canonical");
  });
});

describe("filesystem task memory", () => {
  it("survives fresh instances and rejects stale writes without losing a concurrent handoff", async () => {
    const { path, config, memory } = await filesystem();
    expect(await memory.read(task)).toEqual({ revision: null, handoffs: [] });
    const initial = await memory.compareAndSwap(task, null, { pendingDispatch: "a" });
    const other = new FilesystemTaskMemory(config, { workspaceRoot: path });
    expect((await other.read(task)).checkpoint).toEqual({ pendingDispatch: "a" });
    await other.publishHandoff(task, handoff("a"));
    await expect(memory.compareAndSwap(task, initial.revision, { pendingDispatch: "b" })).rejects.toBeInstanceOf(TaskMemoryConflictError);
    const current = await memory.read(task);
    const next = await memory.compareAndSwap(task, current.revision, { consumed: "a" });
    expect(next.handoffs).toEqual([handoff("a")]);
  });

  it("allows one winner among simultaneous CAS writers in independent instances", async () => {
    const { path, config } = await filesystem();
    const instances = Array.from({ length: 5 }, () => new FilesystemTaskMemory(config, { workspaceRoot: path }));
    const attempts = await Promise.allSettled(instances.map((memory, i) => memory.compareAndSwap(task, null, { winner: i })));
    expect(attempts.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((result) => result.status === "rejected").every((result) => result.reason instanceof TaskMemoryConflictError)).toBe(true);
    expect((await instances[0].read(task)).revision).not.toBeNull();
  });

  it("publishes distinct concurrent immutable handoffs without replacing the checkpoint", async () => {
    const { path, config, memory } = await filesystem();
    await memory.compareAndSwap(task, null, { pending: ["a", "b"] });
    const other = new FilesystemTaskMemory(config, { workspaceRoot: path });
    await Promise.all([memory.publishHandoff(task, handoff("a")), other.publishHandoff(task, handoff("b"))]);
    expect((await memory.read(task)).handoffs.map((value) => value.id).sort()).toEqual(["a", "b"]);
    expect((await memory.read(task)).checkpoint).toEqual({ pending: ["a", "b"] });
    await memory.publishHandoff(task, handoff("a"));
    await expect(memory.publishHandoff(task, { ...handoff("a"), summary: "Changed" })).rejects.toThrow("immutable");
    expect((await memory.read(task)).handoffs).toHaveLength(2);
  });

  it("does not steal an abandoned lock and never accepts an unscoped task reference", async () => {
    const { path, memory } = await filesystem();
    const snapshot = await memory.compareAndSwap(task, null, {});
    const filename = (await readdir(path)).find((name) => name.endsWith(".json"))!;
    await mkdir(join(path, `${filename}.lock`));
    await expect(memory.compareAndSwap(task, snapshot.revision, { changed: true })).rejects.toThrow("lock is busy");
    await expect(memory.read({ id: "7" })).rejects.toThrow("canonical task.key");
  });

  it("advertises scoped tools and prevents model input overriding task/agent/dispatch", async () => {
    const { memory } = await filesystem();
    expect(memory.capabilities.tools.map((tool) => tool.name)).toEqual(["task_memory_read", "task_memory_publish_handoff"]);
    const result = await memory.invokeTool("task_memory_publish_handoff", { status: "completed", summary: "Done" }, scope);
    expect(result).toMatchObject({ id: "dispatch-1", dispatchId: "dispatch-1", agent: "engineer", step: "build", runId: task.key });
    expect(await memory.invokeTool("task_memory_publish_handoff", { status: "completed", summary: "Done" }, scope)).toEqual(result);
    await expect(memory.invokeTool("task_memory_publish_handoff", { status: "completed", summary: "Done", agent: "someone-else" }, scope)).rejects.toThrow("cannot override");
    await expect(memory.invokeTool("task_memory_read", { taskId: "other" }, scope)).rejects.toThrow("no task override");
  });
});

function repositoryApi(github: boolean) {
  let stored: { content: string; revision: string } | undefined;
  let counter = 0;
  let loseResponse = false;
  let rejectNote = false;
  const notes: Array<{ body: string }> = [];
  const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const path = String(url);
    if (path.includes("/branches/")) return response({ name: "state" });
    if (path.includes("/notes") || path.includes("/comments")) {
      if (init!.method === "GET") return response(notes);
      if (rejectNote) { rejectNote = false; return response({}, 503); }
      notes.push(JSON.parse(init!.body as string));
      return response({ id: notes.length });
    }
    if (init!.method === "GET") return stored ? response({ content: stored.content, encoding: "base64", [github ? "sha" : "last_commit_id"]: stored.revision }) : response({}, 404);
    const body = JSON.parse(init!.body as string);
    const expected = github ? body.sha : body.last_commit_id;
    if ((stored?.revision ?? undefined) !== expected) return response({}, github ? 409 : 400);
    stored = { content: body.content, revision: `commit-${++counter}` };
    if (loseResponse) { loseResponse = false; throw new Error("Connection lost after commit"); }
    return response({ content: { sha: stored.revision } });
  });
  return { fetcher, notes, loseNextResponse: () => { loseResponse = true; }, failNextNote: () => { rejectNote = true; } };
}

for (const github of [false, true]) describe(`${github ? "GitHub" : "GitLab"} repository task memory`, () => {
  function setup() {
    const api = repositoryApi(github);
    const provider = github ? "github/v1" : "gitlab/v1";
    const apiBase = github ? "https://api.github.com" : "https://gitlab.com/api/v4";
    const config = { type: provider, ...(github ? { repository: "group/project" } : { project: "group/project" }), stateBranch: "state", identityAgent: "coordinator" };
    const identities = { resolve: vi.fn(async (agent: string, audience: string) => {
      expect(audience).toBe(apiBase);
      return { subject: `${agent}-bot`, credential: `${agent}-token` };
    }) };
    const context = { workspaceRoot: "/tmp", secret: async () => "token", identities };
    const Constructor = github ? GitHubTaskMemory : GitLabTaskMemory;
    const memory = new Constructor(config, context, api.fetcher);
    const ref = { id: "7", key: canonicalTaskKey(provider, apiBase, "group/project", "7") };
    return { api, identities, memory, ref, other: () => new Constructor(config, context, api.fetcher) };
  }

  it("uses conditional file writes and recovers a lost successful write response", async () => {
    const { api, memory, other, ref } = setup();
    api.loseNextResponse();
    const first = await memory.compareAndSwap(ref, null, { consumedEvents: ["one"] });
    expect((await other().read(ref)).checkpoint).toEqual({ consumedEvents: ["one"] });
    const second = await other().compareAndSwap(ref, first.revision, { consumedEvents: ["one", "two"] });
    expect(second.revision).not.toBe(first.revision);
    await expect(memory.compareAndSwap(ref, first.revision, {})).rejects.toBeInstanceOf(TaskMemoryConflictError);
    const writes = api.fetcher.mock.calls.filter(([, init]) => init!.method !== "GET");
    expect(JSON.parse(writes[1][1]!.body as string)).toMatchObject(github ? { sha: "commit-1", branch: "state" } : { last_commit_id: "commit-1", branch: "state" });
  });

  it("allows only one concurrent initial writer and preserves appended handoffs", async () => {
    const { memory, other, ref } = setup();
    const outcomes = await Promise.allSettled([memory.compareAndSwap(ref, null, { winner: 1 }), other().compareAndSwap(ref, null, { winner: 2 })]);
    expect(outcomes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((result) => result.status === "rejected")).toHaveLength(1);
    await Promise.all([memory.publishHandoff(ref, handoff("a")), other().publishHandoff(ref, handoff("b"))]);
    expect((await other().read(ref)).handoffs.map((value) => value.id).sort()).toEqual(["a", "b"]);
  });

  it("persists completion before notification, retries projection and uses the agent identity for comments", async () => {
    const { api, memory, ref, identities } = setup();
    api.failNextNote();
    await expect(memory.publishHandoff(ref, handoff("a"))).rejects.toThrow("HTTP 503");
    expect((await memory.read(ref)).handoffs).toEqual([handoff("a")]);
    await memory.publishHandoff(ref, handoff("a"));
    await memory.publishHandoff(ref, handoff("a"));
    expect(api.notes).toHaveLength(1);
    expect(identities.resolve).toHaveBeenCalledWith("engineer", github ? "https://api.github.com" : "https://gitlab.com/api/v4");
    const commentWrite = api.fetcher.mock.calls.find(([url, init]) => /\/(notes|comments)$/.test(String(url)) && init!.method === "POST")!;
    expect(commentWrite[1]!.headers).toMatchObject(github ? { Authorization: "Bearer engineer-token" } : { "PRIVATE-TOKEN": "engineer-token" });
    expect(api.notes[0].body).toContain("harnessfile:handoff:v1:");
  });

  it("keeps large handoffs intact while bounding their comment projection", async () => {
    const { api, memory, ref } = setup();
    const completion = { ...handoff("long-output"), summary: "Large output. ".repeat(8000) };
    await memory.publishHandoff(ref, completion);
    expect((await memory.read(ref)).handoffs[0].summary).toBe(completion.summary);
    expect(Buffer.byteLength(api.notes[0].body)).toBeLessThan(40_000);
    expect(api.notes[0].body).toContain("Full handoff is available in durable task memory.");
    expect(api.notes[0].body).toContain("harnessfile:handoff:v1:");
  });

  if (github) it("rejects oversized records before committing unreadable GitHub content", async () => {
    const { api, memory, ref } = setup();
    await expect(memory.compareAndSwap(ref, null, { oversized: "a".repeat(16 * 1024 * 1024) })).rejects.toThrow("16 MiB record limit");
    expect(api.fetcher.mock.calls.some(([, init]) => init!.method !== "GET")).toBe(false);
    expect(await memory.read(ref)).toEqual({ revision: null, handoffs: [] });
  });

  if (github) it("reads large GitHub records as raw blobs pinned to the exact metadata SHA", async () => {
    const ref = { id: "7", key: canonicalTaskKey("github/v1", "https://api.github.com", "group/project", "7") };
    const record = { format: 1, key: ref.key, revision: "record-uuid", checkpoint: { patch: "a".repeat(1_100_000) }, handoffs: [] };
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).includes("/branches/")) return response({ name: "state" });
      if (String(url).endsWith("/git/blobs/exact-blob-sha")) {
        expect((init!.headers as Record<string, string>).Accept).toBe("application/vnd.github.raw+json");
        return response(record);
      }
      return response({ sha: "exact-blob-sha", content: "", encoding: "none", size: 1_100_000 });
    });
    const memory = new GitHubTaskMemory({ type: "github/v1", repository: "group/project", stateBranch: "state", tokenSecret: "TOKEN" }, { workspaceRoot: "/tmp", secret: async () => "token" }, fetcher);
    expect((await memory.read(ref)).checkpoint!.patch).toHaveLength(1_100_000);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});
