import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { BlocksRenderer } from "./BlocksRenderer";
import type { BlocksDoc } from "@/lib/blocks/types";

const doc = (blocks: BlocksDoc["blocks"]): BlocksDoc => ({ version: 1, blocks });

describe("BlocksRenderer", () => {
  it("renders nothing for an empty / missing document", () => {
    expect(render(<BlocksRenderer doc={null} />).container.textContent).toBe("");
    expect(render(<BlocksRenderer doc={doc([])} />).container.textContent).toBe("");
  });

  it("renders core block types", () => {
    const { container, getByText } = render(
      <BlocksRenderer
        doc={doc([
          { id: "p1", type: "paragraph", data: { html: "<p>Hello world</p>" } },
          { id: "h1", type: "heading", data: { level: 2, text: "A Section" } },
          { id: "l1", type: "list", data: { items: ["one", "two"], ordered: false } },
          { id: "q1", type: "quote", data: { text: "Quoted", cite: "Someone" } },
        ])}
        lang="en"
      />,
    );
    expect(getByText("Hello world")).toBeTruthy();
    const heading = getByText("A Section");
    expect(heading.tagName).toBe("H2");
    // Heading gets a slugified id for deep-linking.
    expect(heading.id).toBe("a-section");
    expect(getByText("one")).toBeTruthy();
    expect(getByText("Quoted")).toBeTruthy();
    expect(container.querySelector("blockquote")).not.toBeNull();
  });

  it("sanitizes dangerous markup out of HTML blocks", () => {
    const { container } = render(
      <BlocksRenderer
        doc={doc([{ id: "p1", type: "paragraph", data: { html: "<p>safe</p><script>alert(1)</script>" } }])}
      />,
    );
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("safe");
  });

  it("turns [fn]…[/fn] markers into a numbered footnote reference", () => {
    const { container } = render(
      <BlocksRenderer
        doc={doc([{ id: "p1", type: "paragraph", data: { html: "<p>Claim[fn]the source[/fn].</p>" } }])}
        lang="en"
      />,
    );
    const ref = container.querySelector("sup.fn-ref a");
    expect(ref).not.toBeNull();
    expect(ref?.getAttribute("title")).toBe("the source");
    expect(ref?.getAttribute("href")).toBe("#fn-1");
    expect(container.textContent).toContain("[1]");
  });

  it("renders a table with a header row", () => {
    const { container } = render(
      <BlocksRenderer
        doc={doc([
          { id: "t1", type: "table", data: { header: true, rows: [["A", "B"], ["1", "2"]] } },
        ])}
      />,
    );
    expect(container.querySelectorAll("th")).toHaveLength(2);
    expect(container.querySelectorAll("tbody tr")).toHaveLength(1);
  });
});
