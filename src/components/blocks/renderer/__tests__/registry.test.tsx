import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import type { BlockType, BlocksDoc } from "@/lib/blocks/types";
import { BLOCK_SPECS, IMPLEMENTED_BLOCKS } from "@/lib/blocks/registry";
import { BLOCK_RENDERERS } from "../registry";
import { BlocksRenderer } from "../../BlocksRenderer";

const doc = (blocks: BlocksDoc["blocks"]): BlocksDoc => ({ version: 1, blocks });

describe("BLOCK_RENDERERS registry", () => {
  it("provides exactly one renderer for every declared block type", () => {
    const specTypes = Object.keys(BLOCK_SPECS) as BlockType[];
    const rendererTypes = Object.keys(BLOCK_RENDERERS) as BlockType[];
    // No editor block type is missing a public renderer.
    const missing = specTypes.filter((t) => typeof BLOCK_RENDERERS[t] !== "function");
    expect(missing).toEqual([]);
    // No renderer exists for a type the editor does not know about.
    const orphan = rendererTypes.filter((t) => !(t in BLOCK_SPECS));
    expect(orphan).toEqual([]);
    // The two registries describe the same universe of block types.
    expect(rendererTypes.sort()).toEqual([...specTypes].sort());
  });

  it("covers every implemented block type", () => {
    for (const t of IMPLEMENTED_BLOCKS) {
      expect(typeof BLOCK_RENDERERS[t]).toBe("function");
    }
  });
});

describe("BlocksRenderer registry dispatch (static blocks)", () => {
  it("renders atoms: button, callout, separator, pullquote", () => {
    const { container, getByText } = render(
      <BlocksRenderer
        doc={doc([
          { id: "btn", type: "button", data: { label: "Click me", href: "/x" } },
          { id: "co", type: "callout", data: { variant: "warning", text: "Heads up" } },
          { id: "sep", type: "separator", data: { variant: "line" } },
          { id: "pq", type: "pullquote", data: { text: "Big idea", cite: "Author" } },
        ])}
        lang="en"
      />,
    );
    const link = getByText("Click me");
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe("/x");
    expect(getByText("Heads up")).toBeTruthy();
    expect(container.querySelector("hr")).not.toBeNull();
    expect(getByText("Big idea")).toBeTruthy();
    // pullquote renders the cite with an ASCII hyphen prefix, never an em dash.
    expect(container.textContent).toContain("- Author");
    expect(container.textContent).not.toContain("—");
  });

  it("recurses into columns and honors nested hidden blocks", () => {
    const { container, getByText, queryByText } = render(
      <BlocksRenderer
        doc={doc([
          {
            id: "cols",
            type: "columns",
            data: {
              left: [{ id: "cl", type: "paragraph", data: { html: "<p>Left side</p>" } }],
              right: [
                { id: "cr", type: "paragraph", data: { html: "<p>Right side</p>" } },
                {
                  id: "hid",
                  type: "paragraph",
                  data: { html: "<p>Secret</p>" },
                  style: { hidden: true },
                },
              ],
            },
          },
        ])}
        lang="en"
      />,
    );
    expect(getByText("Left side")).toBeTruthy();
    expect(getByText("Right side")).toBeTruthy();
    // A hidden nested block must not leak to the published output.
    expect(queryByText("Secret")).toBeNull();
    expect(container.querySelector(".grid")).not.toBeNull();
  });

  it("drops top-level hidden blocks entirely", () => {
    const { queryByText } = render(
      <BlocksRenderer
        doc={doc([
          { id: "v", type: "paragraph", data: { html: "<p>Visible</p>" } },
          { id: "h", type: "paragraph", data: { html: "<p>Hidden</p>" }, style: { hidden: true } },
        ])}
      />,
    );
    expect(queryByText("Visible")).toBeTruthy();
    expect(queryByText("Hidden")).toBeNull();
  });

  it("applies alignment classes from block.style.align", () => {
    const { container } = render(
      <BlocksRenderer
        doc={doc([
          {
            id: "h",
            type: "heading",
            data: { level: 2, text: "Centered" },
            style: { align: "center" },
          },
        ])}
        lang="en"
      />,
    );
    const heading = container.querySelector("h2");
    expect(heading?.className).toContain("text-center");
  });
});
