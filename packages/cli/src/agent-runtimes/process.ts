import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";

export interface ProcessInvocation {
  command: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface ProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  signal?: NodeJS.Signals;
  timedOut: boolean;
  cancelled: boolean;
}

export interface ProcessHandle {
  readonly stdout: AsyncIterable<string>;
  readonly stderr: AsyncIterable<string>;
  readonly result: Promise<ProcessResult>;
  write(data: string): void;
  end(): void;
  cancel(): Promise<void>;
}

export interface ProcessRunner {
  start(invocation: ProcessInvocation): ProcessHandle;
}

class AsyncQueue<T> implements AsyncIterable<T> {
  private values: T[] = [];
  private waiters: Array<(value: IteratorResult<T>) => void> = [];
  private closed = false;

  constructor(private maxSize = Number.POSITIVE_INFINITY) {}

  push(value: T): void {
    if (this.closed) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value, done: false });
    else {
      if (this.values.length >= this.maxSize) this.values.shift();
      this.values.push(value);
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) waiter({ value: undefined as T, done: true });
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const value = this.values.shift();
        if (value !== undefined) return Promise.resolve({ value, done: false });
        if (this.closed) return Promise.resolve({ value: undefined as T, done: true });
        return new Promise((resolve) => this.waiters.push(resolve));
      },
    };
  }
}

export class SpawnProcessRunner implements ProcessRunner {
  start(invocation: ProcessInvocation): ProcessHandle {
    const child = spawn(invocation.command, invocation.args, {
      cwd: invocation.cwd,
      env: invocation.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    return new SpawnedProcess(child, invocation);
  }
}

class SpawnedProcess implements ProcessHandle {
  private stdoutQueue = new AsyncQueue<string>();
  private stderrQueue = new AsyncQueue<string>();
  private stdoutBuffer = "";
  private stderrBuffer = "";
  private settled = false;
  private timeout?: NodeJS.Timeout;
  private cancelled = false;
  private timedOut = false;
  readonly result: Promise<ProcessResult>;

  constructor(
    private child: ChildProcessWithoutNullStreams,
    invocation: ProcessInvocation,
  ) {
    child.stdout.setEncoding("utf-8");
    child.stderr.setEncoding("utf-8");
    child.stdout.on("data", (chunk: string) => {
      this.stdoutBuffer = boundedTail(this.stdoutBuffer + chunk, 1024 * 1024);
      this.stdoutQueue.push(chunk);
    });
    child.stderr.on("data", (chunk: string) => {
      this.stderrBuffer = boundedTail(this.stderrBuffer + chunk);
      this.stderrQueue.push(chunk);
    });

    this.result = new Promise((resolve, reject) => {
      child.once("error", (error) => {
        this.settled = true;
        if (this.timeout) clearTimeout(this.timeout);
        invocation.signal?.removeEventListener("abort", this.abortListener);
        this.stdoutQueue.close();
        this.stderrQueue.close();
        reject(error);
      });
      child.once("close", (code, signal) => {
        this.settled = true;
        if (this.timeout) clearTimeout(this.timeout);
        invocation.signal?.removeEventListener("abort", this.abortListener);
        this.stdoutQueue.close();
        this.stderrQueue.close();
        resolve({
          stdout: this.stdoutBuffer,
          stderr: this.stderrBuffer,
          exitCode: code ?? (this.cancelled ? 130 : 1),
          signal: signal ?? undefined,
          timedOut: this.timedOut,
          cancelled: this.cancelled,
        });
      });
    });

    if (invocation.timeoutMs && invocation.timeoutMs > 0) {
      this.timeout = setTimeout(() => {
        this.timedOut = true;
        void this.cancel();
      }, invocation.timeoutMs);
    }
    if (invocation.signal) {
      if (invocation.signal.aborted) void this.cancel();
      else invocation.signal.addEventListener("abort", this.abortListener, { once: true });
    }
  }

  get stdout(): AsyncIterable<string> {
    return this.stdoutQueue;
  }

  get stderr(): AsyncIterable<string> {
    return this.stderrQueue;
  }

  write(data: string): void {
    if (!this.child.stdin.destroyed) this.child.stdin.write(data);
  }

  end(): void {
    if (!this.child.stdin.destroyed) this.child.stdin.end();
  }

  async cancel(): Promise<void> {
    if (this.settled) return;
    this.cancelled = true;
    const pid = this.child.pid;
    if (pid) {
      try {
        if (process.platform === "win32") this.child.kill("SIGKILL");
        else process.kill(-pid, "SIGKILL");
      } catch {
        this.child.kill("SIGKILL");
      }
    }
    await this.result.catch(() => undefined);
  }

  private abortListener = (): void => {
    void this.cancel();
  };
}

export async function resolveExecutable(command: string, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  if (isAbsolute(command) || command.includes("/")) {
    await access(command, constants.X_OK);
    return command;
  }
  const extensions = process.platform === "win32"
    ? (env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";")
    : [""];
  for (const directory of (env.PATH ?? "").split(delimiter)) {
    if (!directory) continue;
    for (const extension of extensions) {
      const candidate = join(directory, `${command}${extension}`);
      try {
        await access(candidate, constants.X_OK);
        return candidate;
      } catch {
        // Continue searching PATH.
      }
    }
  }
  throw new Error(`Executable '${command}' was not found on PATH`);
}

export function lines(chunks: AsyncIterable<string>): AsyncIterable<string> {
  return (async function* () {
    let pending = "";
    for await (const chunk of chunks) {
      pending += chunk;
      const parts = pending.split(/\r?\n/);
      pending = parts.pop() ?? "";
      for (const line of parts) yield line;
    }
    if (pending) yield pending;
  })();
}

export function assertSuccessfulProcess(label: string, result: ProcessResult): void {
  if (result.exitCode === 0) return;
  const detail = result.stderr.trim() || result.stdout.trim() || "no output";
  throw new Error(`${label} failed with exit code ${result.exitCode}: ${detail}`);
}

export async function detectExecutableVersion(
  runner: ProcessRunner,
  command: string,
): Promise<string | undefined> {
  const handle = runner.start({
    command,
    args: ["--version"],
    cwd: process.cwd(),
    timeoutMs: 2_000,
  });
  handle.end();
  try {
    const result = await handle.result;
    if (result.exitCode !== 0) return undefined;
    return result.stdout.trim().split(/\r?\n/, 1)[0] || undefined;
  } catch {
    return undefined;
  }
}

function boundedTail(value: string, maxBytes = 8192): string {
  return value.length <= maxBytes ? value : value.slice(value.length - maxBytes);
}

export { AsyncQueue };
