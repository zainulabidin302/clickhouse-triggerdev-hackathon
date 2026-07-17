import { pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";

/**
 * Embeddings for the HN corpus.
 *
 * The 28.7M vectors already in ClickHouse were produced by SentenceTransformers
 * `all-MiniLM-L6-v2` at 384 dims. Anything we embed must land in that same space
 * or similarity search silently returns nonsense.
 *
 * `pooling: "mean"` and `normalize: true` reproduce what SentenceTransformers
 * does on top of the raw model output. Drop either and you still get 384 floats
 * — just the wrong ones, with no error. See docs/decisions/04-embedding-model.md.
 */
export const EMBEDDING_MODEL = "Xenova/all-MiniLM-L6-v2";
export const EMBEDDING_DIMS = 384;

let extractor: Promise<FeatureExtractionPipeline> | undefined;

/** Lazily load the model once per process — ~80MB, cached after first call. */
function getExtractor(): Promise<FeatureExtractionPipeline> {
  extractor ??= pipeline("feature-extraction", EMBEDDING_MODEL);
  return extractor;
}

/** Embed texts into 384-dim vectors comparable to the corpus. */
export async function embed(texts: string[]): Promise<number[][]> {
  const extract = await getExtractor();
  const output = await extract(texts, { pooling: "mean", normalize: true });
  return output.tolist() as number[][];
}

/** Embed a single text. */
export async function embedOne(text: string): Promise<number[]> {
  const [vector] = await embed([text]);
  return vector;
}

/** Cosine similarity. Inputs are already normalized, so this is a dot product. */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}
