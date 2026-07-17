# 04 — Embedding model: all-MiniLM-L6-v2 via Transformers.js

**Status:** Accepted
**Date:** 2026-07-17
**Related:** [01](./01-dataset-hacker-news.md), [02](./02-agent-architecture.md)

## Context

[Decision 01](./01-dataset-hacker-news.md) flagged embedding-model mismatch as the single most likely way our approach fails silently: new posts embedded with a different model produce vectors that are not comparable to the existing corpus, and hybrid retrieval degrades without erroring.

The [ClickHouse docs](https://clickhouse.com/docs/getting-started/example-datasets/hackernews-vector-search-dataset) settle it. The 28.74M-row HN vector dataset was embedded with:

- **Model:** SentenceTransformers `all-MiniLM-L6-v2`
- **Dimensions:** 384
- **Distance:** cosine

This is a **local model, not an API**. There is no hosted endpoint to call — we must run the model ourselves to embed anything new.

This rules out the obvious shortcut. The DatumLabs dgpu `infinity-emb` service serves `BAAI/bge-m3` at 1024 dimensions. Those vectors are **incomparable** to the corpus. Using it would produce plausible-looking embeddings that are quietly meaningless against 28M existing rows — exactly the silent failure 01 warned about.

## Decision

**Run `Xenova/all-MiniLM-L6-v2` via Transformers.js inside the Trigger.dev embedding task.**

```ts
import { pipeline } from "@huggingface/transformers";

const extract = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
const out = await extract(texts, { pooling: "mean", normalize: true });
// → 384-dim Float32, comparable to the corpus
```

**`pooling: "mean"` and `normalize: true` are not optional.** SentenceTransformers applies mean pooling and L2 normalization on top of the raw transformer output. Omitting either produces 384 numbers that are the wrong 384 numbers — same shape, wrong space, no error. This is the trap.

### Why

**It matches the corpus exactly.** Same model, same dimensions, same space. That is the whole requirement.

**It is self-contained.** Pure Node, ~80MB ONNX, CPU-only. It runs inside a deployed Trigger.dev task with no external service, no network hop, no credential, no Tailscale reachability problem.

**It is small.** L6 is a 6-layer MiniLM. Embedding a batch of new HN posts is cheap enough to run on every ingest tick.

## Alternatives rejected

| Option | Why not |
|---|---|
| **dgpu `infinity-emb` (bge-m3)** | Wrong model, wrong dims (1024 vs 384). Vectors incomparable to the corpus. Silent failure |
| **Serve all-MiniLM-L6-v2 on dgpu** | Correct model, but dgpu sits behind Tailscale and deployed Trigger.dev tasks cannot reach it. Would need public exposure — infra work for a network hop we do not need |
| **Re-embed all 28.74M rows with a better model** | Defeats the point of a prebuilt dataset and burns the week |

## Consequences

**Good:** the corpus and our newly ingested posts share one vector space. Hybrid retrieval works as [01](./01-dataset-hacker-news.md) assumes. No embedding credential in `.env`.

**Risk — cold start.** The task downloads ~80MB of ONNX weights on first run. Acceptable for a scheduled ingest; would not be for a per-request path. If it bites, cache the model in the build via a Trigger.dev build extension.

**Risk — silent divergence.** If pooling or normalization is ever changed, nothing errors — retrieval just gets worse. Mitigated by the retrieval probe below (`src/trigger/verify-embeddings.ts`), which fails loudly.

**Accepted:** `all-MiniLM-L6-v2` is a 2021-era model, weaker than modern embeddings. We inherit the corpus's choice. Not worth 28M re-embeddings.

## Verified against the live corpus — 2026-07-17

**Confirmed: our query embeddings share the corpus's vector space.** Probes against 4.4M loaded rows returned strong semantic matches:

| Query | Top results | Nearest distance |
|---|---|---|
| "Rust programming language memory safety" | memory safety, `unsafe`, security defects, safe-language debates | 0.144 |
| "best espresso machine for home" | coffee, Nespresso machines, instant coffee | 0.188 |

Real matches land at 0.14–0.24 cosine distance; unrelated vectors sit near 1.0. That gap is the proof.

### Correction: how *not* to test this

The mitigation originally recorded here — re-embed a row's `text`, assert cosine ≈ 1.0 against its stored vector — **was a bad test and it failed**. Similarities came back at 0.57–0.86, and on other samples near 0.05.

That did not mean the model was wrong. It meant **the premise was wrong.** The `text` column is a *reconstructed thread window* — parent comment, this comment, and the reply, each author-prefixed:

```
beefsack:Swift is useful if you're an Apple developer...
AlexeyBrin: Swift works reasonably well on Linux...
beefsack: I tried under Arch a few months ago...
```

The stored vector is of whatever LlamaIndex fed the model when the dataset was built, which is not this reassembled string. (Corroborating: `length` = 71 while `text` is 395 chars — the column describes the original post, not the window.) So per-row reproduction measures *our guess at their preprocessing*, not whether we share a vector space. It can never reach 1.0 and tells us nothing.

**The right test is retrieval:** does a query we embed pull back semantically relevant rows through their vectors? That is also the actual product requirement. `verify-embeddings` now asserts nearest-distance < 0.5 and non-zero keyword relevance across three probes.

**Consequence for ingest.** We can embed new posts into the right *space*, but we cannot perfectly reproduce the corpus's *text construction*. New rows should mirror the thread-window format as closely as we can so old and new rows stay comparable in practice. Worth revisiting if retrieval quality on fresh posts looks off relative to historical ones.
