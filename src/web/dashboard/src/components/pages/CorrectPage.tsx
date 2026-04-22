import { Navigate } from 'react-router-dom';

/**
 * Corrections are stored as memories with kind='correction'. Rather than
 * build a dedicated page right now, route /correct to the existing
 * MemoriesPage filter so the user sees exactly the subset they care about.
 * If a dedicated teach/correct UI is needed later, this becomes the real
 * page and drops the redirect.
 */
export function CorrectPage() {
  return <Navigate to="/memories?kind=correction" replace />;
}
