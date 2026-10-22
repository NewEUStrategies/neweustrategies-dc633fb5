// PRZEWODNIK PO ŚCIEŻKACH (I9, Z-S8-01): montaż kroków S8 z leniwą nakładką.
//
// CO TEN PLIK DOWODZI.
//   1. Bez gotowości (lista niewczytana, kanwa nienarysowana) przewodnik nie
//      rusza - kotwice nie stoją jeszcze w drzewie.
//   2. Gotowy i niezamknięty: nakładka dociąga się leniwie i pokazuje pierwszy
//      krok na kotwicy S8; „Pomiń” zamyka i zapamiętuje zamknięcie pod
//      identyfikatorem przewodnika (drugi montaż nic nie pokazuje).
//   3. Kroki zakładki i edytora to dane S8 (`tours.ts`), a ich kotwice stoją
//      w komponentach - pilnuje tego `tours.test.ts`, tu nie dublujemy.
//   4. axe bez naruszeń z otwartą nakładką.
//
// Asercje idą na KLUCZACH i18n (atrapa `reactI18nextStub`), jak w teście
// nakładki.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

import { JourneyTour } from "@/components/admin/journeys/tour/JourneyTour";
import { JOURNEY_EDITOR_TOUR_STEPS, JOURNEYS_TOUR_STEPS } from "@/lib/onboarding/tours";
import { isTourDismissed, resetTour } from "@/lib/onboarding/tourStorage";
import { axeViolations, summarize } from "@/test/axe";

function mountWithAnchors(ready: boolean) {
  return render(
    <div>
      <div data-tour="journeys-engine">pasek zdrowia</div>
      <div data-tour="journeys-list">lista</div>
      <JourneyTour id="journeys" steps={JOURNEYS_TOUR_STEPS} ready={ready} />
    </div>,
  );
}

beforeEach(() => {
  resetTour("journeys");
  resetTour("journey-editor");
});
afterEach(cleanup);

describe("JourneyTour", () => {
  it("bez gotowości nie rusza (kotwice jeszcze nie stoją)", async () => {
    mountWithAnchors(false);
    // Hak startuje klatkę po włączeniu - dajemy mu czas, a nakładki nadal brak.
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("gotowy: pierwszy krok na pasku zdrowia; „Pomiń” zamyka i zapamiętuje; axe", async () => {
    const { unmount } = mountWithAnchors(true);
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveAttribute("aria-label", "admin.onboarding.journeys.engine.title");
    expect(dialog).toHaveTextContent("admin.onboarding.journeys.engine.body");
    expect(summarize(await axeViolations(document.body))).toBe("");

    fireEvent.click(screen.getByRole("button", { name: "admin.onboarding.common.skip" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(isTourDismissed("journeys")).toBe(true);

    // Drugie wejście na zakładkę: zamknięty przewodnik już nie rusza.
    unmount();
    mountWithAnchors(true);
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("edytor ma osobny klucz zamknięcia - zamknięta zakładka nie wycisza edytora", async () => {
    resetTour("journey-editor");
    render(
      <div>
        <div data-tour="journey-canvas">kanwa</div>
        <JourneyTour id="journey-editor" steps={JOURNEY_EDITOR_TOUR_STEPS} ready />
      </div>,
    );
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveAttribute("aria-label", "admin.onboarding.journeyEditor.canvas.title");
    fireEvent.click(screen.getByRole("button", { name: "admin.onboarding.common.next" }));
    expect(await screen.findByRole("dialog")).toHaveAttribute(
      "aria-label",
      "admin.onboarding.journeyEditor.publish.title",
    );
    fireEvent.click(screen.getByRole("button", { name: "admin.onboarding.common.done" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(isTourDismissed("journey-editor")).toBe(true);
    expect(isTourDismissed("journeys")).toBe(false);
  });

  it("nakładka jest leniwa - moduł nie importuje jej statycznie", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("src/components/admin/journeys/tour/JourneyTour.tsx", "utf8");
    expect(source).not.toMatch(/^import[^;]*CoachmarkTour/m);
    expect(source).toContain('import("@/components/admin/onboarding/CoachmarkTour")');
  });
});
