// Leniwy moduł odczytu i zapisu `newsletter_settings` (P3.8): dedup lotu
// odczytu i jego granica przy zapisie z panelu.
//
// CO TEN PLIK DOWODZI. Pełny klucz (popup) i projekcja inline czytają ten sam
// wiersz jednym lotem. Ale lot rozpoczęty PRZED zapisem w panelu nie może
// obsłużyć odświeżenia PO zapisie (recenzja P3.8, m4): dołączenie do niego
// zapisałoby w cache'u ustawienia sprzed zapisu na cały `staleTime`.
//
// ATRAPUJEMY WYŁĄCZNIE GRANICĘ: klienta Supabase, z odczytem, który test może
// przytrzymać w locie (wspólna atrapa łańcucha odpowiada synchronicznie).
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  reads: 0,
  writes: 0,
  hold: false,
  held: [] as Array<(result: { data: unknown; error: null }) => void>,
  row: { heading_pl: "Stary nagłówek" } as Record<string, unknown>,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: (columns: string) => ({
        maybeSingle: () => {
          if (columns === "tenant_id") {
            return Promise.resolve({ data: { tenant_id: "t-1" }, error: null });
          }
          db.reads += 1;
          if (db.hold) return new Promise((resolve) => db.held.push(resolve));
          return Promise.resolve({ data: { ...db.row }, error: null });
        },
      }),
      update: (patch: Record<string, unknown>) => ({
        eq: async () => {
          db.writes += 1;
          db.row = { ...db.row, ...patch };
          return { error: null };
        },
      }),
      insert: async () => ({ error: null }),
    }),
  },
}));

const { fetchNewsletterSettings, fetchNewsletterInlineSettings, saveNewsletterSettings } =
  await import("@/hooks/newsletterSettingsData");

beforeEach(() => {
  db.reads = 0;
  db.writes = 0;
  db.hold = false;
  db.held = [];
  db.row = { heading_pl: "Stary nagłówek" };
});

describe("newsletterSettingsData: jeden lot odczytu", () => {
  it("równoległe odczyty pełnego wiersza i projekcji inline dzielą jeden GET", async () => {
    const [full, inline] = await Promise.all([
      fetchNewsletterSettings(),
      fetchNewsletterInlineSettings(),
    ]);

    expect(db.reads).toBe(1);
    expect(full.heading_pl).toBe("Stary nagłówek");
    expect(inline.heading_pl).toBe("Stary nagłówek");
    // Wiersz scalony z domyślnymi: pola spoza bazy mają wartości domyślne.
    expect(full.popup_mailing_lists).toEqual([]);
  });

  it("zapis w panelu odcina lot sprzed zapisu - odświeżenie po zapisie idzie do sieci", async () => {
    db.hold = true;
    const before = fetchNewsletterSettings();
    expect(db.reads).toBe(1);

    await saveNewsletterSettings({ heading_pl: "Nowy nagłówek" });
    expect(db.writes).toBe(1);

    // Odświeżenie po inwalidacji: NOWY lot, nie dołączenie do lotu sprzed zapisu.
    const after = fetchNewsletterSettings();
    expect(db.reads).toBe(2);

    // Spóźniony lot sprzed zapisu kończy się i NIE zwalnia cudzego lotu:
    // kolejny odczyt nadal dołącza do lotu po zapisie.
    db.held[0]?.({ data: { heading_pl: "Stary nagłówek" }, error: null });
    await expect(before).resolves.toMatchObject({ heading_pl: "Stary nagłówek" });
    const joined = fetchNewsletterSettings();
    expect(db.reads).toBe(2);

    db.held[1]?.({ data: { heading_pl: "Nowy nagłówek" }, error: null });
    await expect(after).resolves.toMatchObject({ heading_pl: "Nowy nagłówek" });
    await expect(joined).resolves.toMatchObject({ heading_pl: "Nowy nagłówek" });
  });
});
