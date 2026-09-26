// Gotowość skanera do pracy bez sieci - hook łączący worker i przechowywanie.
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW.
//   1. ROZGRZANIE PRZED SŁOWNIKAMI. Drugi język rdzenia ładuje się leniwie -
//      prośba do workera wysłana przed jego pobraniem nie obejmuje tego chunku
//      i przełączenie języka bez sieci pokazuje surowe klucze.
//   2. ROZGRZANIE PRZY NIEPOTWIERDZONEJ SESJI (np. zimny start offline) -
//      zbędne żądania w chwili, gdy sieci i tak nie ma.
//   3. KARTA „ZAPISANA" po częściowym zapisie albo bez odpowiedzi workera.
//   4. ODPOWIEDŹ PO ODMONTOWANIU zmienia stan nieistniejącego komponentu.
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  order: [] as string[],
  precache: vi.fn(),
  persisted: vi.fn(),
  persist: vi.fn(),
  ensure: vi.fn(),
}));

vi.mock("@/lib/i18n", () => ({
  ensureCoreLanguage: (lang: string) => {
    h.order.push(`core:${lang}`);
    return h.ensure(lang);
  },
}));

vi.mock("@/lib/events/scannerPwa", () => ({
  requestScannerPrecache: () => {
    h.order.push("precache");
    return h.precache();
  },
  storagePersisted: () => h.persisted(),
  requestPersistentStorage: () => h.persist(),
}));

const { shellReadiness, useScannerReadiness } = await import("@/lib/events/useScannerReadiness");

beforeEach(() => {
  h.order = [];
  h.precache.mockReset().mockResolvedValue({ cached: 4, total: 4 });
  h.persisted.mockReset().mockResolvedValue(false);
  h.persist.mockReset().mockResolvedValue(true);
  h.ensure.mockReset().mockResolvedValue(undefined);
});

describe("shellReadiness", () => {
  it("brak odpowiedzi albo zero plików to „brak”, komplet to „gotowa”, reszta - „częściowa”", () => {
    expect(shellReadiness(null)).toBe("missing");
    expect(shellReadiness({ cached: 0, total: 5 })).toBe("missing");
    expect(shellReadiness({ cached: 5, total: 5 })).toBe("ready");
    expect(shellReadiness({ cached: 2, total: 5 })).toBe("partial");
  });
});

describe("useScannerReadiness", () => {
  it("NIEAKTYWNY nie rusza workera ani przechowywania - stan „sprawdzam”", async () => {
    const { result } = renderHook(() => useScannerReadiness(false));
    await act(async () => {});
    expect(result.current.shell).toBe("checking");
    expect(h.precache).not.toHaveBeenCalled();
    expect(h.persisted).not.toHaveBeenCalled();
  });

  it("aktywny: najpierw oba słowniki rdzenia, potem rozgrzanie workera", async () => {
    const { result } = renderHook(() => useScannerReadiness(true));
    await waitFor(() => expect(result.current.shell).toBe("ready"));
    expect(h.order).toEqual(["core:pl", "core:en", "precache"]);
    expect(result.current.precache).toEqual({ cached: 4, total: 4 });
    expect(result.current.storagePersisted).toBe(false);
    expect(result.current.persistRequest).toBeNull();
  });

  it("awaria dociągnięcia słownika NIE blokuje rozgrzania", async () => {
    h.ensure.mockRejectedValue(new Error("chunk"));
    const { result } = renderHook(() => useScannerReadiness(true));
    await waitFor(() => expect(result.current.shell).toBe("ready"));
  });

  it("milczący worker to „brak”, a nie wieczne „sprawdzam”", async () => {
    h.precache.mockResolvedValue(null);
    const { result } = renderHook(() => useScannerReadiness(true));
    await waitFor(() => expect(result.current.shell).toBe("missing"));
  });

  it("prośba o trwałe przechowywanie: zgoda przestawia stan, odmowa go zostawia", async () => {
    const { result } = renderHook(() => useScannerReadiness(true));
    await waitFor(() => expect(result.current.storagePersisted).toBe(false));

    h.persist.mockResolvedValueOnce(false);
    act(() => result.current.requestPersist());
    await waitFor(() => expect(result.current.persistRequest).toBe(false));
    expect(result.current.storagePersisted).toBe(false);

    h.persist.mockResolvedValueOnce(null);
    act(() => result.current.requestPersist());
    await waitFor(() => expect(result.current.persistRequest).toBe(false));

    act(() => result.current.requestPersist());
    await waitFor(() => expect(result.current.persistRequest).toBe(true));
    expect(result.current.storagePersisted).toBe(true);
  });

  it("odpowiedzi po odmontowaniu nie zmieniają stanu", async () => {
    let finishPrecache: (value: unknown) => void = () => undefined;
    let finishPersisted: (value: unknown) => void = () => undefined;
    h.precache.mockReturnValue(new Promise((resolve) => (finishPrecache = resolve)));
    h.persisted.mockReturnValue(new Promise((resolve) => (finishPersisted = resolve)));
    const { result, unmount } = renderHook(() => useScannerReadiness(true));
    const before = result.current;
    unmount();
    await act(async () => {
      finishPrecache({ cached: 1, total: 1 });
      finishPersisted(true);
    });
    expect(result.current).toBe(before);
    expect(before.shell).toBe("checking");
  });
});
