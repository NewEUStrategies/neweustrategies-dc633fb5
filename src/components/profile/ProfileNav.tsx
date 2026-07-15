import { Link, useLocation } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";

type NavKey =
  | "overview"
  | "account"
  | "author"
  | "social"
  | "interests"
  | "personality"
  | "bookmarks"
  | "notifications"
  | "follows"
  | "membership"
  | "billing"
  | "subscription"
  | "orders"
  | "security"
  | "privacy";

type NavItem = { to: string; key: NavKey; search?: Record<string, string> };

// 13 pozycji w płaskiej liście przytłaczało (audyt IA profilu) - nawigacja
// jest pogrupowana w trzy nazwane sekcje: tożsamość / treści / płatności.
const IDENTITY: NavItem[] = [
  { to: "/profile", key: "overview" },
  { to: "/profile/account", key: "account" },
  { to: "/profile/author", key: "author" },
  { to: "/profile/social", key: "social" },
];

const CONTENT: NavItem[] = [
  { to: "/profile/interests", key: "interests" },
  { to: "/profile/personality", key: "personality" },
  { to: "/profile/bookmarks", key: "bookmarks" },
  { to: "/profile/follows", key: "follows" },
  // Świadomie linkuje POZA profil (centrum wiadomości) - stąd na końcu grupy.
  { to: "/messages", search: { view: "notifications" }, key: "notifications" },
];

const FINANCE: NavItem[] = [
  { to: "/profile/membership", key: "membership" },
  { to: "/profile/billing", key: "billing" },
  { to: "/profile/subscription", key: "subscription" },
  { to: "/profile/orders", key: "orders" },
  { to: "/profile/security", key: "security" },
  { to: "/profile/privacy", key: "privacy" },
];

export function ProfileNav() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const { roles } = useAuth();
  const canAuthor = roles.some((r) => r === "author" || r === "admin" || r === "super_admin");
  const identity = canAuthor ? IDENTITY : IDENTITY.filter((i) => i.key !== "author");

  const isActive = (to: string) =>
    pathname === to || (to !== "/profile" && pathname.startsWith(to));

  const renderItem = (item: NavItem) => {
    const active = isActive(item.to);
    return (
      <Link
        key={item.to}
        to={item.to}
        {...(item.search ? { search: item.search } : {})}
        aria-current={active ? "page" : undefined}
        className={cn(
          "group relative flex items-center rounded-md px-3 py-2 text-sm font-medium transition-all",
          active
            ? "bg-background text-foreground font-semibold shadow-sm ring-1 ring-border"
            : "text-muted-foreground hover:bg-background hover:text-foreground",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "absolute left-0 top-1/2 -translate-y-1/2 w-0.5 rounded-full bg-primary transition-all duration-200",
            active ? "h-5 opacity-100" : "h-0 opacity-0 group-hover:h-3 group-hover:opacity-60",
          )}
        />
        <span className="truncate">{t(`profile.nav.${item.key}`)}</span>
      </Link>
    );
  };

  const groupHeading = (key: string) => (
    <p className="px-3 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80 first:pt-0">
      {t(key)}
    </p>
  );

  return (
    <nav className="flex flex-col gap-0.5" aria-label={t("profile.title")}>
      {groupHeading("profile.navGroups.identity")}
      {identity.map(renderItem)}
      {groupHeading("profile.navGroups.content")}
      {CONTENT.map(renderItem)}
      {groupHeading("profile.navGroups.finance")}
      {FINANCE.map(renderItem)}
    </nav>
  );
}
