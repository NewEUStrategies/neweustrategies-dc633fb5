// @vitest-environment node
//
// CO DOWODZI TEN PLIK
//
// `fetchPostRefBundle` (src/lib/builder/contentRefs.ts:101-137) owija odczyt
// referencji wpisu w `edgeTtlCache` pod kluczem `builder:post-ref:${id}`.
// Klucz jest BEZJEZYKOWY z premedytacja: mapowanie na wariant PL/EN robi
// dopiero `toPostRef` PO odczycie, wiec oba jezyki maja dzielic JEDEN wpis TTL
// (komentarz contentRefs.ts:87-88). To jest obietnica o liczbie round-tripow,
// a nie o ksztalcie danych - i nie da sie jej sprawdzic w pliku siostrzanym.
//
// DLACZEGO OSOBNY PLIK I OSOBNE SRODOWISKO. `edgeTtlCache` zaczyna sie od
// `if (typeof window !== "undefined") return fetcher();` - w domyslnym
// srodowisku suity (happy-dom definiuje `window`) cache jest PRZEZROCZYSTY,
// wiec kolejne wywolania ida do bazy jeden do jednego i niczego nie dowodza.
// Dopiero `// @vitest-environment node` wlacza prawdziwa sciezke. Ten sam
// podzial repo stosuje juz dla `publicQueries.test.ts` (kontrakt wywolania,
// cache atrapowany) i `publicQueriesEdgeCache.test.ts` (skutek, cache
// prawdziwy, atrapa na hoscie zadania).
//
// GRANICA DOWODU. Sam mechanizm (serve-stale, single-flight, generacje, limit
// wpisow) ma wlasny plik `src/lib/__tests__/ssrCacheHostScope.test.ts` i nie
// jest tu powtarzany. Tu pytamy wylacznie o to, czy TO JEDNO miejsce wywolania
// korzysta z niego poprawnie: jeden wpis na id, wspolny dla jezykow,
// zakresowany po hoscie najemcy.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseFromStub, SupabaseRpcStub } from "@/test/supabase";

const host = vi.hoisted(() => ({ value: null as string | null }));
const sb = vi.hoisted(() => ({
  from: null as SupabaseFromStub | null,
  rpc: null as SupabaseRpcStub | null,
}));

vi.mock("@/lib/http/requestHost", () => ({
  currentTenantHost: () => Promise.resolve(host.value),
  requestPublicHost: () => host.value,
}));

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub, supabaseRpcStub } = await import("@/test/supabase");
  const fromStub = supabaseFromStub();
  const rpcStub = supabaseRpcStub();
  sb.from = fromStub;
  sb.rpc = rpcStub;
  return { supabase: { from: fromStub.from, rpc: rpcStub.rpc } };
});

import { fail, ok } from "@/test/supabase";
import { clearEdgeTtlCache } from "@/lib/ssrCache";
import { postRefQueryOptions, type Lang, type PostRefData } from "@/lib/builder/contentRefs";

function db(): SupabaseFromStub {
  if (sb.from === null) throw new Error("test: atrapa `from` nie zostala utworzona");
  return sb.from;
}

function rpc(): SupabaseRpcStub {
  if (sb.rpc === null) throw new Error("test: atrapa `rpc` nie zostala utworzona");
  return sb.rpc;
}

function runQueryFn(id: string, lang: Lang = "pl"): Promise<PostRefData | null> {
  const options = postRefQueryOptions(id, lang);
  return (options.queryFn as () => Promise<PostRefData | null>)();
}

/** Wiersz "wpis TEGO najemcy" - tytul niesie host, zeby bylo widac czyj. */
function refRowOfHost(): void {
  rpc().setResponse("get_post_refs", () =>
    ok([
      {
        id: "p1",
        slug: "raport-o-ue",
        title_pl: `Tytul ${host.value}`,
        title_en: `Title ${host.value}`,
        excerpt_pl: "Zajawka PL",
        excerpt_en: "Excerpt EN",
        cover_image_url: null,
        published_at: null,
        author_id: null,
        author_name: null,
        author_avatar: null,
        author_slug: null,
      },
    ]),
  );
}

beforeEach(() => {
  db().reset();
  rpc().reset();
  clearEdgeTtlCache();
  host.value = null;
});

describe("TTL cache referencji wpisu pod prawdziwym zakresowaniem po hoscie", () => {
  it("drugi odczyt tego samego wpisu w oknie TTL nie idzie do bazy", async () => {
    host.value = "a.example";
    refRowOfHost();

    await runQueryFn("p1");
    await runQueryFn("p1");

    expect(rpc().callsFor("get_post_refs")).toHaveLength(1);
  });

  it("dwa rozne wpisy to dwa rozne klucze TTL", async () => {
    host.value = "a.example";
    refRowOfHost();

    await runQueryFn("p1");
    await runQueryFn("p2");

    // Klucz niesie `id`, wiec drugi wpis nie moze dostac zapamietanego
    // pierwszego - inaczej caly slider pokazywalby jeden i ten sam artykul.
    expect(rpc().callsFor("get_post_refs")).toHaveLength(2);
  });

  it("PL i EN dziela JEDEN wpis TTL, a mimo to dostaja rozne teksty", async () => {
    host.value = "a.example";
    refRowOfHost();

    const pl = await runQueryFn("p1", "pl");
    const en = await runQueryFn("p1", "en");

    // Jeden round-trip: klucz cache jest bezjezykowy (contentRefs.ts:87-88).
    expect(rpc().callsFor("get_post_refs")).toHaveLength(1);
    // A mimo to jezyk rozstrzyga sie poprawnie, bo robi to `toPostRef` PO
    // odczycie, na tym samym zapamietanym wierszu.
    expect(pl?.title).toBe("Tytul a.example");
    expect(en?.title).toBe("Title a.example");
  });

  it("wpis rozgrzany na domenie A nie wychodzi na domenie B", async () => {
    refRowOfHost();

    host.value = "a.example";
    const dlaA = await runQueryFn("p1");

    host.value = "b.example";
    const dlaB = await runQueryFn("p1");

    // Izolat Workers obsluguje zadania WSZYSTKICH najemcow tej instalacji, wiec
    // zle zakresowany wpis nie bylby "stara trescia", tylko trescia CUDZEJ
    // domeny wydana na naszej.
    expect(rpc().callsFor("get_post_refs")).toHaveLength(2);
    expect(dlaA?.title).toBe("Tytul a.example");
    expect(dlaB?.title).toBe("Tytul b.example");
  });

  // DEFEKT: PRZEJSCIOWA ODMOWA BAZY ZOSTAJE ZAPAMIETANA JAKO "WPISU NIE MA".
  //
  // WEJSCIE: jeden odczyt referencji wpisu w chwili, gdy RPC `get_post_refs`
  //   odmawia (brak grantu w oknie wdrozeniowym migracji, chwilowa awaria)
  //   i fallbackowy odczyt `posts` odmawia tak samo; zaraz potem, w tym samym
  //   oknie TTL, baza odpowiada juz poprawnie.
  // CO PSUJE: `fetchPostRef` (src/lib/builder/contentRefs.ts:53) POLYKA
  //   `error` i oddaje `null`, a `fetchPostRefBundle` (:101-136) zapisuje ten
  //   `null` do `edgeTtlCache` jako pelnoprawny wynik. Magazyn nie odroznia
  //   "nie wiem" od "nie ma", bo dostaje tylko `{ row: null }`.
  // KONSEKWENCJA: jedna nieudana sekunda zamraza "wpisu nie ma" na 60 s
  //   swiezosci i do 300 s okna serve-stale (STALE_FACTOR = 5 w
  //   src/lib/ssrCache.ts) - dla CALEGO HOSTA, nie dla jednego czytelnika,
  //   bo cache jest per izolat. Kazdy slider referujacy ten wpis renderuje
  //   przez ten czas zamrozony ladunek z JSON-a zamiast zywej tresci, i nic
  //   tego nie zglasza.
  // WYMAGANA POPRAWKA: wynik pochodzacy z ODMOWY nie moze trafic do magazynu -
  //   albo blad propaguje sie z `fetchPostRef` (wtedy react-query ponowi
  //   i `edgeTtlCache` nic nie zapisze), albo `fetchPostRefBundle` pomija
  //   zapis dla pakietu powstalego z bledu. "Nie wiem" i "nie ma" to dwie
  //   rozne odpowiedzi i tylko druga wolno cache'owac.
  it.fails("DEFEKT: odmowa bazy NIE MOZE byc zapamietana jako brak wpisu", async () => {
    host.value = "a.example";
    rpc().setError("get_post_refs", "permission denied for function get_post_refs", "42501");
    db().setResponse("posts", () => fail("permission denied for table posts", "42501"));

    await expect(runQueryFn("p1")).resolves.toBeNull();

    // Baza wraca do zdrowia jeszcze w oknie TTL.
    refRowOfHost();
    await expect(runQueryFn("p1")).resolves.not.toBeNull();
  });
});
