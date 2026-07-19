# Dataset Strategy — What to Pick and Why

> **ARCHIVED 2026-07-17 — superseded.** The reasoning here was split into
> [decision 01](../decisions/01-dataset-hacker-news.md) (dataset),
> [02](../decisions/02-agent-architecture.md) (agent architecture),
> [03](../decisions/03-oltp-olap-split.md) (OLTP+OLAP), and the
> [dataset reference](../reference/clickhouse-datasets.md).
> Kept for the working-out; do not treat as current.

Working doc for the ClickHouse × Trigger.dev hackathon. See [event rules](../reference/event-rules-and-scoring.md) for rules and scoring.

**Theme:** a chat agent that changes how people interact with information. Trigger.dev orchestrates, ClickHouse is the real-time data layer. Both required.

---

## The scoring reality

| Criterion | Weight | What it actually rewards |
|---|---|---|
| Use of ClickHouse & Trigger.dev | **25%** | Both tools *load-bearing*, not decorative |
| Problem fit | 20% | A real question a real person has |
| Technical implementation | 20% | It works, schema is sensible, doesn't fall over |
| Innovation | 20% | The non-obvious idea |
| Scalability & impact | 10% | Row counts, latency, cost |
| Presentation | 5% | The 5-min video |

Two observations drive everything below.

**The single biggest bucket is tool usage, and the judges are the toolmakers.** A jury of 10–15 ClickHouse and Trigger.dev people will spot decorative usage instantly. The failure mode that quietly costs a quarter of the score:

- ClickHouse reduced to a passive table the agent `SELECT`s from once — anything Postgres could serve
- Trigger.dev reduced to a wrapper around a single LLM call — anything a `POST` handler could do

**Innovation and technical implementation are tied at 20% each.** Neither a clever idea that barely runs nor a solid build of a boring idea wins alone.

---

## Recommendation: Hacker News + HN vector search

**Pick the Hacker News pair** — the 28M-row HN dataset plus the 28M+ row vector-embeddings dataset.

It's the only candidate that scores on every criterion at once:

**Both vectors and analytics live in one engine.** HN rows carry embeddings *and* rich structured metadata (score, timestamp, author, type, parent). That means hybrid queries — semantic similarity filtered and aggregated by structured predicates — in a single ClickHouse query with no bolt-on vector database. This is the sharpest available answer to "why ClickHouse," and it's a real architectural argument, not a demo trick.

**The corpus is genuinely live.** HN's Firebase API publishes new stories and comments continuously. That makes a Trigger.dev scheduled ingest task *necessary* rather than ornamental, and it makes "real-time data layer" literally true instead of a claim over a static dump. Embedding generation for new posts is exactly what Trigger.dev is for: batched fan-out, retries, backfill.

**Developer judges have lived in this data.** No domain explanation burns your 5 minutes, and "why did this post blow up" is a question they've genuinely asked.

**28M rows is the right size.** Big enough that ClickHouse is justified, small enough that ingestion doesn't eat the week. The 20B-row datasets will.

**It sets up the bonus category for free.** Chat apps need session storage anyway — put sessions, users, and saved threads in Postgres (OLTP) and the corpus in ClickHouse (OLAP), and you're competing for the OLTP+OLAP Lego prize with work you had to do regardless.

### Runners-up

**GitHub events (3.1B rows)** — the ClickHouse-hosted copy stops at Dec 2020, but GH Archive publishes hourly and closes that gap. Bigger scale flex than HN; weaker semantic surface unless you embed issue and PR text yourself, which costs you days.

**Environmental sensors (20B rows)** — best pure scale story, live network behind it. But the conversational surface is narrow, vector search doesn't apply, and 20B rows is a real ingestion project.

**Stack Overflow** — strong Q&A text corpus, natural chat shape. Static dump, so your real-time story has to be manufactured.

### Avoid

**NY taxi.** It's the house tutorial dataset. Judges have seen it hundreds of times and it will read as "did the quickstart." Innovation is 20%.

**WikiStat (0.5T)** and **LAION 5B** — you cannot load these meaningfully in a week.

**dbpedia (1M articles)** — embeddings are ready-made, but a million rows doesn't justify ClickHouse and the scale story collapses.

---

## Making both tools load-bearing

Dataset choice matters less than whether the architecture needs both tools. Concretely:

**ClickHouse earns its 25% through:**
- A vector similarity index used alongside structured filters in the same query
- Materialized views precomputing the aggregates the agent asks for repeatedly
- A deliberate `ORDER BY` / primary key you can explain in one sentence
- Measured query latency over the full row count, shown on screen

**Trigger.dev earns its 25% through:**
- A **scheduled task** ingesting new HN items continuously
- **Fan-out batch embedding** of new posts, with retries — the config in `trigger.config.ts` already has retries enabled
- **Realtime streaming** of agent tokens and partial results to the frontend
- **`chatAgent` / `pipeChat`** from `@trigger.dev/sdk/ai`, with `TriggerChatTransport` on the frontend

That last point matters: SDK 4.5.4 in this repo ships purpose-built chat-agent primitives (`@trigger.dev/sdk/ai`, `/chat`, `/chat/react`). These are the intended path for exactly this theme. Building the agent loop by hand on raw tasks would be more work *and* score worse on tool usage.

---

## Angles worth considering

Ranked by how well they answer "changes how people interact with information" rather than "chat with your data," which is the generic version judges will see repeatedly.

1. **Ask a question, get an answer the data didn't contain.** Hybrid retrieval finds semantically related posts, then aggregates across them — "what did HN think about Rust in 2016 vs now, and what changed their mind." Neither pure vector search nor pure SQL can answer that; the combination can. This is the strongest innovation hook.
2. **The agent writes its own SQL and self-corrects.** Give it the schema, let it query, feed errors back, retry. Trigger.dev's retry and waitpoint machinery does the loop.
3. **Live commentary.** The scheduled ingest means the agent can answer about something posted ten minutes ago. Very strong on video — show a post going up, then ask about it.

---

## Full dataset reference

From the [ClickHouse example datasets](https://clickhouse.com/docs/getting-started/example-datasets) index.

| Dataset | Size | Notes for this hackathon |
|---|---|---|
| **Hacker News** | 28M rows | **Recommended.** Live API, developer-native |
| **HN vector search** | 28M+ rows | **Recommended.** Prebuilt embeddings |
| GitHub events | 3.1B rows | Runner-up. Static to Dec 2020; GH Archive is live |
| Environmental sensors | 20B rows | Scale flex, narrow chat surface |
| Stack Overflow | — | Good text corpus, static |
| Amazon customer reviews | 150M rows | Text + structured, well-trodden |
| NOAA climate | 2.5B rows | Analytical, not conversational |
| Foursquare places | 100M rows | Geo angle, no time dimension |
| dbpedia | 1M articles | Embeddings ready, too small |
| WikiStat | 0.5T rows | Too big for a week |
| LAION 5B / Laion-400M | 100M / 400M vectors | Image captions, too big |
| Criteo click logs | 1TB | Ad clicks, no chat surface |
| NY taxi | billions | **Avoid** — the house tutorial dataset |
| UK property prices | — | Good projections demo, dull chat |
| Cell towers (OpenCelliD) | — | Geo + Superset tutorial |
| COVID-19 open data | — | Dated |
| NYC "What's on the Menu?" | 1.3M rows | Charming, too small |
| NYPD complaints | — | Small, TSV ingest tutorial |
| YouTube dislikes | — | Niche |
| Taiwan weather | 131M rows | Analytical, not conversational |
| AMPLab / Brown / JOB / SSB / TPC-DS / TPC-H | — | Benchmarks, not products |

---

## Open questions

- **Which embedding model** for newly ingested posts — must match the prebuilt dataset's model and dimensions, or vectors won't be comparable. Verify before ingesting anything.
- **Vector index syntax** — ClickHouse vector similarity indexes and QBit have moved fast. Check current docs rather than trusting older examples.
- **Solo or team** — rules require teams to submit under one captain.
- **Deadline ambiguity** — the Luma header says 23 July 00:00 CEST; the timeline says 23 July midnight AoE, roughly 12 hours later. Confirm which governs.
