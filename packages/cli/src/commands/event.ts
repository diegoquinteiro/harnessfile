import { readFile } from "node:fs/promises";
import { loadHarnessDirectory } from "../parser/directory.js";
import { validateHarnessfile } from "../validator/validate.js";
import { composeServices, type CompositionOptions, type ComposedServices } from "../services/compose.js";
import { providerConfig } from "../services/registry.js";
import type { Harnessfile } from "../ir/types.js";
import type { RunResult } from "../providers/interface.js";
import type { TaskEvent } from "../services/contracts.js";

/** Complete one authenticated delivery or trusted reconciliation, then release the host. */
export async function processEvent(ir: Harnessfile, payload: Record<string, unknown>, options: CompositionOptions & { webhook?: boolean; resume?: string } = {}): Promise<RunResult[]> {
  const validation = validateHarnessfile(ir);
  if (!validation.valid) throw new Error(validation.errors.map(e => `${e.path}: ${e.message}`).join("; "));
  const services = await composeServices(ir, options);
  try {
    if (!services.orchestrationCapabilities?.eventDriven) throw new Error("The event command requires an orchestration provider declaring eventDriven capability; use up for a continuous provider");
    return await deliverEvent(ir, services, payload, options);
  }
  finally { await services.close(); }
}

export async function deliverEvent(ir: Harnessfile, services: ComposedServices, payload: Record<string, unknown>, options: { webhook?: boolean; resume?: string }): Promise<RunResult[]> {
  const results: RunResult[] = [];
  if (!options.webhook) {
    const handle = options.resume
      ? await services.harness.resumeRun(options.resume, payload)
      : await services.harness.createRun(payload);
    results.push(await handle.result);
    return results;
  }
  const pm = services.projectManagement;
  if (!pm?.subscribe || !pm.handleWebhook) throw new Error("Selected task provider does not support authenticated webhooks");
  if (typeof payload.body !== "string" || !payload.headers || typeof payload.headers !== "object" || Array.isArray(payload.headers)) throw new Error("Webhook envelope must contain raw body string and headers object");
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(payload.headers)) {
    if (typeof value !== "string") throw new Error("Webhook header values must be strings");
    headers[key.toLowerCase()] = value;
  }
  const unsubscribe = await pm.subscribe(async (event: TaskEvent) => {
    const input = projectEventInput(ir, event);
    const handle = typeof event.input.resumeRunId === "string"
      ? await services.harness.resumeRun(event.input.resumeRunId, input)
      : await services.harness.createRun(input);
    results.push(await handle.result);
  });
  try { await pm.handleWebhook(payload.body, headers); }
  finally { await unsubscribe(); }
  return results;
}

export function projectEventInput(ir: Harnessfile, event: TaskEvent): Record<string, unknown> {
  const selected = ir.projectManagement && providerConfig(ir.projectManagement.provider).type;
  const triggers = Object.entries(ir.steps ?? {}).filter(([, step]) => step.type === "trigger");
  const managed = triggers.filter(([, step]) => !step.schedule && step.provider && providerConfig(step.provider).type === selected).map(([name]) => name);
  if (triggers.length && managed.length !== 1) throw new Error("Project ingress requires exactly one trigger matching the task provider");
  const trigger = event.input.trigger ?? managed[0];
  if (trigger && !managed.includes(String(trigger))) throw new Error("Project event selected an unknown trigger");
  return { ...event.input, eventId: event.id, task: event.task, trigger };
}

export async function event(path: string | undefined, options: { input: string; webhook?: boolean; resume?: string; plugin?: string[] }): Promise<void> {
  try {
    const harness = loadHarnessDirectory(path);
    const payload = JSON.parse(await readFile(options.input, "utf8"));
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Event input must be an object");
    const results = await processEvent(harness.ir, payload, { workspaceRoot: harness.root, plugins: options.plugin, webhook: options.webhook, resume: options.resume });
    console.log(JSON.stringify({ results }));
    if (results.some(result => result.status === "failed")) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Event processing failed");
    process.exitCode = 1;
  }
}
