import type { ShadowDatabase } from '../storage/database.js';
import type { MemoryRecord } from '../storage/models.js';

// --- Constants ---

const LAYER_ORDER = ['core', 'hot', 'warm', 'cool', 'cold'] as const;
type Layer = (typeof LAYER_ORDER)[number];

// Type-aware staleness thresholds
// Episodic memories (events) decay faster, semantic (knowledge) persists longer
function getStaleDays(memoryType: string, layer: string): number {
  if (memoryType === 'episodic') {
    return { hot: 7, warm: 14, cool: 45 }[layer] ?? 14;
  }
  if (memoryType === 'semantic') {
    return { hot: 30, warm: 90, cool: 180 }[layer] ?? 30;
  }
  // unclassified: original thresholds
  return { hot: 14, warm: 30, cool: 90 }[layer] ?? 14;
}

const HOT_PROMOTION_ACCESS_COUNT = 3;
const HOT_PROMOTION_WINDOW_DAYS = 7;
const WARM_PROMOTION_ACCESS_COUNT = 2;
const WARM_PROMOTION_WINDOW_DAYS = 14;

const LOW_CONFIDENCE_THRESHOLD = 50;
const VERY_LOW_CONFIDENCE_THRESHOLD = 30;

const CORE_CAPACITY = 30;
const CORE_PROTECTED_KINDS = ['soul_reflection', 'taught', 'knowledge_summary', 'correction'];
const HOT_CAPACITY = 50;
const WARM_CAPACITY = 100;

// --- Result type ---

export type LayerMaintenanceResult = {
  promoted: number;
  demoted: number;
  expired: number;
};

// --- Helpers ---

function daysAgo(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

function isStale(memory: MemoryRecord, days: number): boolean {
  if (!memory.lastAccessedAt) {
    // Never accessed — use createdAt as the baseline
    return new Date(memory.createdAt) < daysAgo(days);
  }
  return new Date(memory.lastAccessedAt) < daysAgo(days);
}

function accessedWithinWindow(memory: MemoryRecord, minCount: number, windowDays: number): boolean {
  if (memory.accessCount < minCount) return false;
  if (!memory.lastAccessedAt) return false;
  return new Date(memory.lastAccessedAt) >= daysAgo(windowDays);
}

function isExpired(memory: MemoryRecord): boolean {
  if (!memory.expiresAt) return false;
  return new Date(memory.expiresAt) <= new Date();
}

// --- Main function ---

export function maintainMemoryLayers(db: ShadowDatabase): LayerMaintenanceResult {
  let promoted = 0;
  let demoted = 0;
  let expired = 0;

  // --- Step 1: Expire memories past their expires_at date ---
  for (const layer of LAYER_ORDER) {
    if (layer === 'core') continue;
    const memories = db.listMemories({ layer, archived: false });
    for (const mem of memories) {
      if (isExpired(mem)) {
        db.updateMemory(mem.id, { archivedAt: new Date().toISOString() });
        db.deleteEmbedding('memory_vectors', mem.id);
        expired++;
      }
    }
  }

  // --- Step 1b: Demote memories past valid_until to cool ---
  for (const layer of ['core', 'hot', 'warm'] as const) {
    const memories = db.listMemories({ layer, archived: false });
    for (const mem of memories) {
      if (mem.validUntil && new Date(mem.validUntil) <= new Date()) {
        db.updateMemory(mem.id, { layer: 'cool', demotedTo: 'cool' });
        demoted++;
      }
    }
  }

  // --- Step 2: Demote stale hot memories to warm (type-aware thresholds) ---
  const hotMemories = db.listMemories({ layer: 'hot', archived: false });
  for (const mem of hotMemories) {
    if (isExpired(mem)) continue; // already handled
    if (isStale(mem, getStaleDays(mem.memoryType, 'hot')) || mem.confidenceScore < LOW_CONFIDENCE_THRESHOLD) {
      db.updateMemory(mem.id, { layer: 'warm', demotedTo: 'warm' });
      demoted++;
    }
  }

  // --- Step 3: Process warm memories — promote or demote (type-aware) ---
  const warmMemories = db.listMemories({ layer: 'warm', archived: false });
  for (const mem of warmMemories) {
    if (isExpired(mem)) continue;
    // Promotion: accessed >= 3 times in 7 days, OR explicitly taught, OR pattern confirmed
    if (
      accessedWithinWindow(mem, HOT_PROMOTION_ACCESS_COUNT, HOT_PROMOTION_WINDOW_DAYS) ||
      mem.sourceType === 'teach' ||
      mem.kind === 'pattern'
    ) {
      db.updateMemory(mem.id, { layer: 'hot', promotedFrom: 'warm' });
      promoted++;
    } else if (isStale(mem, getStaleDays(mem.memoryType, 'warm'))) {
      db.updateMemory(mem.id, { layer: 'cool', demotedTo: 'cool' });
      demoted++;
    }
  }

  // --- Step 4: Process cool memories — promote or demote (type-aware) ---
  const coolMemories = db.listMemories({ layer: 'cool', archived: false });
  for (const mem of coolMemories) {
    if (isExpired(mem)) continue;
    // Promotion: accessed >= 2 times in 14 days
    if (accessedWithinWindow(mem, WARM_PROMOTION_ACCESS_COUNT, WARM_PROMOTION_WINDOW_DAYS)) {
      db.updateMemory(mem.id, { layer: 'warm', promotedFrom: 'cool' });
      promoted++;
    } else if (isStale(mem, getStaleDays(mem.memoryType, 'cool')) || mem.confidenceScore < VERY_LOW_CONFIDENCE_THRESHOLD) {
      db.updateMemory(mem.id, { layer: 'cold', demotedTo: 'cold' });
      demoted++;
    }
  }

  // --- Step 5: Enforce capacity limits ---
  // Core layer: max 30 — evict lowest scoring non-protected memories to hot
  const coreMemories = db.listMemories({ layer: 'core', archived: false });
  if (coreMemories.length > CORE_CAPACITY) {
    const evictable = coreMemories
      .filter(m => !CORE_PROTECTED_KINDS.includes(m.kind))
      .sort((a, b) => (a.relevanceScore * a.accessCount) - (b.relevanceScore * b.accessCount));
    const toEvict = evictable.slice(0, coreMemories.length - CORE_CAPACITY);
    for (const mem of toEvict) {
      db.updateMemory(mem.id, { layer: 'hot', demotedTo: 'hot' });
      demoted++;
    }
  }

  // Hot layer: max 50 — evict lowest relevanceScore to warm
  const hotAfter = db.listMemories({ layer: 'hot', archived: false });
  if (hotAfter.length > HOT_CAPACITY) {
    const sorted = [...hotAfter].sort((a, b) => a.relevanceScore - b.relevanceScore);
    const excess = sorted.slice(0, hotAfter.length - HOT_CAPACITY);
    for (const mem of excess) {
      db.updateMemory(mem.id, { layer: 'warm', demotedTo: 'warm' });
      demoted++;
    }
  }

  // Warm layer: max 100 — evict lowest relevanceScore to cool
  const warmAfter = db.listMemories({ layer: 'warm', archived: false });
  if (warmAfter.length > WARM_CAPACITY) {
    const sorted = [...warmAfter].sort((a, b) => a.relevanceScore - b.relevanceScore);
    const excess = sorted.slice(0, warmAfter.length - WARM_CAPACITY);
    for (const mem of excess) {
      db.updateMemory(mem.id, { layer: 'cool', demotedTo: 'cool' });
      demoted++;
    }
  }

  return { promoted, demoted, expired };
}
