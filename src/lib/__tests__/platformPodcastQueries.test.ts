import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ok, fail, type SupabaseFromStub } from "@/test/supabase";
vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabase");
  const db = supabaseFromStub();
  return { supabase: { from: db.from }, db };
});
import * as client from "@/integrations/supabase/client";
import * as q from "@/lib/queries/podcasts";
const db: SupabaseFromStub = Reflect.get(client, "db");
let qc: QueryClient;
beforeEach(() => {
  db.reset();
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
});
afterEach(() => qc.clear());
const cases = [
  {
    name: "latest",
    table: "podcasts",
    fetch: (c: QueryClient) => c.fetchQuery(q.latestPodcastsQueryOptions()),
    empty: [],
  },
  {
    name: "episode",
    table: "podcasts",
    fetch: (c: QueryClient) => c.fetchQuery(q.podcastBySlugQueryOptions("episode")),
    empty: null,
  },
  {
    name: "settings",
    table: "podcast_settings",
    fetch: (c: QueryClient) => c.fetchQuery(q.podcastSettingsQueryOptions),
    empty: null,
  },
  {
    name: "shows",
    table: "podcast_shows",
    fetch: (c: QueryClient) => c.fetchQuery(q.publishedShowsQueryOptions),
    empty: [],
  },
  {
    name: "show",
    table: "podcast_shows",
    fetch: (c: QueryClient) => c.fetchQuery(q.showBySlugQueryOptions("show")),
    empty: null,
  },
  {
    name: "episodes",
    table: "podcasts",
    fetch: (c: QueryClient) => c.fetchQuery(q.showEpisodesQueryOptions("show-id")),
    empty: [],
  },
  {
    name: "stats",
    table: "podcasts",
    fetch: (c: QueryClient) => c.fetchQuery(q.showEpisodeStatsQueryOptions),
    empty: [],
  },
  {
    name: "people",
    table: "podcast_episode_people",
    fetch: (c: QueryClient) => c.fetchQuery(q.episodePeopleQueryOptions("episode-id")),
    empty: [],
  },
  {
    name: "batch people",
    table: "podcast_episode_people",
    fetch: (c: QueryClient) => c.fetchQuery(q.episodesPeopleQueryOptions(["episode-id"])),
    empty: [],
  },
  {
    name: "category",
    table: "podcasts",
    fetch: (c: QueryClient) => c.fetchQuery(q.podcastsByCategoryQueryOptions("category-id")),
    empty: [],
  },
];
describe("public podcast read contracts", () => {
  it.each(cases)(
    "$name propagates read failure without caching a false empty result",
    async ({ table, fetch }) => {
      db.setResponse(table, fail("permission denied"));
      await expect(fetch(qc)).rejects.toThrow("permission denied");
      expect(qc.getQueryCache().getAll()[0].state.data).toBeUndefined();
    },
  );
  it.each(cases)("$name normalizes a confirmed empty response", async ({ table, fetch, empty }) => {
    db.setResponse(table, ok(null));
    expect(await fetch(qc)).toEqual(empty);
  });
  it("treats a missing settings singleton as absence, not an operational failure", async () => {
    db.setResponse("podcast_settings", fail("no row", "PGRST116"));
    expect(await qc.fetchQuery(q.podcastSettingsQueryOptions)).toBeNull();
  });
  it.each([0, 2, 100])(
    "bounds latest/category reads for requested limit %s and excludes unpublished/deleted rows",
    async (limit) => {
      db.setResponse("podcasts", ok([{ id: "published" }]));
      expect(await qc.fetchQuery(q.latestPodcastsQueryOptions(limit))).toEqual([
        { id: "published" },
      ]);
      await qc.fetchQuery(q.podcastsByCategoryQueryOptions("cat", limit));
      for (const chain of db.chainsFor("podcasts")) {
        expect(chain.calls).toContainEqual({ method: "eq", args: ["status", "published"] });
        expect(chain.argsOf("is")).toEqual(["deleted_at", null]);
        expect(chain.argsOf("limit")).toEqual([Math.max(1, Math.min(limit, 50))]);
      }
    },
  );
  it("uses stable batch identity and does not issue a database read for an empty batch", async () => {
    expect(q.episodesPeopleQueryOptions(["b", "a"]).queryKey).toEqual(
      q.episodesPeopleQueryOptions(["a", "b"]).queryKey,
    );
    expect(await qc.fetchQuery(q.episodesPeopleQueryOptions([]))).toEqual([]);
    expect(db.chains).toHaveLength(0);
  });
  it("maps participant overrides, profile fallback and missing profiles without leaking joined objects", async () => {
    const base = {
      id: "person",
      episode_id: "episode",
      profile_id: "profile",
      role: "host",
      url: null,
      sort_order: 0,
    };
    db.setResponse(
      "podcast_episode_people",
      ok([
        {
          ...base,
          display_name: "Override",
          profiles: { display_name: "Profile", slug: "slug", avatar_url: "avatar" },
        },
        {
          ...base,
          display_name: "",
          role: "guest",
          profiles: { display_name: "Profile", slug: null, avatar_url: null },
        },
        { ...base, display_name: "", profiles: null },
      ]),
    );
    const people = await qc.fetchQuery(q.episodePeopleQueryOptions("episode"));
    expect(people.map((p) => p.display_name)).toEqual(["Override", "Profile", ""]);
    expect(people[0]).toMatchObject({
      role: "host",
      profile_slug: "slug",
      profile_avatar_url: "avatar",
    });
    expect(people[1].role).toBe("guest");
    expect(people[2].profile_slug).toBeNull();
    expect(people[0]).not.toHaveProperty("profiles");
  });
  it.each(["participants", "appearances", "authorship"])(
    "profile aggregation propagates %s read failure",
    async (source) => {
      db.setResponse(
        "podcast_episode_people",
        source === "participants" ? fail("denied") : ok([{ episode_id: "episode" }]),
      );
      db.setResponse("podcasts", (chain) =>
        (source === "appearances" ? chain.has("in") : !chain.has("in")) ? fail("denied") : ok([]),
      );
      await expect(qc.fetchQuery(q.podcastsByProfileQueryOptions("profile"))).rejects.toThrow(
        "denied",
      );
    },
  );
  it("merges appearances and authorship once per episode, sorts publication dates and applies the final limit", async () => {
    db.setResponse("podcast_episode_people", ok([{ episode_id: "same" }, { episode_id: "same" }]));
    db.setResponse("podcasts", (chain) =>
      ok(
        chain.has("in")
          ? [
              { id: "same", published_at: "2026-01-01" },
              { id: "undated", published_at: null },
            ]
          : [
              { id: "new", published_at: "2026-08-01" },
              { id: "same", published_at: "2026-01-01" },
              { id: "other-undated", published_at: null },
            ],
      ),
    );
    expect(
      (await qc.fetchQuery(q.podcastsByProfileQueryOptions("profile", 3))).map((x) => x.id),
    ).toEqual(["new", "same", "undated"]);
    expect(
      db
        .chainsFor("podcasts")
        .find((c) => c.has("in"))
        ?.argsOf("in"),
    ).toEqual(["id", ["same"]]);
  });
  it("supports no appearances and nullable result sets without a malformed IN query", async () => {
    db.setResponse("podcast_episode_people", ok(null));
    db.setResponse("podcasts", ok(null));
    expect(await qc.fetchQuery(q.podcastsByProfileQueryOptions("profile"))).toEqual([]);
    expect(db.chainsFor("podcasts")).toHaveLength(1);
    qc.clear();
    db.setResponse("podcast_episode_people", ok([{ episode_id: "gone" }]));
    expect(await qc.fetchQuery(q.podcastsByProfileQueryOptions("profile"))).toEqual([]);
  });
});
