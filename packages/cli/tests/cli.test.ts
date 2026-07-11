import { describe, it, expect } from "vitest";
import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const CLI = resolve(import.meta.dirname, "../bin/harnessfile.ts");
const FIXTURES = resolve(import.meta.dirname, "fixtures");
const ALTAVOX = resolve(import.meta.dirname, "../../../examples/altavox");

function run(args: string[]): { stdout: string; exitCode: number } {
  try {
    const stdout = execFileSync("npx", ["tsx", CLI, ...args], {
      encoding: "utf-8",
      timeout: 30000,
      env: { ...process.env, NODE_NO_WARNINGS: "1" },
    });
    return { stdout, exitCode: 0 };
  } catch (error: any) {
    return {
      stdout: (error.stdout ?? "") + (error.stderr ?? ""),
      exitCode: error.status ?? 1,
    };
  }
}

// ---- CLI help and version ----

describe("CLI — help and version", () => {
  it("shows help text", () => {
    const { stdout, exitCode } = run(["--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("harnessfile");
    expect(stdout).toContain("up");
    expect(stdout).toContain("validate");
    expect(stdout).toContain("sync");
    expect(stdout).toContain("status");
  });

  it("shows version", () => {
    const { stdout, exitCode } = run(["--version"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("0.2.0");
  });

  it("shows up command help", () => {
    const { stdout, exitCode } = run(["up", "--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("--provider");
    expect(stdout).toContain("--port");
    expect(stdout).toContain("--gate-port");
    expect(stdout).toContain("--watch");
    expect(stdout).toContain("--checkpointer");
  });

  it("shows sync command help", () => {
    const { stdout, exitCode } = run(["sync", "--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("--target");
    expect(stdout).toContain("--apply");
    expect(stdout).toContain("--prune");
    expect(stdout).toContain("dry-run by default");
  });
});

// ---- validate command ----

describe("CLI — validate", () => {
  for (const fixture of [
    "minimal",
    "pipeline",
    "gate",
    "router",
    "fanout",
    "eval-loop",
    "full",
    "squad",
    "scheduled-trigger",
    "targets",
  ]) {
    it(`validates the ${fixture} fixture directory`, () => {
      const { stdout, exitCode } = run([
        "validate",
        resolve(FIXTURES, fixture),
      ]);
      expect(exitCode).toBe(0);
      expect(stdout).toContain("Harness is valid");
    });
  }

  it("validates a direct harness.yaml path", () => {
    const { exitCode } = run([
      "validate",
      resolve(FIXTURES, "minimal/harness.yaml"),
    ]);
    expect(exitCode).toBe(0);
  });

  it("validates with provider compatibility check", () => {
    const { stdout, exitCode } = run([
      "validate",
      resolve(FIXTURES, "pipeline"),
      "--provider",
      "langgraph",
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Compatible with provider");
  });

  it("fails on invalid references", () => {
    const { stdout, exitCode } = run([
      "validate",
      resolve(FIXTURES, "invalid-refs"),
    ]);
    expect(exitCode).toBe(1);
    expect(stdout).toContain("nonexistent-agent");
    expect(stdout).toContain("nonexistent-squad");
  });

  it("fails on invalid cycle", () => {
    const { stdout, exitCode } = run([
      "validate",
      resolve(FIXTURES, "cycle"),
    ]);
    expect(exitCode).toBe(1);
    expect(stdout).toContain("Cycle detected");
  });

  it("fails on missing prompt file", () => {
    const { stdout, exitCode } = run([
      "validate",
      resolve(FIXTURES, "broken-prompt"),
    ]);
    expect(exitCode).toBe(1);
    expect(stdout).toContain("prompt file not found");
  });

  it("fails on non-existent path", () => {
    const { stdout, exitCode } = run(["validate", "/tmp/nonexistent-dir"]);
    expect(exitCode).toBe(1);
    expect(stdout).toContain("not found");
  });

  it("validates the AltaVox example (project root with .agents/)", () => {
    const { stdout, exitCode } = run(["validate", ALTAVOX]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("10 agent(s)");
    expect(stdout).toContain("1 squad(s)");
    expect(stdout).toContain("8 skill(s)");
    expect(stdout).toContain("Harness is valid");
  });
});

// ---- sync command ----

describe("CLI — sync", () => {
  it("dry-runs a codex sync of the AltaVox example", () => {
    const { stdout, exitCode } = run([
      "sync",
      ALTAVOX,
      "--target",
      "codex",
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("DRY RUN");
    expect(stdout).toContain(".codex/agents/engineer.toml");
    expect(stdout).toContain("Dry run complete");
    // Dry run never writes
    expect(existsSync(join(ALTAVOX, ".codex"))).toBe(false);
  });

  it("requires --target", () => {
    const { exitCode, stdout } = run(["sync", ALTAVOX]);
    expect(exitCode).not.toBe(0);
    expect(stdout).toContain("--target");
  });

  it("fails for an unknown target", () => {
    const { stdout, exitCode } = run([
      "sync",
      ALTAVOX,
      "--target",
      "nope",
    ]);
    expect(exitCode).toBe(1);
    expect(stdout).toContain("not defined");
  });

  it("applies a claude-code sync in a scratch copy", () => {
    const dir = mkdtempSync(join(tmpdir(), "harnessfile-cli-sync-"));
    try {
      cpSync(resolve(FIXTURES, "sync-plan"), dir, { recursive: true });
      const { stdout, exitCode } = run([
        "sync",
        dir,
        "--target",
        "claude-code",
        "--apply",
      ]);
      expect(exitCode).toBe(0);
      expect(stdout).toContain("APPLY");
      expect(existsSync(join(dir, ".claude", "agents"))).toBe(true);
      expect(existsSync(join(dir, ".claude", "skills"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---- status command ----

describe("CLI — status", () => {
  it("fails when no server is running", () => {
    const { exitCode, stdout } = run(["status", "--port", "19999"]);
    expect(exitCode).toBe(1);
    expect(stdout).toContain("Cannot connect");
  });
});
