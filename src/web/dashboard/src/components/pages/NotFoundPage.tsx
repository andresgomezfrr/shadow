import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <img src="/ghost/404.webp" alt="404" className="w-[200px] h-[200px] rounded-2xl object-cover mb-6" />
      <h1 className="text-2xl font-semibold text-text mb-2">Page not found</h1>
      <p className="text-sm text-text-dim mb-6">Shadow got lost looking for this page.</p>
      <Link
        to="/morning"
        className="px-4 py-2 rounded-lg text-sm bg-accent-soft text-accent hover:bg-accent/25 transition-colors no-underline"
      >
        Back to Morning
      </Link>
    </div>
  );
}
