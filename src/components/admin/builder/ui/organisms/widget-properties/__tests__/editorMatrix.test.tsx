// TABELA po WSZYSTKICH edytorach treści widgetów.
//
// Edytory z tego katalogu rysują zakładkę „Treść” dla widgetów, które nie dają
// się opisać deklaratywnym schematem (listy, harmonogramy, karuzele, mapy).
// Każdy z nich dostaje ten sam kontrakt: `{ c, lang, setContent }` - i właśnie
// dlatego opłaca się przejechać je JEDNĄ tabelą, zamiast dopisywać
// dwadzieścia siedem plików z tym samym szkieletem.
//
// Tabela pilnuje czterech niezmienników, które psują się realnie:
//  1. EDYTOR RENDERUJE SIĘ NA PUSTEJ TREŚCI. Widget dodany na kanwę ma
//     `content: {}` - jeśli edytor tego nie znosi, panel właściwości pada
//     w chwili wstawienia widgetu (redaktor traci nawet możliwość jego
//     usunięcia bez odświeżenia strony).
//  2. EDYTOR RENDERUJE SIĘ NA TREŚCI USZKODZONEJ. Dokumenty przyszły
//     z importu WordPressa i ze starszych wydań panelu: listy bywają
//     stringami, liczby napisami, obiekty tablicami.
//  3. ŻADEN EDYTOR NIE WYCIEKA `undefined`, `NaN` ani `[object Object]`
//     do interfejsu - to najczęstszy objaw czytania nie tego klucza.
//  4. LISTY DODAJĄ POZYCJE. Każdy edytor listowy używa `ListShell`, więc
//     przycisk „+ dodaj” musi zapisać TABLICĘ pod właściwym kluczem.
//
// Testy zachowań specyficznych dla poszczególnych edytorów (kolejność
// przenoszenia, dwujęzyczne seedowanie, warunki widoczności pól) siedzą
// w osobnych plikach obok - ta tabela jest podłogą, nie sufitem.
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { ok, supabaseFromStub, type SupabaseFromStub } from "@/test/supabaseChain";
import type { Json, WidgetNode } from "@/lib/builder/types";
import * as editors from "..";
// Te trzy nie są re-eksportowane z beczki (są wpinane bezpośrednio przez
// edytory i panel), a mają własną logikę - importujemy je wprost.
import { DisplayLivePreview } from "../DisplayLivePreview";

const db: { current: SupabaseFromStub } = { current: supabaseFromStub() };

vi.mock("react-i18next", async () => {
  const { reactI18nextStub } = await import("@/test/i18nStub");
  return reactI18nextStub();
});
vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  const { radixSelectStub } = await import("@/test/reactStubs");
  return radixSelectStub(React);
});
vi.mock("@/components/ui/switch", async () => {
  const React = await import("react");
  const { radixSwitchStub } = await import("@/test/reactStubs");
  return radixSwitchStub(React);
});
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => db.current.from(table),
    storage: { from: () => ({ upload: async () => ({ data: null, error: null }) }) },
  },
}));
// Wysyłka plików i rejestracja mediów to serwerowe funkcje TanStack Start -
// poza runtime'em frameworka nie da się ich wywołać, a slot obrazka ma własny
// test. Tutaj interesuje nas wyłącznie to, że edytor się rysuje.
// Mock CZĘŚCIOWY: `@tanstack/react-start` jest importowany także przez warstwy
// pod spodem (`createIsomorphicFn`, `createServerFn`), więc podmieniamy tylko
// `useServerFn`, a resztę zostawiamy prawdziwą - inaczej kolekcja pliku pada na
// brakującym eksporcie.
vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const { serverFnStubModule } = await import("@/test/serverFnHarness");
  return { ...actual, ...serverFnStubModule(), useServerFn: () => async () => ({}) };
});
vi.mock("@/lib/media.functions", () => ({
  createMediaFolder: async () => ({}),
  registerMediaUpload: async () => ({}),
  updateMediaMeta: async () => ({}),
}));
vi.mock("@/lib/media/upload", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, uploadAndRegisterMedia: async () => ({ url: "https://cdn.test/a.png" }) };
});
vi.mock("@/lib/experts/hydration", () => ({
  fetchExpertHydration: async () => null,
}));
// Slot obrazka wymaga kontekstu najemcy (zapis mediów jest per tenant).
// W teście panelu wystarczy stała wartość - brak kontekstu RZUCA, więc bez tego
// cztery edytory ze slotem nie dają się w ogóle wyrenderować.
vi.mock("@/hooks/useAuth", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useRequiredTenant: () => "tenant-test",
    useCurrentTenantId: () => "tenant-test",
  };
});

/** Wyciek, którego nie wolno pokazać redakcji w polu formularza. */
const LEAKS = ["undefined", "NaN", "[object Object]"];

function assertNoLeak(root: HTMLElement, label: string): void {
  const text = root.textContent ?? "";
  for (const leak of LEAKS) {
    expect(text.includes(leak), `${label}: wyciekło „${leak}”`).toBe(false);
  }
  for (const input of root.querySelectorAll<HTMLInputElement>("input, textarea")) {
    for (const leak of LEAKS) {
      expect(input.value.includes(leak), `${label}: wyciekło „${leak}” do pola`).toBe(false);
    }
  }
}

type ContentEditor = (props: {
  c: WidgetNode["content"];
  lang: "pl" | "en";
  setContent: (k: string, v: Json) => void;
}) => ReactNode;

/** Edytory o wspólnym kontrakcie `{ c, lang, setContent }`. */
const CONTENT_EDITORS: ReadonlyArray<readonly [string, ContentEditor]> = [
  ["AccordionEditor", editors.AccordionEditor],
  ["AccountLinkEditor", editors.AccountLinkEditor],
  ["AnimatedHeadingEditor", editors.AnimatedHeadingEditor],
  ["AuthorProfileCardEditor", editors.AuthorProfileCardEditor],
  ["CircularCarouselEditor", editors.CircularCarouselEditor],
  ["EventCountdownCardEditor", editors.EventCountdownCardEditor],
  ["EventCountdownEditor", editors.EventCountdownEditor],
  ["EventScheduleEditor", editors.EventScheduleEditor],
  ["ImageEditor", editors.ImageEditor],
  ["InteractiveCircleEditor", editors.InteractiveCircleEditor],
  ["LogoCloudEditor", editors.LogoCloudEditor],
  ["MeetingBookingEditor", editors.MeetingBookingEditor],
  ["MegaMenuEditor", editors.MegaMenuEditor],
  ["PostListEditor", editors.PostListEditor],
  ["PricingEditor", editors.PricingEditor],
  ["ProgressCarouselEditor", editors.ProgressCarouselEditor],
  ["RatedListEditor", editors.RatedListEditor],
  ["RichTextEditor", editors.RichTextEditor as ContentEditor],
  ["SectionLabelEditor", editors.SectionLabelEditor],
  ["SliderEditor", editors.SliderEditor],
  ["SpeakersEditor", editors.SpeakersEditor],
  ["SponsorsEditor", editors.SponsorsEditor],
  ["TabsEditor", editors.TabsEditor],
  ["TeamMemberEditor", editors.TeamMemberEditor],
  ["TextRotateEditor", editors.TextRotateEditor],
  ["TimelineEditor", editors.TimelineEditor],
  ["WorldMapEditor", editors.WorldMapEditor],
];

/**
 * Treść USZKODZONA w każdy sposób, jaki naprawdę występuje w bazie: lista jako
 * napis, liczba jako napis, obiekt jako tablica, wartości `null`, klucze
 * językowe bez pary. Żaden edytor nie ma prawa się na tym wywalić.
 */
const BROKEN_CONTENT: WidgetNode["content"] = {
  items: "nie-tablica",
  slides: null,
  columns: "3",
  count: "dużo",
  limit: null,
  variant: 7,
  mode: null,
  title_pl: null,
  title_en: null,
  speakers: [null, "x", 7],
  days: {},
  regions: "PL",
  showAuthor: "0",
  authorSizePx: "12px",
  date: "nie-data",
  startsAt: "",
  photo: 7,
  url: null,
};

/**
 * Treść PEŁNA: po dwie pozycje w każdej liście, jakiej używa którykolwiek
 * z edytorów, i szeroki zestaw podkluczy. Bez tego edytory listowe renderują
 * wyłącznie nagłówek i przycisk „dodaj” - a cała ich logika (wiersze pozycji,
 * przenoszenie, usuwanie, pola per pozycja) siedzi właśnie w wierszach.
 */
const RICH_ITEM: Record<string, Json> = {
  id: "it-1",
  q_pl: "Pytanie",
  q_en: "Question",
  a_pl: "Odpowiedź",
  a_en: "Answer",
  title_pl: "Tytuł",
  title_en: "Title",
  label_pl: "Etykieta",
  label_en: "Label",
  text_pl: "Treść",
  text_en: "Text",
  desc_pl: "Opis",
  desc_en: "Description",
  name: "Jan Kowalski",
  role_pl: "Ekspert",
  role_en: "Expert",
  url: "https://neweu.test/a",
  href: "/o-nas",
  image: "https://cdn.test/a.png",
  photo: "https://cdn.test/b.png",
  icon: "star",
  color: "#ff8800",
  price: "199",
  period_pl: "mies.",
  value: 42,
  percent: 60,
  year: "2024",
  date: "2026-09-01",
  time: "10:00",
  code: "PL",
  slug: "o-nas",
  authorId: "a-1",
  kind: "page",
  section: "guest",
  featured: true,
  items: [{ id: "sub-1", label_pl: "Podpozycja", url: "/x" }],
};

const RICH_CONTENT: WidgetNode["content"] = {
  items: [{ ...RICH_ITEM }, { ...RICH_ITEM, id: "it-2", name: "Anna Nowak" }],
  columns: [{ ...RICH_ITEM }, { ...RICH_ITEM, id: "col-2" }],
  connections: [{ ...RICH_ITEM }, { ...RICH_ITEM, id: "con-2" }],
  entries: [{ ...RICH_ITEM }, { ...RICH_ITEM, id: "ent-2" }],
  logos: [{ ...RICH_ITEM }, { ...RICH_ITEM, id: "logo-2" }],
  plans: [{ ...RICH_ITEM }, { ...RICH_ITEM, id: "plan-2" }],
  speakers: [{ ...RICH_ITEM }, { ...RICH_ITEM, id: "sp-2" }],
  tabs: [{ ...RICH_ITEM }, { ...RICH_ITEM, id: "tab-2" }],
  days: [
    {
      id: "day-1",
      label_pl: "Dzień 1",
      label_en: "Day 1",
      date: "2026-09-01",
      sessions: [
        {
          id: "s-1",
          title_pl: "Sesja",
          title_en: "Session",
          from: "10:00",
          to: "11:00",
          speakers: [{ kind: "manual", name: "Jan Kowalski" }],
        },
      ],
    },
  ],
  title_pl: "Nagłówek",
  title_en: "Heading",
  subtitle_pl: "Podtytuł",
  subtitle_en: "Subtitle",
  variant: "card",
  mode: "event",
  layout: "grid",
  columnsDesktop: 3,
  limit: 6,
  showAuthor: true,
  authorSizePx: 14,
  image: "https://cdn.test/a.png",
  url: "https://neweu.test",
  eventId: "ev-1",
  authorId: "a-1",
  authorSlug: "jan-kowalski",
  regions: [{ code: "PL", value: 10 }],
};

/**
 * Ta sama pełna treść, ale z DRUGIM zestawem wartości wyliczeniowych i ze
 * WSZYSTKIMI przełącznikami wyłączonymi. Edytory zmieniają zestaw widocznych
 * pól w zależności od trybu (`mode`), rodzaju kolumny (`kind`), układu
 * (`layout`) czy źródła danych (`source`) - bez drugiego przejazdu połowa tych
 * gałęzi nie jest w ogóle renderowana, a to w nich mieszkają pola, które
 * redaktor faktycznie wypełnia.
 */
const RICH_ALT: WidgetNode["content"] = {
  ...RICH_CONTENT,
  columns: [{ ...RICH_ITEM, kind: "category", categorySlug: "gospodarka", postCount: 4 }],
  tiers: [
    {
      id: "tier-1",
      name_pl: "Główni",
      name_en: "Main",
      size: "lg",
      sponsors: [
        {
          id: "s-1",
          name: "Alfa",
          logo: "https://cdn.test/alfa.png",
          url: "https://alfa.test",
          description_pl: "Opis",
          description_en: "Description",
        },
      ],
    },
  ],
  mode: "custom",
  layout: "showcase",
  variant: "minimal",
  source: "manual",
  kind: "category",
  size: "lg",
  align: "center",
  tag: "h3",
  shape: "circle",
  splitBy: "words",
  staggerFrom: "center",
  width: "fixed",
  widthPx: 1200,
  maxWidthPx: 900,
  heightPx: 400,
  panelWidth: 720,
  panelRadius: 12,
  triggerOn: "click",
  tabAlign: "end",
  orderBy: "views",
  uniqueOnPage: true,
  targetAt: "2026-12-31T23:59:00Z",
  hostUserId: "u-1",
  slug: "o-nas",
  accentColor: "#ff8800",
  bgColor: "#101010",
  pointColor: "#ff0000",
  lineColor: "#00ff00",
  dotColor: "#0000ff",
  color: "#123456",
  src: "https://cdn.test/a.png",
  srcDark: "https://cdn.test/b.png",
  alt_pl: "Opis obrazka",
  alt_en: "Image alt",
  speedSeconds: 30,
  intervalMs: 4000,
  rotationInterval: 3000,
  autoPlayInterval: 5000,
  transitionMs: 400,
  durationMs: 600,
  duration: 5,
  delayMs: 120,
  staggerDurationMs: 80,
  // Wszystkie przełączniki JAWNIE wyłączone - domyślnie są włączone
  // (`!== false`), więc dopiero to przechodzi ich drugą gałąź.
  allowHostManage: false,
  auto: false,
  autoplay: false,
  autoPlay: false,
  enableAnimations: false,
  fadeEdges: false,
  grayscale: false,
  loop: false,
  openProfile: false,
  pauseOnHover: false,
  showAction: false,
  showArrows: false,
  showAttendees: false,
  showCountdown: false,
  showCounter: false,
  showDayTabs: false,
  showDesc: false,
  showDots: false,
  showHost: false,
  showLocation: false,
  showSeconds: false,
  showAuthor: false,
};

function renderEditor(Editor: ContentEditor, c: WidgetNode["content"], lang: "pl" | "en" = "pl") {
  const written: Array<[string, Json]> = [];
  const view = renderWithQueryClient(
    <Editor c={c} lang={lang} setContent={(k, v) => written.push([k, v])} />,
  );
  return { ...view, written };
}

beforeEach(() => {
  db.current = supabaseFromStub();
  for (const table of ["pages", "posts", "profiles", "events", "categories", "tags", "media"]) {
    db.current.setResponse(table, ok([]));
  }
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("edytory treści - pusta treść nowego widgetu", () => {
  it.each(CONTENT_EDITORS)("%s renderuje się na pustej treści", (name, Editor) => {
    const { container } = renderEditor(Editor, {});
    // Cokolwiek widzialnego: pole, przycisk albo tekst. Pusty render znaczy,
    // że redaktor po wstawieniu widgetu nie ma czego kliknąć.
    expect(container.textContent?.length ?? 0).toBeGreaterThan(0);
    assertNoLeak(container, name);
  });

  it.each(CONTENT_EDITORS)("%s nie zapisuje niczego na samym renderze", (_name, Editor) => {
    const { written } = renderEditor(Editor, {});
    // Zapis w trakcie renderu to pętla aktualizacji dokumentu i „brudny”
    // stan strony bez żadnej akcji redaktora.
    expect(written).toEqual([]);
  });
});

describe("edytory treści - treść uszkodzona", () => {
  it.each(CONTENT_EDITORS)("%s znosi treść w złych typach", (name, Editor) => {
    const { container } = renderEditor(Editor, BROKEN_CONTENT);
    expect(container.textContent?.length ?? 0).toBeGreaterThan(0);
    assertNoLeak(container, name);
  });

  it.each(CONTENT_EDITORS)("%s znosi treść uszkodzoną po angielsku", (name, Editor) => {
    const { container } = renderEditor(Editor, BROKEN_CONTENT, "en");
    assertNoLeak(container, name);
  });
});

describe("edytory treści - dodawanie pozycji listy", () => {
  const ADD_LABEL = /common\.add/;

  it.each(CONTENT_EDITORS)(
    "%s: przycisk dodawania (jeśli jest) zapisuje tablicę",
    (_name, Editor) => {
      const { written } = renderEditor(Editor, {});
      const buttons = screen.queryAllByRole("button", { name: ADD_LABEL });
      if (buttons.length === 0) return;
      fireEvent.click(buttons[0]);
      expect(written.length).toBeGreaterThan(0);
      const [, value] = written[written.length - 1];
      // Pozycja dopisana do listy - nie napis, nie obiekt.
      expect(Array.isArray(value)).toBe(true);
      expect((value as unknown[]).length).toBeGreaterThan(0);
    },
  );

  it.each(CONTENT_EDITORS)(
    "%s: dodawanie do listy uszkodzonej naprawia ją, zamiast dopisywać do napisu",
    (_name, Editor) => {
      const { written } = renderEditor(Editor, BROKEN_CONTENT);
      const buttons = screen.queryAllByRole("button", { name: ADD_LABEL });
      if (buttons.length === 0) return;
      fireEvent.click(buttons[0]);
      if (written.length === 0) return;
      const [, value] = written[written.length - 1];
      expect(Array.isArray(value)).toBe(true);
    },
  );
});

describe("edytory treści - treść pełna", () => {
  it.each(CONTENT_EDITORS)("%s renderuje wiersze pozycji", (name, Editor) => {
    const { container } = renderEditor(Editor, RICH_CONTENT);
    expect(container.textContent?.length ?? 0).toBeGreaterThan(0);
    assertNoLeak(container, name);
  });

  it.each(CONTENT_EDITORS)("%s renderuje wiersze pozycji po angielsku", (name, Editor) => {
    const { container } = renderEditor(Editor, RICH_CONTENT, "en");
    assertNoLeak(container, name);
  });

  it.each(CONTENT_EDITORS)(
    "%s: żaden przycisk wiersza nie zapisuje wartości niedefiniowanej",
    (name, Editor) => {
      const { container, written } = renderEditor(Editor, RICH_CONTENT);
      // Przechodzimy po WSZYSTKICH przyciskach edytora (przenoszenie, usuwanie,
      // dodawanie, przełączniki wariantów). Kontrakt: każdy zapis musi być
      // wartością SERIALIZOWALNĄ - `undefined` w treści widgetu znika przy
      // zapisie do bazy i pole cicho traci ustawienie.
      for (let i = 0; i < 80; i += 1) {
        const buttons = Array.from(container.querySelectorAll("button")).filter((b) => !b.disabled);
        if (i >= buttons.length) break;
        fireEvent.click(buttons[i]);
        assertNoLeak(container, `${name} (po kliknięciu ${i})`);
      }
      for (const [key, value] of written) {
        expect(value, `${name}: klucz ${key} zapisany jako undefined`).not.toBeUndefined();
        expect(() => JSON.stringify(value)).not.toThrow();
      }
    },
  );

  it.each(CONTENT_EDITORS)(
    "%s: żadne pole tekstowe nie zapisuje wartości niedefiniowanej",
    (name, Editor) => {
      const { container, written } = renderEditor(Editor, RICH_CONTENT);
      const fields = Array.from(
        container.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea"),
      );
      for (const field of fields) {
        // Pola wyboru plików pomijamy: ich wartości nie da się ustawić
        // programowo (przeglądarka na to nie pozwala), a wysyłka pliku ma
        // własny test przy `ImageSlot`.
        if (field.type === "file") continue;
        if (field.type === "checkbox" || field.type === "radio") {
          fireEvent.click(field);
          continue;
        }
        const next = field.type === "number" ? "12" : "nowa wartość";
        fireEvent.change(field, { target: { value: next } });
      }
      for (const select of container.querySelectorAll<HTMLSelectElement>("select")) {
        const options = Array.from(select.querySelectorAll("option"));
        if (options.length > 1) fireEvent.change(select, { target: { value: options[1].value } });
      }
      assertNoLeak(container, name);
      for (const [key, value] of written) {
        expect(value, `${name}: klucz ${key} zapisany jako undefined`).not.toBeUndefined();
      }
    },
  );
});

describe("edytory treści - drugi zestaw wartości wyliczeniowych", () => {
  it.each(CONTENT_EDITORS)("%s renderuje się w trybie alternatywnym", (name, Editor) => {
    const { container } = renderEditor(Editor, RICH_ALT);
    expect(container.textContent?.length ?? 0).toBeGreaterThan(0);
    assertNoLeak(container, name);
  });

  it.each(CONTENT_EDITORS)("%s w trybie alternatywnym po angielsku", (name, Editor) => {
    const { container } = renderEditor(Editor, RICH_ALT, "en");
    assertNoLeak(container, name);
  });

  it.each(CONTENT_EDITORS)(
    "%s w trybie alternatywnym: wszystkie kontrolki zapisują wartości zdefiniowane",
    (name, Editor) => {
      const { container, written } = renderEditor(Editor, RICH_ALT);
      for (let i = 0; i < 80; i += 1) {
        const buttons = Array.from(container.querySelectorAll("button")).filter((b) => !b.disabled);
        if (i >= buttons.length) break;
        fireEvent.click(buttons[i]);
      }
      for (const field of container.querySelectorAll<HTMLInputElement>("input, textarea")) {
        if (field.type === "file") continue;
        if (field.type === "checkbox" || field.type === "radio") {
          fireEvent.click(field);
          continue;
        }
        fireEvent.change(field, { target: { value: field.type === "number" ? "7" : "tekst" } });
      }
      for (const select of container.querySelectorAll<HTMLSelectElement>("select")) {
        const options = Array.from(select.querySelectorAll("option"));
        if (options.length > 1)
          fireEvent.change(select, { target: { value: options.at(-1)!.value } });
      }
      assertNoLeak(container, name);
      for (const [key, value] of written) {
        expect(value, `${name}: klucz ${key} zapisany jako undefined`).not.toBeUndefined();
      }
    },
  );
});

/**
 * Nakładki na pełną treść, każda przestawiająca JEDNĄ decyzję, od której
 * edytory uzależniają zestaw pól: źródło danych, wariant prezentacji, tryb
 * animacji, rodzaj pozycji menu. Klucze są wspólne dla wielu edytorów (każdy
 * czyta swój), więc jedna nakładka odsłania gałęzie w kilku plikach naraz.
 */
const VARIANT_OVERLAYS: ReadonlyArray<readonly [string, WidgetNode["content"]]> = [
  ["źródło: katalog ekspertów", { source: "directory" }],
  ["źródło: prelegenci wydarzenia", { source: "event", eventId: "ev-1" }],
  ["źródło: dynamiczne", { source: "dynamic" }],
  [
    "źródło: katalog planów",
    { source: "plans", planInterval: "month", tierKeysCsv: "plus,pro", planLimit: 3 },
  ],
  ["źródło: ręczne", { source: "manual" }],
  ["przełączniki harmonogramu wyłączone", { showDayTabs: false, openProfile: false }],
  ["źródło: wpisy", { source: "posts" }],
  ["źródło: eksperci", { source: "experts" }],
  ["wariant: ranking", { variant: "ranked" }],
  ["wariant: numerowany", { variant: "numbered" }],
  ["wariant: wielokartowy", { variant: "multi-card" }],
  ["wariant: minimalny", { variant: "minimal" }],
  ["tryb: rotacja", { mode: "rotate" }],
  ["tryb: podkreślenie na hover", { mode: "hover-underline", shape: "underline" }],
  ["tryb: obwódka na hover", { mode: "hover-allsides", shape: "underline" }],
  ["tryb: własna data", { mode: "custom", targetAt: "2026-12-31T23:59:00Z" }],
  ["doładowanie: przewijanie", { pagination: "scroll", loadMode: "scroll" }],
  ["doładowanie: przycisk", { pagination: "loadmore", loadMode: "loadmore" }],
  [
    "pozycje menu konta we wszystkich rodzajach",
    {
      items: [
        { id: "i1", kind: "preset", preset: "profile", label_pl: "Profil", label_en: "Profile" },
        { id: "i2", kind: "page", slug: "o-nas", label_pl: "O nas", label_en: "About" },
        { id: "i3", kind: "custom", href: "/x", label_pl: "Własny", label_en: "Custom" },
        { id: "i4", kind: "separator" },
        { id: "i5", kind: "logout", label_pl: "Wyloguj", label_en: "Log out" },
      ],
      section: "user",
    },
  ],
  ["etykieta sekcji: kolor marki", { tone: "brand", labelTone: "brand" }],
  ["etykieta sekcji: kolor neutralny", { tone: "neutral", labelTone: "neutral" }],
  ["indeks po lewej, wyśrodkowany", { indexSide: "left", indexVAlign: "middle", indexSizePx: 120 }],
  ["indeks na dole", { indexSide: "right", indexVAlign: "bottom" }],
];

/**
 * Pozycje list ISTNIEJĄ, ale nie mają ani jednego pola opcjonalnego - tylko
 * identyfikator. To jest realny stan dokumentu: redakcja klika "dodaj", a pola
 * wypełnia później (albo nigdy). Dla testu ta treść jest ważna z innego
 * powodu: wiersz pozycji renderuje się w całości, więc KAŻDA wartość domyślna
 * (`x ?? ""`, `?? 0`, `?? "auto"`) idzie ścieżką braku - a w pełnej treści
 * wszystkie te gałęzie brane są od drugiej strony.
 */
const BARE_LIST_KEYS = [
  "items",
  "columns",
  "connections",
  "entries",
  "logos",
  "plans",
  "speakers",
  "tabs",
  "days",
  "sessions",
  "tiers",
  "regions",
  "slides",
  "features",
  "links",
  "socials",
] as const;

const BARE_CONTENT: WidgetNode["content"] = Object.fromEntries(
  BARE_LIST_KEYS.map((key) => [key, [{ id: `${key}-1` }, { id: `${key}-2` }]]),
);

describe("edytory treści - pozycje bez pól opcjonalnych", () => {
  it.each(CONTENT_EDITORS)("%s renderuje wiersze samych identyfikatorów", (name, Editor) => {
    const { container } = renderEditor(Editor, BARE_CONTENT);
    expect(container.textContent?.length ?? 0).toBeGreaterThan(0);
    // Puste pole nie może pokazać się redakcji jako „undefined" ani „NaN".
    assertNoLeak(container, name);
  });

  it.each(CONTENT_EDITORS)("%s: wiersze bez pól są edytowalne", (name, Editor) => {
    const { container, written } = renderEditor(Editor, BARE_CONTENT);
    const toggles = Array.from(
      container.querySelectorAll<HTMLButtonElement>('button[aria-expanded="false"]'),
    );
    for (const toggle of toggles) fireEvent.click(toggle);
    for (const field of container.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
      "input, textarea",
    )) {
      if (field.type === "file") continue;
      if (field.type === "checkbox" || field.type === "radio") {
        fireEvent.click(field);
        continue;
      }
      fireEvent.change(field, { target: { value: field.type === "number" ? "7" : "wartość" } });
    }
    for (const select of container.querySelectorAll<HTMLSelectElement>("select")) {
      const options = Array.from(select.querySelectorAll("option"));
      if (options.length > 1) fireEvent.change(select, { target: { value: options[1].value } });
    }
    assertNoLeak(container, `${name} (po edycji pustych wierszy)`);
    for (const [key, value] of written) {
      expect(value, `${name}: klucz ${key} zapisany jako undefined`).not.toBeUndefined();
    }
  });

  it.each(CONTENT_EDITORS)("%s: przyciski wierszy bez pól nie psują treści", (name, Editor) => {
    const { container, written } = renderEditor(Editor, BARE_CONTENT);
    for (let i = 0; i < 60; i += 1) {
      const buttons = Array.from(container.querySelectorAll("button")).filter((b) => !b.disabled);
      if (i >= buttons.length) break;
      fireEvent.click(buttons[i]);
      assertNoLeak(container, `${name} (po kliknięciu ${i})`);
    }
    for (const [key, value] of written) {
      expect(value, `${name}: klucz ${key} zapisany jako undefined`).not.toBeUndefined();
      expect(() => JSON.stringify(value)).not.toThrow();
    }
  });
});

describe("edytory treści - wartości FAŁSZYWE, ale poprawne", () => {
  // Najczęstszy prawdziwy błąd w tej warstwie: `Number(x) || 12`
  // i `value ?? ""`. Zero i pusty łańcuch są POPRAWNYMI wartościami, a taki
  // zapis podmienia je na wartość domyślną - redaktor ustawia odstęp 0 px
  // i dostaje 12 px, kasuje kolor i dostaje stary. Ten przejazd wpisuje
  // wszędzie zero i pustkę i pilnuje, żeby nic nie wyciekło do panelu ani do
  // dokumentu jako `undefined`.
  it.each(CONTENT_EDITORS)("%s: zero i pustka nie psują panelu", (name, Editor) => {
    const { container, written } = renderEditor(Editor, RICH_CONTENT);
    const toggles = Array.from(
      container.querySelectorAll<HTMLButtonElement>('button[aria-expanded="false"]'),
    );
    for (const toggle of toggles) fireEvent.click(toggle);
    const fields = Array.from(
      container.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea"),
    );
    for (const field of fields) {
      if (field instanceof HTMLInputElement && field.type === "file") continue;
      if (
        field instanceof HTMLInputElement &&
        (field.type === "checkbox" || field.type === "radio")
      ) {
        continue;
      }
      const next = field instanceof HTMLInputElement && field.type === "number" ? "0" : "";
      fireEvent.change(field, { target: { value: next } });
      assertNoLeak(
        container,
        `${name} (po wyzerowaniu ${field.getAttribute("placeholder") ?? ""})`,
      );
    }
    for (const [key, value] of written) {
      expect(value, `${name}: klucz ${key} zapisany jako undefined`).not.toBeUndefined();
    }
  });

  it.each(CONTENT_EDITORS)("%s: zero i pustka na pozycjach bez pól", (name, Editor) => {
    const { container, written } = renderEditor(Editor, BARE_CONTENT);
    const toggles = Array.from(
      container.querySelectorAll<HTMLButtonElement>('button[aria-expanded="false"]'),
    );
    for (const toggle of toggles) fireEvent.click(toggle);
    for (const field of container.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
      "input, textarea",
    )) {
      if (field instanceof HTMLInputElement && field.type === "file") continue;
      if (
        field instanceof HTMLInputElement &&
        (field.type === "checkbox" || field.type === "radio")
      ) {
        continue;
      }
      const next = field instanceof HTMLInputElement && field.type === "number" ? "0" : "";
      fireEvent.change(field, { target: { value: next } });
    }
    assertNoLeak(container, name);
    for (const [key, value] of written) {
      expect(value, `${name}: klucz ${key} zapisany jako undefined`).not.toBeUndefined();
    }
  });
});

describe("edytory treści - sekcje zwinięte", () => {
  // `PostListEditor` i `RatedListEditor` grupują ustawienia w sekcjach
  // ZWINIĘTYCH domyślnie - i to jest zamierzone (panel nie odpytuje bazy
  // o wszystko na wejściu). Skutek dla testu: bez otwarcia sekcji połowa pól
  // tych edytorów nie istnieje w DOM. Tabela otwiera więc KAŻDĄ sekcję
  // i dopiero wtedy sprawdza kontrolki w środku.
  it.each(CONTENT_EDITORS)("%s: otwarcie wszystkich sekcji odsłania pola", (name, Editor) => {
    const { container, written } = renderEditor(Editor, RICH_CONTENT);
    const toggles = Array.from(
      container.querySelectorAll<HTMLButtonElement>('button[aria-expanded="false"]'),
    );
    for (const toggle of toggles) fireEvent.click(toggle);
    assertNoLeak(container, `${name} (sekcje otwarte)`);
    for (const field of container.querySelectorAll<HTMLInputElement>("input, textarea")) {
      if (field.type === "file") continue;
      if (field.type === "checkbox" || field.type === "radio") {
        fireEvent.click(field);
        continue;
      }
      fireEvent.change(field, { target: { value: field.type === "number" ? "5" : "wartość" } });
    }
    for (const select of container.querySelectorAll<HTMLSelectElement>("select")) {
      const options = Array.from(select.querySelectorAll("option"));
      if (options.length > 1) fireEvent.change(select, { target: { value: options[1].value } });
    }
    assertNoLeak(container, `${name} (po edycji w sekcjach)`);
    for (const [key, value] of written) {
      expect(value, `${name}: klucz ${key} zapisany jako undefined`).not.toBeUndefined();
    }
  });
});

describe("edytory treści - nakładki decyzji", () => {
  const cases = CONTENT_EDITORS.flatMap(([name, Editor]) =>
    VARIANT_OVERLAYS.map(([label, overlay]) => [`${name} / ${label}`, Editor, overlay] as const),
  );

  it.each(cases)("%s", (label, Editor, overlay) => {
    const { container, written } = renderEditor(Editor, { ...RICH_CONTENT, ...overlay });
    expect(container.textContent?.length ?? 0).toBeGreaterThan(0);
    assertNoLeak(container, label);
    for (const select of container.querySelectorAll<HTMLSelectElement>("select")) {
      const options = Array.from(select.querySelectorAll("option"));
      if (options.length > 1)
        fireEvent.change(select, { target: { value: options.at(-1)!.value } });
    }
    assertNoLeak(container, `${label} (po zmianie list)`);
    for (const [key, value] of written) {
      expect(value, `${label}: klucz ${key} zapisany jako undefined`).not.toBeUndefined();
    }
  });
});

/**
 * Nakładki ŹRÓDŁA DANYCH po angielsku. Panele źródeł (katalog ekspertów,
 * prelegenci wydarzenia, katalog planów, dane dynamiczne) mają etykiety
 * wpisane wprost jako `lang === "pl" ? ... : ...`, a nie przez słownik - więc
 * druga strona każdego z tych warunków nie wykonuje się w polskim przejeździe.
 * Odwrócony warunek pokazywałby polski tekst w angielskim panelu i nikt by
 * tego nie zauważył.
 */
const SOURCE_OVERLAYS = VARIANT_OVERLAYS.filter(([label]) => label.startsWith("źródło"));

describe("edytory treści - panele źródeł po angielsku", () => {
  const cases = CONTENT_EDITORS.flatMap(([name, Editor]) =>
    SOURCE_OVERLAYS.map(([label, overlay]) => [`${name} / ${label}`, Editor, overlay] as const),
  );

  it.each(cases)("%s", (label, Editor, overlay) => {
    const { container, written } = renderEditor(Editor, { ...RICH_CONTENT, ...overlay }, "en");
    expect(container.textContent?.length ?? 0).toBeGreaterThan(0);
    assertNoLeak(container, label);
    for (const [key, value] of written) {
      expect(value, `${label}: klucz ${key} zapisany jako undefined`).not.toBeUndefined();
    }
  });
});

describe("edytory treści - podglądy pomocnicze", () => {
  it("podgląd prezentacji wpisu renderuje się dla pustej i uszkodzonej treści", () => {
    const first = renderWithQueryClient(<DisplayLivePreview c={{}} lang="pl" />);
    expect(first.container.textContent?.length ?? 0).toBeGreaterThan(0);
    assertNoLeak(first.container, "DisplayLivePreview (pusta)");
    first.unmount();

    const second = renderWithQueryClient(<DisplayLivePreview c={BROKEN_CONTENT} lang="en" />);
    assertNoLeak(second.container, "DisplayLivePreview (uszkodzona)");
  });

  it.each([
    ["wartości w pikselach", { sizePx: 64, subtitleSizePx: 18, sizePreset: "" }],
    ["dziedziczenie z tokenów", { sizePx: 0, subtitleSizePx: 0, sizePreset: "" }],
    ["gotowy rozmiar (klasa)", { sizePx: 0, subtitleSizePx: 0, sizePreset: "text-4xl" }],
  ])("podgląd nagłówka zapasowego renderuje się: %s", (_label, sizes) => {
    const { container } = renderWithQueryClient(
      <editors.HeadingFallbackPreview
        titleWeight="900"
        subtitleWeight="300"
        titleSample="Tytuł"
        subtitleSample="Podtytuł"
        {...sizes}
      />,
    );
    expect(container.textContent?.length ?? 0).toBeGreaterThan(0);
    assertNoLeak(container, "HeadingFallbackPreview");
  });
});
