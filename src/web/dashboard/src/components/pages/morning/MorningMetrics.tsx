import { formatTokens } from '../../../utils/format';
import { MetricCard } from '../../common/MetricCard';
import type { DailySummary } from '../../../api/types';

export function MorningMetrics({
  activity,
  tokens,
}: {
  activity: DailySummary['activity'];
  tokens: DailySummary['tokens'];
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-8">
      <MetricCard label="Observations" value={activity.observationsToday} />
      <MetricCard label="Memories" value={activity.memoriesCreatedToday} />
      <MetricCard label="Suggestions" value={activity.pendingSuggestions} accent />
      <MetricCard label="Runs to review" value={activity.runsToReview} accent={activity.runsToReview > 0} />
      <MetricCard label="Tokens" value={formatTokens(tokens.input + tokens.output)} />
    </div>
  );
}
