// Two-stage retrieval helper: LLM-based reranking de candidatos hybridSearch.
//
// Diseño minimalista y gated:
//   - Función pura testable, recibe el cliente LLM por inyección (no toca Claude CLI / API)
//   - `maybeRerank` decide si aplica rerank según heurísticas (token count + result count).
//     Esto evita gastar tokens en queries triviales.
//   - Si el LLM falla o devuelve JSON inválido, fallback silencioso al orden original
//     (search debe seguir funcionando aunque el rerank esté roto).
//
// El consumidor (hybridSearch en search.ts) decide cuándo invocarlo vía config flag.
// El A/B real se hace activando la flag y comparando `accessCount` posterior en
// audit_events. Bloqueado por #3 (eval baseline) — sin baseline no se mide ROI.

export type RerankCandidate = {
  id: string;
  title: string;
  body: string;
};

export type LlmClient = (prompt: string) => Promise<string>;

export type MaybeRerankOptions = {
  query: string;
  candidates: RerankCandidate[];
  llm: LlmClient;
  // Heurística: mínimo de tokens en la query para aplicar rerank.
  minQueryTokens?: number;
  // Heurística: mínimo de candidatos para que el rerank tenga sentido.
  minCandidates?: number;
  // Cuántos candidatos enviar al LLM (capa de coste).
  topK?: number;
};

const DEFAULT_MIN_QUERY_TOKENS = 8;
const DEFAULT_MIN_CANDIDATES = 10;
const DEFAULT_TOP_K = 10;

function countTokens(query: string): number {
  return query.trim().split(/\s+/).filter(Boolean).length;
}

function buildPrompt(query: string, candidates: RerankCandidate[]): string {
  const numbered = candidates
    .map((c, i) => `[${i}] id=${c.id} | ${c.title}\n${c.body.slice(0, 240)}`)
    .join('\n\n');
  return [
    `Reorder the following candidates by relevance to the query.`,
    `Return only valid JSON: {"order": ["id1", "id2", ...]} with the ids in best-to-worst order.`,
    `Do NOT include candidates you consider irrelevant. Do NOT invent ids.`,
    ``,
    `Query: ${query}`,
    ``,
    `Candidates:`,
    numbered,
  ].join('\n');
}

function parseOrder(raw: string, validIds: Set<string>): string[] | null {
  // Tolerante: busca el primer bloque JSON con clave "order"
  const match = raw.match(/\{[\s\S]*"order"[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as { order?: unknown };
    if (!Array.isArray(parsed.order)) return null;
    const filtered = parsed.order
      .filter((x): x is string => typeof x === 'string')
      .filter((id) => validIds.has(id));
    return filtered.length > 0 ? filtered : null;
  } catch {
    return null;
  }
}

export type RerankOutcome = {
  applied: boolean;
  reason: 'disabled' | 'too-short-query' | 'too-few-candidates' | 'llm-error' | 'parse-error' | 'ok';
  order: string[];
};

/**
 * Aplica rerank LLM si las heurísticas se cumplen. Devuelve siempre un nuevo
 * orden + outcome para A/B logging.
 *
 * El caller decide si reordena los SearchResult según `order` (manteniendo
 * cualquier id no incluido en el orden al final, o droppeándolo).
 */
export async function maybeRerank(opts: MaybeRerankOptions): Promise<RerankOutcome> {
  const minTokens = opts.minQueryTokens ?? DEFAULT_MIN_QUERY_TOKENS;
  const minCands = opts.minCandidates ?? DEFAULT_MIN_CANDIDATES;
  const topK = opts.topK ?? DEFAULT_TOP_K;

  const originalOrder = opts.candidates.map((c) => c.id);

  if (countTokens(opts.query) < minTokens) {
    return { applied: false, reason: 'too-short-query', order: originalOrder };
  }
  if (opts.candidates.length < minCands) {
    return { applied: false, reason: 'too-few-candidates', order: originalOrder };
  }

  const sliced = opts.candidates.slice(0, topK);
  const validIds = new Set(sliced.map((c) => c.id));
  const prompt = buildPrompt(opts.query, sliced);

  let raw: string;
  try {
    raw = await opts.llm(prompt);
  } catch {
    return { applied: false, reason: 'llm-error', order: originalOrder };
  }

  const reranked = parseOrder(raw, validIds);
  if (!reranked) {
    return { applied: false, reason: 'parse-error', order: originalOrder };
  }

  // Conserva ids fuera del topK (cola sin reordenar) al final del nuevo orden.
  const tail = opts.candidates.slice(topK).map((c) => c.id);
  const droppedFromTop = sliced.map((c) => c.id).filter((id) => !reranked.includes(id));

  return {
    applied: true,
    reason: 'ok',
    order: [...reranked, ...droppedFromTop, ...tail],
  };
}
