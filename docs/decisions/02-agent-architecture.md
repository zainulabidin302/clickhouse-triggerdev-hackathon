# 02 — Agent architecture: build on `chat.agent`

**Status:** Accepted — **revised 2026-07-17**, the original named APIs that do not exist
**Date:** 2026-07-17
**Related:** [01](./01-dataset-hacker-news.md), [03](./03-session-storage.md), [05](./05-hybrid-retrieval.md)

## Context

Trigger.dev SDK **4.5.4** is installed. AI Agents went GA in 4.5.0, and the SDK ships primitives built for this exact theme. The alternative was hand-rolling the agent loop on raw `task()` calls.

**There is also an official ClickHouse chat agent example**: https://github.com/triggerdotdev/examples/tree/main/clickhouse-chat-agent — `chat.agent()` + ClickHouse + Next.js + generative UI. It is the hackathon brief, shipped by one of the hosts.

## Decision

**Build on `chat.agent()`. Do not hand-roll the agent loop.**

Hand-rolling would be more work *and* score worse on the 25% tool-usage criterion. These primitives are the intended path; using them is the strongest evidence Trigger.dev is load-bearing.

### The actual API

| Purpose | API | Import |
|---|---|---|
| Define an agent | `chat.agent({ id, run })` | `@trigger.dev/sdk/ai` |
| Pipe a stream you can't `return` | `chat.pipe(result)` — *inside* an agent | `@trigger.dev/sdk/ai` |
| Task-backed AI tool | `ai.toolExecute(task)` (`ai.tool()` is deprecated) | `@trigger.dev/sdk/ai` |
| Frontend transport | `useTriggerChatTransport` | `@trigger.dev/sdk/chat/react` |

Docs: `/docs/ai-chat/*`. Machine-readable index: https://trigger.dev/docs/llms.txt

```ts
export const myChat = chat.agent({
  id: "my-chat",
  run: async ({ messages, signal }) => {
    return streamText({
      ...chat.toStreamTextOptions(),   // MUST be spread, and spread FIRST
      model: anthropic("claude-sonnet-4-5"),
      messages,
      abortSignal: signal,             // or stop/cancel won't work
      stopWhen: stepCountIs(15),
    });
  },
});
```

### Correction: the original named three APIs that never existed

The first draft of this decision specified `chatAgent`, `pipeChat`, and `toolTask`. **None of them exist.** They were inferred from internal symbols in the bundled `.d.ts` files and mistaken for the public surface. The mapping to reality is the table above.

The lesson, now recorded in `CLAUDE.md`: type definitions are authoritative for *behavior*, not for *what the public API is called*. Use the docs and the installed agent skills (`.claude/skills/trigger-*`), which are version-pinned to the SDK. Most blog content is v3-era and actively misleading.

## How Trigger.dev earns its 25%

The failure mode is Trigger.dev as a wrapper around one LLM call. Four uses, each a background job that genuinely cannot live in a request handler:

1. **Scheduled ingest** — `schedules.task({ cron })` pulling new HN items. This is what makes the data layer real-time. Note: dev schedules only fire while `npm run dev` is running, and a scheduled task with no attached schedule fires *never*, silently.
2. **Fan-out batch embedding** — `batchTriggerAndWait`, max 1,000 items/call. Does not throw on child failure; each result carries its own status. Retries are already enabled in `trigger.config.ts` (3 attempts, `enabledInDev: true`).
3. **Realtime streaming** — agent tokens to the frontend via the transport.
4. **Task-backed tools** — `ai.toolExecute()`. See below; this is the important one.

## `ai.toolExecute` is the load-bearing piece

A `schemaTask` becomes an AI SDK tool that runs as a **real subtask** — its own run, own trace span, own retry config, own queue — with Zod validation enforced *before* our code runs.

This is what makes [05](./05-hybrid-retrieval.md) implementable. That decision requires the filter-strategy logic to live in the tool rather than the prompt, because an LLM will happily emit the naive query that silently truncates. `ai.toolExecute` is that seam: the agent cannot emit raw SQL if the only thing it can reach is our tool.

**Open design question.** The official example lets the model write SQL and guards it (regex allowlist + `readonly: "2"` + `max_result_rows` + `max_execution_time`), returning ClickHouse errors *to the model* so it self-corrects. The tighter alternative exposes only structured intent (`z.enum` of metrics/filters) and builds SQL ourselves. Open-ended questions demo better; structured intent is safer. Decide against the example once it has been read.

## Consequences

**Good:** less code, and it's the code judges want to see. The retry config we inherited already suits the embedding fan-out.

**Risk — the example is the reference implementation.** Judges have likely seen `clickhouse-chat-agent`. Forking it is sensible; shipping it with a different table scores nothing on innovation (20%). **Differentiate on the data layer and the interaction** — that's [01](./01-dataset-hacker-news.md)'s hybrid retrieval, not the plumbing.

**Risk — `chat.toStreamTextOptions()` must be spread first.** It wires `prepareStep`; omit it and compaction, steering, and injection silently no-op. Model precedence inverts around the spread: a *fallback* model goes before it, a *client-selected* model after.

**Risk — frontend stack is now chosen.** `useTriggerChatTransport` targets the Vercel AI SDK's `useChat`. Accepted, but it was decided here.

**Risk — default machine OOMs.** `small-1x` is 0.5 vCPU / 0.5 GB; the ONNX model needs `medium-1x`+. Set it per-task, not globally — Free plan gives $5/month of compute credits, which is the binding constraint. Also raise `idleTimeoutInSeconds` (default 30) — the official example uses 300, because long analytical queries otherwise kill the chat.