import { logger, task } from "@trigger.dev/sdk/v3";
import { query } from "../clickhouse.js";
import { embedOne, EMBEDDING_DIMS, EMBEDDING_MODEL } from "../embed.js";

type Hit = { id: number; snippet: string; dist: number };

/**
 * Proves our query embeddings land in the corpus's vector space.
 *
 * We deliberately do NOT test by re-embedding a row's `text` and expecting to
 * reproduce its stored vector — that fails, and it's a bad test. The `text`
 * column is a reconstructed thread window (parent + comment + reply), not the
 * exact string LlamaIndex embedded when the dataset was built. Per-row
 * reproduction measures our guess at their preprocessing, not whether we share
 * a vector space.
 *
 * What actually matters is retrieval: a query embedded by us must pull back
 * semantically relevant rows via their vectors. That's the product requirement.
 * See docs/decisions/04-embedding-model.md.
 *
 * This is also the both-tools-talking milestone: Trigger.dev task -> ClickHouse.
 */
const PROBES = [
  { q: "Rust programming language memory safety", expect: /rust|memory|unsafe|safe|c\+\+|borrow/i },
  { q: "best espresso machine for home", expect: /coffee|espresso|nespresso|brew|caffeine|beans/i },
  { q: "raising a seed round from venture capitalists", expect: /vc|invest|startup|fund|round|seed|equity/i },
];

export const verifyEmbeddings = task({
  id: "verify-embeddings",
  maxDuration: 600,
  run: async () => {
    logger.log(`Probing retrieval with ${EMBEDDING_MODEL} (${EMBEDDING_DIMS} dims)`);

    const results = [];
    for (const probe of PROBES) {
      const vector = await embedOne(probe.q);
      if (vector.length !== EMBEDDING_DIMS) {
        throw new Error(`Expected ${EMBEDDING_DIMS} dims, got ${vector.length}`);
      }

      const hits = await query<Hit>(`
        SELECT id, substring(text, 1, 100) AS snippet,
               cosineDistance(vector, [${vector.join(",")}]) AS dist
        FROM hackernews
        ORDER BY dist ASC
        LIMIT 5
      `);

      const relevant = hits.filter((h) => probe.expect.test(h.snippet)).length;
      const nearest = hits[0]?.dist ?? 1;

      logger.log(`"${probe.q}" -> ${relevant}/${hits.length} relevant, nearest ${nearest.toFixed(4)}`, { hits });
      results.push({ query: probe.q, relevant, total: hits.length, nearest });
    }

    // A shared vector space puts real matches well under 0.5 cosine distance.
    // Random/unrelated vectors sit near 1.0, so this gap is the signal.
    const worstDist = Math.max(...results.map((r) => r.nearest));
    const passed = worstDist < 0.5 && results.every((r) => r.relevant > 0);

    if (!passed) {
      throw new Error(
        `Retrieval looks wrong: worst nearest-distance ${worstDist.toFixed(4)}, ` +
          `relevance ${results.map((r) => r.relevant).join("/")}. ` +
          `Our query vectors may not share the corpus's space.`,
      );
    }

    logger.log(`PASS — worst nearest-distance ${worstDist.toFixed(4)}`);
    return { passed, worstDist, results };
  },
});
