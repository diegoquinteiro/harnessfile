import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "@langchain/openai";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

// Maps a harnessfile model string (e.g., "anthropic/claude-sonnet-4-6")
// to a LangChain chat model instance.

const PROVIDER_MAP: Record<
  string,
  (modelName: string) => BaseChatModel
> = {
  anthropic: (modelName) => new ChatAnthropic({ model: modelName }),
  openai: (modelName) => new ChatOpenAI({ model: modelName }),
};

export function createChatModel(modelSpec: string): BaseChatModel {
  const slashIndex = modelSpec.indexOf("/");
  if (slashIndex === -1) {
    throw new Error(
      `Invalid model format '${modelSpec}'. Expected 'provider/model-name' (e.g., 'anthropic/claude-sonnet-4-6').`,
    );
  }

  const providerName = modelSpec.slice(0, slashIndex);
  const modelName = modelSpec.slice(slashIndex + 1);

  const factory = PROVIDER_MAP[providerName];
  if (!factory) {
    const supported = Object.keys(PROVIDER_MAP).join(", ");
    throw new Error(
      `Unsupported model provider '${providerName}'. Supported: ${supported}.`,
    );
  }

  return factory(modelName);
}
