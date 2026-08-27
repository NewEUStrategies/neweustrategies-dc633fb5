// Sekcje `map` i `contact` na stronie wydarzenia: KTO ROZSTRZYGA WIDOCZNOSC.
//
// CO TEN PLIK DOWODZI - I DLACZEGO POWSTAL DOPIERO TERAZ
//
// Do migracji 20260827130000 `event_sections` oddawal dla tych dwoch sekcji
// BOOLEAN, i to `false`: mapa liczyla tresc ze starego, wolnotekstowego
// `events.location` (ktorego panel Wydarzen nie pokazuje ani nie zapisuje),
// a kontakt z `events.host_user_id` (ktorego NIC w repozytorium nie ustawia).
// `false` z bazy UBIJA sekcje - `shouldRenderSection` mowi
// `isLocked || hasContent !== false` - wiec adres strukturalny, jezyki, hashtag
// i adres wsparcia byly dla uczestnika NIEOSIAGALNE, mimo ze renderer istnial
// i dzialal. Migracja zmienia oba `WHEN` na `NULL` („baza nie wie"), bo pustke
// tych dwoch sekcji liczy front z tych samych kolumn, z ktorych rysuje tresc -
// kontrakt zapisany w naglowku `lib/events/eventPractical.ts:20-23`.
//
// Skutkiem tej zmiany FRONT JEST TERAZ JEDYNYM MIEJSCEM, w ktorym rozstrzyga sie
// widocznosc tych dwoch sekcji. Regula sama (`hasPracticalContent`) ma tabele
// przypadkow w `lib/events/__tests__/eventPublicPresentation.test.ts` i tutaj
// jej NIE DUBLUJEMY. Nie mial natomiast testu CALY LANCUCH, a to w nim mieszkal
// blad: wiersz RPC -> `parseEventSections` -> `shouldRenderSection` -> filtr
// pustki w `EventPageSections` -> renderer. Ten plik idzie tym lancuchem bez
// ani jednego kroku przepisanego w tescie.
//
// WEJSCIE UDAJE WIERSZ `event_sections()`, a nie wymyslony ksztalt: klucze
// nazywaja sie `has_content`, `is_locked`, `lock_reason` tak jak w RPC, i ida
// przez PRODUKCYJNY parser. Dzieki temu zmiana kontraktu bazy lamie ten test,
// a nie ekran uczestnika.
//
// CZEGO TEN PLIK NIE SPRAWDZA
//   * NIE sprawdza slownika. `t` jest tu funkcja tozsamosciowa na kluczu, bo
//     przedmiotem dowodu jest OBECNOSC sekcji i jej TRESC Z DANYCH (linia
//     adresu, `mailto:`, hashtag), a nie brzmienie naglowka. Parytet kluczy
//     eventFront ma wlasna bramke.
//   * NIE sprawdza sekcji `agenda`, `sponsors` ani `materials` - kazda wola
//     baze i ma wlasny zakres; tutaj sa atrapami, zeby nie wciagac zapytan.
//   * NIE sprawdza zamkow (`SectionLockCard`) - zamek liczy baza, a jego
//     wspolzycie z trescia ma asercje w harnessie
//     (`96_section_content_sources.sql`, sekcja (d)).
import { describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "pl" },
  }),
}));

// Nakladka slownika rejestruje sie efektem ubocznym importu i ciagnie caly rdzen
// i18n. Ten test mierzy widocznosc, nie napisy, wiec `ensureI18n` jest atrapa -
// inaczej plik zalezalby od pliku, ktorego nie dotyczy.
vi.mock("@/lib/i18n-event-front", () => ({ ensureI18n: () => {} }));

// Trzy organizmy z wlasnymi zapytaniami i molekula zamka. Zadne z nich nie
// wchodzi w scenariusze tego pliku, ale wszystkie sa importowane przez
// `EventPageSections`, wiec bez atrap test wciagnalby klienta bazy.
vi.mock("@/components/events/public/organisms/EventAgendaSection", () => ({
  EventAgendaSection: () => null,
}));
vi.mock("@/components/events/public/organisms/EventSponsorsSection", () => ({
  EventSponsorsSection: () => null,
}));
vi.mock("@/components/events/public/organisms/EventMaterialsSection", () => ({
  EventMaterialsSection: () => null,
}));
vi.mock("@/components/events/public/molecules/SectionLockCard", () => ({
  SectionLockCard: () => null,
}));

import { EventPageSections } from "@/components/events/public/organisms/EventPageSections";
import { parseEventSections, type EventSectionRow } from "@/lib/events/eventSections";
import type { EventPracticalInfo } from "@/lib/events/eventPractical";

/** Informacja praktyczna BEZ ani jednego wypelnionego pola. */
const EMPTY_PRACTICAL: EventPracticalInfo = {
  streetAddress: null,
  postalCode: null,
  city: null,
  region: null,
  country: null,
  languages: [],
  socialHashtag: null,
  supportEmail: null,
};

/**
 * Wiersz `event_sections()` w kształcie z RPC.
 *
 * `has_content: null` jest DOMYSLNE, bo to jest kontrakt po migracji
 * 20260827130000. Testy, ktore chca zmierzyc STARE zachowanie, podaja `false`
 * WPROST - i wtedy widac, ze to wlasnie ta wartosc ubijala sekcje.
 *
 * DLACZEGO TU STOI RZUTOWANIE - i dlaczego jest prawda, a nie obejsciem.
 * Generator typow Supabase deklaruje KAZDA kolumne `RETURNS TABLE` jako
 * NIENULLOWALNA (`has_content: boolean`, `heading_pl: string` w
 * `integrations/supabase/types.ts`), mimo ze ta funkcja NAPRAWDE oddaje tam
 * NULL - dla `materials` od 20260823170000, a dla `map` i `contact` od
 * 20260827130000. Wygenerowany typ nie umie tego wyrazic, i to nie jest
 * spekulacja: produkcyjny parser broni sie przed tym WPROST
 * (`eventSections.ts:112`: `typeof row.has_content === "boolean" ? ... : null`).
 * Fikstura musi wiec podac to, co przychodzi po sieci, a nie to, co obiecuje
 * typ - inaczej testowalibysmy generator, nie zachowanie. Wzorzec (rzutowanie
 * na typ wiersza RPC) jest ten sam, co w `eventPublicSurface.test.ts:55`.
 */
function sectionRow(
  key: "map" | "contact",
  overrides: { has_content?: boolean | null } = {},
): EventSectionRow {
  // DWA KROKI, NIE JEDEN, i to nie jest ozdoba. Rzutowanie WPROST na
  // `EventSectionRow` odrzuca TypeScript (TS2352: „neither type sufficiently
  // overlaps"), bo `null` i `string` nie mają części wspólnej - a fikstura MUSI
  // podać `null`, bo to właśnie przychodzi po sieci. Wzorzec z
  // `eventPublicSurface.test.ts:55` rzutuje jednym krokiem tylko dlatego, że
  // tam wszystkie pola są niepuste. `as unknown as` byłoby drugą drogą i wchodzi
  // pod ratchet `check:unknown-casts`; przejście przez `Record<string, unknown>`
  // wyraża to samo - „to jest surowy wiersz z sieci" - i nie podnosi licznika.
  const wire: Record<string, unknown> = {
    section_key: key,
    sort_order: key === "map" ? 70 : 80,
    heading_pl: null,
    heading_en: null,
    visibility: "public",
    min_tier_rank: 0,
    is_locked: false,
    lock_reason: "none",
    has_content: null,
    ...overrides,
  };
  return wire as EventSectionRow;
}

/** Cala droga produkcyjna: wiersze RPC -> parser -> organizm scalajacy. */
function renderSections(rows: EventSectionRow[], practical: EventPracticalInfo) {
  return render(
    <EventPageSections
      slug="kongres-strategii"
      sections={parseEventSections(rows)}
      practical={practical}
    />,
  );
}

const MAP_HEADING = "eventFront.sections.map.heading";
const CONTACT_HEADING = "eventFront.sections.contact.heading";
const LANGUAGES_LABEL = "eventFront.practical.languagesLabel";

describe("sekcja `map` - adres strukturalny zamiast starego `location`", () => {
  it("POJAWIA SIE dla wydarzenia z adresem strukturalnym (has_content NULL z bazy)", () => {
    renderSections([sectionRow("map")], {
      ...EMPTY_PRACTICAL,
      streetAddress: "Krakowskie Przedmieście 42/44",
      postalCode: "00-325",
      city: "Warszawa",
      country: "PL",
    });

    expect(screen.getByText(MAP_HEADING)).toBeTruthy();
    // Tresc, nie tylko naglowek: samotny naglowek nad pustka jest dokladnie tym
    // stanem, ktorego `hasPracticalContent` ma nie dopuscic.
    expect(screen.getByText("Krakowskie Przedmieście 42/44, 00-325 Warszawa, PL")).toBeTruthy();
    cleanup();
  });

  it("NIE POJAWIA SIE, gdy nie ma ani jednej kolumny adresu", () => {
    renderSections([sectionRow("map")], EMPTY_PRACTICAL);

    // Pusta karta jest gorsza niz brak karty - i decyzja o tym musi zapasc
    // PRZED naglowkiem, bo naglowek rysuje `EventPageSections`, a nie renderer.
    expect(screen.queryByText(MAP_HEADING)).toBeNull();
    cleanup();
  });

  it("samo miasto wystarcza - adres nie ma pola obowiazkowego", () => {
    renderSections([sectionRow("map")], { ...EMPTY_PRACTICAL, city: "Warszawa" });

    expect(screen.getByText(MAP_HEADING)).toBeTruthy();
    expect(screen.getByText("Warszawa")).toBeTruthy();
    cleanup();
  });
});

describe("sekcja `contact` - jezyki, hashtag i adres wsparcia", () => {
  it("POJAWIA SIE przy samym adresie wsparcia i daje odnosnik mailto", () => {
    renderSections([sectionRow("contact")], {
      ...EMPTY_PRACTICAL,
      supportEmail: "kontakt@example.test",
    });

    expect(screen.getByText(CONTACT_HEADING)).toBeTruthy();
    const link = screen.getByRole("link", { name: "kontakt@example.test" });
    expect(link.getAttribute("href")).toBe("mailto:kontakt@example.test");
    cleanup();
  });

  it("POJAWIA SIE przy samych jezykach tresci", () => {
    renderSections([sectionRow("contact")], { ...EMPTY_PRACTICAL, languages: ["pl", "en"] });

    expect(screen.getByText(CONTACT_HEADING)).toBeTruthy();
    expect(screen.getByText(LANGUAGES_LABEL)).toBeTruthy();
    cleanup();
  });

  it("POJAWIA SIE przy samym hashtagu i gubi nadmiarowy krzyzyk", () => {
    renderSections([sectionRow("contact")], { ...EMPTY_PRACTICAL, socialHashtag: "#kongresNES" });

    expect(screen.getByText(CONTACT_HEADING)).toBeTruthy();
    // Nazwa dostepna tego odnosnika pochodzi z `aria-label`, a nie z tresci -
    // stad zapytanie po etykiecie, a nie po widocznym napisie. Dowod o krzyzyku
    // idzie z ADRESU i z tresci: wejscie mialo `#`, a wyjscie ma dokladnie
    // jeden - podwojny („##kongresNES") byl by tu widoczny natychmiast.
    const link = screen.getByRole("link", { name: "eventFront.practical.hashtagSearch" });
    expect(link.getAttribute("href")).toBe("https://x.com/search?q=%23kongresNES");
    expect(link.textContent).toBe("#kongresNES");
    cleanup();
  });

  it("NIE POJAWIA SIE bez zadnego z tych trzech pol", () => {
    renderSections([sectionRow("contact")], EMPTY_PRACTICAL);

    expect(screen.queryByText(CONTACT_HEADING)).toBeNull();
    cleanup();
  });

  it("adres wsparcia POZA WZORCEM nie tworzy sekcji", () => {
    // `mailto:` przyjmuje naglowki po `?`, wiec napis z bazy, ktory nie jest
    // adresem, nie ma prawa dostac odnosnika ANI zapalic sekcji.
    renderSections([sectionRow("contact")], {
      ...EMPTY_PRACTICAL,
      supportEmail: "kontakt@example.test?bcc=obcy@example.org",
    });

    expect(screen.queryByText(CONTACT_HEADING)).toBeNull();
    cleanup();
  });
});

describe("SPRZEZENIE Z BAZA: `has_content = false` nadal ubija sekcje", () => {
  // TO JEST TA ASERCJA, KTORA TLUMACZY, PO CO BYLA MIGRACJA 20260827130000.
  // Front ma tresc do narysowania, a mimo to sekcja nie wchodzi na strone -
  // bo `false` z RPC jest silniejsze niz cokolwiek, co front wie o kolumnach.
  // Dopoki `event_sections` oddawal tu boolean, ZADNA zmiana we froncie nie
  // mogla pokazac tych dwoch sekcji.
  it("mapa z pelnym adresem NIE wchodzi, gdy RPC oddaje false", () => {
    renderSections([sectionRow("map", { has_content: false })], {
      ...EMPTY_PRACTICAL,
      city: "Warszawa",
    });

    expect(screen.queryByText(MAP_HEADING)).toBeNull();
    cleanup();
  });

  it("kontakt z adresem wsparcia NIE wchodzi, gdy RPC oddaje false", () => {
    renderSections([sectionRow("contact", { has_content: false })], {
      ...EMPTY_PRACTICAL,
      supportEmail: "kontakt@example.test",
    });

    expect(screen.queryByText(CONTACT_HEADING)).toBeNull();
    cleanup();
  });

  it("a przy NULL obie wchodzą razem, w kolejnosci z bazy", () => {
    renderSections([sectionRow("contact"), sectionRow("map")], {
      ...EMPTY_PRACTICAL,
      city: "Warszawa",
      supportEmail: "kontakt@example.test",
    });

    const headings = screen.getAllByRole("heading").map((node) => node.textContent);
    // `sort_order` z RPC (map 70, contact 80) wygrywa z kolejnoscia w tablicy -
    // parser sortuje, bo kolejnosc jest czescia kontraktu widoku.
    expect(headings).toEqual([MAP_HEADING, CONTACT_HEADING]);
    cleanup();
  });
});
