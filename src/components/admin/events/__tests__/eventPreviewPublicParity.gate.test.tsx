// BRAMKA CI: podglad studia NIE MOZE ZNOWU ZOSTAC DRUGIM RENDEREREM STRONY.
//
// CO SIE PSULO. `EventPreviewCanvas` rysowal wlasny pasek nawigacji, wlasne
// kafle podstron i wlasna karte informacji, nie importujac ANI JEDNEGO
// komponentu z `components/events/public/`. W repozytorium staly wiec dwa
// niezalezne rysunki tej samej strony i nic nie pilnowalo, zeby mowily to samo:
// zmiana na stronie publicznej rozjezdzala podglad CICHO, a rozjazd bylo widac
// dopiero po publikacji - czyli w jedynym miejscu, w ktorym podglad mial pomoc.
//
// DLACZEGO BRAMKA NA ZRODLE, A NIE SAM TEST RENDERU. Rozjazd nie jest bledem
// w wyniku - oba rysunki dzialaja. Rozjazd jest bledem W STRUKTURZE: ktos
// dopisuje sekcje na stronie publicznej i nie dopisuje jej w podgladzie. Test
// patrzacy tylko na wynik przechodzi, bo podglad nadal cos rysuje. Dlatego
// bramka porownuje LISTE POWIERZCHNI: co importuje trasa publiczna kontra co
// importuje podglad, oraz jakie sekcje umie strona kontra jakie dostaje podglad.
//
// WYJATKI SA JAWNE I MAJA POWOD. Cztery powierzchnie strony publicznej wolaja
// baze albo tozsamosc wolajacego, wiec w szkicu niezapisanego wydarzenia nie
// maja z czego sie wyrenderowac. Kazda stoi nizej z nazwa i powodem - i bramka
// pilnuje TAKZE tego, zeby wyjatek nie przezyl powierzchni, ktorej dotyczyl
// (nieuzywany wpis czerwieni test tak samo jak brakujacy komponent).
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "pl", exists: () => true, changeLanguage: () => Promise.resolve() },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: null }),
}));

// Powierzchnie publiczne wciagaja przez `usePublicEvent` klienta bazy, ktory
// przy imporcie wymaga zmiennych srodowiska. Atrapa modulu zapytan odcina ten
// lancuch - w tym tescie nie leci ani jedno zapytanie, bo podglad rysuje szkic.
vi.mock("@/lib/events/publicEventApi", () => ({
  fetchEventAgenda: vi.fn(),
  fetchEventMenu: vi.fn(),
  fetchEventSections: vi.fn(),
  fetchEventSponsors: vi.fn(),
  fetchEventSponsorMaterials: vi.fn(),
  fetchMyBookmarks: vi.fn(),
  fetchSessionAccess: vi.fn(),
  submitSessionSignup: vi.fn(),
  toggleEventBookmark: vi.fn(),
}));

import { EVENT_SECTION_KEYS } from "@/lib/events/eventSections";
import {
  EventPreviewCanvas,
  PREVIEW_SECTION_KEYS,
} from "@/components/admin/events/studio/EventPreviewCanvas";
import {
  EMPTY_EVENT_PREVIEW,
  type EventPreviewModel,
} from "@/components/admin/events/studio/EventStudioPreviewContext";

const PUBLIC_ROUTE = "src/routes/events.$slug.tsx";
const PREVIEW_CANVAS = "src/components/admin/events/studio/EventPreviewCanvas.tsx";

/**
 * Powierzchnie publiczne, ktorych podglad SWIADOMIE nie montuje, z powodem.
 *
 * Powod nie jest ozdoba: to on rozstrzyga, czy nowy wpis wolno tu dodac.
 * „Nie zdazylem” nie jest powodem - jesli komponent przyjmuje zwykle propsy,
 * podglad ma go zamontowac.
 */
const COMPONENT_EXCEPTIONS: Record<string, string> = {
  EventMenuNav:
    "wola menu z bazy (useEventMenu); pozycje szkicu nie maja jeszcze sciezki, z ktorej sklada sie odnosnik",
  EventBookmarkButton: "akcja konta - useAuth i mutacja zakladki, a nie tresc strony",
  SectionLockCard: "zamki liczy baza dla wolajacego; redaktor widzi wlasne wydarzenie w calosci",
};

/**
 * Sekcje strony, ktorych podglad nie dostaje, z powodem. Klucze pochodza
 * z `EVENT_SECTION_KEYS`, wiec dodanie DZIEWIATEJ sekcji do dziedziny czerwieni
 * ten test, dopoki ktos nie rozstrzygnie, czy trafia ona do podgladu.
 */
const SECTION_EXCEPTIONS: Record<string, string> = {
  description: "trasa rysuje opis wlasnym blokiem `prose`, poza `EventPageSections`",
  registration: "trasa rysuje zapisy wlasna powierzchnia, poza `EventPageSections`",
  speakers: "wlasne zapytanie (get_public_speakers) i wlasny naglowek na trasie",
  agenda: "wlasne zapytanie po slugu; program nie jest czescia szkicu formularza",
  sponsors: "wlasne zapytanie po slugu; partnerzy nie sa czescia szkicu formularza",
  materials: "wlasne zapytanie po slugu; materialy nie sa czescia szkicu formularza",
};

/** Nazwy importowane z `components/events/public/` w danym pliku zrodlowym. */
function publicImports(path: string): Set<string> {
  const source = readFileSync(path, "utf8");
  const pattern = /import\s*\{([^}]*)\}\s*from\s*"(@\/components\/events\/public\/[^"]+)"/g;
  const names = new Set<string>();
  for (const match of source.matchAll(pattern)) {
    for (const raw of match[1].split(",")) {
      // `type X` i `X as Y` sprowadzamy do nazwy zrodlowej - bramka porownuje
      // powierzchnie, a nie sposob jej zaimportowania.
      const name = raw
        .trim()
        .replace(/^type\s+/, "")
        .split(/\s+as\s+/)[0]
        .trim();
      if (name !== "") names.add(name);
    }
  }
  return names;
}

describe("podglad studia kontra strona publiczna", () => {
  it("montuje komponenty publiczne, a nie ich kopie", () => {
    const preview = publicImports(PREVIEW_CANVAS);
    // Zero importow znaczy, ze podglad znowu rysuje strone od zera.
    expect([...preview].sort()).not.toEqual([]);
  });

  it("nie omija zadnej powierzchni strony publicznej bez jawnego wyjatku", () => {
    const route = publicImports(PUBLIC_ROUTE);
    const preview = publicImports(PREVIEW_CANVAS);
    expect(route.size).toBeGreaterThan(0);

    const missing = [...route].filter(
      (name) => !preview.has(name) && COMPONENT_EXCEPTIONS[name] === undefined,
    );
    expect(missing).toEqual([]);
  });

  it("nie trzyma wyjatku na powierzchnie, ktorej strona publiczna juz nie rysuje", () => {
    const route = publicImports(PUBLIC_ROUTE);
    const stale = Object.keys(COMPONENT_EXCEPTIONS).filter((name) => !route.has(name));
    expect(stale).toEqual([]);
  });

  it("dostaje kazda sekcje strony albo jawny powod, dlaczego nie", () => {
    const covered = new Set<string>(PREVIEW_SECTION_KEYS);
    const missing = EVENT_SECTION_KEYS.filter(
      (key) => !covered.has(key) && SECTION_EXCEPTIONS[key] === undefined,
    );
    expect(missing).toEqual([]);
  });

  it("nie trzyma wyjatku na sekcje, ktorej dziedzina juz nie ma", () => {
    const known = new Set<string>(EVENT_SECTION_KEYS);
    const covered = new Set<string>(PREVIEW_SECTION_KEYS);
    const stale = Object.keys(SECTION_EXCEPTIONS).filter(
      (key) => !known.has(key) || covered.has(key),
    );
    expect(stale).toEqual([]);
  });
});

/** Szkic wypelniony tak, zeby kazda montowana powierzchnia miala co narysowac. */
function filledModel(): EventPreviewModel {
  return {
    ...EMPTY_EVENT_PREVIEW,
    titlePl: "Kongres Strategii Europejskich",
    slug: "kongres-strategii",
    startsAt: "2026-09-15T08:00:00.000Z",
    timezone: "Europe/Warsaw",
    coverUrl: "https://cdn.example.test/cover.jpg",
    locationName: "Hotel Bristol",
    addressLine: "Krakowskie Przedmiescie 42/44, 00-325 Warszawa",
    descriptionPl: "Dwa dni rozmow o bezpieczenstwie gospodarczym.",
    hashtag: "kongresNES",
    languages: ["pl", "en"],
    supportEmail: "kontakt@example.test",
    branding: {
      ...EMPTY_EVENT_PREVIEW.branding,
      colors: { ...EMPTY_EVENT_PREVIEW.branding.colors, main_action: "#FA9346" },
    },
    pagesDisplayMode: "grid",
    menu: [{ key: "m1", label: "Prelegenci", icon: "users", color: "" }],
  };
}

describe("podglad studia rysuje szkic prawdziwymi komponentami", () => {
  it("oddaje branding tym samym mechanizmem, co strona publiczna", () => {
    const { container } = render(<EventPreviewCanvas model={filledModel()} device="desktop" />);
    const canvas = container.querySelector("[data-testid='event-preview-canvas']");
    // Zakres brandingu to atrybut ze wspolnego zrodla, nie literal w podgladzie.
    expect(canvas?.hasAttribute("data-event-branding")).toBe(true);
    const style = container.querySelector("style[data-event-branding-tokens]");
    expect(style?.textContent).toContain("--primary:#FA9346");
  });

  it("oddaje naglowek okladki i dojazd z powierzchni publicznych", () => {
    const { container } = render(<EventPreviewCanvas model={filledModel()} device="desktop" />);
    // `EventVideoHeader`: bez identyfikatora wideo rysuje okladke.
    expect(container.querySelector("img[src='https://cdn.example.test/cover.jpg']")).not.toBeNull();
    // `EventPageSections` -> `EventPracticalSection`: naglowek sekcji i adres.
    expect(screen.getByText("eventFront.sections.map.heading")).toBeInTheDocument();
    expect(screen.getByText("Krakowskie Przedmiescie 42/44, 00-325 Warszawa")).toBeInTheDocument();
    expect(screen.getByText("eventFront.sections.contact.heading")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "kontakt@example.test" })).toHaveAttribute(
      "href",
      "mailto:kontakt@example.test",
    );
  });

  it("nie rysuje sekcji, ktorej szkic nie wypelnil", () => {
    // Pustke odsiewa regula strony publicznej (`hasPracticalContent`), nie warunek
    // przepisany w podgladzie - dlatego pusty szkic nie zostawia samego naglowka.
    render(<EventPreviewCanvas model={EMPTY_EVENT_PREVIEW} device="mobile" />);
    expect(screen.queryByText("eventFront.sections.map.heading")).toBeNull();
    expect(screen.queryByText("eventFront.sections.contact.heading")).toBeNull();
    expect(screen.getByText("adminEvents.studio.preview.untitled")).toBeInTheDocument();
  });
});
