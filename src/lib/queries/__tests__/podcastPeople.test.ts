// UCZESTNICY ODCINKÓW - profil z publicznej projekcji, nie z osadzenia `profiles`.
//
// DEFEKT (17.11.2026, odtworzony na lokalnym PG16 jako anon). Zapytanie
// o prowadzących i gości niosło osadzenie `profiles(slug,display_name,
// avatar_url)`. Anon ma SELECT wyłącznie na kolumnach profilu, które nie
// identyfikują osoby (open_to, seeking_*, offering_*, intent_updated_at,
// completeness_score), więc PostgREST odrzucał CAŁE zapytanie 42501
// („permission denied for table profiles"), a strony `/podcast/$slug`
// i `/podcasts/$show` pokazywały gościom odcinek bez prowadzących i gości.
//
// CO PRZYPINA:
//   * wiersze uczestników idą BEZ osadzenia tabeli `profiles`;
//   * profil (slug, nazwa, awatar) przychodzi z `profiles_public` - tej samej
//     projekcji, którą czytają autorzy wpisu i katalog ekspertów - jednym
//     `.in("id", ...)` po unikalnych identyfikatorach, w porcjach;
//   * uczestnik, którego profilu projekcja nie pokazuje, zostaje z nazwą
//     z wiersza i bez linku;
//   * odmowa projekcji RZUCA (render zdegradowany zdejmuje loader trasy),
//     a nie udaje obsady bez profili.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { fail, ok, type SupabaseFromStub } from "@/test/supabase/chain";

const h = vi.hoisted(() => ({ from: null as SupabaseFromStub | null }));

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabase/chain");
  const from = supabaseFromStub();
  h.from = from;
  return { supabase: { from: from.from } };
});

import { episodePeopleQueryOptions, episodesPeopleQueryOptions } from "@/lib/queries/podcasts";

const EPISODE = "11111111-1111-4111-8111-111111111111";
const HOST = "aaaaaaaa-0000-4000-8000-000000000001";
const PRIVATE_GUEST = "aaaaaaaa-0000-4000-8000-000000000002";

function baza(): SupabaseFromStub {
  if (!h.from) throw new Error("test: atrapa Supabase nie została podpięta");
  return h.from;
}

function klient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
}

function osoba(patch: Record<string, unknown>): Record<string, unknown> {
  return {
    id: "p-1",
    episode_id: EPISODE,
    profile_id: null,
    display_name: "",
    role: "guest",
    url: null,
    sort_order: 0,
    ...patch,
  };
}

/** Wszystkie listy przekazane do `.in("id", ...)` w odczytach projekcji. */
function listyProfili(): string[][] {
  return baza()
    .chainsFor("profiles_public")
    .map((chain) => chain.calls.find((c) => c.method === "in" && c.args[0] === "id")?.args[1])
    .map((ids) => (Array.isArray(ids) ? (ids as string[]) : []));
}

beforeEach(() => {
  baza().reset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("uczestnicy odcinka - profil z `profiles_public`", () => {
  it("wiersze uczestników idą BEZ osadzenia `profiles(...)` (anon nie ma grantu na kolumny profilu)", async () => {
    baza().setResponse("podcast_episode_people", ok([osoba({ display_name: "Ewa Szron" })]));
    await klient().fetchQuery(episodePeopleQueryOptions(EPISODE));

    const select = String(baza().lastChain("podcast_episode_people")?.argsOf("select")?.[0]);
    expect(select).toBe("id,episode_id,profile_id,display_name,role,url,sort_order");
    expect(select).not.toMatch(/profiles\s*\(/);
  });

  it("prowadząca z publicznym profilem: nazwa, link i awatar z projekcji; prywatny profil - nazwa z wiersza, bez linku", async () => {
    baza().setResponse(
      "podcast_episode_people",
      ok([
        osoba({ id: "p-1", profile_id: HOST, role: "host", sort_order: 0 }),
        osoba({
          id: "p-2",
          profile_id: PRIVATE_GUEST,
          display_name: "Gość (nazwa wiersza)",
          sort_order: 1,
        }),
        osoba({ id: "p-3", display_name: "Gość bez profilu", sort_order: 2 }),
      ]),
    );
    // Projekcja oddaje WYŁĄCZNIE profil z publiczną obecnością - jak na PG16.
    baza().setResponse(
      "profiles_public",
      ok([
        {
          id: HOST,
          slug: "prowadzaca",
          display_name: "Prowadząca Publiczna",
          avatar_url: "https://x.test/a.png",
        },
      ]),
    );

    const people = await klient().fetchQuery(episodePeopleQueryOptions(EPISODE));

    const profil = baza().lastChain("profiles_public");
    expect(profil?.argsOf("select")?.[0]).toBe("id, slug, display_name, avatar_url");
    expect(listyProfili()).toEqual([[HOST, PRIVATE_GUEST]]);
    expect(people).toEqual([
      {
        id: "p-1",
        episode_id: EPISODE,
        profile_id: HOST,
        display_name: "Prowadząca Publiczna",
        role: "host",
        url: null,
        sort_order: 0,
        profile_slug: "prowadzaca",
        profile_avatar_url: "https://x.test/a.png",
      },
      {
        id: "p-2",
        episode_id: EPISODE,
        profile_id: PRIVATE_GUEST,
        display_name: "Gość (nazwa wiersza)",
        role: "guest",
        url: null,
        sort_order: 1,
        profile_slug: null,
        profile_avatar_url: null,
      },
      {
        id: "p-3",
        episode_id: EPISODE,
        profile_id: null,
        display_name: "Gość bez profilu",
        role: "guest",
        url: null,
        sort_order: 2,
        profile_slug: null,
        profile_avatar_url: null,
      },
    ]);
  });

  it("nazwa z wiersza wygrywa z nazwą profilu (nadpisanie redakcji)", async () => {
    baza().setResponse(
      "podcast_episode_people",
      ok([osoba({ profile_id: HOST, display_name: "Dr Prowadząca", role: "host" })]),
    );
    baza().setResponse(
      "profiles_public",
      ok([{ id: HOST, slug: "prowadzaca", display_name: "Prowadząca", avatar_url: null }]),
    );
    const [person] = await klient().fetchQuery(episodePeopleQueryOptions(EPISODE));
    expect(person.display_name).toBe("Dr Prowadząca");
    expect(person.profile_slug).toBe("prowadzaca");
  });

  it("obsada bez profili nie pyta projekcji - zero zbędnych round-tripów", async () => {
    baza().setResponse("podcast_episode_people", ok([osoba({ display_name: "Jan Bryza" })]));
    await klient().fetchQuery(episodePeopleQueryOptions(EPISODE));
    expect(baza().chainsFor("profiles_public")).toHaveLength(0);
  });

  it("odmowa projekcji RZUCA - obsada bez profili nie udaje czystego odczytu", async () => {
    baza().setResponse("podcast_episode_people", ok([osoba({ profile_id: HOST, role: "host" })]));
    baza().setResponse("profiles_public", fail("odmowa profiles_public", "42501"));
    await expect(klient().fetchQuery(episodePeopleQueryOptions(EPISODE))).rejects.toMatchObject({
      message: "odmowa profiles_public",
    });
  });
});

describe("prowadzący programu - wiele odcinków, porcje identyfikatorów", () => {
  it("ten sam profil w wielu odcinkach idzie RAZ, a setki profili - porcjami po 100", async () => {
    const ids = Array.from(
      { length: 150 },
      (_, i) => `bbbbbbbb-0000-4000-8000-${String(i).padStart(12, "0")}`,
    );
    const rows = [
      ...ids.map((id, i) => osoba({ id: `p-${i}`, profile_id: id, role: "host" })),
      osoba({
        id: "p-dup",
        episode_id: "22222222-2222-4222-8222-222222222222",
        profile_id: ids[0],
      }),
    ];
    baza().setResponse("podcast_episode_people", ok(rows));
    baza().setResponse("profiles_public", ok([]));

    await klient().fetchQuery(
      episodesPeopleQueryOptions([EPISODE, "22222222-2222-4222-8222-222222222222"]),
    );

    const listy = listyProfili();
    expect(listy.map((l) => l.length)).toEqual([100, 50]);
    expect(listy.flat()).toEqual(ids);
    const select = String(baza().lastChain("podcast_episode_people")?.argsOf("select")?.[0]);
    expect(select).not.toMatch(/profiles\s*\(/);
  });
});
