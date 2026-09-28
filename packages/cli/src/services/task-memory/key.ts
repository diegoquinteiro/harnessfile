import type { TaskReference } from "../contracts.js";

/** JSON tuple escaping prevents ambiguous delimiters and cross-project collisions. */
export function canonicalTaskKey(provider: string, apiBase: string, project: string | number, id: string): string {
  const api = new URL(apiBase);
  if (api.username || api.password || api.search || api.hash) throw new Error("Task API base must not contain credentials or query parameters");
  const endpoint = `${api.origin}${api.pathname.replace(/\/$/, "")}`;
  return `task:${JSON.stringify([provider, endpoint, provider === "github/v1" ? String(project).toLowerCase() : String(project), String(id)])}`;
}

export function taskReferenceFromKey(key: string): TaskReference {
  if (!key.startsWith("task:")) throw new Error("Invalid canonical task key");
  let tuple: unknown;
  try { tuple = JSON.parse(key.slice(5)); } catch { throw new Error("Invalid canonical task key"); }
  if (!Array.isArray(tuple) || tuple.length !== 4 || !tuple.every((value) => typeof value === "string" && value.length > 0)) throw new Error("Invalid canonical task key");
  if (canonicalTaskKey(tuple[0], tuple[1], tuple[2], tuple[3]) !== key) throw new Error("Noncanonical task key");
  return { id: tuple[3], key };
}

export function taskMemoryKey(task: TaskReference): string {
  if (!task.key || taskReferenceFromKey(task.key).id !== task.id) throw new Error("Durable task memory requires a canonical task.key matching task.id");
  return task.key;
}
