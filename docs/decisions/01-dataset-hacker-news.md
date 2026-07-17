# 01 — Dataset: Hacker News + vector embeddings

**Status:** Accepted
**Date:** 2026-07-17
**Related:** [02](./02-agent-architecture.md), [03](./03-oltp-olap-split.md), [dataset reference](../reference/clickhouse-datasets.md)

## Context

The theme requires a chat agent over a real-time ClickHouse data layer. The dataset choice is load-bearing on four of the six scoring criteria, because it determines whether ClickHouse is *necessary* or merely *present*.

Tool usage is the largest single bucket at 25%, and the jury is 10–15 people who build ClickHouse and Trigger.dev. Decorative usage is visible to them immediately. The dataset has to make the tools unavoidable.

Constraints:

- One week, including ingestion, agent, frontend, and a 5-minute video
- Must justify a columnar OLAP engine — if Postgres could serve it, we score badly
- Needs a conversational surface a developer judge understands without explanation

## Decision

**Use the Hacker News pair: the 28M-row HN dataset plus the 28M+ row HN vector search dataset (postings + prebuilt embeddings).**

### Why

**Vectors and analytics in one engine.** HN rows carry embeddings *and* structured metadata (score, timestamp, author, type, parent) on the same row. Semantic similarity and analytical filtering compose into a single ClickHouse query with no bolt-on vector database. This is our answer to "why ClickHouse" and it is an architectural argument, not a demo trick.

**The corpus is live.** HN's Firebase API publishes stories and comments continuously. A Trigger.dev scheduled ingest becomes *necessary* rather than ornamental, and "real-time data layer" becomes literally true instead of a claim over a static dump.

**Developer-native.** Judges have lived in this data. No domain explanation burns the 5-minute video, and "why did this post blow up" is a question they have actually asked.

**Right size.** 28M rows justifies ClickHouse but ingests within the window. The 20B-row alternatives do not.

## How we use it

**ClickHouse carries:**
- The HN corpus — posts, comments, embeddings — as the OLAP side
- A vector similarity index queried *alongside* structured predicates, not before them
- Materialized views precomputing aggregates the agent asks for repeatedly
- A deliberate `ORDER BY` / primary key we can justify in one sentence

**The agent's differentiating query shape** is hybrid retrieval: find semantically related posts, then aggregate across them. "What did HN think about Rust in 2016 versus now, and what changed their minds." Pure vector search cannot answer that. Pure SQL cannot answer that. The combination can, in one engine. This is the innovation hook (20%).

**Trigger.dev carries** continuous ingest and embedding — see [02](./02-agent-architecture.md).

## Alternatives rejected

| Option | Why not |
|---|---|
| GitHub events (3.1B) | Bigger scale flex, but the hosted copy stops Dec 2020, and embedding issue/PR text ourselves costs days |
| Environmental sensors (20B) | Best pure scale story, but narrow chat surface, no vector angle, and ingestion is its own project |
| Stack Overflow | Strong Q&A corpus, but static — the real-time story would be manufactured |
| dbpedia (1M) | Embeddings ready-made, but a million rows does not justify ClickHouse |
| WikiStat (0.5T), LAION 5B | Cannot be loaded meaningfully in a week |
| **NY taxi** | The house tutorial dataset. Reads as "did the quickstart" against a 20% innovation weight |

## Consequences

**Good:** scores on tool usage, problem fit, innovation, and presentation simultaneously. Sets up the OLTP+OLAP bonus for free (see [03](./03-oltp-olap-split.md)).

**Risk — embedding model mismatch.** Newly ingested posts must be embedded with the *same model and dimensions* as the prebuilt dataset, or new vectors are not comparable to old ones and hybrid retrieval silently degrades. **Verify before ingesting anything.** This is the single most likely way this decision fails.

**Risk — vector index syntax drift.** ClickHouse vector similarity indexes and QBit have moved fast. Check current docs; do not trust older examples.

**Accepted cost:** we are not competing on raw scale. 28M rows will not out-flex a 20B-row submission on the 10% scalability criterion. We trade that for winning the 25% and 20% buckets.
