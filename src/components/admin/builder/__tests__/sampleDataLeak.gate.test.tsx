// BRAMKA DANYCH PRÓBKI: żaden widget renderowany publicznie nie pokazuje
// zmyślonych danych - i jednocześnie kanwa buildera nadal je pokazuje.
//
// DEFEKT, KTÓRY TA BRAMKA ZAMYKA NA STAŁE
// Widgety dynamiczne robiły `useCurrentPostCtx() ?? PLACEHOLDER_POST_CTX`.
// Nagłówek, stopka, popupy, szuflada mobilna i strony taksonomii renderują
// sekcje buildera BEZ providera kontekstu wpisu, więc widget `post-*` wstawiony
// w takie miejsce pokazywał REALNYM ODWIEDZAJĄCYM fikcyjnego "Jana Kowalskiego",
// "Tytuł przykładowego wpisu", "Przykładowe archiwum / 12 wpisów" i licznik
// 1234 odsłon. Metryka "pełne pokrycie rejestru" była na to całkowicie odporna:
// widget istniał i renderował się - renderował kłamstwo.
//
// TRZY KIERUNKI, KTÓRE MUSZĄ BYĆ SPRAWDZONE RAZEM (jeden bez drugich jest fałszywym
// poczuciem bezpieczeństwa):
//   1. publicznie bez kontekstu -> ani jednego napisu próbki,
//   2. publicznie z REALNYM kontekstem -> nadal ani jednego (próbka nie dolepia
//      się jako "fallback dla brakującego pola"),
//   3. w kanwie buildera bez kontekstu -> próbka JEST (inaczej "naprawa" polega
//      na wyłączeniu podglądu i nikt tego nie zauważy).
// Plus skan źródeł: żaden inny moduł nie ma prawa mieć własnej, zaszytej próbki.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { Device, WidgetNode, WidgetType } from "@/lib/builder/types";
import { WIDGETS, makeWidget } from "@/lib/builder/registry";
import { BuilderModeProvider } from "@/lib/content-model/editorCanvas";
import { CurrentPostProvider, type CurrentPostCtx } from "@/lib/content-model/postContext";
import { SAMPLE_POST_TOKENS, findSampleLeak } from "@/lib/builder/ci/sampleTokens";

// Podział kodu (React.lazy) zamieniony na importy statyczne - bez tego pierwszy
// render leniwych widgetów pokazuje fallback Suspense i synchroniczne asercje
// widzą pustkę tam, gdzie w produkcji SSR wypełnia boundary. Lustro eager jest
// kontraktowo identyczne z rejestrem (src/lib/builder/ci/__tests__/eagerWidgetChunks.test.ts).
vi.mock(
  "@/components/builder/organisms/widget-view/lazyWidgets",
  () => import("@/test/eagerWidgetChunks"),
);

vi.mock("@/integrations/supabase/client", () => {
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
  ];
  for (const m of chain) (builder as Record<string, unknown>)[m] = vi.fn(() => builder);
  builder.single = vi.fn(async () => ({ data: null, error: null }));
  builder.maybeSingle = vi.fn(async () => ({ data: null, error: null }));
  builder.then = (res: (v: unknown) => unknown) => res({ data: [], error: null });
  const channel: Record<string, unknown> = {};
  channel.on = vi.fn(() => channel);
  channel.subscribe = vi.fn(() => channel);
  return {
    supabase: {
      from: vi.fn(() => builder),
      rpc: vi.fn(async () => ({ data: [], error: null })),
      channel: vi.fn(() => channel),
      removeChannel: vi.fn(async () => "ok"),
      auth: {
        getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
        getUser: vi.fn(async () => ({ data: { user: null }, error: null })),
        onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: () => {} } } })),
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

import { WidgetView } from "@/components/builder/organisms/WidgetView";

const DEVICE: Device = "desktop";
const LANGS = ["pl", "en"] as const;

/** Realny kontekst wpisu - żadna wartość nie pochodzi z próbki. */
const REAL_CTX: CurrentPostCtx = {
  kind: "post",
  id: "real-1",
  slug: "realny-wpis",
  title_pl: "Realny tytuł",
  title_en: "Real title",
  excerpt_pl: "Realna zajawka.",
  excerpt_en: "Real excerpt.",
  coverUrl: "https://example.org/real.jpg",
  publishedAt: "2026-02-03T09:00:00.000Z",
  readingTimeMin: 4,
  viewCount: 7,
  author: { name: "Realny Autor", slug: "realny-autor", bio_pl: "Realne bio.", jobTitle: "Rola" },
  categories: [{ slug: "realna", name: "Realna kategoria" }],
  tags: [{ slug: "realny-tag", name: "Realny tag" }],
  breadcrumbs: [{ label: "Start", href: "/" }, { label: "Realny tytuł" }],
  archive: { type: "tag", label: "Realne archiwum", count: 3 },
};

function newClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
}

type Surface = "public" | "public-with-ctx" | "canvas";

function renderWidget(type: WidgetType, lang: (typeof LANGS)[number], surface: Surface): string {
  const node: WidgetNode = makeWidget(type);
  const client = newClient();
  const view = <WidgetView node={node} lang={lang} device={DEVICE} />;
  const tree =
    surface === "canvas" ? (
      <BuilderModeProvider mode="light">{view}</BuilderModeProvider>
    ) : surface === "public-with-ctx" ? (
      <CurrentPostProvider value={REAL_CTX}>{view}</CurrentPostProvider>
    ) : (
      view
    );
  try {
    const { container } = render(<QueryClientProvider client={client}>{tree}</QueryClientProvider>);
    // `innerHTML`, nie `textContent`: próbka wycieka też przez atrybuty
    // (`alt`, `title`, `href`, `aria-label`), nie tylko przez węzły tekstowe.
    return container.innerHTML;
  } finally {
    cleanup();
    client.clear();
  }
}

afterEach(cleanup);

describe("zbiór napisów próbki jest sensowny", () => {
  it("wylicza charakterystyczne frazy z PLACEHOLDER_POST_CTX", () => {
    expect(SAMPLE_POST_TOKENS.length).toBeGreaterThanOrEqual(6);
    expect(SAMPLE_POST_TOKENS).toContain("Jan Kowalski");
    expect(SAMPLE_POST_TOKENS).toContain("Tytuł przykładowego wpisu");
    expect(SAMPLE_POST_TOKENS).toContain("Przykładowe archiwum");
  });

  it("nie ściga fraz nieodróżnialnych od realnej treści", () => {
    for (const token of SAMPLE_POST_TOKENS) expect(token.length).toBeGreaterThanOrEqual(8);
    expect(SAMPLE_POST_TOKENS).not.toContain("preview");
    expect(SAMPLE_POST_TOKENS).not.toContain("Start");
  });

  it("znajduje wyciek w tekście i milczy na tekście czystym", () => {
    expect(findSampleLeak("<p>Autor: Jan Kowalski</p>")).toBe("Jan Kowalski");
    expect(findSampleLeak("<p>Autor: Realny Autor</p>")).toBeNull();
  });
});

describe("PUBLICZNIE BEZ KONTEKSTU: zero danych przykładowych", () => {
  for (const def of WIDGETS) {
    for (const lang of LANGS) {
      it(`${def.type} (${lang})`, () => {
        const html = renderWidget(def.type, lang, "public");
        const leak = findSampleLeak(html);
        expect(
          leak,
          `Widget "${def.type}" pokazał dane przykładowe ("${leak}") na powierzchni publicznej.\n` +
            `Poza kanwą buildera brak kontekstu MUSI znaczyć "nie renderuj", nigdy "zmyśl".\n` +
            `Kanoniczne wejście do próbki: useCurrentPostCtxOrPreview() z currentPostContext.tsx.`,
        ).toBeNull();
      });
    }
  }
});

describe("PUBLICZNIE Z REALNYM KONTEKSTEM: próbka nie dolepia się jako fallback", () => {
  for (const def of WIDGETS) {
    it(`${def.type}`, () => {
      const leak = findSampleLeak(renderWidget(def.type, "pl", "public-with-ctx"));
      expect(
        leak,
        `Widget "${def.type}" domieszał dane przykładowe ("${leak}") do REALNEGO kontekstu wpisu - ` +
          `brakujące pole kontekstu musi zostać puste, nie zmyślone.`,
      ).toBeNull();
    });
  }
});

describe("KANWA BUILDERA: podgląd nadal pokazuje próbkę", () => {
  // Bez tego kierunku "naprawę" wycieku dałoby się zaliczyć, wycinając podgląd
  // dynamicznych widgetów - redakcja zobaczyłaby puste pudełka i nie miałaby
  // czego ustawiać.
  const PREVIEW_WIDGETS: ReadonlyArray<{ type: WidgetType; token: string }> = [
    { type: "post-title", token: "Tytuł przykładowego wpisu" },
    { type: "post-author-card", token: "Jan Kowalski" },
    { type: "post-excerpt", token: "Krótki opis wpisu pojawi się tutaj." },
    { type: "archive-title", token: "Przykładowe archiwum" },
  ];

  for (const { type, token } of PREVIEW_WIDGETS) {
    it(`${type} rysuje próbkę w edytorze`, () => {
      expect(renderWidget(type, "pl", "canvas")).toContain(token);
    });
  }

  it("ten sam widget publicznie renderuje pustkę, nie próbkę", () => {
    for (const { type } of PREVIEW_WIDGETS) {
      expect(findSampleLeak(renderWidget(type, "pl", "public"))).toBeNull();
    }
  });
});

describe("PRÓBKA MA JEDNO ŹRÓDŁO: żaden renderer nie zaszywa własnej", () => {
  const SRC = resolve(process.cwd(), "src");

  /**
   * ZAKRES SKANU: kod, który renderuje treść na POWIERZCHNIACH PUBLICZNYCH.
   *
   * Tu i tylko tu zaszyta próbka jest wyciekiem. Panel właściwości, kanwa,
   * szufladka sidebar-buildera i pakiety tłumaczeń mogą (i muszą) znać napisy
   * podglądu - to ich zadanie. Skan celowo NIE obejmuje całego `src/`: napisy
   * w rodzaju „Jan Kowalski" są najzwyklejszym polskim placeholderem pola
   * „imię i nazwisko", więc ściganie ich globalnie dawałoby szum, w którym
   * prawdziwy wyciek by się schował.
   */
  const PUBLIC_RENDER_DIRS = [
    "components/builder/organisms/widget-view",
    "components/blocks",
    "components/content",
    "components/archive",
    "components/megaMenu",
    "components/menu",
  ];

  /** Kanoniczne źródło próbki + moduły, które ją świadomie opisują. */
  const ALLOWED = new Set([
    "lib/content-model/postContext.tsx",
    "lib/builder/ci/sampleTokens.ts",
    "lib/builder/archiveContext.ts",
  ]);

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "__tests__" || entry.name === "node_modules") continue;
        walk(full, out);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name)) continue;
      if (/\.(test|spec)\.tsx?$/.test(entry.name)) continue;
      out.push(full);
    }
    return out;
  }

  function publicRenderFiles(): string[] {
    const out: string[] = [];
    for (const dir of PUBLIC_RENDER_DIRS) walk(resolve(SRC, dir), out);
    out.push(resolve(SRC, "components/builder/organisms/WidgetView.tsx"));
    return out;
  }

  it("zakres skanu obejmuje realny renderer, nie pustkę", () => {
    expect(publicRenderFiles().length).toBeGreaterThan(40);
  });

  it("napisy próbki nie występują w kodzie renderującym publicznie", () => {
    const offenders: string[] = [];
    for (const file of publicRenderFiles()) {
      const rel = relative(SRC, file);
      if (ALLOWED.has(rel)) continue;
      const text = readFileSync(file, "utf8");
      for (const token of SAMPLE_POST_TOKENS) {
        // Komentarze opisujące naprawioną regresję cytują nazwy próbki - to
        // dokumentacja, nie renderowana treść. Ścigamy literały w KODZIE.
        const inCode = text
          .split("\n")
          .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
          .some((line) => line.includes(token));
        if (inCode) offenders.push(`${rel}: "${token}"`);
      }
    }
    expect(
      offenders.sort(),
      "Dane przykładowe MUSZĄ mieć jedno źródło (`PLACEHOLDER_POST_CTX`) bramkowane trybem\n" +
        "edycji. Druga kopia w rendererze omija tę bramkę i wycieka publicznie.",
    ).toEqual([]);
  });
});
