// Molekuła: pojedyncza pozycja mobilnego paska dolnego.
//
// Odpowiednik `.menu__item` z referencji - łącznie z klasą `active` i zmienną
// `--bgColorItem`, na których stoi cała animacja (unos pozycji, wypełnione koło
// pod ikoną, przemalowanie stroke'a). Różnice wobec referencji:
//
//  - kolor akcentu jest podany DWA razy (`--bgColorItem` dla trybu jasnego i
//    `--bgColorItem-dark` dla ciemnego), a wybiera kaskada CSS. Komponent nie
//    czyta motywu w JS, więc SSR i klient nie mogą się rozjechać;
//  - ikona ma opakowanie `.mbb__iconwrap`. To ono nosi koło (::before) i kotwiczy
//    licznik, dzięki czemu koło zostaje wyśrodkowane na ikonie także wtedy, gdy
//    administrator włączy podpisy i pozycja stanie się kolumną. Przy wyglądzie
//    referencyjnym (bez podpisów) efekt jest pikselowo ten sam.
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

export const BottomBarTab = forwardRef<HTMLAnchorElement, BottomBarTabProps>(function BottomBarTab(
  { item, label, active, showLabel, withBadge = true, onSelect },
  ref,
) {
  const style: CSSProperties = {
    "--bgColorItem": itemAccent(item, "light", "var(--brand)"),
    "--bgColorItem-dark": itemAccent(item, "dark", "var(--brand)"),
  } as CSSProperties;

  return (
    <li className="mbb__cell">
      <AppLink
        ref={ref}
        href={item.href}
        className={`mbb__item${active ? " active" : ""}`}
        style={style}
        aria-current={active ? "page" : undefined}
        onClick={onSelect}
      >
        <span className="mbb__iconwrap">
          {/* Wymiar (2.6em) i grubość kreski (1.6) niesie CSS - właściwość CSS
              bije atrybut prezentacyjny lucide, a skala zostaje związana z bazą
              `em` paska, dokładnie jak w referencji. */}
          <DynamicIcon name={item.icon || "circle"} className="mbb__icon" aria-hidden="true" />
          {withBadge ? <LiveTabBadge source={item.badge} /> : null}
        </span>
        {/* Etykieta jest zawsze w DOM (czytniki ekranu, testy). Wygląd
            referencyjny jest bez podpisów, więc domyślnie chowa ją sr-only. */}
        <span className={showLabel ? "mbb__label" : "sr-only"}>{label}</span>
      </AppLink>
    </li>
  );
});
