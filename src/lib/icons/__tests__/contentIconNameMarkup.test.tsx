// Bramka wierności ikon wybieranych PO NAZWIE z treści CMS (D4, roadmapa §9.1).
//
// CO PILNUJEMY. Siedem miejsc publicznego renderu bierze nazwę ikony z treści
// (dokument strony albo `site_settings`) i szuka jej wśród eksportów
// `@/lib/lucide-shim`: separator z ikoną, oś czasu (ikona wpisu i ikona
// tytułu), pasek „hot topic", newsletter w wariancie z ikoną, nagłówek,
// przycisk i pasek ogłoszeń. Do 16.11.2026 robiły to przez
// `import * as ... from "@/lib/lucide-shim"` z dynamicznym indeksem, co
// trzymało obiekt przestrzeni nazw (wszystkie ikony shimu) w chunku startowym.
// Zamiana tego wyszukiwania NIE może zmienić HTML-a dla żadnej nazwy, którą
// dokument może zawierać.
//
// DZIEDZINA NAZW (to, co redakcja i dane mogą tam zapisać):
//   * każdy eksport shimu (PascalCase) - oś czasu ma pole tekstowe, a migracje
//     treści wpisują nazwy ręcznie (np. `"iconName": "Send"`);
//   * każda nazwa z pickera `LucideIconPicker` (kebab-case, 1 703 nazwy z
//     `iconNames.generated.json`) - tak zapisują pola schematu typu „icon";
//   * opcje listy ikon paska ogłoszeń z `ThemeOptionsPane` i wartości
//     domyślne z rejestru widgetów;
//   * nazwy na granicy: pusta, ze spacją, inna wielkość liter, nieznana.
// Nazwy kluczy prototypu obiektu (`constructor`, `toString`...) są poza tą
// bramką celowo: w artefakcie Rolldowna przestrzeń nazw jest zwykłym obiektem
// (`{}` + `defineProperty`), więc taka nazwa zwracała funkcję z prototypu
// i wywracała render; zachowanie po zmianie opisuje test resolwera.
//
// FORMA DOWODU. Plik referencyjny `__snapshots__/contentIconNameMarkup.txt`
// powstał na kodzie SPRZED zmiany (commit bazowy gałęzi). Dla każdego miejsca
// zapisuje pełny HTML przy nazwie nieznanej (zastępnik), listę nazw, których
// HTML się od niego różni, i skrót SHA-256 z par (nazwa, HTML) tych nazw.
// Nazwa spoza listy MUSI dać HTML zastępnika co do bajtu - test to sprawdza
// dla każdej nazwy dziedziny. Zgodność pliku po zmianie = ten sam HTML dla
// każdej nazwy z dziedziny.
//
// Render: `renderToStaticMarkup`, czyli ścieżka serwera; rejestr leniwych
// widgetów -> lustro eager (jak w `chromeWidgetViewParity.test.tsx`).
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as ShimNamespace from "@/lib/lucide-shim";
import pickerIconNames from "@/lib/icons/iconNames.generated.json";
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

/** Nazwy kluczy prototypu - poza dziedziną (patrz nagłówek pliku). */
const PROTOTYPE_KEYS = new Set(Object.getOwnPropertyNames(Object.prototype));

const SHIM_NAMES = Object.keys(ShimNamespace).sort();
const PICKER_NAMES = (pickerIconNames as string[]).filter((k) => /^[a-z0-9-]+$/.test(k)).sort();
// `ThemeOptionsPane` (pole „Ikona" paska ogłoszeń): stała lista opcji.
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
// Wartości domyślne rejestru/szablonów, podpowiedzi edytora osi czasu
// („Flag, FileText, Clock…") i nazwy zapisane przez migracje treści.
const KNOWN_CONTENT_NAMES = ["Star", "FileText", "Flag", "Flame", "Mail", "Send", "Clock"];
const BOUNDARY_NAMES = [
  "",
  " ",
  " Star",
  "Star ",
  "star",
  "STAR",
  "fileText",
  "file-text",
  "Lucide",
  "NieMaTakiejIkony",
  "default",
  "__esModule",
];
const UNKNOWN = "NieMaTakiejIkony";

const DOMAIN = [
  ...new Set([
    ...SHIM_NAMES,
    ...PICKER_NAMES,
    ...ALERT_BAR_EDITOR_VALUES,
    ...KNOWN_CONTENT_NAMES,
    ...BOUNDARY_NAMES,
  ]),
]
  .filter((n) => !PROTOTYPE_KEYS.has(n))
  .sort();

function widgetMarkup(type: WidgetType, content: Record<string, unknown>): string {
  const node: WidgetNode = {
    // Stały identyfikator: HTML zawiera `data-w-id`, a test porównuje bajty.
    id: `w-icon-${type}`,
    kind: "widget",
    type,
    content: content as WidgetContent,
  };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <WidgetView node={node} lang="pl" device="desktop" editable={false} />
    </QueryClientProvider>,
  );
}

function alertBarMarkup(icon: string, style = "brand"): string {
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
  return renderToStaticMarkup(<AlertBar />);
}

interface Site {
  id: string;
  render: (name: string) => string;
}

const SITES: Site[] = [
  {
    id: "divider (wariant z ikoną)",
    render: (n) => widgetMarkup("divider", { variant: "icon", iconName: n }),
  },
  {
    id: "timeline (ikona wpisu)",
    render: (n) =>
      widgetMarkup("timeline", {
        entries: [{ type: "item", iconType: "lucide", iconName: n, title_pl: "Wpis" }],
      }),
  },
  {
    id: "timeline (ikona tytułu)",
    render: (n) =>
      widgetMarkup("timeline", {
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
    render: (n) => widgetMarkup("hot-topic-bar", { title_pl: "Temat dnia", iconName: n }),
  },
  {
    id: "newsletter (wariant icon)",
    render: (n) =>
      widgetMarkup("newsletter", { variant: "icon", title_pl: "Newsletter", iconName: n }),
  },
  {
    id: "heading",
    render: (n) => widgetMarkup("heading", { text_pl: "Nagłówek", tag: "h2", iconName: n }),
  },
  {
    id: "button",
    render: (n) => widgetMarkup("button", { label_pl: "Przycisk", href: "/kontakt", iconName: n }),
  },
  { id: "alert-bar", render: (n) => alertBarMarkup(n) },
];

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Opis jednego miejsca: zastępnik, nazwy dające inny HTML i ich skrót. */
function describeSite(site: Site): string {
  const fallback = site.render(UNKNOWN);
  const resolving: string[] = [];
  const digest = createHash("sha256");
  for (const name of DOMAIN) {
    const html = site.render(name);
    if (html === fallback) continue;
    resolving.push(name);
    digest.update(`${JSON.stringify(name)}\u0000${html}\u0000`);
  }
  return [
    `## ${site.id}`,
    `zastępnik: ${fallback}`,
    `nazwy z innym HTML (${resolving.length}): ${resolving.map((n) => JSON.stringify(n)).join(" ")}`,
    `sha256: ${digest.digest("hex")}`,
  ].join("\n");
}

describe("ikony z treści CMS: HTML identyczny dla każdej nazwy, którą dokument może zawierać", () => {
  it("dziedzina obejmuje eksporty shimu, nazwy pickera i listy edytorów", () => {
    expect(SHIM_NAMES.length).toBeGreaterThan(100);
    expect(PICKER_NAMES.length).toBeGreaterThan(1000);
    for (const n of [...ALERT_BAR_EDITOR_VALUES, ...KNOWN_CONTENT_NAMES]) {
      expect(DOMAIN).toContain(n);
    }
  });

  it("HTML każdego miejsca zgadza się z plikiem referencyjnym sprzed zmiany", async () => {
    const sections = SITES.map(describeSite);
    // Pasek ogłoszeń w trybie „auto": nazwa wynika ze stylu paska.
    const autoRows = ["brand", "info", "warning", "success", "nieznany"].map(
      (style) => `auto/${style}: ${sha256(alertBarMarkup("auto", style))}`,
    );
    sections.push(["## alert-bar (auto wg stylu)", ...autoRows].join("\n"));
    // Ikona formatu wpisu na liście z ocenami: stała mapa formatu na nazwę.
    const formatRows = [
      "standard",
      "video",
      "gallery",
      "audio",
      "quote",
      "link",
      "",
      "nieznany",
    ].map(
      (format) =>
        `${JSON.stringify(format)}: ${sha256(
          widgetMarkup("rated-list", {
            showPostFormat: true,
            items: [{ title_pl: "Pozycja", rating: 7, format }],
          }),
        )}`,
    );
    sections.push(["## rated-list (ikona formatu wpisu)", ...formatRows].join("\n"));
    await expect(`${sections.join("\n\n")}\n`).toMatchFileSnapshot(
      "./__snapshots__/contentIconNameMarkup.txt",
    );
  });
});
