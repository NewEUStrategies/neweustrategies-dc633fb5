// Wiązanie pomiaru ekspozycji sponsorów z Reactem (`sponsorTrackingReact.tsx`).
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW.
//   1. PODGLĄD STUDIA NABIJA WYŚWIETLENIA - te same komponenty bez dostawcy
//      nie mogą niczego mierzyć.
//   2. WYŚWIETLENIE BEZ WIDOCZNOŚCI - logo w połowie ekranu przez ułamek
//      sekundy, na ukrytej karcie albo poniżej progu 50% to NIE wyświetlenie.
//   3. JEDEN MONTAŻ = JEDNO WYŚWIETLENIE - powrót elementu do widoku nie
//      nabija drugiego.
//   4. ŚRODKOWY PRZYCISK LICZY SIĘ JAK KLIK, prawy - nie.
//   5. OPUSZCZENIE STRONY I UKRYCIE KARTY WYSYŁAJĄ KOLEJKĘ; odmontowanie
//      sprząta nasłuchy (inaczej wyciek i podwójne wysyłki po nawigacji).
import { act, fireEvent, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SponsorTrackerDeps } from "@/lib/events/sponsorTracking";
import {
  SponsorTrackingProvider,
  useSponsorClickHandlers,
  useSponsorImpression,
  useSponsorTracking,
  type SponsorTarget,
} from "@/lib/events/sponsorTrackingReact";

const S = "11111111-1111-4111-8111-111111111111";

class FakeObserver {
  static instances: FakeObserver[] = [];
  observed: Element[] = [];
  disconnected = false;
  constructor(
    public callback: IntersectionObserverCallback,
    public options?: IntersectionObserverInit,
  ) {
    FakeObserver.instances.push(this);
  }
  observe(element: Element) {
    this.observed.push(element);
  }
  disconnect() {
    this.disconnected = true;
  }
  unobserve() {}
  takeRecords() {
    return [];
  }
  fire(ratio: number) {
    this.callback(
      [{ isIntersecting: ratio > 0, intersectionRatio: ratio } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
}

let visibility: DocumentVisibilityState = "visible";

function setVisibility(value: DocumentVisibilityState) {
  visibility = value;
  document.dispatchEvent(new Event("visibilitychange"));
}

function deps() {
  const sent: Record<string, unknown>[] = [];
  const value: SponsorTrackerDeps = {
    hasConsent: () => true,
    send: (_endpoint, payload) => {
      sent.push(payload as Record<string, unknown>);
      return true;
    },
    schedule: () => () => undefined,
    storage: () => null,
    randomId: () => "f".repeat(32),
  };
  return { value, sent };
}

function Probe({ target }: { target: SponsorTarget | null }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useSponsorImpression(ref, target);
  const handlers = useSponsorClickHandlers(target);
  return (
    <div ref={ref}>
      <a href="https://sponsor.example" {...handlers}>
        link
      </a>
    </div>
  );
}

function NullRefProbe() {
  const ref = useRef<HTMLDivElement | null>(null);
  useSponsorImpression(ref, { sponsorId: S, placement: "home_strip" });
  return <span />;
}

function HandleProbe({ onHandle }: { onHandle: (value: unknown) => void }) {
  onHandle(useSponsorTracking());
  return null;
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeObserver.instances = [];
  visibility = "visible";
  vi.stubGlobal("IntersectionObserver", FakeObserver);
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const TARGET: SponsorTarget = { sponsorId: S, placement: "home_strip" };

describe("bez dostawcy (podgląd studia)", () => {
  it("nie obserwuje i nie podpina kliknięć; uchwyt to null", () => {
    let handle: unknown = "nie-wywolano";
    const { container } = render(
      <>
        <Probe target={TARGET} />
        <HandleProbe onHandle={(value) => (handle = value)} />
      </>,
    );
    expect(FakeObserver.instances).toEqual([]);
    expect(handle).toBeNull();
    fireEvent.click(container.querySelector("a")!);
  });
});

describe("wyświetlenie", () => {
  it("liczy się po sekundzie widoczności >= 50%, RAZ na montaż, i wychodzi przy pagehide", () => {
    const d = deps();
    render(
      <SponsorTrackingProvider eventSlug="kongres" deps={d.value}>
        <Probe target={TARGET} />
      </SponsorTrackingProvider>,
    );
    const observer = FakeObserver.instances[0];
    expect(observer.options).toEqual({ threshold: [0.5] });
    act(() => observer.fire(0.6));
    act(() => vi.advanceTimersByTime(999));
    window.dispatchEvent(new Event("pagehide"));
    expect(d.sent).toEqual([]);
    act(() => vi.advanceTimersByTime(1));
    expect(observer.disconnected).toBe(true);
    window.dispatchEvent(new Event("pagehide"));
    expect(d.sent).toEqual([
      {
        event_slug: "kongres",
        session: "f".repeat(32),
        items: [{ placement: "home_strip", kind: "view", sponsor_id: S }],
      },
    ]);
    // Powrót do widoku po zaliczonym wyświetleniu nie liczy drugiego.
    act(() => observer.fire(1));
    act(() => vi.advanceTimersByTime(2000));
    window.dispatchEvent(new Event("pagehide"));
    expect(d.sent).toHaveLength(1);
  });

  it("wyjście z widoku albo próg poniżej 50% przed upływem sekundy - brak wyświetlenia", () => {
    const d = deps();
    render(
      <SponsorTrackingProvider eventSlug="kongres" deps={d.value}>
        <Probe target={TARGET} />
      </SponsorTrackingProvider>,
    );
    const observer = FakeObserver.instances[0];
    act(() => observer.fire(0.4));
    act(() => vi.advanceTimersByTime(1500));
    act(() => observer.fire(0.9));
    act(() => vi.advanceTimersByTime(500));
    act(() => observer.fire(0));
    act(() => vi.advanceTimersByTime(1500));
    window.dispatchEvent(new Event("pagehide"));
    expect(d.sent).toEqual([]);
  });

  it("ukryta karta wstrzymuje zegar i wysyła kolejkę; powrót karty wznawia pomiar", () => {
    const d = deps();
    render(
      <SponsorTrackingProvider eventSlug="kongres" deps={d.value}>
        <Probe target={TARGET} />
      </SponsorTrackingProvider>,
    );
    const observer = FakeObserver.instances[0];
    act(() => setVisibility("hidden"));
    act(() => observer.fire(1));
    act(() => vi.advanceTimersByTime(2000));
    expect(d.sent).toEqual([]);
    act(() => setVisibility("visible"));
    act(() => vi.advanceTimersByTime(400));
    act(() => setVisibility("hidden"));
    act(() => vi.advanceTimersByTime(2000));
    expect(d.sent).toEqual([]);
    act(() => setVisibility("visible"));
    act(() => vi.advanceTimersByTime(1000));
    // Ukrycie karty wysyła kolejkę (dostawca nasłuchuje `visibilitychange`).
    act(() => setVisibility("hidden"));
    expect(d.sent).toHaveLength(1);
  });

  it("brak celu, brak elementu i brak IntersectionObserver - nic się nie dzieje", () => {
    const d = deps();
    const { unmount } = render(
      <SponsorTrackingProvider eventSlug="kongres" deps={d.value}>
        <Probe target={null} />
        <NullRefProbe />
      </SponsorTrackingProvider>,
    );
    expect(FakeObserver.instances).toEqual([]);
    unmount();
    vi.stubGlobal("IntersectionObserver", undefined);
    render(
      <SponsorTrackingProvider eventSlug="kongres" deps={d.value}>
        <Probe target={TARGET} />
      </SponsorTrackingProvider>,
    );
    expect(d.sent).toEqual([]);
  });

  it("odmontowanie odłącza obserwatora, kasuje zegar i wysyła kolejkę dostawcy", () => {
    const d = deps();
    const { unmount } = render(
      <SponsorTrackingProvider eventSlug="kongres" deps={d.value}>
        <Probe target={TARGET} />
      </SponsorTrackingProvider>,
    );
    const observer = FakeObserver.instances[0];
    act(() => observer.fire(1));
    unmount();
    expect(observer.disconnected).toBe(true);
    act(() => vi.advanceTimersByTime(2000));
    expect(d.sent).toEqual([]);
  });
});

describe("kliknięcie", () => {
  it("click i środkowy przycisk liczą się od razu; prawy przycisk nie", () => {
    const d = deps();
    const { container } = render(
      <SponsorTrackingProvider eventSlug="kongres" deps={d.value}>
        <Probe target={{ sponsorId: S, placement: "materials", materialId: null }} />
      </SponsorTrackingProvider>,
    );
    const link = container.querySelector("a")!;
    fireEvent.click(link);
    fireEvent(link, new MouseEvent("auxclick", { bubbles: true, button: 2 }));
    fireEvent(link, new MouseEvent("auxclick", { bubbles: true, button: 1 }));
    // Klik w materiały bez materiału jest skazany na odrzucenie - nie wychodzi.
    expect(d.sent).toEqual([]);
  });

  it("kliknięcie odnośnika sponsora wychodzi paczką od razu", () => {
    const d = deps();
    const { container } = render(
      <SponsorTrackingProvider eventSlug="kongres" deps={d.value}>
        <Probe target={TARGET} />
      </SponsorTrackingProvider>,
    );
    const link = container.querySelector("a")!;
    fireEvent.click(link);
    fireEvent(link, new MouseEvent("auxclick", { bubbles: true, button: 2 }));
    fireEvent(link, new MouseEvent("auxclick", { bubbles: true, button: 1 }));
    expect(d.sent.map((payload) => (payload.items as { kind: string }[])[0].kind)).toEqual([
      "click",
      "click",
    ]);
  });

  it("otwarcie materiału ma własny rodzaj", () => {
    const d = deps();
    function MaterialProbe() {
      const handlers = useSponsorClickHandlers(
        {
          sponsorId: S,
          placement: "materials",
          materialId: "22222222-2222-4222-8222-222222222222",
        },
        "material_open",
      );
      return (
        <a href="https://x.example" {...handlers}>
          m
        </a>
      );
    }
    const { container } = render(
      <SponsorTrackingProvider eventSlug="kongres" deps={d.value}>
        <MaterialProbe />
      </SponsorTrackingProvider>,
    );
    fireEvent.click(container.querySelector("a")!);
    expect(d.sent[0].items).toEqual([
      {
        placement: "materials",
        kind: "material_open",
        sponsor_id: S,
        material_id: "22222222-2222-4222-8222-222222222222",
      },
    ]);
  });
});

describe("dostawca", () => {
  it("ukrycie karty wysyła kolejkę, widoczna karta nie; odmontowanie zdejmuje nasłuchy", () => {
    const d = deps();
    const { unmount } = render(
      <SponsorTrackingProvider eventSlug="kongres" deps={d.value}>
        <Probe target={TARGET} />
      </SponsorTrackingProvider>,
    );
    act(() => FakeObserver.instances[0].fire(1));
    act(() => vi.advanceTimersByTime(1000));
    act(() => setVisibility("visible"));
    expect(d.sent).toEqual([]);
    unmount();
    expect(d.sent).toHaveLength(1);
    window.dispatchEvent(new Event("pagehide"));
    act(() => setVisibility("hidden"));
    expect(d.sent).toHaveLength(1);
  });

  it("zmiana zgody trafia do trackera; odmontowanie wyrejestrowuje nasłuch zgody", () => {
    const d = deps();
    let consent = true;
    const listeners: (() => void)[] = [];
    const off = vi.fn();
    const removed: string[] = [];
    const storage = {
      removeItem: (key: string) => void removed.push(key),
    } as unknown as Storage;
    const value: SponsorTrackerDeps = {
      ...d.value,
      hasConsent: () => consent,
      storage: () => storage,
      onConsentChange: (listener) => {
        listeners.push(listener);
        return off;
      },
    };
    const { unmount } = render(
      <SponsorTrackingProvider eventSlug="kongres" deps={value}>
        <Probe target={TARGET} />
      </SponsorTrackingProvider>,
    );
    expect(listeners).toHaveLength(1);
    act(() => FakeObserver.instances[0].fire(1));
    act(() => vi.advanceTimersByTime(1000));
    consent = false;
    listeners[0]();
    expect(removed).toEqual(["nes-sponsor-session"]);
    unmount();
    expect(off).toHaveBeenCalledTimes(1);
    // Kolejka wyczyszczona w chwili cofnięcia zgody - odmontowanie nic nie wysyła.
    expect(d.sent).toEqual([]);
  });

  it("bez jawnych zależności używa domyślnych granic przeglądarki", () => {
    const { unmount } = render(
      <SponsorTrackingProvider eventSlug="kongres">
        <Probe target={TARGET} />
      </SponsorTrackingProvider>,
    );
    unmount();
  });
});
