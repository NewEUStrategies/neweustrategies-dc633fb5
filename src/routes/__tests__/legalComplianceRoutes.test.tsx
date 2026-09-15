/**
 * DZIESIĘĆ TRAS PAKIETU ZGODNOŚCI ZAMONTOWANYCH - publiczne dokumenty prawne.
 *
 * ---------------------------------------------------------------------------
 * PO CO TEN PLIK ISTNIEJE
 * ---------------------------------------------------------------------------
 * Trasy prawne renderują się z JEDNEGO szablonu (`components/legal/LegalPage`),
 * więc kuszące jest uznanie ich za „same dane, nie ma czego testować". Pomiar
 * mówi co innego: każda z nich niesie WŁASNY loader, WŁASNY `head()` i własne
 * wiązanie klucza dokumentu - i to właśnie te trzy rzeczy potrafią się
 * rozjechać po cichu. Rozjazd jest niewidoczny na ekranie: strona renderuje
 * pełną treść z kodu, a to, co pokazuje, przestaje być tym, co redakcja
 * opublikowała w panelu.
 *
 * Ten plik zamyka trzy konkretne sposoby, w jakie te trasy psują się bez śladu:
 *
 *   1. ZŁY KLUCZ DOKUMENTU. `/rodo` grzejące i czytające `"privacy"` wyglądałoby
 *      dokładnie tak samo jak poprawne - do momentu, w którym ktoś opublikuje
 *      nową wersję polityki prywatności i zobaczy ją pod adresem RODO. Dowodzimy
 *      per trasa, że opublikowana wersja TEGO klucza wypiera treść bazową.
 *
 *   2. ZIMNY LOADER. Gdyby loader grzał wyłącznie klucz SEO, pierwszy render
 *      (czyli ten, który widzi wyszukiwarka) oddałby treść z kodu, a wersja
 *      z panelu podmieniłaby ją dopiero po hydracji. Dowodzimy, że dokument
 *      jest w cache PRZED renderem komponentu - to jest cała różnica między
 *      zaindeksowaniem treści obowiązującej a poprzedniej.
 *
 *   3. NAGŁÓWEK ZE ZŁEGO JĘZYKA albo z pominiętym wierszem `pages`. `head()`
 *      czyta lekki moduł `lib/legal/meta`, a nie pełną treść - dowód pilnuje,
 *      że napis zastępczy jest w języku adresu i że wiersz z bazy go wypiera.
 *
 * ---------------------------------------------------------------------------
 * DLACZEGO JEDEN PLIK NA DZIESIĘĆ TRAS, A NIE DZIESIĘĆ PLIKÓW
 * ---------------------------------------------------------------------------
 * Te trasy są SWOIM WŁASNYM WZORCEM: różnią się wyłącznie trójką
 * (ścieżka, klucz dokumentu, moduł treści). Dziesięć plików różniących się
 * trzema stałymi to dziesięć miejsc, w których następna trasa zostanie dodana
 * przez skopiowanie - razem z błędem, jeśli któryś zawiera błąd. Tabela
 * `DOKUMENTY` niżej jest wpisana RĘCZNIE (a nie zrzucona z `LEGAL_DOCS`),
 * więc test nie potwierdza sam siebie: wpisanie w rejestrze klucza "privacy"
 * pod ścieżką `/rodo` wywala ten plik, zamiast przejść razem z regresją.
 *
 * ---------------------------------------------------------------------------
 * ŚWIADOMIE POZA ZAKRESEM
 * ---------------------------------------------------------------------------
 * * UKŁAD I DOSTĘPNOŚĆ `LegalPage` - jeden komponent wspólny dla wszystkich
 *   dokumentów; jego drzewo, nawigacja kotwicowa i nagłówki mają własną
 *   powierzchnię dowodu, a powtarzanie ich dziesięć razy nie dokłada wiedzy.
 * * TREŚĆ MERYTORYCZNA dokumentów (ikony, parzystość sekcji PL/EN, schemat
 *   zapisu) - `src/lib/legal/__tests__/legalContent.test.ts`, gdzie bramka
 *   chodzi po całym rejestrze.
 * * Dane w testach są zmyślone; adresy wyłącznie w domenie `example.com`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import type { SupabaseFromStub } from "@/test/supabaseChain";

const h = vi.hoisted(() => ({
  db: null as SupabaseFromStub | null,
  /** Adres żądania widziany przez `head()` - dźwignia języka nagłówka. */
  requestUrl: "https://example.com/rodo",
  /** Gdy ustawione, `supabase.from` RZUCA - do dowodu o `.catch()` loadera. */
  fromThrows: null as string | null,
}));

// AKCESOR ADRESU ŻĄDANIA. `getRequestUrl` w teście jednostkowym rozstrzyga się
// do gałęzi serwerowej, w której `getRequest()` rzuca, i zwraca "". Bez tej
// atrapy gałąź angielska `head()` byłaby NIEOSIĄGALNA, a dowód o napisach
// angielskich przechodziłby na polskich.
vi.mock("@/lib/seo/request", () => ({
  getRequestUrl: () => h.requestUrl,
  getOrigin: () => "https://example.com",
}));

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabaseChain");
  const db = supabaseFromStub();
  h.db = db;
  return {
    supabase: {
      from: (table: string) => {
        if (h.fromThrows !== null) throw new Error(h.fromThrows);
        return db.from(table);
      },
    },
  };
});

import { ok } from "@/test/supabaseChain";
import { renderRoute, routeHead } from "@/test/routeHarness";
import { legalVersionQueryKey } from "@/lib/legal/useLegalDocument";
import type { LegalDocContent, LegalDocKey } from "@/lib/legal/types";

import { Route as RodoRoute } from "@/routes/rodo";
import { Route as GovernanceRoute } from "@/routes/zarzadzanie-polityka-prywatnosci";
import { Route as ProcessingRoute } from "@/routes/polityka-przetwarzania-danych";
import { Route as CommunicationsRoute } from "@/routes/komunikacja-i-marketing";
import { Route as ClubsRoute } from "@/routes/regulamin-klubow-dyskusyjnych";
import { Route as ModerationRoute } from "@/routes/moderacja-komentarzy";
import { Route as EventsRoute } from "@/routes/regulamin-wydarzen-i-biletow";
import { Route as SubscriptionsRoute } from "@/routes/regulamin-subskrypcji-i-zakupow";
import { Route as AiRoute } from "@/routes/przejrzystosc-ai";
import { Route as StatuteRoute } from "@/routes/statut";

import { RODO_META } from "@/lib/legal/meta";
import {
  PRIVACY_GOVERNANCE_META,
  DATA_PROCESSING_META,
  COMMUNICATIONS_META,
  CLUBS_META,
  MODERATION_META,
  EVENTS_META,
  SUBSCRIPTIONS_META,
  AI_TRANSPARENCY_META,
  STATUTE_META,
} from "@/lib/legal/meta";

interface DocCase {
  /** Ścieżka publiczna - musi zgadzać się z nazwą pliku trasy. */
  path: string;
  /** Klucz dokumentu w `legal_document_versions.doc_key`. */
  key: LegalDocKey;
  route: Parameters<typeof renderRoute>[0]["route"];
  /** Tytuł PL/EN z lekkiego modułu meta - napis zastępczy `head()`. */
  meta: { pl: { title: string }; en: { title: string } };
}

/**
 * Tabela wpisana RĘCZNIE (uzasadnienie w nagłówku pliku). Trójka
 * ścieżka/klucz/trasa jest tu przedmiotem dowodu, a nie odczytem z rejestru.
 */
const DOKUMENTY: readonly DocCase[] = [
  { path: "/rodo", key: "rodo", route: RodoRoute, meta: RODO_META },
  {
    path: "/zarzadzanie-polityka-prywatnosci",
    key: "privacy_governance",
    route: GovernanceRoute,
    meta: PRIVACY_GOVERNANCE_META,
  },
  {
    path: "/polityka-przetwarzania-danych",
    key: "data_processing",
    route: ProcessingRoute,
    meta: DATA_PROCESSING_META,
  },
  {
    path: "/komunikacja-i-marketing",
    key: "communications",
    route: CommunicationsRoute,
    meta: COMMUNICATIONS_META,
  },
  {
    path: "/regulamin-klubow-dyskusyjnych",
    key: "clubs",
    route: ClubsRoute,
    meta: CLUBS_META,
  },
  {
    path: "/moderacja-komentarzy",
    key: "moderation",
    route: ModerationRoute,
    meta: MODERATION_META,
  },
  {
    path: "/regulamin-wydarzen-i-biletow",
    key: "events",
    route: EventsRoute,
    meta: EVENTS_META,
  },
  {
    path: "/regulamin-subskrypcji-i-zakupow",
    key: "subscriptions",
    route: SubscriptionsRoute,
    meta: SUBSCRIPTIONS_META,
  },
  {
    path: "/przejrzystosc-ai",
    key: "ai_transparency",
    route: AiRoute,
    meta: AI_TRANSPARENCY_META,
  },
  { path: "/statut", key: "statute", route: StatuteRoute, meta: STATUTE_META },
];

/** Wersja opublikowana w kształcie, którego dotyka `safeParseLegalContent`. */
function publishedContent(title: string): LegalDocContent {
  const copy = {
    eyebrow: "Z panelu",
    title,
    lead: "Lead z panelu.",
    updated: "2026-09-15",
    sections: [{ id: "a", icon: "Mail", heading: "Sekcja z panelu", paragraphs: ["Treść."] }],
  };
  return { pl: copy, en: { ...copy, title: `${title} EN` } };
}

function testClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

/** Brak wiersza `pages` i brak opublikowanej wersji - stan domyślny serwisu. */
function planPusto(): void {
  h.db?.setResponse("pages", ok(null));
  h.db?.setResponse("legal_document_versions", ok(null));
}

function titleOf(meta: ReturnType<typeof routeHead>["meta"]): string {
  const entry = meta?.find((m) => typeof (m as { title?: unknown }).title === "string");
  return String((entry as { title?: string } | undefined)?.title ?? "");
}

beforeEach(() => {
  h.db?.reset();
  h.fromThrows = null;
  h.requestUrl = "https://example.com/rodo";
  planPusto();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe.each(DOKUMENTY)("trasa prawna $path", (doc) => {
  it("renderuje treść bazową z kodu, gdy w bazie nie ma opublikowanej wersji", async () => {
    h.requestUrl = `https://example.com${doc.path}`;
    await renderRoute({
      route: doc.route,
      path: doc.path,
      initialEntry: doc.path,
      queryClient: testClient(),
    });

    expect(screen.getByRole("heading", { level: 1, name: doc.meta.pl.title })).toBeInTheDocument();
  });

  it("opublikowana wersja TEGO klucza wypiera treść bazową", async () => {
    h.requestUrl = `https://example.com${doc.path}`;
    h.db?.setResponse(
      "legal_document_versions",
      ok({ content: publishedContent("Wersja z panelu") }),
    );

    await renderRoute({
      route: doc.route,
      path: doc.path,
      initialEntry: doc.path,
      queryClient: testClient(),
    });

    expect(screen.getByRole("heading", { level: 1, name: "Wersja z panelu" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1, name: doc.meta.pl.title })).toBeNull();
  });

  it("loader GRZEJE klucz dokumentu - treść jest w cache, nie dociągana po hydracji", async () => {
    h.requestUrl = `https://example.com${doc.path}`;
    h.db?.setResponse("legal_document_versions", ok({ content: publishedContent("Rozgrzane") }));
    const queryClient = testClient();

    await renderRoute({
      route: doc.route,
      path: doc.path,
      initialEntry: doc.path,
      queryClient,
    });

    // Gdyby loader grzał wyłącznie klucz SEO, ten wpis byłby `undefined`.
    expect(queryClient.getQueryData(legalVersionQueryKey(doc.key))).toBeDefined();
  });

  it("pyta o wersję WŁASNEGO klucza, a nie cudzego", async () => {
    h.requestUrl = `https://example.com${doc.path}`;
    await renderRoute({
      route: doc.route,
      path: doc.path,
      initialEntry: doc.path,
      queryClient: testClient(),
    });

    const chain = h.db?.lastChain("legal_document_versions");
    expect(chain?.calls.some((c) => c.method === "eq" && c.args[1] === doc.key)).toBe(true);
  });

  it("head() daje polski napis zastępczy na ścieżce bez prefiksu", () => {
    h.requestUrl = `https://example.com${doc.path}`;
    expect(titleOf(routeHead(doc.route, { loaderData: { seo: null } }).meta)).toContain(
      doc.meta.pl.title,
    );
  });

  it("head() daje angielski napis zastępczy pod /en", () => {
    h.requestUrl = `https://example.com/en${doc.path}`;
    expect(titleOf(routeHead(doc.route, { loaderData: { seo: null } }).meta)).toContain(
      doc.meta.en.title,
    );
  });

  it("awaria odczytu nie wywraca strony - dokument zostaje przy treści z kodu", async () => {
    h.requestUrl = `https://example.com${doc.path}`;
    h.fromThrows = "PostgREST nieosiągalny";

    await renderRoute({
      route: doc.route,
      path: doc.path,
      initialEntry: doc.path,
      queryClient: testClient(),
    });

    expect(screen.getByRole("heading", { level: 1, name: doc.meta.pl.title })).toBeInTheDocument();
  });
});

describe("pakiet jako całość", () => {
  it("żadne dwa dokumenty nie dzielą ścieżki ani klucza", () => {
    const paths = DOKUMENTY.map((d) => d.path);
    const keys = DOKUMENTY.map((d) => d.key);
    expect(new Set(paths).size).toBe(paths.length);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("wiersz `pages` wypiera napis zastępczy w tytule", () => {
    h.requestUrl = "https://example.com/rodo";
    const head = routeHead(RodoRoute, {
      loaderData: {
        seo: {
          slug: "rodo",
          title_pl: null,
          title_en: null,
          excerpt_pl: null,
          excerpt_en: null,
          seo_title_pl: "Tytuł z panelu",
          seo_title_en: null,
          seo_description_pl: null,
          seo_description_en: null,
          seo_canonical_url: null,
          seo_noindex: null,
          seo_og_image_url: null,
          og_image_generated_url: null,
        },
      },
    });
    expect(titleOf(head.meta)).toContain("Tytuł z panelu");
  });
});
