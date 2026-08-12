// Sticky sub-nav dla /admin/community/*.
//
// Zakładka "Kluby dyskusyjne" niesie plakietkę z sumą dwóch kolejek:
// premoderacji treści i próśb o dostęp. RPC admin_club_pending_counts
// istniało od migracji A5 i nie miało ANI JEDNEGO wywołania - bez plakietki
// wpis czekający na zatwierdzenie był niewidoczny, dopóki ktoś sam nie wszedł
// w konkretny klub i nie otworzył zakładki moderacji.
import { Link, useRouterState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ensureI18n as ensureAdminCommunityI18n } from "@/lib/i18n-admin-community";
import { useAuth } from "@/hooks/useAuth";
import { useClubPendingCounts } from "@/lib/clubs/useClubs";
import {
  LayoutDashboard,
  MessageCircle,
  Calendar,
  HelpCircle,
  Vote,
  UserPlus,
  Award,
  Bell,
  BarChart3,
  Users2,
  MessagesSquare,
} from "lucide-react";

const tabs = [
  {
    to: "/admin/community" as const,
    key: "overview",
    icon: LayoutDashboard,
    labelKey: "adminCommunity.nav.overview",
    exact: true,
  },
  {
    to: "/admin/community/chat" as const,
    key: "chat",
    icon: MessageCircle,
    labelKey: "adminCommunity.nav.chat",
    exact: false,
  },
  {
    to: "/admin/community/clubs" as const,
    key: "clubs",
    icon: MessagesSquare,
    labelKey: "adminCommunity.nav.clubs",
    exact: false,
  },
  {
    to: "/admin/community/events" as const,
    key: "events",
    icon: Calendar,
    labelKey: "adminCommunity.nav.events",
    exact: false,
  },
  {
    to: "/admin/community/qa" as const,
    key: "qa",
    icon: HelpCircle,
    labelKey: "adminCommunity.nav.qa",
    exact: false,
  },
  {
    to: "/admin/community/polls" as const,
    key: "polls",
    icon: Vote,
    labelKey: "adminCommunity.nav.polls",
    exact: false,
  },
  {
    to: "/admin/community/contributors" as const,
    key: "contributors",
    icon: UserPlus,
    labelKey: "adminCommunity.nav.contributors",
    exact: false,
  },
  {
    to: "/admin/community/badges" as const,
    key: "badges",
    icon: Award,
    labelKey: "adminCommunity.nav.badges",
    exact: false,
  },
  {
    to: "/admin/community/notifications" as const,
    key: "notifications",
    icon: Bell,
    labelKey: "adminCommunity.nav.notifications",
    exact: false,
  },
  {
    to: "/admin/community/engagement" as const,
    key: "engagement",
    icon: BarChart3,
    labelKey: "adminCommunity.nav.engagement",
    exact: false,
  },
];

export function CommunitySubNav() {
  ensureAdminCommunityI18n();
  const { t } = useTranslation();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { isAdmin } = useAuth();
  const clubCounts = useClubPendingCounts(isAdmin);
  const clubPending =
    (clubCounts.data?.moderationPending ?? 0) + (clubCounts.data?.joinRequests ?? 0);

  return (
    <div className="sticky top-0 z-30 -mx-4 md:-mx-6 px-4 md:px-6 py-3 bg-background/95 backdrop-blur border-b border-border">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 pr-3 mr-1 border-r border-border/60">
          <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center">
            <Users2 className="w-4 h-4 text-primary" />
          </div>
          <h1 className="font-display text-base sm:text-lg leading-none">
            {t("adminCommunity.nav.sectionTitle")}
          </h1>
        </div>
        <nav
          className="flex items-center gap-1 p-1 rounded-lg bg-muted/60 border border-border/60"
          aria-label={t("adminCommunity.nav.sectionsNavLabel")}
        >
          {tabs.map((tab) => {
            const active = tab.exact ? pathname === tab.to : pathname.startsWith(tab.to);
            const Icon = tab.icon;
            return (
              <Link
                key={tab.key}
                to={tab.to}
                className={
                  "flex items-center gap-2 px-3 py-1.5 rounded-md text-xs sm:text-sm font-medium transition-colors " +
                  (active
                    ? "bg-background shadow-sm text-foreground"
                    : "text-muted-foreground hover:text-foreground")
                }
              >
                <Icon className="w-3.5 h-3.5" />
                {t(tab.labelKey)}
                {tab.key === "clubs" && clubPending > 0 ? (
                  <span
                    className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500/20 px-1 text-[10px] font-semibold tabular-nums text-amber-700 dark:text-amber-300"
                    aria-label={t("adminCommunity.nav.clubsPendingLabel")}
                  >
                    {clubPending > 99 ? "99+" : clubPending}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
