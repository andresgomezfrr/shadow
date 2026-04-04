import type { ReactNode } from 'react';
import { useApi } from '../../hooks/useApi';
import { fetchStatus } from '../../api/client';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

export function AppShell({ children }: { children: ReactNode }) {
  const { data } = useApi(fetchStatus, [], 15_000);

  return (
    <div className="h-full">
      <Sidebar counts={data?.counts} />
      <Topbar status={data} />
      <main className="fixed top-12 left-[60px] right-0 bottom-0 overflow-y-auto p-6 scrollbar-thin">
        <div className="animate-fade-in h-full">{children}</div>
      </main>
    </div>
  );
}
