import { Link, useLocation } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { useMyOrganization } from "@/lib/billing/membership";
import {
  UserCircle,
  UserCog,
  Heart,
  Sparkles,
  Bookmark,
  Users,
  Bell,
  Crown,
  Building2,
  CreditCard,
  FileText,
  RefreshCw,
  Shield,
  Lock,
} from "lucide-react";
import type { ComponentType, ReactNode } from "react";

type NavKey =
  | "overview"
  | "edit"
  | "interests"
  | "personality"
  | "bookmarks"
  | "notifications"
  | "follows"
  | "network"
  | "membership"
  | "organization"
  | "billing"
  | "subscription"
  | "orders"
  | "security"
  | "privacy";

type NavItem = {
  to: string;
  key: NavKey;
  search?: Record<string, string>;
  icon: ComponentType<{ className?: string }>;
};

// 13 pozycji w płaskiej liście przytłaczało (audyt IA profilu) - nawigacja
// jest pogrupowana w trzy nazwane sekcje: tożsamość / treści / płatności.
// Konsolidacja tożsamości (ocena modułów 2026-07-20): trzy dawne pozycje
// edycji (account/author/social) to teraz JEDNA strona z zakładkami.
const IDENTITY: NavItem[] = [
  { to: "/profile", key: "overview", icon: UserCircle },
  { to: "/profile/edit", key: "edit", icon: UserCog },
];

const CONTENT: NavItem[] = [
  { to: "/profile/interests", key: "interests", icon: Heart },
  { to: "/profile/personality", key: "personality", icon: Sparkles },
  { to: "/profile/bookmarks", key: "bookmarks", icon: Bookmark },
  { to: "/profile/follows", key: "follows", icon: Heart },
  // Świadomie linkują POZA profil (sieć kontaktów i centrum wiadomości).
  { to: "/network", key: "network", icon: Users },
  { to: "/messages", search: { view: "notifications" }, key: "notifications", icon: Bell },
];

const FINANCE: NavItem[] = [
  { to: "/profile/membership", key: "membership", icon: Crown },
  { to: "/profile/billing", key: "billing", icon: CreditCard },
  { to: "/profile/subscription", key: "subscription", icon: RefreshCw },
  { to: "/profile/orders", key: "orders", icon: FileText },
  { to: "/profile/security", key: "security", icon: Shield },
  { to: "/profile/privacy", key: "privacy", icon: Lock },
];

// Pozycja "Organizacja" pojawia się tylko u posiadaczy miejsca w organizacji
// (B2B) - dla pozostałych to martwy link, więc nie zaśmieca nawigacji.
const ORGANIZATION_ITEM: NavItem = {
  to: "/profile/organization",
  key: "organization",
  icon: Building2,
};

type NavGroupProps = {
  titleKey: string;
  icon: ComponentType<{ className?: string }>;
  children: ReactNode;
};

function NavGroup({ titleKey, icon: Icon, children }: NavGroupProps) {
  const { t } = useTranslation();
  return (
    <div className="rounded-lg border border-border bg-background/60 p-2 shadow-sm">
      <div className="mb-2 flex items-center gap-2 px-2 pb-1.5 pt-0.5">
        <span className="flex h-6 w-6 items-center justify-center rounded-[6px] bg-primary/10 text-primary">
          <Icon className="h-3.5 w-3.5" />
        </span>
        <p className="text-[11px] font-bold uppercase tracking-wider text-foreground">
          {t(titleKey)}
        </p>
      </div>
      <div className="flex flex-col gap-0.5">{children}</div>
    </div>
  );
}

export function ProfileNav() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const myOrg = useMyOrganization();

  const isActive = (to: string) =>
    pathname === to || (to !== "/profile" && pathname.startsWith(to));

  const renderItem = (item: NavItem) => {
    const active = isActive(item.to);
    const Icon = item.icon;
    return (
      <Link
        key={item.to}
        to={item.to}
        {...(item.search ? { search: item.search } : {})}
        aria-current={active ? "page" : undefined}
        className={cn(
          "group relative flex items-center gap-2.5 rounded-[6px] px-2.5 py-2 text-sm font-medium transition-all",
          active
            ? "bg-primary/10 text-foreground font-semibold shadow-sm ring-1 ring-primary/20"
            : "text-muted-foreground hover:bg-muted hover:text-foreground",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "absolute left-0 top-1/2 -translate-y-1/2 w-0.5 rounded-full bg-primary transition-all duration-200",
            active ? "h-5 opacity-100" : "h-0 opacity-0 group-hover:h-3 group-hover:opacity-60",
          )}
        />
        <Icon
          className={cn(
            "h-4 w-4 shrink-0 transition-colors",
            active ? "text-primary" : "text-muted-foreground group-hover:text-foreground",
          )}
        />
        <span className="truncate">{t(`profile.nav.${item.key}`)}</span>
      </Link>
    );
  };

  const financeItems = myOrg.data ? [FINANCE[0], ORGANIZATION_ITEM, ...FINANCE.slice(1)] : FINANCE;

  return (
    <nav className="flex flex-col gap-3" aria-label={t("profile.title")}>
      <NavGroup titleKey="profile.navGroups.identity" icon={UserCircle}>
        {IDENTITY.map(renderItem)}
      </NavGroup>

      <NavGroup titleKey="profile.navGroups.content" icon={Heart}>
        {CONTENT.map(renderItem)}
      </NavGroup>

      <NavGroup titleKey="profile.navGroups.finance" icon={CreditCard}>
        {financeItems.map(renderItem)}
      </NavGroup>
    </nav>
  );
}
