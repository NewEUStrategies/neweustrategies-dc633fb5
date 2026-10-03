// Sekcja "Nawigacja" w mobilnej szufladzie - renderuje ten sam menu (klucz
// `main`) co desktop, przez `<SiteMenu mobile>`. Dzięki temu hamburger ma
// dokładnie tę samą strukturę i zwijane podkategorie co dropdown desktopowy.
// Konfiguracja `NavItem` z super-admina jest zachowana jako fallback -
// używana tylko wtedy, gdy admin celowo nie skonfigurował menu głównego.
import { useEffect, useRef, type ComponentType } from "react";
import { useTranslation } from "react-i18next";
import { useLang } from "@/lib/i18n/useLang";
import type { AppLang } from "@/lib/i18n/localePath";
import { pickLocalized } from "@/lib/i18n/pickLocalized";
import "@/lib/i18n-mobile-drawer";
import { Link } from "@tanstack/react-router";
import {
  Home,
  Newspaper,
  Tag,
  Mic,
  Mail,
  DollarSign,
  BookOpen,
  Briefcase,
  Calendar,
  FileText,
  Info,
  LayoutGrid,
  Star,
  User,
  Users,
  Shield,
  Phone,
  MapPin,
  Link as LinkIcon,
} from "lucide-react";
import type { NavItem, NavIcon } from "@/lib/mobileDrawer";
import { SiteMenu } from "@/components/menu/SiteMenu";

const ICON_MAP: Record<NavIcon, ComponentType<{ className?: string }>> = {
  home: Home,
  newspaper: Newspaper,
  tag: Tag,
  mic: Mic,
  mail: Mail,
  "dollar-sign": DollarSign,
  "book-open": BookOpen,
  briefcase: Briefcase,
  calendar: Calendar,
  "file-text": FileText,
  info: Info,
  "layout-grid": LayoutGrid,
  star: Star,
  user: User,
  users: Users,
  shield: Shield,
  phone: Phone,
  "map-pin": MapPin,
  link: LinkIcon,
};

type Props = {
  items: NavItem[];
  onNavigate: () => void;
  menuKey?: string;
};

export function MobileNavSection({ items, onNavigate, menuKey = "main" }: Props) {
  const { t } = useTranslation();
  const lang = useLang();
  const wrapRef = useRef<HTMLElement | null>(null);

  // Zamknij szufladę po kliknięciu w link wewnątrz <SiteMenu mobile>.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest("a")) onNavigate();
    };
    el.addEventListener("click", onClick);
    return () => el.removeEventListener("click", onClick);
  }, [onNavigate]);

  return (
    <nav
      ref={wrapRef}
      aria-label={t("mobileDrawer.navigation")}
      className="border-b border-border py-2"
    >
      <p className="px-4 pt-1 pb-2 text-[11px] font-bold tracking-wider uppercase text-muted-foreground">
        {t("mobileDrawer.navigation")}
      </p>
      <div className="px-1 mobile-drawer-menu">
        <SiteMenu menuKey={menuKey} lang={lang} mobile />
      </div>
      <MobileNavItemsFallback items={items} lang={lang} onNavigate={onNavigate} />
    </nav>
  );
}

// Legacy pozycje z konfiguracji super-admina - renderowane pod menu głównym.
// Jeśli super-admin wyłączył wszystkie, znika bez śladu.
//
// BIEŻĄCĄ POZYCJĘ WYZNACZA `Link` Z ROUTERA, nie `window.location` w renderze:
//   * ścieżka routera jest KANONICZNA (rewrite zdejmuje prefiks `/en`)
//     i zdekodowana, więc pasuje do `href` z konfiguracji w obu językach.
//     `window.location.pathname` pod `/en/...` nie pasował nigdy - czytelnik
//     EN nie dostawał zaznaczenia, choć `Link` (liczący z routera) i tak
//     doklejał mu `aria-current`;
//   * odczyt okna w renderze to inny wynik na serwerze (brak `window`, każda
//     pozycja bez zaznaczenia) niż w pierwszym renderze klienta - rozjazd
//     hydratacji, gdy tylko sekcja trafi do SSR;
//   * JEDNO źródło prawdy: `aria-current` i wyróżnienie wizualne (`activeProps`)
//     liczy ten sam test aktywności `Link`. Własne porównanie `pathname ===
//     href` rozjeżdżało się z nim na końcowym ukośniku (`/wydarzenia/` wobec
//     `/wydarzenia`): `Link` uznawał pozycję za bieżącą, klasa jej nie dostawała.
function MobileNavItemsFallback({
  items,
  lang,
  onNavigate,
}: {
  items: NavItem[];
  lang: AppLang;
  onNavigate: () => void;
}) {
  const visible = items.filter((i) => i.enabled);
  if (visible.length === 0) return null;
  const linkCls =
    "flex items-center gap-3 px-4 py-3 text-sm font-medium text-foreground hover:bg-muted border-t border-border/60 transition";

  return (
    <div className="mt-2">
      {visible.map((item) => {
        const Icon = ICON_MAP[item.icon] ?? LinkIcon;
        const label = pickLocalized(item, "label", lang);
        const external = /^https?:\/\//.test(item.href);
        if (external) {
          return (
            <a
              key={item.id}
              href={item.href}
              onClick={onNavigate}
              className={linkCls}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Icon className="w-4 h-4 text-muted-foreground" />
              <span>{label}</span>
            </a>
          );
        }
        return (
          <Link
            key={item.id}
            to={item.href}
            onClick={onNavigate}
            // `exact`: bez niego `Link` dopasowuje po PREFIKSIE ścieżki i pozycja
            // `/wydarzenia` udawałaby bieżącą stronę także na
            // `/wydarzenia/konferencja`. Aktywny `Link` sam dokleja
            // `aria-current="page"`, a `activeProps` - wyróżnienie.
            activeOptions={{ exact: true, includeSearch: false }}
            activeProps={{ className: "bg-muted/60 font-semibold" }}
            className={linkCls}
          >
            <Icon className="w-4 h-4 text-muted-foreground" />
            <span>{label}</span>
          </Link>
        );
      })}
    </div>
  );
}
