import { useEffect, useState } from 'react';

/**
 * Global Cmd+K / Ctrl+K listener for the command palette.
 * Toggles open/close state. Also registers '/' as an alternative when not in an input.
 */
export function useCommandPalette() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isMetaK = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k';
      if (isMetaK) {
        e.preventDefault();
        setOpen(prev => !prev);
        return;
      }
      // '/' shortcut — only when not typing in an input/textarea
      if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName;
        const isEditable = tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable;
        if (!isEditable) {
          e.preventDefault();
          setOpen(true);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return { open, setOpen };
}
