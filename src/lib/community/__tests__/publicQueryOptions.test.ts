// Kontrakt kluczy cache dla SSR: loader trasy zasiewa cache (ensureQueryData)
// dokładnie tym kluczem, którego użyje pierwszy render po hydratacji. Dryf
// kształtu klucza nie wywala builda ani typów - objawia się dopiero zimnym
// cache po SSR (drugi fetch tego samego zasobu) albo martwą inwalidacją
// realtime. Te testy przybijają kształty na sztywno.
import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  libraryResourcesQueryOptions,
  pollResultsQueryOptions,
  publicPollsQueryOptions,
} from "@/lib/community/publicQueries";

describe("community/library query key contract (SSR loader <-> render)", () => {
  it('polls list uses the historical ["public-polls"] key', () => {
    expect(publicPollsQueryOptions().queryKey).toEqual(["public-polls"]);
  });

  it("poll results key = [prefix, joined ids, user] - the /polls shape", () => {
    expect(pollResultsQueryOptions(["a", "b"], null).queryKey).toEqual([
      "public-poll-results",
      "a,b",
      "anon",
    ]);
    expect(pollResultsQueryOptions(["a", "b"], "u-1").queryKey).toEqual([
      "public-poll-results",
      "a,b",
      "u-1",
    ]);
  });

  it("single poll id keeps the PollBlockView-era key shape", () => {
    // Blok poll w treści wpisu historycznie używał surowego pollId jako
    // drugiego elementu - join jednoelementowej listy musi dawać to samo.
    expect(pollResultsQueryOptions(["p1"], null).queryKey).toEqual([
      "public-poll-results",
      "p1",
      "anon",
    ]);
  });

  it("poll results keys stay under the realtime invalidation prefix", () => {
    // /polls i PollBlockView inwalidują po prefiksie ["public-poll-results"] -
    // każdy wariant klucza musi zaczynać się od tego prefiksu.
    for (const key of [
      pollResultsQueryOptions(["a"], null).queryKey,
      pollResultsQueryOptions(["a", "b"], "u-1").queryKey,
    ]) {
      expect(key[0]).toBe("public-poll-results");
    }
  });

  it('library resources use the historical ["library-resources"] key', () => {
    expect(libraryResourcesQueryOptions().queryKey).toEqual(["library-resources"]);
  });
});
