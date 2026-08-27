// BIEŻĄCA ZAKŁADKA MA KOLOR BIEŻĄCEJ - MIERZONE NA PRAWDZIWYM SKŁADANIU KLAS.
//
// PO CO TEN PLIK ISTNIEJE - i to jest w nim najważniejsze zdanie.
//
// Kolor zakładek miał już test (`eventBrandingSurfaces.test.tsx`), ale ten test
// mierzył coś, czego produkcja nie robiła. Jego atrapa paska owijała klasy
// w `cn`, a `cn` to `tailwind-merge`: przy dwóch klasach koloru napisu
// deduplikuje kolizję i zostawia OSTATNIĄ, czyli aktywną. Produkcja składała
// klasy INACZEJ - `EventTabsNav` podaje je routerowi (`className` +
// `activeProps.className`), a TanStack Router SKLEJA je ZWYKŁĄ SPACJĄ, bez
// `cn` i bez `tailwind-merge`. Bieżący odnośnik miał więc na sobie OBIE klasy
// koloru; przy równej specyficzności rozstrzygała KOLEJNOŚĆ W ARKUSZU, a ta
// stawia wyciszoną PÓŹNIEJ (pomiar na zbudowanym arkuszu Tailwinda: linia 7564
// to klasa aktywna, 7567 - wyciszona). Bieżąca zakładka dostawała odcień
// wyciszony, a bramka świeciła na zielono. Bramka zielona przy zepsutej rzeczy
// jest GORSZA niż brak bramki, bo produkuje fałszywą pewność.
//
// ── DLACZEGO W TYM PLIKU NIE WOLNO UŻYĆ `cn` ────────────────────────────────
// NIE „nie trzeba”, a NIE WOLNO. `cn` naprawiałby kolizję W TEŚCIE - tak jak
// naprawiał ją w poprzedniej wersji bramki - i test przestałby widzieć defekt,
// który jest jego jedynym przedmiotem. Dlatego ten plik:
//   * RENDERUJE PRAWDZIWY `EventTabsNav` w PRAWDZIWYM routerze (pamięciowa
//     historia, trasy o tych samych ścieżkach co `src/routes/events.$slug*`),
//     więc klasy składa dokładnie ten sam kod, co na produkcji;
//   * ani razu nie importuje `cn`.
// Jeśli ktoś kiedyś „posprząta” ten plik, dopisując `cn` albo podmieniając
// router na atrapę - wraca dokładnie stan wyjściowy: zielony test nad zepsutym
// paskiem.
//
// ── CO JEST MIERZONE, W DWÓCH NIEZALEŻNYCH WARSTWACH ────────────────────────
//   1. STRUKTURA LISTY KLAS: na węźle stoi DOKŁADNIE JEDNA klasa koloru napisu
//      (`text-[color:red]` bez wariantu). Ta asercja jest ODPORNA NA KOLEJNOŚĆ
//      w arkuszu, bo nie pyta o wynik kaskady - pyta o to, żeby kaskada nie
//      miała czego rozstrzygać. Właśnie ta własność jest treścią poprawki:
//      kolejność emisji Tailwinda nie jest kontraktem i nie wolno na niej stać.
//   2. WARTOŚĆ OBLICZONA na węźle, przy arkuszu zastępczym emitowanym
//      w KOLEJNOŚCI PRODUKCYJNEJ (aktywna wcześniej, wyciszona później - czyli
//      przy równej specyficzności wygrywa wyciszona). To jest pomiar tego, co
//      zobaczy uczestnik, i on padał przed poprawką.
//
// Arkusz zastępczy jest ten sam co w `eventBrandingSurfaces.test.tsx`:
// w testach nie ma przejazdu Tailwinda, więc token klasy wiążemy z deklaracją
// selektorem `[class~="nazwa-klasy"]`, żeby nie escapować nawiasów. Wiązanie jest częścią
// dowodu: przechrzczenie klasy w kodzie produkcyjnym odkleja regułę od węzła
// i wartość obliczona spada do tokenu motywu.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";

import { EventTabsNav } from "@/components/events/public/organisms/EventTabsNav";
import type { EventMenuItem } from "@/lib/events/publicEventApi";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "pl", exists: () => true, changeLanguage: () => Promise.resolve() },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

// Menu wchodzi z atrapy hooka, a nie z bazy: przedmiotem dowodu jest SKŁADANIE
// KLAS, nie zapytanie. Prawdziwy `usePublicEvent` wciąga przy imporcie klienta
// Supabase, który wymaga zmiennych środowiska.
const MENU: EventMenuItem[] = [
  {
    id: "m-speakers",
    pageId: "p-speakers",
    labelPl: "Prelegenci",
    labelEn: "Speakers",
    icon: null,
    color: null,
    path: "wydarzenia/kongres/prelegenci",
    sortOrder: 0,
    module: "speakers",
  },
  {
    // Pozycja ZWYKŁA (bez modułu) idzie trasą splat `/$` - drugi z dwóch
    // odnośników, jakie umie zbudować `EventPageLink`. Bez niej dowód mówiłby
    // tylko o połowie paska.
    id: "m-onas",
    pageId: "p-onas",
    labelPl: "O nas",
    labelEn: "About",
    icon: null,
    color: null,
    path: "wydarzenia/kongres/o-nas",
    sortOrder: 1,
    module: null,
  },
];

vi.mock("@/lib/events/usePublicEvent", () => ({
  useEventMenu: () => ({ data: MENU }),
}));

/** Wartości motywu serwisu - odpowiednik bloku `:root, .light` z `styles.css`. */
const THEME_FOREGROUND = "#1a1a1a";
const THEME_MUTED_FOREGROUND = "#767676";
/** Kolory policzone przez generator dla paska z kolorem nawigacji. */
const NAV_FG = "#ffffff";
const NAV_FG_MUTED = "#94a3b8";

/**
 * Token klasy koloru napisu -> deklaracja, jaką wypuszcza dla niej Tailwind.
 *
 * KOLEJNOŚĆ TEJ TABLICY JEST CZĘŚCIĄ DOWODU i jest odwzorowaniem POMIARU na
 * zbudowanym arkuszu (`npx @tailwindcss/cli -i src/styles.css`): klasa aktywna
 * jest emitowana WCZEŚNIEJ (linia 7564), wyciszona PÓŹNIEJ (7567). Przy równej
 * specyficzności wygrywa więc WYCISZONA. Gdyby test emitował je w odwrotnej
 * kolejności, mierzyłby arkusz, którego nie ma.
 */
const TAILWIND_STUB: ReadonlyArray<readonly [string, string]> = [
  [
    "text-[color:var(--event-nav-fg,var(--foreground))]",
    "color:var(--event-nav-fg,var(--foreground))",
  ],
  [
    "text-[color:var(--event-nav-fg-muted,var(--muted-foreground))]",
    "color:var(--event-nav-fg-muted,var(--muted-foreground))",
  ],
];

/** Klasy koloru napisu BEZ wariantu - `hover:` ma własny token i własny stan. */
function textColorUtilities(node: Element): string[] {
  return Array.from(node.classList).filter((token) => token.startsWith("text-[color:"));
}

function mountStyleEnvironment(navColored: boolean): void {
  const tokens = document.createElement("style");
  const brand = navColored ? `--event-nav-fg:${NAV_FG};--event-nav-fg-muted:${NAV_FG_MUTED};` : "";
  tokens.textContent = `:root{--foreground:${THEME_FOREGROUND};--muted-foreground:${THEME_MUTED_FOREGROUND};${brand}}`;
  const utilities = document.createElement("style");
  utilities.textContent = TAILWIND_STUB.map(
    ([token, declaration]) => `[class~="${token}"]{${declaration}}`,
  ).join("");
  document.head.append(tokens, utilities);
}

/**
 * Montuje pasek w PRAWDZIWYM routerze pod podanym adresem.
 *
 * Drzewo tras odwzorowuje `src/routes/events.$slug.tsx` (powłoka) z dziećmi
 * `index` i `speakers` oraz trasę splat `/$`. Bez trasy splat `EventPageLink`
 * dla pozycji zwykłej nie ma dokąd wskazać, a bez `index` odnośnik „Strona
 * główna” (`activeOptions: { exact: true }`) nie miałby czego dopasować.
 */
async function mount(entry: string, navColored = true) {
  mountStyleEnvironment(navColored);
  const root = createRootRoute({ component: () => <Outlet /> });
  const splat = createRoute({ getParentRoute: () => root, path: "/$", component: () => null });
  const shell = createRoute({
    getParentRoute: () => root,
    path: "/events/$slug",
    component: () => (
      <>
        <EventTabsNav slug="kongres" />
        <Outlet />
      </>
    ),
  });
  const index = createRoute({ getParentRoute: () => shell, path: "/", component: () => null });
  const speakers = createRoute({
    getParentRoute: () => shell,
    path: "/speakers",
    component: () => null,
  });
  const router = createRouter({
    routeTree: root.addChildren([splat, shell.addChildren([index, speakers])]),
    history: createMemoryHistory({ initialEntries: [entry] }),
    defaultPendingMs: 0,
  });
  await router.load();
  const view = render(<RouterProvider router={router} />);
  await waitFor(() => {
    if (view.container.querySelector("nav a") === null) {
      throw new Error("pasek zakladek sie nie zamontowal");
    }
  });
  const links = Array.from(view.container.querySelectorAll<HTMLAnchorElement>("nav a"));
  const active = links.filter((a) => a.getAttribute("data-status") === "active");
  const idle = links.filter((a) => a.getAttribute("data-status") !== "active");
  return { ...view, links, active, idle };
}

afterEach(() => {
  cleanup();
  document.head.querySelectorAll("style").forEach((node) => node.remove());
});

describe("pasek zakladek wydarzenia: bierzaca pozycja ma kolor bierzacej", () => {
  it("na bierzacym odnosniku stoi DOKLADNIE JEDNA klasa koloru napisu", async () => {
    // TO JEST ASERCJA ODPORNA NA KOLEJNOSC W ARKUSZU. Nie pyta, ktora klasa
    // wygrywa - pyta, zeby nie bylo dwoch. Przed poprawka router sklejal
    // `EVENT_TAB_CLASS` (kolor wyciszony) z `activeProps` (kolor aktywny)
    // i na wezle stały dwie, a o wyniku decydowala kolejnosc emisji Tailwinda,
    // ktora nie jest kontraktem.
    const { active } = await mount("/events/kongres/speakers");
    expect(active).toHaveLength(1);
    expect(textColorUtilities(active[0])).toEqual([
      "text-[color:var(--event-nav-fg,var(--foreground))]",
    ]);
  });

  it("na pozostalych odnosnikach stoi DOKLADNIE JEDNA klasa, wyciszona", async () => {
    // Drugi bok tej samej reguly: klasa bazowa nie ma juz koloru, wiec pozycja
    // niebiezaca MUSI go dostac z `inactiveProps`. Bez tej asercji „poprawka”
    // przez samo usuniecie koloru z klasy bazowej tez byla by zielona - a pasek
    // rysowalby wszystkie pozycje kolorem DZIEDZICZONYM.
    const { idle } = await mount("/events/kongres/speakers");
    expect(idle.length).toBeGreaterThan(0);
    for (const link of idle) {
      expect(textColorUtilities(link)).toEqual([
        "text-[color:var(--event-nav-fg-muted,var(--muted-foreground))]",
      ]);
    }
  });

  it("bierzaca zakladka MALUJE SIE kolorem bierzacym, mimo kolejnosci w arkuszu", async () => {
    // Arkusz zastepczy emituje klase wyciszona PO aktywnej, czyli dokladnie tak,
    // jak robi to Tailwind - przy dwoch klasach na wezle wygrywala by wyciszona.
    // Ta asercja padala przed poprawka i jest pomiarem tego, co widzi uczestnik.
    const { active, idle } = await mount("/events/kongres/speakers");
    expect(getComputedStyle(active[0]).color).toBe(NAV_FG);
    expect(getComputedStyle(idle[0]).color).toBe(NAV_FG_MUTED);
  });

  it("odnosnik „Strona glowna” jest bierzacy TYLKO na stronie glownej", async () => {
    // `activeOptions: { exact: true }` - bez tego „Strona glowna” bylaby
    // bierzaca na kazdej zakladce, bo `/events/<slug>` jest przedrostkiem
    // wszystkich. Asercja pilnuje, ze rozdzielenie klas nie ruszylo TEGO
    // warunku: kolor bez poprawnej pozycji biezacej nic nie znaczy.
    const home = await mount("/events/kongres");
    expect(home.active).toHaveLength(1);
    expect(home.active[0].getAttribute("href")).toBe("/events/kongres");
    cleanup();
    document.head.querySelectorAll("style").forEach((node) => node.remove());

    const inner = await mount("/events/kongres/speakers");
    expect(inner.active).toHaveLength(1);
    expect(inner.active[0].getAttribute("href")).toBe("/events/kongres/speakers");
  });

  it("pasek BEZ koloru nawigacji bierze tokeny motywu - odwrot dziala dalej", async () => {
    // Kazda wartosc `var(--event-nav-*, red)` ma drugi argument. Rozdzielenie klas
    // nie moze tego zabrac: wydarzenie bez slotu koloru wyglada jak dzis.
    const { active, idle } = await mount("/events/kongres/speakers", false);
    expect(getComputedStyle(active[0]).color).toBe(THEME_FOREGROUND);
    expect(getComputedStyle(idle[0]).color).toBe(THEME_MUTED_FOREGROUND);
  });
});
