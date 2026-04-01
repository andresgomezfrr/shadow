import type { ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="h-full">
      <Sidebar />
      <Topbar />
      <main className="fixed top-12 left-[60px] right-0 bottom-0 overflow-y-auto p-6 scrollbar-thin">
        <div className="animate-fade-in">{children}</div>
      </main>
    </div>
  );
}
