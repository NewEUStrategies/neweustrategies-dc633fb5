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
  | "bookmarks"
  | "notifications"
  | "follows"
  | "billing"
  | "subscription"
  | "orders"
  | "security";

type NavItem = { to: string; key: NavKey };

const MAIN: NavItem[] = [
  { to: "/profile", key: "overview" },
  { to: "/profile/account", key: "account" },
  { to: "/profile/author", key: "author" },
  { to: "/profile/social", key: "social" },
  { to: "/profile/interests", key: "interests" },
  { to: "/profile/bookmarks", key: "bookmarks" },
  { to: "/messages/notifications", key: "notifications" },
  { to: "/profile/follows", key: "follows" },
];

const FINANCE: NavItem[] = [
  { to: "/profile/billing", key: "billing" },
  { to: "/profile/subscription", key: "subscription" },
  { to: "/profile/orders", key: "orders" },
  { to: "/profile/security", key: "security" },
];

export function ProfileNav() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const { roles } = useAuth();
  const canAuthor = roles.some((r) => r === "author" || r === "admin" || r === "super_admin");
  const visibleMain = canAuthor ? MAIN : MAIN.filter((i) => i.key !== "author");

  const isActive = (to: string) =>
    pathname === to || (to !== "/profile" && pathname.startsWith(to));

  const renderItem = (item: NavItem) => {
    const active = isActive(item.to);
    return (
      <Link
        key={item.to}
        to={item.to}
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

  return (
    <nav className="flex flex-col gap-0.5" aria-label={t("profile.title")}>
      {visibleMain.map(renderItem)}
      <div className="my-3 h-px bg-border/70" role="separator" />
      {FINANCE.map(renderItem)}
    </nav>
  );
}
