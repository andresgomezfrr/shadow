import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { maybeRerank, type RerankCandidate, type LlmClient } from './rerank.js';

function makeCandidates(n: number): RerankCandidate[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `mem-${i.toString().padStart(2, '0')}`,
    title: `Candidate ${i}`,
    body: `Body for candidate ${i} with some descriptive text about topic.`,
  }));
}

const llmReverseOrder: LlmClient = async (prompt) => {
  // Stub: devuelve los ids del prompt en orden reverso
  const ids = [...prompt.matchAll(/id=(mem-\d+)/g)].map((m) => m[1]);
  return JSON.stringify({ order: [...ids].reverse() });
};

const llmInvalid: LlmClient = async () => 'not even json';
const llmThrow: LlmClient = async () => { throw new Error('boom'); };

describe('maybeRerank', () => {
  it('skips when query is too short', async () => {
    const r = await maybeRerank({
      query: 'short query',
      candidates: makeCandidates(15),
      llm: llmReverseOrder,
    });
    assert.equal(r.applied, false);
    assert.equal(r.reason, 'too-short-query');
    assert.deepEqual(r.order, makeCandidates(15).map((c) => c.id));
  });

  it('skips when too few candidates', async () => {
    const r = await maybeRerank({
      query: 'this is a query with more than eight tokens to pass the guard',
      candidates: makeCandidates(5),
      llm: llmReverseOrder,
    });
    assert.equal(r.applied, false);
    assert.equal(r.reason, 'too-few-candidates');
  });

  it('reranks when both guards pass', async () => {
    const candidates = makeCandidates(15);
    const r = await maybeRerank({
      query: 'this is a long enough query for the rerank guard to trigger',
      candidates,
      llm: llmReverseOrder,
    });
    assert.equal(r.applied, true);
    assert.equal(r.reason, 'ok');
    // Los primeros 10 deben venir invertidos del LLM stub; los 5 últimos preservados
    const expectedTop10Reversed = ['mem-09', 'mem-08', 'mem-07', 'mem-06', 'mem-05', 'mem-04', 'mem-03', 'mem-02', 'mem-01', 'mem-00'];
    const expectedTail = ['mem-10', 'mem-11', 'mem-12', 'mem-13', 'mem-14'];
    assert.deepEqual(r.order, [...expectedTop10Reversed, ...expectedTail]);
  });

  it('falls back to original order when LLM returns garbage', async () => {
    const candidates = makeCandidates(15);
    const r = await maybeRerank({
      query: 'this is a long enough query for the rerank guard to trigger',
      candidates,
      llm: llmInvalid,
    });
    assert.equal(r.applied, false);
    assert.equal(r.reason, 'parse-error');
    assert.deepEqual(r.order, candidates.map((c) => c.id));
  });

  it('falls back when LLM throws', async () => {
    const r = await maybeRerank({
      query: 'this is a long enough query for the rerank guard to trigger',
      candidates: makeCandidates(15),
      llm: llmThrow,
    });
    assert.equal(r.applied, false);
    assert.equal(r.reason, 'llm-error');
  });

  it('ignores invented ids that the LLM hallucinated', async () => {
    const candidates = makeCandidates(15);
    const llmHallucinate: LlmClient = async () =>
      JSON.stringify({ order: ['mem-00', 'mem-01', 'fake-id', 'mem-02'] });

    const r = await maybeRerank({
      query: 'this is a long enough query for the rerank guard to trigger',
      candidates,
      llm: llmHallucinate,
    });
    assert.equal(r.applied, true);
    // fake-id se filtra; mem-03..09 droppeados se preservan tras los reordenados
    assert.equal(r.order[0], 'mem-00');
    assert.equal(r.order[1], 'mem-01');
    assert.equal(r.order[2], 'mem-02');
    assert.ok(!r.order.includes('fake-id'));
  });

  it('respects custom thresholds', async () => {
    const r = await maybeRerank({
      query: 'short',
      candidates: makeCandidates(3),
      llm: llmReverseOrder,
      minQueryTokens: 1,
      minCandidates: 2,
      topK: 3,
    });
    assert.equal(r.applied, true);
    assert.deepEqual(r.order, ['mem-02', 'mem-01', 'mem-00']);
  });
});
