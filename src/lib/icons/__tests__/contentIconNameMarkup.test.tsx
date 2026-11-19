// Bramka wierności ikon wybieranych PO NAZWIE z treści CMS (naprawa
// wybieraków ikon, 16.11.2026).
//
// CO PILNUJEMY. Osiem miejsc publicznego renderu bierze nazwę ikony z treści
// (dokument strony albo `site_settings`): separator z ikoną, oś czasu (ikona
// wpisu i ikona tytułu), pasek „hot topic", newsletter w wariancie z ikoną,
// nagłówek, przycisk i pasek ogłoszeń. Do 16.11.2026 szukały jej przez
// `import * as ... from "@/lib/lucide-shim"` z dynamicznym indeksem, więc
// rozpoznawały WYŁĄCZNIE eksporty shimu (PascalCase), a wybieraki ikon
// zapisują nazwy kebab-case z pełnego katalogu - wybrana ikona nigdy się nie
// pokazywała. Naprawa NIE może zmienić niczego, co renderuje się dziś.
//
// DWA PLIKI REFERENCYJNE:
//  * `__snapshots__/contentIconNameMarkup.baza.txt` - HTML Z KODU BAZOWEGO
//    (57af436c, przed naprawą), zapisany raz (`IKONY_WZORZEC=zapisz`). Dla
//    każdego miejsca: pełny HTML zastępnika (nazwa nieznana) i - dla każdej
//    nazwy z dziedziny, która dawała HTML inny niż zastępnik - skrót SUROWEGO
//    HTML-a (bez żadnej normalizacji) i skrót samych `<svg>`. Nie wolno go
//    regenerować po zmianie: to jest „stare" w porównaniu.
//  * `__snapshots__/contentIconNameMarkup.zmiany.txt` - JAWNA lista
//    zamierzonych różnic (nazwy z HTML-em innym niż na bazie), utrzymywana
//    przez `toMatchFileSnapshot` (na bazie: puste listy).
//
// REGUŁY PORÓWNANIA (dla każdego miejsca i każdej nazwy dziedziny):
//  1. nazwa, która na bazie renderowała ikonę: HTML po zmianie jest bajt w bajt
//     ten sam - bez nowej granicy Suspense i bez nowego atrybutu;
//  2. nazwa, która na bazie dawała zastępnik: po zmianie daje zastępnik co do
//     bajtu ALBO jest wymieniona w pliku zamierzonych różnic;
//  3. klucze prototypu obiektu: zawsze zastępnik co do bajtu.
//
// PRZERYSOWANIE LUCIDE 1.x (zgoda właściciela, 19.11.2026). Aktualizacja
// lucide-react 0.577 -> 1.x zmienia WYŁĄCZNIE wnętrze `<svg>` (ścieżki glifu)
// i listę klas `lucide-*` części ikon. Plik `__snapshots__/
// contentIconNameMarkup.lucide1.json` (zamrożony, z obu wersji pakietu) mapuje
// klasy `lucide-*` z 1.x na klasy i glif z 0.577. Reguła 1 i porównanie
// zastępnika przyjmują HTML, który PO cofnięciu tej mapy jest bajt w bajt
// równy bazie - dowód, że układ, atrybuty, wymiary i granice Suspense są
// nietknięte. Mapa obowiązuje tylko dla dokładnie tego nowego glifu.
//
// Render: `renderToString` (nie `renderToStaticMarkup`), więc znaczniki granic
// Suspense (`<!--$-->`) są częścią porównywanego HTML-a. Nazwy idące przez
// leniwą porcję katalogu są przed porównaniem „rozgrzane" renderem
// strumieniowym (`allReady`), tak jak serwer czeka na tę porcję - inaczej
// `renderToString` oddałby zastępnik granicy zamiast ikony.
// Rejestr leniwych widgetów -> lustro eager (jak w `chromeWidgetViewParity`).
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToReadableStream, renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as ShimNamespace from "@/lib/lucide-shim";
import catalogIconNames from "@/lib/icons/iconNames.generated.json";
import { WidgetView } from "@/components/builder/organisms/WidgetView";
import type { WidgetContent, WidgetNode, WidgetType } from "@/lib/builder/types";

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

// Pasek ogłoszeń czyta konfigurację z `site_settings.theme_options`; test
// podaje ją wprost (ta sama postać, którą zapisuje `ThemeOptionsPane`).
const alertBarSetting = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock("@/lib/useSiteSetting", () => ({
  useSiteSetting: (key: string, fallback: unknown) =>
    key === "theme_options" ? { header: { alert_bar: alertBarSetting.current } } : fallback,
}));

const { AlertBar } = await import("@/components/AlertBar");

const BASE_FILE = resolve(__dirname, "__snapshots__/contentIconNameMarkup.baza.txt");
const WRITE_BASE = process.env.IKONY_WZORZEC === "zapisz";
const LUCIDE1_FILE = resolve(__dirname, "__snapshots__/contentIconNameMarkup.lucide1.json");
/** Tryb zbierania klas `lucide-*` do zbudowania mapy (`IKONY_LUCIDE1=klucze`). */
const LUCIDE1_KEYS_OUT = process.env.IKONY_LUCIDE1 === "klucze" ? "/tmp/lucide1-keys.json" : null;

// ---------- dziedzina nazw ----------

/** Eksporty shimu (PascalCase) - jedyne nazwy, które baza rozpoznawała. */
const SHIM_NAMES = Object.keys(ShimNamespace).sort();
/** Katalog wybieraka `LucideIconPicker` (kebab-case) - tak zapisują pola typu „icon". */
const CATALOG_NAMES = [...(catalogIconNames as string[])].sort();
// `ThemeOptionsPane` (pole „Ikona" paska ogłoszeń): stała lista opcji
// (typ `AlertIcon`; komponent nie eksportuje jej jako wartości).
const ALERT_BAR_EDITOR_VALUES = [
  "auto",
  "none",
  "Megaphone",
  "Bell",
  "Info",
  "AlertTriangle",
  "Check",
  "Sparkles",
  "Flame",
  "Mail",
];
// Wartości domyślne rejestru i szablonów (`registry.tsx`, `homepageTemplate.ts`,
// `TimelineEditor`), podpowiedzi pól tekstowych osi czasu i schematów
// („Flag, FileText, Clock…", „Mail, Send, BellRing, Inbox…") i nazwy wpisane
// przez migracje treści (`"iconName": "Send"`, `"Mail"`, `"Flame"`).
const DEFAULT_AND_EDITOR_HINT_NAMES = [
  "Star",
  "FileText",
  "Flag",
  "Flame",
  "Mail",
  "Send",
  "Clock",
  "ArrowRight",
  "BellRing",
  "Inbox",
  "Zap",
  "ChevronRight",
  "ExternalLink",
  "Sparkles",
  "AlertTriangle",
];
const BOUNDARY_NAMES = [
  "",
  " ",
  " Star",
  "Star ",
  "star",
  "STAR",
  "fileText",
  "file-text",
  "FILE-TEXT",
  "file_text",
  "Filetext",
  "Lucide",
  "NieMaTakiejIkony",
  "nie-ma-takiej-ikony",
  "default",
  "__esModule",
  "Home",
  "home",
  "house",
  "Redo2",
  "Undo2",
  "redo-2",
  "MoreHorizontal",
  "more-horizontal",
  "AlarmClockCheck",
  "alarm-clock-check",
  "grid-2x2",
  "x",
  "X",
  "-",
  "a--b",
  "-star",
  "star-",
  "Ⅻ",
  "<script>",
  'x" onload="',
];
/** Klucze prototypu obiektu (`constructor`, `toString`, `__proto__`...). */
const PROTOTYPE_KEYS = Object.getOwnPropertyNames(Object.prototype).sort();
const UNKNOWN = "NieMaTakiejIkony";

const DOMAIN = [
  ...new Set([
    ...SHIM_NAMES,
    ...CATALOG_NAMES,
    ...ALERT_BAR_EDITOR_VALUES,
    ...DEFAULT_AND_EDITOR_HINT_NAMES,
    ...BOUNDARY_NAMES,
    ...PROTOTYPE_KEYS,
  ]),
].sort();

// ---------- render miejsc ----------

function widgetElement(type: WidgetType, content: Record<string, unknown>): ReactElement {
  const node: WidgetNode = {
    // Stały identyfikator: HTML zawiera `data-w-id`, a test porównuje bajty.
    id: `w-icon-${type}`,
    kind: "widget",
    type,
    content: content as WidgetContent,
  };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <WidgetView node={node} lang="pl" device="desktop" editable={false} />
    </QueryClientProvider>
  );
}

function alertBarElement(icon: string, style = "brand"): ReactElement {
  alertBarSetting.current = {
    enabled: true,
    message_pl: "Komunikat",
    message_en: "Notice",
    link_url: "",
    style,
    dismissible: true,
    icon,
    cta_label_pl: "",
    cta_label_en: "",
  };
  return <AlertBar />;
}

interface Site {
  id: string;
  element: (name: string) => ReactElement;
}

const SITES: Site[] = [
  {
    id: "divider (wariant z ikoną)",
    element: (n) => widgetElement("divider", { variant: "icon", iconName: n }),
  },
  {
    id: "timeline (ikona wpisu)",
    element: (n) =>
      widgetElement("timeline", {
        entries: [{ type: "item", iconType: "lucide", iconName: n, title_pl: "Wpis" }],
      }),
  },
  {
    id: "timeline (ikona tytułu)",
    element: (n) =>
      widgetElement("timeline", {
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
    element: (n) => widgetElement("hot-topic-bar", { title_pl: "Temat dnia", iconName: n }),
  },
  {
    id: "newsletter (wariant icon)",
    element: (n) =>
      widgetElement("newsletter", { variant: "icon", title_pl: "Newsletter", iconName: n }),
  },
  {
    id: "heading",
    element: (n) => widgetElement("heading", { text_pl: "Nagłówek", tag: "h2", iconName: n }),
  },
  {
    id: "button",
    element: (n) =>
      widgetElement("button", { label_pl: "Przycisk", href: "/kontakt", iconName: n }),
  },
  { id: "alert-bar", element: (n) => alertBarElement(n) },
];

/** Render odporny na wyjątek: nazwa wywracająca render to też wynik. */
function safeRender(site: Site, name: string): string {
  try {
    return renderToString(site.element(name));
  } catch (error) {
    return `!błąd: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`;
  }
}

/** Granica, której `renderToString` nie domknął (leniwy moduł w drodze). */
const UNSETTLED = /<!--\$[!?]-->/;

/**
 * HTML serwera dla nazwy: gdy `renderToString` trafi na leniwą porcję
 * katalogu, która jeszcze nie przyszła, render strumieniowy czeka na wszystkie
 * granice (jak serwer), a kolejny `renderToString` jest już synchroniczny.
 * Na bazie nic tu nie czeka.
 */
async function serverMarkup(site: Site, name: string): Promise<string> {
  const first = safeRender(site, name);
  if (!UNSETTLED.test(first)) return first;
  try {
    const stream = await renderToReadableStream(site.element(name), { onError: () => {} });
    await stream.allReady;
    await stream.cancel();
  } catch {
    // Błąd renderu zapisze `safeRender`.
  }
  return safeRender(site, name);
}

// ---------- skróty ----------

/** Same elementy `<svg>` (geometria, klasy, wymiary, kreska) - opis glifu. */
function svgDescriptor(html: string): string {
  return (html.match(/<svg\b[\s\S]*?<\/svg>/g) ?? []).join("\n");
}

function sha(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 12);
}

/** Krótki opis HTML-u nazwy, która zmieniła się względem bazy. */
function describeHtml(html: string): string {
  if (html.startsWith("!błąd")) return html;
  const suspense = /<!--\$[!?]?-->/.test(html) ? "Suspense" : "sync";
  const svgs = html.match(/<svg\b[^>]*>/g) ?? [];
  const classes = svgs
    .map((svg) =>
      (/class="([^"]*)"/.exec(svg)?.[1] ?? "")
        .split(/\s+/)
        .filter((token) => token.startsWith("lucide-"))
        .join("+"),
    )
    .join(",");
  const missing = /data-dyn-missing=/.test(html) ? " +brak-w-katalogu" : "";
  return `[${suspense}${missing} ${classes || "bez-svg"}]`;
}

// ---------- przerysowanie Lucide 1.x ----------

interface Lucide1Redraw {
  /** Klasy `lucide lucide-*` tej ikony w 0.577. */
  oldClass: string;
  /** Wnętrze `<svg>` w 0.577. */
  oldInner: string;
  /** Wnętrze `<svg>` w 1.x - mapa działa tylko dla dokładnie tego glifu. */
  newInner: string;
}

const LUCIDE1: Readonly<Record<string, Lucide1Redraw>> = existsSync(LUCIDE1_FILE)
  ? (JSON.parse(readFileSync(LUCIDE1_FILE, "utf8")) as Record<string, Lucide1Redraw>)
  : {};
const lucide1Keys = new Set<string>();

/** Rozdziela atrybut `class` na prefiks klas lucide i klasy miejsca. */
function splitLucideClass(value: string): { lucide: string; rest: string[] } {
  const tokens = value.split(" ");
  let end = 0;
  while (end < tokens.length && (tokens[end] === "lucide" || tokens[end].startsWith("lucide-"))) {
    end += 1;
  }
  return { lucide: tokens.slice(0, end).join(" "), rest: tokens.slice(end) };
}

/** HTML z glifami 1.x cofniętymi do 0.577 wg zamrożonej mapy. */
function asLucide0(html: string): string {
  return html.replace(
    /<svg\b([^>]*?) class="([^"]*)"([^>]*)>([\s\S]*?)<\/svg>/g,
    (whole, before: string, cls: string, after: string, inner: string) => {
      const { lucide, rest } = splitLucideClass(cls);
      if (LUCIDE1_KEYS_OUT && lucide) lucide1Keys.add(lucide);
      const redraw = Object.prototype.hasOwnProperty.call(LUCIDE1, lucide)
        ? LUCIDE1[lucide]
        : undefined;
      if (!redraw || redraw.newInner !== inner) return whole;
      const oldClass = [redraw.oldClass, ...rest].join(" ");
      return `<svg${before} class="${oldClass}"${after}>${redraw.oldInner}</svg>`;
    },
  );
}

// ---------- plik bazowy ----------

interface BaseSite {
  fallback: string;
  /** nazwa -> [skrót HTML-a, skrót SVG] dla nazw z HTML-em innym niż zastępnik. */
  resolving: Map<string, [string, string]>;
}

async function describeSiteForBase(site: Site): Promise<string> {
  const fallback = await serverMarkup(site, UNKNOWN);
  const rows: string[] = [];
  for (const name of DOMAIN) {
    const html = await serverMarkup(site, name);
    if (html === fallback) continue;
    rows.push(`${JSON.stringify(name)} ${sha(html)} ${sha(svgDescriptor(html))}`);
  }
  return [`## ${site.id}`, `zastępnik: ${fallback}`, ...rows].join("\n");
}

const EXTRA_SECTION = "alert-bar (auto wg stylu)";

/** Pasek ogłoszeń w trybie „auto": nazwa ikony wynika ze stylu paska. */
function alertBarAutoRows(): string[] {
  return ["brand", "info", "warning", "success", "nieznany", "constructor"].map(
    (style) => `auto/${style} ${sha(asLucide0(renderToString(alertBarElement("auto", style))))}`,
  );
}

function parseBase(text: string): { sites: Map<string, BaseSite>; extra: string[] } {
  const sites = new Map<string, BaseSite>();
  const extra: string[] = [];
  let current: BaseSite | null = null;
  let inExtra = false;
  for (const line of text.split("\n")) {
    if (line.startsWith("## ")) {
      const id = line.slice(3);
      inExtra = id === EXTRA_SECTION;
      current = inExtra ? null : { fallback: "", resolving: new Map() };
      if (current) sites.set(id, current);
      continue;
    }
    if (!line.trim() || line.startsWith("# ")) continue;
    if (inExtra) {
      extra.push(line);
      continue;
    }
    if (!current) continue;
    if (line.startsWith("zastępnik: ")) {
      current.fallback = line.slice("zastępnik: ".length);
      continue;
    }
    const match = /^(".*") ([0-9a-f]{12}) ([0-9a-f]{12})$/.exec(line);
    if (!match) throw new Error(`Nieczytelny wiersz pliku bazowego: ${line}`);
    current.resolving.set(JSON.parse(match[1]) as string, [match[2], match[3]]);
  }
  return { sites, extra };
}

const HEADER =
  "# Wzorzec HTML ikon z treści CMS - kod bazowy 57af436c (przed naprawą wybieraków ikon).\n" +
  "# Wiersz: nazwa, skrót surowego HTML-u, skrót samych <svg>. Nie regenerować po zmianie.";

describe("ikony z treści CMS: HTML każdego miejsca wobec kodu bazowego", () => {
  it("dziedzina obejmuje eksporty shimu, katalog wybieraka, listy edytorów i klucze prototypu", () => {
    expect(SHIM_NAMES.length).toBe(134);
    expect(CATALOG_NAMES.length).toBeGreaterThan(1000);
    for (const n of [
      ...ALERT_BAR_EDITOR_VALUES,
      ...DEFAULT_AND_EDITOR_HINT_NAMES,
      ...PROTOTYPE_KEYS,
      "",
    ]) {
      expect(DOMAIN).toContain(n);
    }
  });

  it("nazwy z bazy renderują to samo, reszta daje zastępnik albo jest zamierzoną różnicą", async () => {
    if (WRITE_BASE) {
      const sections: string[] = [];
      for (const site of SITES) sections.push(await describeSiteForBase(site));
      const body = [...sections, [`## ${EXTRA_SECTION}`, ...alertBarAutoRows()].join("\n")].join(
        "\n\n",
      );
      writeFileSync(BASE_FILE, `${HEADER}\n\n${body}\n`);
    }
    const base = parseBase(readFileSync(BASE_FILE, "utf8"));
    if (LUCIDE1_KEYS_OUT) {
      // Tylko zbiór klas `lucide-*` w HTML-u nazw z bazy, zastępników i trybu „auto".
      for (const site of SITES) {
        const ref = base.sites.get(site.id);
        asLucide0(await serverMarkup(site, UNKNOWN));
        for (const name of ref?.resolving.keys() ?? []) asLucide0(await serverMarkup(site, name));
      }
      alertBarAutoRows();
      writeFileSync(LUCIDE1_KEYS_OUT, JSON.stringify([...lucide1Keys].sort()));
      return;
    }
    const changes: string[] = [];
    for (const site of SITES) {
      const ref = base.sites.get(site.id);
      expect(ref, site.id).toBeDefined();
      if (!ref) continue;
      const fallback = await serverMarkup(site, UNKNOWN);
      expect(asLucide0(fallback), `${site.id}: zastępnik`).toBe(ref.fallback);

      const broken: string[] = [];
      const changed = new Map<string, string>();
      for (const name of DOMAIN) {
        const html = await serverMarkup(site, name);
        const old = ref.resolving.get(name);
        if (old) {
          // Reguła 1: bajt w bajt to samo co na bazie.
          const [oldHtml, oldSvg] = old;
          const nowSvg = sha(svgDescriptor(html));
          if (sha(html) !== oldHtml && sha(asLucide0(html)) !== oldHtml) {
            broken.push(
              `${JSON.stringify(name)}: HTML ${oldHtml} -> ${sha(html)}` +
                (nowSvg === oldSvg ? " (glif ten sam)" : ` (glif ${oldSvg} -> ${nowSvg})`),
            );
          }
          continue;
        }
        if (html === ref.fallback || asLucide0(html) === ref.fallback) continue;
        if (PROTOTYPE_KEYS.includes(name)) {
          // Reguła 3: klucz prototypu nigdy nie jest ikoną.
          broken.push(`${JSON.stringify(name)}: klucz prototypu nie dał zastępnika`);
          continue;
        }
        changed.set(name, html);
      }
      expect(broken, `${site.id}: nazwy, których render się zmienił`).toEqual([]);
      changes.push(describeChanges(site.id, changed));
    }
    // Pasek ogłoszeń w trybie „auto" - bez zmian.
    expect(alertBarAutoRows()).toEqual(base.extra);
    await expect(`${changes.join("\n\n")}\n`).toMatchFileSnapshot(
      "./__snapshots__/contentIconNameMarkup.zmiany.txt",
    );
    // ~1900 nazw x 8 miejsc, z czego nazwy katalogu czekają na porcję danych
    // renderem strumieniowym - kilkanaście tysięcy renderów.
  }, 300_000);
});

/**
 * Zamierzone różnice jednego miejsca w zwięzłej, ale jawnej postaci: nazwy
 * katalogu policzone wg drogi renderu (z listą tych, które NIE zmieniły HTML-u),
 * reszta wprost, każda z opisem tego, co renderuje teraz.
 */
function describeChanges(siteId: string, changed: Map<string, string>): string {
  const catalog = new Set(CATALOG_NAMES);
  const catalogUnchanged = CATALOG_NAMES.filter((n) => !changed.has(n));
  const catalogChanged = CATALOG_NAMES.filter((n) => changed.has(n));
  const byKind = new Map<string, number>();
  for (const name of catalogChanged) {
    const html = changed.get(name) ?? "";
    const kind = html.startsWith("!błąd")
      ? "błąd"
      : /data-dyn-missing=/.test(html)
        ? "brak w katalogu"
        : /<!--\$[!?]?-->/.test(html)
          ? "porcja katalogu (Suspense)"
          : "synchronicznie: zestaw kuratorowany albo eksport shimu";
    byKind.set(kind, (byKind.get(kind) ?? 0) + 1);
  }
  const other = [...changed.keys()].filter((n) => !catalog.has(n)).sort();
  return [
    `## ${siteId}`,
    `nazwy katalogu z nowym HTML-em: ${catalogChanged.length} z ${CATALOG_NAMES.length} (${[
      ...byKind,
    ]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([kind, count]) => `${kind}: ${count}`)
      .join(", ")})`,
    `nazwy katalogu bez zmiany HTML (${catalogUnchanged.length}): ${catalogUnchanged
      .map((n) => JSON.stringify(n))
      .join(" ")}`,
    `inne nazwy z nowym HTML-em (${other.length}):`,
    ...other.map((n) => `  ${JSON.stringify(n)} ${describeHtml(changed.get(n) ?? "")}`),
  ].join("\n");
}
