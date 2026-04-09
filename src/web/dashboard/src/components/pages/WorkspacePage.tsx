import { WorkspaceProvider, useWorkspace } from './workspace/WorkspaceContext';
import { WorkspaceHeader } from './workspace/WorkspaceHeader';
import { ProjectStrip } from './workspace/ProjectStrip';
import { WorkspaceFeed } from './workspace/WorkspaceFeed';
import { ContextPanel } from './workspace/ContextPanel';

function WorkspaceLayout() {
  const { state } = useWorkspace();
  const hasSelection = !!state.selectedItemId;

  return (
    <div className="flex flex-col">
      <WorkspaceHeader />
      <ProjectStrip />
      <div className="relative flex gap-4 min-h-0">
        <div className={`flex-1 min-w-0 transition-all ${hasSelection ? 'lg:mr-[500px]' : ''}`}>
          <WorkspaceFeed />
        </div>
        {hasSelection && (
          <div className="hidden lg:block fixed right-6 top-[72px] bottom-6 w-[500px] z-10">
            <ContextPanel />
          </div>
        )}
        {hasSelection && (
          <div className="lg:hidden">
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
