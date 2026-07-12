import { createHash } from "node:crypto";
import type { RuntimeProfileDef } from "../ir/types.js";
import type {
  AgentRuntimeDriver,
  RuntimeCapabilities,
  RuntimeInstance,
} from "./interface.js";
import { resolveExecutable } from "./process.js";
import { ClaudeCodeRuntimeDriver } from "./drivers/claude-code.js";
import { CodexRuntimeDriver } from "./drivers/codex.js";

export function builtinRuntimeDrivers(): AgentRuntimeDriver[] {
  return [new ClaudeCodeRuntimeDriver(), new CodexRuntimeDriver()];
}

export interface LocalRuntimeRegistryOptions {
  drivers?: AgentRuntimeDriver[];
}

export interface RuntimeDiscoveryResult {
  profileName: string;
  status: "online" | "offline";
  instance?: RuntimeInstance;
  error?: string;
}

/** Resolves portable profiles to concrete, host-local runtime instances. */
export class LocalRuntimeRegistry {
  private drivers: Map<string, AgentRuntimeDriver>;
  private instances = new Map<string, RuntimeInstance>();

  constructor(options: LocalRuntimeRegistryOptions = {}) {
    this.drivers = new Map(
      (options.drivers ?? builtinRuntimeDrivers()).map((driver) => [driver.protocol, driver]),
    );
  }

  driver(protocol: string): AgentRuntimeDriver | undefined {
    return this.drivers.get(protocol);
  }

  protocols(): string[] {
    return [...this.drivers.keys()];
  }

  async discover(
    profiles: Record<string, RuntimeProfileDef>,
  ): Promise<RuntimeDiscoveryResult[]> {
    return Promise.all(Object.entries(profiles).map(async ([profileName, profile]) => {
      try {
        return {
          profileName,
          status: "online" as const,
          instance: await this.resolve(profileName, profile),
        };
      } catch (error) {
        return {
          profileName,
          status: "offline" as const,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }));
  }

  async resolve(profileName: string, profile: RuntimeProfileDef): Promise<RuntimeInstance> {
    const cached = this.instances.get(profileName);
    if (cached) return cached;
    const driver = this.driver(profile.protocol);
    if (!driver) {
      throw new Error(
        `No local runtime driver for protocol '${profile.protocol}'. Available: ${this.protocols().join(", ")}.`,
      );
    }
    const command = await resolveExecutable(profile.command ?? driver.defaultCommand);
    const capabilities = await driver.probe(profileName, { ...profile, command });
    const instance: RuntimeInstance = {
      id: localInstanceId(
        profileName,
        profile.protocol,
        command,
        profile.args ?? [],
        capabilities.version,
      ),
      profileName,
      protocol: profile.protocol,
      command,
      fixedArgs: [...(profile.args ?? [])],
      status: "online",
      capabilities: { ...capabilities, command },
    };
    this.instances.set(profileName, instance);
    return instance;
  }
}

function localInstanceId(
  profileName: string,
  protocol: string,
  command: string,
  args: string[],
  version?: string,
): string {
  const digest = createHash("sha256")
    .update(`${profileName}\0${protocol}\0${command}\0${JSON.stringify(args)}\0${version ?? ""}`)
    .digest("hex")
    .slice(0, 16);
  return `local:${profileName}:${digest}`;
}

export function runtimeProtocol(profile: RuntimeProfileDef | undefined): string {
  return profile?.protocol ?? "";
}
