// KANWA PODGLADU STUDIA - galezie rysunku, ktorych bramka parytetu nie dotyka.
//
// PO CO TEN PLIK. `eventPreviewPublicParity.gate.test.tsx` dowodzi, ze kanwa
// rysuje TE SAME komponenty, co strona publiczna, i w tym samym miejscu.
// Nie dowodzi, ze kanwa czyta WLASCIWE POLE SZKICU w kazdym stanie:
//   1. JEZYK PANELU WYBIERA POLE. Po angielsku tytul i opis to `titleEn`
//      i `descriptionEn`, a pusty angielski spada na polski - inaczej redaktor
//      piszacy tylko po polsku widzi w podgladzie „Untitled event".
//   2. KONIEC WYDARZENIA TO OSOBNY WIERSZ karty „kiedy, gdzie" - i tylko wtedy,
//      gdy redaktor go wpisal.
//   3. ZAKLADKA „MOJ PROFIL" jest stanem kanwy: klik ja otwiera, klik w dowolna
//      pozycje z bazy wraca do rysunku strony.
//   4. WIERSZE SEKCJI (tryb `list`) sa klikalne jak kafle - oddaja
//      identyfikator strony.
//   5. PODSTRONA Z DOKUMENTEM rysuje go publicznym rendererem, a nie zdaniem
//      o pustej stronie.
//
// CZEGO SWIADOMIE NIE DUBLUJE. Ukladu i parytetu ze strona (bramka), partnerow
// z bazy (`EventStudioPreviewSponsors.test.tsx`) i podstron modulowych
// (`EventPreviewLiveModule.test.tsx`). Renderer dokumentu i zakladka uczestnika
// sa atrapami, ktore zapisuja, CO dostaly.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import {
  EMPTY_EVENT_PREVIEW,
  type EventPreviewModel,
} from "@/components/admin/events/studio/EventStudioPreviewContext";
import type { BuilderDocument } from "@/lib/builder/types";

const h = vi.hoisted(() => ({
  lang: "pl",
  /** Dokumenty przekazane rendererowi podstrony. */
  dokumenty: [] as unknown[],
  /** Slugi, z ktorymi otwarto zakladke uczestnika. */
  profile: [] as string[],
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.lang),
);
vi.mock("@/lib/i18n-admin-events", () => ({ ensureI18n: () => undefined }));
vi.mock("@/lib/i18n-community", () => ({ ensureI18n: () => undefined }));
vi.mock("@/lib/i18n-event-front", () => ({ ensureI18n: () => undefined }));
vi.mock("@/lib/i18n-cart", () => ({ ensureI18n: () => undefined }));
// Kanwa nie pyta bazy - ale organizmy sekcji, ktore montuje, importuja
// klienta. Pusta atrapa odcina lancuch zmiennych srodowiska.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: null }) }));

vi.mock("@/components/builder/organisms/BuilderRenderer", () => ({
  BuilderRenderer: (props: { doc: unknown }) => {
    h.dokumenty.push(props.doc);
    return <div data-testid="dokument" />;
  },
}));
vi.mock("@/components/admin/events/studio/PreviewMePanel", () => ({
  PreviewMePanel: (props: { slug: string }) => {
    h.profile.push(props.slug);
    return <div data-testid="moj-profil" />;
  },
}));

const { EventPreviewCanvas } = await import("@/components/admin/events/studio/EventPreviewCanvas");

const P = "adminEvents.studio.preview.";

function model(patch: Partial<EventPreviewModel> = {}): EventPreviewModel {
  return {
    ...EMPTY_EVENT_PREVIEW,
    titlePl: "Kongres Energetyczny",
    titleEn: "Energy Congress",
    descriptionPl: "Opis po polsku",
    descriptionEn: "English description",
    slug: "kongres-energetyczny",
    startsAt: "2026-09-15T08:00:00.000Z",
    timezone: "Europe/Warsaw",
    menu: [
      {
        key: "m-program",
        pageId: "p-program",
        path: "program",
        label: "Program",
        icon: "calendar",
        color: "",
        module: "agenda",
      },
    ],
    ...patch,
  };
}

/** Tytul przegladu - `EventOverviewTitle` rysuje go jako `h1`. */
function tytul(): string | null {
  return screen.getByRole("heading", { level: 1 }).textContent;
}

afterEach(() => {
  cleanup();
  h.lang = "pl";
  h.dokumenty = [];
  h.profile = [];
});

describe("kanwa - jezyk panelu wybiera pole szkicu", () => {
  it("po angielsku tytul i opis sa angielskie", () => {
    h.lang = "en";
    render(<EventPreviewCanvas model={model()} device="desktop" />);

    expect(tytul()).toBe("Energy Congress");
    expect(screen.getByText("English description")).toBeInTheDocument();
    expect(screen.queryByText("Opis po polsku")).toBeNull();
  });

  it("po angielsku pusty angielski spada na polski - tytul i opis", () => {
    h.lang = "en";
    render(
      <EventPreviewCanvas model={model({ titleEn: "", descriptionEn: "" })} device="desktop" />,
    );

    expect(tytul()).toBe("Kongres Energetyczny");
    expect(screen.getByText("Opis po polsku")).toBeInTheDocument();
  });

  it("bez tytulu w obu jezykach zostaje napis zastepczy, bez opisu - brak akapitu", () => {
    h.lang = "en";
    render(
      <EventPreviewCanvas
        model={model({ titlePl: "", titleEn: "", descriptionPl: "", descriptionEn: "" })}
        device="mobile"
      />,
    );

    expect(tytul()).toBe(`${P}untitled`);
    expect(screen.queryByText("Opis po polsku")).toBeNull();
  });
});

describe("kanwa - karta „kiedy, gdzie”", () => {
  it("koniec wydarzenia jest osobnym wierszem - tylko gdy redaktor go wpisal", () => {
    const bezKonca = render(<EventPreviewCanvas model={model()} device="desktop" />);
    expect(screen.queryByText(`${P}endsLabel`)).toBeNull();
    bezKonca.unmount();

    render(
      <EventPreviewCanvas model={model({ endsAt: "2026-09-16T16:00:00.000Z" })} device="desktop" />,
    );
    expect(screen.getByText(`${P}endsLabel`)).toBeInTheDocument();
  });
});

describe("kanwa - zakladka uczestnika i nawigacja", () => {
  it("„Moj profil” otwiera zakladke uczestnika, a zakladka przegladu wraca do strony", () => {
    const onNavigate = vi.fn();
    render(<EventPreviewCanvas model={model()} device="desktop" onNavigate={onNavigate} />);
    const przed = screen.getByRole("button", { name: "eventMe.tab" }).className;

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "eventMe.tab" }));
    });
    expect(screen.getByTestId("moj-profil")).toBeInTheDocument();
    expect(h.profile).toEqual(["kongres-energetyczny"]);
    // Otwarta zakladka dostaje klase aktywnej - ta sama para klas, co na stronie.
    expect(screen.getByRole("button", { name: "eventMe.tab" }).className).not.toBe(przed);

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "eventFront.header.tabs.overview" }));
    });
    expect(screen.queryByTestId("moj-profil")).toBeNull();
    expect(onNavigate).toHaveBeenCalledWith(null);
  });

  it("pozycja paska zamyka zakladke uczestnika i oddaje identyfikator strony", () => {
    const onNavigate = vi.fn();
    render(<EventPreviewCanvas model={model()} device="desktop" onNavigate={onNavigate} />);
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "eventMe.tab" }));
    });

    const [wPasku] = screen.getAllByRole("button", { name: "Program" });
    act(() => {
      fireEvent.click(wPasku);
    });
    expect(screen.queryByTestId("moj-profil")).toBeNull();
    expect(onNavigate).toHaveBeenCalledWith({ key: "m-program", pageId: "p-program" });
  });

  it("wiersz sekcji strony glownej (tryb `list`) oddaje identyfikator strony", () => {
    const onNavigate = vi.fn();
    render(
      <EventPreviewCanvas
        model={model({ pagesDisplayMode: "list" })}
        device="desktop"
        onNavigate={onNavigate}
      />,
    );
    const wiersze = screen.getByRole("navigation", { name: "eventFront.homeSections.label" });

    act(() => {
      fireEvent.click(wiersze.querySelector("button") as HTMLElement);
    });
    expect(onNavigate).toHaveBeenCalledWith({ key: "m-program", pageId: "p-program" });
  });
});

describe("kanwa - podstrona", () => {
  it("podstrona Z DOKUMENTEM rysuje go publicznym rendererem, bez zdania o pustce", () => {
    const doc: BuilderDocument = { version: 1, sections: [] };
    render(
      <EventPreviewCanvas
        model={model({
          selectedPage: {
            key: "m-program",
            module: null,
            label: "O nas",
            path: "o-nas",
            document: doc,
          },
        })}
        device="desktop"
      />,
    );

    expect(screen.getByTestId("dokument")).toBeInTheDocument();
    expect(h.dokumenty).toEqual([doc]);
    expect(screen.queryByText(`${P}pageEmpty`)).toBeNull();
    expect(screen.getByText("/o-nas")).toBeInTheDocument();
  });
});
