import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { ContentRenderer } from "./ContentRenderer";
import { emptyDocument } from "@/lib/builder/types";
import type { BlocksDoc } from "@/lib/blocks/types";

const blocks = (html: string): BlocksDoc => ({
  version: 1,
  blocks: [{ id: "p1", type: "paragraph", data: { html } }],
});

describe("ContentRenderer", () => {
  it("renders sanitized HTML for the legacy/richtext path", () => {
    const { container } = render(
      <ContentRenderer
        editor="richtext"
        builderDoc={emptyDocument()}
        blocksDoc={null}
        html="<p>Legacy body</p><script>alert(1)</script>"
        lang="pl"
      />,
    );
    expect(container.querySelector("article.single-post-content")).not.toBeNull();
    expect(container.textContent).toContain("Legacy body");
    expect(container.querySelector("script")).toBeNull();
  });

  it("renders the blocks engine when editor=blocks with content", () => {
    const { getByText } = render(
      <ContentRenderer
        editor="blocks"
        builderDoc={emptyDocument()}
        blocksDoc={blocks("<p>From blocks</p>")}
        html=""
        lang="en"
      />,
    );
    expect(getByText("From blocks")).toBeTruthy();
  });

  it("falls back to HTML when the blocks doc is empty", () => {
    const { container } = render(
      <ContentRenderer
        editor="blocks"
        builderDoc={emptyDocument()}
        blocksDoc={{ version: 1, blocks: [] }}
        html="<p>fallback</p>"
        lang="en"
      />,
    );
    expect(container.querySelector("article.single-post-content")).not.toBeNull();
    expect(container.textContent).toContain("fallback");
  });
});
