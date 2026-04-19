/**
 * Circular spinner used to indicate "run in progress" (status=running or queued).
 *
 * Shared across FeedRunCard, RunPipeline, and RunJourney — previously each had
 * its own inline implementation (some pulse, some rotation, different sizes).
 * See audit UI-06.
 *
 * Uses the `rotation` keyframe defined in Tailwind config.
 */
type Props = {
  size?: 'sm' | 'md';
  className?: string;
};

export function RunSpinner({ size = 'md', className = '' }: Props) {
  const dim = size === 'sm'
    ? 'w-2.5 h-2.5 border-[1px]'
    : 'w-3.5 h-3.5 border-[1.5px]';
  return (
    <span
      className={`inline-block ${dim} border-blue border-b-transparent rounded-full animate-[rotation_1s_linear_infinite] ${className}`}
      role="status"
      aria-label="running"
    />
  );
}
