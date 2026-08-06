// Publiczny mobilny pasek dolny (animated tab bar) - kontener.
//
// Renderowany wyłącznie na mobile (md:hidden) przez SiteChrome. Konfiguracja
// pochodzi z site_settings[key="mobile_bottom_bar"] w obrębie tenanta - patrz
// @/lib/mobileBottomBar/config. Aktywna pozycja jest wyliczana z bieżącej
// ścieżki (z pominięciem prefiksu języka), a podświetlenie przesuwa się
// animacją transform.
//
// Kontener odpowiada za trzy rzeczy, których warstwa prezentacji nie zna:
//   1. odczyt konfiguracji tenanta i routingu,
//   2. chowanie paska przy przewijaniu w dół,
//   3. REZERWACJĘ MIEJSCA w układzie strony - pasek jest `position: fixed`,
//      więc bez tego zasłaniałby stopkę i ostatni akapit treści. Zmierzona
//      wysokość ląduje w `--mbb-space` na <html>, z którego korzysta zarówno
//      dopełnienie <body>, jak i uniesienie doku czatu (patrz styles.css).
import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useRouterState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { MobileBottomBarView } from "@/components/mobile/bottomBar/MobileBottomBarView";
import { useSiteSetting } from "@/lib/useSiteSetting";
import {
  MOBILE_BOTTOM_BAR_DEFAULTS,
  MOBILE_BOTTOM_BAR_SETTINGS_KEY,
  activeBottomBarIndex,
  clampOffset,
  visibleBottomBarItems,
  type MobileBottomBarConfig,
} from "@/lib/mobileBottomBar/config";
import "@/lib/i18n-mobile-bottom-bar";

export { MobileBottomBarView };
export type { MobileBottomBarViewProps } from "@/components/mobile/bottomBar/MobileBottomBarView";

/** Próg przewinięcia, poniżej którego pasek nigdy się nie chowa (px). */
const HIDE_AFTER_SCROLL_Y = 120;
/** Martwa strefa gestu - chroni przed migotaniem przy scroll-bounce iOS. */
const SCROLL_DEADZONE = 8;

/** Chowanie paska przy przewijaniu w dół (rAF-throttled, passive listener). */
function useHideOnScroll(active: boolean): boolean {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (!active) {
      setHidden(false);
      return;
    }
    let last = window.scrollY;
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const y = window.scrollY;
        if (Math.abs(y - last) > SCROLL_DEADZONE) {
          setHidden(y > last && y > HIDE_AFTER_SCROLL_Y);
          last = y;
        }
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
    };
  }, [active]);

  return hidden;
}

/**
 * Publikuje zajętość dolnej krawędzi na <html> jako `--mbb-space` (wysokość
 * paska + jego odstęp od dołu) oraz znacznik `data-mbb="on"`. Z tej jednej
 * wartości korzysta i dopełnienie <body>, i uniesienie doku czatu, więc nie ma
 * dwóch prawd o tym, ile miejsca zabiera pasek.
 *
 * Sprzątanie przy odmontowaniu jest obowiązkowe - inaczej przejście na /admin
 * (gdzie paska nie ma) zostawiłoby martwe dopełnienie strony.
 */
function useReservedSpace(enabled: boolean, offset: number): (height: number) => void {
  const publishedRef = useRef(0);

  useEffect(() => {
    const root = document.documentElement;
    if (!enabled) {
      root.removeAttribute("data-mbb");
      root.style.removeProperty("--mbb-space");
      publishedRef.current = 0;
      return;
    }
    root.dataset.mbb = "on";
    return () => {
      root.removeAttribute("data-mbb");
      root.style.removeProperty("--mbb-space");
      publishedRef.current = 0;
    };
  }, [enabled]);

  return useCallback(
    (height: number) => {
      if (!enabled || height <= 0) return;
      const space = Math.round(height + offset);
      if (Math.abs(space - publishedRef.current) < 1) return;
      publishedRef.current = space;
      document.documentElement.style.setProperty("--mbb-space", `${space}px`);
    },
    [enabled, offset],
  );
}

/**
 * Kontener podpięty pod site_settings + routing (montowany w SiteChrome).
 *
 * Pasek jest skrótem do przestrzeni użytkownika (sieć, wiadomości, zapisane,
 * profil), więc dla gościa nie ma czego skracać - renderujemy go WYŁĄCZNIE dla
 * zalogowanych. Brak sesji = brak paska i brak rezerwacji miejsca na dole.
 */
export function MobileBottomBar() {
  const { i18n } = useTranslation();
  const { session } = useAuth();
  const config = useSiteSetting<MobileBottomBarConfig>(
    MOBILE_BOTTOM_BAR_SETTINGS_KEY,
    MOBILE_BOTTOM_BAR_DEFAULTS,
  );
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const items = visibleBottomBarItems(config);
  const active = Boolean(session) && config.enabled && items.length > 0;
  const offset = clampOffset(config.offset_bottom);

  const hidden = useHideOnScroll(active && config.hide_on_scroll);
  const onMeasure = useReservedSpace(active, offset);

  if (!active) return null;

  return (
    <div
      className="mbb-slot md:hidden"
      data-hidden={hidden ? "true" : "false"}
      style={{ "--mbb-offset": `${offset}px` } as CSSProperties}
    >
      <MobileBottomBarView
        config={config}
        items={items}
        activeIndex={activeBottomBarIndex(items, pathname)}
        lang={i18n.language || "pl"}
        onMeasure={onMeasure}
      />
    </div>
  );
}
