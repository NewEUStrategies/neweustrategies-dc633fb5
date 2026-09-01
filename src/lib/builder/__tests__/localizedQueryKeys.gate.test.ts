// BRAMKA ŚWIEŻOŚCI: klucz zapytania widgetu zależy od języka wtedy i tylko
// wtedy, gdy zapytanie od języka zależy.
//
// DEFEKT, KTÓRY TA BRAMKA ZAMYKA
// Slider sortował po `title_pl` / `title_en`, a klucz cache języka nie
// zawierał: PL i EN dzieliły jeden wpis, więc kto wszedł pierwszy, ustawiał
// kolejność dla obu wersji na cały czas świeżości - również w HTML-u z prefetchu
// SSR. Naprawa (PR #141) była punktowa: jeden test na jedno zapytanie. Audyt
// 03.08 nazwał brakującą część wprost: "brak testu, że każdy widget z
// lokalizowanym queryFn ma język w kluczu".
//
// TRZY ASERCJE
//  1. Konwencja parametru jest PRAWDZIWA: fabryka z `lang` daje różne klucze dla
//     PL i EN, fabryka z `_lang` - identyczne. Podkreślnik staje się
//     sprawdzalną obietnicą, nie komentarzem.
//  2. REJESTR NIE MA DZIUR: każda eksportowana fabryka `*QueryOptions` z
//     `lib/builder` jest tu wymieniona. Nowe zapytanie nie wejdzie w cień.
//  3. Zapytania pisane WPROST w komponencie (bez fabryki) też są sprawdzane -
//     statycznie, bo nie da się ich wywołać bez Reacta i Supabase.
import { describe, it, expect, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import {
  auditInlineQueries,
  langParamStyle,
  queryKeysDiffer,
  type LangParamStyle,
} from "@/lib/builder/ci/localizedQueryKeys";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: vi.fn(), rpc: vi.fn(), channel: vi.fn(), removeChannel: vi.fn() },
}));

import { postListQueryOptions } from "@/lib/builder/postListQuery";
import { sliderPostsQueryOptions } from "@/lib/builder/sliderPostsQuery";
import { newsTickerQueryOptions } from "@/lib/builder/newsTickerQuery";
import { eventsListQueryOptions } from "@/lib/builder/eventsQuery";
import { speakersQueryOptions } from "@/lib/builder/speakersQuery";
import { postRefQueryOptions } from "@/lib/builder/contentRefs";

const SRC = resolve(process.cwd(), "src");
const BUILDER_LIB = resolve(SRC, "lib/builder");

/**
 * Rejestr fabryk zapytań widgetowych, które w ogóle przyjmują język.
 *
 * `module` wskazuje plik źródłowy (stamtąd czytamy konwencję parametru),
 * `call` produkuje klucz dla danego języka. Kompletność rejestru pilnuje
 * osobna asercja - nie da się dodać fabryki i przemilczeć jej tutaj.
 */
const LANG_AWARE_FACTORIES: ReadonlyArray<{
  name: string;
  module: string;
  call: (lang: "pl" | "en") => unknown;
}> = [
  {
    name: "postListQueryOptions",
    module: "postListQuery.ts",
    call: (lang) => postListQueryOptions({ limit: 4, orderBy: "title" }, lang).queryKey,
  },
  {
    name: "sliderPostsQueryOptions",
    module: "sliderPostsQuery.ts",
    call: (lang) => sliderPostsQueryOptions({ source: "posts", orderBy: "title" }, lang).queryKey,
  },
  {
    name: "newsTickerQueryOptions",
    module: "newsTickerQuery.ts",
    call: (lang) => newsTickerQueryOptions({ limit: 5 }, lang).queryKey,
  },
  {
    name: "eventsListQueryOptions",
    module: "eventsQuery.ts",
    call: (lang) => eventsListQueryOptions({ scope: "upcoming", limit: 3 }, lang).queryKey,
  },
  {
    name: "speakersQueryOptions",
    module: "speakersQuery.ts",
    call: (lang) => speakersQueryOptions({ source: "directory", limit: 6 }, lang).queryKey,
  },
  {
    name: "postRefQueryOptions",
    module: "contentRefs.ts",
    call: (lang) => postRefQueryOptions("post-1", lang).queryKey,
  },
];

function sourceOf(moduleFile: string): string {
  return readFileSync(join(BUILDER_LIB, moduleFile), "utf8");
}

describe("konwencja `lang` / `_lang` jest prawdziwa, nie dekoracyjna", () => {
  for (const factory of LANG_AWARE_FACTORIES) {
    it(`${factory.name}`, () => {
      const style: LangParamStyle = langParamStyle(sourceOf(factory.module), factory.name);
      expect(
        style,
        `${factory.name} nie deklaruje parametru języka - dopisz \`lang\` albo \`_lang\`.`,
      ).not.toBe("absent");

      const differ = queryKeysDiffer(factory.call("pl"), factory.call("en"));
      if (style === "used") {
        expect(
          differ,
          `${factory.name} przyjmuje \`lang\`, więc jego queryFn zależy od języka - a klucz PL i EN\n` +
            `jest IDENTYCZNY. Obie wersje językowe dzielą jeden wpis cache: kto wejdzie pierwszy,\n` +
            `ustawia treść dla drugiej na cały staleTime (także w HTML-u z prefetchu SSR).`,
        ).toBe(true);
      } else {
        expect(
          differ,
          `${factory.name} deklaruje \`_lang\` (język nieużywany), a klucz PL i EN jest RÓŻNY.\n` +
            `Albo klucz niesie coś, czego zapytanie nie czyta (podwójny cache bez powodu),\n` +
            `albo parametr trzeba przemianować na \`lang\`.`,
        ).toBe(false);
      }
    });
  }

  it("klucz jest stabilny dla tej samej treści (SSR = klient, bez refetchu)", () => {
    for (const factory of LANG_AWARE_FACTORIES) {
      expect(factory.call("pl"), factory.name).toEqual(factory.call("pl"));
    }
  });
});

describe("rejestr fabryk nie ma dziur", () => {
  /** Fabryki BEZ parametru języka - zapytania niezależne od wersji językowej. */
  const LANG_FREE = new Set([
    // Taksonomie (`categories` / `tags`): `select` pobiera OBA języki
    // (`name_pl` + `name_en`), a wybór następuje w renderze. To jest wzorzec
    // POPRAWNY i komentarz przy `LANG_TOKEN` w `ci/localizedQueryKeys.ts`
    // wskazuje dokładnie te dwa widgety jako jego przykład. Klucz z językiem
    // trzymałby dwa identyczne wpisy cache za te same wiersze.
    "categoriesQueryOptions",
    "tagsQueryOptions",
    // Podcast i Web Stories: wiersz niesie oba języki (`title_pl`/`title_en`),
    // a widget wybiera przy renderze (`podcastTitle` / `storyTitle`). Fabryki
    // biorą WYŁĄCZNIE treść widgetu, żeby policzyć `limit` wchodzący do klucza.
    "podcastLatestQueryOptions",
    "webStoriesCarouselQueryOptions",
    // Katalog planów (`access_plans`): wiersz ma `name_pl`/`name_en` i
    // `features_pl`/`features_en`, a `PricingPlansView` wybiera przy renderze.
    // Klucz jest współdzielony z `/pricing` i `/checkout` (billingKeys), więc
    // dołożenie języka rozdwoiłoby cache całego cennika.
    "activePlansQueryOptions",
    // Widgety klubów: RPC zwraca OBIE wersje językowe w jednym wierszu
    // (`name_pl`/`name_en`, `club_name_pl`/`club_name_en`), a komponent wybiera
    // przy renderze. Klucz z językiem trzymałby dwa identyczne wpisy cache.
    "clubCardQueryOptions",
    "clubThreadsQueryOptions",
    "designTokensQueryOptions",
    "eventByIdQueryOptions",
    "eventRsvpCountsQueryOptions",
    "meetingSlotsQueryOptions",
    "postViewCountQueryOptions",
    // Byline slidera: nazwisko/awatar/slug autora są identyczne w PL i EN
    // (profiles_public nie ma kolumn per język) - klucz z językiem trzymałby
    // dwa identyczne wpisy cache i psuł parytet prefetch SSR <-> widget.
    "sliderAuthorsQueryOptions",
    "sliderFallbackImagesQueryOptions",
    "speakersByIdsQueryOptions",
    "speakerProfileQueryOptions",
    "speakerEngagementsQueryOptions",
  ]);

  /**
   * Agregatory prefetchu: BIORĄ język, ale tylko po to, by przekazać go dalej -
   * własnego `queryKey` nie definiują, składają klucze fabryk wymienionych
   * wyżej. Bramka na różnicę kluczy nie ma tu sensu (mierzyłaby cudzy kontrakt),
   * ale przemilczeć ich nie wolno - stąd osobna, nazwana lista.
   */
  const KEY_AGGREGATORS = new Set(["widgetQueryOptionsList", "sectionQueryOptionsList"]);

  it("każda eksportowana fabryka *QueryOptions jest objęta bramką", () => {
    const registered = new Set(LANG_AWARE_FACTORIES.map((f) => f.name));
    const missing: string[] = [];
    for (const entry of readdirSync(BUILDER_LIB, { withFileTypes: true })) {
      if (!entry.isFile() || !/\.tsx?$/.test(entry.name)) continue;
      const text = readFileSync(join(BUILDER_LIB, entry.name), "utf8");
      for (const m of text.matchAll(
        /export\s+(?:const|function)\s+([A-Za-z0-9_]*QueryOptions(?:List)?)(?![A-Za-z0-9_])/g,
      )) {
        const name = m[1];
        if (registered.has(name) || LANG_FREE.has(name) || KEY_AGGREGATORS.has(name)) continue;
        missing.push(`${entry.name}: ${name}`);
      }
    }
    expect(
      missing.sort(),
      "Nowa fabryka zapytania widgetu. Dopisz ją do LANG_AWARE_FACTORIES (gdy bierze język)\n" +
        "albo do LANG_FREE (gdy jest od języka niezależna) - milczenie nie jest opcją.",
    ).toEqual([]);
  });

  it("lista LANG_FREE nie zawiera fabryk, które jednak biorą język", () => {
    const wrong: string[] = [];
    for (const entry of readdirSync(BUILDER_LIB, { withFileTypes: true })) {
      if (!entry.isFile() || !/\.tsx?$/.test(entry.name)) continue;
      const text = readFileSync(join(BUILDER_LIB, entry.name), "utf8");
      for (const name of LANG_FREE) {
        if (!text.includes(`${name}`)) continue;
        if (langParamStyle(text, name) === "used") wrong.push(`${entry.name}: ${name}`);
      }
    }
    expect(wrong.sort()).toEqual([]);
  });
});

describe("zapytania pisane wprost w komponencie widgetu", () => {
  const WIDGET_VIEW = resolve(SRC, "components/builder/organisms/widget-view");

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "__tests__") continue;
        walk(full, out);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name)) continue;
      if (/\.(test|spec)\.tsx?$/.test(entry.name)) continue;
      out.push(full);
    }
    return out;
  }

  it("każde zlokalizowane zapytanie niesie język w kluczu", () => {
    const files = [...walk(WIDGET_VIEW), join(BUILDER_LIB, "..", "..", "")]
      .filter((p) => /\.tsx?$/.test(p))
      .map((path) => ({ path: relative(SRC, path), text: readFileSync(path, "utf8") }));
    const findings = auditInlineQueries(files);
    expect(
      findings.map((f) => `${f.path}:${f.line} → ${f.keyExpression}`),
      "queryFn czyta język, a queryKey go nie niesie: PL i EN dzielą jeden wpis cache.",
    ).toEqual([]);
  });
});

describe("analizator jest sam sprawdzony (syntetyczne wejścia)", () => {
  it("czyta konwencję parametru ze strzałki i z funkcji", () => {
    expect(
      langParamStyle(
        "export const aQueryOptions = (c: WidgetContent, lang: Lang) => {}",
        "aQueryOptions",
      ),
    ).toBe("used");
    expect(
      langParamStyle(
        "export const bQueryOptions = (c: WidgetContent, _lang: Lang) => {}",
        "bQueryOptions",
      ),
    ).toBe("unused");
    expect(langParamStyle("export function cQueryOptions(id: string) {}", "cQueryOptions")).toBe(
      "absent",
    );
    expect(langParamStyle("nothing here", "dQueryOptions")).toBe("absent");
  });

  it("nie rozpada generyka na dwa parametry", () => {
    expect(
      langParamStyle(
        "export function eQueryOptions(map: Record<string, string>, lang: Lang) {}",
        "eQueryOptions",
      ),
    ).toBe("used");
  });

  it("zgłasza zlokalizowany queryFn bez języka w kluczu", () => {
    const findings = auditInlineQueries([
      {
        path: "x.tsx",
        text: `useQuery({
          queryKey: ["cats"],
          queryFn: async () => fetchCats(lang),
        });`,
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].keyExpression).toContain('"cats"');
  });

  it("milczy, gdy klucz niesie język wprost", () => {
    expect(
      auditInlineQueries([
        {
          path: "x.tsx",
          text: `useQuery({
            queryKey: ["cats", lang],
            queryFn: async () => fetchCats(lang),
          });`,
        },
      ]),
    ).toEqual([]);
  });

  it("milczy, gdy język wchodzi do klucza przez lokalne wiązanie", () => {
    expect(
      auditInlineQueries([
        {
          path: "x.tsx",
          text: `const input = buildInput(c, lang);
          useQuery({
            queryKey: [ROOT, input],
            queryFn: () => fetchRows(input, lang),
          });`,
        },
      ]),
    ).toEqual([]);
  });

  it("milczy, gdy queryFn pobiera OBA języki i wybór następuje w renderze", () => {
    expect(
      auditInlineQueries([
        {
          path: "x.tsx",
          text: `useQuery({
            queryKey: [ROOT],
            queryFn: async () => (await supabase.from("categories").select("id, slug")).data ?? [],
          });`,
        },
      ]),
    ).toEqual([]);
  });

  it("nie liczy słowa `lang` z komentarza jako odczytu", () => {
    expect(
      auditInlineQueries([
        {
          path: "x.tsx",
          text: `useQuery({
            queryKey: [ROOT],
            // lang nie ma tu znaczenia - zapytanie zwraca oba języki
            queryFn: () => fetchAll(),
          });`,
        },
      ]),
    ).toEqual([]);
  });
});
