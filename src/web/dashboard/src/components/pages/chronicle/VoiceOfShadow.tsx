import { useEffect, useState } from 'react';
import { fetchVoiceOfShadow } from '../../../api/client';

type Props = {
  initialBody?: string;
  className?: string;
};

/**
 * Voice of Shadow — one-line atmospheric phrase. Lazy-fetches from
 * /api/chronicle/voice if no initialBody is passed (so Morning page
 * can render without blocking).
 */
export function VoiceOfShadow({ initialBody, className = '' }: Props) {
  const [body, setBody] = useState<string>(initialBody ?? '');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (initialBody) {
      setBody(initialBody);
      return;
    }
    setLoading(true);
    fetchVoiceOfShadow()
      .then((r) => setBody(r.body))
      .catch(() => setBody(''))
      .finally(() => setLoading(false));
  }, [initialBody]);

  if (!body && !loading) return null;

  return (
    <p className={`text-text-muted text-xs italic ${className}`}>
      {loading ? '...' : body}
    </p>
  );
}
