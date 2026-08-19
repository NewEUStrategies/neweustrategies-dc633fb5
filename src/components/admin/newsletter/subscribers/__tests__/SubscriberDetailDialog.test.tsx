// Szczegóły subskrybenta - okno, w którym operator czyta DOWÓD ZGODY.
//
// To tu odpowiada się na pytanie „czy ta osoba zgodziła się na marketing
// i kiedy". Dane pochodzą z kolumn `jsonb` wpisywanych także przez integracje,
// więc okno musi rozróżniać „nie ma zgody" od „nie umiem odczytać ładunku" -
// puste pole w kolumnie zgody odpowiada po cichu „nie".
//
// Reguły odczytu (`readConsents`, `readMeta`, `formatTimestamp`) mają własny
// test obok; tutaj sprawdzamy, co operator FAKTYCZNIE widzi.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({ maybeSingle: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: h.maybeSingle }) }),
    }),
  },
}));

import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { SubscriberDetailDialog } from "@/components/admin/newsletter/subscribers/SubscriberDetailDialog";

function subscriber(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "s-1",
    email: "anna@example.test",
    display_name: "Anna Nowak",
    first_name: "Anna",
    last_name: "Nowak",
    language: "pl",
    status: "subscribed",
    source: "formularz",
    source_form_name: "Popup startowy",
    created_at: "2026-08-01T10:00:00.000Z",
    confirmed_at: "2026-08-01T10:05:00.000Z",
    unsubscribed_at: null,
    updated_at: "2026-08-02T09:00:00.000Z",
    meta: null,
    consents: null,
    user_agent: null,
    ...overrides,
  };
}

function plan(row: Record<string, unknown> | null): void {
  h.maybeSingle.mockResolvedValue({ data: row, error: null });
}

async function mount(row: Record<string, unknown> | null = subscriber(), id = "s-1") {
  plan(row);
  const utils = renderWithQueryClient(
    <SubscriberDetailDialog subscriberId={id} onOpenChange={() => {}} />,
  );
  if (row) await screen.findByText(String(row.email));
  return utils;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("otwieranie", () => {
  it("bez identyfikatora okno jest zamknięte i NIE pyta bazy", () => {
    plan(subscriber());
    renderWithQueryClient(<SubscriberDetailDialog subscriberId={null} onOpenChange={() => {}} />);

    expect(screen.queryByText("anna@example.test")).toBeNull();
    expect(h.maybeSingle).not.toHaveBeenCalled();
  });

  it("z identyfikatorem pyta bazę i pokazuje adres w tytule", async () => {
    await mount();

    expect(screen.getByText("anna@example.test")).toBeTruthy();
    expect(h.maybeSingle).toHaveBeenCalledTimes(1);
  });

  it("do rozstrzygnięcia zapytania pokazuje tytuł zastępczy, nie pustkę", () => {
    h.maybeSingle.mockReturnValue(new Promise(() => {}));
    renderWithQueryClient(<SubscriberDetailDialog subscriberId="s-1" onOpenChange={() => {}} />);

    expect(screen.getByText("Subskrybent")).toBeTruthy();
    expect(screen.queryByText("Podstawowe")).toBeNull();
  });
});

describe("dane podstawowe", () => {
  it("pokazuje status, język, źródło i formularz", async () => {
    await mount();

    expect(screen.getByText("subscribed")).toBeTruthy();
    expect(screen.getByText("pl")).toBeTruthy();
    expect(screen.getByText("formularz")).toBeTruthy();
    expect(screen.getByText("Popup startowy")).toBeTruthy();
  });

  it("brak źródła i formularza pokazuje kreski", async () => {
    await mount(subscriber({ source: null, source_form_name: null }));

    expect(screen.getAllByText("-").length).toBeGreaterThanOrEqual(2);
  });

  it("nazwa wyświetlana trafia do podtytułu", async () => {
    await mount();

    expect(screen.getByText("Anna Nowak")).toBeTruthy();
  });

  it("bez nazwy wyświetlanej podtytuł składa się z imienia i nazwiska", async () => {
    await mount(subscriber({ display_name: null }));

    expect(screen.getByText("Anna Nowak")).toBeTruthy();
  });
});

describe("timeline", () => {
  it("pokazuje daty utworzenia i potwierdzenia", async () => {
    await mount();

    expect(screen.getByText("Utworzono")).toBeTruthy();
    expect(screen.getByText("Potwierdzono")).toBeTruthy();
    // Sformatowane, nie surowe ISO.
    expect(screen.queryByText("2026-08-01T10:00:00.000Z")).toBeNull();
  });

  it("brak wypisania pokazuje kreskę, a nie „Invalid Date”", async () => {
    await mount();

    expect(screen.getByText("Wypisano")).toBeTruthy();
    expect(screen.queryByText(/Invalid Date/)).toBeNull();
  });
});

describe("zgody - dowód zgody marketingowej", () => {
  it("brak zgód mówi to WPROST, a nie pustą sekcją", async () => {
    await mount(subscriber({ consents: null }));

    expect(screen.getByText("Brak zapisanych zgod.")).toBeTruthy();
  });

  it("pusta tablica zgód też daje jasny komunikat", async () => {
    await mount(subscriber({ consents: [] }));

    expect(screen.getByText("Brak zapisanych zgod.")).toBeTruthy();
  });

  it("zgoda UDZIELONA jest oznaczona jako udzielona", async () => {
    await mount(
      subscriber({
        consents: [{ key: "marketing", text: "Zgoda marketingowa", given: true, lang: "pl" }],
      }),
    );

    expect(screen.getByText("marketing")).toBeTruthy();
    expect(screen.getByText("✓ udzielona")).toBeTruthy();
    expect(screen.queryByText("brak")).toBeNull();
  });

  it("zgoda NIEUDZIELONA jest oznaczona jako brak - nigdy pustym polem", async () => {
    await mount(subscriber({ consents: [{ key: "profilowanie", given: false }] }));

    expect(screen.getByText("brak")).toBeTruthy();
    expect(screen.queryByText("✓ udzielona")).toBeNull();
  });

  it("wartość „truthy”, ale nie `true`, NIE liczy się jako zgoda", async () => {
    await mount(subscriber({ consents: [{ key: "marketing", given: "yes" }] }));

    expect(screen.getByText("brak")).toBeTruthy();
    expect(screen.queryByText("✓ udzielona")).toBeNull();
  });

  it("zgoda bez klucza pokazuje kreskę zamiast pustego wiersza", async () => {
    await mount(subscriber({ consents: [{ given: true }] }));

    // Kreska jest też w polach „Wypisano" itd., więc liczymy ją w wierszu zgody.
    const keyCell = document.querySelector(".font-mono.uppercase");
    expect(keyCell?.textContent).toBe("-");
    expect(screen.getByText("✓ udzielona")).toBeTruthy();
  });

  it("wpis, który nie jest obiektem, jest POMIJANY", async () => {
    await mount(subscriber({ consents: ["śmieć", 42, { key: "prawdziwa", given: true }] }));

    expect(screen.getByText("prawdziwa")).toBeTruthy();
    expect(screen.queryByText("śmieć")).toBeNull();
  });

  it("treść zgody jest SANITYZOWANA przed wyświetleniem", async () => {
    await mount(
      subscriber({
        consents: [
          {
            key: "marketing",
            text: '<a href="https://example.test">regulamin</a><script>alert(1)</script>',
            given: true,
          },
        ],
      }),
    );

    expect(screen.getByText("regulamin")).toBeTruthy();
    expect(document.querySelector("script")).toBeNull();
  });

  it("znacznik czasu i język zgody są pokazane razem", async () => {
    await mount(
      subscriber({
        consents: [{ key: "marketing", given: true, at: "2026-08-01T10:00:00.000Z", lang: "en" }],
      }),
    );

    expect(screen.getByText(/EN/)).toBeTruthy();
    expect(screen.queryByText("Brak zapisanych zgod.")).toBeNull();
  });
});

describe("metadane", () => {
  it("brak metadanych mówi to wprost", async () => {
    await mount(subscriber({ meta: null }));

    expect(screen.getByText("Brak metadanych.")).toBeTruthy();
  });

  it("pary klucz-wartość są wypisane", async () => {
    await mount(subscriber({ meta: { company: "ACME", phone: "+48 111 222 333" } }));

    expect(screen.getByText("company")).toBeTruthy();
    expect(screen.getByText("ACME")).toBeTruthy();
    expect(screen.getByText("phone")).toBeTruthy();
  });

  it("metadane, które nie są obiektem, dają komunikat o braku", async () => {
    await mount(subscriber({ meta: "to nie obiekt" }));

    expect(screen.getByText("Brak metadanych.")).toBeTruthy();
  });
});

describe("klient (user agent)", () => {
  it("sekcja pojawia się TYLKO, gdy jest co pokazać", async () => {
    await mount(subscriber({ user_agent: null }));

    expect(screen.queryByText("Klient")).toBeNull();
  });

  it("zapisany user agent jest widoczny - to część śladu zgody", async () => {
    await mount(subscriber({ user_agent: "Mozilla/5.0 (test)" }));

    expect(screen.getByText("Klient")).toBeTruthy();
    expect(screen.getByText("Mozilla/5.0 (test)")).toBeTruthy();
  });
});

describe("brak rekordu", () => {
  it("nieistniejący subskrybent nie renderuje sekcji z danymi", async () => {
    plan(null);
    renderWithQueryClient(
      <SubscriberDetailDialog subscriberId="s-nieznany" onOpenChange={() => {}} />,
    );

    expect(await screen.findByText("Subskrybent")).toBeTruthy();
    expect(screen.queryByText("Podstawowe")).toBeNull();
  });
});
