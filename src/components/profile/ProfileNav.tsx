import { Link, useLocation } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

type NavItem = { to: string; key: keyof Translations["profile"]["nav"] };

interface Translations {
  profile: { nav: Record<string, string> };
}

const ITEMS: NavItem[] = [
  { to: "/profile", key: "overview" },
  { to: "/profile/account", key: "account" },
  { to: "/profile/social", key: "social" },
  { to: "/profile/interests", key: "interests" },
  { to: "/profile/bookmarks", key: "bookmarks" },
  { to: "/profile/follows", key: "follows" },
  { to: "/profile/billing", key: "billing" },
  { to: "/profile/subscription", key: "subscription" },
  { to: "/profile/orders", key: "orders" },
  { to: "/profile/security", key: "security" },
];

export function ProfileNav() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  return (
    <nav className="flex flex-col gap-1" aria-label={t("profile.title")}>
      {ITEMS.map((item) => {
        const active = pathname === item.to || (item.to !== "/profile" && pathname.startsWith(item.to));
        return (
          <Link
            key={item.to}
            to={item.to}
            className={cn(
              "rounded-md px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {t(`profile.nav.${item.key}`)}
          </Link>
        );
      })}
    </nav>
  );
}
