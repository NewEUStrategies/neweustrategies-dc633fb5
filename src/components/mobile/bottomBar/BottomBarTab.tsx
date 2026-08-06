// Molekuła: pojedyncza pozycja mobilnego paska dolnego.
//
// Wyłącznie prezentacja + jeden akcent (kolor pozycji) wystawiony jako zmienne
// CSS `--mbb-item` / `--mbb-item-dark`. Wybór motywu zostaje po stronie CSS
// (`.dark .mbb`), więc komponent nie czyta motywu w JS i nie może rozjechać się
// przy hydratacji SSR.
import { forwardRef, type CSSProperties } from "react";
import { AppLink } from "@/components/atoms/AppLink";
import { DynamicIcon } from "@/lib/icons/DynamicIcon";
import { LiveTabBadge } from "./LiveTabBadge";
import { itemAccent, type MobileBottomBarItem } from "@/lib/mobileBottomBar/config";

export interface BottomBarTabProps {
  item: MobileBottomBarItem;
  label: string;
  active: boolean;
  showLabel: boolean;
  /** Wyłącza żywe liczniki (podgląd w panelu admina). */
  withBadge?: boolean;
  onSelect?: () => void;
}

export const BottomBarTab = forwardRef<HTMLLIElement, BottomBarTabProps>(function BottomBarTab(
  { item, label, active, showLabel, withBadge = true, onSelect },
  ref,
) {
  const style: CSSProperties = {
    "--mbb-item": itemAccent(item, "light", "var(--brand)"),
    "--mbb-item-dark": itemAccent(item, "dark", "var(--brand)"),
  } as CSSProperties;

  return (
    <li className="mbb__item" data-active={active ? "true" : "false"} style={style} ref={ref}>
      <AppLink
        href={item.href}
        className="mbb__link"
        aria-current={active ? "page" : undefined}
        onClick={onSelect}
      >
        <span className="mbb__iconwrap">
          <DynamicIcon
            name={item.icon || "circle"}
            className="mbb__icon"
            size={22}
            strokeWidth={active ? 2.25 : 1.75}
            aria-hidden="true"
          />
          {withBadge ? <LiveTabBadge source={item.badge} /> : null}
        </span>
        {/* Etykieta jest zawsze w DOM (czytniki ekranu, testy), a przy
            wyłączonych podpisach chowa ją wyłącznie klasa sr-only. */}
        <span className={showLabel ? "mbb__label" : "sr-only"}>{label}</span>
      </AppLink>
    </li>
  );
});
