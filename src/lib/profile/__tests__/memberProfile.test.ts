import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";

const h = vi.hoisted(() => ({
  /** `supabase.rpc` przeglądarkowego klienta - odpowiedź planuje każdy test. */
  rpc: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (fn: string, args?: Record<string, unknown>) => h.rpc(fn, args) },
}));

import { profileHref } from "@/lib/profile/profileHref";
import { memberProfileQueryOptions, parseMemberProfile } from "@/lib/profile/memberProfile";
import { fail, ok } from "@/test/supabase";

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

// Odczyt /people/<slug>. Trasa rozróżnia TRZY stany: profil, `null` („nie ma
// takiej osoby albo nie wolno ci jej zobaczyć") i błąd (komunikat z przyciskiem
// ponowienia). Zamiana awarii na `null` pokazałaby „brak profilu" osobie, która
// ma do niego prawo - stąd osobny przypadek dla każdej ścieżki.
describe("memberProfileQueryOptions", () => {
  const row = {
    id: "u1",
    slug: "jan",
    display_name: "Jan",
    job_title: "Analityk",
    verified: true,
    is_self: false,
    is_author: false,
  };

  beforeEach(() => {
    h.rpc.mockReset();
  });

  /** Prawdziwy klient zapytań, bez ponowień - `queryFn` biegnie tak jak w trasie. */
  function fetchProfile(slug: string, userId: string | null) {
    return new QueryClient().fetchQuery(memberProfileQueryOptions(slug, userId));
  }

  it("klucz cache niesie slug i czytelnika - widok zależy od tego, KTO patrzy", () => {
    expect(memberProfileQueryOptions("jan", "u-me").queryKey).toEqual([
      "member-profile",
      "jan",
      "u-me",
    ]);
    expect(memberProfileQueryOptions("jan", null).queryKey).toEqual([
      "member-profile",
      "jan",
      null,
    ]);
  });

  it("gość: zapytanie wyłączone (RPC i tak oddałoby `null`), zalogowany: włączone", () => {
    expect(memberProfileQueryOptions("jan", null).enabled).toBe(false);
    expect(memberProfileQueryOptions("jan", "u-me").enabled).toBe(true);
  });

  it("odczyt idzie przez RPC `get_member_profile` ze slugiem z adresu i parsuje wiersz", async () => {
    h.rpc.mockResolvedValue(ok(row));

    const profile = await fetchProfile("jan", "u-me");

    expect(h.rpc).toHaveBeenCalledWith("get_member_profile", { p_slug: "jan" });
    expect(profile).toMatchObject({ id: "u1", job_title: "Analityk", company: null });
  });

  it("`null` z RPC (niewidoczny albo nieistniejący profil): `null`, nie błąd", async () => {
    h.rpc.mockResolvedValue(ok(null));
    await expect(fetchProfile("jan", "u-me")).resolves.toBeNull();
  });

  it("błąd RPC jest RZUCANY - trasa pokazuje ponowienie, a nie „brak profilu”", async () => {
    h.rpc.mockResolvedValue(fail("canceling statement due to statement timeout", "57014"));
    await expect(fetchProfile("jan", "u-me")).rejects.toThrow(
      "canceling statement due to statement timeout",
    );
  });
});
