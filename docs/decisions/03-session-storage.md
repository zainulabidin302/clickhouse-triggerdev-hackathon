# 03 — Session storage: ClickHouse, via `hydrateMessages`

**Status:** Accepted — **third revision**. The conclusion has held throughout; the reasoning was wrong twice.
**Date:** 2026-07-17
**Related:** [01](./01-dataset-hacker-news.md), [02](./02-agent-architecture.md)

## Context

The chat agent needs somewhere to keep conversation history: threads, messages, tool results.

Trigger.dev has a **Sessions** primitive — `sessions.start/retrieve/update/close/list/open`, with `.in`/`.out` channels, S2-backed streaming, Last-Event-ID resume, and session-scoped browser tokens. The obvious question: does that remove the need for our own store?

## Decision

**No. Keep conversation history in ClickHouse and wire it in with `hydrateMessages`. Do not add a second datastore.**

### Why — the real reason

**Sessions are durable *compute and transport*, not durable *memory*.** The docs are explicit:

> "After each turn-complete control record, the agent appends an S2 `trim` command record back to the previous turn-complete's seq_num — **the stream stays roughly one turn long forever at steady state**"
>
> "**Full conversation history lives in a durable S3 snapshot, not on the stream**"

Concretely:
- `sessions.list()` returns **metadata only** — id, externalId, tags, timestamps. **No messages.** You can enumerate conversations; you cannot reconstruct them.
- The `.out` stream self-trims to roughly one turn. Resume windows are **10–60 seconds**.
- The S3 snapshot lives in **Trigger.dev's bucket, not ours** — we can't rely on or control its lifecycle.
- Sessions carry `expiresAt` and an `EXPIRED` status. `close()` is terminal; reusing that `externalId` returns **409**.

Trigger.dev's own docs have a page called **`ai-chat/patterns/database-persistence`**. They assume you own the store.

**`hydrateMessages` is the supported seam.** Wire it and *"the runtime trusts the hook to be the source of truth for history"* — snapshot read and replay are skipped entirely. That is exactly the contract we want.

**ClickHouse is the right store for it.** Chat history is append-only, which is what ClickHouse is built for. `ReplacingMergeTree` covers the rare edit or soft-delete without the `ALTER UPDATE` mutation anti-pattern. And it means one datastore: one set of credentials, one client, one failure mode, on a solo build with six days.

## Reasoning history — two retractions

Recorded because the *conclusion* survived both, and a future reader deserves to know the arguments underneath were replaced rather than reinforced.

**First draft — "Postgres, because we need session storage anyway, so it's nearly free."** Wrong. The premise only holds if the store must be Postgres; it need not be. Adding a second datastore was never free — it was real scope justified by a bonus Lego set. *Retracted after the user challenged it: "why postgres why not clickhouse which is the requirement for the hackathon."*

**Second draft — "the SDK does not provide persistence; it's the caller's job."** Overstated. Sessions *are* a persistence layer — durable rows, listable, paginated, with a replayable stream. That draft was written from scattered `.d.ts` comments before Sessions had been read properly. *Retracted on reading the docs.*

**This draft.** Sessions are real persistence, but of the wrong *kind*: compute and transport, trimmed to a turn, in someone else's bucket. Application memory must be ours. Same answer, honest reasoning, sourced from the docs rather than inferred.

## The OLTP + OLAP bonus — deferred

There is a bonus prize for best OLTP+OLAP integration (Lego set + 500 CH credits). It cannot be won with OLAP alone.

Not chased in the initial build. If the core demo is solid with two days spare, revisit via ClickHouse's *native* OLTP surface — the PostgreSQL table engine, `MaterializedPostgreSQL`, or ClickPipes CDC — rather than a bolted-on second database. Trading main-prize odds for a bonus is bad expected value on a solo build.

## Consequences

**Good:** one datastore. Every use of ClickHouse is load-bearing for the 25% criterion — the corpus *and* the session layer. Mutating writes stay out of ClickHouse, which is correct on the merits.

**Cost:** forfeits the bonus category unless revisited.

**Risk — point-lookup latency.** Fetching one thread by `session_id` is a point lookup, ClickHouse's known weak spot. Mitigate with `ORDER BY (session_id, created_at)` so it's a primary-key range scan. Most likely assumption to break.

**Risk — perception.** A judge could read "session state in ClickHouse" as misuse. Pre-empt it in the video: chat history is append-only, `ReplacingMergeTree` covers edits, the ordering key makes thread reads a range scan. Naming a trade-off out loud converts a suspected mistake into a demonstrated decision.

**Don't `close()` sessions** we might resume — it's terminal and the `externalId` is then permanently 409.