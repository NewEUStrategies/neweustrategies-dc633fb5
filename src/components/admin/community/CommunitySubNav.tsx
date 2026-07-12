// Sticky sub-nav dla /admin/community/* (Chat / Events / Q&A).
import { Link, useRouterState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { LayoutDashboard, MessageCircle, Calendar, HelpCircle, Users2 } from "lucide-react";

const tabs = [
  {
    to: "/admin/community" as const,
    key: "overview",
    icon: LayoutDashboard,
    labelPl: "Podsumowanie",
    labelEn: "Overview",
    exact: true,
  },
  {
    to: "/admin/community/chat" as const,
    key: "chat",
    icon: MessageCircle,
    labelPl: "Chat",
    labelEn: "Chat",
    exact: false,
  },
  {
    to: "/admin/community/events" as const,
    key: "events",
    icon: Calendar,
    labelPl: "Wydarzenia",
    labelEn: "Events",
    exact: false,
  },
  {
    to: "/admin/community/qa" as const,
    key: "qa",
    icon: HelpCircle,
    labelPl: "Q&A",
    labelEn: "Q&A",
    exact: false,
  },
];

export function CommunitySubNav() {
  const { i18n } = useTranslation();
  const isPl = (i18n.language ?? "pl").startsWith("pl");
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <div className="sticky top-0 z-30 -mx-4 md:-mx-6 px-4 md:px-6 py-3 bg-background/95 backdrop-blur border-b border-border">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 pr-3 mr-1 border-r border-border/60">
          <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center">
            <Users2 className="w-4 h-4 text-primary" />
          </div>
          <h1 className="font-display text-base sm:text-lg leading-none">
            {isPl ? "Społeczność" : "Community"}
          </h1>
        </div>
        <nav
          className="flex items-center gap-1 p-1 rounded-lg bg-muted/60 border border-border/60"
          aria-label={isPl ? "Sekcje społeczności" : "Community sections"}
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
                {isPl ? tab.labelPl : tab.labelEn}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
