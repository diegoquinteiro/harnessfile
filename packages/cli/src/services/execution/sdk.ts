import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { FactoryContext } from "../contracts.js";
import type { ProviderRef } from "../../ir/types.js";

/** Optional SDKs can be installed beside the harness or beside the CLI. */
export async function optionalSdk<T>(name: string, root: string): Promise<T> {
  let location: string;
  try { location = createRequire(resolve(root, "package.json")).resolve(name); }
  catch {
    try { location = createRequire(import.meta.url).resolve(name); }
    catch { throw new Error(`Remote execution requires optional SDK '${name}'. Run npm install ${name} in the harness workspace.`); }
  }
  return await import(pathToFileURL(location).href) as T;
}

export function stringOption(ref: ProviderRef, key: string, fallback?: string): string {
  const value = ref[key] ?? fallback;
  if (typeof value !== "string" || !value || value.includes("\0")) throw new Error(`${ref.type} requires a nonempty '${key}'`);
  return value;
}

export async function credential(context: FactoryContext, ref: ProviderRef, key: string, fallback: string): Promise<string> {
  return context.secret(stringOption(ref, key, fallback));
}
