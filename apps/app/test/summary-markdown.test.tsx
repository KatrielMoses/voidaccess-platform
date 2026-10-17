// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { InlineMarkdown, SafeMarkdown, stripLeadingTitle } from "@/components/results/markdown";

afterEach(cleanup);

const FINDINGS = [
  "`lockbit…zwrad[.]onion` hosts the leak site",
  "*Source Links Referenced* across 3 pages",
  "**LockBit 3.0** affiliates use `T1486`",
];

function renderFindings(items: string[]) {
  return render(
    <ol>
      {items.map((f, i) => (
        <li key={i}>
          <InlineMarkdown>{f}</InlineMarkdown>
        </li>
      ))}
    </ol>,
  );
}

describe("InlineMarkdown (key findings / risk notes)", () => {
  it("renders inline markdown without leaving raw markers", () => {
    const { container } = renderFindings(FINDINGS);
    const text = container.textContent ?? "";
    expect(text).not.toContain("`");
    expect(text).not.toContain("*");
    expect(text).toContain("lockbit…zwrad[.]onion hosts the leak site");
    expect(text).toContain("Source Links Referenced across 3 pages");
    expect(text).toContain("LockBit 3.0 affiliates use T1486");

    const codes = [...container.querySelectorAll("code")].map((c) => c.textContent);
    expect(codes).toEqual(["lockbit…zwrad[.]onion", "T1486"]);
    expect(container.querySelector("code")).toHaveClass(
      "font-mono",
      "border",
      "border-line",
      "rounded-xs",
      "px-1",
    );
    expect(container.querySelector("em")).toHaveTextContent("Source Links Referenced");
    expect(container.querySelector("strong")).toHaveTextContent("LockBit 3.0");
    expect(container.querySelectorAll("a")).toHaveLength(0);
  });

  it("is inline-only: no paragraphs, headings, lists or images inside an item", () => {
    const { container } = renderFindings([
      "# Heading in a finding",
      "- a nested list item",
      "first para\n\nsecond para",
      "![logo](http://evil.example/x.png) seen",
    ]);
    for (const tag of ["p", "h1", "h2", "img", "blockquote", "pre"]) {
      expect(container.querySelector(`li ${tag}`), tag).toBeNull();
    }
    expect(container.querySelectorAll("li ul, li ol")).toHaveLength(0);
    expect(container.textContent).toContain("Heading in a finding");
    expect(container.textContent).toContain("[image: logo]");
  });

  it("keeps links as text and drops raw HTML", () => {
    const { container } = renderFindings([
      "see [the leak site](http://lockbitxyz.onion/post) and <script>alert(1)</script><b>bold</b> http://abc.onion",
    ]);
    expect(container.querySelectorAll("a")).toHaveLength(0);
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect(container.textContent).toContain("the leak site");
    expect(container.textContent).not.toContain("lockbitxyz.onion");
  });
});

describe("stripLeadingTitle", () => {
  const BODY =
    "## Intelligence Summary\n\nLockBit 3.0 affiliates published new victims.\n\n## Actors\n\nMore.";

  it("drops a leading heading that repeats the section title and keeps the rest", () => {
    expect(stripLeadingTitle(BODY)).toBe(
      "LockBit 3.0 affiliates published new victims.\n\n## Actors\n\nMore.",
    );
    expect(stripLeadingTitle("# Intelligence summary\nLockBit")).toBe("LockBit");
    expect(stripLeadingTitle("\n\n### **Intelligence  Summary:** ##\n\nLockBit")).toBe("LockBit");
    expect(stripLeadingTitle("# Summary\n\nLockBit")).toBe("LockBit");
    expect(stripLeadingTitle("Intelligence Summary\n====\n\nLockBit")).toBe("LockBit");
  });

  it("leaves other content alone", () => {
    expect(stripLeadingTitle("Intelligence Summary\n\nLockBit")).toBe("Intelligence Summary\n\nLockBit");
    expect(stripLeadingTitle("## Overview\n\nLockBit")).toBe("## Overview\n\nLockBit");
    expect(stripLeadingTitle("LockBit\n\n## Summary\n\nx")).toBe("LockBit\n\n## Summary\n\nx");
    expect(stripLeadingTitle("## Summary of LockBit\n\nx")).toBe("## Summary of LockBit\n\nx");
  });

  it("removes the duplicate heading from the rendered summary body", () => {
    const { container } = render(<SafeMarkdown>{stripLeadingTitle(BODY)}</SafeMarkdown>);
    expect(container.textContent).not.toMatch(/intelligence summary/i);
    expect(container.querySelector("p")).toHaveTextContent("LockBit 3.0 affiliates published new victims.");
    expect(container.querySelector("h2")).toHaveTextContent("Actors");
  });
});
