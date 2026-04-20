import { PlayOnceVideo } from './PlayOnceVideo';

type EmptyStateProps = {
  icon?: string;
  title: string;
  description?: string;
};

export function EmptyState({ icon, title, description }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      {icon ? (
        <div className="text-4xl mb-3">{icon}</div>
      ) : (
        <PlayOnceVideo
          src="/ghost/empty.mp4"
          poster="/ghost/empty.webp"
          className="w-[100px] h-[100px] rounded-full object-cover mb-4"
        />
      )}
      <div className="text-base font-medium text-text-dim">{title}</div>
      {description && <div className="text-sm text-text-muted mt-1">{description}</div>}
    </div>
  );
}
