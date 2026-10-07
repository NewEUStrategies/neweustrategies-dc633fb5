import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: rpcMock } }));

import {
  CLUB_MENTION_PUBLIC_SLOTS,
  mergeClubMentionSuggestions,
  mergeMentionSuggestions,
  useMentionSuggestions,
  MENTION_SUGGESTION_LIMIT,
  type MentionSuggestion,
} from "@/lib/mentions/useMentionSuggestions";

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

function personRow(over: Record<string, unknown> = {}) {
  return {
    kind: "person",
    id: "u1",
    slug: "jan-kowalski",
    label: "Jan Kowalski",
    subtitle: "Analityk",
    avatar_url: "https://cdn/jan.png",
    logo_url: null,
    website: null,
    verified: true,
    score: 1,
    ...over,
  };
}

function organizationRow(over: Record<string, unknown> = {}) {
  return {
    kind: "organization",
    id: "o1",
    slug: "org-123e4567-e89b-12d3-a456-426614174000",
    label: "ACME Europe",
    subtitle: "Energy",
    avatar_url: null,
    logo_url: "https://cdn/acme.png",
    website: "https://acme.example",
    verified: false,
    score: 0.8,
    ...over,
  };
}

// Klamry są istotne: `mockReset()` ZWRACA atrapę, a funkcja zwrócona
// z `beforeEach` jest dla vitest sprzątaniem - wołałby wtedy `rpcMock()` bez
// argumentów po każdym teście, czyli z implementacją ustawioną przez test.
beforeEach(() => {
  rpcMock.mockReset();
});

describe("useMentionSuggestions", () => {
  it("does not query when there is no active mention (query null)", async () => {
    renderHook(() => useMentionSuggestions(null, "pl"), { wrapper: wrapper() });
    // enabled:false -> RPC never fires (no member enumeration on idle caret).
    await new Promise((r) => setTimeout(r, 20));
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("passes the query + limit and returns people and organizations with a slug", async () => {
    rpcMock.mockResolvedValue({
      data: [
        personRow(),
        organizationRow(),
        { ...personRow({ id: "u2", slug: "" }) }, // slug-less -> dropped
      ],
      error: null,
    });
    const { result } = renderHook(() => useMentionSuggestions("jan", "pl"), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data?.length).toBe(2));
    expect(rpcMock).toHaveBeenCalledWith("search_mention_targets", {
      _q: "jan",
      _limit: MENTION_SUGGESTION_LIMIT,
    });
    expect(result.current.data?.[0]).toEqual({
      kind: "person",
      slug: "jan-kowalski",
      name: "Jan Kowalski",
      avatarUrl: "https://cdn/jan.png",
      logoUrl: null,
      website: null,
      subtitle: "Analityk",
      verified: true,
    });
    expect(result.current.data?.[1]).toEqual({
      kind: "organization",
      slug: "org-123e4567-e89b-12d3-a456-426614174000",
      name: "ACME Europe",
      avatarUrl: null,
      logoUrl: "https://cdn/acme.png",
      website: "https://acme.example",
      subtitle: "Energy",
      verified: false,
    });
  });

  it("keeps the safe RPC label + subtitle for lang=en", async () => {
    rpcMock.mockResolvedValue({ data: [personRow()], error: null });
    const { result } = renderHook(() => useMentionSuggestions("jan", "en"), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data?.length).toBe(1));
    expect(result.current.data?.[0].subtitle).toBe("Analityk");
  });

  it("omits _q when the query is empty (top people on a bare @)", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    const { result } = renderHook(() => useMentionSuggestions("", "pl"), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isFetching).toBe(false));
    expect(rpcMock).toHaveBeenCalledWith("search_mention_targets", {
      _q: undefined,
      _limit: MENTION_SUGGESTION_LIMIT,
    });
  });

  it("degrades to an empty list when the RPC errors (pre-migration / network)", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "missing function" } });
    const { result } = renderHook(() => useMentionSuggestions("x", "pl"), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data).toEqual([]));
  });
});

// ---------------------------------------------------------------------------
// Zakres klubu: członkowie klubu + katalog publiczny
//
// Publiczny katalog zna wyłącznie autorów redakcyjnych i ekspertów, więc bez
// zakresu zwykły członek klubu nie dawał się wzmiankować w rozmowie we własnym
// klubie. Z zakresem hak pyta RÓWNOLEGLE `club_mention_members` i scala wyniki.
// ---------------------------------------------------------------------------

function memberRow(over: Record<string, unknown> = {}) {
  return {
    kind: "person",
    id: "m1",
    slug: "ewa-czlonek",
    label: "Ewa Członek",
    subtitle: "Ekonomistka",
    avatar_url: null,
    logo_url: null,
    website: null,
    verified: false,
    ...over,
  };
}

/** Odpowiedź atrapy zależna od NAZWY funkcji - dwa źródła, dwie odpowiedzi. */
function respond(byName: Record<string, { data: unknown; error: unknown } | Error>) {
  rpcMock.mockImplementation(async (name: string) => {
    const planned = byName[name];
    if (planned === undefined) throw new Error(`nieplanowane RPC ${name}`);
    if (planned instanceof Error) throw planned;
    return planned;
  });
}

function suggestion(slug: string, kind: MentionSuggestion["kind"] = "person"): MentionSuggestion {
  return {
    kind,
    slug,
    name: slug,
    avatarUrl: null,
    logoUrl: null,
    website: null,
    subtitle: null,
    verified: false,
  };
}

describe("useMentionSuggestions - zakres klubu", () => {
  it("pyta OBA źródła z tą samą frazą i limitem, klub idzie jako `p_club_id`", async () => {
    respond({
      club_mention_members: { data: [memberRow()], error: null },
      search_mention_targets: { data: [personRow()], error: null },
    });
    const { result } = renderHook(() => useMentionSuggestions("e", "pl", { clubId: "club-1" }), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.data?.length).toBe(2));
    expect(rpcMock).toHaveBeenCalledWith("club_mention_members", {
      p_club_id: "club-1",
      p_q: "e",
      p_limit: MENTION_SUGGESTION_LIMIT,
    });
    expect(rpcMock).toHaveBeenCalledWith("search_mention_targets", {
      _q: "e",
      _limit: MENTION_SUGGESTION_LIMIT,
    });
  });

  it("członkowie klubu idą PIERWSI, przed katalogiem publicznym", async () => {
    respond({
      club_mention_members: { data: [memberRow()], error: null },
      search_mention_targets: { data: [personRow(), organizationRow()], error: null },
    });
    const { result } = renderHook(() => useMentionSuggestions("", "pl", { clubId: "club-1" }), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.data?.length).toBe(3));
    expect(result.current.data?.map((s) => s.slug)).toEqual([
      "ewa-czlonek",
      "jan-kowalski",
      "org-123e4567-e89b-12d3-a456-426614174000",
    ]);
    // Pusta fraza (goły `@`) nie wysyła `p_q` - serwer bierze domyślne.
    expect(rpcMock).toHaveBeenCalledWith("club_mention_members", {
      p_club_id: "club-1",
      p_q: undefined,
      p_limit: MENTION_SUGGESTION_LIMIT,
    });
  });

  it("osoba obecna w obu źródłach pojawia się RAZ - z danymi członka klubu", async () => {
    respond({
      club_mention_members: {
        data: [memberRow({ slug: "jan-kowalski", label: "Jan Kowalski (klub)" })],
        error: null,
      },
      search_mention_targets: { data: [personRow()], error: null },
    });
    const { result } = renderHook(() => useMentionSuggestions("jan", "pl", { clubId: "club-1" }), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.data?.length).toBe(1));
    expect(result.current.data?.[0].name).toBe("Jan Kowalski (klub)");
  });

  it("scalona lista nie przekracza limitu, a katalog publiczny zachowuje dwa miejsca", async () => {
    const members = Array.from({ length: 5 }, (_, i) => memberRow({ id: `m${i}`, slug: `m-${i}` }));
    const targets = Array.from({ length: 5 }, (_, i) => personRow({ id: `p${i}`, slug: `p-${i}` }));
    respond({
      club_mention_members: { data: members, error: null },
      search_mention_targets: { data: targets, error: null },
    });
    const { result } = renderHook(() => useMentionSuggestions("x", "pl", { clubId: "club-1" }), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.data?.length).toBe(MENTION_SUGGESTION_LIMIT));
    expect(result.current.data?.map((s) => s.slug)).toEqual([
      "m-0",
      "m-1",
      "m-2",
      "m-3",
      "p-0",
      "p-1",
    ]);
  });

  it("firma z katalogu publicznego zostaje, gdy pasuje sześciu członków", async () => {
    // Goły `@` albo krótka fraza dopasowana W ŚRODKU imion (Urban, Albano dla
    // „@ba”) zapełniała całą listę członkami - firmy nie dało się wzmiankować.
    const members = Array.from({ length: 6 }, (_, i) => memberRow({ id: `m${i}`, slug: `m-${i}` }));
    respond({
      club_mention_members: { data: members, error: null },
      search_mention_targets: {
        data: [personRow({ slug: "p-0" }), personRow({ slug: "p-1" }), organizationRow()],
        error: null,
      },
    });
    const { result } = renderHook(() => useMentionSuggestions("ba", "pl", { clubId: "club-1" }), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.data?.length).toBe(MENTION_SUGGESTION_LIMIT));
    expect(result.current.data?.map((s) => s.slug)).toEqual([
      "m-0",
      "m-1",
      "m-2",
      "m-3",
      "org-123e4567-e89b-12d3-a456-426614174000",
      "p-0",
    ]);
  });

  it("błąd źródła CZŁONKÓW nie gasi katalogu publicznego", async () => {
    respond({
      club_mention_members: { data: null, error: { message: "missing function" } },
      search_mention_targets: { data: [personRow()], error: null },
    });
    const { result } = renderHook(() => useMentionSuggestions("jan", "pl", { clubId: "club-1" }), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.data?.map((s) => s.slug)).toEqual(["jan-kowalski"]));
  });

  it("odrzucona obietnica katalogu publicznego nie gasi członków klubu", async () => {
    respond({
      club_mention_members: { data: [memberRow()], error: null },
      search_mention_targets: new Error("network down"),
    });
    const { result } = renderHook(() => useMentionSuggestions("e", "pl", { clubId: "club-1" }), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.data?.map((s) => s.slug)).toEqual(["ewa-czlonek"]));
  });

  it("bez zakresu (albo z pustym klubem) NIE pyta o członków", async () => {
    respond({ search_mention_targets: { data: [personRow()], error: null } });
    const first = renderHook(() => useMentionSuggestions("jan", "pl"), { wrapper: wrapper() });
    await waitFor(() => expect(first.result.current.data?.length).toBe(1));
    const second = renderHook(() => useMentionSuggestions("jan", "pl", { clubId: "  " }), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(second.result.current.data?.length).toBe(1));
    expect(rpcMock.mock.calls.map(([name]) => name)).toEqual([
      "search_mention_targets",
      "search_mention_targets",
    ]);
  });

  it("klub jest częścią klucza - ta sama fraza w innym klubie to nowe zapytanie", async () => {
    respond({
      club_mention_members: { data: [memberRow()], error: null },
      search_mention_targets: { data: [], error: null },
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const shared = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    const { result, rerender } = renderHook(
      (props: { clubId: string }) => useMentionSuggestions("e", "pl", { clubId: props.clubId }),
      { wrapper: shared, initialProps: { clubId: "club-1" } },
    );
    await waitFor(() => expect(result.current.data?.length).toBe(1));
    rerender({ clubId: "club-2" });
    await waitFor(() =>
      expect(
        rpcMock.mock.calls.filter(([name]) => name === "club_mention_members").map(([, a]) => a),
      ).toEqual([
        { p_club_id: "club-1", p_q: "e", p_limit: MENTION_SUGGESTION_LIMIT },
        { p_club_id: "club-2", p_q: "e", p_limit: MENTION_SUGGESTION_LIMIT },
      ]),
    );
  });
});

describe("mergeMentionSuggestions", () => {
  it("kolejność źródeł = priorytet, duplikat zostaje w pierwszym źródle", () => {
    const merged = mergeMentionSuggestions([
      [suggestion("anna"), suggestion("jan")],
      [suggestion("jan", "organization"), suggestion("ola")],
    ]);
    expect(merged.map((s) => `${s.kind}:${s.slug}`)).toEqual([
      "person:anna",
      "person:jan",
      "person:ola",
    ]);
  });

  it("slugi porównuje bez względu na wielkość liter", () => {
    expect(mergeMentionSuggestions([[suggestion("Jan")], [suggestion("jan")]])).toHaveLength(1);
  });

  it("przycina do limitu", () => {
    const many = Array.from({ length: 10 }, (_, i) => suggestion(`s-${i}`));
    expect(mergeMentionSuggestions([many], 4).map((s) => s.slug)).toEqual([
      "s-0",
      "s-1",
      "s-2",
      "s-3",
    ]);
  });

  it("puste źródła dają pustą listę", () => {
    expect(mergeMentionSuggestions([[], []])).toEqual([]);
  });
});

describe("mergeClubMentionSuggestions - członkowie klubu i katalog publiczny", () => {
  const members = (n: number) => Array.from({ length: n }, (_, i) => suggestion(`m-${i}`));
  const slugs = (list: readonly MentionSuggestion[]) => list.map((s) => s.slug);

  it("katalog publiczny ma zarezerwowane DWA miejsca", () => {
    expect(CLUB_MENTION_PUBLIC_SLOTS).toBe(2);
  });

  it("gdy wszystko się mieści - kolejność jak dotąd: członkowie, potem katalog", () => {
    const targets = [suggestion("p-0"), suggestion("org-a", "organization"), suggestion("p-1")];
    expect(slugs(mergeClubMentionSuggestions(members(2), targets))).toEqual([
      "m-0",
      "m-1",
      "p-0",
      "org-a",
      "p-1",
    ]);
  });

  it("sześciu członków i jedna firma: pięciu członków i firma", () => {
    const targets = [suggestion("org-a", "organization")];
    expect(slugs(mergeClubMentionSuggestions(members(6), targets))).toEqual([
      "m-0",
      "m-1",
      "m-2",
      "m-3",
      "m-4",
      "org-a",
    ]);
  });

  it("sześciu członków i trzy firmy: czterech członków i dwie PIERWSZE firmy", () => {
    const targets = [
      suggestion("org-a", "organization"),
      suggestion("org-b", "organization"),
      suggestion("org-c", "organization"),
    ];
    expect(slugs(mergeClubMentionSuggestions(members(6), targets))).toEqual([
      "m-0",
      "m-1",
      "m-2",
      "m-3",
      "org-a",
      "org-b",
    ]);
  });

  it("gdy lista się nie mieści, firmy idą przed osobami z katalogu", () => {
    const targets = [
      suggestion("p-0"),
      suggestion("p-1"),
      suggestion("p-2"),
      suggestion("org-a", "organization"),
    ];
    expect(slugs(mergeClubMentionSuggestions(members(3), targets))).toEqual([
      "m-0",
      "m-1",
      "m-2",
      "org-a",
      "p-0",
      "p-1",
    ]);
  });

  it("bez członków katalog publiczny zostaje w SWOJEJ kolejności", () => {
    const targets = [
      ...Array.from({ length: 6 }, (_, i) => suggestion(`p-${i}`)),
      suggestion("org-a", "organization"),
    ];
    expect(slugs(mergeClubMentionSuggestions([], targets))).toEqual([
      "p-0",
      "p-1",
      "p-2",
      "p-3",
      "p-4",
      "p-5",
    ]);
  });

  it("bez katalogu członkowie dostają całą listę", () => {
    expect(slugs(mergeClubMentionSuggestions(members(8), []))).toEqual(slugs(members(6)));
  });

  it("osoba w obu źródłach liczy się RAZ (jako członek) i nie zabiera miejsca katalogu", () => {
    const targets = [suggestion("M-0"), suggestion("org-a", "organization"), suggestion("p-0")];
    const merged = mergeClubMentionSuggestions(members(6), targets);
    expect(slugs(merged)).toEqual(["m-0", "m-1", "m-2", "m-3", "org-a", "p-0"]);
    expect(new Set(slugs(merged).map((slug) => slug.toLowerCase())).size).toBe(merged.length);
  });
});
