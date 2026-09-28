import { createRequire } from "node:module";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { ProviderRef } from "../ir/types.js";
import type { AgentRuntimeDriver } from "../agent-runtimes/interface.js";
import type { SyncAdapter } from "../sync/types.js";
import type { FactoryContext, ProviderPlugin, ProviderRegistrar, ServiceFactory, ServiceKind, ServiceTypes } from "./contracts.js";

export const PROVIDER_ID = /^([a-z0-9-]+\/)?[a-z0-9-]+\/v[0-9]+$/;

export function providerConfig(ref: string | ProviderRef): ProviderRef {
  return typeof ref === "string" ? { type: ref } : ref;
}

/** Registrations are scoped to one host. No process-global plugin state. */
export class ServiceRegistry implements ProviderRegistrar {
  private factories = new Map<string, ServiceFactory<ServiceKind>>();
  private drivers = new Map<string, AgentRuntimeDriver>();
  private adapters = new Map<string, SyncAdapter>();

  register<K extends ServiceKind>(kind: K, id: string, factory: ServiceFactory<K>): void {
    if (!["orchestration", "execution", "project-management", "identity", "task-memory"].includes(kind)) {
      throw new Error(`Unknown service kind '${kind}'`);
    }
    if (!PROVIDER_ID.test(id)) throw new Error(`Invalid provider ID '${id}'`);
    const key = `${kind}:${id}`;
    if (this.factories.has(key)) throw new Error(`Duplicate provider '${key}'`);
    this.factories.set(key, factory);
  }

  registerRuntime(driver: AgentRuntimeDriver): void {
    if (!/^[a-z0-9-]+\/v[0-9]+$/.test(driver.protocol)) throw new Error(`Invalid runtime protocol '${driver.protocol}'`);
    if (this.drivers.has(driver.protocol)) throw new Error(`Duplicate runtime protocol '${driver.protocol}'`);
    this.drivers.set(driver.protocol, driver);
  }

  registerSync(adapter: SyncAdapter): void {
    if (!PROVIDER_ID.test(adapter.provider)) throw new Error(`Invalid sync provider '${adapter.provider}'`);
    if (this.adapters.has(adapter.provider)) throw new Error(`Duplicate sync provider '${adapter.provider}'`);
    this.adapters.set(adapter.provider, adapter);
  }

  runtimeDrivers(): AgentRuntimeDriver[] { return [...this.drivers.values()]; }
  syncAdapters(): SyncAdapter[] { return [...this.adapters.values()]; }

  assertAvailable(kind: ServiceKind, ref: string | ProviderRef): void {
    const id = providerConfig(ref).type;
    if (!this.factories.has(`${kind}:${id}`)) {
      throw new Error(`No ${kind} provider '${id}'. Load its package with --plugin <module>.`);
    }
  }

  async create<K extends ServiceKind>(kind: K, ref: string | ProviderRef, context: FactoryContext): Promise<ServiceTypes[K]> {
    this.assertAvailable(kind, ref);
    const config = providerConfig(ref);
    return await this.factories.get(`${kind}:${config.type}`)!(config, context) as ServiceTypes[K];
  }
}

/** Explicit host opt-in: validation or opening a repository never auto-imports its code. */
export async function loadPlugins(registry: ServiceRegistry, modules: string[], root = process.cwd()): Promise<void> {
  const require = createRequire(resolve(root, "package.json"));
  for (const specifier of modules) {
    const path = isAbsolute(specifier) || specifier.startsWith(".")
      ? resolve(root, specifier)
      : require.resolve(specifier);
    const module = await import(pathToFileURL(path).href);
    const plugin = module.default as ProviderPlugin | undefined;
    if (plugin?.apiVersion !== 1 || typeof plugin.register !== "function") {
      throw new Error(`Plugin '${specifier}' must default-export { apiVersion: 1, register }`);
    }
    await plugin.register(registry);
  }
}
