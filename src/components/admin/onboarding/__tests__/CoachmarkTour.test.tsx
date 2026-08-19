import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { TourController, TourStep } from "@/lib/onboarding/types";

const h = vi.hoisted(() => ({ reduced: false }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: { current?: number; total?: number }) =>
      values ? `${key}:${values.current}/${values.total}` : key,
  }),
}));
vi.mock("@/hooks/usePrefersReducedMotion", () => ({
  usePrefersReducedMotion: () => h.reduced,
}));

const { CoachmarkTour, computeCardPos } =
  await import("@/components/admin/onboarding/CoachmarkTour");

const STEPS: TourStep[] = [
  { id: "one", titleKey: "tour.one.title", bodyKey: "tour.one.body" },
  {
    id: "two",
    anchor: "target",
    titleKey: "tour.two.title",
    bodyKey: "tour.two.body",
    placement: "right",
  },
];

function controller(overrides: Partial<TourController> = {}): TourController {
  return {
    active: true,
    stepIndex: 0,
    currentStep: STEPS[0],
    totalSteps: 2,
    start: vi.fn(),
    next: vi.fn(),
    prev: vi.fn(),
    skip: vi.fn(),
    finish: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  h.reduced = false;
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 768 });
});

describe("computeCardPos", () => {
  it("centruje kartę bez elementu docelowego", () => {
    const position = computeCardPos(null, undefined, 180, 1024, 768);

    expect(position).toEqual({ top: 294, left: 362 });
    expect(position.top).toBeGreaterThanOrEqual(12);
  });

  it("w małym oknie przycina kartę do bezpiecznego marginesu", () => {
    const position = computeCardPos(null, "bottom", 300, 240, 180);

    expect(position.top).toBe(12);
    expect(position.left).toBe(12);
  });

  it("ustawia kartę nad i pod elementem, gdy jest miejsce", () => {
    const rect = { top: 300, left: 400, width: 100, height: 40 };

    expect(computeCardPos(rect, "top", 100, 1000, 800)).toEqual({ top: 188, left: 300 });
    expect(computeCardPos(rect, "bottom", 100, 1000, 800)).toEqual({ top: 352, left: 300 });
  });

  it("odwraca stronę pionową przy kolizji z krawędzią", () => {
    const nearTop = { top: 20, left: 400, width: 100, height: 40 };
    const nearBottom = { top: 740, left: 400, width: 100, height: 30 };

    expect(computeCardPos(nearTop, "top", 100, 1000, 800).top).toBe(72);
    expect(computeCardPos(nearBottom, "bottom", 100, 1000, 800).top).toBe(628);
  });

  it("odwraca stronę poziomą przy kolizji z krawędzią", () => {
    const nearLeft = { top: 300, left: 10, width: 40, height: 40 };
    const nearRight = { top: 300, left: 950, width: 40, height: 40 };

    expect(computeCardPos(nearLeft, "left", 100, 1000, 800).left).toBe(62);
    expect(computeCardPos(nearRight, "right", 100, 1000, 800).left).toBe(638);
  });

  it("przycina cel znajdujący się poza widokiem", () => {
    const position = computeCardPos(
      { top: -200, left: -400, width: 20, height: 20 },
      undefined,
      500,
      280,
      220,
    );

    expect(position.left).toBe(12);
    expect(position.top).toBe(12);
  });
});

describe("CoachmarkTour", () => {
  it("nie renderuje nieaktywnej lub pozbawionej kroku wycieczki", () => {
    const first = render(<CoachmarkTour controller={controller({ active: false })} />);
    expect(screen.queryByRole("dialog")).toBeNull();

    first.rerender(<CoachmarkTour controller={controller({ currentStep: null })} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renderuje środkową kartę z treścią, postępem i akcjami", () => {
    const c = controller();
    render(<CoachmarkTour controller={c} />);

    expect(screen.getByRole("dialog", { name: "tour.one.title" })).toBeTruthy();
    expect(screen.getByText("tour.one.body")).toBeTruthy();
    expect(screen.getByText("admin.onboarding.common.stepOf:1/2")).toBeTruthy();
    expect(screen.queryByText("admin.onboarding.common.back")).toBeNull();

    fireEvent.click(screen.getByText("admin.onboarding.common.next"));
    fireEvent.click(screen.getByText("admin.onboarding.common.skip"));
    expect(c.next).toHaveBeenCalledTimes(1);
    expect(c.skip).toHaveBeenCalledTimes(1);
  });

  it("ostatni krok pokazuje cofnięcie i kończy wycieczkę", () => {
    const c = controller({ stepIndex: 1, currentStep: { ...STEPS[1], anchor: undefined } });
    render(<CoachmarkTour controller={c} />);

    fireEvent.click(screen.getByText("admin.onboarding.common.back"));
    fireEvent.click(screen.getByText("admin.onboarding.common.done"));

    expect(c.prev).toHaveBeenCalledTimes(1);
    expect(c.finish).toHaveBeenCalledTimes(1);
    expect(c.next).not.toHaveBeenCalled();
  });

  it("obsługuje Escape oraz strzałki bez utraty fokusa dialogu", () => {
    const c = controller();
    render(<CoachmarkTour controller={c} />);

    fireEvent.keyDown(window, { key: "ArrowRight" });
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    fireEvent.keyDown(window, { key: "Escape" });

    expect(c.next).toHaveBeenCalledTimes(1);
    expect(c.prev).toHaveBeenCalledTimes(1);
    expect(c.skip).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("mierzy element docelowy, przewija go raz i tworzy spotlight", () => {
    const target = document.createElement("div");
    target.dataset.tour = "target";
    target.getBoundingClientRect = () =>
      ({ top: 100, left: 200, width: 120, height: 40 }) as DOMRect;
    target.scrollIntoView = vi.fn();
    document.body.appendChild(target);
    const c = controller({ stepIndex: 1, currentStep: STEPS[1] });

    render(<CoachmarkTour controller={c} />);

    expect(target.scrollIntoView).toHaveBeenCalledWith({ block: "nearest", behavior: "smooth" });
    expect(document.querySelector('[style*="9999px"]')).toBeTruthy();
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "true");

    fireEvent.scroll(window);
    expect(target.scrollIntoView).toHaveBeenCalledTimes(1);
    target.remove();
  });

  it("brak wskazanego elementu degraduje do modala", () => {
    const c = controller({ stepIndex: 1, currentStep: STEPS[1] });
    render(<CoachmarkTour controller={c} />);

    expect(screen.getByRole("dialog", { name: "tour.two.title" })).toBeTruthy();
    expect(document.querySelector('[style*="9999px"]')).toBeNull();
  });

  it("preferencja ograniczonego ruchu wyłącza animację", () => {
    h.reduced = true;
    render(<CoachmarkTour controller={controller()} />);

    const card = screen.getByRole("dialog").querySelector<HTMLElement>("[tabindex='-1']");
    expect(card?.style.transition).toBe("none");
    expect(screen.getByText("tour.one.body")).toBeTruthy();
  });
});
