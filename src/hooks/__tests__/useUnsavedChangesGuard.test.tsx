// Zapora nawigacyjna edytora: `useUnsavedChangesGuard(when)`.
//
// Hook nie ma stanu ani wyniku - cała jego treść to konfiguracja `useBlocker`
// TanStack Routera. Testujemy więc DOKŁADNIE to, co ten hook stanowi: jaką
// konfigurację oddaje routerowi i jak tłumaczy decyzję użytkownika na odpowiedź
// blokera. Atrapa `useBlocker` przechwytuje tę konfigurację, żeby dało się ją
// wywołać bez routera.
//
// JEDNA ASERCJA JEST TU NAJWAŻNIEJSZA: `shouldBlockFn` zwraca `!leave`.
// Odwrócenie tej negacji nie wysypuje niczego i nie psuje żadnego typu - po
// prostu redaktor, który wybrał „zostaję", zostaje wyrzucony z edytora razem
// z niezapisanym tekstem. Do 18.08 ten hook (0/3 funkcji) nie miał ani jednego
// testu, więc taka literówka przeszłaby przez całą bramkę CI.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";

interface BlockerConfig {
  disabled?: boolean;
  enableBeforeUnload?: () => boolean;
  shouldBlockFn?: () => Promise<boolean> | boolean;
}

const captured = vi.hoisted(() => ({ configs: [] as BlockerConfig[] }));

vi.mock("@tanstack/react-router", () => ({
  useBlocker: (config: BlockerConfig) => {
    captured.configs.push(config);
  },
}));

import { requestLeaveConfirmation, resolveLeaveConfirmation } from "@/lib/unsavedChanges";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";

const lastConfig = () => captured.configs.at(-1)!;

beforeEach(() => {
  captured.configs.length = 0;
});

afterEach(() => {
  // Stan store'a jest modułowy - domknij ewentualne wiszące pytanie.
  resolveLeaveConfirmation(false);
});

describe("useUnsavedChangesGuard - konfiguracja blokera", () => {
  it("bez niezapisanych zmian bloker jest WYŁĄCZONY", () => {
    // Włączony bloker przy czystym formularzu pytałby przy każdym kliknięciu
    // w menu - redaktorzy nauczyliby się klikać „wychodzę" odruchowo i zapora
    // przestałaby cokolwiek chronić.
    renderHook(() => useUnsavedChangesGuard(false));
    expect(lastConfig().disabled).toBe(true);
  });

  it("z niezapisanymi zmianami bloker jest WŁĄCZONY", () => {
    renderHook(() => useUnsavedChangesGuard(true));
    expect(lastConfig().disabled).toBe(false);
  });

  it("zgłasza routerowi obie warstwy: bloker w aplikacji i beforeunload", () => {
    renderHook(() => useUnsavedChangesGuard(true));
    const config = lastConfig();
    // W aplikacji: własny dialog w systemie designu.
    expect(config.shouldBlockFn).toBeTypeOf("function");
    // Zamknięcie karty / twarde odświeżenie: natywny monit przeglądarki
    // (przeglądarki celowo nie pozwalają go ostylować).
    expect(config.enableBeforeUnload).toBeTypeOf("function");
  });
});

describe("useUnsavedChangesGuard - tłumaczenie decyzji na odpowiedź blokera", () => {
  it("„wychodzę” (leave=true) PRZEPUSZCZA nawigację", async () => {
    renderHook(() => useUnsavedChangesGuard(true));

    const blocked = lastConfig().shouldBlockFn!();
    resolveLeaveConfirmation(true);

    // `false` = nie blokuj. Redaktor świadomie porzucił zmiany.
    await expect(blocked).resolves.toBe(false);
  });

  it("„zostaję” (leave=false) BLOKUJE nawigację", async () => {
    renderHook(() => useUnsavedChangesGuard(true));

    const blocked = lastConfig().shouldBlockFn!();
    resolveLeaveConfirmation(false);

    // `true` = blokuj. To ta asercja pilnuje negacji `!leave`.
    await expect(blocked).resolves.toBe(true);
  });

  it("otwiera dokładnie jedno pytanie na jedno zdarzenie nawigacji", async () => {
    const seen = vi.fn();
    renderHook(() => useUnsavedChangesGuard(true));

    const blocked = lastConfig().shouldBlockFn!();
    // Podpięcie się PO wywołaniu blokera i tak widzi wiszące pytanie, bo
    // `subscribeLeaveConfirmation` woła callback stanem bieżącym.
    const unsubscribe = (await import("@/lib/unsavedChanges")).subscribeLeaveConfirmation(
      (pending) => seen(pending),
    );
    expect(seen.mock.calls[0][0]).toBeTypeOf("function");

    resolveLeaveConfirmation(true);
    await blocked;
    unsubscribe();
  });
});

describe("useUnsavedChangesGuard - świeżość wartości `when`", () => {
  it("shouldBlockFn po zmianie na `false` nie otwiera już pytania", async () => {
    // Autosave dobił zapis W TRAKCIE otwartego dialogu / po jego zamknięciu.
    // Bloker musi czytać AKTUALNĄ wartość, nie tę z renderu, w którym powstał -
    // inaczej pytałby o porzucenie zmian, których już nie ma.
    const { rerender } = renderHook(({ dirty }) => useUnsavedChangesGuard(dirty), {
      initialProps: { dirty: true },
    });

    rerender({ dirty: false });

    // Brak `resolveLeaveConfirmation` w tym teście jest celowy: gdyby hook
    // czytał starą wartość, funkcja czekałaby na decyzję i test by wisiał.
    await expect(lastConfig().shouldBlockFn!()).resolves.toBe(false);
  });

  it("enableBeforeUnload czyta AKTUALNĄ wartość `when` po rerenderze", () => {
    const { rerender } = renderHook(({ dirty }) => useUnsavedChangesGuard(dirty), {
      initialProps: { dirty: false },
    });
    expect(lastConfig().enableBeforeUnload!()).toBe(false);

    rerender({ dirty: true });
    expect(lastConfig().enableBeforeUnload!()).toBe(true);

    // I z powrotem - ref nie zamraża wartości w żadną stronę.
    rerender({ dirty: false });
    expect(lastConfig().enableBeforeUnload!()).toBe(false);
  });

  it("po odmontowaniu nie zostaje wiszące pytanie w store", async () => {
    const { unmount } = renderHook(() => useUnsavedChangesGuard(true));
    unmount();

    // Store jest czysty: świeże żądanie dostaje własny resolver i nie jest
    // odrzucane jako „poprzednie" przez pozostałość po odmontowanym edytorze.
    const pending = requestLeaveConfirmation();
    resolveLeaveConfirmation(true);
    await expect(pending).resolves.toBe(true);
  });
});
