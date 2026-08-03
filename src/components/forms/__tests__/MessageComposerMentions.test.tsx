import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useState } from "react";
import type { MentionSuggestion } from "@/lib/mentions/useMentionSuggestions";

const { suggestionsRef } = vi.hoisted(() => ({
  suggestionsRef: { current: [] as MentionSuggestion[], fetching: false },
}));
vi.mock("@/lib/mentions/useMentionSuggestions", () => ({
  MENTION_SUGGESTION_LIMIT: 6,
  useMentionSuggestions: (query: string | null) => ({
    data: query === null ? [] : suggestionsRef.current,
    isFetching: suggestionsRef.fetching,
  }),
}));

import { MessageComposerField } from "@/components/forms/MessageComposerField";

const PEOPLE: MentionSuggestion[] = [
  { slug: "jan-kowalski", name: "Jan Kowalski", avatarUrl: null, subtitle: "Analityk" },
  { slug: "anna-nowak", name: "Anna Nowak", avatarUrl: null, subtitle: null },
];

beforeEach(() => {
  suggestionsRef.current = PEOPLE;
  suggestionsRef.fetching = false;
});

function type(box: HTMLElement, value: string) {
  fireEvent.change(box, {
    target: { value, selectionStart: value.length, selectionEnd: value.length },
  });
}

function Harness({ mentions = true }: { mentions?: boolean }) {
  const [value, setValue] = useState("");
  return (
    <MessageComposerField
      label="Wiadomość"
      value={value}
      onChange={setValue}
      maxLength={200}
      mentions={mentions}
    />
  );
}

describe("MessageComposerField - @wzmianki", () => {
  it("podpowiada osoby po wpisaniu tokenu @", async () => {
    render(<Harness />);
    const box = screen.getByRole("combobox");
    type(box, "cześć @jan");
    await waitFor(() => expect(screen.getByRole("listbox")).toBeTruthy());
    expect(screen.getAllByRole("option").length).toBe(2);
  });

  it("wstawia '@slug ' po wyborze podpowiedzi", async () => {
    render(<Harness />);
    const box = screen.getByRole("combobox") as HTMLTextAreaElement;
    type(box, "cześć @jan");
    await waitFor(() => expect(screen.getByRole("listbox")).toBeTruthy());
    fireEvent.mouseDown(screen.getAllByRole("option")[0]);
    await waitFor(() => expect(box.value).toBe("cześć @jan-kowalski "));
  });

  it("z wyłączonymi wzmiankami nie renderuje comboboxa ani listy", () => {
    render(<Harness mentions={false} />);
    expect(screen.queryByRole("combobox")).toBeNull();
    const box = screen.getByLabelText("Wiadomość");
    type(box, "cześć @jan");
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});

describe("MessageComposerField - walidacja", () => {
  it("zgłasza canSubmit dopiero dla niepustej treści", () => {
    const seen: boolean[] = [];
    function V() {
      const [value, setValue] = useState("   ");
      return (
        <MessageComposerField
          label="Wiadomość"
          value={value}
          onChange={setValue}
          maxLength={20}
          mentions={false}
          onValidationChange={(v) => seen.push(v.canSubmit)}
        />
      );
    }
    render(<V />);
    expect(seen.at(-1)).toBe(false);
    type(screen.getByLabelText("Wiadomość"), "treść");
    expect(seen.at(-1)).toBe(true);
  });

  it("blokuje wysyłkę i oznacza licznik przy treści ponad limit", () => {
    let last: boolean | null = null;
    render(
      <MessageComposerField
        label="Wiadomość"
        value={"a".repeat(11)}
        onChange={() => undefined}
        maxLength={10}
        mentions={false}
        onValidationChange={(v) => {
          last = v.canSubmit;
        }}
      />,
    );
    expect(last).toBe(false);
    expect(screen.getByText("11/10").className).toContain("text-destructive");
  });
});
