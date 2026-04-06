import { FilterTabs } from '../common/FilterTabs';
import { useFilterParams } from '../../hooks/useFilterParams';
import { GuideOverview } from './guide/GuideOverview';
import { GuideConcepts } from './guide/GuideConcepts';
import { GuideCli } from './guide/GuideCli';
import { GuideMcpTools } from './guide/GuideMcpTools';
import { GuideStatusLine } from './guide/GuideStatusLine';
import { GuideConfig } from './guide/GuideConfig';
import { GuideJobs } from './guide/GuideJobs';

const SECTIONS = [
  { label: 'Overview', value: 'overview' },
  { label: 'Concepts', value: 'concepts' },
  { label: 'Jobs', value: 'jobs' },
  { label: 'CLI', value: 'cli' },
  { label: 'MCP Tools', value: 'mcp-tools' },
  { label: 'Status Line', value: 'status-line' },
  { label: 'Config', value: 'config' },
];

export function GuidePage() {
  const { params, setParam } = useFilterParams({ section: 'overview' });

  return (
    <div className="max-w-4xl">
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <h1 className="text-xl font-semibold">Shadow Guide</h1>
        <FilterTabs options={SECTIONS} active={params.section} onChange={(v) => setParam('section', v)} />
      </div>

      {params.section === 'overview' && <GuideOverview />}
      {params.section === 'concepts' && <GuideConcepts />}
      {params.section === 'jobs' && <GuideJobs />}
      {params.section === 'cli' && <GuideCli />}
      {params.section === 'mcp-tools' && <GuideMcpTools />}
      {params.section === 'status-line' && <GuideStatusLine />}
      {params.section === 'config' && <GuideConfig />}
    </div>
  );
}
