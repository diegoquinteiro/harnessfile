import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { substituteVariables } from "./variables.js";

const DEFAULT_FILENAMES = [
  "harnessfile.yaml",
  "Harnessfile",
  "harnessfile.yml",
];

export function resolveHarnessfilePath(fileArg?: string): string {
  if (fileArg) {
    const resolved = resolve(fileArg);
    if (!existsSync(resolved)) {
      throw new Error(`Harnessfile not found: ${resolved}`);
    }
    return resolved;
  }
  for (const name of DEFAULT_FILENAMES) {
    const path = resolve(name);
    if (existsSync(path)) {
      return path;
    }
  }
  throw new Error(
    `No harnessfile found. Looked for: ${DEFAULT_FILENAMES.join(", ")}`,
  );
}

export function parseHarnessfile(
  filePath: string,
  env?: Record<string, string | undefined>,
): unknown {
  const raw = readFileSync(filePath, "utf-8");
  const substituted = substituteVariables(raw, env);
  const parsed = parseYaml(substituted);
  if (parsed == null || typeof parsed !== "object") {
    throw new Error(`Invalid harnessfile: expected a YAML mapping at root`);
  }
  return parsed;
}
