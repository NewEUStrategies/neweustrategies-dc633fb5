// Pomiar ekspozycji sponsorów - wiązanie z Reactem: dostawca kontekstu i dwa
// haki (wyświetlenie, kliknięcie).
//
// DOSTAWCĘ MONTUJE WYŁĄCZNIE PUBLICZNA POWŁOKA WYDARZENIA (`events.$slug.tsx`,
// wokół `<Outlet/>`). Podgląd w studiu rysuje TE SAME komponenty (pas
// partnerów, agenda, reklama), ale bez dostawcy - kontekst ma wtedy wartość
// `null` i haki nie robią nic. Redaktor oglądający podgląd nie nabija
// sponsorowi wyświetleń.
//
// NIC NIE DZIEJE SIĘ W RENDERZE. Obserwator widoczności, zegar sekundy
// i nasłuch ukrycia karty rejestrują się w `useEffect`, a obsługa kliknięcia
// nie zmienia znaczników - więc HTML z serwera i pierwszy render klienta są
// identyczne (hydratacja bez rozjazdu).
//
// UCHWYT KONTEKSTU JEST STAŁY. Tracker powstaje w efekcie dostawcy, a efekty
// dzieci biegną PRZED efektem rodzica - dlatego dzieci dostają fasadę, która
// przekazuje pozycje do trackera, gdy ten już istnieje. Wyświetlenie i tak
// wychodzi najwcześniej po sekundzie, a kliknięcie po interakcji, więc nic nie
// ginie; a stała wartość kontekstu nie przerysowuje drzewa strony po montażu.
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from "react";

import {
  createSponsorTracker,
  defaultSponsorTrackerDeps,
  type SponsorTracker,
  type SponsorTrackerDeps,
} from "@/lib/events/sponsorTracking";
import type {
  SponsorExposureItem,
  SponsorExposureKind,
  SponsorPlacement,
} from "@/lib/events/sponsorExposure";

/** Próg widoczności i czas, po którym ekspozycja liczy się jako wyświetlenie. */
export const SPONSOR_VIEW_THRESHOLD = 0.5;
export const SPONSOR_VIEW_DWELL_MS = 1000;

export interface SponsorTrackingHandle {
  track: (item: SponsorExposureItem) => void;
}

const SponsorTrackingContext = createContext<SponsorTrackingHandle | null>(null);

export function SponsorTrackingProvider({
  eventSlug,
  children,
  deps = defaultSponsorTrackerDeps,
}: {
  eventSlug: string;
  children: ReactNode;
  /** Granice przeglądarki - podmieniane w testach. */
  deps?: SponsorTrackerDeps;
}) {
  const trackerRef = useRef<SponsorTracker | null>(null);
  const [handle] = useState<SponsorTrackingHandle>(() => ({
    track: (item) => trackerRef.current?.track(item),
  }));

  useEffect(() => {
    const tracker = createSponsorTracker(eventSlug, deps);
    trackerRef.current = tracker;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") tracker.flush();
    };
    const onPageHide = () => tracker.flush();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      trackerRef.current = null;
      tracker.dispose();
    };
  }, [eventSlug, deps]);

  return (
    <SponsorTrackingContext.Provider value={handle}>{children}</SponsorTrackingContext.Provider>
  );
}

/** Uchwyt pomiaru albo `null` poza publiczną powłoką (podgląd studia). */
export function useSponsorTracking(): SponsorTrackingHandle | null {
  return useContext(SponsorTrackingContext);
}

/** Co jest mierzone: sponsor (albo reklama), miejsce, opcjonalnie materiał. */
export interface SponsorTarget {
  sponsorId: string | null;
  placement: SponsorPlacement;
  materialId?: string | null;
  homeAdId?: string | null;
}

/**
 * Wyświetlenie: element widoczny w >= 50% przez >= 1 s, przy WIDOCZNEJ karcie.
 * Raz na montaż - element, który wraca do widoku, nie nabija drugiego
 * wyświetlenia w tej samej wizycie (baza i tak liczy unikalne na dzień).
 */
export function useSponsorImpression(
  ref: RefObject<Element | null>,
  target: SponsorTarget | null,
): void {
  const handle = useSponsorTracking();
  const sponsorId = target?.sponsorId ?? null;
  const placement = target?.placement ?? null;
  const materialId = target?.materialId ?? null;
  const homeAdId = target?.homeAdId ?? null;

  useEffect(() => {
    const element = ref.current;
    if (handle === null || placement === null || element === null) return;
    if (typeof IntersectionObserver === "undefined") return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    let inView = false;
    // Zaliczone wyświetlenie zamyka pomiar na ten montaż - także wobec
    // powiadomienia, które obserwator zdążył ustawić w kolejce przed `disconnect`.
    let counted = false;
    const stop = () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    };
    const arm = () => {
      if (counted || timer !== null || !inView || document.visibilityState !== "visible") return;
      timer = setTimeout(() => {
        timer = null;
        counted = true;
        observer.disconnect();
        document.removeEventListener("visibilitychange", onVisibility);
        handle.track({ sponsorId, placement, kind: "view", materialId, homeAdId });
      }, SPONSOR_VIEW_DWELL_MS);
    };
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          inView = entry.isIntersecting && entry.intersectionRatio >= SPONSOR_VIEW_THRESHOLD;
        }
        if (inView) arm();
        else stop();
      },
      { threshold: [SPONSOR_VIEW_THRESHOLD] },
    );
    const onVisibility = () => {
      if (document.visibilityState === "visible") arm();
      else stop();
    };
    observer.observe(element);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [ref, handle, sponsorId, placement, materialId, homeAdId]);
}

export interface SponsorClickHandlers {
  onClick?: () => void;
  onAuxClick?: (event: MouseEvent) => void;
}

/**
 * Obsługa kliknięcia odnośnika sponsora: `click` i ŚRODKOWY przycisk
 * (`auxclick`, otwarcie w nowej karcie). `href` zostaje prawdziwy - nie ma
 * przekierowania przez nasz serwer, więc nie ma otwartego przekierowania,
 * a skanery poczty i prefetch niczego nie „klikają".
 */
export function useSponsorClickHandlers(
  target: SponsorTarget | null,
  kind: Exclude<SponsorExposureKind, "view"> = "click",
): SponsorClickHandlers {
  const handle = useSponsorTracking();
  const sponsorId = target?.sponsorId ?? null;
  const placement = target?.placement ?? null;
  const materialId = target?.materialId ?? null;
  const homeAdId = target?.homeAdId ?? null;

  return useMemo(() => {
    if (handle === null || placement === null) return {};
    const fire = () => handle.track({ sponsorId, placement, kind, materialId, homeAdId });
    return {
      onClick: fire,
      onAuxClick: (event: MouseEvent) => {
        if (event.button === 1) fire();
      },
    };
  }, [handle, sponsorId, placement, kind, materialId, homeAdId]);
}
