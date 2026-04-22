import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';

interface MarkdownContentProps {
  content: string;
  className?: string;
}

const components: Components = {
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  h1: ({ children }) => <h1 className="text-lg font-bold mb-2 mt-3 first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="text-base font-bold mb-2 mt-3 first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="text-sm font-bold mb-1 mt-2 first:mt-0">{children}</h3>,
  ul: ({ children }) => <ul className="list-disc pl-4 mb-2 space-y-0.5">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-4 mb-2 space-y-0.5">{children}</ol>,
  li: ({ children }) => <li className="text-sm">{children}</li>,
  pre: ({ children }) => (
    <pre className="rounded-md bg-zinc-900 p-3 overflow-x-auto mb-2 text-xs font-mono">{children}</pre>
  ),
  code: ({ className, children, ...props }) => {
    if (className) {
      return <code className="text-green-300" {...props}>{children}</code>;
    }
    return (
      <code className="px-1 py-0.5 rounded bg-muted text-[0.85em] font-mono" {...props}>{children}</code>
    );
  },
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-primary/30 pl-3 italic text-muted-foreground mb-2">{children}</blockquote>
  ),
  a: ({ href, children }) => (
    <a href={href} className="text-blue-500 underline hover:no-underline" target="_blank" rel="noopener noreferrer">{children}</a>
  ),
  table: ({ children }) => (
    <div className="overflow-x-auto mb-2">
      <table className="min-w-full text-sm border border-border">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="px-2 py-1 bg-muted font-medium text-left border-b border-border">{children}</th>,
  td: ({ children }) => <td className="px-2 py-1 border-b border-border">{children}</td>,
  hr: () => <hr className="border-border my-3" />,
};

export function MarkdownContent({ content, className = '' }: MarkdownContentProps) {
  return (
    <div className={`text-sm leading-relaxed ${className}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
