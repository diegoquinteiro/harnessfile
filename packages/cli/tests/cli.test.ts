import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

const CLI = resolve(import.meta.dirname, "../bin/harnessfile.ts");
const FIXTURES = resolve(import.meta.dirname, "fixtures");
const EXAMPLES = resolve(import.meta.dirname, "../../../examples");

function run(args: string[]): { stdout: string; exitCode: number } {
  try {
    const stdout = execFileSync("npx", ["tsx", CLI, ...args], {
      encoding: "utf-8",
      timeout: 15000,
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
    expect(stdout).toContain("status");
  });

  it("shows version", () => {
    const { stdout, exitCode } = run(["--version"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("0.1.0");
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

  it("shows validate command help", () => {
    const { stdout, exitCode } = run(["validate", "--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("--provider");
  });
});

// ---- validate command ----

describe("CLI — validate", () => {
  it("validates minimal.yaml", () => {
    const { stdout, exitCode } = run([
      "validate",
      resolve(FIXTURES, "minimal.yaml"),
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Harnessfile is valid");
  });

  it("validates pipeline.yaml", () => {
    const { stdout, exitCode } = run([
      "validate",
      resolve(FIXTURES, "pipeline.yaml"),
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Harnessfile is valid");
  });

  it("validates gate.yaml", () => {
    const { stdout, exitCode } = run([
      "validate",
      resolve(FIXTURES, "gate.yaml"),
    ]);
    expect(exitCode).toBe(0);
  });

  it("validates router.yaml", () => {
    const { stdout, exitCode } = run([
      "validate",
      resolve(FIXTURES, "router.yaml"),
    ]);
    expect(exitCode).toBe(0);
  });

  it("validates fanout.yaml", () => {
    const { stdout, exitCode } = run([
      "validate",
      resolve(FIXTURES, "fanout.yaml"),
    ]);
    expect(exitCode).toBe(0);
  });

  it("validates eval-loop.yaml", () => {
    const { stdout, exitCode } = run([
      "validate",
      resolve(FIXTURES, "eval-loop.yaml"),
    ]);
    expect(exitCode).toBe(0);
  });

  it("validates full.yaml", () => {
    const { stdout, exitCode } = run([
      "validate",
      resolve(FIXTURES, "full.yaml"),
    ]);
    expect(exitCode).toBe(0);
  });

  it("validates with provider compatibility check", () => {
    const { stdout, exitCode } = run([
      "validate",
      resolve(FIXTURES, "pipeline.yaml"),
      "--provider",
      "langgraph",
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Compatible with provider");
  });

  it("fails on invalid references", () => {
    const { stdout, exitCode } = run([
      "validate",
      resolve(FIXTURES, "invalid-refs.yaml"),
    ]);
    expect(exitCode).toBe(1);
    expect(stdout).toContain("nonexistent-agent");
  });

  it("fails on invalid cycle", () => {
    const { stdout, exitCode } = run([
      "validate",
      resolve(FIXTURES, "cycle.yaml"),
    ]);
    expect(exitCode).toBe(1);
    expect(stdout).toContain("Cycle detected");
  });

  it("fails on non-existent file", () => {
    const { stdout, exitCode } = run([
      "validate",
      "/tmp/nonexistent.yaml",
    ]);
    expect(exitCode).toBe(1);
    expect(stdout).toContain("not found");
  });

  // ---- Validate all examples from the repo ----

  it("validates examples/minimal.yaml", () => {
    const { exitCode } = run([
      "validate",
      resolve(EXAMPLES, "minimal.yaml"),
    ]);
    expect(exitCode).toBe(0);
  });

  it("validates examples/pipeline.yaml", () => {
    const { exitCode } = run([
      "validate",
      resolve(EXAMPLES, "pipeline.yaml"),
    ]);
    expect(exitCode).toBe(0);
  });

  it("validates examples/gate-example.yaml", () => {
    const { exitCode } = run([
      "validate",
      resolve(EXAMPLES, "gate-example.yaml"),
    ]);
    expect(exitCode).toBe(0);
  });

  it("validates examples/full-pipeline.yaml", () => {
    const { exitCode } = run([
      "validate",
      resolve(EXAMPLES, "full-pipeline.yaml"),
    ]);
    expect(exitCode).toBe(0);
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
