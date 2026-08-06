// Organizm: prezentacyjna warstwa mobilnego paska dolnego.
//
// Czysto sterowany propsami (config + items + activeIndex), więc ten sam kod
// renderuje pasek publiczny i podgląd w panelu admina - podgląd nie może
// rozjechać się z produkcją, bo to fizycznie ten sam komponent.
//
// Znacznik aktywnej pozycji ("marker") jest jednym elementem pozycjonowanym
// absolutnie i przesuwanym `transform`em. Pozycje mają równą szerokość
// (flex: 1 1 0), więc animuje się wyłącznie translacja - bez reflow, bez
// skalowania, które deformowałoby promień 6 px.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { BottomBarTab } from "./BottomBarTab";
import {
  bottomBarLabel,
  clampRadius,
  itemAccent,
  safeBarColor,
  type MobileBottomBarConfig,
  type MobileBottomBarItem,
} from "@/lib/mobileBottomBar/config";

export interface MobileBottomBarViewProps {
  config: MobileBottomBarConfig;
  items: MobileBottomBarItem[];
  /** -1 = żadna pozycja nie odpowiada bieżącej trasie (marker ukryty). */
  activeIndex: number;
  lang: string;
  className?: string;
  /** Wyłącza żywe liczniki - używane przez podgląd w panelu admina. */
  withBadges?: boolean;
  onSelect?: (index: number) => void;
  /** Zgłasza zmierzoną wysokość paska (rezerwacja miejsca w układzie strony). */
  onMeasure?: (height: number) => void;
}

export function MobileBottomBarView({
  config,
  items,
  activeIndex,
  lang,
  className,
  withBadges = true,
  onSelect,
  onMeasure,
}: MobileBottomBarViewProps) {
  const { t } = useTranslation();
  const navRef = useRef<HTMLElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const markerRef = useRef<HTMLSpanElement | null>(null);
  const itemRefs = useRef<Array<HTMLLIElement | null>>([]);
  const [ready, setReady] = useState(false);

  const hasActive = activeIndex >= 0 && activeIndex < items.length;

  const positionMarker = useCallback(() => {
    const list = listRef.current;
    const marker = markerRef.current;
    const active = hasActive ? itemRefs.current[activeIndex] : null;
    if (!list || !marker || !active) return;
    marker.style.width = `${active.offsetWidth}px`;
    marker.style.transform = `translate3d(${Math.round(active.offsetLeft)}px, 0, 0)`;
  }, [activeIndex, hasActive]);

  useLayoutEffect(() => {
    positionMarker();
    // Druga próba po pierwszej klatce: ikony lucide i webfont etykiet mogą
    // dojechać po layoucie, a marker musi trafić w ostateczne wymiary.
    const frame = window.requestAnimationFrame(() => {
      positionMarker();
      setReady(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [positionMarker, items.length, config.show_labels]);

  // ResizeObserver zamiast nasłuchu na `resize`: łapie też zmianę wysokości po
  // dojechaniu fontu i obrót ekranu, w którym `resize` bywa zgłaszany przed
  // przeliczeniem layoutu.
  useEffect(() => {
    const nav = navRef.current;
    if (!nav || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      positionMarker();
      onMeasure?.(nav.offsetHeight);
    });
    observer.observe(nav);
    onMeasure?.(nav.offsetHeight);
    return () => observer.disconnect();
  }, [positionMarker, onMeasure]);

  const activeItem = hasActive ? items[activeIndex] : undefined;
  const accentLight = config.use_item_color
    ? itemAccent(activeItem, "light", "var(--brand)")
    : "var(--brand)";
  const accentDark = config.use_item_color
    ? itemAccent(activeItem, "dark", "var(--brand)")
    : "var(--brand)";

  const style: CSSProperties = {
    "--mbb-bg-light": safeBarColor(config.background_light, "#ffffff"),
    "--mbb-bg-dark": safeBarColor(config.background_dark, "#111318"),
    "--mbb-icon-light": safeBarColor(config.icon_light, "#6b7280"),
    "--mbb-icon-dark": safeBarColor(config.icon_dark, "#9aa3b2"),
    "--mbb-active-light": accentLight,
    "--mbb-active-dark": accentDark,
    "--mbb-radius": `${clampRadius(config.radius)}px`,
  } as CSSProperties;

  return (
    <nav
      ref={navRef}
      aria-label={t("mobileBottomBar.nav", { defaultValue: "Nawigacja mobilna" })}
      className={`mbb ${className ?? ""}`}
      style={style}
      data-ready={ready ? "true" : "false"}
      data-has-active={hasActive ? "true" : "false"}
    >
      <ul className="mbb__list" ref={listRef}>
        <span aria-hidden="true" className="mbb__marker" ref={markerRef} />
        {items.map((item, index) => (
          <BottomBarTab
            key={item.id || `${item.href}-${index}`}
            item={item}
            label={bottomBarLabel(item, lang, (key) => t(key))}
            active={index === activeIndex}
            showLabel={config.show_labels}
            withBadge={withBadges}
            onSelect={onSelect ? () => onSelect(index) : undefined}
            ref={(el) => {
              itemRefs.current[index] = el;
            }}
          />
        ))}
      </ul>
    </nav>
  );
}
