import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import type { SupabaseRpcStub } from "@/test/supabase";
import { profileHref } from "@/lib/profile/profileHref";
import { memberProfileQueryOptions, parseMemberProfile } from "@/lib/profile/memberProfile";

// Atrapą jest WYŁĄCZNIE klient Supabase (rejestrator RPC ze wspólnego
// harnessu) - `memberProfileQueryOptions` i parser biegną prawdziwe.
const sb = vi.hoisted(() => ({ rpc: null as SupabaseRpcStub | null }));

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseRpcStub } = await import("@/test/supabase");
  const rpcStub = supabaseRpcStub();
  sb.rpc = rpcStub;
  return { supabase: { rpc: rpcStub.rpc } };
});

function rpc(): SupabaseRpcStub {
  if (sb.rpc === null) throw new Error("test: atrapa RPC nie została zbudowana");
  return sb.rpc;
}

describe("profileHref", () => {
  it("kieruje zwykłego użytkownika na /people", () => {
    expect(profileHref({ slug: "jan-kowalski-2" })).toBe("/people/jan-kowalski-2");
  });
  it("kieruje autora na /author", () => {
    expect(profileHref({ slug: "anna-nowak", isAuthor: true })).toBe("/author/anna-nowak");
  });
  it("koduje znaki specjalne", () => {
    expect(profileHref({ slug: "a b" })).toBe("/people/a%20b");
  });
});

describe("parseMemberProfile", () => {
  const row = {
    id: "u1",
    slug: "jan",
    display_name: "Jan",
    verified: false,
    is_self: false,
    is_author: false,
  };
  it("zwraca null dla braku danych", () => {
    expect(parseMemberProfile(null)).toBeNull();
  });
  it("uzupełnia brakujące pola wartością null", () => {
    expect(parseMemberProfile(row)?.job_title).toBeNull();
  });
  it("odrzuca niekompletny wiersz", () => {
    expect(parseMemberProfile({ slug: "x" })).toBeNull();
  });
});

describe("memberProfileQueryOptions", () => {
  const memberRow = {
    id: "u1",
    slug: "jan-kowalski",
    display_name: "Jan Kowalski",
    job_title: "Analityk",
    verified: true,
    is_self: false,
    is_author: false,
  };

  /** Klient bez ponowień - błąd RPC ma wyjść od razu, a nie po trzech próbach. */
  function client(): QueryClient {
    return new QueryClient({ defaultOptions: { queries: { retry: false } } });
  }

  beforeEach(() => {
    rpc().reset();
  });

  it("pyta RPC o profil PO SLUGU i niczym więcej - zakres ustala baza", async () => {
    // RPC jest SECURITY DEFINER i sam zawęża do tenanta wołającego oraz
    // respektuje `discoverable`. Klient, który dosyła id albo tenant, dawałby
    // wołającemu dźwignię na cudzy zakres.
    rpc().setData("get_member_profile", memberRow);

    const profile = await client().fetchQuery(
      memberProfileQueryOptions("jan-kowalski", "viewer-1"),
    );

    expect(rpc().names()).toEqual(["get_member_profile"]);
    expect(rpc().lastCall("get_member_profile")?.args).toEqual({ p_slug: "jan-kowalski" });
    // Zwrotka przechodzi przez parser: brakujące pola schodzą na `null`.
    expect(profile).toEqual({
      ...memberRow,
      avatar_url: null,
      cover_url: null,
      company: null,
      location: null,
      bio_pl: null,
      bio_en: null,
      specialization: null,
      linkedin_url: null,
      website_url: null,
    });
  });

  it("profil niewidoczny dla wołającego (RPC oddaje `null`) to `null`, nie błąd", async () => {
    // Trasa /people/<slug> pokazuje wtedy „nie znaleziono”, a nie „spróbuj
    // ponownie” - ponowienie nie zmieni decyzji `discoverable`.
    rpc().setData("get_member_profile", null);

    await expect(
      client().fetchQuery(memberProfileQueryOptions("ukryty", "viewer-1")),
    ).resolves.toBeNull();
  });

  it("zwrotka o obcym kształcie to `null`, nie wyjątek parsera w renderze", async () => {
    rpc().setData("get_member_profile", { slug: "jan-kowalski" });

    await expect(
      client().fetchQuery(memberProfileQueryOptions("jan-kowalski", "viewer-1")),
    ).resolves.toBeNull();
  });

  it("ODMOWA bazy podnosi się jako błąd - trasa pokazuje „spróbuj ponownie”", async () => {
    // Połknięty błąd dałby `null`, czyli „tej osoby nie ma”: awaria sieci
    // udawałaby decyzję o prywatności profilu.
    rpc().setError("get_member_profile", "canceling statement due to statement timeout", "57014");

    await expect(
      client().fetchQuery(memberProfileQueryOptions("jan-kowalski", "viewer-1")),
    ).rejects.toThrow("canceling statement due to statement timeout");
  });

  it("klucz cache niesie slug I wołającego - profil nie przecieka między sesjami", () => {
    // Ten sam slug widziany przez gościa, obcy tenant i właściciela to trzy
    // różne odpowiedzi RPC (`is_self`, `discoverable`), więc nie mogą dzielić
    // wpisu cache po wylogowaniu i zalogowaniu na inne konto.
    expect(memberProfileQueryOptions("jan-kowalski", "viewer-1").queryKey).toEqual([
      "member-profile",
      "jan-kowalski",
      "viewer-1",
    ]);
    expect(memberProfileQueryOptions("jan-kowalski", null).queryKey).toEqual([
      "member-profile",
      "jan-kowalski",
      null,
    ]);
  });

  it("gość nie odpala zapytania - RPC i tak oddałby mu `null`", () => {
    expect(memberProfileQueryOptions("jan-kowalski", null).enabled).toBe(false);
    expect(memberProfileQueryOptions("jan-kowalski", "viewer-1").enabled).toBe(true);
  });
});
