import ReactMarkdown from 'react-markdown';

export function Markdown({ children }: { children: string }) {
  return (
    <div className="text-[13px] text-text-dim leading-relaxed [&_h1]:text-base [&_h1]:font-semibold [&_h1]:text-text [&_h1]:mt-4 [&_h1]:mb-2 [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:text-text [&_h2]:mt-3 [&_h2]:mb-1.5 [&_h3]:text-xs [&_h3]:font-semibold [&_h3]:text-text [&_h3]:mt-2 [&_h3]:mb-1 [&_p]:mb-2 [&_ul]:list-disc [&_ul]:pl-4 [&_ul]:mb-2 [&_ol]:list-decimal [&_ol]:pl-4 [&_ol]:mb-2 [&_li]:mb-0.5 [&_code]:bg-bg [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-xs [&_code]:font-mono [&_pre]:bg-bg [&_pre]:rounded [&_pre]:p-3 [&_pre]:mb-2 [&_pre]:overflow-x-auto [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_table]:w-full [&_table]:text-xs [&_table]:mb-2 [&_th]:text-left [&_th]:border-b [&_th]:border-border [&_th]:pb-1 [&_th]:pr-3 [&_td]:border-b [&_td]:border-border/50 [&_td]:py-1 [&_td]:pr-3 [&_strong]:text-text [&_a]:text-accent [&_a]:underline [&_hr]:border-border [&_hr]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-accent [&_blockquote]:pl-3 [&_blockquote]:text-text-muted">
      <ReactMarkdown>{children}</ReactMarkdown>
    </div>
  );
}
