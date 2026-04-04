import { useState, useEffect } from 'react';

export function useScrollSpy(sectionIds: string[]): string {
  const [activeId, setActiveId] = useState(sectionIds[0] ?? '');

  useEffect(() => {
    if (sectionIds.length === 0) return;

    function update() {
      let bestId = sectionIds[0] ?? '';
      for (const id of sectionIds) {
        const el = document.getElementById(`section-${id}`);
        if (!el) continue;
        // Section whose top has scrolled past ~200px from viewport top is "current"
        if (el.getBoundingClientRect().top <= 200) {
          bestId = id;
        }
      }
      setActiveId(bestId);
    }

    update();

    // Listen on <main> (the actual scroll container in AppShell)
    const main = document.querySelector('main');
    main?.addEventListener('scroll', update, { passive: true });
    window.addEventListener('scroll', update, { passive: true });

    return () => {
      main?.removeEventListener('scroll', update);
      window.removeEventListener('scroll', update);
    };
  }, [sectionIds]);

  return activeId;
}
