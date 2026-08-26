// Testy modelu nawigacji STUDIA WYDARZENIA.
//
// TU PILNUJEMY SPOJNOSCI TRZECH LIST, ktore musza opisywac ten sam zbior sekcji:
// `EVENT_STUDIO_SECTIONS` (klucze), `EVENT_STUDIO_ROUTES` (adresy) i
// `EVENT_STUDIO_NAV` (to, co widzi redaktor). Rozjazd miedzy nimi nie wywala
// kompilacji - konczy sie pusta pozycja w sidebarze albo dwiema podswietlonymi
// naraz, czyli bledem, ktory widac dopiero na ekranie.
import { describe, expect, it } from "vitest";
import {
  EVENT_STUDIO_NAV,
  EVENT_STUDIO_ROUTES,
  EVENT_STUDIO_SECTIONS,
  eventStudioSectionFromPath,
  matchesStudioQuery,
} from "@/lib/events/eventStudioNav";

const EVENT_ID = "11111111-1111-1111-1111-111111111111";

describe("rozpoznanie sekcji studia po adresie", () => {
  it("czyta OSTATNI segment adresu, a nie prefiks", () => {
    expect(eventStudioSectionFromPath(`/admin/events/${EVENT_ID}/general`)).toBe("general");
    expect(eventStudioSectionFromPath(`/admin/events/${EVENT_ID}/pages`)).toBe("pages");
    expect(eventStudioSectionFromPath(`/admin/events/${EVENT_ID}/communications`)).toBe(
      "communications",
    );
  });

  it("nie podswietla sekcji `pages` na adresie zaczynajacym sie tak samo", () => {
    // Regula z komentarza modulu: dopasowanie po `startsWith` zapalaloby
    // `pages` takze na `.../pages-and-menu`, czyli dwie pozycje sidebara naraz.
    expect(eventStudioSectionFromPath(`/admin/events/${EVENT_ID}/pages-and-menu`)).toBeNull();
    expect(eventStudioSectionFromPath(`/admin/events/${EVENT_ID}/general-settings`)).toBeNull();
  });

  it("znosi konczacy ukosnik", () => {
    expect(eventStudioSectionFromPath(`/admin/events/${EVENT_ID}/branding/`)).toBe("branding");
    expect(eventStudioSectionFromPath(`/admin/events/${EVENT_ID}/overview/`)).toBe("overview");
  });

  it("zwraca null dla segmentu spoza zamknietej listy sekcji", () => {
    expect(eventStudioSectionFromPath(`/admin/events/${EVENT_ID}/settings`)).toBeNull();
    expect(eventStudioSectionFromPath(`/admin/events/${EVENT_ID}/tickets`)).toBeNull();
  });

  it("zwraca null dla adresu spoza studia", () => {
    expect(eventStudioSectionFromPath("/admin/events/list")).toBeNull();
    expect(eventStudioSectionFromPath("/admin/events")).toBeNull();
    expect(eventStudioSectionFromPath("/admin/pages/general")).toBeNull();
    expect(eventStudioSectionFromPath("/general")).toBeNull();
    expect(eventStudioSectionFromPath("")).toBeNull();
  });

  it("zwraca null, gdy po sekcji stoi jeszcze jeden segment", () => {
    expect(eventStudioSectionFromPath(`/admin/events/${EVENT_ID}/pages/edit`)).toBeNull();
  });
});

describe("tablica adresow sekcji studia", () => {
  it("ma wpis dla KAZDEJ sekcji i nie ma wpisow nadmiarowych", () => {
    expect(Object.keys(EVENT_STUDIO_ROUTES).sort()).toEqual([...EVENT_STUDIO_SECTIONS].sort());
  });

  it("kazdy adres stoi w przestrzeni jednego wydarzenia i konczy sie nazwa swojej sekcji", () => {
    for (const section of EVENT_STUDIO_SECTIONS) {
      const route = EVENT_STUDIO_ROUTES[section];
      expect(route.startsWith("/admin/events/$eventId/")).toBe(true);
      expect(route.endsWith(`/${section}`)).toBe(true);
    }
  });

  it("adres po podstawieniu identyfikatora wraca do tej samej sekcji", () => {
    // Domkniecie petli: tablica adresow i rozpoznanie adresu nie moga sie
    // rozjechac, bo wtedy sidebar prowadzi tam, gdzie nic sie nie podswietla.
    for (const section of EVENT_STUDIO_SECTIONS) {
      const pathname = EVENT_STUDIO_ROUTES[section].replace("$eventId", EVENT_ID);
      expect(eventStudioSectionFromPath(pathname)).toBe(section);
    }
  });
});

describe("drzewo nawigacji studia", () => {
  const entries = EVENT_STUDIO_NAV.flatMap((group) => group.entries);

  it("kazda pozycja wskazuje sekcje istniejaca na liscie sekcji", () => {
    for (const entry of entries) {
      expect(EVENT_STUDIO_SECTIONS).toContain(entry.key);
    }
  });

  it("kazda sekcja stoi w nawigacji DOKLADNIE RAZ", () => {
    // Sekcja powtorzona w dwoch grupach dalaby dwie podswietlone pozycje dla
    // jednego adresu; sekcja pominieta bylaby ekranem bez wejscia z sidebara.
    const keys = entries.map((entry) => entry.key);
    expect(keys.length).toBe(EVENT_STUDIO_SECTIONS.length);
    expect([...new Set(keys)].sort()).toEqual([...EVENT_STUDIO_SECTIONS].sort());
  });

  it("kazda pozycja niesie klucz i18n i nazwe ikony, a nie gotowy napis", () => {
    for (const entry of entries) {
      expect(entry.labelKey.startsWith("adminEvents.studio.")).toBe(true);
      expect(entry.icon.trim()).not.toBe("");
    }
  });

  it("klucze grup sa unikalne", () => {
    const groupKeys = EVENT_STUDIO_NAV.map((group) => group.key);
    expect([...new Set(groupKeys)]).toHaveLength(groupKeys.length);
  });
});

describe("filtr wyszukiwarki studia", () => {
  it("puste zapytanie przepuszcza wszystko", () => {
    expect(matchesStudioQuery("", "Rejestracja", ["bilety"])).toBe(true);
    expect(matchesStudioQuery("   ", "Rejestracja")).toBe(true);
    expect(matchesStudioQuery("", "")).toBe(true);
  });

  it("znajduje sekcje po slowie kluczowym, nie tylko po etykiecie", () => {
    // Sens `keywordKeys`: „bilety" maja prowadzic do zapisow, choc na ekranie
    // nie ma slowa „bilety".
    expect(matchesStudioQuery("bilety", "Rejestracja", ["bilety", "zapisy"])).toBe(true);
    expect(matchesStudioQuery("bilety", "Rejestracja", [])).toBe(false);
  });

  it("nie rozroznia wielkosci liter po zadnej stronie", () => {
    expect(matchesStudioQuery("REJESTR", "Rejestracja")).toBe(true);
    expect(matchesStudioQuery("qr", "Odprawa", ["Kody QR"])).toBe(true);
    expect(matchesStudioQuery("Kody Qr", "Odprawa", ["kody qr"])).toBe(true);
  });

  it("dopasowuje fragment w srodku wyrazu", () => {
    expect(matchesStudioQuery("jestr", "Rejestracja")).toBe(true);
    expect(matchesStudioQuery("ndin", "Branding")).toBe(true);
  });

  it("obcina biale znaki zapytania przed porownaniem", () => {
    expect(matchesStudioQuery("  branding  ", "Branding")).toBe(true);
  });

  it("odrzuca zapytanie, ktorego nie ma ani w etykiecie, ani w slowach", () => {
    expect(matchesStudioQuery("faktura", "Rejestracja", ["bilety", "zapisy"])).toBe(false);
  });
});
