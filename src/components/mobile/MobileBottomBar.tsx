// Publiczny mobilny pasek dolny (animated tab bar).
//
// Renderowany wyłącznie na mobile (md:hidden) przez SiteChrome. Konfiguracja
// pochodzi z site_settings[key="mobile_bottom_bar"] - patrz
// @/lib/mobileBottomBar/config. Aktywna pozycja jest wyliczana z bieżącej
// ścieżki, a podświetlenie („border") przesuwa się animacją transform.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useRouterState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { AppLink } from "@/components/atoms/AppLink";
import { DynamicIcon } from "@/lib/icons/DynamicIcon";
import { useSiteSetting } from "@/lib/useSiteSetting";
import {
  MOBILE_BOTTOM_BAR_DEFAULTS,
  MOBILE_BOTTOM_BAR_SETTINGS_KEY,
  activeBottomBarIndex,
  bottomBarLabel,
  clampOffset,
  clampRadius,
  safeBarColor,
  visibleBottomBarItems,
  type MobileBottomBarConfig,
  type MobileBottomBarItem,
} from "@/lib/mobileBottomBar/config";
import "@/lib/i18n-mobile-bottom-bar";

/** Wariant prezentacyjny - używany też przez podgląd w panelu admina. */
export function MobileBottomBarView({
  config,
  items,
  activeIndex,
  lang,
  className,
  onSelect,
}: {
  config: MobileBottomBarConfig;
  items: MobileBottomBarItem[];
  activeIndex: number;
  lang: string;
  className?: string;
  onSelect?: (index: number) => void;
}) {
  const { t } = useTranslation();
  const listRef = useRef<HTMLUListElement | null>(null);
  const markerRef = useRef<HTMLSpanElement | null>(null);
  const itemRefs = useRef<Array<HTMLLIElement | null>>([]);
  const [ready, setReady] = useState(false);

  const positionMarker = useCallback(() => {
    const list = listRef.current;
    const marker = markerRef.current;
    const active = itemRefs.current[activeIndex];
    if (!list || !marker || !active) return;
    const left = active.offsetLeft + (active.offsetWidth - marker.offsetWidth) / 2;
    marker.style.transform = `translate3d(${Math.round(left)}px, 0, 0)`;
  }, [activeIndex]);

  useLayoutEffect(() => {
    positionMarker();
    const id = window.requestAnimationFrame(() => {
      positionMarker();
      setReady(true);
    });
    const onResize = () => positionMarker();
    window.addEventListener("resize", onResize);
    return () => {
      window.cancelAnimationFrame(id);
      window.removeEventListener("resize", onResize);
    };
  }, [positionMarker, items.length, config.show_labels]);

  const activeColor = config.use_item_color
    ? safeBarColor(items[activeIndex]?.color, "var(--brand)")
    : "var(--brand)";

  const style: CSSProperties = {
    "--mbb-bg-light": safeBarColor(config.background_light, "#ffffff"),
    "--mbb-bg-dark": safeBarColor(config.background_dark, "#111318"),
    "--mbb-icon-light": safeBarColor(config.icon_light, "#6b7280"),
    "--mbb-icon-dark": safeBarColor(config.icon_dark, "#9aa3b2"),
    "--mbb-active": activeColor,
    "--mbb-radius": `${clampRadius(config.radius)}px`,
  } as CSSProperties;

  return (
    <nav
      aria-label={t("mobileBottomBar.nav", { defaultValue: "Nawigacja mobilna" })}
      className={`mbb ${className ?? ""}`}
      style={style}
      data-ready={ready ? "true" : "false"}
    >
      <ul className="mbb__list" ref={listRef}>
        <span aria-hidden className="mbb__marker" ref={markerRef} />
        {items.map((item, index) => {
          const label = bottomBarLabel(item, lang);
          const active = index === activeIndex;
          return (
            <li
              key={item.id || `${item.href}-${index}`}
              className="mbb__item"
              data-active={active ? "true" : "false"}
              style={{ "--mbb-item": safeBarColor(item.color, "var(--brand)") } as CSSProperties}
              ref={(el) => {
                itemRefs.current[index] = el;
              }}
            >
              <AppLink
                href={item.href}
                className="mbb__link"
                aria-label={label}
                aria-current={active ? "page" : undefined}
                onClick={() => onSelect?.(index)}
              >
                <DynamicIcon name={item.icon || "circle"} className="mbb__icon" size={22} />
                {config.show_labels ? <span className="mbb__label">{label}</span> : null}
              </AppLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Kontener podpięty pod site_settings + routing (montowany w SiteChrome). */
export function MobileBottomBar() {
  const { i18n } = useTranslation();
  const config = useSiteSetting<MobileBottomBarConfig>(
    MOBILE_BOTTOM_BAR_SETTINGS_KEY,
    MOBILE_BOTTOM_BAR_DEFAULTS,
  );
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [hidden, setHidden] = useState(false);

  const hideOnScroll = config.enabled && config.hide_on_scroll;
  useEffect(() => {
    if (!hideOnScroll) {
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
        if (Math.abs(y - last) > 8) {
          setHidden(y > last && y > 120);
          last = y;
        }
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
    };
  }, [hideOnScroll]);

  if (!config.enabled) return null;
  const items = visibleBottomBarItems(config);
  if (items.length === 0) return null;

  return (
    <div
      className="mbb-slot md:hidden"
      data-hidden={hidden ? "true" : "false"}
      style={{ "--mbb-offset": `${clampOffset(config.offset_bottom)}px` } as CSSProperties}
    >
      <MobileBottomBarView
        config={config}
        items={items}
        activeIndex={activeBottomBarIndex(items, pathname)}
        lang={i18n.language || "pl"}
      />
    </div>
  );
}
