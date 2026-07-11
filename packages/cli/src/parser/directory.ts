import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { parseHarnessfile } from "./parse.js";
import { splitFrontmatter } from "./frontmatter.js";
import { substituteVariables } from "./variables.js";
import { normalize } from "../ir/normalize.js";
import type { Harnessfile } from "../ir/types.js";

// Resolves and loads a `.agents/` harness directory (spec v0.2, D39).
//
// The path argument may be:
//   - the `.agents/` directory itself (any directory containing harness.yaml)
//   - a project root containing `.agents/harness.yaml`
//   - a direct path to a harness.yaml file
//   - omitted → the current working directory (as a project root, then as the dir itself)

const HARNESS_FILENAME = "harness.yaml";

export interface ResolvedAgentsDir {
  /** Absolute path to the directory containing harness.yaml. */
  agentsDir: string;
  /** Absolute path to harness.yaml. */
  harnessPath: string;
  /** The directory containing the .agents/ dir (sync targets are materialized here). */
  root: string;
}

export interface LoadedHarness extends ResolvedAgentsDir {
  ir: Harnessfile;
  raw: Record<string, unknown>;
}

export function resolveAgentsDir(pathArg?: string): ResolvedAgentsDir {
  const base = resolve(pathArg ?? ".");

  if (!existsSync(base)) {
    throw new Error(`Path not found: ${base}`);
  }

  let agentsDir: string;
  if (statSync(base).isFile()) {
    agentsDir = dirname(base);
  } else if (existsSync(join(base, HARNESS_FILENAME))) {
    agentsDir = base;
  } else if (existsSync(join(base, ".agents", HARNESS_FILENAME))) {
    agentsDir = join(base, ".agents");
  } else {
    throw new Error(
      `No harness found at ${base}. Expected ${HARNESS_FILENAME} in the directory itself or in a .agents/ subdirectory.`,
    );
  }

  const harnessPath = join(agentsDir, HARNESS_FILENAME);
  if (!existsSync(harnessPath)) {
    throw new Error(`Harness file not found: ${harnessPath}`);
  }

  return {
    agentsDir,
    harnessPath,
    root: dirname(agentsDir),
  };
}

export function loadHarnessDirectory(
  pathArg?: string,
  env?: Record<string, string | undefined>,
): LoadedHarness {
  const resolved = resolveAgentsDir(pathArg);
  const { agentsDir, harnessPath } = resolved;

  const raw = parseHarnessfile(harnessPath, env) as Record<string, unknown>;

  // Entity files. Inline `agents:`/`squads:` in harness.yaml are not part of v0.2 —
  // the directory is the source of truth.
  raw["agents"] = loadEntities(join(agentsDir, "agents"), env);
  raw["squads"] = loadEntities(join(agentsDir, "squads"), env);
  raw["skills"] = listSkills(join(agentsDir, "skills"));

  // Resolve trigger prompt file references relative to the .agents/ directory (D41).
  resolvePrompts(raw["triggers"], agentsDir, "triggers", env);
  resolvePrompts(raw["steps"], agentsDir, "steps", env);

  const ir = normalize(raw);
  return { ...resolved, ir, raw };
}

// ---- Entity files (agents/*.md, squads/*.md) ----

function loadEntities(
  dir: string,
  env?: Record<string, string | undefined>,
): Record<string, Record<string, unknown>> {
  const entities: Record<string, Record<string, unknown>> = {};
  if (!existsSync(dir)) return entities;

  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort();

  for (const file of files) {
    const path = join(dir, file);
    const content = substituteVariables(readFileSync(path, "utf-8"), env);
    const { frontmatter, body } = splitFrontmatter(content);
    const slug =
      typeof frontmatter["name"] === "string"
        ? (frontmatter["name"] as string)
        : basename(file, ".md");
    entities[slug] = {
      ...frontmatter,
      name: slug,
      instructions: body.replace(/\s+$/, ""),
    };
  }

  return entities;
}

// ---- Skills (skills/<name>/SKILL.md) ----

function listSkills(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((entry) => {
      const full = join(dir, entry);
      return (
        statSync(full).isDirectory() && existsSync(join(full, "SKILL.md"))
      );
    })
    .sort();
}

// ---- Trigger prompt resolution ----

function resolvePrompts(
  section: unknown,
  agentsDir: string,
  label: string,
  env?: Record<string, string | undefined>,
): void {
  if (section == null || typeof section !== "object") return;
  for (const [name, value] of Object.entries(
    section as Record<string, unknown>,
  )) {
    if (value == null || typeof value !== "object") continue;
    const node = value as Record<string, unknown>;
    const prompt = node["prompt"];
    if (typeof prompt !== "string") continue;
    if (!prompt.startsWith("./") && !prompt.startsWith("../")) continue;

    const promptPath = resolve(agentsDir, prompt);
    if (!existsSync(promptPath)) {
      throw new Error(
        `${label}.${name}: prompt file not found: ${prompt} (resolved to ${promptPath})`,
      );
    }
    node["promptPath"] = prompt;
    node["prompt"] = substituteVariables(
      readFileSync(promptPath, "utf-8"),
      env,
    ).trim();
  }
}
