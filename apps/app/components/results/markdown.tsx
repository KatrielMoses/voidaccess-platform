import ReactMarkdown, { type Components } from "react-markdown";

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

/**
 * Shared element overrides, so the inline renderer keeps exactly the same safety rules as the block one:
 * links stay text (never an <a>), images become their alt text and are never fetched, code is a mono chip.
 */
const SAFE_COMPONENTS: Components = {
  // links stay text: paper with a hairline underline, never an <a> (no source is one click away)
  a: ({ children: c, href }) => (
    <span className="underline decoration-line-3 underline-offset-[3px]">
      {c}
      {href ? <span className="sr-only"> (link removed)</span> : null}
    </span>
  ),
  img: ({ alt }) => (
    <span className="font-mono text-[13px] text-mute">{alt ? `[image: ${alt}]` : "[image removed]"}</span>
  ),
  code: ({ children: c }) => (
    <code className="rounded-xs border border-line px-1 py-px font-mono text-[0.84em] break-words text-paper">
      {c}
    </code>
  ),
};

export function SafeMarkdown({ children }: { children: string }) {
  return (
    <div className={PROSE}>
      <ReactMarkdown
        allowedElements={ALLOWED}
        unwrapDisallowed
        skipHtml
        urlTransform={() => ""}
        components={SAFE_COMPONENTS}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

/**
 * Inline-only elements for one-line notes (key findings, risk notes). Everything else (paragraphs,
 * headings, lists, quotes, code blocks) is unwrapped to its inline content; images are not rendered as
 * images (the shared img override turns them into alt text, like SafeMarkdown).
 */
const INLINE_ALLOWED = ["strong", "em", "code", "del", "a", "img"];

const INLINE_CLASS = "[&_strong]:font-medium [&_em]:italic [&_del]:text-mute";

/**
 * Inline markdown for a single list item: `code` becomes a mono chip, *emphasis* italic, **strong** medium
 * weight. Same safety rules as SafeMarkdown: no raw HTML, no links (text only), no fetched images.
 */
export function InlineMarkdown({ children }: { children: string }) {
  return (
    <span className={INLINE_CLASS}>
      <ReactMarkdown
        allowedElements={INLINE_ALLOWED}
        unwrapDisallowed
        skipHtml
        urlTransform={() => ""}
        components={SAFE_COMPONENTS}
      >
        {children}
      </ReactMarkdown>
    </span>
  );
}

/** Lowercase, punctuation and markup stripped, whitespace collapsed: "## **Intelligence Summary:**" -> "intelligence summary". */
function normalizeTitle(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const TITLES = new Set(["intelligence summary", "summary"]);

/**
 * Drop a leading heading that repeats the section title ("# Intelligence summary", "## Summary", or a
 * setext heading). Only the first block is considered, and only if it is a heading; everything else
 * is returned untouched.
 */
export function stripLeadingTitle(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  let i = 0;
  while (i < lines.length && lines[i]!.trim() === "") i++;
  if (i >= lines.length) return markdown;
  const first = lines[i]!;
  let headingText: string | null = null;
  let end = i + 1;
  const atx = /^ {0,3}#{1,6}(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/.exec(first);
  if (atx) {
    headingText = atx[1] ?? "";
  } else if (i + 1 < lines.length && /^ {0,3}(?:=+|-+)[ \t]*$/.test(lines[i + 1]!) && first.trim() !== "") {
    headingText = first;
    end = i + 2;
  }
  if (headingText === null || !TITLES.has(normalizeTitle(headingText))) return markdown;
  const rest = lines.slice(end);
  while (rest.length > 0 && rest[0]!.trim() === "") rest.shift();
  return rest.join("\n");
}
