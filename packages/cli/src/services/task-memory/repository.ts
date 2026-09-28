import { createHash } from "node:crypto";
import type { ProviderRef } from "../../ir/types.js";
import type { IdentityService, ServiceContext, TaskHandoff, TaskReference } from "../contracts.js";
import { apiUrl, JsonApi, ProviderHttpError, string, type HttpFetch } from "../project-management/http.js";
import { AtomicTaskMemory, canonicalJson, checkRecordSize, MAX_TASK_MEMORY_BYTES, parseStored, TaskMemoryConflictError, type StoredTaskMemory, type StoredVersion } from "./base.js";
import { handoffNoteMarker } from "./handoff-note.js";
import { canonicalTaskKey, taskMemoryKey } from "./key.js";

export interface TaskMemoryContext extends Pick<ServiceContext, "secret" | "workspaceRoot"> { identities?: IdentityService }

/** Repository files provide CAS; issue notes are retryable notifications, not the authority. */
export class RepositoryTaskMemory extends AtomicTaskMemory {
  private readonly api: JsonApi;
  private readonly project: string;
  private readonly root: string;
  private readonly branch: string;
  private readonly statePath: string;
  private readonly identityAgent: string;
  private readonly tokenSecret?: string;
  private readonly notes: boolean;
  private ready?: Promise<void>;

  constructor(private readonly config: ProviderRef, private readonly context: TaskMemoryContext, private readonly github: boolean, fetcher?: HttpFetch) {
    super();
    this.api = new JsonApi(github ? "GitHub" : "GitLab", apiUrl(config.apiUrl, github ? "https://api.github.com" : "https://gitlab.com/api/v4"), fetcher);
    const project = github ? config.repository : config.project;
    if (typeof project !== "string" && typeof project !== "number") throw new Error("Task memory requires a repository/project");
    this.project = String(project);
    if (github && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(this.project)) throw new Error("GitHub task memory repository must be owner/repo");
    if (!github && !this.project.trim()) throw new Error("GitLab task memory project is required");
    this.root = github ? `/repos/${this.project}` : `/projects/${encodeURIComponent(this.project)}`;
    this.branch = string(config.stateBranch, "stateBranch");
    if (this.branch === "HEAD") throw new Error("stateBranch must explicitly name an existing writable branch");
    this.statePath = config.statePath === undefined ? ".harnessfile/tasks" : string(config.statePath, "statePath");
    if (this.statePath.startsWith("/") || this.statePath.split("/").some((part) => !part || part === "." || part === "..")) throw new Error("statePath must be a safe relative repository directory");
    this.identityAgent = config.identityAgent === undefined ? "orchestrator" : string(config.identityAgent, "identityAgent");
    this.tokenSecret = config.tokenSecret === undefined ? undefined : string(config.tokenSecret, "tokenSecret");
    if (!this.tokenSecret && !context.identities) throw new Error("Task memory requires a tokenSecret reference or a composed identity service");
    if (config.publishNotes !== undefined && typeof config.publishNotes !== "boolean") throw new Error("publishNotes must be boolean");
    this.notes = config.publishNotes !== false;
  }

  private async token(agent = this.identityAgent): Promise<string> {
    if (this.tokenSecret) return string(await this.context.secret(this.tokenSecret), "Task memory token");
    return string((await this.context.identities!.resolve(agent, this.api.base)).credential, "Task memory identity credential");
  }

  private async ensureBranch(token: string): Promise<void> {
    if (!this.ready) {
      this.ready = this.api.request(`${this.root}/${this.github ? "branches" : "repository/branches"}/${encodeURIComponent(this.branch)}`, token).then(() => {});
      void this.ready.catch(() => { this.ready = undefined; });
    }
    await this.ready;
  }

  private path(task: TaskReference): string {
    const filename = `${this.statePath}/${createHash("sha256").update(taskMemoryKey(task)).digest("hex")}.json`;
    return this.github ? `${this.root}/contents/${filename.split("/").map(encodeURIComponent).join("/")}` : `${this.root}/repository/files/${encodeURIComponent(filename)}`;
  }

  protected async load(task: TaskReference): Promise<StoredVersion | undefined> {
    const token = await this.token();
    await this.ensureBranch(token);
    let file: { content: string; encoding: string; sha?: string; last_commit_id?: string; size?: number };
    try { file = await this.api.request(`${this.path(task)}?ref=${encodeURIComponent(this.branch)}`, token); }
    catch (error) { if (error instanceof ProviderHttpError && error.status === 404) return undefined; throw error; }
    if (file.size !== undefined && file.size > MAX_TASK_MEMORY_BYTES) throw new Error("Task memory exceeds the 16 MiB record limit");
    const storageRevision = this.github ? file.sha : file.last_commit_id;
    if (!storageRevision) throw new Error("Task memory file is missing its optimistic concurrency token");
    let raw: string;
    if (file.encoding === "base64" && typeof file.content === "string") raw = Buffer.from(file.content, "base64").toString("utf8");
    else if (this.github && file.encoding === "none") {
      // Above 1 MB, GitHub returns metadata only. Pin the raw read to the blob SHA
      // from that metadata, not the moving branch, to keep the CAS token aligned.
      const blob = await this.api.request<unknown>(`${this.root}/git/blobs/${encodeURIComponent(storageRevision)}`, token, "GET", undefined, { accept: "application/vnd.github.raw+json" });
      raw = JSON.stringify(blob);
    } else throw new Error("Task memory file must have base64 content or a supported raw representation");
    return { data: parseStored(raw, taskMemoryKey(task)), storageRevision };
  }

  protected async save(task: TaskReference, expectedStorageRevision: string | null, data: StoredTaskMemory): Promise<void> {
    const token = await this.token();
    const bytes = Buffer.from(canonicalJson(data));
    checkRecordSize(bytes);
    const content = bytes.toString("base64");
    const message = `Update durable task memory ${createHash("sha256").update(data.key).digest("hex").slice(0, 12)}`;
    try {
      await this.api.request(this.path(task), token, this.github || expectedStorageRevision ? "PUT" : "POST", this.github
        ? { branch: this.branch, message, content, ...(expectedStorageRevision ? { sha: expectedStorageRevision } : {}) }
        : { branch: this.branch, commit_message: message, content, encoding: "base64", ...(expectedStorageRevision ? { last_commit_id: expectedStorageRevision } : {}) });
    } catch (error) {
      // Distinguish a stale file token from permission/config errors. A lost response
      // is successful only when the exact write UUID is visible in the authority.
      const current = await this.load(task);
      if (current?.data.revision === data.revision) return;
      if ((current?.storageRevision ?? null) !== expectedStorageRevision) throw new TaskMemoryConflictError();
      throw error;
    }
  }

  protected async projectHandoff(task: TaskReference, handoff: TaskHandoff): Promise<void> {
    if (!this.notes) return;
    if (!/^[1-9]\d*$/.test(task.id)) throw new Error("Handoff note projection requires a positive issue number");
    const provider = this.github ? "github/v1" : "gitlab/v1";
    if (task.key !== canonicalTaskKey(provider, this.api.base, this.project, task.id)) throw new Error("Handoff note projection requires the memory repository to match the task board; use publishNotes: false for separate storage");
    const token = await this.token(handoff.agent);
    const path = `${this.root}/issues/${task.id}/${this.github ? "comments" : "notes"}`;
    const marker = handoffNoteMarker(task, handoff);
    const exists = async () => {
      for (let page = 1; ; page++) {
        const notes = await this.api.request<Array<{ body?: string }>>(`${path}?per_page=100&page=${page}`, token);
        if (!Array.isArray(notes)) throw new Error("Invalid task comment list");
        if (notes.some((note) => note.body?.includes(marker))) return true;
        if (notes.length < 100) return false;
      }
    };
    if (await exists()) return;
    const display = [`Agent handoff: **${handoff.agent}** — ${handoff.status}`, handoff.summary, handoff.artifacts?.map((artifact) => `${artifact.label ?? "Artifact"}: ${artifact.url}`).join("\n")].filter(Boolean).join("\n\n");
    const bytes = Buffer.from(display);
    const excerpt = bytes.length > 32_768 ? `${bytes.subarray(0, 32_768).toString("utf8")}\n\nFull handoff is available in durable task memory.` : display;
    const body = `${excerpt}\n\n${marker}`;
    try { await this.api.request(path, token, "POST", { body }); }
    catch (error) { if (!(await exists())) throw error; }
  }
}

export class GitLabTaskMemory extends RepositoryTaskMemory {
  constructor(config: ProviderRef, context: TaskMemoryContext, fetcher?: HttpFetch) { super(config, context, false, fetcher); }
}
export class GitHubTaskMemory extends RepositoryTaskMemory {
  constructor(config: ProviderRef, context: TaskMemoryContext, fetcher?: HttpFetch) { super(config, context, true, fetcher); }
}
