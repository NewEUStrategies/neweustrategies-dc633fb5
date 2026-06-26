import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { RichTextView, pickLocalizedBlocks } from "./RichTextView";
import type { Json } from "@/lib/builder/types";

const para = (text: string) => ({
  version: 1,
  blocks: [{ id: "b1", type: "paragraph", data: { html: `<p>${text}</p>` } }],
});

describe("pickLocalizedBlocks", () => {
  it("returns null for non-localized / malformed values", () => {
    expect(pickLocalizedBlocks(undefined, "pl")).toBeNull();
    expect(pickLocalizedBlocks(null as unknown as Json, "pl")).toBeNull();
    expect(pickLocalizedBlocks("x" as Json, "pl")).toBeNull();
    expect(pickLocalizedBlocks([] as unknown as Json, "pl")).toBeNull();
    expect(pickLocalizedBlocks({} as Json, "pl")).toBeNull();
    expect(pickLocalizedBlocks({ pl: 7 } as unknown as Json, "pl")).toBeNull();
  });

  it("picks the requested language", () => {
    const doc = { pl: para("polski"), en: para("english") } as unknown as Json;
    expect(pickLocalizedBlocks(doc, "en")?.blocks[0].id).toBe("b1");
    expect(pickLocalizedBlocks(doc, "pl")).not.toBeNull();
  });

  it("falls back pl → en when the requested language is missing", () => {
    expect(pickLocalizedBlocks({ pl: para("only-pl") } as unknown as Json, "en")).not.toBeNull();
    expect(pickLocalizedBlocks({ en: para("only-en") } as unknown as Json, "pl")).not.toBeNull();
  });
});

describe("RichTextView", () => {
  it("renders the blocks document for the active language", () => {
    const { getByText } = render(
      <RichTextView content={{ doc: { pl: para("Witaj"), en: para("Hello") } as unknown as Json }} lang="en" />,
    );
    expect(getByText("Hello")).toBeTruthy();
  });

  it("renders nothing when there is no document", () => {
    const { container } = render(<RichTextView content={{}} lang="pl" />);
    expect(container.textContent).toBe("");
  });

  it("renders nothing for an empty blocks document", () => {
    const { container } = render(
      <RichTextView content={{ doc: { pl: { version: 1, blocks: [] } } as unknown as Json }} lang="pl" />,
    );
    expect(container.textContent).toBe("");
  });
});
