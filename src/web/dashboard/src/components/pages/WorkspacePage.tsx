import { WorkspaceProvider, useWorkspace } from './workspace/WorkspaceContext';
import { WorkspaceHeader } from './workspace/WorkspaceHeader';
import { ProjectStrip } from './workspace/ProjectStrip';
import { WorkspaceFeed } from './workspace/WorkspaceFeed';
import { ContextPanel } from './workspace/ContextPanel';
import { Markdown } from '../common/Markdown';

function PlanViewer() {
  const { expandedPlan, setExpandedPlan } = useWorkspace();
  if (!expandedPlan) return null;

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      <div className="sticky top-0 z-10 bg-card border-b border-border px-4 py-2 flex items-center justify-between">
        <span className="text-sm font-medium text-text">Plan</span>
        <button
          onClick={() => setExpandedPlan(null)}
          className="text-xs text-text-muted hover:text-text bg-transparent border-none cursor-pointer"
        >✕ Close</button>
      </div>
      <div className="p-4">
        <Markdown>{expandedPlan}</Markdown>
      </div>
    </div>
  );
}

function WorkspaceLayout() {
  const { state, expandedPlan } = useWorkspace();
  const hasSelection = !!state.selectedItemId;

  return (
    <div className="flex flex-col">
      <WorkspaceHeader />
      <ProjectStrip />
      <div className="relative flex gap-4 min-h-0 w-full">
        <div className={`min-w-0 shrink transition-all ${hasSelection ? 'lg:flex-[0_0_58%]' : 'flex-1'}`}>
          {expandedPlan ? <PlanViewer /> : <WorkspaceFeed />}
        </div>
        {hasSelection && (
          <div className="hidden lg:block flex-[0_0_42%] sticky top-0 h-[calc(100vh-80px)] overflow-y-auto">
            <ContextPanel />
          </div>
        )}
        {hasSelection && (
          <div className="lg:hidden fixed inset-0 z-30 bg-background overflow-y-auto p-4">
            <ContextPanel />
          </div>
        )}
      </div>
    </div>
  );
}

export function WorkspacePage() {
  return (
    <WorkspaceProvider>
      <WorkspaceLayout />
    </WorkspaceProvider>
  );
}
