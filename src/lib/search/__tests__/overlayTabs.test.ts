// Zakładki wyszukiwarki overlay: pięć źródeł pobieranych RÓWNOLEGLE jednym
// zapytaniem, żeby liczniki przy zakładkach były prawdziwe, a przełączanie
// zakładek nie odpalało nowych round-tripów.
//
// CO TU JEST NAPRAWDĘ WAŻNE: KAŻDE źródło ma być odporne na brak funkcji
// w bazie i kończyć się PUSTĄ SEKCJĄ, a nie wywróconym overlayem. To nie jest
// hipoteza - repo ma udokumentowane wdrożenia, w których jedna funkcja
// pojawiała się później niż konsument. Odporność jest realizowana DWUWARSTWOWO
// (`if (error) return []` w źródle plus `.catch(() => [])` na złączeniu),
// a taka konstrukcja zamienia awarię w ciszę: regresja w pojedynczym źródle
// jest dla użytkownika NIEODRÓŻNIALNA od „nic nie znaleziono". Dlatego każde
// źródło ma tu osobny test obu ramion.
//
// Sekcja klubów niesie dodatkowo regułę prywatności: RPC filtruje po
// uprawnieniach per wątek, więc overlay nie może zdradzić istnienia klubu
// zamkniętego. Test przypina, że warstwa TS nie dokłada tu własnego obejścia.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fail, ok, supabaseFromStub } from "@/test/supabaseChain";

const h = vi.hoisted(() => ({ rpc: vi.fn() }));
const stubs = vi.hoisted(() => ({ from: null as ReturnType<typeof supabaseFromStub> | null }));

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub: make } = await import("@/test/supabaseChain");
  const from = make();
  stubs.from = from;
  return { supabase: { rpc: h.rpc, from: from.from } };
});

import {
  OVERLAY_TABS,
  emptyOverlayResults,
  firstNonEmptyTab,
  overlaySearchQueryOptions,
  type OverlayResults,
} from "@/lib/search/overlayTabs";

type QueryFn = () => Promise<OverlayResults>;

/** Uruchamia `queryFn` opcji zapytania - to ona scala pięć źródeł. */
const run = (q = "energia", lang: "pl" | "en" = "pl", limit = 5) =>
  (overlaySearchQueryOptions(q, lang, limit).queryFn as unknown as QueryFn)();

/** Domyślnie KAŻDE RPC odpowiada pustką; test podmienia tylko to, co bada. */
function rpcRouter(byFn: Record<string, unknown> = {}) {
  h.rpc.mockImplementation((fn: string) => {
    const planned = byFn[fn];
    if (planned instanceof Error) return Promise.reject(planned);
    if (planned && typeof planned === "object" && "error" in planned)
      return Promise.resolve(planned);
    return Promise.resolve({ data: planned ?? [], error: null });
  });
}

beforeEach(() => {
  h.rpc.mockReset();
  stubs.from?.reset();
  stubs.from?.setResponse("categories", ok([]));
  stubs.from?.setResponse("tags", ok([]));
  rpcRouter();
});

describe("overlayTabs - kontrakt zakładek", () => {
  it("pusty wynik ma klucz na KAŻDĄ zakładkę - render nie sprawdza istnienia sekcji", () => {
    const empty = emptyOverlayResults();
    for (const tab of OVERLAY_TABS) expect(empty[tab]).toEqual([]);
    expect(Object.keys(empty)).toHaveLength(OVERLAY_TABS.length);
  });

  it("fraza krótsza niż dwa znaki NIE odpala zapytania", () => {
    expect(overlaySearchQueryOptions("a", "pl", 5).enabled).toBe(false);
    expect(overlaySearchQueryOptions("ab", "pl", 5).enabled).toBe(true);
  });

  it("klucz cache niesie frazę, język i limit - inaczej wynik EN pokazałby się w PL", () => {
    expect(overlaySearchQueryOptions("gaz", "en", 8).queryKey).toEqual([
      "search-overlay-tabs",
      "gaz",
      "en",
      8,
    ]);
  });
});

describe("overlayTabs - wpisy", () => {
  it("mapuje wpis na wiersz z permalinkiem i lidem", async () => {
    rpcRouter({
      search_posts: [
        {
          id: "p-1",
          slug: "raport",
          title_pl: "Raport",
          title_en: "Report",
          excerpt_pl: "Lid",
          excerpt_en: "Lead",
        },
      ],
    });
    const r = await run();
    expect(r.posts).toEqual([
      { id: "p-1", label: "Raport", meta: "Lid", href: "/post/raport", avatarUrl: null },
    ]);
  });

  it("po angielsku bierze angielskie pola", async () => {
    rpcRouter({
      search_posts: [
        {
          id: "p-1",
          slug: "raport",
          title_pl: "Raport",
          title_en: "Report",
          excerpt_pl: "Lid",
          excerpt_en: "Lead",
        },
      ],
    });
    const r = await run("energia", "en");
    expect(r.posts[0]).toMatchObject({ label: "Report", meta: "Lead" });
  });

  it("brak lidu daje null, nie pusty napis (wiersz nie rezerwuje miejsca)", async () => {
    rpcRouter({
      search_posts: [
        { id: "p-1", slug: "s", title_pl: "T", title_en: "T", excerpt_pl: null, excerpt_en: null },
      ],
    });
    expect((await run()).posts[0].meta).toBeNull();
  });

  it("BŁĄD funkcji wpisów daje pustą sekcję, a nie wywrócony overlay", async () => {
    rpcRouter({ search_posts: { data: null, error: { message: "brak funkcji" } } });
    expect((await run()).posts).toEqual([]);
  });
});

describe("overlayTabs - tematyka (kategorie i tagi)", () => {
  it("scala kategorie i tagi w jedną sekcję z właściwymi archiwami", async () => {
    stubs.from?.setResponse(
      "categories",
      ok([{ id: "c-1", slug: "geo", name_pl: "Geopolityka", name_en: "Geopolitics" }]),
    );
    stubs.from?.setResponse("tags", ok([{ id: "t-1", slug: "gaz", name: "Gaz" }]));
    const r = await run();
    expect(r.topics).toEqual([
      {
        id: "cat-c-1",
        label: "Geopolityka",
        meta: null,
        href: "/category/geo",
        avatarUrl: null,
      },
      { id: "tag-t-1", label: "Gaz", meta: null, href: "/tag/gaz", avatarUrl: null },
    ]);
  });

  it("kategoria bierze nazwę we właściwym języku", async () => {
    stubs.from?.setResponse(
      "categories",
      ok([{ id: "c-1", slug: "geo", name_pl: "Geopolityka", name_en: "Geopolitics" }]),
    );
    expect((await run("energia", "en")).topics[0].label).toBe("Geopolitics");
  });

  it("PRZYCINA scaloną sekcję do limitu - kategorie i tagi dzielą jedną pulę", async () => {
    stubs.from?.setResponse(
      "categories",
      ok([1, 2].map((i) => ({ id: `c-${i}`, slug: `c${i}`, name_pl: `K${i}`, name_en: `C${i}` }))),
    );
    stubs.from?.setResponse(
      "tags",
      ok([1, 2, 3].map((i) => ({ id: `t-${i}`, slug: `t${i}`, name: `T${i}` }))),
    );
    expect((await run("energia", "pl", 3)).topics).toHaveLength(3);
  });

  it("błąd odczytu taksonomii daje pustą sekcję", async () => {
    stubs.from?.setResponse("categories", fail("permission denied"));
    stubs.from?.setResponse("tags", fail("permission denied"));
    expect((await run()).topics).toEqual([]);
  });
});

describe("overlayTabs - kluby", () => {
  it("mapuje wątek na adres wątku i ZDEJMUJE znaczniki z podświetlenia", async () => {
    rpcRouter({
      club_search: [
        {
          thread_id: "th-1",
          title: "Wątek o gazie",
          snippet: "fragment o <b>gazie</b> i ropie",
          club_slug: "energia",
          thread_slug: "gaz",
        },
      ],
    });
    const r = await run();
    // Overlay renderuje TEKST - wstrzyknięcie HTML byłoby dziurą.
    expect(r.clubs[0]).toEqual({
      id: "th-1",
      label: "Wątek o gazie",
      meta: "fragment o gazie i ropie",
      href: "/club/energia/t/gaz",
      avatarUrl: null,
    });
  });

  it("pusty snippet daje null zamiast pustego wiersza meta", async () => {
    rpcRouter({
      club_search: [
        { thread_id: "th-1", title: "T", snippet: null, club_slug: "c", thread_slug: "t" },
      ],
    });
    expect((await run()).clubs[0].meta).toBeNull();
  });

  it("BŁĄD funkcji klubów daje pustą sekcję - overlay nie zdradza klubów zamkniętych", async () => {
    rpcRouter({ club_search: { data: null, error: { message: "insufficient privilege" } } });
    expect((await run()).clubs).toEqual([]);
  });
});

describe("overlayTabs - osoby", () => {
  it("mapuje osobę na profil i sklejone stanowisko z firmą", async () => {
    rpcRouter({
      search_people: [
        {
          id: "u-1",
          display_name: "Jan Kowalski",
          job_title: "Analityk",
          current_company: "NES",
          slug: "jan-kowalski",
          avatar_url: "/av.webp",
        },
      ],
    });
    expect((await run()).people[0]).toEqual({
      id: "u-1",
      label: "Jan Kowalski",
      meta: "Analityk - NES",
      href: "/author/jan-kowalski",
      avatarUrl: "/av.webp",
    });
  });

  it("osoba BEZ sluga prowadzi do katalogu z frazą, a nie pod martwy adres", async () => {
    rpcRouter({
      search_people: [{ id: "u-1", display_name: "Jan", job_title: null, current_company: null }],
    });
    const r = await run("polityka energetyczna");
    expect(r.people[0].href).toBe("/people?q=polityka%20energetyczna");
    expect(r.people[0].meta).toBeNull();
  });

  it("brak nazwy nie wywraca wiersza", async () => {
    rpcRouter({ search_people: [{ id: "u-1", display_name: null, slug: "x" }] });
    expect((await run()).people[0].label).toBe("");
  });

  it("BŁĄD funkcji osób daje pustą sekcję", async () => {
    rpcRouter({ search_people: { data: null, error: { message: "42725" } } });
    expect((await run()).people).toEqual([]);
  });
});

describe("overlayTabs - eksperci", () => {
  it("przepuszcza WYŁĄCZNIE osoby - organizacje mają własną sekcję", async () => {
    rpcRouter({
      search_people_orgs: [
        { id: "e-1", kind: "person", label_pl: "Ekspert", label_en: "Expert", slug: "ekspert" },
        { id: "o-1", kind: "organization", label_pl: "NATO", label_en: "NATO", slug: "nato" },
      ],
    });
    const r = await run();
    expect(r.experts.map((e) => e.id)).toEqual(["e-1"]);
  });

  it("wiersz bez rodzaju traktowany jest jak osoba", async () => {
    rpcRouter({
      search_people_orgs: [{ id: "e-1", label_pl: "Ekspert", label_en: "Expert", slug: "e" }],
    });
    expect((await run()).experts).toHaveLength(1);
  });

  it("ekspert bez sluga identyfikuje się ID w adresie profilu", async () => {
    rpcRouter({
      search_people_orgs: [{ id: "e-1", kind: "person", label_pl: "E", label_en: "E" }],
    });
    expect((await run()).experts[0].href).toBe("/author/e-1");
  });

  it("bierze etykietę i podpis we właściwym języku", async () => {
    rpcRouter({
      search_people_orgs: [
        {
          id: "e-1",
          kind: "person",
          label_pl: "Ekspert",
          label_en: "Expert",
          sublabel_pl: "Energetyka",
          sublabel_en: "Energy",
          slug: "e",
        },
      ],
    });
    expect((await run("x", "en")).experts[0]).toMatchObject({ label: "Expert", meta: "Energy" });
  });

  it("BŁĄD funkcji ekspertów daje pustą sekcję", async () => {
    rpcRouter({ search_people_orgs: { data: null, error: { message: "brak funkcji" } } });
    expect((await run()).experts).toEqual([]);
  });
});

describe("overlayTabs - odporność złączenia", () => {
  it("WYJĄTEK w jednym źródle nie zabiera pozostałych sekcji", async () => {
    rpcRouter({
      search_posts: [
        { id: "p-1", slug: "s", title_pl: "Raport", title_en: "R", excerpt_pl: "", excerpt_en: "" },
      ],
      search_people: new Error("timeout"),
    });
    const r = await run();
    expect(r.posts).toHaveLength(1);
    expect(r.people).toEqual([]);
  });

  it("awaria WSZYSTKICH źródeł daje komplet pustych sekcji, nie odrzucenie zapytania", async () => {
    rpcRouter({
      search_posts: new Error("x"),
      club_search: new Error("x"),
      search_people: new Error("x"),
      search_people_orgs: new Error("x"),
    });
    stubs.from?.setResponse("categories", fail("x"));
    stubs.from?.setResponse("tags", fail("x"));
    await expect(run()).resolves.toEqual(emptyOverlayResults());
  });
});

describe("firstNonEmptyTab", () => {
  const results = (over: Partial<OverlayResults> = {}): OverlayResults => ({
    ...emptyOverlayResults(),
    ...over,
  });
  const hit = { id: "1", label: "x", meta: null, href: "/x", avatarUrl: null };

  it("zostaje na bieżącej zakładce, gdy ma wyniki", () => {
    expect(firstNonEmptyTab(results({ people: [hit] }), "people")).toBe("people");
  });

  it("przeskakuje na PIERWSZĄ niepustą w kolejności zakładek", () => {
    expect(firstNonEmptyTab(results({ clubs: [hit], experts: [hit] }), "posts")).toBe("clubs");
  });

  it("brak wyników gdziekolwiek zostawia bieżącą zakładkę - bez migotania", () => {
    expect(firstNonEmptyTab(results(), "topics")).toBe("topics");
  });
});
