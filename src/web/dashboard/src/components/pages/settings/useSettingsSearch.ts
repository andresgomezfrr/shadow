import { useState, useCallback } from 'react';
import { SETTINGS_SECTIONS } from './settings-data';

export function useSettingsSearch() {
  const [query, setQuery] = useState('');

  const isSectionVisible = useCallback(
    (sectionId: string): boolean => {
      if (!query.trim()) return true;
      const section = SETTINGS_SECTIONS.find((s) => s.id === sectionId);
      if (!section) return true;
      const q = query.toLowerCase();
      // Match against label or any keyword
      return (
        section.label.toLowerCase().includes(q) ||
        section.keywords.some((kw) => kw.includes(q))
      );
    },
    [query],
  );

  return { query, setQuery, isSectionVisible };
}
