import { describe, it, expect } from "vitest";
import { mapModel, MODEL_MAP } from "../../../src/providers/archon/models.js";

describe("archon models — mapModel", () => {
  it("maps canonical Anthropic IDs to Archon short forms", () => {
    expect(mapModel("anthropic/claude-sonnet-4-6")).toEqual({
      value: "sonnet",
      mapped: true,
    });
    expect(mapModel("anthropic/claude-haiku-4-5")).toEqual({
      value: "haiku",
      mapped: true,
    });
  });

  it("is idempotent for already-short names", () => {
    expect(mapModel("sonnet")).toEqual({ value: "sonnet", mapped: true });
    expect(mapModel("haiku")).toEqual({ value: "haiku", mapped: true });
  });

  it("preserves fully-qualified Archon-native IDs", () => {
    expect(mapModel("claude-opus-4-6[1m]")).toEqual({
      value: "claude-opus-4-6[1m]",
      mapped: true,
    });
  });

  it("marks unknown models as not mapped but returns the original", () => {
    const result = mapModel("openai/gpt-5");
    expect(result.mapped).toBe(false);
    expect(result.value).toBe("openai/gpt-5");
  });

  it("every MODEL_MAP value is a non-empty string", () => {
    for (const [key, value] of Object.entries(MODEL_MAP)) {
      expect(typeof value).toBe("string");
      expect(value.length).toBeGreaterThan(0);
      expect(key.length).toBeGreaterThan(0);
    }
  });
});
