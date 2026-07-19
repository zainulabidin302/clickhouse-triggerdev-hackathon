# Corpus analysis — what's actually in the 28.7M rows

Measured against the live ClickHouse table, 2026-07-19. Every number here came from a query, not an estimate.

Purpose: understand the material before designing the analyst agent. See [decision 01](../decisions/01-dataset-hacker-news.md) for why this dataset.

---

## 1. Timeline — steady growth, then a wall

| Year | Stories | Comments | Total |
|---|---|---|---|
| 2006 | 50 | 12 | 62 |
| 2007 | 22,869 | 70,858 | 93,758 |
| 2008 | 72,274 | 247,922 | 320,922 |
| 2009 | 115,365 | 491,085 | 608,354 |
| 2010 | 186,911 | 842,438 | 1,030,808 |
| 2011 | 304,494 | 1,044,913 | 1,352,909 |
| 2012 | 327,166 | 1,246,786 | 1,576,047 |
| 2013 | 329,266 | 1,665,198 | 1,997,974 |
| 2014 | 309,737 | 1,510,828 | 1,823,994 |
| 2015 | 343,334 | 1,642,995 | 1,989,326 |
| 2016 | 377,223 | 2,093,661 | 2,472,912 |
| 2017 | 386,237 | 2,361,761 | 2,749,792 |
| 2018 | 368,398 | 2,384,135 | 2,754,279 |
| 2019 | 371,331 | 2,755,125 | 3,127,712 |
| 2020 | 428,686 | 3,243,246 | **3,673,126** ← peak |
| 2021 | 297,941 | 2,839,384 | 3,138,764 ← partial |

**Shape:** ~50× growth 2007→2020, then a hard stop. The corpus ends **2021-10-03 17:03:13**.

**Two things to know:**
- **Stories plateaued in 2011** (~300–400K/yr, flat for a decade) while **comments kept climbing** (1.0M → 3.2M). The community didn't post more; it *argued more per post*. Comments-per-story went from 4.5 (2010) to 7.6 (2020).
- **26,818 rows carry epoch timestamps** (0.09%). Every time-based query needs `WHERE time > toDateTime(0)` or they silently land in 1970.

**The gap:** ~4.75 years between the corpus end and today. The dataset is *not* live — the HN Firebase API is. Anything we ingest lands in 2026 against history stopping in 2021, with nothing between.

---

## 2. Composition — 85% of the corpus has no value signal

| Type | Rows | % | Has score? |
|---|---|---|---|
| comment | 24,440,347 | 85.05% | **No — zero of them** |
| story | 4,268,100 | 14.85% | Yes (4.06M scored) |
| job | 14,557 | 0.05% | Rarely |
| pollopt | 12,685 | 0.04% | Sometimes |
| poll | 1,868 | 0.01% | Sometimes |

**This is the most important structural fact in the dataset.** `post_score` is **0 for all 24.4M comments** — HN doesn't expose comment scores publicly, so the dataset has none.

Consequences:
- "What did people value?" is only directly answerable for **stories** (15% of rows).
- For comments, value must be *inferred* — reply count, thread depth, position, or semantic agreement in surrounding replies.
- Comment engagement is thin: **13.3M comments (55%) got zero replies**. Average 0.75 replies, max 126.

Moderation signal exists too: **1,253,287 dead** (4.4%) and **833,586 deleted** (2.9%).

---

## 3. The attention economy is brutal

Story scores, all 4.27M:

| Band | Stories | Share |
|---|---|---|
| 0–1 (ignored) | 2,118,715 | 49.6% |
| 2–4 (barely) | 1,365,427 | 32.0% |
| 5–19 (noticed) | 418,212 | 9.8% |
| 20–99 (front page) | 237,524 | 5.6% |
| 100–499 (big) | 119,569 | 2.8% |
| 500+ (viral) | **8,653** | **0.2%** |

**Median story score: 2. p90: 13. p99: 201. Max: 6,015.**

**Over 81% of everything ever posted to HN scored 4 or less.** The front page is a rounding error on the corpus.

This reframes the whole project. The interesting material isn't the 8,653 hits everyone remembers — it's the **3.87 million things that vanished**.

---

## 4. Two traps in the value signal

### Trap 1 — score inflation makes cross-era comparison wrong

| Year | Avg score | p99 score |
|---|---|---|
| 2008 | 6.1 | 66 |
| 2012 | 9.2 | 159 |
| 2016 | 12.1 | 239 |
| 2021 | 16.3 | 296 |

**A 2008 point is worth roughly 3× a 2021 point.** More users → more votes → higher numbers, with no change in merit.

Any query that ranks across eras by raw `post_score` is **measuring HN's growth, not the community's judgment.** The correct unit is **percentile within year**, not raw score. This is a real analytical difference and a cheap one to implement.

### Trap 2 — score and discussion are the same signal (mostly)

`corr(post_score, descendants) = 0.809`

Upvotes and comments move together, so the tidy "loved vs argued-about" 2×2 mostly collapses:

| | Loud (many comments) | Quiet |
|---|---|---|
| **High score** | 55,065 | 7,502 |
| **Low score** | **399** | 3,866,736 |

But that makes the **off-diagonal cells rare and therefore interesting**:
- **7,502 stories** were upvoted hard with almost no discussion — *instant, unarguable consensus*.
- **399 stories** got heavy discussion with no upvotes — *pure controversy*, the community argued but refused to endorse. That's 0.009% of stories. Genuinely rare specimens.

**The analyst lesson:** don't rank by score, and don't rank by comments. **Rank by the residual** — how far a post deviates from the discussion its score predicts. That's where the anomalies live, and it's a query almost nobody writes.

---

## 5. The natural experiment — the strongest finding

**273,990 URLs were posted to HN more than once.** Same link. Same content. Different day.

- **40,633** of them swung by **50+ points** between their best and worst posting
- **11,198** swung by **200+ points**

Concrete cases:

| URL | Times posted | Flopped at | Peaked at | Years |
|---|---|---|---|---|
| `gabrielecirulli.github.io/2048/` | 2 | **1** | **2,903** | 2014–2020 |
| `socialcooling.com` | 6 | **1** | **2,692** | 2017–2020 |
| `spacex.com/hyperloop` | 5 | **1** | **2,666** | 2013–2017 |
| `bloomberg.com/…/2018-10-04/the-big…` | 5 | 2 | 2,493 | 2018–2021 |
| `learningmusic.ableton.com` | 5 | 2 | 2,106 | 2017–2019 |
| `ycombinator.com/rfs9.html` | 3 | **1** | **2,060** | 2012 only |

The 2048 game scored **1 point** on one submission and **2,903** on another. YC's own Request For Startups flopped at 1 and hit 2,060 — *in the same year*.

**This is a controlled experiment the community ran on itself for 15 years without noticing.** Content held constant, outcome varied by three orders of magnitude. It is hard evidence that HN's verdict is substantially about timing, title, and luck — not merit alone.

You cannot see this without scanning all 4.27M stories, grouping by URL, and comparing outcomes across years. No vector database can do it. It is exactly what a columnar engine is for.

---

## 6. What this means for the analyst agent

**Ideas the corpus supports well:**

1. **"The same idea, twice"** — surface reposts with wildly different outcomes. Provable, visual, surprising, and it makes a point about attention that every developer has felt.
2. **"What died in the void"** — 3.87M ignored stories. Use embeddings to find things semantically close to later successes that scored 1 at the time.
3. **"Instant consensus vs pure controversy"** — the 7,502 and the 399. Rare specimens, retrievable by residual.
4. **Era-normalised judgment** — rank by within-year percentile so 2008 and 2021 are comparable.

**Constraints the agent must respect:**

- Comments have **no score**. Don't promise comment-level "value" ranking; infer it or stay at story level.
- Raw cross-era score comparison is **invalid**. Normalise by year.
- Score ≈ comments (r=0.809). Treating them as independent axes is naive; **the residual is the signal**.
- 0.09% epoch timestamps must be filtered from every time query.
- 4.4% dead / 2.9% deleted — decide explicitly whether moderation-removed content is in scope.

**The character this suggests:** an analyst whose defining move is *looking at what everyone else discarded*. The corpus is 91% failure by volume. An agent that only surfaces top-scoring posts is reading 9% of the material and repeating what the community already knows. The differentiated posture is the opposite — treat the void as the subject, and treat the community's own verdict as something to be audited rather than trusted.
