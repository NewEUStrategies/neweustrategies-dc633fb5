// Kliencka warstwa danych panelu podcastów - kontrakt zapytań i zapisów.
//
// CO DOWODZI TEN PLIK. Do 02.09.2026 wszystkie zapytania panelu podcastów
// mieszkały w `routes/admin.podcasts.tsx` (2072 linie, 205 funkcji) i miały
// 0% pokrycia: pisały do pięciu tabel, a nie istniał ani jeden test, który
// wykonałby choć jedną z nich. Po wyciągnięciu do `lib/podcast/queries.ts`
// każde zapytanie jest funkcją, więc da się sprawdzić TO, CO NAPRAWDĘ POLECIAŁO
// DO BAZY - nie tylko to, co atrapa oddała.
//
// KONSEKWENCJA DEFEKTU, którego ten plik pilnuje:
//   * zniknięcie `.is("deleted_at", null)` -> „Usuń" w panelu wygląda jak brak
//     reakcji, bo usunięty odcinek zostaje na liście;
//   * zamiana kolejności DELETE/INSERT uczestników -> zapis odcinka wymazuje
//     obsadę, którą właśnie wstawił;
//   * literówka w kluczu inwalidacji -> panel po zapisie pokazuje stare dane;
//   * brak `tenant_id` w INSERT -> wiersz, którego żadna polityka RLS nigdy
//     nie pokaże (i którego nie widać nawet w panelu, co go stworzył);
//   * potraktowanie PGRST116 jako awarii -> panel ustawień nie startuje na
//     tenancie, który jeszcze nic nie zapisał.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Czystego kształtowania payloadów
// (`shape.ts` ma własny plik z tabelą przypadków), izolacji tenantów przy
// ODCZYCIE (to własność RLS i nagłówka `x-tenant-host`, dowodzona w pgTAP,
// nie w atrapie) ani renderu panelu (`routes/__tests__/adminPodcastsRoute`).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fail, ok, supabaseFromStub, type SupabaseResult } from "@/test/supabaseChain";
import { renderHookWithQueryClient } from "@/test/renderWithQueryClient";
import { waitFor } from "@testing-library/react";
import type { Podcast, PodcastShow } from "@/lib/podcast/types";
import type { EpisodeBundle, PersonDraft } from "@/lib/podcast/shape";
import { mergePodcastSettings, newEpisodeDraft, newShowDraft } from "@/lib/podcast/shape";

const h = vi.hoisted(() => ({
  toastSuccess: vi.fn<(message: string) => void>(),
  toastError: vi.fn<(message: string) => void>(),
}));
const stubs = vi.hoisted(() => ({ from: null as unknown }));

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub: makeStub } = await import("@/test/supabaseChain");
  const from = makeStub();
  stubs.from = from;
  return { supabase: { from: from.from } };
});
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
// Toasty panelu są słownikiem: asercja idzie po ZNACZNIKU, nie po napisie,
// bo napis zmienia każda korekta tłumaczenia, a znaczenie nie.
vi.mock("@/lib/adminToasts", () => ({
  adminToast: {
    saved: () => "adminToast.saved",
    deleted: () => "adminToast.deleted",
    settingsSaved: () => "adminToast.settingsSaved",
  },
}));

const db = () => stubs.from as ReturnType<typeof supabaseFromStub>;

const {
  ADMIN_PODCAST_ROW_FIELDS,
  adminPodcastKeys,
  fetchAdminEpisodePeople,
  fetchAdminPodcast,
  fetchAdminPodcastCategories,
  fetchAdminPodcastFeedEpisodes,
  fetchAdminPodcastProfiles,
  fetchAdminPodcastRows,
  fetchAdminPodcastSettings,
  fetchAdminPodcastShows,
  publicPodcastKeys,
  adminPodcastFeedEpisodesQueryOptions,
  adminPodcastRowsQueryOptions,
  adminPodcastSettingsQueryOptions,
  adminPodcastShowsQueryOptions,
  saveAdminEpisode,
  saveAdminPodcastSettings,
  saveAdminShow,
  softDeleteAdminEpisode,
  softDeleteAdminShow,
  useAdminEpisodePeople,
  useAdminPodcastCategories,
  useAdminPodcastFeedEpisodes,
  useAdminPodcastProfiles,
  useAdminPodcastRows,
  useAdminPodcastSettings,
  useAdminPodcastShows,
  useLoadAdminPodcast,
  useSaveAdminEpisode,
  useSaveAdminPodcastSettings,
  useSaveAdminShow,
  useSoftDeleteAdminEpisode,
  useSoftDeleteAdminShow,
} = await import("@/lib/podcast/queries");

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const EPISODE_ID = "22222222-2222-4222-8222-222222222222";
const SHOW_ID = "33333333-3333-4333-8333-333333333333";
const NEW_EPISODE_ID = "44444444-4444-4444-8444-444444444444";

/** Komunikaty odmowy - w produkcji wchodzą z `t()`, tu jako rozpoznawalne znaczniki. */
const MESSAGES = {
  slug: "adminPodcasts.errors.slug",
  audio: "adminPodcasts.errors.audio",
  tenant: "adminPodcasts.errors.tenant",
};

/** Wszystkie ogniwa danej nazwy w OSTATNIM łańcuchu tabeli, w kolejności. */
function callsOf(table: string, method: string): unknown[][] {
  return (db().lastChain(table)?.calls ?? [])
    .filter((call) => call.method === method)
    .map((call) => [...call.args]);
}

/** Nazwy ogniw łańcucha - do asercji KOLEJNOŚCI operacji. */
function methods(table: string, index = -1): string[] {
  return (db().chainsFor(table).at(index)?.calls ?? []).map((call) => call.method);
}

/** Odcinek gotowy do zapisu (audio + tytuł, więc slug się wyliczy). */
function bundleFor(overrides: Partial<Podcast> = {}, people: PersonDraft[] = []): EpisodeBundle {
  return {
    episode: {
      ...newEpisodeDraft("2026-01-01T00:00:00.000Z"),
      title_pl: "Sondaz na Baltyku",
      audio_url: "https://cdn.example.org/odc-1.mp3",
      ...overrides,
    },
    chapters: [],
    quotes: [],
    resources: [],
    people,
  };
}

beforeEach(() => {
  db().reset();
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Klucze cache
// ---------------------------------------------------------------------------

describe("fabryki kluczy", () => {
  it("odtwarzają DOKŁADNIE klucze, które panel miał przed ekstrakcją", () => {
    // Klucz jest kontraktem między odczytem i inwalidacją ORAZ między panelem
    // i publiczną warstwą - zmiana choćby jednego członu rozspaja cache i panel
    // po zapisie pokazuje stan sprzed zapisu.
    expect(adminPodcastKeys.episodes()).toEqual(["admin", "podcasts"]);
    expect(adminPodcastKeys.shows()).toEqual(["admin", "podcast-shows"]);
    expect(adminPodcastKeys.settings()).toEqual(["admin", "podcast-settings"]);
    expect(adminPodcastKeys.feedEpisodes()).toEqual(["admin", "podcast-feed-episodes"]);
    expect(adminPodcastKeys.categories()).toEqual(["admin", "podcast-categories"]);
    expect(adminPodcastKeys.profiles()).toEqual(["admin", "podcast-profiles"]);
    expect(adminPodcastKeys.people(EPISODE_ID)).toEqual(["admin", "podcast-people", EPISODE_ID]);
  });

  it("klucz uczestników jest per odcinek, a nie wspólny dla całego panelu", () => {
    // Wspólny klucz pokazałby obsadę odcinka A w edytorze odcinka B.
    expect(adminPodcastKeys.people(EPISODE_ID)).not.toEqual(adminPodcastKeys.people(SHOW_ID));
  });

  it("publiczne prefiksy są rozłączne z panelowymi", () => {
    expect(publicPodcastKeys.episodes()).toEqual(["podcasts"]);
    expect(publicPodcastKeys.shows()).toEqual(["podcast-shows"]);
    expect(publicPodcastKeys.people()).toEqual(["podcast-people"]);
    expect(publicPodcastKeys.settings()).toEqual(["podcast-settings"]);
    expect(publicPodcastKeys.episodes()[0]).not.toBe(adminPodcastKeys.episodes()[0]);
  });
});

// ---------------------------------------------------------------------------
// Odczyty
// ---------------------------------------------------------------------------

describe("fetchAdminPodcastRows", () => {
  it("czyta z podcasts dokładnie kolumny listy panelu", async () => {
    db().setResponse("podcasts", ok([]));
    await fetchAdminPodcastRows();
    expect(db().lastChain("podcasts")?.table).toBe("podcasts");
    expect(callsOf("podcasts", "select")).toEqual([[ADMIN_PODCAST_ROW_FIELDS]]);
    // Lista panelu potrzebuje `published_at` i `show_id` - bez nich kolumna
    // „Program" i plakietka statusu nie mają z czego się zrobić.
    expect(ADMIN_PODCAST_ROW_FIELDS.split(",")).toEqual([
      "id",
      "slug",
      "title_pl",
      "title_en",
      "status",
      "duration_seconds",
      "episode_number",
      "season",
      "audio_url",
      "cover_image_url",
      "published_at",
      "show_id",
    ]);
  });

  it("ODSIEWA odcinki soft-usunięte i sortuje od najnowszego", async () => {
    // Najważniejsza asercja tego bloku: bez `is(deleted_at, null)` „Usuń"
    // wygląda w panelu jak brak reakcji.
    db().setResponse("podcasts", ok([]));
    await fetchAdminPodcastRows();
    expect(callsOf("podcasts", "is")).toEqual([["deleted_at", null]]);
    expect(callsOf("podcasts", "order")).toEqual([["created_at", { ascending: false }]]);
  });

  it("nie nakłada limitu (panel pokazuje całe archiwum redakcji)", async () => {
    db().setResponse("podcasts", ok([]));
    await fetchAdminPodcastRows();
    expect(db().lastChain("podcasts")?.has("limit")).toBe(false);
  });

  it("brak wiersza to pusta lista, a nie null", async () => {
    db().setResponse("podcasts", ok(null));
    await expect(fetchAdminPodcastRows()).resolves.toEqual([]);
  });

  it("błąd bazy leci wyżej, a nie wraca jako pusta lista", async () => {
    // Pusta lista przy awarii odczytu wygląda jak „nie ma odcinków" i zaprasza
    // redakcję do stworzenia duplikatów.
    db().setResponse("podcasts", fail("permission denied for table podcasts", "42501"));
    await expect(fetchAdminPodcastRows()).rejects.toThrow("permission denied");
  });
});

describe("fetchAdminPodcastShows", () => {
  it("sortuje kolejnością redakcyjną, a dopiero potem tytułem PL", async () => {
    // Odwrócenie tych dwóch ogniw ustawia programy alfabetycznie i kasuje
    // ręczną kolejność ustawioną w panelu (`sort_order`).
    db().setResponse("podcast_shows", ok([]));
    await fetchAdminPodcastShows();
    expect(callsOf("podcast_shows", "order")).toEqual([
      ["sort_order", { ascending: true }],
      ["title_pl", { ascending: true }],
    ]);
    expect(callsOf("podcast_shows", "is")).toEqual([["deleted_at", null]]);
  });

  it("czyta pełny zestaw kolumn programu (ten sam, co warstwa publiczna)", async () => {
    db().setResponse("podcast_shows", ok([]));
    await fetchAdminPodcastShows();
    const [[fields]] = callsOf("podcast_shows", "select");
    expect(String(fields)).toContain("spotify_url");
    expect(String(fields)).toContain("sort_order");
    expect(String(fields)).toContain("tenant_id");
  });

  it("błąd bazy leci wyżej", async () => {
    db().setResponse("podcast_shows", fail("relation does not exist", "42P01"));
    await expect(fetchAdminPodcastShows()).rejects.toThrow("relation does not exist");
  });
});

describe("fetchAdminPodcastSettings", () => {
  it("czyta singleton przez maybeSingle bez filtra tenanta (RLS per host)", async () => {
    db().setResponse("podcast_settings", ok(null));
    await fetchAdminPodcastSettings();
    expect(methods("podcast_settings")).toEqual(["select", "maybeSingle"]);
    expect(callsOf("podcast_settings", "select")).toEqual([["*"]]);
  });

  it("PGRST116 (brak wiersza) NIE jest awarią - zwraca null", async () => {
    // Tenant, który nigdy nie zapisał ustawień, musi móc wejść w panel.
    db().setResponse("podcast_settings", fail("no rows returned", "PGRST116"));
    await expect(fetchAdminPodcastSettings()).resolves.toBeNull();
  });

  it("każdy inny błąd leci wyżej", async () => {
    db().setResponse("podcast_settings", fail("permission denied", "42501"));
    await expect(fetchAdminPodcastSettings()).rejects.toThrow("permission denied");
  });
});

describe("fetchAdminPodcastFeedEpisodes", () => {
  beforeEach(() => {
    db().setResponse("podcasts", (chain) =>
      chain.has("select")
        ? ok([
            { audio_url: "https://cdn.example.org/a.mp3", duration_seconds: 600 },
            { audio_url: "https://cdn.example.org/b.mp3", duration_seconds: 0 },
          ])
        : ok(null),
    );
  });

  it("bierze wyłącznie opublikowane, nieusunięte odcinki Z PLIKIEM, max 500", async () => {
    db().setResponse("media", ok([]));
    await fetchAdminPodcastFeedEpisodes();
    expect(callsOf("podcasts", "eq")).toEqual([["status", "published"]]);
    expect(callsOf("podcasts", "is")).toEqual([["deleted_at", null]]);
    expect(callsOf("podcasts", "not")).toEqual([["audio_url", "is", null]]);
    expect(callsOf("podcasts", "limit")).toEqual([[500]]);
  });

  it("dopytuje bibliotekę mediów o rozmiary DOKŁADNIE tych adresów", async () => {
    db().setResponse("media", ok([]));
    await fetchAdminPodcastFeedEpisodes();
    expect(callsOf("media", "in")).toEqual([
      ["public_url", ["https://cdn.example.org/a.mp3", "https://cdn.example.org/b.mp3"]],
    ]);
  });

  it("łączy rozmiar pliku z czasem trwania i liczy braki", async () => {
    db().setResponse(
      "media",
      ok([{ public_url: "https://cdn.example.org/a.mp3", size_bytes: 4096 }]),
    );
    const summary = await fetchAdminPodcastFeedEpisodes();
    // b.mp3 nie ma wpisu w mediach (brak rozmiaru) i ma zerowy czas trwania.
    expect(summary).toEqual({ total: 2, withoutByteLength: 1, withoutDuration: 1 });
  });

  it("AWARIA biblioteki mediów degraduje kartę, a nie wywraca panelu", async () => {
    // Rozmiar pliku to ostrzeżenie w karcie gotowości, nie warunek wejścia
    // do ustawień - dlatego błąd tego zapytania jest świadomie ignorowany.
    db().setResponse("media", fail("permission denied for table media", "42501"));
    const summary = await fetchAdminPodcastFeedEpisodes();
    expect(summary).toEqual({ total: 2, withoutByteLength: 2, withoutDuration: 1 });
  });

  it("awaria odczytu odcinków leci wyżej", async () => {
    db().setResponse("podcasts", fail("statement timeout", "57014"));
    db().setResponse("media", ok([]));
    await expect(fetchAdminPodcastFeedEpisodes()).rejects.toThrow("statement timeout");
  });
});

describe("fetchAdminPodcastCategories i fetchAdminPodcastProfiles", () => {
  it("kategorie sortują się po nazwie PL, bez obiektu opcji", async () => {
    db().setResponse("categories", ok([]));
    await fetchAdminPodcastCategories();
    expect(callsOf("categories", "select")).toEqual([["id, name_pl, name_en"]]);
    expect(callsOf("categories", "order")).toEqual([["name_pl"]]);
  });

  it("profile mają limit 500 - selektor gościa nie ciągnie całej bazy osób", async () => {
    db().setResponse("profiles", ok([]));
    await fetchAdminPodcastProfiles();
    expect(callsOf("profiles", "select")).toEqual([["id, display_name, slug"]]);
    expect(callsOf("profiles", "order")).toEqual([["display_name"]]);
    expect(callsOf("profiles", "limit")).toEqual([[500]]);
  });

  it("błędy obu odczytów lecą wyżej", async () => {
    db().setResponse("categories", fail("boom", "XX000"));
    db().setResponse("profiles", fail("boom", "XX000"));
    await expect(fetchAdminPodcastCategories()).rejects.toThrow("boom");
    await expect(fetchAdminPodcastProfiles()).rejects.toThrow("boom");
  });
});

describe("fetchAdminEpisodePeople", () => {
  it("filtruje po odcinku i zachowuje kolejność redakcyjną", async () => {
    db().setResponse("podcast_episode_people", ok([]));
    await fetchAdminEpisodePeople(EPISODE_ID);
    expect(callsOf("podcast_episode_people", "eq")).toEqual([["episode_id", EPISODE_ID]]);
    expect(callsOf("podcast_episode_people", "order")).toEqual([
      ["sort_order", { ascending: true }],
    ]);
  });

  it("błąd bazy leci wyżej", async () => {
    db().setResponse("podcast_episode_people", fail("boom", "XX000"));
    await expect(fetchAdminEpisodePeople(EPISODE_ID)).rejects.toThrow("boom");
  });
});

describe("fetchAdminPodcast", () => {
  it("czyta jeden odcinek po id pełnym zestawem kolumn", async () => {
    db().setResponse("podcasts", ok({ id: EPISODE_ID, slug: "odc-1" }));
    const episode = await fetchAdminPodcast(EPISODE_ID);
    expect(callsOf("podcasts", "eq")).toEqual([["id", EPISODE_ID]]);
    expect(methods("podcasts")).toEqual(["select", "eq", "maybeSingle"]);
    const [[fields]] = callsOf("podcasts", "select");
    expect(String(fields)).toContain("transcript_pl");
    expect(String(fields)).toContain("episode_type");
    expect(episode.slug).toBe("odc-1");
  });

  it("brak wiersza to WYJĄTEK, nie pusty edytor", async () => {
    // Otwarcie edytora na `null` zapisałoby nowy wiersz przy pierwszym
    // „Zapisz" - czyli duplikat odcinka, który tylko wyglądał na edytowany.
    db().setResponse("podcasts", ok(null));
    await expect(fetchAdminPodcast(EPISODE_ID)).rejects.toThrow("Not found");
  });

  it("błąd bazy wygrywa nad komunikatem zapasowym", async () => {
    db().setResponse("podcasts", fail("permission denied", "42501"));
    await expect(fetchAdminPodcast(EPISODE_ID)).rejects.toThrow("permission denied");
  });
});

// ---------------------------------------------------------------------------
// Zapis odcinka
// ---------------------------------------------------------------------------

describe("saveAdminEpisode - odmowa przed bazą", () => {
  it("odcinek bez sluga i bez tytułu NIE puka do bazy", async () => {
    const bundle = bundleFor({ slug: "", title_pl: "" });
    await expect(
      saveAdminEpisode({ bundle, tenantId: TENANT_ID, messages: MESSAGES }),
    ).rejects.toThrow(MESSAGES.slug);
    expect(db().chains).toEqual([]);
  });

  it("odcinek bez pliku audio NIE puka do bazy", async () => {
    const bundle = bundleFor({ audio_url: "" });
    await expect(
      saveAdminEpisode({ bundle, tenantId: TENANT_ID, messages: MESSAGES }),
    ).rejects.toThrow(MESSAGES.audio);
    expect(db().chains).toEqual([]);
  });

  it("brak tenanta odmawia zapisu ZAWSZE - także przy edycji istniejącego", async () => {
    // Asymetria wobec programu jest zamierzona (patrz test programu niżej):
    // wiersz odcinka bez tenanta nie ma polityki, która by go pokazała.
    const bundle = bundleFor({ id: EPISODE_ID });
    await expect(saveAdminEpisode({ bundle, tenantId: null, messages: MESSAGES })).rejects.toThrow(
      MESSAGES.tenant,
    );
    expect(db().chains).toEqual([]);
  });
});

describe("saveAdminEpisode - nowy odcinek", () => {
  function planHappyPath() {
    db().setResponse("podcasts", (chain) =>
      chain.has("insert") ? ok({ id: NEW_EPISODE_ID }) : ok(null),
    );
    db().setResponse("podcast_episode_people", ok(null));
  }

  it("wstawia wiersz Z TENANTEM i odczytuje nadane id", async () => {
    planHappyPath();
    await saveAdminEpisode({ bundle: bundleFor(), tenantId: TENANT_ID, messages: MESSAGES });
    const [[payload]] = callsOf("podcasts", "insert");
    expect(payload).toMatchObject({ tenant_id: TENANT_ID, slug: "sondaz-na-baltyku" });
    expect(methods("podcasts")).toEqual(["insert", "select", "single"]);
    expect(callsOf("podcasts", "select")).toEqual([["id"]]);
  });

  it("przypina uczestników do NADANEGO id, z tenantem i kolejnością", async () => {
    planHappyPath();
    await saveAdminEpisode({
      bundle: bundleFor({}, [
        { profile_id: null, display_name: "  Zofia Wrzos  ", role: "host", url: " " },
        { profile_id: SHOW_ID, display_name: "", role: "guest", url: "https://example.org/x" },
        // Wiersz-widmo: ani profilu, ani nazwiska - odpada przed bazą.
        { profile_id: null, display_name: "", role: "guest", url: "" },
      ]),
      tenantId: TENANT_ID,
      messages: MESSAGES,
    });
    const [[rows]] = callsOf("podcast_episode_people", "insert");
    expect(rows).toEqual([
      {
        tenant_id: TENANT_ID,
        episode_id: NEW_EPISODE_ID,
        profile_id: null,
        display_name: "Zofia Wrzos",
        role: "host",
        url: null,
        sort_order: 0,
      },
      {
        tenant_id: TENANT_ID,
        episode_id: NEW_EPISODE_ID,
        profile_id: SHOW_ID,
        display_name: "",
        role: "guest",
        url: "https://example.org/x",
        sort_order: 1,
      },
    ]);
  });

  it("czyści obsadę PRZED wstawieniem nowej, nie po", async () => {
    // Odwrócona kolejność wymazuje właśnie wstawione wiersze i odcinek traci
    // prowadzącego przy każdym zapisie.
    planHappyPath();
    await saveAdminEpisode({
      bundle: bundleFor({}, [
        { profile_id: null, display_name: "Igor Nowak", role: "host", url: "" },
      ]),
      tenantId: TENANT_ID,
      messages: MESSAGES,
    });
    const chains = db().chainsFor("podcast_episode_people");
    expect(chains.map((chain) => chain.calls[0]?.method)).toEqual(["delete", "insert"]);
    expect(callsOf("podcast_episode_people", "eq")).toEqual([]);
    expect(chains[0]?.argsOf("eq")).toEqual(["episode_id", NEW_EPISODE_ID]);
  });

  it("pusta obsada kończy się na DELETE - żadnego INSERT z pustą tablicą", async () => {
    planHappyPath();
    await saveAdminEpisode({ bundle: bundleFor(), tenantId: TENANT_ID, messages: MESSAGES });
    const chains = db().chainsFor("podcast_episode_people");
    expect(chains).toHaveLength(1);
    expect(chains[0]?.has("delete")).toBe(true);
  });

  it("błąd INSERT odcinka przerywa zapis PRZED dotknięciem obsady", async () => {
    db().setResponse("podcasts", fail("null value in column tenant_id", "23502"));
    db().setResponse("podcast_episode_people", ok(null));
    await expect(
      saveAdminEpisode({ bundle: bundleFor(), tenantId: TENANT_ID, messages: MESSAGES }),
    ).rejects.toThrow("null value in column tenant_id");
    expect(db().chainsFor("podcast_episode_people")).toEqual([]);
  });
});

describe("saveAdminEpisode - istniejący odcinek", () => {
  it("aktualizuje po id i NIE wysyła tenant_id w payloadzie", async () => {
    // `tenant_id` w UPDATE byłby próbą przeniesienia wiersza między najemcami -
    // RLS to odrzuci, ale panel nie ma nawet o to pytać.
    db().setResponse("podcasts", ok(null));
    db().setResponse("podcast_episode_people", ok(null));
    await saveAdminEpisode({
      bundle: bundleFor({ id: EPISODE_ID, slug: "Odc 1 " }),
      tenantId: TENANT_ID,
      messages: MESSAGES,
    });
    const [[payload]] = callsOf("podcasts", "update");
    expect(payload).not.toHaveProperty("tenant_id");
    expect(payload).toMatchObject({ slug: "odc-1" });
    expect(callsOf("podcasts", "eq")).toEqual([["id", EPISODE_ID]]);
    expect(methods("podcasts")).toEqual(["update", "eq"]);
  });

  it("payload niesie DOKŁADNIE 23 pola wiersza odcinka", async () => {
    db().setResponse("podcasts", ok(null));
    db().setResponse("podcast_episode_people", ok(null));
    await saveAdminEpisode({
      bundle: bundleFor({ id: EPISODE_ID }),
      tenantId: TENANT_ID,
      messages: MESSAGES,
    });
    const [[payload]] = callsOf("podcasts", "update");
    expect(Object.keys(payload as Record<string, unknown>).sort()).toEqual([
      "audio_url",
      "category_id",
      "chapters",
      "cover_image_url",
      "duration_seconds",
      "episode_number",
      "episode_type",
      "excerpt_en",
      "excerpt_pl",
      "explicit",
      "published_at",
      "quotes",
      "resources",
      "season",
      "show_id",
      "show_notes_en",
      "show_notes_pl",
      "slug",
      "status",
      "title_en",
      "title_pl",
      "transcript_en",
      "transcript_pl",
    ]);
  });

  it("błąd UPDATE przerywa zapis PRZED dotknięciem obsady", async () => {
    db().setResponse("podcasts", fail("new row violates row-level security policy", "42501"));
    db().setResponse("podcast_episode_people", ok(null));
    await expect(
      saveAdminEpisode({
        bundle: bundleFor({ id: EPISODE_ID }),
        tenantId: TENANT_ID,
        messages: MESSAGES,
      }),
    ).rejects.toThrow("row-level security");
    expect(db().chainsFor("podcast_episode_people")).toEqual([]);
  });

  it("błąd DELETE obsady przerywa zapis PRZED wstawieniem nowej", async () => {
    db().setResponse("podcasts", ok(null));
    db().setResponse("podcast_episode_people", (chain) =>
      chain.has("delete") ? fail("permission denied", "42501") : ok(null),
    );
    await expect(
      saveAdminEpisode({
        bundle: bundleFor({ id: EPISODE_ID }, [
          { profile_id: null, display_name: "Anna Bór", role: "guest", url: "" },
        ]),
        tenantId: TENANT_ID,
        messages: MESSAGES,
      }),
    ).rejects.toThrow("permission denied");
    expect(db().chainsFor("podcast_episode_people")).toHaveLength(1);
  });

  it("błąd INSERT obsady leci wyżej (odcinek jest już zapisany)", async () => {
    db().setResponse("podcasts", ok(null));
    db().setResponse("podcast_episode_people", (chain) =>
      chain.has("insert") ? fail("violates check constraint", "23514") : ok(null),
    );
    await expect(
      saveAdminEpisode({
        bundle: bundleFor({ id: EPISODE_ID }, [
          { profile_id: null, display_name: "Anna Bór", role: "guest", url: "" },
        ]),
        tenantId: TENANT_ID,
        messages: MESSAGES,
      }),
    ).rejects.toThrow("violates check constraint");
  });
});

describe("softDeleteAdminEpisode", () => {
  it("to UPDATE znacznika czasu, nie DELETE wiersza", async () => {
    // Twardy DELETE zabrałby też uczestników i statystyki odsłuchań, a panel
    // nie ma ekranu przywracania - stąd soft-delete.
    db().setResponse("podcasts", ok(null));
    await softDeleteAdminEpisode(EPISODE_ID, "2026-09-02T10:00:00.000Z");
    expect(methods("podcasts")).toEqual(["update", "eq"]);
    expect(callsOf("podcasts", "update")).toEqual([[{ deleted_at: "2026-09-02T10:00:00.000Z" }]]);
    expect(callsOf("podcasts", "eq")).toEqual([["id", EPISODE_ID]]);
    expect(db().lastChain("podcasts")?.has("delete")).toBe(false);
  });

  it("błąd bazy leci wyżej", async () => {
    db().setResponse("podcasts", fail("permission denied", "42501"));
    await expect(softDeleteAdminEpisode(EPISODE_ID)).rejects.toThrow("permission denied");
  });
});

// ---------------------------------------------------------------------------
// Zapis programu
// ---------------------------------------------------------------------------

describe("saveAdminShow", () => {
  const show = (overrides: Partial<PodcastShow> = {}): PodcastShow => ({
    ...newShowDraft(0, "2026-01-01T00:00:00.000Z"),
    title_pl: "Raport Baltycki",
    ...overrides,
  });

  it("program bez sluga i bez tytułu NIE puka do bazy", async () => {
    await expect(
      saveAdminShow({
        show: show({ title_pl: "", slug: "" }),
        tenantId: TENANT_ID,
        messages: MESSAGES,
      }),
    ).rejects.toThrow(MESSAGES.slug);
    expect(db().chains).toEqual([]);
  });

  it("EDYCJA istniejącego programu NIE wymaga tenanta (asymetria zamierzona)", async () => {
    // Odcinek wymaga tenanta zawsze, program tylko przy INSERT. Zaostrzenie
    // tego tutaj wywróciłoby edycję programu na koncie, któremu `useAuth`
    // jeszcze nie rozwiązał tenanta - a RLS tę edycję przepuszcza.
    db().setResponse("podcast_shows", ok(null));
    await saveAdminShow({ show: show({ id: SHOW_ID }), tenantId: null, messages: MESSAGES });
    expect(methods("podcast_shows")).toEqual(["update", "eq"]);
    expect(callsOf("podcast_shows", "eq")).toEqual([["id", SHOW_ID]]);
  });

  it("NOWY program bez tenanta jest odrzucany przed bazą", async () => {
    await expect(
      saveAdminShow({ show: show(), tenantId: null, messages: MESSAGES }),
    ).rejects.toThrow(MESSAGES.tenant);
    expect(db().chains).toEqual([]);
  });

  it("nowy program wstawia payload Z TENANTEM i puste adresy jako NULL", async () => {
    db().setResponse("podcast_shows", ok(null));
    await saveAdminShow({
      show: show({ spotify_url: "", apple_url: "https://podcasts.example.org/x" }),
      tenantId: TENANT_ID,
      messages: MESSAGES,
    });
    const [[payload]] = callsOf("podcast_shows", "insert");
    expect(payload).toMatchObject({
      tenant_id: TENANT_ID,
      slug: "raport-baltycki",
      spotify_url: null,
      apple_url: "https://podcasts.example.org/x",
      sort_order: 1,
      status: "draft",
    });
  });

  it("błąd bazy leci wyżej w obu gałęziach", async () => {
    db().setResponse("podcast_shows", fail("duplicate key value", "23505"));
    await expect(
      saveAdminShow({ show: show({ id: SHOW_ID }), tenantId: TENANT_ID, messages: MESSAGES }),
    ).rejects.toThrow("duplicate key value");
    await expect(
      saveAdminShow({ show: show(), tenantId: TENANT_ID, messages: MESSAGES }),
    ).rejects.toThrow("duplicate key value");
  });
});

describe("softDeleteAdminShow", () => {
  it("to UPDATE znacznika czasu po id", async () => {
    db().setResponse("podcast_shows", ok(null));
    await softDeleteAdminShow(SHOW_ID, "2026-09-02T10:00:00.000Z");
    expect(callsOf("podcast_shows", "update")).toEqual([
      [{ deleted_at: "2026-09-02T10:00:00.000Z" }],
    ]);
    expect(callsOf("podcast_shows", "eq")).toEqual([["id", SHOW_ID]]);
  });

  it("błąd bazy leci wyżej", async () => {
    db().setResponse("podcast_shows", fail("permission denied", "42501"));
    await expect(softDeleteAdminShow(SHOW_ID)).rejects.toThrow("permission denied");
  });
});

// ---------------------------------------------------------------------------
// Zapis ustawień kanału
// ---------------------------------------------------------------------------

describe("saveAdminPodcastSettings", () => {
  const merged = mergePodcastSettings({}, null, TENANT_ID);

  it("brak tenanta odmawia zapisu - upsert bez klucza konfliktu nie ma sensu", async () => {
    await expect(
      saveAdminPodcastSettings({ merged, tenantId: null, messages: MESSAGES }),
    ).rejects.toThrow(MESSAGES.tenant);
    expect(db().chains).toEqual([]);
  });

  it("upsert po tenant_id: pierwszy zapis TWORZY singleton, kolejny go nadpisuje", async () => {
    db().setResponse("podcast_settings", ok(null));
    await saveAdminPodcastSettings({ merged, tenantId: TENANT_ID, messages: MESSAGES });
    const [[payload, options]] = callsOf("podcast_settings", "upsert");
    expect(options).toEqual({ onConflict: "tenant_id" });
    expect(payload).toMatchObject({
      tenant_id: TENANT_ID,
      default_player_variant: "full",
      show_speed_control: true,
      itunes_type: "episodic",
      spotify_url: null,
    });
  });

  it("kategoria Apple nigdy nie idzie pusta (kanał bez kategorii jest odrzucany)", async () => {
    db().setResponse("podcast_settings", ok(null));
    await saveAdminPodcastSettings({
      merged: { ...merged, itunes_category: "" },
      tenantId: TENANT_ID,
      messages: MESSAGES,
    });
    const [[payload]] = callsOf("podcast_settings", "upsert");
    expect((payload as { itunes_category: string }).itunes_category).not.toBe("");
  });

  it("błąd bazy leci wyżej", async () => {
    db().setResponse("podcast_settings", fail("permission denied", "42501"));
    await expect(
      saveAdminPodcastSettings({ merged, tenantId: TENANT_ID, messages: MESSAGES }),
    ).rejects.toThrow("permission denied");
  });
});

// ---------------------------------------------------------------------------
// Tenant: odczyt przez RLS, zapis jawnie
// ---------------------------------------------------------------------------

describe("granica tenanta", () => {
  it("ŻADEN odczyt panelu nie filtruje tenant_id (robi to RLS przez x-tenant-host)", async () => {
    // To jest ZAPIS DECYZJI, nie luka. Przeglądarkowy klient niesie nagłówek
    // `x-tenant-host`, więc polityki rozwiązują tenanta per domena. Dołożenie
    // filtra na slepo byłoby zmianą zachowania bez dowodu; gdyby kiedyś
    // odczyty miały filtrować tenanta, ten test padnie i wymusi decyzję.
    db().setResponse("podcasts", ok([]));
    db().setResponse("podcast_shows", ok([]));
    db().setResponse("podcast_settings", ok(null));
    db().setResponse("categories", ok([]));
    db().setResponse("profiles", ok([]));
    db().setResponse("podcast_episode_people", ok([]));
    await Promise.all([
      fetchAdminPodcastRows(),
      fetchAdminPodcastShows(),
      fetchAdminPodcastSettings(),
      fetchAdminPodcastCategories(),
      fetchAdminPodcastProfiles(),
      fetchAdminEpisodePeople(EPISODE_ID),
    ]);
    const tenantFilters = db()
      .chains.flatMap((chain) => chain.calls)
      .filter((call) => call.args[0] === "tenant_id");
    expect(tenantFilters).toEqual([]);
  });

  it("KAŻDY zapis tworzący wiersz niesie tenant_id jawnie", async () => {
    db().setResponse("podcasts", (chain) =>
      chain.has("insert") ? ok({ id: NEW_EPISODE_ID }) : ok(null),
    );
    db().setResponse("podcast_episode_people", ok(null));
    db().setResponse("podcast_shows", ok(null));
    db().setResponse("podcast_settings", ok(null));
    await saveAdminEpisode({
      bundle: bundleFor({}, [{ profile_id: null, display_name: "Ewa Cis", role: "host", url: "" }]),
      tenantId: TENANT_ID,
      messages: MESSAGES,
    });
    await saveAdminShow({
      show: { ...newShowDraft(0), title_pl: "Nowa seria" },
      tenantId: TENANT_ID,
      messages: MESSAGES,
    });
    await saveAdminPodcastSettings({
      merged: mergePodcastSettings({}, null, TENANT_ID),
      tenantId: TENANT_ID,
      messages: MESSAGES,
    });
    const written = db()
      .chains.flatMap((chain) => chain.calls)
      .filter((call) => call.method === "insert" || call.method === "upsert")
      .flatMap((call) => (Array.isArray(call.args[0]) ? call.args[0] : [call.args[0]]));
    expect(written).not.toEqual([]);
    for (const row of written) {
      expect((row as { tenant_id?: string }).tenant_id).toBe(TENANT_ID);
    }
  });
});

// ---------------------------------------------------------------------------
// Hooki: klucze inwalidacji i toasty
// ---------------------------------------------------------------------------

/** Klucze przekazane do `invalidateQueries`, w kolejności wywołań. */
function invalidatedKeys(spy: { mock: { calls: readonly unknown[][] } }): unknown[] {
  return spy.mock.calls.map((call) => (call[0] as { queryKey: unknown }).queryKey);
}

describe("useAdminPodcastRows", () => {
  it("wystawia wiersze z bazy pod kluczem panelu", async () => {
    db().setResponse("podcasts", ok([{ id: EPISODE_ID, slug: "odc-1", status: "draft" }]));
    const { result, queryClient } = renderHookWithQueryClient(() => useAdminPodcastRows());
    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(queryClient.getQueryData(adminPodcastKeys.episodes())).toHaveLength(1);
  });
});

describe("useAdminEpisodePeople", () => {
  it("bez id odcinka NIE pyta bazy (nowy szkic nie ma jeszcze obsady)", async () => {
    const onLoaded = vi.fn();
    db().setResponse("podcast_episode_people", ok([]));
    renderHookWithQueryClient(() => useAdminEpisodePeople("", onLoaded));
    await waitFor(() => expect(db().chains).toEqual([]));
    expect(onLoaded).not.toHaveBeenCalled();
  });

  it("mapuje wiersze na wersje robocze JESZCZE W queryFn", async () => {
    // Mapowanie w `useEffect` na `data` dałoby jeden render z pustą obsadą -
    // a „Zapisz" w tym renderze wymazuje uczestników odcinka.
    const onLoaded = vi.fn<(drafts: PersonDraft[]) => void>();
    db().setResponse(
      "podcast_episode_people",
      ok([
        {
          id: "p1",
          profile_id: null,
          display_name: "Ewa Cis",
          role: "moderator",
          url: null,
          sort_order: 0,
        },
      ]),
    );
    renderHookWithQueryClient(() => useAdminEpisodePeople(EPISODE_ID, onLoaded));
    await waitFor(() => expect(onLoaded).toHaveBeenCalledTimes(1));
    expect(onLoaded.mock.calls[0][0]).toEqual([
      // Rola poza enumem („moderator") normalizuje się do gościa, a nie do
      // pustego selecta, który zapisałby się jako niepoprawny wiersz.
      { id: "p1", profile_id: null, display_name: "Ewa Cis", role: "guest", url: "" },
    ]);
  });
});

describe("useSaveAdminEpisode", () => {
  it("po zapisie unieważnia listę panelu ORAZ dwa prefiksy publiczne", async () => {
    db().setResponse("podcasts", (chain) =>
      chain.has("insert") ? ok({ id: NEW_EPISODE_ID }) : ok(null),
    );
    db().setResponse("podcast_episode_people", ok(null));
    const onSaved = vi.fn();
    const { result, queryClient } = renderHookWithQueryClient(() =>
      useSaveAdminEpisode({ tenantId: TENANT_ID, messages: MESSAGES, onSaved }),
    );
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    result.current.mutate(bundleFor());
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    // Publiczny prefiks `["podcast-people"]` jest tu świadomie SZERSZY niż
    // klucz panelu - strona odcinka trzyma obsadę pod nim, więc bez tego
    // czytelnik widziałby starą listę gości.
    expect(invalidatedKeys(spy)).toEqual([["admin", "podcasts"], ["podcasts"], ["podcast-people"]]);
    expect(h.toastSuccess).toHaveBeenCalledWith("adminToast.saved");
  });

  it("odmowa zapisu pokazuje KOMUNIKAT, nie surowy błąd bazy, i nie zamyka edytora", async () => {
    const onSaved = vi.fn();
    const { result } = renderHookWithQueryClient(() =>
      useSaveAdminEpisode({ tenantId: null, messages: MESSAGES, onSaved }),
    );
    result.current.mutate(bundleFor());
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith(MESSAGES.tenant));
    expect(onSaved).not.toHaveBeenCalled();
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });
});

describe("useSoftDeleteAdminEpisode", () => {
  it("unieważnia WYŁĄCZNIE listę panelu (tak było przed ekstrakcją)", async () => {
    db().setResponse("podcasts", ok(null));
    const { result, queryClient } = renderHookWithQueryClient(() => useSoftDeleteAdminEpisode());
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    result.current.mutate(EPISODE_ID);
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("adminToast.deleted"));
    expect(invalidatedKeys(spy)).toEqual([["admin", "podcasts"]]);
  });
});

describe("useSaveAdminShow i useSoftDeleteAdminShow", () => {
  it("zapis programu unieważnia klucz panelu i publiczny katalog", async () => {
    db().setResponse("podcast_shows", ok(null));
    const onSaved = vi.fn();
    const { result, queryClient } = renderHookWithQueryClient(() =>
      useSaveAdminShow({ tenantId: TENANT_ID, messages: MESSAGES, onSaved }),
    );
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    result.current.mutate({ ...newShowDraft(0), id: SHOW_ID, title_pl: "Raport" });
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(invalidatedKeys(spy)).toEqual([["admin", "podcast-shows"], ["podcast-shows"]]);
    expect(h.toastSuccess).toHaveBeenCalledWith("adminToast.saved");
  });

  it("usunięcie programu unieważnia te same dwa klucze", async () => {
    db().setResponse("podcast_shows", ok(null));
    const { result, queryClient } = renderHookWithQueryClient(() => useSoftDeleteAdminShow());
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    result.current.mutate(SHOW_ID);
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("adminToast.deleted"));
    expect(invalidatedKeys(spy)).toEqual([["admin", "podcast-shows"], ["podcast-shows"]]);
  });

  it("błąd zapisu programu leci do toastu błędu", async () => {
    db().setResponse("podcast_shows", fail("duplicate key value", "23505"));
    const { result } = renderHookWithQueryClient(() =>
      useSaveAdminShow({ tenantId: TENANT_ID, messages: MESSAGES, onSaved: vi.fn() }),
    );
    result.current.mutate({ ...newShowDraft(0), id: SHOW_ID, title_pl: "Raport" });
    await waitFor(() => expect(h.toastError).toHaveBeenCalledTimes(1));
    expect(String(h.toastError.mock.calls[0][0])).toContain("duplicate key");
  });
});

describe("useSaveAdminPodcastSettings", () => {
  it("unieważnia ustawienia panelu i publiczne, potem zamyka panel", async () => {
    db().setResponse("podcast_settings", ok(null));
    const onSaved = vi.fn();
    const { result, queryClient } = renderHookWithQueryClient(() =>
      useSaveAdminPodcastSettings({
        tenantId: TENANT_ID,
        messages: MESSAGES,
        merged: mergePodcastSettings({}, null, TENANT_ID),
        onSaved,
      }),
    );
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    result.current.mutate();
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(invalidatedKeys(spy)).toEqual([["admin", "podcast-settings"], ["podcast-settings"]]);
    expect(h.toastSuccess).toHaveBeenCalledWith("adminToast.settingsSaved");
  });

  it("brak tenanta nie zamyka panelu i pokazuje komunikat", async () => {
    const onSaved = vi.fn();
    const { result } = renderHookWithQueryClient(() =>
      useSaveAdminPodcastSettings({
        tenantId: null,
        messages: MESSAGES,
        merged: mergePodcastSettings({}, null, null),
        onSaved,
      }),
    );
    result.current.mutate();
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith(MESSAGES.tenant));
    expect(onSaved).not.toHaveBeenCalled();
  });
});

describe("pozostale hooki odczytu", () => {
  it("kazdy z nich odklada wynik POD SWOIM kluczem", async () => {
    // Jeden wspólny klucz dla dwóch odczytów podmieniłby zawartość panelu
    // (np. lista programów w miejscu kategorii) bez żadnego błędu.
    db().setResponse("podcast_shows", ok([{ id: SHOW_ID, slug: "raport" }]));
    db().setResponse("podcast_settings", ok({ tenant_id: TENANT_ID }));
    db().setResponse("categories", ok([{ id: "c1", name_pl: "Obronnosc", name_en: "Defence" }]));
    db().setResponse("profiles", ok([{ id: "u1", display_name: "Ewa Cis", slug: "ewa-cis" }]));
    const shows = renderHookWithQueryClient(() => useAdminPodcastShows());
    await waitFor(() => expect(shows.result.current.data).toHaveLength(1));
    expect(shows.queryClient.getQueryData(adminPodcastKeys.shows())).toHaveLength(1);

    const settings = renderHookWithQueryClient(() => useAdminPodcastSettings());
    await waitFor(() => expect(settings.result.current.data).not.toBeUndefined());
    expect(settings.queryClient.getQueryData(adminPodcastKeys.settings())).toMatchObject({
      tenant_id: TENANT_ID,
    });

    const categories = renderHookWithQueryClient(() => useAdminPodcastCategories());
    await waitFor(() => expect(categories.result.current.data).toHaveLength(1));
    expect(categories.queryClient.getQueryData(adminPodcastKeys.categories())).toHaveLength(1);

    const profiles = renderHookWithQueryClient(() => useAdminPodcastProfiles());
    await waitFor(() => expect(profiles.result.current.data).toHaveLength(1));
    expect(profiles.queryClient.getQueryData(adminPodcastKeys.profiles())).toHaveLength(1);
  });

  it("podsumowanie feedu laduje pod kluczem karty gotowosci", async () => {
    db().setResponse(
      "podcasts",
      ok([{ audio_url: "https://cdn.example.org/a.mp3", duration_seconds: 60 }]),
    );
    db().setResponse("media", ok([]));
    const { result, queryClient } = renderHookWithQueryClient(() => useAdminPodcastFeedEpisodes());
    await waitFor(() => expect(result.current.data).toMatchObject({ total: 1 }));
    expect(queryClient.getQueryData(adminPodcastKeys.feedEpisodes())).toMatchObject({ total: 1 });
  });

  it("fabryki opcji wystawiaja ten sam klucz, co hooki", () => {
    // Loader trasy i hook muszą trafiać w ten sam wpis cache - inaczej panel
    // po hydratacji robi drugą podróż do bazy i mruga „Ładowanie".
    expect(adminPodcastRowsQueryOptions().queryKey).toEqual(adminPodcastKeys.episodes());
    expect(adminPodcastShowsQueryOptions().queryKey).toEqual(adminPodcastKeys.shows());
    expect(adminPodcastSettingsQueryOptions().queryKey).toEqual(adminPodcastKeys.settings());
    expect(adminPodcastFeedEpisodesQueryOptions().queryKey).toEqual(
      adminPodcastKeys.feedEpisodes(),
    );
    expect(adminPodcastRowsQueryOptions().queryFn).toBe(fetchAdminPodcastRows);
    expect(adminPodcastShowsQueryOptions().queryFn).toBe(fetchAdminPodcastShows);
    expect(adminPodcastSettingsQueryOptions().queryFn).toBe(fetchAdminPodcastSettings);
    expect(adminPodcastFeedEpisodesQueryOptions().queryFn).toBe(fetchAdminPodcastFeedEpisodes);
  });

  it("zadne z tych zapytan nie jest keszowane pod kluczem publicznym", () => {
    const adminPrefixes = [
      adminPodcastKeys.episodes(),
      adminPodcastKeys.shows(),
      adminPodcastKeys.settings(),
      adminPodcastKeys.feedEpisodes(),
      adminPodcastKeys.categories(),
      adminPodcastKeys.profiles(),
    ];
    for (const key of adminPrefixes) expect(key[0]).toBe("admin");
  });
});

describe("useLoadAdminPodcast", () => {
  it("otwiera edytor DOPIERO na wczytanym odcinku", async () => {
    db().setResponse("podcasts", ok({ id: EPISODE_ID, slug: "odc-1" }));
    const onLoaded = vi.fn();
    const { result } = renderHookWithQueryClient(() => useLoadAdminPodcast({ onLoaded }));
    result.current.mutate(EPISODE_ID);
    await waitFor(() => expect(onLoaded).toHaveBeenCalledTimes(1));
    expect(onLoaded.mock.calls[0][0]).toMatchObject({ id: EPISODE_ID, slug: "odc-1" });
  });

  it("nieudane wczytanie NIE otwiera edytora", async () => {
    // Edytor otwarty na pustce zapisałby przy „Zapisz" nowy wiersz - duplikat
    // odcinka, który tylko wyglądał na edytowany.
    db().setResponse("podcasts", ok(null));
    const onLoaded = vi.fn();
    const { result } = renderHookWithQueryClient(() => useLoadAdminPodcast({ onLoaded }));
    result.current.mutate(EPISODE_ID);
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(onLoaded).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Kontrola narzędzia

// ---------------------------------------------------------------------------

describe("kontrola atrapy", () => {
  it("brak zaplanowanej odpowiedzi jest BŁĘDEM, a nie cichą pustą listą", async () => {
    // Gdyby atrapa oddawała `[]` na nieplanowaną tabelę, każdy test odczytu
    // „przechodziłby" także wtedy, gdy kod pyta zupełnie inną tabelę.
    await expect(fetchAdminPodcastRows()).rejects.toThrow(/brak zaplanowanej odpowiedzi/);
  });

  it("atrapa zapisuje ogniwa łańcucha w KOLEJNOŚCI wywołania", async () => {
    const result: SupabaseResult = ok([]);
    db().setResponse("podcasts", result);
    await fetchAdminPodcastRows();
    expect(methods("podcasts")).toEqual(["select", "is", "order"]);
  });
});
