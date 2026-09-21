import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useState } from "react";
import type { MentionSuggestion } from "@/lib/mentions/useMentionSuggestions";

// Sterowalny mock podpowiedzi - test skupia się na logice typeahead/wstawiania,
// nie na wywołaniu RPC (to pokrywa useMentionSuggestions.test).
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

import { MentionTextarea } from "@/components/mentions/MentionTextarea";

function Harness() {
  const [value, setValue] = useState("");
  return <MentionTextarea label="Comment" value={value} onChange={setValue} lang="pl" />;
}

const PEOPLE: MentionSuggestion[] = [
  {
    kind: "person",
    slug: "jan-kowalski",
    name: "Jan Kowalski",
    avatarUrl: null,
    logoUrl: null,
    website: null,
    subtitle: "Analityk",
    verified: false,
  },
  {
    kind: "person",
    slug: "anna-nowak",
    name: "Anna Nowak",
    avatarUrl: null,
    logoUrl: null,
    website: null,
    subtitle: null,
    verified: false,
  },
];

const COMPANIES: MentionSuggestion[] = [
  {
    kind: "organization",
    slug: "org-123e4567-e89b-12d3-a456-426614174000",
    name: "ACME Europe",
    avatarUrl: null,
    logoUrl: null,
    website: "https://acme.example",
    subtitle: "Energy",
    verified: false,
  },
];

beforeEach(() => {
  suggestionsRef.current = PEOPLE;
  suggestionsRef.fetching = false;
});

// Wpisanie tekstu w przeglądarce przesuwa kursor na koniec; test DOM może nie -
// ustawiamy selectionStart jawnie, by wykrywanie aktywnej wzmianki było deterministyczne.
function type(box: HTMLElement, value: string) {
  fireEvent.change(box, {
    target: { value, selectionStart: value.length, selectionEnd: value.length },
  });
}

describe("MentionTextarea", () => {
  it("opens a listbox with suggestions once an @ token is typed", async () => {
    render(<Harness />);
    const box = screen.getByRole("combobox");
    type(box, "hi @jan");
    await waitFor(() => expect(screen.getByRole("listbox")).toBeTruthy());
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      expect.stringContaining("Jan Kowalski"),
      expect.stringContaining("Anna Nowak"),
    ]);
    expect(box.getAttribute("aria-expanded")).toBe("true");
  });

  it("inserts '@slug ' on click, replacing the typed token", async () => {
    render(<Harness />);
    const box = screen.getByRole("combobox") as HTMLTextAreaElement;
    type(box, "hi @jan");
    await waitFor(() => screen.getByRole("listbox"));
    fireEvent.mouseDown(screen.getByText("Jan Kowalski"));
    await waitFor(() => expect(box.value).toBe("hi @jan-kowalski "));
  });

  it("inserts organization mention slugs from CRM suggestions", async () => {
    suggestionsRef.current = COMPANIES;
    render(<Harness />);
    const box = screen.getByRole("combobox") as HTMLTextAreaElement;
    type(box, "cc @acme");
    await waitFor(() => screen.getByRole("listbox"));
    fireEvent.mouseDown(screen.getByText("ACME Europe"));
    await waitFor(() =>
      expect(box.value).toBe("cc @org-123e4567-e89b-12d3-a456-426614174000 "),
    );
  });

  it("navigates with ArrowDown and selects with Enter", async () => {
    render(<Harness />);
    const box = screen.getByRole("combobox") as HTMLTextAreaElement;
    type(box, "@a");
    await waitFor(() => screen.getByRole("listbox"));
    // Domyślnie podświetlona jest pierwsza opcja; ArrowDown -> druga.
    fireEvent.keyDown(box, { key: "ArrowDown" });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(box.value).toBe("@anna-nowak "));
  });

  it("closes the list on Escape until the text changes again", async () => {
    render(<Harness />);
    const box = screen.getByRole("combobox");
    type(box, "@jan");
    await waitFor(() => screen.getByRole("listbox"));
    fireEvent.keyDown(box, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
    // Kolejna zmiana treści znów otwiera listę.
    type(box, "@jann");
    await waitFor(() => expect(screen.getByRole("listbox")).toBeTruthy());
  });

  it("does not open a listbox for an email address (no active mention)", async () => {
    render(<Harness />);
    const box = screen.getByRole("combobox");
    type(box, "mail me at user@example");
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(box.getAttribute("aria-expanded")).toBe("false");
  });
});
