# 02 — Agent architecture: use the SDK's chat primitives

**Status:** Accepted
**Date:** 2026-07-17
**Related:** [01](./01-dataset-hacker-news.md), [03](./03-oltp-olap-split.md)

## Context

Trigger.dev SDK **4.5.4** is already installed in this repo. Inspecting its exports turned up primitives built for exactly this theme:

| Export | Contents |
|---|---|
| `@trigger.dev/sdk/ai` | `chatAgent`, `pipeChat`, tool calling, agent skills runtime |
| `@trigger.dev/sdk/chat` | `TriggerChatTransport` — drops into the Vercel AI SDK's `useChat` |
| `@trigger.dev/sdk/chat/react` | React bindings |
| `@trigger.dev/sdk/chat-server` | Server-side helpers |

The module docs are explicit: `/chat` is the browser-safe transport for `useChat`; `/ai` holds the backend `chatAgent` and `pipeChat` helpers.

The alternative was hand-rolling the agent loop on raw `task()` calls.

## Decision

**Build on `chatAgent` / `pipeChat` with `TriggerChatTransport` on the frontend. Do not hand-roll the agent loop.**

Hand-rolling would be more work *and* score worse on the 25% tool-usage criterion. These primitives are the intended path for this theme; using them is the strongest available evidence that Trigger.dev is load-bearing.

## How Trigger.dev earns its 25%

The failure mode is Trigger.dev reduced to a wrapper around one LLM call — something a `POST` handler could do. We avoid that with four distinct uses, each mapping to a real requirement:

1. **Scheduled ingest** — pull new HN items from the Firebase API continuously. This is what makes the data layer real-time.
2. **Fan-out batch embedding** — embed new posts in batches with retries. `trigger.config.ts` already enables retries (3 attempts, exponential backoff, `enabledInDev: true`).
3. **Realtime streaming** — stream agent tokens and partial results to the frontend via the transport.
4. **Self-correcting SQL loop** — the agent writes its own SQL against the schema; errors feed back and it retries. Trigger.dev's retry and waitpoint machinery runs the loop rather than us reimplementing it.

Each is a background job that genuinely cannot live in a request handler. That's the argument.

## Consequences

**Good:** less code, and the code we do write is the code judges want to see. The retry config we inherited is already correct for the embedding fan-out.

**Risk — SDK surface is new.** These exports are recent and the API may differ from any examples we find. Read the bundled type definitions in `node_modules/@trigger.dev/sdk/dist/commonjs/v3/{ai,chat}.d.ts` as the source of truth over blog posts.

**Risk — AI SDK coupling.** `TriggerChatTransport` targets the Vercel AI SDK's `useChat`. That effectively picks our frontend stack. Acceptable, but it is a decision we are making implicitly here.

**Note:** `trigger.config.ts` imports from `@trigger.dev/sdk/v3` while the installed package is v4.5.4. The `./v3` export still resolves in 4.5.4, so this works — it is the compatibility alias, not a mistake. Leave it unless something breaks.
