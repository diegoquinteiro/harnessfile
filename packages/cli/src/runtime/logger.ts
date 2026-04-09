import type { HarnessEvent } from "../providers/interface.js";

// Structured logging for harness execution events.

const COLORS = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
};

export function logEvent(event: HarnessEvent): void {
  const time = event.timestamp.toISOString().slice(11, 23);
  const thread = event.threadId.slice(0, 8);

  switch (event.type) {
    case "run-start":
      console.log(
        `${COLORS.dim}${time}${COLORS.reset} ${COLORS.cyan}[${thread}]${COLORS.reset} ${COLORS.green}▶ Run started${COLORS.reset}`,
      );
      break;

    case "run-end":
      console.log(
        `${COLORS.dim}${time}${COLORS.reset} ${COLORS.cyan}[${thread}]${COLORS.reset} ${COLORS.green}■ Run ended${COLORS.reset}`,
      );
      break;

    case "step-start":
      console.log(
        `${COLORS.dim}${time}${COLORS.reset} ${COLORS.cyan}[${thread}]${COLORS.reset} → ${event.step}`,
      );
      break;

    case "step-end":
      console.log(
        `${COLORS.dim}${time}${COLORS.reset} ${COLORS.cyan}[${thread}]${COLORS.reset} ${COLORS.green}✓${COLORS.reset} ${event.step}`,
      );
      break;

    case "step-error":
      console.log(
        `${COLORS.dim}${time}${COLORS.reset} ${COLORS.cyan}[${thread}]${COLORS.reset} ${COLORS.red}✗ ${event.step}: ${event.data}${COLORS.reset}`,
      );
      break;

    case "gate-pending":
      console.log(
        `${COLORS.dim}${time}${COLORS.reset} ${COLORS.cyan}[${thread}]${COLORS.reset} ${COLORS.yellow}⏸ Gate suspended at ${event.step}${COLORS.reset}`,
      );
      console.log(
        `${COLORS.dim}${time}${COLORS.reset} ${COLORS.cyan}[${thread}]${COLORS.reset} ${COLORS.dim}  Resume: POST /gate/${event.threadId}${COLORS.reset}`,
      );
      break;

    case "gate-resolved":
      console.log(
        `${COLORS.dim}${time}${COLORS.reset} ${COLORS.cyan}[${thread}]${COLORS.reset} ${COLORS.green}▶ Gate approved at ${event.step}${COLORS.reset}`,
      );
      break;

    case "eval":
      console.log(
        `${COLORS.dim}${time}${COLORS.reset} ${COLORS.cyan}[${thread}]${COLORS.reset} ${COLORS.magenta}⊘ Eval: ${event.step}${COLORS.reset}`,
      );
      break;

    case "hook":
      console.log(
        `${COLORS.dim}${time}${COLORS.reset} ${COLORS.cyan}[${thread}]${COLORS.reset} ${COLORS.dim}⚡ Hook: ${event.step}${COLORS.reset}`,
      );
      break;
  }
}

export function logInfo(message: string): void {
  console.log(`  ${COLORS.green}✓${COLORS.reset} ${message}`);
}

export function logWarn(message: string): void {
  console.log(`  ${COLORS.yellow}⚠${COLORS.reset} ${message}`);
}

export function logError(message: string): void {
  console.error(`  ${COLORS.red}✗${COLORS.reset} ${message}`);
}
