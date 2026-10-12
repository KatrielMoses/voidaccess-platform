import ReactMarkdown from "react-markdown";

/**
 * Safe markdown for AI summaries (guarantee 3): raw HTML is not rendered (react-markdown escapes it, and
 * rehype-raw is deliberately absent), images are replaced by their alt text and never fetched, and links
 * are rendered as plain text with the URL beside them, never as <a>, so no onion or other source URL is
 * one click away.
 */
const ALLOWED = [
  "p",
  "strong",
  "em",
  "ul",
  "ol",
  "li",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "code",
  "pre",
  "br",
  "hr",
  "a",
  "img",
  "del",
];

export function SafeMarkdown({ children }: { children: string }) {
  return (
    <div className="space-y-3 text-sm leading-relaxed text-fg [&_h1]:mt-5 [&_h1]:font-display [&_h1]:text-xl [&_h2]:mt-5 [&_h2]:font-display [&_h2]:text-lg [&_h3]:mt-4 [&_h3]:font-display [&_h3]:text-base [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold [&_li]:ml-5 [&_ol]:list-decimal [&_ul]:list-disc [&_strong]:font-semibold [&_blockquote]:border-l-2 [&_blockquote]:border-border-strong [&_blockquote]:pl-3 [&_blockquote]:text-fg-secondary">
      <ReactMarkdown
        allowedElements={ALLOWED}
        unwrapDisallowed
        skipHtml
        urlTransform={() => ""}
        components={{
          a: ({ children: c, href }) => (
            <span>
              {c}
              {href ? <span className="sr-only"> (link removed)</span> : null}
            </span>
          ),
          img: ({ alt }) => (
            <span className="text-fg-secondary">{alt ? `[image: ${alt}]` : "[image removed]"}</span>
          ),
          code: ({ children: c }) => (
            <code className="rounded bg-raised px-1 py-0.5 font-mono text-[0.85em]">{c}</code>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
