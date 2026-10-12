// Odcinek linii pod banerem zakładki „rysuje się" tylko przy przejściu między
// zakładkami - zimne wejście maluje go od razu.
//
// DLACZEGO TEN TEST ISTNIEJE. Animacja była przypięta do `:root[data-motion]`,
// a bramka ruchu otwiera się przy pierwszym geście albo w punkcie ciszy (~5 s)
// - czyli NAD nagłówkiem, który już stoi. Gotowa linia znikała wtedy do zera
// i rysowała się drugi raz przed oczami czytelnika, który nic nie zrobił.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";

import {
  __openInteractionOrQuietForTests,
  __resetInteractionOrQuietForTests,
} from "@/lib/performance/interactionOrQuiet";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

const { EventModuleHero } = await import("@/components/events/public/molecules/EventModuleHero");

function renderHero() {
  return render(
    <EventModuleHero
      module="speakers"
      eventTitle="Kongres"
      moduleLabel="Prelegenci"
      crumbs={[{ label: "Prelegenci" }]}
      breadcrumbLinks={false}
      hasDocument={false}
    >
      {null}
    </EventModuleHero>,
  );
}

function accent(view: ReturnType<typeof render>): HTMLElement {
  return view.container.querySelector(".event-module-hero-accent") as HTMLElement;
}

afterEach(() => {
  cleanup();
  __resetInteractionOrQuietForTests();
});

describe("EventModuleHero - odcinek linii banera", () => {
  it("otwarcie bramki nad gotowym banerem nie rysuje linii drugi raz", () => {
    const view = renderHero();
    expect(accent(view).classList.contains("event-module-hero-accent--enter")).toBe(false);
    act(() => __openInteractionOrQuietForTests());
    expect(accent(view).classList.contains("event-module-hero-accent--enter")).toBe(false);
  });

  it("baner zamontowany po otwarciu bramki (przejście między zakładkami) rysuje linię", () => {
    act(() => __openInteractionOrQuietForTests());
    const view = renderHero();
    expect(accent(view).classList.contains("event-module-hero-accent--enter")).toBe(true);
  });
});
