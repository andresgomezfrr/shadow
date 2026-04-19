import { z } from 'zod';
import { mcpSchema, ok, err, type McpTool, type ToolContext } from './types.js';
import { ProfileUpdateSchema } from '../../config/schema.js';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const ProfileReadSchema = z.object({});

const ProfileSetSchema = z.object({
  key: z.enum(['displayName', 'timezone', 'locale', 'proactivityLevel']).describe('Profile field to update. Allowed: displayName, timezone, locale, proactivityLevel (1-10).'),
  value: z.string().describe('New value for the field (numeric fields accept string form, coerced server-side)'),
});

const FocusSchema = z.object({
  duration: z.string().describe('Optional duration: "2h", "30m", "1h". Omit for indefinite focus.').optional(),
});

const FeedbackSchema = z.object({
  targetKind: z.string().describe('Filter by kind: observation, suggestion, memory, run').optional(),
  limit: z.number().describe('Max entries (default 30)').optional(),
});

const SoulReadSchema = z.object({});

const SoulUpdateSchema = z.object({
  body: z.string().describe('The new soul reflection in markdown'),
});

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export function profileTools(ctx: ToolContext): McpTool[] {
  const { db } = ctx;

  return [
    // -----------------------------------------------------------------------
    // shadow_profile (read-only)
    // -----------------------------------------------------------------------
    {
      name: 'shadow_profile',
      description: 'Returns the current user profile: displayName, timezone, locale, proactivityLevel, bondTier, bondAxes, focusMode. Use when you need to personalize responses, check active preferences, or confirm current bond state.',
      inputSchema: mcpSchema(ProfileReadSchema),
      handler: async () => {
        return ok(db.ensureProfile('default'));
      },
    },

    // -----------------------------------------------------------------------
    // shadow_profile_set
    // -----------------------------------------------------------------------
    {
      name: 'shadow_profile_set',
      description: 'Update a user profile field. Requires trust level >= 1. Fields: proactivityLevel (1-10), timezone, displayName.',
      inputSchema: mcpSchema(ProfileSetSchema),
      handler: async (params) => {

        const { key, value: rawValue } = ProfileSetSchema.parse(params);
        const parsed = ProfileUpdateSchema.safeParse({ [key]: rawValue });
        if (!parsed.success) {
          return err(`Invalid value for ${key}: ${parsed.error.issues.map(i => i.message).join(', ')}`);
        }
        const parsedValue = (parsed.data as Record<string, unknown>)[key];

        db.updateProfile('default', { [key]: parsedValue });
        return ok({ set: key, value: parsedValue });
      },
    },

    // -----------------------------------------------------------------------
    // shadow_focus
    // -----------------------------------------------------------------------
    {
      name: 'shadow_focus',
      description: 'Enter focus mode — sets proactivity to 1 (silent). Optionally specify a duration like "2h" or "30m". Requires trust level >= 1.',
      inputSchema: mcpSchema(FocusSchema),
      handler: async (params) => {

        const { duration } = FocusSchema.parse(params);
        let focusUntil: string | null = null;

        if (duration) {
          const match = duration.match(/^(\d+)\s*(h|m|min|hour|hours|minutes?)$/i);
          if (match) {
            const amount = parseInt(match[1], 10);
            const unit = match[2].toLowerCase();
            const maxHours = 168; // 1 week
            const hours = unit.startsWith('h') ? amount : amount / 60;
            if (hours > maxHours) return err(`Duration too long (max ${maxHours}h)`);
            const ms = unit.startsWith('h') ? amount * 60 * 60 * 1000 : amount * 60 * 1000;
            focusUntil = new Date(Date.now() + ms).toISOString();
          }
        }

        const profile = db.ensureProfile();
        db.updateProfile('default', { focusMode: 'focus', focusUntil });

        return ok({
          mode: 'focus',
          previousProactivity: profile.proactivityLevel,
          until: focusUntil ?? 'indefinite (use shadow_available to exit)',
        });
      },
    },

    // -----------------------------------------------------------------------
    // shadow_feedback
    // -----------------------------------------------------------------------
    {
      name: 'shadow_feedback',
      description: 'List recent user feedback events: thumbs up/down, dismiss reasons, archive reasons, corrections — filterable by target kind (observation/suggestion/memory/run). Use when auditing how Shadow\'s output has been received or debugging why dedup/enforcement is behaving a certain way.',
      inputSchema: mcpSchema(FeedbackSchema),
      handler: async (params) => {
        const { targetKind, limit } = FeedbackSchema.parse(params);
        return ok(db.listFeedback(targetKind, limit ?? 30));
      },
    },

    // -----------------------------------------------------------------------
    // shadow_soul (read-only)
    // -----------------------------------------------------------------------
    {
      name: 'shadow_soul',
      description: 'Read Shadow\'s current soul reflection — the LLM-synthesized long-form understanding of the developer (voice, working style, values). Use when you want to ground your response in the accumulated persona or when the user asks what Shadow thinks of them.',
      inputSchema: mcpSchema(SoulReadSchema),
      handler: async () => {
        const all = db.listMemories({ archived: false });
        const soul = all.find(m => m.kind === 'soul_reflection');
        if (!soul) return ok({ exists: false, body: null });
        return ok({ exists: true, body: soul.bodyMd, updatedAt: soul.updatedAt });
      },
    },

    // -----------------------------------------------------------------------
    // shadow_soul_update
    // -----------------------------------------------------------------------
    {
      name: 'shadow_soul_update',
      description: 'Update Shadow\'s soul reflection with a new body (markdown). Creates the reflection if none exists yet, otherwise overwrites. Use from the reflect job or when the user explicitly asks to rewrite Shadow\'s understanding of them. Requires trust level >= 1.',
      inputSchema: mcpSchema(SoulUpdateSchema),
      handler: async (params) => {

        const { body } = SoulUpdateSchema.parse(params);
        const all = db.listMemories({ archived: false });
        const existing = all.find(m => m.kind === 'soul_reflection');
        if (existing) {
          db.updateMemory(existing.id, { bodyMd: body });
          return ok({ action: 'updated', memoryId: existing.id });
        }
        const mem = db.createMemory({
          layer: 'core', scope: 'personal', kind: 'soul_reflection',
          title: 'Shadow soul reflection', bodyMd: body,
          sourceType: 'reflect', confidenceScore: 95, relevanceScore: 1.0,
        });
        return ok({ action: 'created', memoryId: mem.id });
      },
    },
  ];
}
