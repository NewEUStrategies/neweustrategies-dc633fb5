import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { BlocksDoc } from "@/lib/blocks/types";
import * as schema from "@/lib/blocks/schema";
import * as footnotes from "../renderer/footnotes";
import { BlocksRenderer } from "../BlocksRenderer";

const documentWithNote = (text: string): BlocksDoc => ({
  version: 1,
  blocks: [{ id: "p1", type: "paragraph", data: { html: `<p>Claim[fn]${text}[/fn]</p>` } }],
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("document preparation", () => {
  it("reuses parsing and footnotes while updating presentation props", () => {
    const parse = vi.spyOn(schema, "safeParseBlocks");
    const prepare = vi.spyOn(footnotes, "precomputeFootnotes");
    const doc = documentWithNote("First source");
    const { rerender, container } = render(<BlocksRenderer doc={doc} lang="pl" />);
    parse.mockClear();
    prepare.mockClear();
    rerender(<BlocksRenderer doc={doc} lang="en" tenantHost="example.org" />);
    expect(parse).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
    expect(container.querySelector("article")).toHaveAttribute("lang", "en");
    expect(container.querySelector("article")).toHaveAttribute("data-tenant-scope", "example.org");
    expect(container.querySelectorAll("[data-footnotes-list] li")).toHaveLength(1);
    expect(container.textContent).toContain("First source");

    rerender(<BlocksRenderer doc={documentWithNote("Replaced source")} lang="en" />);
    expect(parse).toHaveBeenCalledOnce();
    expect(prepare).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("Replaced source");
    expect(container.textContent).not.toContain("First source");
    expect(container.querySelectorAll("[data-footnotes-list] li")).toHaveLength(1);
  });

  it("handles empty -> populated -> empty documents without changing hook order", () => {
    const { rerender, container } = render(<BlocksRenderer doc={null} />);
    expect(container.innerHTML).toBe("");
    rerender(<BlocksRenderer doc={documentWithNote("Loaded source")} />);
    expect(container.textContent).toContain("Loaded source");
    rerender(<BlocksRenderer doc={undefined} />);
    expect(container.innerHTML).toBe("");
  });

  it("does not share prepared notes between renderer instances", () => {
    const { container } = render(
      <>
        <BlocksRenderer doc={documentWithNote("Tenant one")} />
        <BlocksRenderer doc={documentWithNote("Tenant two")} />
      </>,
    );
    const articles = container.querySelectorAll("article");
    expect(articles[0]?.textContent).toContain("Tenant one");
    expect(articles[0]?.textContent).not.toContain("Tenant two");
    expect(articles[1]?.textContent).toContain("Tenant two");
  });
});
