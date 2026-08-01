import { describe, it, expect, beforeEach } from "vitest";
import {
  focusBlockEditable,
  requestBlockFocus,
  reapplyPendingBlockFocus,
  isTextEntryBlockType,
} from "@/lib/blocks/focus";

function mountHost(id: string, inner: string): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("data-block-id", id);
  el.innerHTML = inner;
  document.body.appendChild(el);
  return el;
}

beforeEach(() => {
  document.body.innerHTML = "";
  window.getSelection()?.removeAllRanges();
});

describe("focusBlockEditable", () => {
  it("prefers the [data-block-editable] marker over an earlier editable (code block case)", () => {
    mountHost(
      "b_code",
      '<input type="text" value="ts" /><textarea data-block-editable="true">const a=1</textarea>',
    );
    expect(focusBlockEditable("b_code", "end")).toBe(true);
    const textarea = document.querySelector("textarea");
    expect(document.activeElement).toBe(textarea);
    expect(textarea?.selectionStart).toBe("const a=1".length);
  });

  it("falls back to the first editable when there is no marker", () => {
    mountHost("b_quote", "<textarea>cytat</textarea><input value='autor' />");
    expect(focusBlockEditable("b_quote", "start")).toBe(true);
    expect(document.activeElement).toBe(document.querySelector("textarea"));
  });

  it("returns false (retry) when the host exists but the field is not mounted yet", () => {
    mountHost("b_pending", '<div class="preview">podgląd bez pola</div>');
    expect(focusBlockEditable("b_pending", "start")).toBe(false);
  });

  it("returns false when the block is not in the DOM at all", () => {
    expect(focusBlockEditable("b_missing", "start")).toBe(false);
  });

  it("places the caret at a character offset inside contentEditable (merge junction)", () => {
    mountHost("b_p", '<div contenteditable="true">Hello <strong>world</strong></div>');
    expect(focusBlockEditable("b_p", 6)).toBe(true);
    const sel = window.getSelection();
    expect(sel?.anchorNode?.textContent).toBe("Hello ");
    expect(sel?.anchorOffset).toBe(6);
  });

  it("clamps numeric offsets beyond the content", () => {
    mountHost("b_t", "<textarea>abc</textarea>");
    expect(focusBlockEditable("b_t", 999)).toBe(true);
    expect(document.querySelector("textarea")?.selectionStart).toBe(3);
  });
});

describe("requestBlockFocus + reapplyPendingBlockFocus", () => {
  it("reapplies the pending caret after an external setContent-like selection reset", async () => {
    mountHost("b_merge", '<div contenteditable="true">abcdef</div>');
    requestBlockFocus("b_merge", 3);
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    // Symulacja `setContent` TipTapa: selekcja ląduje gdzie indziej / znika.
    window.getSelection()?.removeAllRanges();
    reapplyPendingBlockFocus("b_merge");
    const sel = window.getSelection();
    expect(sel?.anchorOffset).toBe(3);
    expect(sel?.anchorNode?.textContent).toBe("abcdef");
  });

  it("ignores reapply for a block without a pending request", () => {
    mountHost("b_other", '<div contenteditable="true">xyz</div>');
    window.getSelection()?.removeAllRanges();
    reapplyPendingBlockFocus("b_other");
    expect(window.getSelection()?.rangeCount ?? 0).toBe(0);
  });
});

describe("isTextEntryBlockType", () => {
  it("covers typing-first blocks and excludes preview-only html", () => {
    expect(isTextEntryBlockType("paragraph")).toBe(true);
    expect(isTextEntryBlockType("details")).toBe(true);
    expect(isTextEntryBlockType("html")).toBe(false);
    expect(isTextEntryBlockType("image")).toBe(false);
  });
});
