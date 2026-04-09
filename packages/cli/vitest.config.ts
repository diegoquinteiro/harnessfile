import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      // Dummy API keys so LangChain model constructors don't throw during tests.
      // No actual API calls are made — these are only used to satisfy constructor validation.
      ANTHROPIC_API_KEY: "test-key-not-real",
      OPENAI_API_KEY: "test-key-not-real",
    },
  },
});
