import type { HarnessProvider } from "./interface.js";
import { LangGraphProvider } from "./langgraph/index.js";

const providers = new Map<string, HarnessProvider>();

// Register built-in providers
providers.set("langgraph", new LangGraphProvider());

export function getProvider(name: string): HarnessProvider {
  const provider = providers.get(name);
  if (!provider) {
    const available = [...providers.keys()].join(", ");
    throw new Error(
      `Unknown provider '${name}'. Available providers: ${available}`,
    );
  }
  return provider;
}

export function listProviders(): string[] {
  return [...providers.keys()];
}
