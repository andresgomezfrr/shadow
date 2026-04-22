export { embed, embeddingText } from './embeddings.js';
export { hybridSearch, vectorSearch } from './search.js';
export { searchMemories, findRelevantMemories, touchMemories } from './retrieval.js';
export { loadPendingCorrections, enforceCorrections, mergeRelatedMemories } from './corrections.js';
export { generateAndStoreEmbedding, backfillEmbeddings } from './lifecycle.js';
export { checkDuplicate, checkMemoryDuplicate, checkObservationDuplicate, checkSuggestionDuplicate } from './dedup.js';
export type { DedupDecision, DedupThresholds } from './dedup.js';
