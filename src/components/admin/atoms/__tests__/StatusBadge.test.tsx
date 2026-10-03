// ODZNAKA STATUSU TREŚCI - jedna pigułka dla list wpisów, stron i mediów.
//
// Każdy status ma WŁASNĄ barwę i ikonę: redakcja przegląda listę wzrokiem,
// a dwa statusy w tym samym kolorze (np. szkic i zaplanowany) wyglądałyby
// jak jeden. Status nieznany (nowa wartość enuma) nie wywraca listy - dostaje
// neutralną pigułkę.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";

import { StatusBadge } from "../StatusBadge";

afterEach(cleanup);

const CASES = [
  ["published", "emerald", "lucide-check"],
  ["draft", "amber", "lucide-pencil"],
  ["pending_review", "sky", "lucide-send"],
  ["scheduled", "violet", "lucide-clock"],
  ["archived", "slate", "lucide-lock"],
  ["imported", "bg-muted", "lucide-circle"],
] as const;

describe("StatusBadge", () => {
  it.each(CASES)("%s: własna barwa i ikona", (status, tone, icon) => {
    const { container } = render(<StatusBadge status={status} label={`L-${status}`} />);
    const pill = container.firstElementChild as HTMLElement;
    expect(pill.className).toContain(tone);
    expect(pill.querySelector(`svg.${icon}`)).not.toBeNull();
    expect(pill.textContent).toBe(`L-${status}`);
    expect(pill.getAttribute("title")).toBe(`L-${status}`);
  });

  it("żadne dwa znane statusy nie dzielą barwy", () => {
    const tones = CASES.slice(0, 5).map(([, tone]) => tone);
    expect(new Set(tones).size).toBe(tones.length);
  });

  it("własny dymek wygrywa z etykietą, a klasa wołającego jest dołożona", () => {
    const { container } = render(
      <StatusBadge status="draft" label="Szkic" title="Szkic od 3 dni" className="ml-2" />,
    );
    const pill = container.firstElementChild as HTMLElement;
    expect(pill.getAttribute("title")).toBe("Szkic od 3 dni");
    expect(pill.className).toContain("ml-2");
  });
});
