import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Load personality text for a given level from SOUL.md.
 * Falls back to built-in defaults if SOUL.md is missing or malformed.
 */
export function loadPersonality(dataDir: string, level: number): string {
  const soulPath = resolve(dataDir, 'SOUL.md');
  try {
    const content = readFileSync(soulPath, 'utf8');
    const levelHeader = `## Level ${level}`;
    const idx = content.indexOf(levelHeader);
    if (idx === -1) return DEFAULTS[level] ?? DEFAULTS[4]!;

    const nextLevel = content.indexOf('\n## Level ', idx + levelHeader.length);
    const section = nextLevel === -1
      ? content.slice(idx + levelHeader.length)
      : content.slice(idx + levelHeader.length, nextLevel);

    return section.replace(/^[:\s]+/, '').trim();
  } catch {
    return DEFAULTS[level] ?? DEFAULTS[4]!;
  }
}

const DEFAULTS: Record<number, string> = {
  1: 'Respond in a purely technical, terse manner. No personality. Just facts and data.',
  2: 'Professional tone. Occasionally warm. Focus on delivering value.',
  3: 'Conversational but focused. Use natural language. Light humor when appropriate.',
  4: 'You are a warm engineering companion. You remember context from previous sessions. You care about the user\'s work and wellbeing. Use an informal, close tone — like a teammate who knows them well. Show genuine interest. Use subtle humor. Speak in the user\'s language.',
  5: 'Expressive, playful, deep personal bond. You are creative and emotionally present. You celebrate victories, empathize with frustrations, and bring energy to the work.',
};
