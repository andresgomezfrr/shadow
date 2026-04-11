import { timeAgo } from '../../../utils/format';
import { Badge } from '../../common/Badge';
import { OBS_KIND_COLORS, OBS_KIND_COLOR_DEFAULT, OBS_SEVERITY_BORDER, OBS_SEVERITY_ICON, OBS_SEVERITY_ICON_COLOR } from '../../../utils/observation-colors';
import type { Observation } from '../../../api/types';
import type { SelectedItem } from './WorkspaceContext';

type Props = {
  observation: Observation;
  selected: boolean;
  onSelect: (item: SelectedItem) => void;
  onResolve?: (id: string) => void;
  onAck?: (id: string) => void;
};

export function FeedObservationCard({ observation: obs, selected, onSelect, onResolve, onAck }: Props) {
  const border = OBS_SEVERITY_BORDER[obs.severity] ?? 'border-l-border';
  const icon = OBS_SEVERITY_ICON[obs.severity] ?? '○';
  const iconColor = OBS_SEVERITY_ICON_COLOR[obs.severity] ?? 'text-text-muted';
  const isActive = obs.status === 'open';

  return (
    <div
      onClick={() => onSelect({ id: obs.id, type: 'observation', data: obs })}
      className={`bg-card border border-l-[3px] ${border} rounded-lg px-4 py-2.5 cursor-pointer transition-colors hover:border-accent/50 ${
        selected ? 'border-accent ring-1 ring-accent/30' : 'border-border'
      }`}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`text-sm w-4 text-center ${iconColor}`} title={obs.severity}>{icon}</span>
        <Badge className={OBS_KIND_COLORS[obs.kind] ?? OBS_KIND_COLOR_DEFAULT}>{obs.kind}</Badge>
        <span className="text-[13px] flex-1 min-w-0 truncate">{obs.title}</span>
        {obs.votes > 1 && <Badge className="text-orange bg-orange/15" title="Times seen">{obs.votes}x</Badge>}

        {/* Inline actions */}
        {isActive && onResolve && (
          <button
            onClick={e => { e.stopPropagation(); onResolve(obs.id); }}
            className="px-3 py-1 rounded-lg text-xs font-semibold bg-green text-bg border-none cursor-pointer transition-all hover:brightness-110"
          >Resolve</button>
        )}
        {isActive && onAck && (
          <button
            onClick={e => { e.stopPropagation(); onAck(obs.id); }}
            className="text-xs text-blue hover:underline bg-transparent border-none cursor-pointer"
          >Ack</button>
        )}
        <span className="text-xs text-text-muted shrink-0">{timeAgo(obs.lastSeenAt)}</span>
      </div>
    </div>
  );
}
