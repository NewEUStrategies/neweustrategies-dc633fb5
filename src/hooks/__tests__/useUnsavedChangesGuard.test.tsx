// Strażnik wyjścia z edytora. Hook jest cienki, ale niesie trzy warunki, bez
// których redaktor traci pracę albo nie może wyjść ze strony:
//   * blokada ma być WYŁĄCZONA, gdy nie ma czego zapisywać (inaczej każde
//     kliknięcie w menu pyta o potwierdzenie),
//   * `shouldBlockFn` musi czytać AKTUALNE `when`, nie to z renderu, w którym
//     blokadę zarejestrowano (callback jest asynchroniczny i przeżywa rendery),
//   * zwracana wartość jest ZANEGOWANA względem odpowiedzi użytkownika:
//     „wyjdź" (leave=true) znaczy „nie blokuj" (false). Odwrócenie tego znaku
//     zamienia przycisk „Wyjdź bez zapisywania" w przycisk, który zostawia
//     redaktora na stronie - i odwrotnie, „Zostań" wyrzuca go z edytora.
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const blockerCalls: Array<Record<string, unknown>> = [];

vi.mock("@tanstack/react-router", () => ({
  useBlocker: (opts: Record<string, unknown>) => {
    blockerCalls.push(opts);
  },
}));

const requestLeaveConfirmation = vi.fn<() => Promise<boolean>>();
vi.mock("@/lib/unsavedChanges", () => ({
  requestLeaveConfirmation: () => requestLeaveConfirmation(),
}));

import { useUnsavedChangesGuard } from "../useUnsavedChangesGuard";

/** Opcje przekazane do `useBlocker` przy OSTATNIM renderze. */
function lastOptions() {
  return blockerCalls[blockerCalls.length - 1];
}

beforeEach(() => {
  blockerCalls.length = 0;
  requestLeaveConfirmation.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("useUnsavedChangesGuard", () => {
  it("wyłącza blokadę, gdy nie ma niezapisanych zmian", () => {
    renderHook(() => useUnsavedChangesGuard(false));
    expect(lastOptions().disabled).toBe(true);
  });

  it("włącza blokadę, gdy zmiany czekają na zapis", () => {
    renderHook(() => useUnsavedChangesGuard(true));
    expect(lastOptions().disabled).toBe(false);
  });

  it("nie pyta o potwierdzenie, gdy blokada jest nieaktywna", async () => {
    renderHook(() => useUnsavedChangesGuard(false));
    const shouldBlock = lastOptions().shouldBlockFn as () => Promise<boolean>;

    await expect(shouldBlock()).resolves.toBe(false);
    expect(requestLeaveConfirmation).not.toHaveBeenCalled();
  });

  it("BLOKUJE nawigację, gdy użytkownik wybrał „zostań”", async () => {
    requestLeaveConfirmation.mockResolvedValue(false);
    renderHook(() => useUnsavedChangesGuard(true));
    const shouldBlock = lastOptions().shouldBlockFn as () => Promise<boolean>;

    await expect(shouldBlock()).resolves.toBe(true);
    expect(requestLeaveConfirmation).toHaveBeenCalledTimes(1);
  });

  it("PRZEPUSZCZA nawigację, gdy użytkownik wybrał „wyjdź bez zapisywania”", async () => {
    requestLeaveConfirmation.mockResolvedValue(true);
    renderHook(() => useUnsavedChangesGuard(true));
    const shouldBlock = lastOptions().shouldBlockFn as () => Promise<boolean>;

    await expect(shouldBlock()).resolves.toBe(false);
  });

  it("czyta AKTUALNE `when`, nie wartość z renderu rejestrującego blokadę", async () => {
    // `shouldBlockFn` jest asynchroniczny i przeżywa rendery. Gdyby domykał
    // `when` przez wartość, autozapis, który zakończył się w trakcie otwartego
    // dialogu, nadal trzymałby redaktora na stronie.
    requestLeaveConfirmation.mockResolvedValue(false);
    const { rerender } = renderHook(({ dirty }) => useUnsavedChangesGuard(dirty), {
      initialProps: { dirty: true },
    });

    const shouldBlock = lastOptions().shouldBlockFn as () => Promise<boolean>;
    rerender({ dirty: false });

    await expect(shouldBlock()).resolves.toBe(false);
    expect(requestLeaveConfirmation).not.toHaveBeenCalled();
  });

  it("zamknięcie karty pyta natywnym `beforeunload` tylko przy niezapisanych zmianach", () => {
    const { rerender } = renderHook(({ dirty }) => useUnsavedChangesGuard(dirty), {
      initialProps: { dirty: true },
    });

    const enableBeforeUnload = lastOptions().enableBeforeUnload as () => boolean;
    expect(enableBeforeUnload()).toBe(true);

    // Ta sama instancja funkcji po zapisie musi już odpowiadać „nie pytaj".
    rerender({ dirty: false });
    expect(enableBeforeUnload()).toBe(false);
  });
});
