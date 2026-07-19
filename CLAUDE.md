# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A submission for the **ClickHouse × Trigger.dev Virtual Summer Hackathon 2026**. Solo entry, public repo required, **deadline 23 July midnight AoE**.

Theme: a chat agent that changes how people interact with information — Trigger.dev orchestrates, ClickHouse is the real-time data layer. **Both tools are required by the rules.**

Scoring shapes every decision here. Tool usage is the largest bucket at 25%, and the jury of 10–15 judges builds these tools. Decorative usage — ClickHouse as a table you `SELECT` from once, Trigger.dev as a wrapper around one LLM call — is visible to them and costs a quarter of the score. Full criteria: `docs/reference/event-rules-and-scoring.md`.

## Read the decisions first

`docs/decisions/` holds numbered ADRs. They record *why*, including several conclusions that cost real investigation and contradict the obvious approach. **Read them before proposing architecture changes** — most "obvious" improvements have already been tried and rejected there for a reason.

- `01` — dataset: Hacker News + prebuilt embeddings (28.7M rows), with the confirmed schema
- `02` — agent architecture: use the SDK's chat primitives, don't hand-roll the loop
- `03` — session storage: ClickHouse only, no Postgres (supersedes an earlier draft)
- `04` — embedding model: all-MiniLM-L6-v2 via Transformers.js, and how *not* to test it
- `05` — hybrid retrieval: the filter-strategy trap

`docs/reference/` is durable fact (event rules, dataset evaluation). `docs/archive/` is superseded — don't act on it.

## Commands

```bash
npm run login      # Trigger.dev CLI auth (browser; already authed as zainulabidin302@gmail.com)
npm run dev        # Trigger.dev dev server — watches src/trigger/, gives a dashboard link to fire tasks
npm run deploy     # deploy tasks
npm run typecheck  # tsc --noEmit
```

No test framework is configured. Verification currently happens through the `verify-embeddings` Trigger.dev task, which probes the live corpus.

Query ClickHouse directly:

```bash
CH_PW=$(grep '^CLICKHOUSE_PASSWORD=' .env | cut -d= -f2-)
curl -s --user "default:${CH_PW}" --data-binary "SELECT count() FROM hackernews" \
  'https://t5zzzlrrhg.eu-central-1.aws.clickhouse.cloud:8443'
```

Never `source .env` — read values with `grep | cut`.

## Architecture

The division of labor is the whole point, and it follows from one fact:

**ClickHouse stores and searches vectors. It does not generate them.** Zero of its 1,784 functions do embeddings; the docs say to bring your own. So:

- **Trigger.dev** — generates embeddings, runs scheduled ingest, orchestrates the agent loop
- **ClickHouse** — indexes and searches 28.7M vectors, and holds session state (`03`)

That split is also what makes both tools load-bearing for the 25% criterion, rather than a workaround.

| File | Role |
|---|---|
| `src/clickhouse.ts` | Shared client + `query<T>()`. Env-driven |
| `src/embed.ts` | `all-MiniLM-L6-v2` via Transformers.js → 384-dim vectors |
| `src/trigger/` | Trigger.dev tasks. `trigger.config.ts` scans this dir only |

## Traps

Each of these was hit or nearly hit. They fail **silently** — nothing errors, results just get quietly wrong.

**Embeddings must match the corpus.** The 28.7M vectors are `all-MiniLM-L6-v2` at 384 dims. `pooling: "mean"` and `normalize: true` are load-bearing — omit either and you get 384 floats in the wrong space, with no error. The dgpu `infinity-emb` service (`bge-m3`, 1024 dims) is **incomparable**; using it produces meaningless vectors against the corpus.

**Don't verify embeddings by reproducing stored vectors.** The `text` column is a reconstructed thread window (parent + comment + reply, author-prefixed), not the string that was embedded. Re-embedding it and expecting cosine ≈ 1.0 fails at 0.05–0.86 and proves nothing. Test *retrieval* instead — see `04`.

**Filtered vector search silently truncates.** `WHERE ... ORDER BY cosineDistance(...) LIMIT 10` post-filters by default: the index runs first, the filter is applied to its output, and you get fewer than 10 rows — sometimes zero — even when thousands match. Oversample with `vector_search_index_fetch_multiplier`, or use `prefilter` for selective predicates (which falls back to exact search). See `05`. **This logic belongs in the tool exposed to the agent, not in its prompt** — the agent writes its own SQL and will emit the naive query.

**Query distance function must match the index** (`cosineDistance`), or the index is silently ignored. Prove usage with `EXPLAIN indexes = 1` — it must show `Skip` with the index name.

**Deployed tasks can't read `.env`.** Local `.env` covers dev only. Deployed tasks need env vars set in the dashboard, or synced via the `syncEnvVars` build extension. The docs call this the #1 cause of "worked in dev, 500s in prod."

**The default machine is `small-1x` — 0.5 vCPU / 0.5 GB.** The ONNX model plus tokenizer plus fp32 tensors runs 400MB–1GB resident, so anything embedding needs `medium-1x` or larger. It OOMs only when deployed, and Free-plan log retention is 1 day.

**Native/WASM packages must be in `build.external` by package name** — both `onnxruntime-node` and `@huggingface/transformers`. `autoDetectExternal` is on by default but cannot see through computed require paths, so it misses them.

**Always import from `@trigger.dev/sdk`.** Never `@trigger.dev/sdk/v3` — it's a deprecated alias that still resolves, which is why it's easy to leave in place. It's also what makes assistants emit v3-era code.

## SDK notes

**There is an official ClickHouse chat agent example**: https://github.com/triggerdotdev/examples/tree/main/clickhouse-chat-agent — `chat.agent()` + ClickHouse + Next.js + generative UI. Read it before building. But assume judges have seen it: the plumbing is solved there, so differentiate on the data layer and the interaction, not the wiring.

The real AI API (v4.5+, AI Agents are GA):

| Use | API |
|---|---|
| Define an agent | `chat.agent({ id, run })` from `@trigger.dev/sdk/ai` |
| Pipe a stream you can't `return` | `chat.pipe(result)` — *inside* an agent |
| Task-backed AI tool | `ai.toolExecute(task)` — `ai.tool()` is deprecated |
| Frontend | `useTriggerChatTransport` from `@trigger.dev/sdk/chat/react` |

Docs: `/docs/ai-chat/*`. Machine-readable: https://trigger.dev/docs/llms.txt

**`...chat.toStreamTextOptions()` must be spread, and spread first.** It wires `prepareStep`. Omit it and compaction, steering, and injection silently no-op.

**Sessions are durable *compute and transport*, not durable *memory*.** The `.out` stream self-trims to ~one turn ("stays roughly one turn long forever at steady state"); full history lives in an S3 snapshot in *Trigger.dev's* bucket; `sessions.list()` returns metadata only, no messages; resume windows are 10–60s. Their own docs (`ai-chat/patterns/database-persistence`) assume you own the store. Wire `hydrateMessages` and the runtime treats your DB as the source of truth. This is *why* `03` puts session state in ClickHouse.

Agent skills are installed in `.claude/skills/` (see pointer below) and are version-pinned to the SDK — prefer them over blog posts, which are mostly v3-era.

<!-- TRIGGER.DEV SKILLS START -->
## Trigger.dev agent skills

This project has Trigger.dev agent skills installed in `.claude/skills/`. Before writing or changing Trigger.dev code (background tasks, scheduled tasks, realtime, or chat.agent AI agents), load the most relevant skill: `trigger-authoring-chat-agent`, `trigger-authoring-tasks`, `trigger-chat-agent-advanced`, `trigger-cost-savings`, `trigger-getting-started`, `trigger-realtime-and-frontend`.
<!-- TRIGGER.DEV SKILLS END -->
