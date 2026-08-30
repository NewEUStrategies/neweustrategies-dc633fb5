// Sekcja `materials` na stronie wydarzenia: PUSTA MA ZNIKNAC RAZEM Z NAGLOWKIEM.
//
// CO TEN PLIK DOWODZI - I DLACZEGO POWSTAL
//
// Do migracji 20260829221500 `event_sections` oddawal dla materialow
// `has_content = NULL` („baza nie wie") z uzasadnieniem „zrodla w bazie nie ma".
// Zdanie bylo nieprawdziwe - `public.event_sponsor_materials` istnieje od
// 20260823160000 - a skutkiem NULL-a bylo to, przed czym doktryna tego modulu
// ostrzega wprost przy mapie i kontakcie: SAMOTNY NAGLOWEK nad zdaniem
// o pustce. NULL przechodzi przez `shouldRenderSection`
// (`isLocked || hasContent !== false`), a front - inaczej niz dla `map`
// i `contact` - NIE MA dla tej sekcji zadnego licznika pustki: `EventPageSections`
// odsiewa przed naglowkiem WYLACZNIE sekcje praktyczne, bo tylko one maja tresc
// w propsach. Materialy siedza za osobnym zapytaniem, ktore rusza dopiero
// WEWNATRZ `EventMaterialsSection`, czyli juz pod narysowanym naglowkiem.
//
// Naprawa mieszka w SQL-u, ale jej skutek widzi wylacznie uzytkownik strony -
// i to jego mierzy ten plik. Rachunek po stronie bazy (trzy progi dwustopniowej
// publikacji, zgodnosc z `event_sponsor_materials_public`) ma swoje asercje
// w `scripts/events-harness/runtime_test.d/96_section_content_sources.sql`
// i NIE JEST tu dublowany.
//
// WEJSCIE UDAJE WIERSZ `event_sections()`, a nie wymyslony ksztalt: klucze
// nazywaja sie `has_content`, `is_locked`, `lock_reason` tak jak w RPC i ida
// przez PRODUKCYJNY parser. Dzieki temu zmiana kontraktu bazy lamie ten test,
// a nie ekran uczestnika. Wzorzec pliku (atrapy, ksztalt fikstury, rzutowanie
// przez `Record<string, unknown>`) jest przepisany z
// `eventPracticalSections.test.tsx` - tam mierzy `map` i `contact`, tutaj
// `materials`.
//
// CZEGO TEN PLIK NIE SPRAWDZA
//   * NIE sprawdza slownika - `t` jest funkcja tozsamosciowa na kluczu, bo
//     przedmiotem dowodu jest OBECNOSC naglowka, a nie jego brzmienie;
//   * NIE sprawdza listy materialow ani jej stanow (wczytywanie / blad /
//     pustka) - `EventMaterialsSection` jest tu atrapa, bo inaczej test
//     wciagnalby klienta bazy. Zdanie o pustce w tamtym komponencie zostaje
//     jako DRUGA LINIA OBRONY (sekcja i lista jada dwoma zapytaniami, wiec moga
//     sie rozjechac w czasie) i jego zakres jest osobny;
//   * NIE sprawdza rachunku `has_content` - to zakres harnessu, patrz wyzej.
import { describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "pl" },
  }),
}));

vi.mock("@/lib/i18n-event-front", () => ({ ensureI18n: () => {} }));

// Trzy organizmy z wlasnymi zapytaniami. Zaden nie wchodzi w scenariusze tego
// pliku, ale wszystkie sa importowane przez `EventPageSections`.
vi.mock("@/components/events/public/organisms/EventAgendaSection", () => ({
  EventAgendaSection: () => null,
}));
vi.mock("@/components/events/public/organisms/EventSponsorsSection", () => ({
  EventSponsorsSection: () => null,
}));
vi.mock("@/components/events/public/organisms/EventMaterialsSection", () => ({
  EventMaterialsSection: () => <div data-testid="materials-list" />,
}));
vi.mock("@/components/events/public/molecules/SectionLockCard", () => ({
  SectionLockCard: () => <div data-testid="lock-card" />,
}));

import { EventPageSections } from "@/components/events/public/organisms/EventPageSections";
import { parseEventSections, type EventSectionRow } from "@/lib/events/eventSections";

const MATERIALS_HEADING = "eventFront.sections.materials.heading";

/**
 * Wiersz `event_sections()` dla sekcji materialow.
 *
 * `has_content` jest tu WYMAGANE, bez wartosci domyslnej, i to jest cala
 * pointa: po 20260829221500 baza dla tej sekcji ZAWSZE zna odpowiedz, wiec
 * fikstura, ktora moglaby o niej zapomniec, opisywalaby stan nieosiagalny.
 *
 * Rzutowanie przez `Record<string, unknown>` jest tym samym wzorcem, co
 * w `eventPracticalSections.test.tsx`: generator typow Supabase deklaruje
 * `heading_pl` jako nienullowalne, mimo ze RPC oddaje tam NULL, a `as unknown as`
 * wchodzi pod ratchet `check:unknown-casts`.
 */
function materialsRow(hasContent: boolean, locked = false): EventSectionRow {
  const wire: Record<string, unknown> = {
    section_key: "materials",
    sort_order: 60,
    heading_pl: null,
    heading_en: null,
    visibility: locked ? "registered" : "public",
    min_tier_rank: 0,
    is_locked: locked,
    lock_reason: locked ? "registration_required" : "none",
    has_content: hasContent,
  };
  return wire as EventSectionRow;
}

/** Cala droga produkcyjna: wiersze RPC -> parser -> organizm scalajacy. */
function renderSections(rows: EventSectionRow[]) {
  return render(<EventPageSections slug="kongres-strategii" sections={parseEventSections(rows)} />);
}

describe("sekcja `materials` - pustka odpada RAZEM z naglowkiem", () => {
  it("NIE POJAWIA SIE, gdy partnerzy nie opublikowali ani jednego materialu", () => {
    renderSections([materialsRow(false)]);

    // Naglowek rysuje `EventPageSections`, a nie renderer listy - wiec gdyby
    // decyzja o pustce zapadala w komponencie, zostalby tu samotny „Materialy".
    expect(screen.queryByText(MATERIALS_HEADING)).toBeNull();
    expect(screen.queryByTestId("materials-list")).toBeNull();
    cleanup();
  });

  it("POJAWIA SIE z naglowkiem i lista, gdy material jest opublikowany", () => {
    renderSections([materialsRow(true)]);

    expect(screen.getByText(MATERIALS_HEADING)).toBeTruthy();
    expect(screen.getByTestId("materials-list")).toBeTruthy();
    cleanup();
  });

  it("ZAMEK WYGRYWA Z PUSTKA: gosc bez zapisu dostaje zaproszenie, nie nicosc", () => {
    renderSections([materialsRow(false, true)]);

    // Karta zaproszenia JEST trescia sekcji zamknietej - inaczej uczestnik nie
    // dowiedzialby sie nawet, ze materialy sa korzyscia z zapisu. Ta asercja
    // pilnuje, ze ukrywanie pustki nie zabralo mu tej informacji.
    expect(screen.getByText(MATERIALS_HEADING)).toBeTruthy();
    expect(screen.getByTestId("lock-card")).toBeTruthy();
    expect(screen.queryByTestId("materials-list")).toBeNull();
    cleanup();
  });

  it("pusta sekcja nie zabiera ze strony sasiadow", () => {
    const agenda: Record<string, unknown> = {
      section_key: "agenda",
      sort_order: 30,
      heading_pl: null,
      heading_en: null,
      visibility: "public",
      min_tier_rank: 0,
      is_locked: false,
      lock_reason: "none",
      has_content: true,
    };
    renderSections([materialsRow(false), agenda as EventSectionRow]);

    expect(screen.queryByText(MATERIALS_HEADING)).toBeNull();
    expect(screen.getByText("eventFront.sections.agenda.heading")).toBeTruthy();
    cleanup();
  });
});
