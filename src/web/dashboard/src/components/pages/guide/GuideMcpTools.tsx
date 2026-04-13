import { useState } from 'react';
import { MCP_CATEGORIES, type McpCategory } from './guide-data';

export function GuideMcpTools() {
  const allNames = MCP_CATEGORIES.map((c) => c.name);
  const [open, setOpen] = useState<Set<string>>(() => new Set(allNames));

  const toggle = (name: string) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const totalTools = MCP_CATEGORIES.reduce((sum, c) => sum + c.tools.length, 0);
  const readOnly = MCP_CATEGORIES.reduce((sum, c) => sum + c.tools.filter((t) => t.readOnly).length, 0);

  return (
    <>
      <p className="text-sm text-text-dim mb-2">
        Shadow exposes <span className="text-text">{totalTools} MCP tools</span> that Claude can use during conversations.
        These are the primary interface — Claude calls them automatically based on context.
      </p>
      <p className="text-xs text-text-muted mb-2">
        <span className="inline-flex items-center gap-1.5 mr-3"><span className="px-1.5 py-0.5 rounded text-[10px] bg-green/15 text-green">read</span> {readOnly} read-only tools</span>
        <span className="inline-flex items-center gap-1.5"><span className="px-1.5 py-0.5 rounded text-[10px] bg-orange/15 text-orange">write</span> {totalTools - readOnly} write tools</span>
      </p>
      <p className="text-xs text-text-muted mb-4 bg-bg rounded-lg px-3 py-2">
        <strong className="text-text-dim">Note:</strong> All tools are available regardless of bond tier &mdash; the bond system in Shadow is used for narrative and
        gamification only. The access badges below reflect whether a tool is read-only or mutates state.
      </p>

      <div className="space-y-2">
        {MCP_CATEGORIES.map((cat) => (
          <CategorySection key={cat.name} category={cat} isOpen={open.has(cat.name)} onToggle={() => toggle(cat.name)} />
        ))}
      </div>
    </>
  );
}

function CategorySection({ category, isOpen, onToggle }: { category: McpCategory; isOpen: boolean; onToggle: () => void }) {
  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-card-hover transition-colors border-none bg-transparent text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-text">{category.name}</span>
          <span className="text-xs text-text-muted">{category.tools.length} tools</span>
        </div>
        <span className="text-text-dim text-xs">{isOpen ? '\u25B4' : '\u25BE'}</span>
      </button>

      {isOpen && (
        <div className="border-t border-border animate-fade-in">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-bg">
                <th className="text-left px-4 py-2 text-text-dim font-medium">Tool</th>
                <th className="text-left px-4 py-2 text-text-dim font-medium w-16">Access</th>
                <th className="text-left px-4 py-2 text-text-dim font-medium">Description</th>
              </tr>
            </thead>
            <tbody>
              {category.tools.map((tool) => (
                <tr key={tool.name} className="border-t border-border hover:bg-card-hover transition-colors">
                  <td className="px-4 py-2.5 font-mono text-xs text-accent whitespace-nowrap">{tool.name}</td>
                  <td className="px-4 py-2.5">
                    {tool.readOnly ? (
                      <span className="px-1.5 py-0.5 rounded text-[10px] bg-green/15 text-green">read</span>
                    ) : (
                      <span className="px-1.5 py-0.5 rounded text-[10px] bg-orange/15 text-orange">write</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-text-dim text-xs">{tool.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
