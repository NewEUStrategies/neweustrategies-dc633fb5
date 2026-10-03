// Warstwy członkostwa: format benefitów w jsonb, flagi `features` i odczyt
// katalogu oraz warstwy bieżącego czytelnika.
//
// RYZYKO, KTÓRE TEN PLIK PINUJE. Benefity i flagi to obietnica sprzedażowa
// (karta planu na /pricing) i miękka bramka dostępu w jednym. Trzy rzeczy
// kosztują tu realnie:
//
//   1. USZKODZONY JSONB NIE WYWRACA STRONY ANI NIE GUBI OBIETNICY. `benefits`
//      i `features` to luźne pola JSON redagowane w panelu - nie-tablica,
//      wpis-liczba czy wartość nie-tekstowa muszą dać PUSTY wynik, a para
//      z jedną wersją językową musi przejąć drugą (karta angielska bez
//      treści to pusta obietnica dla połowy odbiorców).
//   2. FLAGA LICZBOWA (`expert_request_quota`) przychodzi z panelu jako liczba
//      ALBO numeryczny napis. Śmieci mają dać 0, a nie `NaN` - `NaN` w limicie
//      zapytań to nieskończony albo zerowy limit w zależności od porównania.
//   3. WARSTWA BIEŻĄCA JEST PER KONTO. Klucz cache zawiera uid, inaczej po
//      zmianie konta na wspólnym urządzeniu czytelnik dostałby CUDZĄ warstwę
//      (a z nią cudze bramki). Odczyt katalogu bierze wyłącznie warstwy
//      AKTYWNE, w kolejności rangi - tak jak buduje drabinkę strona publiczna.
//
// ATRAPOWANA JEST WYŁĄCZNIE GRANICA: klient Supabase (`from`/`rpc`) i sesja.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";

import { fail, ok, supabaseFromStub, type SupabaseFromStub } from "@/test/supabase/chain";
import { supabaseRpcStub, type SupabaseRpcStub } from "@/test/supabase/rpc";
import { renderHookWithQueryClient } from "@/test/renderWithQueryClient";
import { membershipTier } from "@/test/admin/pricingFixtures";

const h = vi.hoisted(() => ({
  chain: null as unknown as SupabaseFromStub,
  rpc: null as unknown as SupabaseRpcStub,
  user: null as { id: string } | null,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => h.chain.from(table),
    rpc: (name: string, args?: Record<string, unknown>) => h.rpc.rpc(name, args),
  },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: h.user }) }));

import {
  fetchCurrentTier,
  fetchMembershipTiers,
  parseTierBenefits,
  serializeTierBenefits,
  tierFeatureNumber,
  tierHasFeature,
  tierName,
  useCurrentTier,
  useMembershipTiers,
  type CurrentTier,
} from "@/lib/billing/tiers";
import type { Json } from "@/integrations/supabase/types";

const MEMBER: CurrentTier = {
  key: "member",
  rank: 10,
  name_pl: "Członek",
  name_en: "Member",
  features: { briefings: true },
};

beforeEach(() => {
  h.chain = supabaseFromStub();
  h.rpc = supabaseRpcStub();
  h.user = null;
});

describe("parseTierBenefits - odczyt benefitów z jsonb", () => {
  it("pole, które NIE jest tablicą, daje pustą listę zamiast wyjątku", () => {
    for (const raw of [null, "Dostęp do analiz", 42, true, { pl: "A", en: "A" }] as Json[]) {
      expect(parseTierBenefits(raw)).toEqual([]);
    }
  });

  it("wpisy niebędące obiektem (napis, liczba, null, tablica) są pomijane, reszta zostaje", () => {
    const parsed = parseTierBenefits([
      "luźny napis",
      7,
      null,
      ["zagnieżdżona", "tablica"],
      { pl: "Briefing", en: "Briefing EN" },
    ]);

    expect(parsed).toEqual([{ pl: "Briefing", en: "Briefing EN" }]);
  });

  it("brakująca wersja językowa dziedziczy z drugiej - w OBIE strony", () => {
    const parsed = parseTierBenefits([{ en: "Only English" }, { pl: "Tylko polski" }]);

    expect(parsed).toEqual([
      { pl: "Only English", en: "Only English" },
      { pl: "Tylko polski", en: "Tylko polski" },
    ]);
  });

  it("wartość nie-tekstowa liczy się jak brak - wiersz bez żadnego tekstu odpada", () => {
    const parsed = parseTierBenefits([
      { pl: 12, en: { nested: true } },
      { pl: "Debaty", en: false },
    ]);

    expect(parsed).toEqual([{ pl: "Debaty", en: "Debaty" }]);
  });

  it("rozwinięcie i nagłówek grupy dziedziczą wersję językową tak samo jak treść", () => {
    const [onlyEnDetail, onlyPlGroup] = parseTierBenefits([
      { pl: "Analizy", en: "Analyses", detail_en: "No limits." },
      { pl: "Kluby", en: "Clubs", group_pl: "Społeczność" },
    ]);

    expect(onlyEnDetail).toEqual({
      pl: "Analizy",
      en: "Analyses",
      detail_pl: "No limits.",
      detail_en: "No limits.",
    });
    expect(onlyPlGroup).toEqual({
      pl: "Kluby",
      en: "Clubs",
      group_pl: "Społeczność",
      group_en: "Społeczność",
    });
  });

  it("odwrotny kierunek dziedziczenia: tylko polskie rozwinięcie, tylko angielska grupa", () => {
    const [benefit] = parseTierBenefits([
      { pl: "Raporty", en: "Reports", detail_pl: "Co tydzień.", group_en: "Research" },
    ]);

    expect(benefit).toEqual({
      pl: "Raporty",
      en: "Reports",
      detail_pl: "Co tydzień.",
      detail_en: "Co tydzień.",
      group_pl: "Research",
      group_en: "Research",
    });
  });

  it("puste pola opcjonalne NIE pojawiają się w wyniku (starsi konsumenci ich nie znają)", () => {
    const [benefit] = parseTierBenefits([
      { pl: "A", en: "A", detail_pl: "", detail_en: "", group_pl: "", group_en: "" },
    ]);

    expect(Object.keys(benefit).sort()).toEqual(["en", "pl"]);
  });
});

describe("serializeTierBenefits - jedyne miejsce zapisu benefitów", () => {
  it("przycina białe znaki i dziedziczy brakującą wersję językową treści", () => {
    expect(serializeTierBenefits([{ pl: "  ", en: " Only EN " }])).toEqual([
      { pl: "Only EN", en: "Only EN" },
    ]);
  });

  it("rozwinięcie tylko po angielsku trafia do OBU pól rozwinięcia", () => {
    expect(serializeTierBenefits([{ pl: "A", en: "A", detail_en: " Daily. " }])).toEqual([
      { pl: "A", en: "A", detail_pl: "Daily.", detail_en: "Daily." },
    ]);
  });

  it("nagłówek grupy dziedziczy w obie strony", () => {
    expect(
      serializeTierBenefits([
        { pl: "A", en: "A", group_en: "Research" },
        { pl: "B", en: "B", group_pl: "Treści" },
      ]),
    ).toEqual([
      { pl: "A", en: "A", group_pl: "Research", group_en: "Research" },
      { pl: "B", en: "B", group_pl: "Treści", group_en: "Treści" },
    ]);
  });

  it("zapis i odczyt są odwrotne - żaden panel nie gubi pól drugiego", () => {
    const list = [
      { pl: "Analizy", en: "Analyses", detail_pl: "Bez limitów.", group_en: "Content" },
      { pl: "", en: "Clubs" },
    ];

    expect(parseTierBenefits(serializeTierBenefits(list))).toEqual([
      {
        pl: "Analizy",
        en: "Analyses",
        detail_pl: "Bez limitów.",
        detail_en: "Bez limitów.",
        group_pl: "Content",
        group_en: "Content",
      },
      { pl: "Clubs", en: "Clubs" },
    ]);
  });
});

describe("tierName - nazwa warstwy w języku strony", () => {
  it("po angielsku bierze nazwę angielską, a bez niej - polską", () => {
    expect(tierName({ name_pl: "Członek", name_en: "Member" }, "en")).toBe("Member");
    expect(tierName({ name_pl: "Członek", name_en: "" }, "en")).toBe("Członek");
  });

  it("po polsku bierze nazwę polską, a bez niej - angielską", () => {
    expect(tierName({ name_pl: "Członek", name_en: "Member" }, "pl")).toBe("Członek");
    expect(tierName({ name_pl: "", name_en: "Member" }, "pl")).toBe("Member");
  });
});

describe("tierHasFeature - miękka bramka po fladze", () => {
  it("tylko dosłowne `true` otwiera bramkę - napis „true” i 1 jej NIE otwierają", () => {
    const features = { briefings: true, debates: "true", archive: 1 } as Json;

    expect(tierHasFeature(features, "briefings")).toBe(true);
    expect(tierHasFeature(features, "debates")).toBe(false);
    expect(tierHasFeature(features, "archive")).toBe(false);
    expect(tierHasFeature(features, "missing")).toBe(false);
  });

  it("features, które nie są obiektem, nie otwierają niczego", () => {
    for (const features of [null, "briefings", 5, ["briefings"]] as Json[]) {
      expect(tierHasFeature(features, "briefings")).toBe(false);
    }
  });
});

describe("tierFeatureNumber - limit liczbowy z features", () => {
  it("liczba skończona przechodzi bez zmian", () => {
    expect(tierFeatureNumber({ expert_request_quota: 3 }, "expert_request_quota")).toBe(3);
  });

  it("numeryczny napis z panelu jest liczbą", () => {
    expect(tierFeatureNumber({ expert_request_quota: " 12 " }, "expert_request_quota")).toBe(12);
  });

  it("napis nienumeryczny daje 0, a nie NaN", () => {
    const quota = tierFeatureNumber({ expert_request_quota: "dużo" }, "expert_request_quota");

    expect(quota).toBe(0);
    expect(Number.isNaN(quota)).toBe(false);
  });

  it("nieskończoność (np. „1e999” albo Infinity) daje 0, nie nielimitowany dostęp", () => {
    expect(tierFeatureNumber({ q: "1e999" }, "q")).toBe(0);
    expect(tierFeatureNumber({ q: Number.POSITIVE_INFINITY } as unknown as Json, "q")).toBe(0);
  });

  it("pusty napis, boolean i brak klucza dają 0", () => {
    expect(tierFeatureNumber({ q: "   " }, "q")).toBe(0);
    expect(tierFeatureNumber({ q: true }, "q")).toBe(0);
    expect(tierFeatureNumber({}, "q")).toBe(0);
  });

  it("features, które nie są obiektem, dają 0", () => {
    for (const features of [null, 7, "7", [7]] as Json[]) {
      expect(tierFeatureNumber(features, "q")).toBe(0);
    }
  });
});

describe("fetchMembershipTiers - katalog warstw", () => {
  it("czyta WYŁĄCZNIE aktywne warstwy, rosnąco po randze", async () => {
    const rows = [membershipTier({ id: "t1", rank: 0 }), membershipTier({ id: "t2", rank: 10 })];
    h.chain.setResponse("membership_tiers", ok(rows));

    await expect(fetchMembershipTiers()).resolves.toEqual(rows);

    const chain = h.chain.lastChain("membership_tiers")!;
    expect(chain.argsOf("select")).toEqual(["*"]);
    expect(chain.argsOf("eq")).toEqual(["active", true]);
    expect(chain.argsOf("order")).toEqual(["rank", { ascending: true }]);
  });

  it("brak wierszy (null) to pusty katalog, nie wyjątek", async () => {
    h.chain.setResponse("membership_tiers", ok(null));

    await expect(fetchMembershipTiers()).resolves.toEqual([]);
  });

  it("błąd bazy jest RZUCANY - nie udaje pustego katalogu", async () => {
    h.chain.setResponse("membership_tiers", fail("permission denied for table membership_tiers"));

    await expect(fetchMembershipTiers()).rejects.toThrow(
      "permission denied for table membership_tiers",
    );
  });
});

describe("fetchCurrentTier - warstwa wołającego rozstrzygana na serwerze", () => {
  it("bierze pierwszy wiersz RPC `current_membership_tier`, bez argumentów od klienta", async () => {
    h.rpc.setData("current_membership_tier", [MEMBER]);

    await expect(fetchCurrentTier()).resolves.toEqual(MEMBER);
    expect(h.rpc.names()).toEqual(["current_membership_tier"]);
    expect(h.rpc.lastCall("current_membership_tier")!.keys()).toEqual([]);
  });

  it("pusta odpowiedź i `null` znaczą „brak warstwy”", async () => {
    h.rpc.setData("current_membership_tier", []);
    await expect(fetchCurrentTier()).resolves.toBeNull();

    h.rpc.setData("current_membership_tier", null);
    await expect(fetchCurrentTier()).resolves.toBeNull();
  });

  it("błąd RPC jest rzucany, a nie zamieniany na „brak warstwy”", async () => {
    h.rpc.setError("current_membership_tier", "function current_membership_tier() does not exist");

    await expect(fetchCurrentTier()).rejects.toThrow("does not exist");
  });
});

describe("useCurrentTier / useMembershipTiers - cache per konto", () => {
  it("klucz cache warstwy bieżącej zawiera uid zalogowanego", async () => {
    h.user = { id: "user-me" };
    h.rpc.setData("current_membership_tier", [MEMBER]);

    const { result, queryClient } = renderHookWithQueryClient(() => useCurrentTier());

    await waitFor(() => expect(result.current.data).toEqual(MEMBER));
    expect(queryClient.getQueryData(["current-tier", "user-me"])).toEqual(MEMBER);
    expect(queryClient.getQueryData(["current-tier", "anon"])).toBeUndefined();
  });

  it("gość dostaje OSOBNY wpis cache - warstwa konta nie wycieka do anonima", async () => {
    h.user = null;
    h.rpc.setData("current_membership_tier", []);

    const { result, queryClient } = renderHookWithQueryClient(() => useCurrentTier());

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
    expect(queryClient.getQueryData(["current-tier", "anon"])).toBeNull();
  });

  it("katalog warstw ląduje pod wspólnym kluczem katalogu", async () => {
    const rows = [membershipTier()];
    h.chain.setResponse("membership_tiers", ok(rows));

    const { result, queryClient } = renderHookWithQueryClient(() => useMembershipTiers());

    await waitFor(() => expect(result.current.data).toEqual(rows));
    expect(queryClient.getQueryData(["membership-tiers"])).toEqual(rows);
  });
});
