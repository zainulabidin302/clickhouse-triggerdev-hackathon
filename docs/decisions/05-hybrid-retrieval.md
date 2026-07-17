# 05 — Hybrid retrieval: the filter strategy problem

**Status:** Accepted (default chosen; thresholds pending measurement)
**Date:** 2026-07-17
**Related:** [01](./01-dataset-hacker-news.md), [04](./04-embedding-model.md)

## Context

[Decision 01](./01-dataset-hacker-news.md) stakes our innovation claim (20%) on hybrid retrieval: semantic similarity *combined with* structured predicates in one query on one engine —

> "What did HN think about Rust in 2016 vs now" → similarity + `time` range + `post_score` filter.

The [ANN indexes docs](https://clickhouse.com/docs/engines/table-engines/mergetree-family/annindexes) reveal this is precisely the hard part. Mixing `WHERE` with vector search forces a trade-off with no free option:

| Strategy | Behaviour | Failure mode |
|---|---|---|
| **Post-filter** (default) | HNSW index runs first, `WHERE` applied to its results | **Returns fewer than `LIMIT N`** — possibly zero. A selective filter can empty the result set even when thousands of matching rows exist |
| **Pre-filter** | `WHERE` runs first, then distance | **Falls back to exact search.** Correct, but scans — the index is abandoned |

This is the trap in our headline feature. A naive `WHERE post_score > 100 ORDER BY cosineDistance(...) LIMIT 10` looks right and silently returns 3 rows, or none.

### Confirmed on our instance (26.2.1.525)

| Setting | Default | Note |
|---|---|---|
| `vector_search_filter_strategy` | `auto` | `'prefilter'` forces exact |
| `vector_search_index_fetch_multiplier` | `1` | Oversample factor, max `1000.0` |
| `hnsw_candidate_list_size_for_search` | `256` | `ef_search` |
| `allow_experimental_vector_similarity_index` | `1` | **Already enabled** — not a blocker |

## Decision

**Default to post-filtering with oversampling. Reach for `prefilter` only when the filter is highly selective. Verify with `EXPLAIN`, and measure before believing any of it.**

1. **Keep `vector_search_filter_strategy = 'auto'`** as the baseline.
2. **Raise `vector_search_index_fetch_multiplier`** when a query filters. Fetching 10–20× the candidates before filtering keeps the index in play *and* returns a full `LIMIT N`. This is the middle path the docs point at, and it is the one our agent queries should take by default.
3. **Use `prefilter` for highly selective predicates.** When `WHERE` cuts the corpus to a small slice (one author, a narrow week), exact search over that slice is *faster* than an index over 28.7M rows. The fallback is a feature here, not a defeat.
4. **The distance function must match the index** — `cosineDistance` in both, or the index is silently ignored. Our index is `cosineDistance`; every query uses `cosineDistance`.
5. **Prove index usage with `EXPLAIN indexes = 1`.** It must show `Skip` with the index name. Anything else means we are scanning and do not know it.

### Why this matters beyond correctness

Tool usage is 25% of the score and the jury builds this engine. "We hit the post-filter cliff, measured it, and tuned the fetch multiplier" is exactly the evidence of meaningful ClickHouse use they are looking for. Getting empty result sets on stage is the opposite.

**Put the numbers in the video.** Latency with and without the index, and the oversampling trade-off, are cheap to show and directly address the 25% and 10% criteria.

## Consequences

**Good:** we know the sharpest edge in our headline feature before building on it, not at 2am on day six.

**Cost:** every filtered agent query needs a deliberate strategy. This cannot be hidden behind one generic `search()` helper that guesses — the helper must take the selectivity into account or expose the knob.

**Open — pending the index build:**
- The multiplier that reliably returns a full `LIMIT 10` under our real filters. Start at 10, measure.
- The selectivity threshold where `prefilter` beats oversampling. Measure; do not guess.
- Whether `ef_search = 256` is right for 28.7M rows.

**Risk — the agent writes its own SQL** ([02](./02-agent-architecture.md)). An LLM will happily emit the naive filtered query and get silently truncated results. **The strategy must live in the tool we expose to the agent, not in the agent's prompt.** Prompts are not a place to enforce correctness.
