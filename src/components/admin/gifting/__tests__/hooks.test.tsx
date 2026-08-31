// Wspoldzielone zapytanie ustawien tenanta (`useGiftAdminSettingsQuery`).
//
// PO CO TEN PLIK ISTNIEJE. Ten hak nie jest "jeszcze jednym useQuery": jest
// UMOWA MIEDZY DWIEMA ZAKLADKAMI. Czytaja go rownoczesnie zakladka Ustawienia
// (formularz) i zakladka Linki (nota "nowe linki dostaja budzet N"). Trzyma je
// razem JEDEN klucz `["gift-admin", "settings"]` - ten sam, ktory
// `SettingsPanel` uniewaznia po zapisie. Rozjazd klucza nie psuje niczego
// widocznego od razu: obie zakladki dalej sie renderuja, tylko nota nad tabela
// linkow zostaje przy STAREJ liczbie i mowi adminowi, ze nowe linki dostaja
// budzet, ktorego juz nie dostaja. Dlatego klucz jest tu asertowany wprost,
// a nie tylko przez skutek uboczny w panelu.
//
// ATRAPY: granica sieciowa (`@/lib/gifting-admin.functions` + `useServerFn`).
// Prawdziwy react-query - to on jest przedmiotem testu.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, waitFor } from "@testing-library/react";
import { renderHookWithQueryClient } from "@/test/renderWithQueryClient";
import type { GiftAdminSettingsRow } from "@/lib/gifting-admin.functions";

const h = vi.hoisted(() => ({ getSettings: vi.fn() }));

// Mock CZESCIOWY: podmieniamy wylacznie `useServerFn` (w produkcji owija
// funkcje serwerowa), reszta pakietu musi zostac - `@/lib/i18n` ciagnie stad
// `createIsomorphicFn`.
vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-start")>();
  return { ...actual, useServerFn: (fn: unknown) => fn };
});

vi.mock("@/lib/gifting-admin.functions", () => ({
  getGiftAdminSettings: (...args: unknown[]) => h.getSettings(...args),
}));

const { useGiftAdminSettingsQuery } = await import("@/components/admin/gifting/hooks");

function row(overrides: Partial<GiftAdminSettingsRow> = {}): GiftAdminSettingsRow {
  return {
    enabled: true,
    monthly_limit: 10,
    link_ttl_days: 30,
    max_redemptions_per_link: 5,
    eligibility: "registered",
    updated_at: "2026-08-01T10:00:00.000Z",
    updated_by: "00000000-0000-4000-8000-000000000001",
    persisted: true,
    ...overrides,
  };
}

beforeEach(() => {
  h.getSettings.mockReset();
});

describe("useGiftAdminSettingsQuery", () => {
  it("startuje w stanie ladowania, zanim serwer odpowie", () => {
    h.getSettings.mockReturnValue(new Promise(() => {}));
    const { result } = renderHookWithQueryClient(() => useGiftAdminSettingsQuery());
    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toBeUndefined();
  });

  it("oddaje wiersz ustawien po udanym odczycie", async () => {
    h.getSettings.mockResolvedValue(row({ max_redemptions_per_link: 7 }));
    const { result } = renderHookWithQueryClient(() => useGiftAdminSettingsQuery());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.max_redemptions_per_link).toBe(7);
    expect(result.current.data?.persisted).toBe(true);
  });

  it("przenosi tenanta BEZ wiersza (persisted:false) bez gubienia domyslnych", async () => {
    // "Brak wiersza" to nie blad i nie pusty wynik - to stan, w ktorym serwer
    // podaje efektywne domyslne. Zgubienie flagi `persisted` zamienialoby
    // pierwszy zapis w "brak zmian" (przycisk nieaktywny na zawsze).
    h.getSettings.mockResolvedValue(row({ persisted: false, updated_at: null, updated_by: null }));
    const { result } = renderHookWithQueryClient(() => useGiftAdminSettingsQuery());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.persisted).toBe(false);
    expect(result.current.data?.monthly_limit).toBe(10);
  });

  it("odmowa serwera trafia do stanu bledu, a nie do cichych danych", async () => {
    h.getSettings.mockRejectedValue(new Error("Forbidden"));
    const { result } = renderHookWithQueryClient(() => useGiftAdminSettingsQuery());
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
    expect((result.current.error as Error).message).toBe("Forbidden");
  });

  it("siedzi pod kluczem ['gift-admin','settings'] - tym, ktory zapis uniewaznia", async () => {
    h.getSettings.mockResolvedValue(row());
    const { result, queryClient } = renderHookWithQueryClient(() => useGiftAdminSettingsQuery());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(queryClient.getQueryData(["gift-admin", "settings"])).toEqual(row());
  });

  it("dwaj konsumenci (Ustawienia + Linki) dziela JEDNO zapytanie", async () => {
    // Gdyby klucz byl skladany z czegokolwiek zmiennego, kazda zakladka
    // strzelalaby osobno i widzialaby inna wersje ustawien.
    h.getSettings.mockResolvedValue(row());
    const { result } = renderHookWithQueryClient(() => ({
      ustawienia: useGiftAdminSettingsQuery(),
      linki: useGiftAdminSettingsQuery(),
    }));
    await waitFor(() => expect(result.current.ustawienia.isSuccess).toBe(true));
    expect(result.current.linki.data).toBe(result.current.ustawienia.data);
    expect(h.getSettings).toHaveBeenCalledTimes(1);
  });

  it("wola funkcje serwerowa BEZ argumentow (server fn typu GET)", async () => {
    h.getSettings.mockResolvedValue(row());
    const { result } = renderHookWithQueryClient(() => useGiftAdminSettingsQuery());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(h.getSettings).toHaveBeenCalledWith();
  });

  it("ma 30-sekundowy staleTime - ponowny mount nie strzela od nowa", async () => {
    h.getSettings.mockResolvedValue(row());
    const { result, rerender } = renderHookWithQueryClient(() => useGiftAdminSettingsQuery());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    rerender();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(h.getSettings).toHaveBeenCalledTimes(1);
  });

  it("uniewaznienie klucza wymusza ponowny odczyt i podmienia wspolna pamiec", async () => {
    // To jest druga polowa umowy: `SettingsPanel` po zapisie robi dokladnie
    // `invalidateQueries({ queryKey: ["gift-admin", "settings"] })`. Asercja
    // idzie na PAMIEC PODRECZNA, bo to ona jest tu wspolna dla obu zakladek -
    // odswiezenie samego widoku Ustawien niczego by nie dowodzilo o nocie nad
    // tabela linkow.
    h.getSettings.mockResolvedValue(row({ max_redemptions_per_link: 5 }));
    const { result, rerender, queryClient } = renderHookWithQueryClient(() =>
      useGiftAdminSettingsQuery(),
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    h.getSettings.mockResolvedValue(row({ max_redemptions_per_link: 42 }));
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ["gift-admin", "settings"] });
    });
    expect(h.getSettings).toHaveBeenCalledTimes(2);
    expect(
      queryClient.getQueryData<GiftAdminSettingsRow>(["gift-admin", "settings"])
        ?.max_redemptions_per_link,
    ).toBe(42);

    // ...a konsument widzi nowa wartosc przy najblizszym renderze.
    rerender();
    await waitFor(() => expect(result.current.data?.max_redemptions_per_link).toBe(42));
  });

  it("uniewaznienie CUDZEGO klucza go nie rusza", async () => {
    // Asercja "z drugiej strony": sam dowod "cos sie odswiezylo" przechodzilby
    // takze dla `invalidateQueries()` bez klucza, czyli dla skasowania calej
    // pamieci podrecznej panelu.
    h.getSettings.mockResolvedValue(row());
    const { result, queryClient } = renderHookWithQueryClient(() => useGiftAdminSettingsQuery());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ["gift-admin", "links"] });
    });
    expect(h.getSettings).toHaveBeenCalledTimes(1);
  });
});
