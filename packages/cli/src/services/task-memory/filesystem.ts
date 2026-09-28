import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { resolve } from "node:path";
import type { ProviderRef } from "../../ir/types.js";
import type { TaskReference } from "../contracts.js";
import { string } from "../project-management/http.js";
import { AtomicTaskMemory, canonicalJson, checkRecordSize, parseStored, TaskMemoryConflictError, type StoredTaskMemory, type StoredVersion } from "./base.js";
import { taskMemoryKey } from "./key.js";

/** Atomic on a local filesystem. A crashed lock is preserved for explicit operator recovery. */
export class FilesystemTaskMemory extends AtomicTaskMemory {
  private readonly root: string;
  private readonly timeout: number;
  constructor(config: ProviderRef, context: { workspaceRoot: string }) {
    super();
    this.root = resolve(context.workspaceRoot, string(config.path, "task-memory.path"));
    this.timeout = config.lockTimeoutMs === undefined ? 5000 : Number(config.lockTimeoutMs);
    if (!Number.isFinite(this.timeout) || this.timeout < 1 || this.timeout > 60_000) throw new Error("lockTimeoutMs must be between 1 and 60000");
  }
  private file(task: TaskReference): string { return resolve(this.root, `${createHash("sha256").update(taskMemoryKey(task)).digest("hex")}.json`); }
  protected async load(task: TaskReference): Promise<StoredVersion | undefined> {
    try {
      const data = parseStored(await readFile(this.file(task), "utf8"), taskMemoryKey(task));
      return { data, storageRevision: data.revision };
    } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
  }
  protected async save(task: TaskReference, expectedStorageRevision: string | null, value: StoredTaskMemory): Promise<void> {
    const serialized = canonicalJson(value);
    checkRecordSize(serialized);
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const file = this.file(task), lock = `${file}.lock`;
    const until = Date.now() + this.timeout;
    for (;;) {
      try { await mkdir(lock, { mode: 0o700 }); break; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        if (Date.now() >= until) throw new Error("Task memory lock is busy; retry or recover an abandoned lock after verifying its owner stopped");
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      const old = await this.load(task);
      if ((old?.storageRevision ?? null) !== expectedStorageRevision) throw new TaskMemoryConflictError();
      const handle = await open(temporary, "wx", 0o600);
      try { await handle.writeFile(serialized); await handle.sync(); } finally { await handle.close(); }
      await rename(temporary, file);
      const directory = await open(this.root, "r");
      try { await directory.sync(); } finally { await directory.close(); }
    } finally {
      await rm(temporary, { force: true });
      await rm(lock, { recursive: true });
    }
  }
}
