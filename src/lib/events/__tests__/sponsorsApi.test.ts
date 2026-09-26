// Kontrakt payloadow modulu sponsorow. Testujemy to, co lamie sie w produkcji:
// pominiete klucze (nie wysylaj) vs jawny `null` (wyczysc pole) oraz filtry
// listy, gdzie `all` znaczy „brak filtra", nie wartosc w bazie.
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...call: unknown[]) => rpc(...call) },
}));

type RpcCall = [string, Record<string, unknown>];

const lastCall = (): RpcCall => rpc.mock.calls.at(-1) as RpcCall;

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: [], error: null });
});

describe("sponsorsApi - filtry listy", () => {
  it("nie wysyla filtrow `all` ani pustej frazy", async () => {
    const { fetchSponsors } = await import("@/lib/events/sponsorsApi");
    await fetchSponsors({ eventId: "e1", role: "all", published: "all", q: "  " });
    const [name, args] = lastCall();
    expect(name).toBe("admin_event_sponsors_list");
    expect(args).toEqual({ p_event_id: "e1" });
  });

  it("przekazuje konkretne filtry i paginacje", async () => {
    const { fetchSponsors } = await import("@/lib/events/sponsorsApi");
    await fetchSponsors({
      eventId: "e1",
      role: "media_partner",
      published: "published",
      tierId: "t1",
      q: "acme",
      limit: 25,
      offset: 50,
    });
    expect(lastCall()[1]).toEqual({
      p_event_id: "e1",
      p_role: "media_partner",
      p_published: "published",
      p_tier_id: "t1",
      p_q: "acme",
      p_limit: 25,
      p_offset: 50,
    });
  });
});

describe("sponsorsApi - cala lista strona po stronie (`fetchAllSponsors`)", () => {
  /** Wiersz listy w zakresie, ktory czyta petla stron: `id` i `total_count`. */
  const wiersz = (id: string, total: number | null) => ({ id, total_count: total });
  /** Strona `count` wierszy od numeru `from`, kazdy z tym samym `total_count`. */
  const strona = (from: number, count: number, total: number | null) =>
    Array.from({ length: count }, (_, i) => wiersz(`s${from + i}`, total));
  /** Odpowiada strona wedlug `p_offset` - tak jak RPC. */
  const listaRpc = (all: { id: string; total_count: number | null }[]) =>
    rpc.mockImplementation(async (_name: string, args: Record<string, unknown>) => {
      const offset = Number(args.p_offset);
      return { data: all.slice(offset, offset + Number(args.p_limit)), error: null };
    });

  it("krotka lista to JEDNO zapytanie: strona 200 od zera, filtry bez zmian", async () => {
    rpc.mockResolvedValue({ data: strona(0, 3, 3), error: null });
    const { fetchAllSponsors } = await import("@/lib/events/sponsorsApi");

    const rows = await fetchAllSponsors({ eventId: "e1", role: "all", published: "draft" });

    expect(rows.map((r) => r.id)).toEqual(["s0", "s1", "s2"]);
    expect(rpc.mock.calls).toEqual([
      [
        "admin_event_sponsors_list",
        { p_event_id: "e1", p_published: "draft", p_limit: 200, p_offset: 0 },
      ],
    ]);
  });

  // 180 ogloszonych i 30 nieogloszonych to 210 wierszy: jedna strona ucinala
  // 10 ostatnich, czyli ogloszonych partnerow z konca rankingu.
  it("210 przypiec: dwie strony (offset 0 i 200), komplet w kolejnosci RPC", async () => {
    listaRpc(strona(0, 210, 210));
    const { fetchAllSponsors } = await import("@/lib/events/sponsorsApi");

    const rows = await fetchAllSponsors({ eventId: "e1" });

    expect(rows).toHaveLength(210);
    expect(rows.at(-1)?.id).toBe("s209");
    expect(rpc.mock.calls.map(([, args]) => (args as Record<string, unknown>).p_offset)).toEqual([
      0, 200,
    ]);
  });

  it("pelna strona, ktora siega `total_count`, konczy petle BEZ pustego zapytania", async () => {
    listaRpc(strona(0, 400, 400));
    const { fetchAllSponsors } = await import("@/lib/events/sponsorsApi");

    await expect(fetchAllSponsors({ eventId: "e1" })).resolves.toHaveLength(400);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("pelna strona bez `total_count` nie konczy petli - konczy ja dopiero krotsza strona", async () => {
    listaRpc(strona(0, 200, null));
    const { fetchAllSponsors } = await import("@/lib/events/sponsorsApi");

    await expect(fetchAllSponsors({ eventId: "e1" })).resolves.toHaveLength(200);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("TWARDY STOP: po 10 stronach oddaje 2000 wierszy z ostrzezeniem - `total_count` zdradza uciecie", async () => {
    listaRpc(strona(0, 2100, 2100));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { fetchAllSponsors, SPONSORS_ALL_PAGES_MAX } = await import("@/lib/events/sponsorsApi");

    const rows = await fetchAllSponsors({ eventId: "e1" });

    expect(rpc).toHaveBeenCalledTimes(SPONSORS_ALL_PAGES_MAX);
    expect(rows).toHaveLength(2000);
    expect(rows[0]?.total_count).toBe(2100);
    expect(warn).toHaveBeenCalledWith("[events] sponsor list stopped at page cap", {
      eventId: "e1",
      pages: 10,
      loaded: 2000,
    });
    warn.mockRestore();
  });

  it("ten sam wiersz na dwoch stronach (lista zmieniona w trakcie) zostaje RAZ, na swoim miejscu", async () => {
    const page1 = strona(0, 200, 201);
    // Druga strona po wstawieniu w srodek listy: ostatni wiersz pierwszej strony
    // przesunal sie na druga, a nowszy wiersz zastepuje starszy.
    const moved = { id: "s199", total_count: 202, is_published: false };
    rpc
      .mockResolvedValueOnce({ data: page1, error: null })
      .mockResolvedValueOnce({ data: [moved, wiersz("s200", 202)], error: null });
    const { fetchAllSponsors } = await import("@/lib/events/sponsorsApi");

    const rows = await fetchAllSponsors({ eventId: "e1" });

    expect(rows).toHaveLength(201);
    expect(rows[199]).toBe(moved);
    expect(rows[200]?.id).toBe("s200");
  });

  it("odmowa bazy na KTOREJKOLWIEK stronie jest wyjatkiem, a nie polowa listy", async () => {
    rpc
      .mockResolvedValueOnce({ data: strona(0, 200, 250), error: null })
      .mockResolvedValueOnce({ data: null, error: { message: "forbidden: event admins only" } });
    const { fetchAllSponsors } = await import("@/lib/events/sponsorsApi");

    await expect(fetchAllSponsors({ eventId: "e1" })).rejects.toThrow(/forbidden/);
  });
});

describe("sponsorsApi - zapis sponsora", () => {
  beforeEach(() => rpc.mockResolvedValue({ data: "s1", error: null }));

  it("pomija nieustawione klucze, ale zachowuje jawny null", async () => {
    const { saveSponsor } = await import("@/lib/events/sponsorsApi");
    await saveSponsor({ id: "s1", tierId: null, boothLabel: null });
    const [name, args] = lastCall();
    expect(name).toBe("admin_event_sponsor_save");
    expect(args.p_payload).toEqual({ id: "s1", tier_id: null, booth_label: null });
  });

  it("tworzy przypiecie z firmy CRM", async () => {
    const { saveSponsor } = await import("@/lib/events/sponsorsApi");
    await saveSponsor({ eventId: "e1", companyId: "c1", role: "exhibitor", isPublished: false });
    expect(lastCall()[1].p_payload).toEqual({
      event_id: "e1",
      company_id: "c1",
      role: "exhibitor",
      is_published: false,
    });
  });
});

describe("sponsorsApi - poziomy, kontakty, materialy", () => {
  it("mapuje korzysci poziomu na snake_case z domyslnym wyroznieniem", async () => {
    rpc.mockResolvedValue({ data: "t1", error: null });
    const { saveSponsorTier } = await import("@/lib/events/sponsorsApi");
    await saveSponsorTier({
      eventId: "e1",
      key: "gold",
      namePl: "Złoty",
      nameEn: "Gold",
      maxCompanies: null,
      accentColor: "#FA9346",
      benefits: [{ labelPl: "Logo", labelEn: "Logo" }],
    });
    expect(lastCall()[1].p_payload).toEqual({
      event_id: "e1",
      key: "gold",
      name_pl: "Złoty",
      name_en: "Gold",
      max_companies: null,
      accent_color: "#FA9346",
      benefits: [{ label_pl: "Logo", label_en: "Logo", is_highlighted: false }],
    });
  });

  it("wysyla kontakty jako tablice items z sponsor_id", async () => {
    rpc.mockResolvedValue({ data: 2, error: null });
    const { setSponsorContacts } = await import("@/lib/events/sponsorsApi");
    const count = await setSponsorContacts("s1", [
      { leadId: "l1", role: "primary", isPrimary: true },
      { leadId: "l2" },
    ]);
    expect(count).toBe(2);
    expect(lastCall()[1].p_payload).toEqual({
      sponsor_id: "s1",
      items: [{ lead_id: "l1", role: "primary", is_primary: true }, { lead_id: "l2" }],
    });
  });

  it("porzadkuje materialy przez pary id/sort_order", async () => {
    rpc.mockResolvedValue({ data: 3, error: null });
    const { reorderSponsorMaterials } = await import("@/lib/events/sponsorsApi");
    await reorderSponsorMaterials([{ id: "m1", sortOrder: 10 }]);
    expect(lastCall()[1].p_payload).toEqual({ items: [{ id: "m1", sort_order: 10 }] });
  });

  it("odswiezanie migawek przyjmuje same ids bez event_id", async () => {
    rpc.mockResolvedValue({ data: 1, error: null });
    const { refreshSponsorSnapshots } = await import("@/lib/events/sponsorsApi");
    await refreshSponsorSnapshots({ ids: ["s1"], includeManual: true });
    expect(lastCall()[1].p_payload).toEqual({ ids: ["s1"], include_manual: true });
  });
});

describe("sponsorsApi - bledy", () => {
  it("przepisuje komunikat bazy na wyjatek", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "tier_full: tier allows 3, 3 pinned" } });
    const { saveSponsor } = await import("@/lib/events/sponsorsApi");
    await expect(saveSponsor({ id: "s1" })).rejects.toThrow(/tier_full/);
  });

  it("brak danych z listy daje pusta tablice, nie null", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const { fetchSponsorTiers } = await import("@/lib/events/sponsorsApi");
    await expect(fetchSponsorTiers("e1")).resolves.toEqual([]);
  });
});
