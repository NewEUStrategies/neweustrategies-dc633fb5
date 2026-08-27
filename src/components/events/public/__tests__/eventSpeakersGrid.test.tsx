// Siatka prelegentów: to, co po zepsuciu widzi każdy gość strony wydarzenia.
//
// SPRAWDZAMY KONTRAKT UKŁADU, NIE KLAS CSS. Wzorzec (Swapcard) daje karcie trzy
// linie pod zdjęciem i cztery kolumny - liczba kolumn to sprawa Tailwinda,
// natomiast REGUŁY, których złamanie widzi uczestnik, są cztery:
// 1. brak prelegentów = brak czegokolwiek (nagłówek rysuje sekcja wyżej),
// 2. brak roli albo firmy = linia NIE ISTNIEJE, a nie „pusty wiersz”,
// 3. ucięty napis zostawia pełną wartość w `title`, bo inaczej nazwa
//    organizacji przepada bezpowrotnie,
// 4. brak zdjęcia daje inicjały, nie ikonę zepsutego obrazka.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PublicSpeakerRow } from "@/lib/builder/speakersQuery";

const h = vi.hoisted(() => ({
  rows: [] as unknown[],
  calls: [] as Array<{ input: unknown; lang: unknown }>,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "pl", exists: () => true, changeLanguage: () => Promise.resolve() },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("@/lib/builder/speakersQuery", () => ({
  speakersQueryOptions: (input: unknown, lang: unknown) => {
    h.calls.push({ input, lang });
    return { queryKey: ["speakers", JSON.stringify(input), lang], queryFn: () => h.rows };
  },
}));

const { EventSpeakersGrid } =
  await import("@/components/events/public/organisms/EventSpeakersGrid");

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function speaker(overrides: Partial<PublicSpeakerRow> = {}): PublicSpeakerRow {
  return {
    user_id: "u1",
    slug: "anna-kowalska",
    display_name: "Anna Kowalska",
    avatar_url: null,
    job_title: "Dyrektor",
    company: "NASK",
    headline_pl: "Prezes",
    headline_en: "President",
    bio_pl: null,
    bio_en: null,
    topics_pl: [],
    topics_en: [],
    languages: [],
    talks_count: 0,
    rating: 0,
    reviews_count: 0,
    is_expert: false,
    has_speaker_profile: true,
    sort_order: 0,
    ...overrides,
  };
}

describe("EventSpeakersGrid", () => {
  beforeEach(() => {
    h.rows = [];
    h.calls = [];
  });

  it("pyta o prelegentów TEGO wydarzenia (jedno źródło z sekcją prelegentów)", async () => {
    h.rows = [speaker()];
    render(<EventSpeakersGrid eventId="e1" limit={12} />, { wrapper });
    await screen.findByText("Anna Kowalska");
    expect(h.calls[0]?.input).toEqual({ source: "event", eventId: "e1", limit: 12 });
  });

  it("pusta lista nie rysuje niczego - nawet ramki", async () => {
    const { container } = render(<EventSpeakersGrid eventId="e1" />, { wrapper });
    // `waitFor` z testing-library, a nie `vi.waitFor`: tylko ten pierwszy owija
    // sondowanie w `act`, więc rozwiązanie zapytania nie wypada poza turę React.
    await waitFor(() => expect(container.innerHTML).toBe(""));
  });

  it("zamknięta sekcja nie pyta bazy", () => {
    render(<EventSpeakersGrid eventId="e1" enabled={false} />, { wrapper });
    expect(screen.queryByText("Anna Kowalska")).toBeNull();
  });

  it("karta ma nazwisko, rolę i organizację, a pełna wartość zostaje w title", async () => {
    h.rows = [
      speaker({
        display_name: "Lech Kurkliński",
        headline_pl: "Profesor",
        company: "Szkoła Główna Handlowa w Warszawie",
      }),
    ];
    render(<EventSpeakersGrid eventId="e1" />, { wrapper });

    const org = await screen.findByText("Szkoła Główna Handlowa w Warszawie");
    expect(org.getAttribute("title")).toBe("Szkoła Główna Handlowa w Warszawie");
    expect(screen.getByText("Lech Kurkliński").getAttribute("title")).toBe("Lech Kurkliński");
    expect(screen.getByText("Profesor").getAttribute("title")).toBe("Profesor");
  });

  it("brak firmy i brak roli = brak linii, a nie pusty wiersz", async () => {
    h.rows = [speaker({ company: null, headline_pl: null, headline_en: null, job_title: null })];
    render(<EventSpeakersGrid eventId="e1" />, { wrapper });

    const item = await screen.findByRole("listitem");
    expect(item.textContent).toBe("AKAnna Kowalska");
  });

  it("brak roli w języku interfejsu spada na stanowisko z profilu", async () => {
    h.rows = [speaker({ headline_pl: null, headline_en: null, job_title: "Dyrektor" })];
    render(<EventSpeakersGrid eventId="e1" />, { wrapper });
    expect(await screen.findByText("Dyrektor")).toBeTruthy();
  });

  it("brak zdjęcia daje inicjały, nie obrazek", async () => {
    h.rows = [speaker({ avatar_url: null })];
    const { container } = render(<EventSpeakersGrid eventId="e1" />, { wrapper });
    await screen.findByText("Anna Kowalska");
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("AK")).toBeTruthy();
  });

  it("bez onSelect karta jest martwa, z onSelect jest przyciskiem oddającym wiersz", async () => {
    h.rows = [speaker()];
    const { unmount } = render(<EventSpeakersGrid eventId="e1" />, { wrapper });
    await screen.findByText("Anna Kowalska");
    expect(screen.queryByRole("button")).toBeNull();
    unmount();

    const onSelect = vi.fn();
    render(<EventSpeakersGrid eventId="e1" onSelect={onSelect} />, { wrapper });
    fireEvent.click(await screen.findByRole("button"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0]?.[0]).toMatchObject({ user_id: "u1" });
  });
});
