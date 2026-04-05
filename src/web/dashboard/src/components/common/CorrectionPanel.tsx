import { useState, useEffect } from 'react';
import { useApi } from '../../hooks/useApi';
import { fetchRepos, fetchProjects, fetchSystems, createCorrection } from '../../api/client';

type Props = {
  open: boolean;
  onClose: () => void;
  defaultScope?: string;
  defaultEntityType?: string;
  defaultEntityId?: string;
  defaultEntityName?: string;
};

const SCOPES = ['personal', 'repo', 'project', 'system'] as const;

export function CorrectionPanel({ open, onClose, defaultScope, defaultEntityType, defaultEntityId, defaultEntityName }: Props) {
  const [scope, setScope] = useState(defaultScope || 'personal');
  const [entityType, setEntityType] = useState(defaultEntityType || '');
  const [entityId, setEntityId] = useState(defaultEntityId || '');
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  // Fetch entities for dropdowns
  const { data: repos } = useApi(fetchRepos, [], 60_000);
  const { data: projects } = useApi(() => fetchProjects(), [], 60_000);
  const { data: systems } = useApi(() => fetchSystems(), [], 60_000);

  // Reset on open
  useEffect(() => {
    if (open) {
      setScope(defaultScope || 'personal');
      setEntityType(defaultEntityType || '');
      setEntityId(defaultEntityId || '');
      setBody('');
      setSuccess(false);
    }
  }, [open, defaultScope, defaultEntityType, defaultEntityId]);

  if (!open) return null;

  const needsEntity = scope !== 'personal';
  const entityOptions = scope === 'repo' ? (repos ?? []).map(r => ({ id: r.id, name: r.name }))
    : scope === 'project' ? (projects ?? []).map(p => ({ id: p.id, name: p.name }))
    : scope === 'system' ? (systems ?? []).map(s => ({ id: s.id, name: s.name }))
    : [];

  const handleSubmit = async () => {
    if (!body.trim()) return;
    setSubmitting(true);
    try {
      const result = await createCorrection({
        body: body.trim(),
        scope,
        ...(needsEntity && entityType && entityId ? { entityType, entityId } : {}),
      });
      if (result?.ok) {
        setSuccess(true);
        setTimeout(() => onClose(), 1500);
      }
    } finally {
      setSubmitting(false);
    }
  };

  // Auto-set entityType from scope
  const effectiveEntityType = scope === 'repo' ? 'repo' : scope === 'project' ? 'project' : scope === 'system' ? 'system' : '';

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-start" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-lg shadow-2xl p-5 w-80 mb-4 ml-16 animate-fade-in"
        onClick={e => e.stopPropagation()}
      >
        {success ? (
          <div className="text-center py-4">
            <div className="text-green text-lg mb-1">✓</div>
            <div className="text-sm text-text">Correction saved</div>
            <div className="text-xs text-text-muted mt-1">Will be enforced on next consolidate</div>
          </div>
        ) : (
          <>
            <div className="text-sm font-semibold mb-3">Correct Shadow</div>

            {/* Scope selector */}
            <div className="mb-3">
              <div className="text-xs text-text-muted mb-1.5">What applies to?</div>
              <div className="flex gap-1.5">
                {SCOPES.map(s => (
                  <button
                    key={s}
                    onClick={() => { setScope(s); setEntityId(''); }}
                    className={`px-2.5 py-1 rounded text-xs border-none cursor-pointer transition-colors ${
                      scope === s ? 'bg-accent-soft text-accent' : 'bg-border/50 text-text-muted hover:text-text'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            {/* Entity dropdown (if scope needs entity) */}
            {needsEntity && !defaultEntityId && (
              <div className="mb-3">
                <select
                  value={entityId}
                  onChange={e => { setEntityId(e.target.value); setEntityType(effectiveEntityType); }}
                  className="w-full bg-bg border border-border rounded px-2 py-1.5 text-xs text-text"
                >
                  <option value="">Select {scope}...</option>
                  {entityOptions.map(opt => (
                    <option key={opt.id} value={opt.id}>{opt.name}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Pre-filled entity display */}
            {needsEntity && defaultEntityId && defaultEntityName && (
              <div className="mb-3 text-xs text-text-dim bg-bg rounded px-2 py-1.5 border border-border/50">
                {scope}: {defaultEntityName}
              </div>
            )}

            {/* Correction body */}
            <div className="mb-3">
              <div className="text-xs text-text-muted mb-1.5">What's incorrect? What's the truth?</div>
              <textarea
                value={body}
                onChange={e => setBody(e.target.value)}
                placeholder="e.g., Shadow is a personal project, not related to my employer"
                className="w-full bg-bg border border-border rounded px-2.5 py-2 text-xs text-text resize-y min-h-20 focus:border-accent focus:outline-none"
                rows={3}
              />
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2">
              <button
                onClick={onClose}
                className="px-3 py-1.5 rounded text-xs text-text-muted bg-transparent border border-border cursor-pointer hover:text-text transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting || !body.trim() || (needsEntity && !entityId && !defaultEntityId)}
                className="px-3 py-1.5 rounded text-xs bg-accent-soft text-accent border-none cursor-pointer hover:bg-accent/25 transition-colors disabled:opacity-50"
              >
                {submitting ? 'Saving...' : 'Submit correction'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
