import { Command } from "commander";
import { up } from "./commands/up.js";
import { validate } from "./commands/validate.js";
import { status } from "./commands/status.js";
import { compile } from "./commands/compile.js";

export function createCli(): Command {
  const program = new Command();

  program
    .name("harnessfile")
    .description("Runtime for Harnessfile — vendor-neutral AI agent harness specification")
    .version("0.1.0");

  program
    .command("up")
    .description("Start the harness server")
    .argument("[file]", "Path to harnessfile (default: auto-detect)")
    .option("-p, --provider <name>", "Execution provider", "langgraph")
    .option("--port <port>", "Webhook trigger port", "8080")
    .option("--gate-port <port>", "Gate resolver port", "8081")
    .option("-w, --watch", "Restart on harnessfile changes")
    .option("--checkpointer <type>", "Checkpointer backend (memory|sqlite)", "memory")
    .action(up);

  program
    .command("validate")
    .description("Validate a harnessfile without executing")
    .argument("[file]", "Path to harnessfile (default: auto-detect)")
    .option("-p, --provider <name>", "Check provider compatibility")
    .action(validate);

  program
    .command("status")
    .description("Show running harness state")
    .option("--port <port>", "Gate resolver port to query", "8081")
    .action(status);

  program
    .command("compile")
    .description("Compile a harnessfile to a target format (e.g., Archon workflow YAML)")
    .argument("[file]", "Path to harnessfile (default: auto-detect)")
    .option("-t, --target <target>", "Compile target provider", "archon/v1")
    .option("-o, --out <dir>", "Output directory (default: stdout)")
    .option("--strict", "Fail if any warning (non-info) is produced")
    .option("--json", "Also emit <name>.warnings.json alongside the output file")
    .action(compile);

  return program;
}
