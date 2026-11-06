/**
 * The visible part of a preview summary: the first PREVIEW_SUMMARY_SENTENCES sentences of the Markdown summary, at
 * most PREVIEW_SUMMARY_CHARS characters. Only plain paragraphs count: the cut stops at the first list, table, code
 * block, quote or HTML block (never a trailing partial one), headings are skipped, and a sentence that would leave
 * unbalanced Markdown (an open link, emphasis or code span) is dropped. Pure; the rest is never returned.
 */
import { PREVIEW_SUMMARY_CHARS, PREVIEW_SUMMARY_SENTENCES } from "./shared";

const HEADING = /^ {0,3}#{1,6}(\s|$)/;
const SETEXT = /^ {0,3}(=+|-+)\s*$/;
/** list items, tables, code fences / indented code, quotes, HTML, rules, footnotes, link definitions */
const NON_PARAGRAPH =
  /^(?: {0,3}(?:[-*+]|\d{1,9}[.)])(?:\s|$)| {0,3}\||.*\|.*\|| {0,3}(?:```|~~~)| {4,}\S|\t| {0,3}>| {0,3}<| {0,3}(?:[-*_] *){3,}$| {0,3}\[[^\]]*\]:)/;

/** Sentence ends: . ! ? (optionally closed by a quote or bracket) followed by whitespace. */
function sentences(paragraph: string): string[] {
  const text = paragraph.replace(/\s*\n\s*/g, " ").trim();
  if (!text) return [];
  const out: string[] = [];
  const re = /[.!?]+["')\]*_]*\s+/g;
  let start = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const end = m.index + m[0].length;
    // "e.g. ", "i.e. ", "vs. ", a single initial ("J. ") and decimals are not sentence ends
    const before = text.slice(start, m.index + 1);
    if (/(\b(e\.g|i\.e|vs|etc|approx|incl|no|fig)\.|\b[A-Z]\.)$/i.test(before)) continue;
    out.push(text.slice(start, end).trim());
    start = end;
  }
  if (start < text.length) out.push(text.slice(start).trim());
  return out.filter(Boolean);
}

/** True when the Markdown has no open link/image bracket, code span, or emphasis run. */
export function balanced(md: string): boolean {
  const ticks = (md.match(/`/g) ?? []).length;
  if (ticks % 2) return false;
  const noCode = md.replace(/`[^`]*`/g, "");
  if ((noCode.match(/\[/g) ?? []).length !== (noCode.match(/\]/g) ?? []).length) return false;
  if ((noCode.match(/\(/g) ?? []).length < (noCode.match(/\]\(/g) ?? []).length) return false;
  const opens = (noCode.match(/\]\(/g) ?? []).length;
  if (opens && (noCode.match(/\)/g) ?? []).length < opens) return false;
  if ((noCode.match(/\*\*/g) ?? []).length % 2) return false;
  if ((noCode.match(/__/g) ?? []).length % 2) return false;
  if ((noCode.replace(/\*\*/g, "").match(/\*/g) ?? []).length % 2) return false;
  return true;
}

function blocks(markdown: string): string[][] {
  const out: string[][] = [];
  let cur: string[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    if (line.trim() === "") {
      if (cur.length) out.push(cur);
      cur = [];
    } else cur.push(line);
  }
  if (cur.length) out.push(cur);
  return out;
}

/** Cut at a word boundary at most `max` characters long, with an ellipsis. */
function cutWords(s: string, max: number): string {
  if (s.length <= max) return s;
  const slice = s.slice(0, max - 1);
  const sp = slice.lastIndexOf(" ");
  return (sp > max / 2 ? slice.slice(0, sp) : slice).replace(/[\s,;:([{-]+$/, "") + "…";
}

/** Strip Markdown markup characters (used when a single overlong sentence has to be cut). */
const plain = (s: string) =>
  s
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*_[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim();

export function previewSummary(
  markdown: string,
  maxSentences = PREVIEW_SUMMARY_SENTENCES,
  maxChars = PREVIEW_SUMMARY_CHARS,
): string {
  const paragraphs: string[][] = [];
  let count = 0;
  let used = 0;
  let stop = false;
  for (const b of blocks(markdown)) {
    if (stop || count >= maxSentences) break;
    if (b.length === 1 && HEADING.test(b[0]!)) continue; // a heading line is skipped, never shown
    if (b.length === 2 && SETEXT.test(b[1]!)) continue; // setext heading
    if (b.some((l) => NON_PARAGRAPH.test(l))) break; // a list, table, code or quote ends the visible part
    const para: string[] = [];
    for (const s of sentences(b.join("\n"))) {
      if (count >= maxSentences) break;
      const sep = para.length ? 1 : paragraphs.length ? 2 : 0;
      const room = maxChars - used - sep;
      if (s.length > room) {
        if (count === 0) {
          // the very first sentence is too long: show its start as plain text
          const cut = cutWords(plain(s), maxChars);
          return cut;
        }
        stop = true;
        break;
      }
      if (!balanced(s)) {
        stop = true; // a sentence split inside a link or emphasis: stop before it
        break;
      }
      para.push(s);
      used += sep + s.length;
      count++;
    }
    if (para.length) paragraphs.push(para);
  }
  return paragraphs.map((p) => p.join(" ")).join("\n\n");
}
