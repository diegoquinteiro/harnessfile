// Harnessfile → Archon model name mapping.
//
// Harnessfile uses fully-qualified model IDs (e.g., "anthropic/claude-sonnet-4-6")
// following the provider/model convention from D6/D7. Archon uses short aliases
// (sonnet, haiku, opus) because it assumes Claude as the LLM provider.
//
// Any model ID not found here falls through unchanged — Archon accepts arbitrary
// strings for `model:`, and some fixtures use fully-qualified IDs like
// "claude-opus-4-6[1m]" directly, so passthrough is the safest default.

export const MODEL_MAP: Record<string, string> = {
  // Canonical Harnessfile form → Archon short form
  "anthropic/claude-sonnet-4-6": "sonnet",
  "anthropic/claude-sonnet-4": "sonnet",
  "anthropic/claude-haiku-4-5": "haiku",
  "anthropic/claude-haiku-4": "haiku",
  "anthropic/claude-opus-4-6": "opus",
  "anthropic/claude-opus-4": "opus",
  // Short forms passthrough (noop but explicit)
  sonnet: "sonnet",
  haiku: "haiku",
  opus: "opus",
  // Fully-qualified archon-native IDs passed through verbatim
  "claude-opus-4-6[1m]": "claude-opus-4-6[1m]",
  "claude-opus-4-6": "claude-opus-4-6",
  "claude-sonnet-4-6": "claude-sonnet-4-6",
  "claude-haiku-4-5": "claude-haiku-4-5",
};

export interface ModelMapResult {
  value: string;
  mapped: boolean;
}

/**
 * Translate a Harnessfile model ID to its Archon equivalent. Returns the
 * original string when no mapping exists (signals passthrough with a warning
 * opportunity for the caller).
 */
export function mapModel(harnessModel: string): ModelMapResult {
  if (harnessModel in MODEL_MAP) {
    return { value: MODEL_MAP[harnessModel], mapped: true };
  }
  return { value: harnessModel, mapped: false };
}
