// Trasa PUBLICZNA `/podcasts/$show` - strona programu (serii). Do dziś: 0 z 72
// linii, 0 z 15 funkcji.
//
// CO DOWODZI TEN PLIK.
//
// Ta trasa jest jedynym miejscem w repozytorium, gdzie doktryna „404 tylko
// wtedy, gdy 404 jest PRAWDĄ" jest zapisana w kodzie na trzech rozdzielonych
// stanach - i jedynym, gdzie da się ją złamać nie ruszając ani jednej asercji
// o wyglądzie strony. Loader rozróżnia:
//
//   1. WIERSZ WRÓCIŁ -> render programu,
//   2. WIERSZ TO `null` -> `notFound()`, bo program naprawdę nie istnieje,
//   3. ODCZYT PADŁ / NIE ZDĄŻYŁ -> NIE WIEMY: HTTP 200, `no-store` i uczciwy
//      komunikat z ponowieniem.
//
// KONSEKWENCJA ZŁAMANIA punktu 3 jest niewidoczna w aplikacji i kosztowna na
// zewnątrz: 404 na realnie istniejącym programie wyrzuca ten adres z indeksu
// wyszukiwarki i z katalogów podcastów, a wróci on tam dopiero po kolejnym
// pełnym przecrawlowaniu. Blip backendu, który trwa minutę, kosztuje wtedy
// tygodnie widoczności. Dlatego kluczowy przypadek tego pliku (`awaria odczytu
// tożsamości`) asertuje BRAK 404 - nie obecność treści.
//
// CZTERY POZOSTAŁE REGUŁY:
//   4. NIEISTNIEJĄCY SLUG TO 404, NIE PUSTA STRONA PROGRAMU.
//   5. TREŚĆ JEDNEGO OBSZARU ROBOCZEGO NIE WYCHODZI NA HOŚCIE DRUGIEGO -
//      autorytetem jest polityka `tenant_id = public_tenant_id()`, a trasa
//      musi z pustego odczytu zrobić 404, nie cudzy tytuł.
//   6. NAGŁÓWEK NIESIE TYTUŁ I OPIS W OBU JĘZYKACH, razem z dwoma kanałami
//      RSS (per-program i sieciowy) - to one decydują, czy program da się
//      zasubskrybować bez ręcznego wklejania adresu.
//   7. PROGRAM BEZ ODCINKÓW TO NORMALNY STAN REDAKCYJNY (program zapowiedziany
//      przed pierwszym nagraniem), a nie awaria.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - WARSTWY ZAPYTAŃ: `src/lib/queries/podcasts.ts` biegnie tu PRAWDZIWA
//   (atrapowany jest wyłącznie klient PostgREST), więc klucze cache i filtry
//   są produkcyjne.
// - KANAŁU RSS PROGRAMU: `podcasts.$show.rss[.]xml.ts` ma własny kontrakt
//   w `feedRoutesDegradation.test.ts`. Tutaj dowodem jest wyłącznie to, że
//   strona OGŁASZA ten kanał w `<head>` i w treści.
// - PARYTETU SŁOWNIKA PL/EN: `src/lib/__tests__/i18nPodcasts.test.ts`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";

const { TENANT_A, TENANT_B, SHOW_ID, OTHER_SHOW_ID, SLUG } = vi.hoisted(() => ({
  TENANT_A: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  TENANT_B: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  SHOW_ID: "33333333-3333-4333-8333-333333333333",
  OTHER_SHOW_ID: "44444444-4444-4444-8444-444444444444",
  SLUG: "europa-o-energii",
}));

const h = vi.hoisted(() => ({
  /** Wiersze `podcast_shows` ze WSZYSTKICH obszarów roboczych. */
  shows: [] as Record<string, unknown>[],
  /** Wiersze `podcasts` ze wszystkich obszarów. */
  episodes: [] as Record<string, unknown>[],
  /** Wiersze `podcast_episode_people`. */
  people: [] as Record<string, unknown>[],
  /**
   * Tenant PRZEGLĄDANEJ domeny. Atrapa odgrywa rolę polityki publicznej
   * (`tenant_id = public_tenant_id()`): produkcja wysyła `x-tenant-host`, baza
   * odsiewa wiersze. Test modeluje SKUTEK, bo trasa nie ma własnego
   * porównania tenantów i mieć go nie powinna.
   */
  tenantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  /** Tabele, których odczyt ma paść (blip backendu). */
  broken: new Set<string>(),
  /** Etykiety odczytów w kolejności - podstawa pomiaru zapytań. */
  reads: [] as string[],
  /** Adres żądania widziany przez `head()`. */
  requestUrl: "https://nes.example.org/podcasts/europa-o-energii",
  /** Wartości `Cache-Control`, jakie loader ustawił na odpowiedzi. */
  cacheControl: [] as string[],
  /** Wartości nagłówka HTTP `Link` (preload okładki programu). */
  linkHeaders: [] as string[],
}));

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub, ok, fail } = await import("@/test/supabase/chain");
  const stub = supabaseFromStub();

  /** Wszystkie pary `.eq(kolumna, wartość)` łańcucha - `argsOf` daje pierwszą. */
  function filters(calls: ReadonlyArray<{ method: string; args: ReadonlyArray<unknown> }>) {
    const out = new Map<string, unknown>();
    for (const call of calls) {
      if (call.method === "eq" && typeof call.args[0] === "string") {
        out.set(call.args[0], call.args[1]);
      }
    }
    return out;
  }

  /** Odsiew polityki publicznej: tylko wiersze tenanta przeglądanej domeny. */
  function visible(rows: Record<string, unknown>[]) {
    return rows.filter((row) => row.tenant_id === h.tenantId);
  }

  stub.setResponse("podcast_shows", (chain) => {
    h.reads.push("podcast_shows:slug");
    if (h.broken.has("podcast_shows")) return fail("test: tabela podcast_shows niedostepna");
    const eq = filters(chain.calls);
    return ok(visible(h.shows).find((s) => s.slug === eq.get("slug")) ?? null);
  });
  stub.setResponse("podcasts", (chain) => {
    h.reads.push("podcasts:show_id");
    if (h.broken.has("podcasts")) return fail("test: tabela podcasts niedostepna");
    const eq = filters(chain.calls);
    return ok(visible(h.episodes).filter((e) => e.show_id === eq.get("show_id")));
  });
  stub.setResponse("podcast_episode_people", () => {
    h.reads.push("podcast_episode_people");
    if (h.broken.has("podcast_episode_people")) return fail("test: tabela people niedostepna");
    return ok(h.people);
  });
  return { supabase: { from: stub.from } };
});

vi.mock("@/lib/seo/request", () => ({
  getRequestUrl: () => h.requestUrl,
  getOrigin: () => "https://nes.example.org",
}));
vi.mock("@/lib/http/responseHeaders", () => ({
  appendLinkHeader: (value: string) => void h.linkHeaders.push(value),
  setCacheControlHeader: (value: string) => void h.cacheControl.push(value),
  readRouteCacheDirective: () => null,
}));

import "@/test/i18nReal";
import { QueryClient } from "@tanstack/react-query";
import i18n from "@/lib/i18n";
import { setClientLang } from "@/lib/i18n/localeRuntime";
import { renderRoute, routeHead, type RouteHeadResult } from "@/test/routeHarness";
import { axeViolations, summarize } from "@/test/axe";
import { Route as ShowRoute } from "@/routes/podcasts.$show";

const PATH = "/podcasts/$show";

// ── fixtures (RODO: wszystkie nazwy i tytuły są ZMYŚLONE) ───────────────────

function show(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: SHOW_ID,
    tenant_id: TENANT_A,
    slug: SLUG,
    title_pl: "Europa o energii",
    title_en: "Europe on energy",
    description_pl: "Cykl o polityce energetycznej Unii.",
    description_en: "A series on the Union's energy policy.",
    cover_image_url: "https://cdn.example.org/program.jpg",
    spotify_url: null,
    apple_url: null,
    youtube_url: null,
    sort_order: 1,
    status: "published",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...patch,
  };
}

function episode(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    tenant_id: TENANT_A,
    slug: "odcinek-pierwszy",
    title_pl: "Zima bez gazu",
    title_en: "A winter without gas",
    excerpt_pl: "Co się dzieje, gdy magazyny są puste.",
    excerpt_en: "What happens when storage runs dry.",
    show_notes_pl: "",
    show_notes_en: "",
    transcript_pl: "",
    transcript_en: "",
    audio_url: "https://audio.example.org/odc-1.mp3",
    duration_seconds: 1500,
    episode_number: 1,
    season: 1,
    cover_image_url: null,
    status: "published",
    published_at: "2026-03-01T09:00:00.000Z",
    author_id: null,
    show_id: SHOW_ID,
    category_id: null,
    explicit: false,
    episode_type: "full",
    chapters: [],
    quotes: [],
    resources: [],
    created_at: "2026-02-01T09:00:00.000Z",
    updated_at: "2026-03-01T09:00:00.000Z",
    ...patch,
  };
}

function personRow(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "person-1",
    episode_id: "11111111-1111-4111-8111-111111111111",
    profile_id: null,
    display_name: "Zofia Wiatrak",
    role: "host",
    url: null,
    sort_order: 0,
    profiles: null,
    ...patch,
  };
}

async function mount(slug = SLUG, queryClient?: QueryClient) {
  return renderRoute({
    route: ShowRoute,
    path: PATH,
    initialEntry: `/podcasts/${slug}`,
    queryClient,
  });
}

/** Wartość `content` wpisu meta - z twardym błędem, gdy wpisu nie ma. */
// `httpEquiv` w unii kluczy: `head()` tych tras emituje nie tylko
// `name`/`property`, ale też `http-equiv` (np. `content-language`),
// a helper skopiowany z innego testu tego klucza nie znał.
function metaContent(
  head: RouteHeadResult,
  key: "name" | "property" | "httpEquiv" | "httpEquiv",
  value: string,
): string {
  const found = (head.meta ?? []).find((entry) => entry[key] === value);
  const content = found?.content;
  if (typeof content !== "string") throw new Error(`test: brak meta ${key}="${value}"`);
  return content;
}

/** Tytuł dokumentu z `head()` - z twardym błędem, gdy go nie ma. */
function headTitle(head: RouteHeadResult): string {
  const found = (head.meta ?? []).find((entry) => typeof entry.title === "string");
  if (typeof found?.title !== "string") throw new Error("test: head() nie niesie tytulu");
  return found.title;
}

/** Tytuły wszystkich ogłoszonych kanałów RSS, w kolejności z `head()`. */
function feedTitles(head: RouteHeadResult): string[] {
  return (head.links ?? [])
    .filter((link) => link.type === "application/rss+xml")
    .map((link) => String(link.title));
}

const headFor = (loaderData: unknown) =>
  routeHead(ShowRoute, { loaderData, params: { show: SLUG } });

beforeEach(async () => {
  await i18n.changeLanguage("pl");
  setClientLang("pl");
  h.shows = [show()];
  h.episodes = [episode()];
  h.people = [];
  h.tenantId = TENANT_A;
  h.broken = new Set<string>();
  h.reads = [];
  h.requestUrl = `https://nes.example.org/podcasts/${SLUG}`;
  h.cacheControl = [];
  h.linkHeaders = [];
});

afterEach(async () => {
  cleanup();
  setClientLang("pl");
  await i18n.changeLanguage("pl");
  vi.restoreAllMocks();
});

describe("trasa /podcasts/$show - sklejenie i treść programu", () => {
  it("czyta slug ze ŚCIEŻKI i pokazuje TEN program, nie pierwszy z tabeli", async () => {
    // Adres jest jedynym wejściem na tę stronę. Slug odczytany z innego miejsca
    // dałby katalog, w którym każdy program pokazuje treść pierwszego.
    h.shows = [show({ id: OTHER_SHOW_ID, slug: "inny-program", title_pl: "Inny program" }), show()];
    const view = await mount("inny-program");

    expect(view.currentPath()).toBe("/podcasts/inny-program");
    expect(screen.getByRole("heading", { level: 1, name: "Inny program" })).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { level: 1, name: "Europa o energii" }),
    ).not.toBeInTheDocument();
  });

  it("grupuje odcinki po sezonach i prowadzi do strony odcinka", async () => {
    // Sezony są jedyną strukturą tej strony. Gdyby grupowanie wypadło, program
    // z trzema sezonami wyglądałby jak jedna płaska lista - a to jest różnica
    // między katalogiem serii a workiem plików.
    h.episodes = [
      episode(),
      episode({
        id: "22222222-2222-4222-8222-222222222222",
        slug: "odcinek-drugi",
        title_pl: "Sieci pod obciążeniem",
        season: 2,
        episode_number: 4,
      }),
    ];
    await mount();

    expect(screen.getByRole("heading", { name: "Sezon 2" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Sezon 1" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Sieci pod obciążeniem/ })).toHaveAttribute(
      "href",
      "/podcast/odcinek-drugi",
    );
  });

  it("ogłasza kanał RSS TEGO programu, nie tylko sieciowy", async () => {
    // Per-program feed jest całym sensem modelu „sieć programów": czytelnik
    // subskrybuje jedną serię, nie wszystko, co serwis kiedykolwiek nagrał.
    await mount();

    expect(screen.getByRole("link", { name: /RSS/ })).toHaveAttribute(
      "href",
      `/podcasts/${SLUG}/rss.xml`,
    );
  });

  it("prowadzący serii są liczeni RAZ, choć występują w wielu odcinkach", async () => {
    // `seriesHosts` deduplikuje po profilu albo nazwie. Bez tego program
    // z dwudziestoma odcinkami pokazywałby tę samą osobę dwadzieścia razy.
    h.people = [
      personRow(),
      personRow({ id: "person-2", episode_id: "22222222-2222-4222-8222-222222222222" }),
      personRow({ id: "person-3", display_name: "Jan Bryza", role: "guest" }),
    ];
    await mount();

    await waitFor(() => expect(screen.getAllByText("Zofia Wiatrak")).toHaveLength(1));
    // Gość NIE jest prowadzącym serii - sekcja mówi o stałej obsadzie programu.
    expect(screen.queryByText("Jan Bryza")).not.toBeInTheDocument();
  });

  it("nie zostawia strony programu z wadami dostępności", async () => {
    h.people = [personRow()];
    const view = await mount();
    await screen.findByRole("heading", { level: 1, name: "Europa o energii" });

    const violations = await axeViolations(view.container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});

describe("trasa /podcasts/$show - trzy rozdzielone stany loadera", () => {
  it("program bez odcinków renderuje KOMUNIKAT pustego stanu, nie wywrotkę", async () => {
    // Program zapowiedziany przed pierwszym nagraniem to normalny stan
    // redakcyjny. Pusta lista bez komunikatu wygląda jak awaria strony.
    h.episodes = [];
    await mount();

    expect(screen.getByRole("heading", { level: 1, name: "Europa o energii" })).toBeInTheDocument();
    expect(screen.getByText("Brak opublikowanych odcinków.")).toBeInTheDocument();
  });

  it("nieistniejący slug kończy się STRONĄ 404, nie pustym programem", async () => {
    // `notFound()` przy `null` jest jedyną rzeczą, która trzyma taki adres poza
    // indeksem. Bez niego crawler dostaje HTTP 200 z pustą stroną programu.
    await mount("nie-ma-takiego-programu");

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Nie znaleziono strony" })).toBeInTheDocument(),
    );
    expect(screen.queryByRole("heading", { level: 1, name: "Europa o energii" })).toBeNull();
  });

  it("AWARIA ODCZYTU TOŻSAMOŚCI NIE JEST 404 - to HTTP 200 z uczciwym komunikatem", async () => {
    // NAJWAŻNIEJSZY PRZYPADEK TEGO PLIKU. Sfabrykowane 404 na istniejącym
    // programie wyrzuca adres z indeksu wyszukiwarki i z katalogów podcastów.
    // Blip backendu trwający minutę kosztuje wtedy tygodnie widoczności - i nic
    // w aplikacji tego nie pokazuje.
    h.broken.add("podcast_shows");
    await mount();

    await waitFor(() =>
      expect(screen.getByText("Nie udało się załadować programu")).toBeInTheDocument(),
    );
    expect(screen.queryByRole("heading", { name: "Nie znaleziono strony" })).toBeNull();
    expect(screen.queryByText("404")).toBeNull();
  });

  it("zdegradowany render wychodzi jako `no-store` - pustka nie zamarza na CDN", async () => {
    // Bez tego brzeg serwowałby komunikat o awarii kolejnym czytelnikom przez
    // całe okno świeżości, długo po tym, jak backend wrócił.
    h.broken.add("podcast_shows");
    await mount();

    expect(h.cacheControl.at(-1)).toContain("no-store");
  });

  it("KONTROLA DODATNIA: czysty render deklaruje politykę TREŚCI, nie no-store", async () => {
    // Bez tej pary poprzedni test przechodziłby też wtedy, gdyby trasa
    // deklarowała `no-store` ZAWSZE - a to skasowałoby cache brzegowy całej
    // sieci podcastów.
    await mount();

    expect(h.cacheControl.at(-1)).toContain("s-maxage");
    expect(h.cacheControl.at(-1)).not.toContain("no-store");
  });

  it("awaria odczytu ODCINKÓW zostawia stronę programu, tylko bez listy", async () => {
    // NAPRAWIONE 2026-09-02. Do dziś jedna flaga `degraded` obsługiwała dwie
    // różne prawdy, więc blip na tabeli odcinków chował CAŁĄ stronę programu -
    // tytuł, opis, okładkę, linki subskrypcji i kanał RSS - mimo że odczyt
    // tożsamości SIĘ UDAŁ i komentarz loadera mówi wprost „lista odcinków jest
    // wtórna". Czytelnik i crawler tracili wtedy stronę, którą serwer w pełni
    // znał, a jedyne, czego naprawdę brakowało, to lista pod nagłówkiem.
    h.broken.add("podcasts");
    await mount();

    await waitFor(() =>
      expect(
        screen.getByRole("heading", { level: 1, name: "Europa o energii" }),
      ).toBeInTheDocument(),
    );
    // Tożsamość programu zostaje w komplecie - w tym droga do subskrypcji.
    expect(screen.getByText("Cykl o polityce energetycznej Unii.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /RSS/ })).toHaveAttribute(
      "href",
      `/podcasts/${SLUG}/rss.xml`,
    );
    // Na miejscu listy stoi UCZCIWY komunikat, a nie „brak opublikowanych
    // odcinków" - te dwa zdania to dwie różne prawdy dla czytelnika.
    expect(screen.getByText("Nie udało się załadować listy odcinków")).toBeInTheDocument();
    expect(screen.queryByText("Brak opublikowanych odcinków.")).toBeNull();
    // ...i taki render nie wolno utrwalić na brzegu CDN.
    expect(h.cacheControl.at(-1)).toContain("no-store");
  });

  it("po angielsku komunikat o nieudanej liście odcinków jest angielski", async () => {
    await i18n.changeLanguage("en");
    setClientLang("en");
    h.broken.add("podcasts");
    await mount();

    await waitFor(() =>
      expect(screen.getByText("Couldn't load the episode list")).toBeInTheDocument(),
    );
  });

  it("loader dopisuje nagłówek HTTP Link z preloadem okładki (LCP)", async () => {
    // Preload rusza z nagłówków odpowiedzi, zanim parser dojdzie do <img>,
    // i musi wskazywać TEN SAM wariant, który strona maluje.
    await mount();

    expect(h.linkHeaders.some((value) => value.includes('as="image"'))).toBe(true);
  });

  it("program bez okładki NIE dopisuje pustego preloadu", async () => {
    // Kontrola dodatnia dla poprzedniego przypadku: nagłówek `Link` z pustym
    // adresem to zmarnowane połączenie na ścieżce krytycznej.
    h.shows = [show({ cover_image_url: null })];
    await mount();

    expect(h.linkHeaders).toEqual([]);
  });
});

describe("trasa /podcasts/$show - izolacja obszarów roboczych", () => {
  it("program innego obszaru daje 404, a nie swój tytuł na tym hoście", async () => {
    h.shows = [show({ tenant_id: TENANT_B, title_pl: "Program obcego obszaru" })];
    await mount();

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Nie znaleziono strony" })).toBeInTheDocument(),
    );
    expect(screen.queryByText("Program obcego obszaru")).toBeNull();
  });

  it("KONTROLA DODATNIA: ten sam slug na własnym hoście renderuje się normalnie", async () => {
    // Bez tej pary poprzedni test przechodziłby też wtedy, gdyby trasa nie
    // renderowała NICZEGO - a to nie jest izolacja, tylko awaria.
    h.shows = [show({ tenant_id: TENANT_B, title_pl: "Program obcego obszaru" })];
    h.episodes = [];
    h.tenantId = TENANT_B;
    await mount();

    expect(
      screen.getByRole("heading", { level: 1, name: "Program obcego obszaru" }),
    ).toBeInTheDocument();
  });

  it("odcinek obcego obszaru nie dokleja się do listy tego programu", async () => {
    // Odcinki są wybierane po `show_id`, a identyfikator jest globalny - gdyby
    // odczyt wypadł z polityki publicznej, w programie tego hosta pojawiłby się
    // cudzy odcinek z linkiem do cudzej strony.
    h.episodes = [
      episode(),
      episode({
        id: "99999999-9999-4999-8999-999999999999",
        tenant_id: TENANT_B,
        slug: "odcinek-obcy",
        title_pl: "Odcinek obcego obszaru",
      }),
    ];
    await mount();

    expect(screen.getByRole("link", { name: /Zima bez gazu/ })).toBeInTheDocument();
    expect(screen.queryByText("Odcinek obcego obszaru")).toBeNull();
  });
});

describe("trasa /podcasts/$show - nagłówek dokumentu", () => {
  it("po polsku tytuł, opis i oba kanały RSS pochodzą z programu", async () => {
    const head = headFor({ show: show(), degraded: false, coverPreload: null });

    expect(headTitle(head)).toBe("Europa o energii - podcast");
    expect(metaContent(head, "name", "description")).toBe("Cykl o polityce energetycznej Unii.");
    expect(metaContent(head, "property", "og:type")).toBe("website");
    expect(metaContent(head, "httpEquiv", "content-language")).toBe("pl");
    // Kolejność ma znaczenie: kanał programu jest PIERWSZY, bo czytnik dodaje
    // zwykle pierwszy ogłoszony kanał, a subskrybent tej strony chce tę serię.
    expect(feedTitles(head)).toEqual([
      "Europa o energii - RSS",
      "Podcast NES - RSS (wszystkie programy)",
    ]);
  });

  it("na adresie /en opis i kanał sieciowy są angielskie", async () => {
    // `head()` biegnie POZA drzewem Reacta (SSR składa metadane przed
    // hydracją), więc o języku rozstrzyga wyłącznie prefiks adresu.
    h.requestUrl = `https://nes.example.org/en/podcasts/${SLUG}`;
    const head = headFor({ show: show(), degraded: false, coverPreload: null });

    expect(headTitle(head)).toBe("Europe on energy - podcast");
    expect(metaContent(head, "name", "description")).toBe("A series on the Union's energy policy.");
    expect(metaContent(head, "httpEquiv", "content-language")).toBe("en");
    expect(feedTitles(head)).toEqual([
      "Europe on energy - RSS",
      "NES Podcast - RSS (all programs)",
    ]);
  });

  it("program bez opisu dostaje zdanie zapasowe w JĘZYKU STRONY", async () => {
    // Pusty `description` w wyniku wyszukiwania to wynik bez zajawki, a zajawka
    // decyduje o kliknięciu.
    const bare = show({ description_pl: "", description_en: "" });

    expect(
      metaContent(
        headFor({ show: bare, degraded: false, coverPreload: null }),
        "name",
        "description",
      ),
    ).toBe("Program podcastowy: Europa o energii.");

    h.requestUrl = `https://nes.example.org/en/podcasts/${SLUG}`;
    expect(
      metaContent(
        headFor({ show: bare, degraded: false, coverPreload: null }),
        "name",
        "description",
      ),
    ).toBe("Europe on energy - podcast program.");
  });

  it("JSON-LD opisuje SERIĘ i wskazuje kanał programu", async () => {
    const head = headFor({ show: show(), degraded: false, coverPreload: null });
    const jsonLd = (head.scripts ?? []).find((s) => s.type === "application/ld+json");
    const parsed: unknown = JSON.parse(jsonLd?.children ?? "null");

    expect(parsed).toMatchObject({
      "@type": "PodcastSeries",
      name: "Europa o energii",
      description: "Cykl o polityce energetycznej Unii.",
      webFeed: `/podcasts/${SLUG}/rss.xml`,
    });
  });

  it("nagłówek renderu ZDEGRADOWANEGO nie obiecuje treści, której nie ma", async () => {
    // Loader zdegradowany oddaje `show: null`, więc `head()` nie ma czym
    // wypełnić tytułu ani opisu. Kontrakt: neutralny tytuł i ZERO danych
    // strukturalnych - węzeł `PodcastSeries` bez nazwy serii byłby kłamstwem
    // w grafie wiedzy, a nie brakiem danych.
    const head = headFor({ show: null, degraded: true, coverPreload: null });

    expect(headTitle(head)).toBe("Podcast");
    expect(head.scripts ?? []).toEqual([]);
  });

  it("bez danych loadera `head()` bierze slug ze ŚCIEŻKI, a nie z pustki", async () => {
    // `head()` bywa wołane bez ładunku (przerwana nawigacja, 404) - i wtedy
    // jedynym znanym wejściem jest parametr ścieżki.
    h.requestUrl = "";
    const head = routeHead(ShowRoute, { params: { show: SLUG } });

    expect(headTitle(head)).toBe("Podcast");
  });
});

// ── N5: LICZBA ZAPYTAŃ NA PIERWSZYM MALOWANIU ───────────────────────────────
//
// POMIAR, NIE OPINIA. `measureFirstPaint` rozdziela dwie fale tego samego
// wczytania: odczyty LOADERA (serwer, przed pierwszym bajtem HTML) i odczyty
// KLIENTA (start na montażu, czyli round-tripy PO hydratacji, każdy z pełnym
// opóźnieniem sieci czytelnika). Rozdzielenie działa, bo loader zasiewa cache
// zapytań, a ten jedzie do przeglądarki w dehydrowanym ładunku SSR - świeży
// wpis nie jest ponawiany na montażu.
//
// ZMIERZONE PRZED ZMIANĄ: loader 2 odczyty (program, odcinki), klient 1
// (`podcast_episode_people`). ZMIERZONE PO ZMIANIE: loader 3, klient 0.
//
// Trasa nie ma treści za bramką subskrybenta ani stanu odtwarzania - cała
// zawartość strony programu jest publiczna, więc żadne z jej zapytań nie MUSI
// być klienckie. Ta zapadka stoi na zerze i to jest jej sens: dopisanie tu
// `useQuery` bez zasiewu w loaderze ma wywalić test, a nie przejść niezauważone.
interface FirstPaintMeasurement {
  loaderReads: string[];
  clientReads: string[];
}

type ShowLoader = (ctx: {
  context: { queryClient: QueryClient };
  params: { show: string };
}) => Promise<unknown>;

function showLoader(): ShowLoader {
  const loader = ShowRoute.options.loader;
  if (typeof loader !== "function") throw new Error("test: trasa nie ma loadera");
  return loader as ShowLoader;
}

async function measureFirstPaint(slug = SLUG): Promise<FirstPaintMeasurement> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await showLoader()({ context: { queryClient }, params: { show: slug } });
  const loaderReads = [...h.reads];

  const view = await mount(slug, queryClient);
  await screen.findByRole("heading", { level: 1 });
  // Zapytania klienckie startują w efektach montażu - czekamy, aż cache
  // przestanie się zmieniać, inaczej pomiar liczyłby mniej, niż strona robi.
  await waitFor(() => expect(view.queryClient.isFetching()).toBe(0));

  return { loaderReads, clientReads: h.reads.slice(loaderReads.length) };
}

describe("trasa /podcasts/$show - zapadka na liczbie zapytań pierwszego malowania", () => {
  it("nie robi ANI JEDNEGO zapytania klienckiego na pierwszym malowaniu", async () => {
    h.people = [personRow()];
    const { clientReads } = await measureFirstPaint();

    expect(clientReads, `odczyty klienta: ${clientReads.join(", ")}`).toEqual([]);
  });

  it("loader zasiewa program, odcinki I prowadzących serii", async () => {
    // Bez zasiewu prowadzących lista stałej obsady dojeżdża PO hydratacji:
    // crawler jej nie widzi, a czytelnik widzi przeskok układu.
    h.people = [personRow()];
    const { loaderReads } = await measureFirstPaint();

    expect(loaderReads).toEqual([
      "podcast_shows:slug",
      "podcasts:show_id",
      "podcast_episode_people",
    ]);
  });

  it("program BEZ odcinków nie pyta o prowadzących - nie ma o kogo pytać", async () => {
    // Zapytanie o uczestników pustej listy odcinków to round-trip po nic.
    h.episodes = [];
    const { loaderReads, clientReads } = await measureFirstPaint();

    expect(loaderReads).toEqual(["podcast_shows:slug", "podcasts:show_id"]);
    expect(clientReads).toEqual([]);
  });
});
