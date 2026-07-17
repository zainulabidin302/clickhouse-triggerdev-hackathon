# 03 — Session storage: ClickHouse only, defer the OLTP split

**Status:** Accepted (supersedes an earlier draft that mandated Postgres)
**Date:** 2026-07-17
**Related:** [01](./01-dataset-hacker-news.md), [02](./02-agent-architecture.md)

## Context

The chat agent needs somewhere to keep session state: threads, message history, tool results.

The Trigger.dev SDK does **not** provide this. Its type definitions are explicit that persistence is the caller's job — it exposes hooks and tells you to write to *your own store*:

> "This is the format expected by `useChat` — store this for persistence." (`ai.d.ts:1309`)
> "persisting tool results to your own store" (`ai.d.ts:3074`)
> "Use this to persist messages before streaming begins, so a mid-stream page refresh…" (`ai.d.ts:1794`)

There is a `ChatSnapshotV1` mechanism, but it is run-scoped crash recovery inside Trigger.dev ("resumes from snapshot", "recovery decisions live in their own DB query"). It is not a queryable application store — you cannot ask it for a user's thread list.

So we need a store. The question is which.

There is also a bonus prize for **best OLTP + OLAP integration** (Lego set + 500 ClickHouse credits).

## Decision

**Use ClickHouse for session state as well as the corpus. Do not add Postgres now.**

### Why

**The hard requirement is ClickHouse + Trigger.dev.** Postgres is not required by any rule. Adding a second datastore is scope we must justify, not a default.

**Chat history is append-only** — the access pattern ClickHouse is built for. Messages accumulate; they are not rewritten. The rare mutation (rename a thread, soft-delete) is handled by `ReplacingMergeTree`, which is the ClickHouse-native answer and sidesteps the `ALTER UPDATE`/`DELETE` mutation anti-pattern entirely.

**Six days, solo.** One datastore means one set of credentials, one schema, one client, one failure mode. Every hour spent on Postgres networking is an hour not spent on hybrid retrieval, which is where decision [01](./01-dataset-hacker-news.md) says we win.

### Correcting the earlier reasoning

The previous draft claimed Postgres was "nearly free, because we need session storage anyway." That was wrong: the premise only holds if the store must be Postgres. It need not be. The work was never free — it was a second datastore justified by a Lego set.

## The bonus category — deferred, not abandoned

"OLTP + OLAP integration" cannot be won with OLAP alone; the category name requires both sides. We are choosing not to chase it in the initial build.

If the core demo is solid with two days to spare, revisit it. The right way to do it then is ClickHouse's *native* OLTP integration surface — the PostgreSQL table engine, `MaterializedPostgreSQL`, or ClickPipes CDC — rather than a bolted-on second database. That is a ClickHouse-flavoured story a judge would respect, and it is real work, which is exactly why it is a stretch goal and not a day-one commitment.

Trading main-prize odds for a bonus Lego set is bad expected value on a solo build.

## Consequences

**Good:** one datastore. Faster to ship, fewer credentials, fewer moving parts. Every use of ClickHouse is now load-bearing on the 25% criterion — the corpus *and* the session layer.

**Cost:** forfeits the bonus category unless we come back to it.

**Risk — point-lookup latency.** Fetching one thread by `session_id` is a point lookup, ClickHouse's known weak spot. Mitigate with a deliberate `ORDER BY (session_id, created_at)` so the lookup is a primary-key range scan. If this proves slow under demo load, revisit — this is the assumption most likely to break.

**Risk — perception.** A judge could read "session state in ClickHouse" as misuse. Pre-empt it in the video: say plainly that chat history is append-only, that `ReplacingMergeTree` covers edits, and that the ordering key makes thread reads a range scan. Naming the trade-off out loud converts a suspected mistake into a demonstrated decision.
