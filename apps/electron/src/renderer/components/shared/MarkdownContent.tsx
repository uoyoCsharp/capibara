import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '../../lib/utils';

interface MarkdownContentProps {
  content: string;
  className?: string;
}

/**
 * Renders markdown content with GFM support (tables, strikethrough, task lists, etc.).
 * Styled to blend with the app's design system — compact typography, themed colors.
 */
export const MarkdownContent = memo(function MarkdownContent({
  content,
  className,
}: MarkdownContentProps) {
  return (
    <div className={cn('markdown-content', className)}>
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        // Open links in external browser
        a: ({ href, children, ...props }) => {
          const safeHref = href && /^https?:\/\//i.test(href) ? href : undefined;
          return (
            <a
              href={safeHref}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline underline-offset-2 hover:text-primary/80"
              {...props}
            >
              {children}
            </a>
          );
        },
        // Inline code
        code: ({ children, className: codeClassName, ...props }) => {
          const isBlock = codeClassName?.startsWith('language-');
          if (isBlock) {
            return (
              <code className={cn('block', codeClassName)} {...props}>
                {children}
              </code>
            );
          }
          return (
            <code
              className="rounded bg-muted px-1 py-0.5 text-[0.85em] font-mono"
              {...props}
            >
              {children}
            </code>
          );
        },
        // Code blocks
        pre: ({ children, ...props }) => (
          <pre
            className="rounded-md bg-muted p-3 overflow-x-auto text-xs font-mono my-2"
            {...props}
          >
            {children}
          </pre>
        ),
        // Tables
        table: ({ children, ...props }) => (
          <div className="overflow-x-auto my-2">
            <table className="min-w-full text-xs border-collapse" {...props}>
              {children}
            </table>
          </div>
        ),
        th: ({ children, ...props }) => (
          <th
            className="border border-border bg-muted px-2 py-1 text-left font-semibold"
            {...props}
          >
            {children}
          </th>
        ),
        td: ({ children, ...props }) => (
          <td className="border border-border px-2 py-1" {...props}>
            {children}
          </td>
        ),
        // Lists
        ul: ({ children, ...props }) => (
          <ul className="list-disc pl-4 my-1 space-y-0.5" {...props}>
            {children}
          </ul>
        ),
        ol: ({ children, ...props }) => (
          <ol className="list-decimal pl-4 my-1 space-y-0.5" {...props}>
            {children}
          </ol>
        ),
        // Headings — scale down to fit within message context
        h1: ({ children, ...props }) => (
          <h1 className="text-base font-bold mt-3 mb-1" {...props}>{children}</h1>
        ),
        h2: ({ children, ...props }) => (
          <h2 className="text-sm font-bold mt-2.5 mb-1" {...props}>{children}</h2>
        ),
        h3: ({ children, ...props }) => (
          <h3 className="text-sm font-semibold mt-2 mb-0.5" {...props}>{children}</h3>
        ),
        h4: ({ children, ...props }) => (
          <h4 className="text-xs font-semibold mt-1.5 mb-0.5" {...props}>{children}</h4>
        ),
        // Paragraphs
        p: ({ children, ...props }) => (
          <p className="my-1 leading-relaxed" {...props}>{children}</p>
        ),
        // Blockquotes
        blockquote: ({ children, ...props }) => (
          <blockquote
            className="border-l-2 border-primary/30 pl-3 my-2 text-muted-foreground italic"
            {...props}
          >
            {children}
          </blockquote>
        ),
        // Horizontal rules
        hr: (props) => <hr className="border-border my-3" {...props} />,
        // Bold / strong
        strong: ({ children, ...props }) => (
          <strong className="font-semibold text-foreground" {...props}>{children}</strong>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
    </div>
  );
});
