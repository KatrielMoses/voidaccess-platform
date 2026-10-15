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

/** Reading typography (design.md §4): General Sans 400 17px/1.6, 500 headings with tight tracking, mono IOCs. */
const PROSE = [
  "max-w-[68ch] space-y-4 [overflow-wrap:anywhere] text-[16px] leading-[1.6] text-paper sm:text-[17px]",
  "[&_h1]:mt-9 [&_h1]:text-[26px] [&_h1]:leading-[1.15] [&_h1]:font-medium [&_h1]:tracking-[-0.03em]",
  "[&_h2]:mt-8 [&_h2]:text-[22px] [&_h2]:leading-[1.2] [&_h2]:font-medium [&_h2]:tracking-[-0.025em]",
  "[&_h3]:mt-6 [&_h3]:text-[18px] [&_h3]:leading-[1.3] [&_h3]:font-medium [&_h3]:tracking-[-0.015em]",
  "[&_h4]:mt-5 [&_h4]:font-medium [&_h5]:font-medium [&_h6]:font-medium [&>*:first-child]:mt-0",
  "[&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:list-disc [&_ul]:pl-6 [&_li]:my-1.5 [&_li]:pl-1 [&_li::marker]:text-mute",
  "[&_strong]:font-medium [&_em]:text-dim [&_del]:text-mute",
  "[&_blockquote]:border-l [&_blockquote]:border-line-3 [&_blockquote]:pl-5 [&_blockquote]:text-dim",
  "[&_hr]:my-8 [&_hr]:border-line",
  "[&_pre]:overflow-x-auto [&_pre]:rounded-sm [&_pre]:border [&_pre]:border-line [&_pre]:p-4 [&_pre_code]:border-0 [&_pre_code]:p-0",
].join(" ");

export function SafeMarkdown({ children }: { children: string }) {
  return (
    <div className={PROSE}>
      <ReactMarkdown
        allowedElements={ALLOWED}
        unwrapDisallowed
        skipHtml
        urlTransform={() => ""}
        components={{
          // links stay text: paper with a hairline underline, never an <a> (no source is one click away)
          a: ({ children: c, href }) => (
            <span className="underline decoration-line-3 underline-offset-[3px]">
              {c}
              {href ? <span className="sr-only"> (link removed)</span> : null}
            </span>
          ),
          img: ({ alt }) => (
            <span className="font-mono text-[13px] text-mute">
              {alt ? `[image: ${alt}]` : "[image removed]"}
            </span>
          ),
          code: ({ children: c }) => (
            <code className="rounded-xs border border-line px-1 py-px font-mono text-[0.84em] break-words text-paper">
              {c}
            </code>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
