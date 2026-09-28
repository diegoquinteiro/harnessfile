import { createHash, createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { GitHubProjectManagement, GitLabProjectManagement } from "../src/services/project-management/index.js";
import type { ProjectTask, TaskEvent } from "../src/services/contracts.js";

const actor = { subject: "worker[bot]", credential: "private-token" };
const task: ProjectTask = { id: "run-1:step-1", agent: "engineer", prompt: "Implement task", runId: "run-1", step: "step-1", parent: { id: "42", url: "https://github.com/acme/app/issues/42" } };
const context = { secret: async () => "signing-secret" };
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const taskMarker = (id: string) => `<!-- harnessfile:task:${createHash("sha256").update(id).digest("hex")} -->`;

describe("GitHub project management", () => {
  it("creates and reconciles a task across instances, serializing concurrent calls", async () => {
    const issues: unknown[] = [];
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect((init!.headers as Record<string, string>).Authorization).toBe("Bearer private-token");
      if (init!.method === "GET") return response(issues);
      const data = JSON.parse(init!.body as string);
      expect(data.body).toContain("Parent task: https://github.com/acme/app/issues/42");
      const issue = { ...data, number: 43, html_url: "https://github.com/acme/app/issues/43" };
      issues.push(issue);
      return response(issue, 201);
    });
    const one = new GitHubProjectManagement({ type: "github/v1", repository: "acme/app" }, context, fetcher);
    const two = new GitHubProjectManagement({ type: "github/v1", repository: "acme/app" }, context, fetcher);
    const results = await Promise.all([one.createTask(task, actor), two.createTask(task, actor)]);
    expect(results).toEqual([{ id: "43", url: "https://github.com/acme/app/issues/43" }, { id: "43", url: "https://github.com/acme/app/issues/43" }]);
    expect(issues).toHaveLength(1);
    expect(one.handleWebhook).toBeUndefined();
    expect(one.subscribe).toBeUndefined();
    expect(fetcher.mock.calls.filter(([, init]) => init!.method === "POST")).toHaveLength(1);
  });

  it("recovers a committed create when the HTTP response was lost", async () => {
    const issues: unknown[] = [];
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      if (init!.method === "GET") return response(issues);
      issues.push({ number: 7, body: JSON.parse(init!.body as string).body });
      throw new Error("network failed private-token");
    });
    const service = new GitHubProjectManagement({ type: "github/v1", repository: "acme/app" }, context, fetcher);
    expect(await service.createTask(task, actor)).toEqual({ id: "7" });
    expect(issues).toHaveLength(1);
  });

  it("finds idempotency markers beyond the first page and rejects duplicate markers", async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) => response(String(url).includes("page=2")
      ? [{ number: 101, body: taskMarker(task.id) }]
      : Array.from({ length: 100 }, (_, i) => ({ number: i + 1, body: "normal issue" }))));
    const service = new GitHubProjectManagement({ type: "github/v1", repository: "acme/app" }, context, fetcher);
    expect(await service.createTask(task, actor)).toEqual({ id: "101" });
    expect(fetcher).toHaveBeenCalledTimes(2);
    const conflict = new GitHubProjectManagement({ type: "github/v1", repository: "acme/app" }, context, async () => response([{ number: 1, body: taskMarker(task.id) }, { number: 2, body: taskMarker(task.id) }]));
    await expect(conflict.createTask(task, actor)).rejects.toThrow("conflicting issues");
  });

  it("deduplicates status comments and closes/reopens with correct GitHub semantics", async () => {
    const notes: unknown[] = [];
    const changes: unknown[] = [];
    const service = new GitHubProjectManagement({ type: "github/v1", repository: "acme/app" }, context, async (_url, init) => {
      if (init!.method === "GET") return response(notes);
      const data = JSON.parse(init!.body as string);
      if (init!.method === "POST") notes.push(data); else changes.push(data);
      return response(data);
    });
    await service.updateTask({ id: "43" }, { status: "completed", output: "Done" }, actor);
    await service.updateTask({ id: "43" }, { status: "completed", output: "Done" }, actor);
    await service.updateTask({ id: "43" }, { status: "failed", error: "Needs attention" }, actor);
    expect(notes).toHaveLength(2);
    expect(changes).toEqual([{ state: "closed", state_reason: "completed" }, { state: "closed", state_reason: "completed" }, { state: "open" }]);
  });

  it("surfaces permission/rate-limit errors without exposing response data or retrying writes", async () => {
    const fetcher = vi.fn(async (_url, init) => init!.method === "GET" ? response([]) : response({ message: "private-token" }, 429));
    const service = new GitHubProjectManagement({ type: "github/v1", repository: "acme/app" }, context, fetcher);
    await expect(service.createTask(task, actor)).rejects.toMatchObject({ status: 429, retryable: true, message: "GitHub request failed (HTTP 429)" });
    expect(fetcher.mock.calls.filter(([, init]) => init!.method === "POST")).toHaveLength(1);
    await expect(service.createTask(task, { subject: "anonymous" })).rejects.toThrow("Identity credential");
  });
});

describe("GitLab project management", () => {
  it("encodes project paths and uses issue IID, notes and state events", async () => {
    const calls: { url: string; method: string; body: unknown }[] = [];
    const service = new GitLabProjectManagement({ type: "gitlab/v1", project: "group/project" }, context, async (url, init) => {
      expect((init!.headers as Record<string, string>)["PRIVATE-TOKEN"]).toBe("private-token");
      const data = init!.body ? JSON.parse(init!.body as string) : undefined;
      calls.push({ url: String(url), method: init!.method!, body: data });
      if (init!.method === "GET") return response([]);
      return response({ ...data, id: 999, iid: 12, web_url: "https://gitlab.com/group/project/-/issues/12" });
    });
    const ref = await service.createTask(task, actor);
    expect(ref.id).toBe("12");
    await service.updateTask(ref, { status: "cancelled" }, actor);
    expect(calls.every((call) => call.url.startsWith("https://gitlab.com/api/v4/projects/group%2Fproject/issues"))).toBe(true);
    expect(calls.find((call) => call.method === "POST")!.body).toMatchObject({ title: "[engineer] Implement task", description: expect.stringContaining(taskMarker(task.id)) });
    expect(calls.find((call) => call.method === "PUT")!.body).toEqual({ state_event: "close" });
    expect(calls.some((call) => call.url.endsWith("/12/notes") && call.method === "POST")).toBe(true);
  });
});

describe("authenticated project-management ingress", () => {
  const webhook = { secret: "WEBHOOK_SECRET", taskLabel: "harnessfile", agent: "engineer" };
  const githubPayload = { action: "opened", repository: { full_name: "acme/app" }, sender: { login: "person", type: "User" }, issue: { number: 9, title: "Fix bug", body: "Details", state: "open", labels: [{ name: "harnessfile" }], html_url: "https://github.com/acme/app/issues/9" } };
  const signed = (raw: string) => ({ "x-github-event": "issues", "x-github-delivery": "delivery-1", "x-hub-signature-256": `sha256=${createHmac("sha256", "signing-secret").update(raw).digest("hex")}` });

  it("authenticates exact GitHub bytes and emits stable delivery IDs with issue context", async () => {
    const service = new GitHubProjectManagement({ type: "github/v1", repository: "acme/app", webhook }, context);
    const events: TaskEvent[] = [];
    const unsubscribe = await service.subscribe!(async (event) => { events.push(event); });
    const raw = JSON.stringify(githubPayload);
    await expect(service.handleWebhook!(raw, { ...signed(raw), "x-hub-signature-256": "bad" })).rejects.toMatchObject({ statusCode: 401 });
    await service.handleWebhook!(raw, signed(raw));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ id: "github/v1:delivery-1", task: { id: "9" }, input: { agent: "engineer", prompt: "Fix bug\n\nDetails", requestedBy: "person" } });
    await unsubscribe();
    await expect(service.handleWebhook!(raw, signed(raw))).rejects.toMatchObject({ statusCode: 503 });
  });

  it("ignores bot-created, harness-created, other-repository and unlabeled GitHub issues", async () => {
    const service = new GitHubProjectManagement({ type: "github/v1", repository: "acme/app", webhook }, context);
    const receive = vi.fn(async () => {});
    await service.subscribe!(receive);
    for (const payload of [
      { ...githubPayload, sender: { login: "bot", type: "Bot" } },
      { ...githubPayload, issue: { ...githubPayload.issue, body: taskMarker("task") } },
      { ...githubPayload, repository: { full_name: "other/repo" } },
      { ...githubPayload, issue: { ...githubPayload.issue, labels: [] } },
      { ...githubPayload, action: "labeled", label: { name: "unrelated" } },
    ]) {
      const raw = JSON.stringify(payload);
      await service.handleWebhook!(raw, signed(raw));
    }
    expect(receive).not.toHaveBeenCalled();
  });

  it("propagates downstream errors so the host can reject and retry delivery", async () => {
    const service = new GitHubProjectManagement({ type: "github/v1", repository: "acme/app", webhook }, context);
    await service.subscribe!(async () => { throw new Error("Durable queue unavailable"); });
    const raw = JSON.stringify(githubPayload);
    await expect(service.handleWebhook!(raw, signed(raw))).rejects.toThrow("Durable queue unavailable");
  });

  it("checks GitLab secret tokens, project scope, labels and event UUIDs", async () => {
    const service = new GitLabProjectManagement({ type: "gitlab/v1", project: 42, webhook }, context);
    const receive = vi.fn(async () => {});
    await service.subscribe!(receive);
    const payload = { object_kind: "issue", project: { id: 42 }, user: { username: "person" }, labels: [{ title: "harnessfile" }], object_attributes: { iid: 3, action: "open", state: "opened", title: "Task", description: "Do it", url: "https://gitlab.com/project/-/issues/3" } };
    const raw = JSON.stringify(payload);
    const headers = { "x-gitlab-event": "Issue Hook", "x-gitlab-event-uuid": "uuid", "x-gitlab-token": "signing-secret" };
    await expect(service.handleWebhook!(raw, { ...headers, "x-gitlab-token": "wrong" })).rejects.toMatchObject({ statusCode: 401 });
    await service.handleWebhook!(raw, headers);
    expect(receive).toHaveBeenCalledWith(expect.objectContaining({ id: "gitlab/v1:uuid", task: { id: "3", url: "https://gitlab.com/project/-/issues/3" } }));
    await expect(service.handleWebhook!(raw, { ...headers, "x-gitlab-event-uuid": undefined })).rejects.toMatchObject({ statusCode: 400 });
    await service.handleWebhook!(JSON.stringify({ ...payload, project: { id: 43 } }), headers);
    expect(receive).toHaveBeenCalledTimes(1);
    await service.handleWebhook!(JSON.stringify({ ...payload, object_attributes: { ...payload.object_attributes, action: "reopen" } }), { ...headers, "x-gitlab-event-uuid": "reopen" });
    await service.handleWebhook!(JSON.stringify({ ...payload, object_attributes: { ...payload.object_attributes, action: "update" }, changes: { labels: { previous: [], current: [{ title: "harnessfile" }] } } }), { ...headers, "x-gitlab-event-uuid": "labeled" });
    expect(receive).toHaveBeenCalledTimes(3);
  });
});
