import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { ProviderRef } from "../../ir/types.js";
import type { ActorIdentity, ProjectManagementService, ProjectTask, ProviderRegistrar, ServiceContext, TaskEvent, TaskReference, TaskUpdate } from "../contracts.js";
import { apiUrl, JsonApi, object, string, type HttpFetch } from "./http.js";

interface Issue { number?: number; iid?: number; body?: string; description?: string; html_url?: string; web_url?: string; pull_request?: unknown }
interface Note { body?: string }
interface WebhookConfig { secret: string; taskLabel: string; agent: string; ignoreSubjects: string[] }
type Headers = Record<string, string | undefined>;

const queues = new Map<string, Promise<unknown>>();

/** Serialize mutations within one host. Multiple hosts need an external durable coordinator. */
async function exclusive<T>(key: string, action: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(action);
  queues.set(key, next);
  try { return await next; }
  finally { if (queues.get(key) === next) queues.delete(key); }
}

function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function marker(taskId: string): string { return `<!-- harnessfile:task:${hash(taskId)} -->`; }
function noteMarker(body: string): string { return `<!-- harnessfile:note:${hash(body)} -->`; }
function marked(body: string): boolean { return /<!-- harnessfile:(task|note):[a-f0-9]{64} -->/.test(body); }
function issueId(ref: TaskReference): string {
  if (!/^[1-9]\d*$/.test(ref.id)) throw new Error("Task reference must contain a positive issue number");
  return ref.id;
}
function credential(actor: ActorIdentity): string { return string(actor.credential, "Identity credential"); }
function title(task: ProjectTask): string { return `[${task.agent}] ${task.prompt.replace(/\s+/g, " ").trim() || "Agent task"}`.slice(0, 240); }
function body(task: ProjectTask, actor: ActorIdentity): string {
  return [task.prompt, `Agent: ${task.agent}\nActor: ${actor.subject}`, task.parent ? `Parent task: ${task.parent.url ?? task.parent.id}` : "", task.runId ? `Run: ${task.runId}` : "", task.step ? `Step: ${task.step}` : "", task.requestedBy ? `Requested by: ${task.requestedBy}` : "", marker(task.id)].filter(Boolean).join("\n\n");
}
function webhookError(message: string, statusCode: number): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode });
}
function equal(a: string, b: string): boolean {
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** HTTP integrations deliberately use only the supplied identity; no ambient CLI login. */
abstract class IssueProjectManagement implements ProjectManagementService {
  get audience(): string { return this.api.base; }
  protected readonly api: JsonApi;
  protected readonly root: string;
  private readonly webhook?: WebhookConfig;
  private readonly receivers = new Set<(event: TaskEvent) => Promise<void>>();
  readonly handleWebhook?: (rawBody: string, headers: Headers) => Promise<void>;
  readonly subscribe?: (receive: (event: TaskEvent) => Promise<void>) => Promise<() => Promise<void>>;
  protected abstract readonly providerId: string;
  protected abstract readonly github: boolean;

  constructor(config: ProviderRef, protected readonly context: Pick<ServiceContext, "secret">, github: boolean, fetcher?: HttpFetch) {
    this.api = new JsonApi(github ? "GitHub" : "GitLab", apiUrl(config.apiUrl, github ? "https://api.github.com" : "https://gitlab.com/api/v4"), fetcher);
    if (github) {
      const repository = string(config.repository, "repository");
      if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error("GitHub repository must be owner/repo");
      this.root = `/repos/${repository}/issues`;
    } else {
      const project = config.project;
      if (typeof project !== "number" && typeof project !== "string") throw new Error("GitLab project must be a numeric ID or project path");
      if (typeof project === "number" ? !Number.isSafeInteger(project) || project <= 0 : !project.trim()) throw new Error("GitLab project must be nonempty");
      this.root = `/projects/${encodeURIComponent(String(project))}/issues`;
    }
    if (config.webhook !== undefined) {
      const webhook = object(config.webhook, "webhook");
      if (webhook.ignoreSubjects !== undefined && (!Array.isArray(webhook.ignoreSubjects) || !webhook.ignoreSubjects.every((v) => typeof v === "string"))) throw new Error("webhook.ignoreSubjects must be a string array");
      this.webhook = {
        secret: string(webhook.secret, "webhook.secret"), taskLabel: string(webhook.taskLabel, "webhook.taskLabel"),
        agent: string(webhook.agent, "webhook.agent"), ignoreSubjects: webhook.ignoreSubjects as string[] ?? [],
      };
      this.handleWebhook = this.receiveWebhook.bind(this);
      this.subscribe = async (receive) => {
        this.receivers.add(receive);
        return async () => { this.receivers.delete(receive); };
      };
    }
  }

  private reference(issue: Issue): TaskReference {
    const id = this.github ? issue.number : issue.iid;
    if (!Number.isSafeInteger(id) || id! <= 0) throw new Error(`${this.api.provider} returned an invalid issue reference`);
    return { id: String(id), url: this.github ? issue.html_url : issue.web_url };
  }

  private async *pages<T>(path: string, token: string): AsyncGenerator<T[]> {
    for (let page = 1; ; page++) {
      const values = await this.api.request<T[]>(`${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`, token);
      if (!Array.isArray(values)) throw new Error(`${this.api.provider} returned an invalid list response`);
      yield values;
      if (values.length < 100) return;
    }
  }

  private async findTask(id: string, token: string): Promise<TaskReference | undefined> {
    // List directly rather than using a search index with delayed visibility.
    const query = this.github ? "state=all&sort=created&direction=asc" : "scope=all&state=all&order_by=created_at&sort=asc";
    const matches: TaskReference[] = [];
    for await (const issues of this.pages<Issue>(`${this.root}?${query}`, token)) {
      for (const issue of issues) {
        if (!issue.pull_request && (this.github ? issue.body : issue.description)?.includes(marker(id))) matches.push(this.reference(issue));
      }
    }
    if (matches.length > 1) throw new Error(`${this.api.provider} has conflicting issues for this task's idempotency key; reconcile them before retrying`);
    return matches[0];
  }

  async createTask(task: ProjectTask, actor: ActorIdentity): Promise<TaskReference> {
    string(task.id, "Task idempotency key");
    const token = credential(actor);
    return exclusive(`${this.api.base}${this.root}:${hash(task.id)}`, async () => {
      const existing = await this.findTask(task.id, token);
      if (existing) return existing;
      try {
        const issue = await this.api.request<Issue>(this.root, token, "POST", {
          title: title(task), [this.github ? "body" : "description"]: body(task, actor),
        });
        return this.reference(issue);
      } catch (error) {
        // A timeout/5xx can follow a successful write. Reconcile before reporting failure.
        const recovered = await this.findTask(task.id, token);
        if (recovered) return recovered;
        throw error;
      }
    });
  }

  async comment(task: TaskReference, text: string, actor: ActorIdentity): Promise<void> {
    const token = credential(actor);
    const path = `${this.root}/${issueId(task)}/${this.github ? "comments" : "notes"}`;
    const content = `${text}\n\nActor: ${actor.subject}`;
    const stamp = noteMarker(content);
    const exists = async () => {
      for await (const notes of this.pages<Note>(path, token)) if (notes.some((note) => note.body?.includes(stamp))) return true;
      return false;
    };
    await exclusive(`${this.api.base}${path}:${hash(content)}`, async () => {
      if (await exists()) return;
      try { await this.api.request(path, token, "POST", { body: `${content}\n\n${stamp}` }); }
      catch (error) { if (!(await exists())) throw error; }
    });
  }

  async updateTask(task: TaskReference, update: TaskUpdate, actor: ActorIdentity): Promise<void> {
    const token = credential(actor);
    await this.comment(task, [`Status: **${update.status}**`, update.output, update.error ? `Error: ${update.error}` : undefined].filter(Boolean).join("\n\n"), actor);
    const closed = update.status === "completed" || update.status === "cancelled";
    await this.api.request(`${this.root}/${issueId(task)}`, token, this.github ? "PATCH" : "PUT", this.github
      ? { state: closed ? "closed" : "open", ...(closed ? { state_reason: update.status === "completed" ? "completed" : "not_planned" } : {}) }
      : { state_event: closed ? "close" : "reopen" });
  }

  private async receiveWebhook(rawBody: string, headers: Headers): Promise<void> {
    const config = this.webhook;
    if (!config) throw webhookError("Project-management webhook is disabled", 404);
    const normalized = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
    const secret = await this.context.secret(config.secret);
    if (!secret) throw webhookError("Project-management webhook secret is unavailable", 503);
    if (this.github) {
      const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
      if (!equal(expected, normalized["x-hub-signature-256"] ?? "")) throw webhookError("Invalid webhook signature", 401);
    } else if (!equal(secret, normalized["x-gitlab-token"] ?? "")) throw webhookError("Invalid webhook token", 401);
    let payload: Record<string, unknown>;
    try { payload = object(JSON.parse(rawBody), "Webhook payload"); }
    catch { throw webhookError("Invalid webhook payload", 400); }
    let event: TaskEvent | undefined;
    try { event = this.github ? this.githubEvent(payload, normalized, config) : this.gitlabEvent(payload, normalized, config); }
    catch { throw webhookError("Invalid webhook event", 400); }
    if (!event) return;
    if (this.receivers.size === 0) throw webhookError("Project-management webhook has no subscriber", 503);
    for (const receive of this.receivers) await receive(event);
  }

  private githubEvent(payload: Record<string, unknown>, headers: Headers, config: WebhookConfig): TaskEvent | undefined {
    if (headers["x-github-event"] !== "issues" || !["opened", "labeled", "reopened"].includes(String(payload.action))) return;
    const issue = object(payload.issue, "issue"), sender = object(payload.sender, "sender"), repository = object(payload.repository, "repository");
    if (`/repos/${repository.full_name}/issues`.toLowerCase() !== this.root.toLowerCase()) return;
    const description = typeof issue.body === "string" ? issue.body : "";
    const login = string(sender.login, "sender login");
    if (sender.type === "Bot" || config.ignoreSubjects.includes(login) || marked(description)) return;
    if (payload.action === "labeled" && (payload.label as Record<string, unknown> | undefined)?.name !== config.taskLabel) return;
    if (issue.state !== "open" || !Array.isArray(issue.labels) || !issue.labels.some((v: unknown) => typeof v === "object" && v !== null && (v as Record<string, unknown>).name === config.taskLabel)) return;
    const task = this.reference(issue as Issue);
    return this.event(string(headers["x-github-delivery"], "delivery ID"), task, string(issue.title, "issue title"), description, login, config);
  }

  private gitlabEvent(payload: Record<string, unknown>, headers: Headers, config: WebhookConfig): TaskEvent | undefined {
    if (headers["x-gitlab-event"] !== "Issue Hook" || payload.object_kind !== "issue") return;
    const issue = object(payload.object_attributes, "issue"), user = object(payload.user, "user"), project = object(payload.project, "project");
    const projectRoots = [project.id, project.path_with_namespace].map((id) => `/projects/${encodeURIComponent(String(id))}/issues`);
    if (!projectRoots.includes(this.root)) return;
    const changes = payload.changes && typeof payload.changes === "object" ? payload.changes as Record<string, unknown> : {};
    const stateChange = changes.state_id && typeof changes.state_id === "object" ? changes.state_id as Record<string, unknown> : undefined;
    const labelChange = changes.labels && typeof changes.labels === "object" ? changes.labels as Record<string, unknown> : undefined;
    const hasTaskLabel = (labels: unknown): boolean => Array.isArray(labels) && labels.some((label: unknown) => typeof label === "object" && label !== null && (label as Record<string, unknown>).title === config.taskLabel);
    const newlyLabeled = labelChange && Array.isArray(labelChange.previous) && !hasTaskLabel(labelChange.previous) && hasTaskLabel(labelChange.current);
    if (issue.action !== "open" && issue.action !== "reopen" && !(issue.action === "update" && ((stateChange?.previous === 2 && stateChange.current === 1) || newlyLabeled))) return;
    const description = typeof issue.description === "string" ? issue.description : "";
    const username = string(user.username, "username");
    if (user.bot === true || config.ignoreSubjects.includes(username) || marked(description)) return;
    const labels = Array.isArray(payload.labels) ? payload.labels : issue.labels;
    if (issue.state !== "opened" || !hasTaskLabel(labels)) return;
    const task = this.reference({ iid: issue.iid as number, web_url: issue.url as string });
    return this.event(string(headers["x-gitlab-event-uuid"], "event UUID"), task, string(issue.title, "issue title"), description, username, config);
  }

  private event(id: string, task: TaskReference, title: string, description: string, requestedBy: string, config: WebhookConfig): TaskEvent {
    return { id: `${this.providerId}:${id}`, task, input: { agent: config.agent, prompt: `${title}\n\n${description}`, task, requestedBy, projectManagement: { provider: this.providerId } } };
  }

  async close(): Promise<void> { this.receivers.clear(); }
}

export class GitHubProjectManagement extends IssueProjectManagement {
  protected readonly providerId = "github/v1";
  protected readonly github = true;
  constructor(config: ProviderRef, context: Pick<ServiceContext, "secret">, fetcher?: HttpFetch) { super(config, context, true, fetcher); }
}

export class GitLabProjectManagement extends IssueProjectManagement {
  protected readonly providerId = "gitlab/v1";
  protected readonly github = false;
  constructor(config: ProviderRef, context: Pick<ServiceContext, "secret">, fetcher?: HttpFetch) { super(config, context, false, fetcher); }
}

export function registerProjectManagementProviders(registry: ProviderRegistrar): void {
  registry.register("project-management", "github/v1", (config, context) => new GitHubProjectManagement(config, context));
  registry.register("project-management", "gitlab/v1", (config, context) => new GitLabProjectManagement(config, context));
}
