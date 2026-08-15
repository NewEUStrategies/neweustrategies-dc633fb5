// BRAMKA WIERNOŚCI USTAWIEŃ: każde pole panelu jest czytane przez renderer,
// a każde ustawienie czytane przez renderer jest edytowalne w panelu.
//
// DLACZEGO BRAMKA, A NIE KOLEJNY TEST PUNKTOWY
// PR #141 naprawił ~40 martwych i kłamliwych ustawień widgetów, ale przypiął je
// testami punktowymi ("karuzela ma autoplay", "akordeon ma warianty"). Klasa
// defektu - PANEL OBIECUJE, RENDERER NIE CZYTA (i odwrotnie) - została otwarta:
// następny widget mógł ją wprowadzić od nowa i nic by nie zapłonęło. Metryka
// "100% pokrycia rejestru" jest na tę klasę całkowicie odporna, bo widget
// istnieje i renderuje się - kłamią pojedyncze pola.
//
// JAK TO JEST MIERZONE
// Treść widgetu wjeżdża w Proxy notujące odczyty (`trackContentReads`).
// Ten sam widget renderujemy dwa razy, na próbkach z tego samego generatora:
//   PANEL    -> `WidgetContentFields` (zakładka "Treść") = klucze OFEROWANE,
//   RENDERER -> `WidgetView` w trybie publicznym = klucze CZYTANE przy renderze.
// Porównujemy DOKŁADNE klucze magazynowe (`items` ≠ `items_pl`), domknięte o
// rodzeństwo językowe, na próbkach pokrywających każdą opcję pól rozgałęziających.
//
// RAPORT DIAGNOSTYCZNY: `bun run check:widget-fidelity` (albo
// `FIDELITY_REPORT=1 npx vitest run …settingsFidelity`) wypisuje pełną tabelę
// rozjazdów, także zwolnionych - to narzędzie do podłączania nowego widgetu,
// nie tylko do czytania porażki CI.
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Device, WidgetContent, WidgetNode, WidgetType } from "@/lib/builder/types";
import { WIDGETS } from "@/lib/builder/registry";
import { WIDGET_SCHEMAS, type SchemaField } from "@/lib/builder/schemas";
import {
  applyWaivers,
  contentProbes,
  diffFidelity,
  schemaStorageKeys,
  trackContentReads,
  unreachableSchemaFields,
  withLangSiblings,
  type ContentProbe,
  type WidgetProbeState,
} from "@/lib/builder/ci/settingsFidelity";
import {
  FIDELITY_WAIVERS,
  RENDERER_ENUMERATES_CONTENT,
  WIDGET_PROBE_STATES,
} from "@/lib/builder/ci/settingsFidelityGate";
import { CurrentPostProvider, type CurrentPostCtx } from "@/lib/content-model/postContext";

// Podział kodu (`React.lazy`) zamieniony na importy statyczne. Bez tego pierwszy
// render 33 widgetów pokazuje fallback Suspense, a ich odczyty treści nigdy nie
// zdążą się wydarzyć - bramka zobaczyłaby "wszystkie ustawienia martwe" tam,
// gdzie w produkcji SSR wypełnia boundary i widget renderuje się normalnie.
vi.mock(
  "@/components/builder/organisms/widget-view/lazyWidgets",
  () => import("@/test/eagerWidgetChunks"),
);

/**
 * Stan widza przełączany między próbkami.
 *
 * Część widgetów renderuje `null` dla gościa (`tailored-must-reads` z
 * `audience: "auth"`, menu konta, potwierdzenie zakupu), a część - odwrotnie -
 * chowa formularz logowania dla zalogowanego. Pomiar tylko w jednym stanie
 * uznałby ustawienia drugiej gałęzi za martwe, więc bramka mierzy OBA.
 */
const VIEWER = { signedIn: false };

// ImageSlot / PostPicker / SpeakersEditor w panelu wymagają kontekstu tenanta.
vi.mock("@/hooks/useAuth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useAuth")>();
  return {
    ...actual,
    useRequiredTenant: () => "tenant-fidelity-gate",
    useAuth: () =>
      VIEWER.signedIn
        ? {
            session: { access_token: "gate", user: { id: "gate-viewer" } },
            user: { id: "gate-viewer", email: "viewer@example.org", user_metadata: {} },
            roles: [],
            tenantId: "tenant-fidelity-gate",
            loading: false,
            isStaff: false,
            isAdmin: false,
            isSuperAdmin: false,
            signOut: async () => {},
          }
        : {
            session: null,
            user: null,
            roles: [],
            tenantId: "tenant-fidelity-gate",
            loading: false,
            isStaff: false,
            isAdmin: false,
            isSuperAdmin: false,
            signOut: async () => {},
          },
  };
});

// Dane NIEPUSTE - inaczej każdy widget listowy wychodzi wczesnym `return` na
// stanie pustym i jego ustawienia prezentacji (kolumny, autoplay, rozmiary)
// wyglądają na martwe, choć w produkcji działają.
vi.mock("@/integrations/supabase/client", async () => {
  const { UNIVERSAL_ROW, UNIVERSAL_ROWS } = await import("@/test/widgetDataStub");
  type Builder = Record<string, unknown> & { then: (r: (v: unknown) => unknown) => unknown };
  const builder = {} as Builder;
  const chain = [
    "select",
    "eq",
    "neq",
    "is",
    "in",
    "not",
    "gte",
    "lte",
    "gt",
    "lt",
    "order",
    "range",
    "limit",
    "or",
    "filter",
    "contains",
    "overlaps",
    "match",
    "ilike",
    "textSearch",
  ];
  for (const m of chain) (builder as Record<string, unknown>)[m] = vi.fn(() => builder);
  builder.single = vi.fn(async () => ({ data: UNIVERSAL_ROW, error: null }));
  builder.maybeSingle = vi.fn(async () => ({ data: UNIVERSAL_ROW, error: null }));
  builder.then = (resolve2: (v: unknown) => unknown) =>
    resolve2({ data: UNIVERSAL_ROWS, error: null, count: UNIVERSAL_ROWS.length });
  const channel: Record<string, unknown> = {};
  channel.on = vi.fn(() => channel);
  channel.subscribe = vi.fn(() => channel);
  return {
    supabase: {
      from: vi.fn(() => builder),
      rpc: vi.fn(async () => ({ data: UNIVERSAL_ROWS, error: null })),
      channel: vi.fn(() => channel),
      removeChannel: vi.fn(async () => "ok"),
      auth: {
        getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
        getUser: vi.fn(async () => ({ data: { user: null }, error: null })),
        onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: () => {} } } })),
        signInWithPassword: vi.fn(async () => ({ data: {}, error: null })),
        signUp: vi.fn(async () => ({ data: {}, error: null })),
        updateUser: vi.fn(async () => ({ data: {}, error: null })),
        resetPasswordForEmail: vi.fn(async () => ({ data: {}, error: null })),
        signInWithOAuth: vi.fn(async () => ({ data: {}, error: null })),
      },
    },
  };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key,
    i18n: { language: "pl", changeLanguage: () => Promise.resolve() },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("@tanstack/react-router", async (orig) => {
  const actual = await orig<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: ({
      to,
      children,
      ...rest
    }: { to?: unknown; children?: unknown } & Record<string, unknown>) => (
      <a href={typeof to === "string" ? to : "#"} {...rest}>
        {children as never}
      </a>
    ),
  };
});

import { WidgetContentFields, PANEL_EXTRA_CONTENT_KEYS } from "../WidgetProperties";
import { WidgetView } from "@/components/builder/organisms/WidgetView";

/**
 * Realny kontekst wpisu (jak na stronie wpisu) - widgety `post-*` bez kontekstu
 * renderują `null`, więc bez niego ich ustawienia wyglądałyby na martwe.
 * Wartości są jawnie testowe i NIE pochodzą z `PLACEHOLDER_POST_CTX` (tamta
 * próbka nie ma prawa opuścić kanwy - pilnuje tego `sampleDataLeak.gate`).
 */
const GATE_POST_CTX: CurrentPostCtx = {
  kind: "post",
  id: "gate-post",
  slug: "gate-post",
  title_pl: "Wpis bramki",
  title_en: "Gate post",
  excerpt_pl: "Zajawka bramki.",
  excerpt_en: "Gate excerpt.",
  coverUrl: "https://example.org/gate-cover.jpg",
  publishedAt: "2026-01-02T10:00:00.000Z",
  updatedAt: "2026-01-03T10:00:00.000Z",
  readingTimeMin: 7,
  viewCount: 42,
  author: {
    id: "gate-author",
    name: "Gate Author",
    slug: "gate-author",
    avatarUrl: "https://example.org/gate-avatar.jpg",
    bio_pl: "Bio bramki.",
    bio_en: "Gate bio.",
    jobTitle: "Gate role",
    company: "Gate co.",
    contactEmail: "gate@example.org",
    phone: "+48 000 000 000",
    xUrl: "https://x.com/gate",
    linkedinUrl: "https://linkedin.com/in/gate",
    facebookUrl: "https://facebook.com/gate",
    instagramUrl: "https://instagram.com/gate",
    spotifyUrl: "https://open.spotify.com/gate",
    websiteUrl: "https://example.org",
    customSocials: [{ label: "Gate", url: "https://example.org/gate" }],
  },
  categories: [{ slug: "gate-cat", name: "Gate category" }],
  tags: [{ slug: "gate-tag", name: "Gate tag" }],
  breadcrumbs: [{ label: "Start", href: "/" }, { label: "Gate post" }],
  archive: { type: "category", label: "Gate archive", description: "Gate archive desc", count: 9 },
};

/**
 * Minimalny kontekst wpisu: strona bez tytułu, autora i okładki. Odsłania
 * gałęzie zastępcze renderera (`post-title` czyta `fallback_*` tylko wtedy, gdy
 * kontekst nie ma tytułu) - bez niego wyglądałyby na martwe.
 */
const GATE_MINIMAL_CTX: CurrentPostCtx = { kind: "page", id: "gate-page", slug: "gate-page" };

/**
 * Scenariusze widza. Renderer mierzony jest w każdym z nich, bo część widgetów
 * renderuje `null` dla gościa (`tailored-must-reads` z `audience: "auth"`), a
 * część odsłania gałąź zastępczą tylko przy ubogim kontekście.
 */
const VIEWER_SCENARIOS: ReadonlyArray<{
  label: string;
  signedIn: boolean;
  ctx: CurrentPostCtx;
}> = [
  { label: "guest/full-post", signedIn: false, ctx: GATE_POST_CTX },
  { label: "signed-in/full-post", signedIn: true, ctx: GATE_POST_CTX },
  { label: "guest/minimal-page", signedIn: false, ctx: GATE_MINIMAL_CTX },
];

const DEVICE: Device = "desktop";
/** Jeden język na stronę - drugi domykamy przez `withLangSiblings`. */
const PROBE_LANG = "pl";

function newClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: Number.POSITIVE_INFINITY } },
  });
}

function nodeOf(type: WidgetType, content: WidgetContent): WidgetNode {
  return { id: `${type}-fidelity`, kind: "widget", type, content };
}

interface SideReads {
  readonly reads: Set<string>;
  enumerated: boolean;
}

const emptySide = (): SideReads => ({ reads: new Set<string>(), enumerated: false });

/**
 * Klucze, o które panel odpytuje treść (czyli: co redakcja może ustawić).
 *
 * Render serwerowy, nie DOM: kontrolka, która ujawnia ustawienie, czyta jego
 * wartość W TRAKCIE renderu (musi ją pokazać). Efekty i Radix-owy DOM nie
 * dodają nic do zbioru kluczy, a kosztują ~20× więcej czasu na próbkę.
 */
function measurePanel(type: WidgetType, probes: ReadonlyArray<ContentProbe>): SideReads {
  const side = emptySide();
  for (const probe of probes) {
    const { tracked, log } = trackContentReads({ ...probe.content });
    const client = newClient();
    try {
      renderToStaticMarkup(
        <QueryClientProvider client={client}>
          <WidgetContentFields
            widget={nodeOf(type, tracked)}
            lang={PROBE_LANG}
            setContent={() => {}}
          />
        </QueryClientProvider>,
      );
    } finally {
      client.clear();
    }
    for (const key of log.reads) side.reads.add(key);
    if (log.enumerated) side.enumerated = true;
  }
  for (const key of PANEL_EXTRA_CONTENT_KEYS[type] ?? []) side.reads.add(key);
  return side;
}

/** Twardy limit obrotów pętli zdarzeń na próbkę (patrz `settleReads`). */
const SETTLE_PASSES = 8;
/** Ile przebiegów bez nowych odczytów uznajemy za "już nic nie przyjdzie". */
const SETTLE_QUIET_PASSES = 3;

/**
 * Domknięcie odczytów po rozwiązaniu zapytań.
 *
 * Widget listowy czyta ustawienia prezentacji dopiero, gdy ma dane - react-query
 * dostarcza je asynchronicznie, więc pierwszy synchroniczny render widzi stan
 * pusty. Oddajemy kontrolę pętli zdarzeń tak długo, jak zbiór odczytów rośnie,
 * z twardym limitem przebiegów.
 *
 * Świadomie BEZ `await act(async …)`: to drenuje kolejkę Reacta do zera, a
 * widget z pętlą `requestAnimationFrame` (karuzela postępu) przekłada się w niej
 * w nieskończoność - bramka wisiałaby zamiast mierzyć. Aktualizacje stanu poza
 * `act` i tak się aplikują; interesuje nas fakt odczytu, nie zawartość DOM-u.
 */
async function settleReads(log: { reads: ReadonlySet<string> }): Promise<void> {
  let previous = -1;
  let quiet = 0;
  for (let pass = 0; pass < SETTLE_PASSES && quiet < SETTLE_QUIET_PASSES; pass += 1) {
    quiet = log.reads.size === previous ? quiet + 1 : 0;
    previous = log.reads.size;
    await new Promise((r) => setTimeout(r, 0));
  }
}

/**
 * Klucze, które renderer naprawdę czyta, renderując widget publicznie.
 *
 * Render w DOM-ie (nie SSR), bo tu efekty MAJĄ znaczenie: autoplay karuzeli,
 * obserwatory widoczności i subskrypcje typografii czytają treść po
 * zamontowaniu.
 */
async function measureRenderer(
  type: WidgetType,
  probes: ReadonlyArray<ContentProbe>,
): Promise<SideReads> {
  const side = emptySide();
  for (const probe of probes) {
    for (const scenario of VIEWER_SCENARIOS) {
      VIEWER.signedIn = scenario.signedIn;
      const { tracked, log } = trackContentReads({ ...probe.content });
      const client = newClient();
      try {
        render(
          <QueryClientProvider client={client}>
            <CurrentPostProvider value={scenario.ctx}>
              <WidgetView node={nodeOf(type, tracked)} lang={PROBE_LANG} device={DEVICE} />
            </CurrentPostProvider>
          </QueryClientProvider>,
        );
        await settleReads(log);
      } finally {
        cleanup();
        client.clear();
      }
      for (const key of log.reads) side.reads.add(key);
      if (log.enumerated) side.enumerated = true;
    }
  }
  VIEWER.signedIn = false;
  return side;
}

interface WidgetMeasurement {
  readonly type: WidgetType;
  readonly schema: ReadonlyArray<SchemaField>;
  readonly panelProbes: ReadonlyArray<ContentProbe>;
  readonly rendererProbes: ReadonlyArray<ContentProbe>;
  readonly offered: ReadonlySet<string>;
  readonly read: ReadonlySet<string>;
  readonly panelEnumerated: boolean;
  readonly rendererEnumerated: boolean;
  /**
   * Ile kluczy odsłania każdy zadeklarowany stan próbki, licząc od pomiaru bez
   * stanów. Wartość 0 = stan nie daje nic i musi zniknąć z listy.
   */
  readonly stateGains: ReadonlyMap<string, number>;
}

const MEASURED = new Map<WidgetType, WidgetMeasurement>();

/**
 * Rozmiary zbiorów odczytów PER STRONA - do wyceny wkładu stanu próbki.
 *
 * Liczone osobno, nie jako suma: stan bywa użyteczny dokładnie dlatego, że
 * dokłada rendererowi klucz, który panel już oferował (i tak właśnie znika
 * "martwe ustawienie"). W unii obu stron taki wkład byłby niewidoczny.
 */
async function measureSideSizes(
  type: WidgetType,
  defaults: WidgetContent,
  schema: ReadonlyArray<SchemaField>,
  states: ReadonlyArray<WidgetProbeState>,
): Promise<{ panel: number; renderer: number }> {
  const panel = measurePanel(type, contentProbes(defaults, schema, "panel", states));
  const renderer = await measureRenderer(type, contentProbes(defaults, schema, "renderer", states));
  return { panel: panel.reads.size, renderer: renderer.reads.size };
}

async function measureAll(): Promise<void> {
  for (const def of WIDGETS) {
    const schema = WIDGET_SCHEMAS[def.type] ?? [];
    const defaults = def.defaults();
    const states = WIDGET_PROBE_STATES[def.type] ?? [];
    const panelProbes = contentProbes(defaults, schema, "panel", states);
    const rendererProbes = contentProbes(defaults, schema, "renderer", states);
    const panel = measurePanel(def.type, panelProbes);
    const renderer = await measureRenderer(def.type, rendererProbes);

    // Wycena stanów: ile klucz(y) dokłada każdy z nich wobec pomiaru bez stanów.
    // Robiona tylko dla widgetów, które stany deklarują - reszta nic nie płaci.
    const stateGains = new Map<string, number>();
    if (states.length > 0) {
      const base = await measureSideSizes(def.type, defaults, schema, []);
      for (const state of states) {
        const withState = await measureSideSizes(def.type, defaults, schema, [state]);
        stateGains.set(
          state.label,
          withState.panel - base.panel + (withState.renderer - base.renderer),
        );
      }
    }

    MEASURED.set(def.type, {
      type: def.type,
      schema,
      panelProbes,
      rendererProbes,
      offered: withLangSiblings(panel.reads),
      read: withLangSiblings(renderer.reads),
      panelEnumerated: panel.enumerated,
      rendererEnumerated: renderer.enumerated,
      stateGains,
    });
  }
}

function measurementOf(type: WidgetType): WidgetMeasurement {
  const m = MEASURED.get(type);
  if (!m) throw new Error(`Brak pomiaru dla widgetu "${type}" - beforeAll nie dobiegł do końca.`);
  return m;
}

afterEach(cleanup);

beforeAll(async () => {
  await measureAll();
  writeReports();
}, 900_000);

/**
 * Artefakty bramki.
 *
 * JSON leci ZAWSZE - konsumuje go raport zgodności wdrożenia
 * (`scripts/deployment-report.ts`), dokładnie tak jak `reports/i18n-parity.json`.
 * Wersja czytelna dla człowieka tylko pod `FIDELITY_REPORT=1`, bo to narzędzie
 * do podłączania nowego widgetu, nie stały koszt każdego `vitest run`.
 */
function writeReports(): void {
  const unwaived: string[] = [];
  const waived: string[] = [];
  const lines: string[] = [
    `# Raport wierności ustawień widgetów (${WIDGETS.length} typów)`,
    `# MARTWE = panel oferuje, renderer nie czyta · UKRYTE = renderer czyta, panel nie oferuje`,
  ];
  for (const def of WIDGETS) {
    const m = measurementOf(def.type);
    const diff = diffFidelity(m.offered, m.read);
    const waiver = FIDELITY_WAIVERS[def.type];
    for (const key of applyWaivers(diff.dead, waiver?.dead).unexpected) {
      unwaived.push(`${def.type}.dead.${key}`);
    }
    for (const key of applyWaivers(diff.hidden, waiver?.hidden).unexpected) {
      unwaived.push(`${def.type}.hidden.${key}`);
    }
    for (const key of Object.keys(waiver?.dead ?? {})) waived.push(`${def.type}.dead.${key}`);
    for (const key of Object.keys(waiver?.hidden ?? {})) waived.push(`${def.type}.hidden.${key}`);

    if (!diff.dead.length && !diff.hidden.length && !m.rendererEnumerated) continue;
    lines.push(
      `\n### ${def.type}  (próbki: panel ${m.panelProbes.length} / renderer ${m.rendererProbes.length}; spread: ${m.rendererEnumerated})`,
    );
    if (diff.dead.length) lines.push(`  MARTWE  (tylko panel):    ${diff.dead.join(", ")}`);
    if (diff.hidden.length) lines.push(`  UKRYTE  (tylko renderer): ${diff.hidden.join(", ")}`);
  }

  mkdirSync(resolve(process.cwd(), "reports"), { recursive: true });
  writeFileSync(
    resolve(process.cwd(), "reports/widget-fidelity.json"),
    `${JSON.stringify(
      {
        widgets: WIDGETS.length,
        enumeratedRenderers: Object.keys(RENDERER_ENUMERATES_CONTENT).length,
        waived: waived.length,
        unwaived,
      },
      null,
      2,
    )}\n`,
  );
  if (process.env.FIDELITY_REPORT) {
    writeFileSync(resolve(process.cwd(), "reports/widget-fidelity.txt"), `${lines.join("\n")}\n`);
  }
}

describe("pomiar wierności - sanity", () => {
  it("mierzy oba końce dla widgetu o oczywistym kontrakcie", () => {
    const m = measurementOf("heading");
    expect(m.offered.has("text_pl")).toBe(true);
    expect(m.read.has("text_pl")).toBe(true);
    expect(m.offered.size).toBeGreaterThan(5);
    expect(m.read.size).toBeGreaterThan(5);
  });

  it("obejmuje każdy zarejestrowany typ widgetu", () => {
    expect(MEASURED.size).toBe(WIDGETS.length);
  });

  it("każdy widget ze schematem ma co najmniej jedną próbkę wypełnioną", () => {
    for (const def of WIDGETS) {
      expect(measurementOf(def.type).panelProbes.length).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("USTAWIENIA MARTWE: panel oferuje pole, renderer go nie czyta", () => {
  for (const def of WIDGETS) {
    it(`${def.type}`, () => {
      const m = measurementOf(def.type);
      const { dead } = diffFidelity(m.offered, m.read);
      const verdict = applyWaivers(dead, FIDELITY_WAIVERS[def.type]?.dead);
      expect(
        verdict.unexpected,
        `Panel widgetu "${def.type}" oferuje ustawienia, których renderer nigdy nie czyta.\n` +
          `Napraw renderer albo usuń pole ze schematu. Zwolnienie (z powodem) dodaj do\n` +
          `FIDELITY_WAIVERS["${def.type}"].dead w src/lib/builder/ci/settingsFidelityWaivers.ts.`,
      ).toEqual([]);
    });
  }
});

describe("USTAWIENIA UKRYTE: renderer czyta ustawienie, panel go nie oferuje", () => {
  for (const def of WIDGETS) {
    it(`${def.type}`, () => {
      const m = measurementOf(def.type);
      const { hidden } = diffFidelity(m.offered, m.read);
      const verdict = applyWaivers(hidden, FIDELITY_WAIVERS[def.type]?.hidden);
      expect(
        verdict.unexpected,
        `Renderer widgetu "${def.type}" czyta ustawienia, których panel nie pozwala zmienić.\n` +
          `Dodaj pole do WIDGET_SCHEMAS["${def.type}"] albo zwolnij je (z powodem) w\n` +
          `FIDELITY_WAIVERS["${def.type}"].hidden w src/lib/builder/ci/settingsFidelityWaivers.ts.`,
      ).toEqual([]);
    });
  }
});

describe("lista zwolnień nie gnije", () => {
  for (const def of WIDGETS) {
    const waiver = FIDELITY_WAIVERS[def.type];
    if (!waiver) continue;
    it(`${def.type}: każde zwolnienie jest nadal potrzebne`, () => {
      const m = measurementOf(def.type);
      const { dead, hidden } = diffFidelity(m.offered, m.read);
      expect(
        applyWaivers(dead, waiver.dead).stale,
        `Zwolnienia "dead" widgetu "${def.type}" dotyczą pól, które JUŻ są czytane - usuń je.`,
      ).toEqual([]);
      expect(
        applyWaivers(hidden, waiver.hidden).stale,
        `Zwolnienia "hidden" widgetu "${def.type}" dotyczą pól, które JUŻ są w panelu - usuń je.`,
      ).toEqual([]);
    });
  }

  it("zwolnienia opisują wyłącznie istniejące typy widgetów", () => {
    const known = new Set(WIDGETS.map((w) => w.type));
    const unknown = Object.keys(FIDELITY_WAIVERS).filter((t) => !known.has(t as WidgetType));
    expect(unknown, "zwolnienie dla nieistniejącego widgetu").toEqual([]);
  });

  it("stany próbek opisują wyłącznie istniejące typy widgetów", () => {
    const known = new Set(WIDGETS.map((w) => w.type));
    const unknown = Object.keys(WIDGET_PROBE_STATES).filter((t) => !known.has(t as WidgetType));
    expect(unknown, "stan próbki dla nieistniejącego widgetu").toEqual([]);
  });

  it("każdy stan próbki ma etykietę i niepustą łatkę", () => {
    const broken: string[] = [];
    for (const [type, states] of Object.entries(WIDGET_PROBE_STATES)) {
      for (const state of states ?? []) {
        if (!state.label.trim() || Object.keys(state.patch).length === 0) {
          broken.push(`${type}.${state.label || "(bez etykiety)"}`);
        }
      }
    }
    expect(broken).toEqual([]);
  });

  for (const [type, states] of Object.entries(WIDGET_PROBE_STATES)) {
    if (!states?.length) continue;
    it(`${type}: każdy stan próbki naprawdę odsłania nowe klucze`, () => {
      const gains = measurementOf(type as WidgetType).stateGains;
      const useless = [...gains.entries()]
        .filter(([, gain]) => gain <= 0)
        .map(([label]) => label)
        .sort();
      expect(
        useless,
        `Stan próbki, który nie odblokowuje ŻADNEGO klucza po żadnej stronie, jest ślepym\n` +
          `kosztem i sugeruje pokrycie, którego nie ma. Usuń go z WIDGET_PROBE_STATES["${type}"]\n` +
          `albo popraw łatkę tak, żeby faktycznie otwierała gałąź edytora/renderera.`,
      ).toEqual([]);
    });
  }

  it("każde zwolnienie ma niepusty powód", () => {
    const empty: string[] = [];
    for (const [type, waiver] of Object.entries(FIDELITY_WAIVERS)) {
      for (const side of ["dead", "hidden"] as const) {
        for (const [key, reason] of Object.entries(waiver?.[side] ?? {})) {
          if (!reason.trim()) empty.push(`${type}.${side}.${key}`);
        }
      }
    }
    expect(empty).toEqual([]);
  });
});

describe("hurtowy odczyt treści (spread) jest zadeklarowany, nie ukryty", () => {
  it("dokładnie te widgety, o których wiemy, wyliczają całą treść", () => {
    const measured = WIDGETS.filter((d) => measurementOf(d.type).rendererEnumerated)
      .map((d) => d.type)
      .sort();
    const declared = [...Object.keys(RENDERER_ENUMERATES_CONTENT)].sort();
    expect(
      measured,
      "Renderer, który robi `{...content}`, czyta wszystko naraz - bramka nie potrafi\n" +
        "dla niego wykryć martwego ustawienia. Taki widget MUSI być wymieniony (z powodem)\n" +
        "w RENDERER_ENUMERATES_CONTENT, żeby luka w pokryciu była widoczna, nie milcząca.",
    ).toEqual(declared);
  });

  it("panel nigdy nie wylicza treści hurtem", () => {
    const enumerating = WIDGETS.filter((d) => measurementOf(d.type).panelEnumerated).map(
      (d) => d.type,
    );
    expect(
      enumerating,
      "Panel czytający `{...content}` fałszywie 'oferuje' każdy klucz - bramka przestaje mierzyć.",
    ).toEqual([]);
  });
});

describe("osiągalność pól schematu", () => {
  for (const def of WIDGETS) {
    const schema = WIDGET_SCHEMAS[def.type] ?? [];
    if (!schema.some((f) => f.visibleWhen)) continue;
    it(`${def.type}: każde pole warunkowe da się w ogóle pokazać`, () => {
      const m = measurementOf(def.type);
      expect(
        unreachableSchemaFields(schema, m.rendererProbes),
        `Pola z warunkiem "visibleWhen", którego żadna kombinacja ustawień nie spełnia - ` +
          `redakcja nie ma jak do nich dojść.`,
      ).toEqual([]);
    });
  }
});

describe("kontrolki treści poza zakładką Treść są zadeklarowane", () => {
  // Bramka mierzy tylko zakładkę "Treść". Kontrolka treści dorysowana w
  // zakładce Styl/Zaawansowane (dziś: plakietka `dark-featured-card`) jest dla
  // pomiaru NIEWIDZIALNA, więc wyglądałaby na "ukryte ustawienie" i ktoś
  // zwolniłby ją z bramki zamiast opisać. Test czyta źródło panelu i wymaga, by
  // każdy zapisywany klucz był objęty: schematem, POMIAREM (czyli leży w
  // zakładce treści) albo jawną deklaracją.
  const PANEL_SRC = resolve(process.cwd(), "src/components/admin/builder/WidgetProperties.tsx");

  it('każdy literał setContent("…") w panelu jest objęty bramką', () => {
    const src = readFileSync(PANEL_SRC, "utf8");
    const used = new Set<string>();
    for (const m of src.matchAll(/setContent\(\s*"([A-Za-z0-9_]+)"/g)) used.add(m[1]);

    const covered = new Set<string>();
    for (const keys of Object.values(PANEL_EXTRA_CONTENT_KEYS)) {
      for (const key of keys ?? []) covered.add(key);
    }
    for (const schema of Object.values(WIDGET_SCHEMAS)) {
      for (const key of schemaStorageKeys(schema ?? [])) covered.add(key);
      for (const field of schema ?? []) covered.add(field.key);
    }
    // Klucz, który POMIAR zobaczył po stronie panelu, jest z definicji w
    // zakładce treści - inwariant już go pilnuje (np. `slotId` edytora reklam,
    // który nie ma wpisu w WIDGET_SCHEMAS).
    for (const def of WIDGETS) {
      for (const key of measurementOf(def.type).offered) covered.add(key);
    }

    const orphans = [...used].filter((key) => !covered.has(key)).sort();
    expect(
      orphans,
      "Kontrolka treści w panelu, której bramka nie widzi: albo dodaj pole do WIDGET_SCHEMAS,\n" +
        "albo wymień klucz w PANEL_EXTRA_CONTENT_KEYS (jeśli mieszka poza zakładką Treść).",
    ).toEqual([]);
  });
});
