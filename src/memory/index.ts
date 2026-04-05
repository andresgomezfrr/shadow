export { embed, embeddingText, cosineSimilarity } from './embeddings.js';
export { hybridSearch, vectorSearch } from './search.js';
export { searchMemories, findRelevantMemories, touchMemories, loadPendingCorrections, enforceCorrections } from './retrieval.js';
export { generateAndStoreEmbedding, backfillEmbeddings } from './lifecycle.js';
export { checkDuplicate, checkMemoryDuplicate, checkObservationDuplicate, checkSuggestionDuplicate } from './dedup.js';
export type { DedupDecision, DedupThresholds } from './dedup.js';
