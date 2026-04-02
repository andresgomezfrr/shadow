import { useState } from 'react';
import { sendFeedback } from '../../api/client';

type Props = {
  targetKind: string;
  targetId: string;
};

export function ThumbsFeedback({ targetKind, targetId }: Props) {
  const [state, setState] = useState<'up' | 'down' | null>(null);

  const handle = (action: 'up' | 'down') => (e: React.MouseEvent) => {
    e.stopPropagation();
    if (state === action) {
      // Toggle off — record removal
      setState(null);
      sendFeedback(targetKind, targetId, 'thumbs_neutral');
    } else {
      setState(action);
      sendFeedback(targetKind, targetId, action === 'up' ? 'thumbs_up' : 'thumbs_down');
    }
  };

  return (
    <span className="inline-flex gap-0.5">
      <button
        onClick={handle('up')}
        className={`text-xs bg-transparent border-none cursor-pointer transition-opacity ${state === 'up' ? 'opacity-100' : 'opacity-30 hover:opacity-70'}`}
        title="More like this"
      >👍</button>
      <button
        onClick={handle('down')}
        className={`text-xs bg-transparent border-none cursor-pointer transition-opacity ${state === 'down' ? 'opacity-100' : 'opacity-30 hover:opacity-70'}`}
        title="Less like this"
      >👎</button>
    </span>
  );
}
