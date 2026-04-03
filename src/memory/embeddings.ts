import { pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';

let extractor: FeatureExtractionPipeline | null = null;
let initPromise: Promise<void> | null = null;

/**
 * Lazy init — loads model on first call (~2.5s first time, ~200ms cached).
 * Model: Xenova/all-MiniLM-L6-v2 (23MB, 384 dims, ~4ms/embedding)
 */
async function init(): Promise<void> {
  if (extractor) return;
  if (initPromise) return initPromise;
  initPromise = (async () => {
    extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
      device: 'cpu',
    }) as FeatureExtractionPipeline;
  })();
  return initPromise;
}

/**
 * Generate a 384-dim embedding for text. Lazy inits model if needed.
 * Optimal for short text (<256 tokens): titles, summaries, memory bodies.
 */
export async function embed(text: string): Promise<Float32Array> {
  await init();
  const output = await extractor!(text, { pooling: 'mean', normalize: true });
  return new Float32Array(output.data as Float32Array);
}

/**
 * Cosine similarity between two normalized embeddings (= dot product).
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

/**
 * Build the text to embed for each entity type.
 * Keeps it concise — title + body, within model's sweet spot.
 */
export function embeddingText(
  type: 'memory' | 'observation' | 'suggestion',
  entity: {
    kind?: string;
    title: string;
    bodyMd?: string;
    summaryMd?: string;
    detail?: Record<string, unknown>;
  },
): string {
  switch (type) {
    case 'memory':
      return `${entity.title} ${entity.bodyMd ?? ''}`.slice(0, 1000).trim();
    case 'observation':
      return `${entity.kind ?? ''} ${entity.title}`.trim();
    case 'suggestion':
      return `${entity.kind ?? ''} ${entity.title} ${entity.summaryMd ?? ''}`.slice(0, 1000).trim();
  }
}
