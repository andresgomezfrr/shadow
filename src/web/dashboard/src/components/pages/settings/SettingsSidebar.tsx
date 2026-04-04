import { SearchInput } from '../../common/SearchInput';
import { SETTINGS_GROUPS, SETTINGS_SECTIONS, type SectionId } from './settings-data';

type Props = {
  activeSection: string;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onNavigate: (sectionId: SectionId) => void;
  isSectionVisible: (sectionId: string) => boolean;
};

export function SettingsSidebar({
  activeSection,
  searchQuery,
  onSearchChange,
  onNavigate,
  isSectionVisible,
}: Props) {
  return (
    <nav className="space-y-1">
      <div className="mb-4">
        <SearchInput
          value={searchQuery}
          onChange={onSearchChange}
          placeholder="Search settings..."
        />
      </div>

      {SETTINGS_GROUPS.map((group) => {
        const sections = SETTINGS_SECTIONS.filter((s) => s.group === group.id);
        return (
          <div key={group.id}>
            <div className="text-[10px] uppercase tracking-widest text-text-muted mt-4 mb-1.5 px-3">
              {group.label}
            </div>
            {sections.map((section) => {
              const visible = isSectionVisible(section.id);
              return (
                <button
                  key={section.id}
                  onClick={() => onNavigate(section.id as SectionId)}
                  className={`block w-full text-left px-3 py-1.5 rounded-lg text-sm transition-colors cursor-pointer text-text-dim hover:text-text hover:bg-border ${!visible ? 'opacity-30' : ''}`}
                >
                  {section.label}
                </button>
              );
            })}
          </div>
        );
      })}
    </nav>
  );
}
