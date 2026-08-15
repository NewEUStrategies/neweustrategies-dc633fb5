// Organizm: prezentacyjna warstwa mobilnego paska dolnego.
//
// Wierne odwzorowanie referencyjnego "animated tab bar": nad paskiem unosi się
// GARB wycięty ścieżką SVG (clip-path), a aktywna pozycja wyjeżdża w górę i
// dostaje wypełnione koło w swoim kolorze, po którym ikona rysuje się od nowa
// (stroke-dashoffset). Odwzorowane 1:1 z referencji:
//
//   .svg-container  -> .mbb__clip      (nośnik <clipPath>, zerowe wymiary)
//   .menu           -> .mbb            (pigułka paska)
//   .menu__item     -> .mbb__item      (klikalna pozycja)
//   .menu__border   -> .mbb__border    (garb przesuwany transformem)
//   .icon           -> .mbb__icon
//   --bgColorItem   -> --bgColorItem   (bez zmian)
//   --timeOut       -> --timeOut       (bez zmian)
//
// Trzy świadome odstępstwa od referencji, każde uzasadnione:
//  1. <button> -> <a> (AppLink). To jest NAWIGACJA po trasach, więc pozycja
//     musi dać się otworzyć w nowej karcie, skopiować i przeczytać jako link.
//     Wygląd i animacja są identyczne.
//  2. id clip-path jest unikalny per instancja (useId). Referencja ma je zaszyte
//     na sztywno, a u nas pasek renderuje się także w podglądzie panelu - dwa
//     te same id w jednym dokumencie łamią odwołanie url(#...).
//  3. Formuła pozycji garbu liczy się względem prostokąta listy, nie
//     `menu.offsetLeft`. W referencji pasek stoi w wycentrowanym kontenerze bez
//     przewijania, więc oba układy odniesienia się pokrywają; u nas pasek jest
//     `position: fixed`, gdzie offsetLeft dałby przesunięcie.
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
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

/**
 * Ścieżka garbu z referencji, bez zmian. `clipPathUnits="objectBoundingBox"` +
 * skala 1/202.9 x 1/45.5 normalizuje viewBox do jedynek, dzięki czemu ten sam
 * kształt skaluje się do dowolnej szerokości elementu .mbb__border.
 */
const CLIP_SCALE = "scale(0.0049285362247413 0.021978021978022)";
const CLIP_PATH_D =
  "M6.7,45.5c5.7,0.1,14.1-0.4,23.3-4c5.7-2.3,9.9-5,18.1-10.5c10.7-7.1,11.8-9.2,20.6-14.3c5-2.9,9.2-5.2,15.2-7 c7.1-2.1,13.3-2.3,17.6-2.1c4.2-0.2,10.5,0.1,17.6,2.1c6.1,1.8,10.2,4.1,15.2,7c8.8,5,9.9,7.1,20.6,14.3c8.3,5.5,12.4,8.2,18.1,10.5 c9.2,3.6,17.6,4.2,23.3,4H6.7z";

export interface MobileBottomBarViewProps {
  config: MobileBottomBarConfig;
  items: MobileBottomBarItem[];
  /** -1 = żadna pozycja nie odpowiada bieżącej trasie (garb ukryty). */
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
  const rawId = useId();
  // useId zwraca ":r0:" - dwukropki wychodzą poza to, co bezpiecznie znosi
  // fragment w url(#...), więc je zdejmujemy.
  const clipId = `mbb-clip-${rawId.replace(/:/g, "")}`;

  const navRef = useRef<HTMLElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const borderRef = useRef<HTMLSpanElement | null>(null);
  const itemRefs = useRef<Array<HTMLAnchorElement | null>>([]);
  const [ready, setReady] = useState(false);

  const hasActive = activeIndex >= 0 && activeIndex < items.length;

  /** Referencyjne `offsetMenuBorder()`: garb centruje się pod aktywną pozycją. */
  const offsetBorder = useCallback(() => {
    const list = listRef.current;
    const border = borderRef.current;
    const activeItem = hasActive ? itemRefs.current[activeIndex] : null;
    if (!list || !border || !activeItem) return;

    const item = activeItem.getBoundingClientRect();
    const frame = list.getBoundingClientRect();
    const left = Math.floor(item.left - frame.left - (border.offsetWidth - item.width) / 2);
    border.style.transform = `translate3d(${left}px, 0, 0)`;
  }, [activeIndex, hasActive]);

  useLayoutEffect(() => {
    offsetBorder();
    // Druga próba po pierwszej klatce: ikony i webfont etykiet mogą dojechać po
    // layoucie, a garb musi trafić w ostateczne wymiary.
    const frame = window.requestAnimationFrame(() => {
      offsetBorder();
      setReady(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [offsetBorder, items.length, config.show_labels]);

  // `--timeOut` z referencji: w trakcie zmiany rozmiaru przejście jest wyłączone
  // ("transition: transform none" jest nieprawidłowe, więc przeglądarka schodzi
  // do wartości początkowej = 0s), dzięki czemu garb nie goni okna animacją.
  //
  // Dwa odstępstwa, oba wymuszone tym, że u nas aktywną pozycję zmienia także
  // nawigacja po trasach:
  //  1. Referencja kasuje flagę dopiero przy kliknięciu - u nas zdejmuje ją
  //     klatka po ustabilizowaniu rozmiaru, inaczej po obrocie ekranu animacja
  //     zostaje martwa aż do dotknięcia paska.
  //  2. Obserwator montuje się RAZ i czyta świeże domknięcia z refów. Wcześniej
  //     zależał od `offsetBorder`, który zmienia tożsamość przy każdej zmianie
  //     trasy - obserwator wpinał się od nowa, jego pierwsze (natychmiastowe)
  //     wywołanie ustawiało `--timeOut: none` i przejście garbu było ucinane
  //     dokładnie wtedy, gdy miało się odegrać. Dodatkowo reagujemy tylko na
  //     FAKTYCZNĄ zmianę wymiaru, a nie na samo zgłoszenie obserwatora.
  const offsetBorderRef = useRef(offsetBorder);
  offsetBorderRef.current = offsetBorder;
  const onMeasureRef = useRef(onMeasure);
  onMeasureRef.current = onMeasure;

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;

    onMeasureRef.current?.(nav.offsetHeight);
    if (typeof ResizeObserver === "undefined") return;

    let restore = 0;
    let lastWidth = nav.offsetWidth;
    let lastHeight = nav.offsetHeight;

    const observer = new ResizeObserver(() => {
      const width = nav.offsetWidth;
      const height = nav.offsetHeight;
      if (width === lastWidth && height === lastHeight) return;
      lastWidth = width;
      lastHeight = height;

      nav.style.setProperty("--timeOut", "none");
      offsetBorderRef.current();
      onMeasureRef.current?.(height);
      window.cancelAnimationFrame(restore);
      restore = window.requestAnimationFrame(() => nav.style.removeProperty("--timeOut"));
    });
    observer.observe(nav);

    return () => {
      window.cancelAnimationFrame(restore);
      observer.disconnect();
      nav.style.removeProperty("--timeOut");
    };
  }, []);

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
      aria-label={t("mobileBottomBar.nav")}
      className={`mbb ${className ?? ""}`}
      style={style}
      data-ready={ready ? "true" : "false"}
      data-has-active={hasActive ? "true" : "false"}
      data-labels={config.show_labels ? "true" : "false"}
      data-own-colors={config.use_item_color ? "true" : "false"}
    >
      {/* Nośnik ścieżki wycinającej garb. Zerowe wymiary - element nigdy nie
          zajmuje miejsca, jest wyłącznie definicją dla clip-path. */}
      <div className="mbb__clip" aria-hidden="true">
        <svg viewBox="0 0 202.9 45.5" focusable="false">
          <clipPath id={clipId} clipPathUnits="objectBoundingBox" transform={CLIP_SCALE}>
            <path d={CLIP_PATH_D} />
          </clipPath>
        </svg>
      </div>

      <ul className="mbb__list" ref={listRef}>
        {items.map((item, index) => (
          <BottomBarTab
            key={item.id || `${item.href}-${index}`}
            item={item}
            label={bottomBarLabel(item, lang, (key) => t(key))}
            active={index === activeIndex}
            showLabel={config.show_labels}
            lang={lang}
            withBadge={withBadges}
            onSelect={onSelect ? () => onSelect(index) : undefined}
            ref={(el) => {
              itemRefs.current[index] = el;
            }}
          />
        ))}
        <span
          aria-hidden="true"
          className="mbb__border"
          ref={borderRef}
          style={{ clipPath: `url(#${clipId})` }}
        />
      </ul>
    </nav>
  );
}
