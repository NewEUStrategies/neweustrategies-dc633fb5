// Ikony z treści CMS (`contentIcon`) w ośmiu prawdziwych miejscach przy
// HYDRATACJI i przy renderze czysto klienckim.
//
// CO TEN PLIK DOWODZI (dla każdego miejsca):
//  1. hydratacja HTML-u serwera: nazwa wybieraka z katalogu
//     (`alarm-clock-check`, granica Suspense `DynamicIcon`), nazwa wybieraka
//     spoza katalogu (`nie-ma-takiej-ikony` - zastępnik miejsca ze znacznikiem
//     `data-dyn-missing`), nazwa z zestawu kuratorowanego (`Bell`) i eksport
//     shimu renderowany już przed naprawą (`Quote`): DOM = HTML serwera, bez
//     błędu hydratacji (także odzyskiwalnego) i BEZ sięgania po porcję danych
//     ikon; aktualizacje W TRAKCIE hydratacji - re-render rodzica i zmiana
//     kontekstu nad widgetem, wysłane, gdy widget jest jeszcze odwodniony -
//     nie zamieniają węzła ikony ani nie przełączają granicy na render klienta;
//  2. render czysto kliencki nazwy z katalogu (nawigacja SPA, kanwa): pierwszy
//     commit rezerwuje pudełko o wymiarze gotowej ikony, a HTML końcowy =
//     HTML serwera.
//
// Serwer i przeglądarka to osobne instancje modułów (`vi.resetModules`):
// przeglądarka startuje bez porcji danych i bez pamięci kształtów, jak po
// prawdziwym załadowaniu strony. Harness wzięty z drugiej próby D4
// (p2/icons-v2), bez jej ścieżki katalogu.
import {
  createContext,
  startTransition,
  Suspense,
  useContext,
  useLayoutEffect,
  useState,
  type ComponentType,
  type ReactElement,
  type ReactNode,
} from "react";
import { renderToString } from "react-dom/server";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Licznik ODCZYTÓW wpisów porcji danych (prawdziwe dane). Wynik fabryki mocka
// vitest pamięta mimo `resetModules`, więc liczymy odczyt wpisu, nie import.
const h = vi.hoisted(() => ({
  reads: 0,
  track: (registry: Record<string, unknown>) =>
    new Proxy(registry, {
      get(target, property, receiver) {
        if (typeof property === "string") h.reads += 1;
        return Reflect.get(target, property, receiver);
      },
    }),
}));
vi.mock("../chunks/icons-0.json", async (importOriginal) => ({
  default: h.track((await importOriginal<{ default: Record<string, unknown> }>()).default),
}));
vi.mock("../chunks/icons-1.json", async (importOriginal) => ({
  default: h.track((await importOriginal<{ default: Record<string, unknown> }>()).default),
}));
vi.mock("../chunks/icons-2.json", async (importOriginal) => ({
  default: h.track((await importOriginal<{ default: Record<string, unknown> }>()).default),
}));
vi.mock("../chunks/icons-3.json", async (importOriginal) => ({
  default: h.track((await importOriginal<{ default: Record<string, unknown> }>()).default),
}));

vi.mock(
  "@/components/builder/organisms/widget-view/lazyWidgets",
  () => import("@/test/eagerWidgetChunks"),
);

vi.mock("@/integrations/supabase/client", () => {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "in", "not", "order", "range", "limit", "maybeSingle"]) {
    b[m] = () => b;
  }
  b.then = (r: (v: unknown) => unknown) => r({ data: [], error: null });
  return { supabase: { from: () => b, rpc: async () => ({ data: [], error: null }) } };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, o?: { defaultValue?: string }) => o?.defaultValue ?? k,
    i18n: { language: "pl" },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

const alertBarSetting = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock("@/lib/useSiteSetting", () => ({
  useSiteSetting: (key: string, fallback: unknown) =>
    key === "theme_options" ? { header: { alert_bar: alertBarSetting.current } } : fallback,
}));

// ---------- instancje modułów (serwer / przeglądarka) ----------

interface Modules {
  WidgetView: ComponentType<Record<string, unknown>>;
  AlertBar: ComponentType;
  QueryClientProvider: ComponentType<{ client: unknown; children: ReactNode }>;
  QueryClient: new (options?: unknown) => unknown;
}

async function loadModules(): Promise<Modules> {
  const [{ WidgetView }, { AlertBar }, rq] = await Promise.all([
    import("@/components/builder/organisms/WidgetView"),
    import("@/components/AlertBar"),
    import("@tanstack/react-query"),
  ]);
  return {
    WidgetView: WidgetView as unknown as ComponentType<Record<string, unknown>>,
    AlertBar,
    QueryClientProvider: rq.QueryClientProvider as unknown as Modules["QueryClientProvider"],
    QueryClient: rq.QueryClient as unknown as Modules["QueryClient"],
  };
}

// ---------- miejsca ----------

interface Site {
  readonly id: string;
  /** Element miejsca dla nazwy ikony (z modułów danej strony). */
  readonly element: (m: Modules, name: string) => ReactElement;
}

// Jeden klient zapytań na instancję modułów: re-render rodzica ma dawać te
// same propsy kontekstu react-query.
const queryClients = new WeakMap<Modules, unknown>();

function widget(m: Modules, type: string, content: Record<string, unknown>): ReactElement {
  let client = queryClients.get(m);
  if (!client) {
    client = new m.QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClients.set(m, client);
  }
  return (
    <m.QueryClientProvider client={client}>
      <m.WidgetView
        node={{ id: `w-${type}`, kind: "widget", type, content }}
        lang="pl"
        device="desktop"
        editable={false}
      />
    </m.QueryClientProvider>
  );
}

const SITES: Site[] = [
  { id: "divider", element: (m, n) => widget(m, "divider", { variant: "icon", iconName: n }) },
  {
    id: "timeline (wpis)",
    element: (m, n) =>
      widget(m, "timeline", {
        entries: [{ type: "item", iconType: "lucide", iconName: n, title_pl: "Wpis" }],
      }),
  },
  {
    id: "timeline (tytuł)",
    element: (m, n) =>
      widget(m, "timeline", {
        entries: [
          {
            type: "item",
            iconType: "initials",
            initials: "AB",
            title_pl: "Wpis",
            titleIconName: n,
          },
        ],
      }),
  },
  {
    id: "hot-topic-bar",
    element: (m, n) =>
      widget(m, "hot-topic-bar", { title_pl: "Temat dnia", href: "/temat", iconName: n }),
  },
  {
    id: "newsletter",
    element: (m, n) =>
      widget(m, "newsletter", { variant: "icon", title_pl: "Newsletter", iconName: n }),
  },
  {
    id: "heading",
    element: (m, n) => widget(m, "heading", { text_pl: "Nagłówek", tag: "h2", iconName: n }),
  },
  {
    id: "button",
    element: (m, n) => widget(m, "button", { label_pl: "Przycisk", href: "/kontakt", iconName: n }),
  },
  {
    id: "alert-bar",
    element: (m, n) => {
      alertBarSetting.current = {
        enabled: true,
        message_pl: "Komunikat",
        message_en: "Notice",
        link_url: "",
        style: "brand",
        dismissible: true,
        icon: n,
      };
      return <m.AlertBar />;
    },
  },
];

/** Węzeł ikony w DOM-ie dla nazwy (SVG albo znacznik braku `<template>`). */
const ICON_SELECTOR: Record<string, string> = {
  "alarm-clock-check": 'svg[data-dyn-icon="AlarmClockCheck"]',
  "nie-ma-takiej-ikony": '[data-dyn-missing="NieMaTakiejIkony"]',
  Bell: "svg.lucide-bell",
  Quote: "svg.lucide-quote",
};
const NAMES = Object.keys(ICON_SELECTOR);

// ---------- uprząż ----------

const SessionContext = createContext("gość");
const holder = {
  setSession: (_value: string) => {},
  rerender: () => {},
  /** Wywoływane w efekcie układu PIERWSZEGO commitu (hydratacja korzenia). */
  onFirstCommit: null as null | (() => void),
};

function SessionProbe(): ReactElement {
  return <span data-probe="sesja">{useContext(SessionContext)}</span>;
}

function FirstCommit(): null {
  useLayoutEffect(() => {
    holder.onFirstCommit?.();
  }, []);
  return null;
}

/**
 * Rodzic z kontekstem nad widgetem i granicą Suspense jak sekcja strony.
 * `render` woła się przy każdym renderze - nowe elementy, nowy `node`.
 */
function Holder({ render }: { render: () => ReactElement }): ReactElement {
  const [session, setSession] = useState("gość");
  const [, setTick] = useState(0);
  holder.setSession = setSession;
  holder.rerender = () => setTick((tick) => tick + 1);
  return (
    <SessionContext value={session}>
      <SessionProbe />
      <FirstCommit />
      <Suspense fallback={null}>{render()}</Suspense>
    </SessionContext>
  );
}

const roots: Root[] = [];
let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  h.reads = 0;
  holder.onFirstCommit = null;
  consoleError = vi.spyOn(console, "error");
});

afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

/**
 * HTML serwera: `renderToString`, powtarzany, aż leniwe moduły ikon
 * (`DynamicIconChunk`, porcja `icons-N`) dojdą i żadna granica nie zostanie
 * otwarta - serwer też czeka na tę porcję. Bez renderu strumieniowego:
 * strumieniowy Fizz zostawia na kontekstach (np. react-query, wspólnym dla
 * instancji modułów) znacznik renderera głównego, a klient w tym samym
 * procesie zgłosiłby wtedy „multiple renderers"; `renderToString` używa
 * znacznika renderera pomocniczego.
 */
async function serverHtml(site: Site, name: string): Promise<string> {
  vi.resetModules();
  const server = await loadModules();
  const element = <Holder render={() => site.element(server, name)} />;
  let html = renderToString(element);
  for (let i = 0; i < 50 && /<!--\$[!?]-->/.test(html); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    html = renderToString(element);
  }
  expect(html, "granica domknięta na serwerze").not.toMatch(/<!--\$[!?]-->/);
  return html;
}

/** Świeże moduły przeglądarki: bez porcji danych i bez odczytanych kształtów. */
async function browserModules(): Promise<Modules> {
  vi.resetModules();
  const modules = await loadModules();
  h.reads = 0;
  return modules;
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}

const hasFiber = (node: Element): boolean =>
  Object.keys(node).some((key) => key.startsWith("__reactFiber$"));

describe.each(SITES)("contentIcon przy hydratacji: $id", (site) => {
  it.each(NAMES)(
    "%s: DOM = HTML serwera bez porcji danych; re-render i zmiana kontekstu w trakcie hydratacji",
    async (name) => {
      const html = await serverHtml(site, name);
      const browser = await browserModules();
      const container = document.createElement("div");
      container.innerHTML = html;
      document.body.append(container);
      const serverIcon = container.querySelector(ICON_SELECTOR[name]);
      expect(serverIcon, `węzeł ikony ${name} w HTML-u serwera`).not.toBeNull();

      // Aktualizacje wysłane w efekcie układu pierwszego commitu: korzeń jest
      // uwodniony, a widget (granice Suspense) - jeszcze nie.
      let dehydratedAtUpdate: boolean | null = null;
      holder.onFirstCommit = () => {
        dehydratedAtUpdate = !hasFiber(serverIcon!);
        holder.rerender();
        holder.setSession("zalogowany");
        startTransition(() => holder.setSession("ktoś inny"));
      };

      const errors: unknown[] = [];
      await act(async () => {
        roots.push(
          hydrateRoot(container, <Holder render={() => site.element(browser, name)} />, {
            onRecoverableError: (error) => errors.push(error),
          }),
        );
      });
      await settle();
      expect(dehydratedAtUpdate, "aktualizacja przyszła przed hydratacją widgetu").toBe(true);
      expect(errors).toEqual([]);
      expect(consoleError).not.toHaveBeenCalled();
      expect(container.querySelector('[data-probe="sesja"]')?.textContent).toBe("ktoś inny");
      expect(container.innerHTML).toBe(html.replace(">gość<", ">ktoś inny<"));
      // Hydratacja nie sięgnęła po porcję danych ikon.
      expect(h.reads).toBe(0);
      // Ten sam węzeł serwera, uwodniony (nie wyrenderowany od nowa).
      expect(container.querySelector(ICON_SELECTOR[name])).toBe(serverIcon);
      expect(hasFiber(serverIcon!)).toBe(true);

      // Po hydratacji: re-render rodzica i zmiana kontekstu nic nie zmieniają.
      await act(async () => holder.rerender());
      await act(async () => holder.setSession("gość"));
      expect(container.innerHTML).toBe(html);
      expect(container.querySelector(ICON_SELECTOR[name])).toBe(serverIcon);
      expect(errors).toEqual([]);
      expect(h.reads).toBe(0);
    },
  );
});

// ---------- render czysto kliencki ----------

/** Tailwind: `w-4`, `size-3.5` -> px (skala 0.25rem = 4 px). */
function tailwindPx(className: string, prefix: "w" | "h"): number | null {
  for (const token of className.split(/\s+/)) {
    const match = new RegExp(`^(?:${prefix}|size)-(\\d+(?:\\.\\d+)?)$`).exec(token);
    if (match) return Number(match[1]) * 4;
  }
  return null;
}

/**
 * Pudełko z znaczników (happy-dom nie liczy układu): klasa wymiaru miejsca
 * wygrywa z atrybutami `width`/`height` SVG; rezerwacja Suspense ma wymiar
 * w stylu inline.
 */
function boxOf(element: Element): { width: number; height: number } {
  if (element.localName === "svg") {
    const cls = element.getAttribute("class") ?? "";
    return {
      width: tailwindPx(cls, "w") ?? Number(element.getAttribute("width")),
      height: tailwindPx(cls, "h") ?? Number(element.getAttribute("height")),
    };
  }
  const style = (element as HTMLElement).style;
  return { width: Number.parseFloat(style.width), height: Number.parseFloat(style.height) };
}

/** `innerHTML` kopii z atrybutami `style` w postaci CSSOM (`a: b; c: d;`). */
function normalizedHtml(root: Element): string {
  const copy = root.cloneNode(true) as Element;
  for (const element of Array.from(copy.querySelectorAll<HTMLElement>("[style]"))) {
    const css = element.style.cssText;
    if (css) element.setAttribute("style", css);
    else element.removeAttribute("style");
  }
  return copy.innerHTML.replace(/<!--[\s\S]*?-->/g, "");
}

describe.each(SITES)("contentIcon w renderze czysto klienckim (SPA, kanwa): $id", (site) => {
  it("pierwszy commit rezerwuje pudełko gotowej ikony, HTML końcowy = serwera", async () => {
    const name = "alarm-clock-check";
    const html = await serverHtml(site, name);
    const browser = await browserModules();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);

    // Synchroniczny `act`: commit i efekty, ale porcja danych jeszcze w drodze.
    act(() => {
      root.render(<Holder render={() => site.element(browser, name)} />);
    });
    expect(container.querySelector(ICON_SELECTOR[name])).toBeNull();
    const placeholders = Array.from(
      container.querySelectorAll<HTMLElement>('span[aria-hidden="true"]'),
    ).filter((span) => span.style.display === "inline-block");
    expect(placeholders, "rezerwacja Suspense DynamicIcon").toHaveLength(1);
    const reserved = boxOf(placeholders[0]);

    // Porcja danych (i moduł `DynamicIconChunk`) w drodze - czekamy na ikonę.
    for (let i = 0; i < 100 && !container.querySelector(ICON_SELECTOR[name]); i += 1) {
      await settle();
    }
    const final = container.querySelector(ICON_SELECTOR[name]);
    expect(final, "ikona po porcji danych").not.toBeNull();
    expect(h.reads).toBeGreaterThan(0);
    expect(reserved).toEqual(boxOf(final!));
    expect(reserved.width).toBeGreaterThan(0);
    // HTML końcowy = HTML serwera (style inline: serwer pisze tekstem,
    // przeglądarka przez CSSOM - porównanie po normalizacji).
    const serverDom = document.createElement("div");
    serverDom.innerHTML = html;
    expect(normalizedHtml(container)).toBe(normalizedHtml(serverDom));
    expect(consoleError).not.toHaveBeenCalled();
  });
});
