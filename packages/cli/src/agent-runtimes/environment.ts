import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, chmod, copyFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { RuntimeInstance } from "./interface.js";

/** Builds target-local runtime state without writing operational data into the repository. */
export async function prepareRuntimeEnvironment(
  instance: RuntimeInstance,
  workspaceRoot: string,
  baseEnv: NodeJS.ProcessEnv = process.env,
): Promise<NodeJS.ProcessEnv> {
  const env = { ...baseEnv };
  if (instance.protocol !== "codex-app-server/v1") return env;

  const stateRoot = env.HARNESSFILE_STATE_DIR ?? join(homedir(), ".harnessfile");
  const workspaceId = createHash("sha256")
    .update(`${workspaceRoot}\0${instance.id}`)
    .digest("hex")
    .slice(0, 20);
  const codexHome = join(stateRoot, "runtime-state", workspaceId, "codex");
  await mkdir(codexHome, { recursive: true, mode: 0o700 });

  const sourceHome = env.CODEX_HOME ?? join(homedir(), ".codex");
  await seedFile(join(sourceHome, "auth.json"), join(codexHome, "auth.json"));
  await seedFile(join(sourceHome, "config.toml"), join(codexHome, "config.toml"));
  env.CODEX_HOME = codexHome;
  return env;
}

async function seedFile(source: string, destination: string): Promise<void> {
  try {
    await access(destination, constants.F_OK);
    return;
  } catch {
    // Seed the isolated home from the user's existing CLI configuration.
  }
  try {
    await copyFile(source, destination, constants.COPYFILE_EXCL);
    await chmod(destination, 0o600);
  } catch {
    // Missing source files are valid when the CLI uses another authentication mechanism.
  }
}
