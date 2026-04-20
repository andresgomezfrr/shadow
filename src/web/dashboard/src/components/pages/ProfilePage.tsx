import { useState, useCallback, useRef, useMemo } from 'react';
import { useApi } from '../../hooks/useApi';
import { fetchStatus, updateProfile } from '../../api/client';
import type { UserProfile } from '../../api/types';
import { FilterTabs } from '../common/FilterTabs';
import { SearchInput } from '../common/SearchInput';
import { SETTINGS_SECTIONS, SETTINGS_GROUPS, type SectionId } from './settings/settings-data';
import { useScrollSpy } from './settings/useScrollSpy';
import { useSettingsSearch } from './settings/useSettingsSearch';
import { SettingsSidebar } from './settings/SettingsSidebar';
import { SectionIdentity } from './settings/SectionIdentity';
import { SectionBehavior } from './settings/SectionBehavior';
import { SectionLLMModels } from './settings/SectionLLMModels';
import { SectionThoughts } from './settings/SectionThoughts';
import { SectionFocusMode } from './settings/SectionFocusMode';
import { SectionEnrichment } from './settings/SectionEnrichment';
import { SectionAutonomy } from './settings/SectionAutonomy';
import { SectionSoul } from './settings/SectionSoul';
import { SectionSystemConfig } from './settings/SectionSystemConfig';

const SECTION_IDS = SETTINGS_SECTIONS.map((s) => s.id);

const MOBILE_GROUPS = SETTINGS_GROUPS.map((g) => ({
  label: g.label,
  value: g.id,
}));

export function ProfilePage() {
  const { data, refresh } = useApi(fetchStatus, [], 60_000);
  const [saved, setSaved] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeSection = useScrollSpy(SECTION_IDS);
  const { query, setQuery, isSectionVisible } = useSettingsSearch();

  const profile = data?.profile;

  // --- Save helpers ---
  const saveField = useCallback(
    async (field: string, value: unknown) => {
      await updateProfile({ [field]: value } as Partial<UserProfile>);
      setSaved(field);
      setTimeout(() => setSaved(null), 2000);
      refresh();
    },
    [refresh],
  );

  const debouncedSave = useCallback(
    (field: string, value: unknown) => {
      if (debounceRef.current !== null) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => saveField(field, value), 500);
    },
    [saveField],
  );

  const savePreference = useCallback(
    async (key: string, value: unknown) => {
      await updateProfile({ preferences: { [key]: value } } as unknown as Partial<UserProfile>);
      setSaved(key);
      setTimeout(() => setSaved(null), 2000);
      refresh();
    },
    [refresh],
  );

  // --- Navigation ---
  const scrollToSection = useCallback((id: SectionId) => {
    document.getElementById(`section-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const activeGroup = useMemo(() => {
    const section = SETTINGS_SECTIONS.find((s) => s.id === activeSection);
    return section?.group ?? 'general';
  }, [activeSection]);

  const scrollToGroup = useCallback((groupId: string) => {
    const firstSection = SETTINGS_SECTIONS.find((s) => s.group === groupId);
    if (firstSection) scrollToSection(firstSection.id as SectionId);
  }, [scrollToSection]);

  if (!profile) return <div className="text-text-dim p-6">Loading...</div>;

  return (
    <div className="-m-6 flex h-[calc(100vh-48px)]">
      {/* Desktop sidebar */}
      <div className="hidden md:block w-[220px] shrink-0 min-h-0 border-r border-border bg-bg p-4 overflow-y-auto scrollbar-thin">
        <SettingsSidebar
          activeSection={activeSection}
          searchQuery={query}
          onSearchChange={setQuery}
          onNavigate={scrollToSection}
          isSectionVisible={isSectionVisible}
        />
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto p-6 scroll-smooth scrollbar-thin">
        {/* Mobile nav */}
        <div className="md:hidden mb-4 space-y-3">
          <SearchInput value={query} onChange={setQuery} placeholder="Search settings..." />
          <FilterTabs options={MOBILE_GROUPS} active={activeGroup} onChange={scrollToGroup} />
        </div>

        <div className="flex items-center gap-3 mb-6">
          <img src="/ghost/settings.webp" alt="" className="w-[80px] h-[80px] rounded-full object-cover" />
          <h1 className="text-xl font-semibold">Shadow Settings</h1>
        </div>

        {/* General */}
        <SectionIdentity profile={profile} saved={saved} onSave={saveField} visible={isSectionVisible('identity')} />

        {/* Behavior */}
        <SectionBehavior profile={profile} saved={saved} onSave={saveField} onDebouncedSave={debouncedSave} onSavePreference={savePreference} visible={isSectionVisible('behavior')} />

        <SectionLLMModels profile={profile} saved={saved} onSavePreference={savePreference} visible={isSectionVisible('models')} />

        {/* Features */}
        <SectionThoughts profile={profile} saved={saved} onSavePreference={savePreference} visible={isSectionVisible('thoughts')} />
        <SectionFocusMode profile={profile} onRefresh={refresh} visible={isSectionVisible('focus')} />
        <SectionEnrichment profile={profile} saved={saved} onSavePreference={savePreference} visible={isSectionVisible('enrichment')} />
        <SectionAutonomy profile={profile} saved={saved} onSavePreference={savePreference} visible={isSectionVisible('autonomy')} />

        {/* About */}
        <SectionSoul visible={isSectionVisible('soul')} />
        <SectionSystemConfig visible={isSectionVisible('config')} />
      </div>
    </div>
  );
}
