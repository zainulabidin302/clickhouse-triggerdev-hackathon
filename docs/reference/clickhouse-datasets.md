# ClickHouse example datasets — reference

Source: [ClickHouse example datasets index](https://clickhouse.com/docs/getting-started/example-datasets). Evaluated against this hackathon's criteria. Our pick and its rationale live in [decision 01](../decisions/01-dataset-hacker-news.md).

| Dataset | Size | Notes for this hackathon |
|---|---|---|
| **Hacker News** | 28M rows | **Chosen.** Live Firebase API, developer-native |
| **HN vector search** | 28M+ rows | **Chosen.** Prebuilt embeddings alongside metadata |
| GitHub events | 3.1B rows | Runner-up. Hosted copy static to Dec 2020; GH Archive is live |
| Environmental sensors | 20B rows | Scale flex, narrow chat surface, no vector angle |
| Stack Overflow | — | Good text corpus, static dump |
| Amazon customer reviews | 150M rows | Text + structured, well-trodden |
| NOAA climate | 2.5B rows | Analytical, not conversational |
| Foursquare places | 100M rows | Geo angle, no time dimension |
| dbpedia | 1M articles | Embeddings ready, too small to justify ClickHouse |
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
