import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { substituteVariables } from "./variables.js";

// Parses a YAML file with Docker Compose-style ${VAR} substitution applied to the
// raw text before parsing. Used for harness.yaml; directory resolution lives in
// directory.ts.

export function parseHarnessfile(
  filePath: string,
  env?: Record<string, string | undefined>,
): unknown {
  const raw = readFileSync(filePath, "utf-8");
  const substituted = substituteVariables(raw, env);
  const parsed = parseYaml(substituted);
  if (parsed == null || typeof parsed !== "object") {
    throw new Error(`Invalid harness file: expected a YAML mapping at root`);
  }
  return parsed;
}
