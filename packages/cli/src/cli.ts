import { Command } from "commander";
import { up } from "./commands/up.js";
import { validate } from "./commands/validate.js";
import { status } from "./commands/status.js";
import { sync } from "./commands/sync.js";

export function createCli(): Command {
  const program = new Command();

  program
    .name("harnessfile")
    .description("CLI for Harnessfile — vendor-neutral AI agent harness specification (.agents/ directory)")
    .version("0.2.0");

  program
    .command("up")
    .description("Start the harness server")
    .argument("[path]", "Path to the .agents/ directory or the project root (default: cwd)")
    .option("-p, --provider <name>", "Override the orchestration provider")
    .option("--plugin <module>", "Load a trusted provider package or module (repeatable)", collectPlugin, [])
    .option("--port <port>", "Webhook trigger port", "8080")
    .option("--gate-port <port>", "Gate resolver port", "8081")
    .option("-w, --watch", "Restart on harness changes")
    .option("--checkpointer <type>", "Checkpointer backend (memory|sqlite)", "memory")
    .action(up);

  program
    .command("validate")
    .description("Validate a harness (.agents/ directory) without executing")
    .argument("[path]", "Path to the .agents/ directory or the project root (default: cwd)")
    .option("-p, --provider <name>", "Check provider compatibility")
    .option("--plugin <module>", "Load a trusted provider package or module (repeatable)", collectPlugin, [])
    .action(validate);

  program
    .command("sync")
    .description("Compile/push the harness definition to a target (dry-run by default)")
    .argument("[path]", "Path to the .agents/ directory or the project root (default: cwd)")
    .requiredOption("-t, --target <name>", "Target name from harness.yaml targets")
    .option("--apply", "Execute the plan (default: dry run)")
    .option("--prune", "Include destructive remote deletions in the plan (default: skip them)")
    .option("--plugin <module>", "Load a trusted provider package or module (repeatable)", collectPlugin, [])
    .action(sync);

  program
    .command("status")
    .description("Show running harness state")
    .option("--port <port>", "Gate resolver port to query", "8081")
    .action(status);

  return program;
}

function collectPlugin(value: string, previous: string[]): string[] {
  return [...previous, value];
}
