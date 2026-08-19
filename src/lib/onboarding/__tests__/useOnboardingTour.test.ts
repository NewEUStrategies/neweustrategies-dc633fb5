// Maszyna stanów wycieczki jest testowana bez JSX, niezależnie od geometrii overlayu
// i od implementacji localStorage, która ma własny zestaw testów.
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TourStep } from "@/lib/onboarding/types";

const h = vi.hoisted(() => ({
  dismissed: false,
  isDismissed: vi.fn(),
  dismiss: vi.fn(),
  raf: null as FrameRequestCallback | null,
  cancel: vi.fn(),
}));

vi.mock("@/lib/onboarding/tourStorage", () => ({
  isTourDismissed: (id: string) => h.isDismissed(id),
  dismissTour: (id: string) => h.dismiss(id),
}));

const { useOnboardingTour } = await import("@/lib/onboarding/useOnboardingTour");

const STEPS: TourStep[] = [
  { id: "one", titleKey: "one.title", bodyKey: "one.body" },
  { id: "two", titleKey: "two.title", bodyKey: "two.body" },
  { id: "three", titleKey: "three.title", bodyKey: "three.body" },
];

beforeEach(() => {
  h.dismissed = false;
  h.raf = null;
  h.cancel.mockReset();
  h.isDismissed.mockReset().mockImplementation(() => h.dismissed);
  h.dismiss.mockReset().mockImplementation(() => {
    h.dismissed = true;
  });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    h.raf = callback;
    return 17;
  });
  vi.stubGlobal("cancelAnimationFrame", h.cancel);
});

describe("useOnboardingTour", () => {
  it("pierwsze uruchomienie startuje po zamontowaniu kotwic", () => {
    const { result } = renderHook(() => useOnboardingTour({ id: "builder", steps: STEPS }));

    expect(result.current.active).toBe(false);
    expect(h.isDismissed).toHaveBeenCalledWith("builder");
    expect(h.raf).toBeTypeOf("function");

    act(() => h.raf?.(0));

    expect(result.current.active).toBe(true);
    expect(result.current.stepIndex).toBe(0);
    expect(result.current.currentStep?.id).toBe("one");
    expect(result.current.totalSteps).toBe(3);
  });

  it("wznawia stan w połowie podczas ponownego renderu tej samej sesji", () => {
    const { result, rerender } = renderHook(
      ({ enabled }) => useOnboardingTour({ id: "builder", steps: STEPS, enabled }),
      { initialProps: { enabled: true } },
    );
    act(() => h.raf?.(0));
    act(() => {
      result.current.next();
      result.current.next();
    });

    rerender({ enabled: true });

    expect(result.current.active).toBe(true);
    expect(result.current.stepIndex).toBe(2);
    expect(result.current.currentStep?.id).toBe("three");
    expect(h.dismiss).not.toHaveBeenCalled();
  });

  it("cofanie zatrzymuje się na pierwszym kroku", () => {
    const { result } = renderHook(() =>
      useOnboardingTour({ id: "builder", steps: STEPS, autoStart: false }),
    );
    act(() => result.current.start());
    act(() => result.current.prev());

    expect(result.current.active).toBe(true);
    expect(result.current.stepIndex).toBe(0);
    expect(result.current.currentStep?.id).toBe("one");
  });

  it("następny krok na końcu zamyka i trwale oznacza wycieczkę", () => {
    const { result } = renderHook(() =>
      useOnboardingTour({ id: "builder", steps: [STEPS[0]], autoStart: false }),
    );
    act(() => result.current.start());
    act(() => result.current.next());

    expect(result.current.active).toBe(false);
    expect(result.current.stepIndex).toBe(0);
    expect(result.current.currentStep).toBeNull();
    expect(h.dismiss).toHaveBeenCalledWith("builder");
  });

  it("pominięcie blokuje automatyczny start następnej instancji", () => {
    const first = renderHook(() =>
      useOnboardingTour({ id: "builder", steps: STEPS, autoStart: false }),
    );
    act(() => first.result.current.start());
    act(() => first.result.current.skip());
    first.unmount();

    h.raf = null;
    const second = renderHook(() => useOnboardingTour({ id: "builder", steps: STEPS }));

    expect(h.dismissed).toBe(true);
    expect(second.result.current.active).toBe(false);
    expect(h.raf).toBeNull();
    expect(h.dismiss).toHaveBeenCalledTimes(1);
  });

  it("finish ma ten sam trwały kontrakt co skip", () => {
    const { result } = renderHook(() =>
      useOnboardingTour({ id: "blocks", steps: STEPS, autoStart: false }),
    );
    act(() => result.current.start());
    act(() => result.current.finish());

    expect(result.current.active).toBe(false);
    expect(result.current.currentStep).toBeNull();
    expect(h.dismiss).toHaveBeenCalledWith("blocks");
  });

  it("wyłączona, pusta lub ręczna wycieczka nie planuje auto-startu", () => {
    const disabled = renderHook(() =>
      useOnboardingTour({ id: "disabled", steps: STEPS, enabled: false }),
    );
    const empty = renderHook(() => useOnboardingTour({ id: "empty", steps: [] }));
    const manual = renderHook(() =>
      useOnboardingTour({ id: "manual", steps: STEPS, autoStart: false }),
    );

    expect(disabled.result.current.active).toBe(false);
    expect(empty.result.current.totalSteps).toBe(0);
    expect(manual.result.current.active).toBe(false);
    expect(h.raf).toBeNull();
  });

  it("odmontowanie anuluje zaplanowaną klatkę", () => {
    const mounted = renderHook(() => useOnboardingTour({ id: "builder", steps: STEPS }));
    expect(h.raf).toBeTypeOf("function");

    mounted.unmount();

    expect(h.cancel).toHaveBeenCalledWith(17);
    expect(h.cancel).toHaveBeenCalledTimes(1);
  });
});
