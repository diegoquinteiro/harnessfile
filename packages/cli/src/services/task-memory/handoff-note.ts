import type { TaskHandoff, TaskReference } from "../contracts.js";
import { taskMemoryKey, taskReferenceFromKey } from "./key.js";

export interface HandoffWakeup { taskKey: string; dispatchId: string; runId: string; step: string; agent: string }
export function handoffNoteMarker(task: TaskReference, handoff: TaskHandoff): string {
  const wakeup: HandoffWakeup = { taskKey: taskMemoryKey(task), dispatchId: handoff.dispatchId, runId: handoff.runId, step: handoff.step, agent: handoff.agent };
  return `<!-- harnessfile:handoff:v1:${Buffer.from(JSON.stringify(wakeup)).toString("base64url")} -->`;
}
export function parseHandoffNote(body: string): HandoffWakeup | undefined {
  const match = body.match(/<!-- harnessfile:handoff:v1:([A-Za-z0-9_-]+) -->/);
  if (!match) return;
  let value: HandoffWakeup;
  try { value = JSON.parse(Buffer.from(match[1], "base64url").toString("utf8")); } catch { throw new Error("Invalid handoff note"); }
  if (![value.taskKey, value.dispatchId, value.runId, value.step, value.agent].every((field) => typeof field === "string" && field.length > 0)) throw new Error("Invalid handoff note");
  taskReferenceFromKey(value.taskKey);
  return value;
}
