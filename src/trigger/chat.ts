import { chat } from "@trigger.dev/sdk/ai";
import { streamText, stepCountIs } from "ai";
import { anthropic } from "@ai-sdk/anthropic";

export const myChat = chat.agent({
  id: "my-chat",
  run: async ({ messages, signal }) => {
    return streamText({
      // Spread chat.toStreamTextOptions() FIRST — it wires up
      // prepareStep (compaction, steering, background injection),
      // the system prompt set via chat.prompt(), and telemetry.
      // Skipping this is the single most common cause of subtle
      // bugs (silent broken compaction, missing steering, etc.).
      ...chat.toStreamTextOptions(),
      model: anthropic("claude-sonnet-4-5"),
      messages,
      abortSignal: signal,
      stopWhen: stepCountIs(15),
    });
  },
});