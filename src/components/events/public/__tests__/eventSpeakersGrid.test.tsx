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
//
// Siatka rysuje dziś `SpeakerProfileCard` (karta rozwijana kliknięciem w
// zdjęcie) - stąd dwa dodatkowe kontrakty: zdjęcie jest PRZEŁĄCZNIKIEM z nazwą
// niosącą nazwisko, a profil otwiera OSOBNY przycisk akcji, nie klik w zdjęcie.
// Ruch karty ma własne testy (`speakerProfileCard.test.tsx`); tutaj
// `prefers-reduced-motion` jest włączone, więc FLIP nie mierzy niczego.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PublicSpeakerRow } from "@/lib/builder/speakersQuery";
import type { SpeakerTrack } from "@/lib/events/speakerCard";

const h = vi.hoisted(() => ({
  rows: [] as unknown[],
  calls: [] as Array<{ input: unknown; lang: unknown }>,
  language: "pl",
  error: null as Error | null,
}));

// `t` to echo klucza z `@/test/i18nStub`: bez parametrów oddaje goły klucz
// (jak dotąd), z parametrami dokleja je w nawiasie - nazwa przełącznika
// zdjęcia MUSI nieść nazwisko, a goły klucz by tego nie pokazał.
vi.mock("react-i18next", async () => {
  const { translateKey } = await import("@/test/i18nStub");
  return {
    useTranslation: () => ({
      t: translateKey,
      i18n: {
        get language() {
          return h.language;
        },
        exists: () => true,
        changeLanguage: () => Promise.resolve(),
      },
    }),
    initReactI18next: { type: "3rdParty", init: () => {} },
  };
});

vi.mock("@/lib/builder/speakersQuery", () => ({
  speakersQueryOptions: (input: unknown, lang: unknown) => {
    h.calls.push({ input, lang });
    return {
      queryKey: ["speakers", JSON.stringify(input), lang],
      queryFn: () => {
        if (h.error !== null) throw h.error;
        return h.rows;
      },
    };
  },
}));

const { EventSpeakersGrid } =
  await import("@/components/events/public/organisms/EventSpeakersGrid");
const { publicEventErrorMessage } = await import("@/lib/events/publicEventErrors");

const AVATAR = "https://proj.supabase.co/storage/v1/object/public/avatars/anna.jpg";
const EXPAND = "eventFront.speakers.card.expand(lng=pl,name=Anna Kowalska)";
const COLLAPSE = "eventFront.speakers.card.collapse(lng=pl,name=Anna Kowalska)";
const PROFILE_ACTION =
  "eventFront.speakers.card.actionFor(label=eventFront.speakers.card.profileAction(lng=pl),lng=pl,name=Anna Kowalska)";

function track(over: Partial<SpeakerTrack> = {}): SpeakerTrack {
  return {
    id: "t1",
    key: "energia",
    namePl: "Energetyka",
    nameEn: "Energy",
    accentColor: "#aa3300",
    sessionsCount: 1,
    ...over,
  };
}

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
    h.language = "pl";
    h.error = null;
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

describe("EventSpeakersGrid - karta rozwijana kliknięciem w zdjęcie", () => {
  // Duży kadr jest rozgrzewany przez `new Image()` - atrapa nie pobiera
  // niczego z sieci. `matchMedia` odpowiada „ogranicz ruch", więc przełącznik
  // nie mierzy geometrii (happy-dom i tak zwraca zera) i nie woła `animate`.
  class FakeImage {
    decoding = "";
    src = "";
  }

  beforeEach(() => {
    h.rows = [];
    h.calls = [];
    h.language = "pl";
    h.error = null;
    vi.stubGlobal("Image", FakeImage);
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        matches: query.includes("prefers-reduced-motion"),
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("prelegent ZE zdjęciem dostaje przełącznik, którego nazwa niesie nazwisko", async () => {
    h.rows = [speaker({ avatar_url: AVATAR })];
    render(<EventSpeakersGrid eventId="e1" />, { wrapper });

    const toggle = await screen.findByRole("button", { name: EXPAND });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    // Bez onSelect nie ma przycisku profilu - przełącznik jest jedynym.
    expect(screen.getAllByRole("button")).toEqual([toggle]);
  });

  it("klik w zdjęcie rozwija i zwija kartę, NIE otwierając profilu", async () => {
    h.rows = [speaker({ avatar_url: AVATAR })];
    const onSelect = vi.fn();
    const { container } = render(<EventSpeakersGrid eventId="e1" onSelect={onSelect} />, {
      wrapper,
    });

    fireEvent.click(await screen.findByRole("button", { name: EXPAND }));
    const collapse = screen.getByRole("button", { name: COLLAPSE });
    expect(collapse.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector("article")?.getAttribute("data-state")).toBe("expanded");

    fireEvent.click(collapse);
    expect(screen.getByRole("button", { name: EXPAND }).getAttribute("aria-expanded")).toBe(
      "false",
    );
    // Klik w zdjęcie jest zarezerwowany dla powiększenia.
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("z onSelect przycisk profilu karty oddaje CAŁY wiersz", async () => {
    const row = speaker({ avatar_url: AVATAR });
    h.rows = [row];
    const onSelect = vi.fn();
    render(<EventSpeakersGrid eventId="e1" onSelect={onSelect} />, { wrapper });

    fireEvent.click(await screen.findByRole("button", { name: PROFILE_ACTION }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0]?.[0]).toEqual(row);
  });

  it("bez zdjęcia nie ma przełącznika, a przycisk profilu zostaje", async () => {
    h.rows = [speaker({ avatar_url: null })];
    const onSelect = vi.fn();
    render(<EventSpeakersGrid eventId="e1" onSelect={onSelect} />, { wrapper });

    const action = await screen.findByRole("button", { name: PROFILE_ACTION });
    expect(screen.queryByRole("button", { name: EXPAND })).toBeNull();
    expect(screen.getAllByRole("button")).toEqual([action]);
  });

  it("osoba bez konta i bez treści profilu nie dostaje martwego przycisku profilu", async () => {
    // Ta sama reguła, co w zapowiedzi (`speakerHasProfileToShow`): przycisk,
    // który otwiera powtórzenie karty, jest gorszy niż jego brak.
    h.rows = [speaker({ user_id: "", person_id: "p1", avatar_url: null })];
    render(<EventSpeakersGrid eventId="e1" onSelect={vi.fn()} />, { wrapper });
    await screen.findByText("Anna Kowalska");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("ścieżki prelegenta stoją na karcie z nazwą i etykietą dla czytnika", async () => {
    h.rows = [speaker({ tracks: [track()] })];
    const { container } = render(<EventSpeakersGrid eventId="e1" />, { wrapper });

    const name = await screen.findByText("Energetyka");
    expect(name.closest("[title]")?.getAttribute("title")).toBe("Energetyka");
    expect(container.textContent).toContain("eventFront.speakers.card.tracksLabel(lng=pl): ");
    // Ścieżki nie zagnieżdżają listy - jedna osoba, jedno `li`.
    expect(container.querySelectorAll("li")).toHaveLength(1);
  });

  it("interfejs po angielsku: pytanie, rola i ścieżka idą w tym samym języku", async () => {
    h.language = "en";
    h.rows = [speaker({ tracks: [track()] })];
    render(<EventSpeakersGrid eventId="e1" />, { wrapper });

    expect(await screen.findByText("Energy")).toBeTruthy();
    expect(screen.getByText("President")).toBeTruthy();
    expect(screen.queryByText("Energetyka")).toBeNull();
    expect(h.calls[0]?.lang).toBe("en");
  });

  it("w trakcie wczytywania stoi zajęta siatka zastępcza z etykietą", () => {
    render(<EventSpeakersGrid eventId="e1" enabled={false} />, { wrapper });
    const busy = screen.getByLabelText("eventFront.speakers.loading");
    expect(busy.getAttribute("aria-busy")).toBe("true");
    expect(screen.queryByRole("listitem")).toBeNull();
  });

  it("puste eventId nie pyta bazy i zostaje w stanie wczytywania", () => {
    render(<EventSpeakersGrid eventId="" />, { wrapper });
    expect(screen.getByLabelText("eventFront.speakers.loading")).toBeTruthy();
  });

  it("błąd zapytania daje zdanie z następnym krokiem, a nie surowy komunikat bazy", async () => {
    h.error = new Error("violates check constraint");
    const { container } = render(<EventSpeakersGrid eventId="e1" />, { wrapper });

    const expected = publicEventErrorMessage(h.error);
    expect(await screen.findByText(expected)).toBeTruthy();
    expect(container.textContent).not.toContain("violates check constraint");
    expect(container.querySelector("ul")).toBeNull();
  });
});
