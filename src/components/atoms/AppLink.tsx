import { useRouter } from "@tanstack/react-router";
import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  type AnchorHTMLAttributes,
  type FocusEvent,
  type MouseEvent,
} from "react";

type AppLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  href?: string;
  preload?: "intent" | "none";
};

/**
 * Opóźnienie intencji. `router.preloadRoute` to matching + `beforeLoad` +
 * `loader` + (pierwszy raz) import chunku trasy - czyli prawdziwa praca, nie
 * podpowiedź dla przeglądarki. Kursor przelatujący nad listą kart nie jest
 * intencją, więc czekamy, aż wskaźnik się zatrzyma. Wewnętrzny `<Link>`
 * routera ma na to `defaultPreloadDelay`, ale `AppLink` woła `preloadRoute`
 * bezpośrednio i ten próg go nie obejmuje - stąd własny timer.
 */
const PRELOAD_DELAY_MS = 60;

/**
 * Jak długo pamiętamy, że trasa była już preloadowana. Bez tej pamięci
 * przejechanie kursorem po dwudziestu kartach odpala dwadzieścia loaderów,
 * a każdy powrót na ten sam odnośnik powtarza je od zera: router ma
 * `defaultPreloadStaleTime` 30 s, ale sam wykonuje matching i `beforeLoad`
 * przy każdym wywołaniu.
 */
const PRELOAD_MEMORY_TTL_MS = 20_000;

/** href -> moment preloadu (ms). Modułowa, bo dotyczy routera, nie instancji. */
const preloadMemory = new Map<string, number>();

/**
 * Zwraca `true`, gdy ten href wolno preloadować teraz (i zapisuje go w
 * pamięci). Przy okazji usuwa wpisy starsze niż TTL, żeby mapa nie rosła
 * przez całą sesję czytania.
 */
function claimPreload(href: string, now: number): boolean {
  for (const [key, at] of preloadMemory) {
    if (now - at > PRELOAD_MEMORY_TTL_MS) preloadMemory.delete(key);
  }
  if (preloadMemory.has(href)) return false;
  preloadMemory.set(href, now);
  return true;
}

/** Czyści pamięć preloadu - do testów i diagnostyki. */
export function resetPreloadMemory(): void {
  preloadMemory.clear();
}

function isModifiedEvent(event: MouseEvent<HTMLAnchorElement>): boolean {
  return event.metaKey || event.altKey || event.ctrlKey || event.shiftKey;
}

export function toClientHref(href: string | undefined): string | null {
  if (!href || href === "#" || href.startsWith("#")) return null;
  if (/^(mailto:|tel:)/i.test(href)) return null;
  if (href.startsWith("//")) return null;
  if (href.startsWith("/")) return href;

  if (/^https?:\/\//i.test(href) && typeof window !== "undefined") {
    try {
      const url = new URL(href);
      if (url.origin === window.location.origin) {
        return `${url.pathname}${url.search}${url.hash}`;
      }
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Anchor that keeps same-origin builder/auth/menu links inside TanStack Router.
 * This prevents browser document reloads, so global chrome (header/footer/menu
 * sections) stays mounted and only the route body changes.
 */
export const AppLink = forwardRef<HTMLAnchorElement, AppLinkProps>(function AppLink(
  {
    href = "#",
    target,
    onClick,
    onMouseEnter,
    onMouseLeave,
    onFocus,
    onBlur,
    preload = "intent",
    ...props
  },
  ref,
) {
  const router = useRouter({ warn: false });
  const clientHref = toClientHref(href);
  // Jeden timer na instancję - kolejne zdarzenia intencji go przesuwają,
  // a nie mnożą.
  const preloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelPreload = useCallback(() => {
    if (preloadTimer.current === null) return;
    clearTimeout(preloadTimer.current);
    preloadTimer.current = null;
  }, []);

  const schedulePreload = () => {
    if (!router || !clientHref || preload === "none") return;
    if (preloadTimer.current !== null) return;
    preloadTimer.current = setTimeout(() => {
      preloadTimer.current = null;
      if (!claimPreload(clientHref, Date.now())) return;
      void router.preloadRoute({ href: clientHref } as never).catch(() => undefined);
    }, PRELOAD_DELAY_MS);
  };

  // Odmontowanie w trakcie odliczania (np. zamknięcie overlaya wyszukiwarki)
  // nie może zostawić timera, który obudzi router po zniknięciu odnośnika.
  useEffect(() => cancelPreload, [cancelPreload]);

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    // The live editor preview renders real widgets, including native anchors.
    // Suppress navigation there for pointer and keyboard activation alike.
    if (event.currentTarget.closest('[data-builder-renderer="widget-props-preview"]')) {
      event.preventDefault();
    }
    if (event.defaultPrevented || !router || !clientHref) return;
    const elementTarget = event.currentTarget.getAttribute("target");
    const effectiveTarget = target ?? elementTarget;
    if (
      event.button !== 0 ||
      isModifiedEvent(event) ||
      (effectiveTarget && effectiveTarget !== "_self")
    )
      return;

    event.preventDefault();
    void router.navigate({ href: clientHref } as never);
  };

  const handleMouseEnter = (event: MouseEvent<HTMLAnchorElement>) => {
    onMouseEnter?.(event);
    schedulePreload();
  };

  const handleMouseLeave = (event: MouseEvent<HTMLAnchorElement>) => {
    onMouseLeave?.(event);
    cancelPreload();
  };

  const handleFocus = (event: FocusEvent<HTMLAnchorElement>) => {
    onFocus?.(event);
    schedulePreload();
  };

  const handleBlur = (event: FocusEvent<HTMLAnchorElement>) => {
    onBlur?.(event);
    cancelPreload();
  };

  // DOTYK BEZ PRELOADU (świadomie). Między `touchstart` a `click` mija
  // kilkadziesiąt ms tego samego gestu - loader trasy wystartowany na
  // `touchstart` ląduje dokładnie w oknie mierzonym jako INP tego dotknięcia.
  // Zysk (kilkadziesiąt ms wcześniejszy start) jest mniejszy niż koszt janku,
  // a właściwa nawigacja i tak czeka na ten sam loader. Ewentualny
  // `onTouchStart` konsumenta przechodzi nietknięty przez `...props`.
  return (
    <a
      {...props}
      ref={ref}
      href={href}
      target={target}
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onFocus={handleFocus}
      onBlur={handleBlur}
    />
  );
});

AppLink.displayName = "AppLink";
