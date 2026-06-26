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

  it("turns [fn]…[/fn] markers into a ref AND renders the footnotes section on first paint", () => {
    const { container } = render(
      <BlocksRenderer
        doc={doc([{ id: "p1", type: "paragraph", data: { html: "<p>Claim[fn]the source[/fn].</p>" } }])}
        lang="en"
      />,
    );
    const ref = container.querySelector("sup.fn-ref a");
    expect(ref).not.toBeNull();
    expect(ref?.getAttribute("href")).toBe("#fn-1");
    expect(container.textContent).toContain("[1]");
    // Regression guard: the end-of-article footnotes section must render on the
    // first paint (it previously never appeared due to render-time mutation).
    const list = container.querySelector("[data-footnotes-list]");
    expect(list).not.toBeNull();
    expect(container.querySelector("#fn-1")).not.toBeNull();
    expect(list?.textContent).toContain("the source");
  });

  it("numbers footnotes across nested column blocks in document order", () => {
    const { container } = render(
      <BlocksRenderer
        doc={doc([
          {
            id: "c1",
            type: "columns",
            data: {
              left: [{ id: "l1", type: "paragraph", data: { html: "<p>Left[fn]first[/fn]</p>" } }],
              right: [{ id: "r1", type: "paragraph", data: { html: "<p>Right[fn]second[/fn]</p>" } }],
            },
          },
        ])}
        lang="en"
      />,
    );
    const items = Array.from(container.querySelectorAll("[data-footnotes-list] li"));
    expect(items).toHaveLength(2);
    expect(items[0].id).toBe("fn-1");
    expect(items[0].textContent).toContain("first");
    expect(items[1].id).toBe("fn-2");
    expect(items[1].textContent).toContain("second");
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
