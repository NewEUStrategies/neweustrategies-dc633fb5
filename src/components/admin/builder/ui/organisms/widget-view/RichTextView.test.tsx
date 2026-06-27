import { toJson } from "@/lib/builder/types";
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
    expect(pickLocalizedBlocks(toJson(null), "pl")).toBeNull();
    expect(pickLocalizedBlocks("x" as Json, "pl")).toBeNull();
    expect(pickLocalizedBlocks(toJson([]), "pl")).toBeNull();
    expect(pickLocalizedBlocks({} as Json, "pl")).toBeNull();
    expect(pickLocalizedBlocks(toJson({ pl: 7 }), "pl")).toBeNull();
  });

  it("picks the requested language", () => {
    const doc = toJson({ pl: para("polski"), en: para("english") });
    expect(pickLocalizedBlocks(doc, "en")?.blocks[0].id).toBe("b1");
    expect(pickLocalizedBlocks(doc, "pl")).not.toBeNull();
  });

  it("falls back pl → en when the requested language is missing", () => {
    expect(pickLocalizedBlocks(toJson({ pl: para("only-pl") }), "en")).not.toBeNull();
    expect(pickLocalizedBlocks(toJson({ en: para("only-en") }), "pl")).not.toBeNull();
  });
});

describe("RichTextView", () => {
  it("renders the blocks document for the active language", () => {
    const { getByText } = render(
      <RichTextView content={{ doc: toJson({ pl: para("Witaj"), en: para("Hello") }) }} lang="en" />,
    );
    expect(getByText("Hello")).toBeTruthy();
  });

  it("renders nothing when there is no document", () => {
    const { container } = render(<RichTextView content={{}} lang="pl" />);
    expect(container.textContent).toBe("");
  });

  it("renders nothing for an empty blocks document", () => {
    const { container } = render(
      <RichTextView content={{ doc: toJson({ pl: { version: 1, blocks: [] } }) }} lang="pl" />,
    );
    expect(container.textContent).toBe("");
  });
});
