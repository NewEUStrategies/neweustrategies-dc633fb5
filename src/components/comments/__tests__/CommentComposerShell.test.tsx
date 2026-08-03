// Kompozytor komentarza: pasek formatowania faktycznie modyfikuje treść
// (markdown wokół zaznaczenia), licznik znaków i „wyczyść" działają.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import "@/lib/i18n";
import { applyMarkdown, CommentComposerShell } from "../CommentComposerShell";

afterEach(cleanup);

function Harness({ initial = "tekst" }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLTextAreaElement | null>(null);
  return (
    <CommentComposerShell
      value={value}
      onValueChange={setValue}
      textareaRef={ref}
      maxLength={5000}
      actions={<button type="button">send</button>}
    >
      <textarea ref={ref} value={value} onChange={(e) => setValue(e.target.value)} />
    </CommentComposerShell>
  );
}

describe("applyMarkdown", () => {
  it("wraps the selection", () => {
    expect(applyMarkdown("abc", 0, 3, { kind: "wrap", before: "**", after: "**" }).value).toBe(
      "**abc**",
    );
  });

  it("prefixes each selected line", () => {
    expect(applyMarkdown("a\nb", 0, 3, { kind: "prefix", prefix: "- " }).value).toBe("- a\n- b");
  });

  it("numbers ordered lists", () => {
    expect(
      applyMarkdown("a\nb", 0, 3, { kind: "prefix", prefix: (i: number) => `${i + 1}. ` }).value,
    ).toBe("1. a\n2. b");
  });
});

describe("CommentComposerShell", () => {
  it("applies bold to the whole value and clears it", () => {
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    render(<Harness />);
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    textarea.setSelectionRange(0, 5);

    fireEvent.click(screen.getByRole("button", { name: /pogrubienie|bold/i }));
    expect(textarea.value).toBe("**tekst**");
    expect(screen.getByText("9/5000")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /wyczyść|clear/i }));
    expect(textarea.value).toBe("");
    vi.unstubAllGlobals();
  });
});
