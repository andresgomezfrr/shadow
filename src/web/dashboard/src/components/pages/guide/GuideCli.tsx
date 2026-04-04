import { useState } from 'react';
import { CLI_GROUPS, type CliGroup } from './guide-data';

export function GuideCli() {
  const [open, setOpen] = useState<Set<string>>(() => new Set(['General']));

  const toggle = (name: string) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  return (
    <>
      <p className="text-sm text-text-dim mb-4">
        Shadow&apos;s CLI is available as the <code className="text-accent bg-bg px-1.5 py-0.5 rounded text-xs">shadow</code> command.
        The primary interface for daily use is Claude CLI with MCP tools — these commands are for admin, setup, and direct interaction.
      </p>

      <div className="space-y-2">
        {CLI_GROUPS.map((group) => (
          <GroupSection key={group.name} group={group} isOpen={open.has(group.name)} onToggle={() => toggle(group.name)} />
        ))}
      </div>
    </>
  );
}

function GroupSection({ group, isOpen, onToggle }: { group: CliGroup; isOpen: boolean; onToggle: () => void }) {
  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-card-hover transition-colors border-none bg-transparent text-left"
      >
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm text-accent">{group.name === 'General' ? 'shadow' : `shadow ${group.name}`}</span>
          <span className="text-xs text-text-dim">— {group.description}</span>
        </div>
        <span className="text-text-dim text-xs">{isOpen ? '\u25B4' : '\u25BE'} {group.commands.length}</span>
      </button>

      {isOpen && (
        <div className="border-t border-border animate-fade-in">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-bg">
                <th className="text-left px-4 py-2 text-text-dim font-medium">Command</th>
                <th className="text-left px-4 py-2 text-text-dim font-medium">Description</th>
              </tr>
            </thead>
            <tbody>
              {group.commands.map((cmd) => (
                <tr key={cmd.command} className="border-t border-border hover:bg-card-hover transition-colors">
                  <td className="px-4 py-2.5 font-mono text-xs whitespace-nowrap">
                    <span className="text-text">{cmd.command}</span>
                    {cmd.args && <span className="text-text-dim ml-1">{cmd.args}</span>}
                  </td>
                  <td className="px-4 py-2.5 text-text-dim text-xs">{cmd.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
