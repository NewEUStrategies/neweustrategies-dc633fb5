import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useState } from "react";

vi.mock("@/lib/mentions/useMentionSuggestions", () => ({
  MENTION_SUGGESTION_LIMIT: 6,
  useMentionSuggestions: () => ({ data: [], isFetching: false }),
}));

import { MessageComposerField } from "@/components/forms/MessageComposerField";
import {
  formatShortcutHint,
  matchMarkdownShortcut,
  type ShortcutEventLike,
} from "@/lib/composer/shortcuts";

function ev(partial: Partial<ShortcutEventLike> & { key: string }): ShortcutEventLike {
  return { ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...partial };
}

describe("matchMarkdownShortcut", () => {
  it("rozpoznaje skróty z Cmd i z Ctrl", () => {
    expect(matchMarkdownShortcut(ev({ key: "b", metaKey: true }))).toBe("bold");
    expect(matchMarkdownShortcut(ev({ key: "B", ctrlKey: true }))).toBe("bold");
    expect(matchMarkdownShortcut(ev({ key: "i", ctrlKey: true }))).toBe("italic");
    expect(matchMarkdownShortcut(ev({ key: "e", ctrlKey: true }))).toBe("code");
    expect(matchMarkdownShortcut(ev({ key: "k", ctrlKey: true }))).toBe("link");
  });

  it("rozróżnia warianty z Shift", () => {
    expect(matchMarkdownShortcut(ev({ key: "8", ctrlKey: true, shiftKey: true }))).toBe(
      "bulletList",
    );
    expect(matchMarkdownShortcut(ev({ key: "7", ctrlKey: true, shiftKey: true }))).toBe(
      "numberedList",
    );
    expect(matchMarkdownShortcut(ev({ key: ".", ctrlKey: true, shiftKey: true }))).toBe("quote");
    expect(matchMarkdownShortcut(ev({ key: "8", ctrlKey: true }))).toBeNull();
  });

  it("ignoruje zwykłe pisanie, Alt oraz Cmd+Ctrl", () => {
    expect(matchMarkdownShortcut(ev({ key: "b" }))).toBeNull();
    expect(matchMarkdownShortcut(ev({ key: "b", ctrlKey: true, altKey: true }))).toBeNull();
    expect(matchMarkdownShortcut(ev({ key: "b", ctrlKey: true, metaKey: true }))).toBeNull();
  });

  it("formatuje podpowiedzi zależnie od platformy", () => {
    expect(formatShortcutHint("bold", true)).toBe("⌘B");
    expect(formatShortcutHint("bold", false)).toBe("Ctrl+B");
    expect(formatShortcutHint("bulletList", false)).toBe("Ctrl+Shift+8");
    expect(formatShortcutHint("quote", true)).toBe("⌘⇧.");
  });
});

function Harness({ initial = "" }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <MessageComposerField
      label="Wiadomość"
      value={value}
      onChange={setValue}
      maxLength={100}
      mentions={false}
    />
  );
}

function select(box: HTMLTextAreaElement, start: number, end: number) {
  box.setSelectionRange(start, end);
}

describe("MessageComposerField - skróty klawiszowe", () => {
  it("Ctrl+B otacza zaznaczenie znacznikami pogrubienia", () => {
    render(<Harness initial="ala ma kota" />);
    const box = screen.getByLabelText("Wiadomość") as HTMLTextAreaElement;
    select(box, 0, 3);
    fireEvent.keyDown(box, { key: "b", ctrlKey: true });
    expect(box.value).toBe("**ala** ma kota");
  });

  it("Ctrl+Shift+8 dodaje znacznik listy punktowanej", () => {
    render(<Harness initial="punkt" />);
    const box = screen.getByLabelText("Wiadomość") as HTMLTextAreaElement;
    select(box, 0, 5);
    fireEvent.keyDown(box, { key: "8", ctrlKey: true, shiftKey: true });
    expect(box.value).toBe("- punkt");
  });

  it("Ctrl+K wstawia szkielet odnośnika", () => {
    render(<Harness initial="link" />);
    const box = screen.getByLabelText("Wiadomość") as HTMLTextAreaElement;
    select(box, 0, 4);
    fireEvent.keyDown(box, { key: "k", ctrlKey: true });
    expect(box.value).toBe("[link](https://)");
  });

  it("zwykłe znaki nie uruchamiają formatowania", () => {
    render(<Harness initial="tekst" />);
    const box = screen.getByLabelText("Wiadomość") as HTMLTextAreaElement;
    select(box, 0, 5);
    fireEvent.keyDown(box, { key: "b" });
    expect(box.value).toBe("tekst");
  });

  it("pasek narzędzi pokazuje skrót w etykiecie dostępności", () => {
    render(<Harness />);
    expect(screen.getByRole("button", { name: /Ctrl\+B|⌘B/ })).toBeTruthy();
  });
});
