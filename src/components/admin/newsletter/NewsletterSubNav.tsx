// Sticky segmented sub-nav dla modulu /admin/newsletter.
// Uzywa TanStack Link z activeProps zeby zaznaczyc aktywna zakladke i
// pokazuje wskaznik "unsaved" (globalny store `unsavedChanges`) na zakladkach
// builderow.
import { Link, useRouterState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { LayoutDashboard, Mail, Send, Users, Megaphone } from "lucide-react";

const tabs = [
  {
    to: "/admin/newsletter/overview",
    key: "overview",
    icon: LayoutDashboard,
    labelPl: "Podsumowanie",
    labelEn: "Overview",
  },
  {
    to: "/admin/newsletter/inline",
    key: "inline",
    icon: Mail,
    labelPl: "Inline builder",
    labelEn: "Inline builder",
  },
  {
    to: "/admin/newsletter/popup",
    key: "popup",
    icon: Send,
    labelPl: "Popup builder",
    labelEn: "Popup builder",
  },
  {
    to: "/admin/newsletter/campaigns",
    key: "campaigns",
    icon: Megaphone,
    labelPl: "Kampanie",
    labelEn: "Campaigns",
  },
  {
    to: "/admin/newsletter/subscribers",
    key: "subscribers",
    icon: Users,
    labelPl: "Subskrybenci",
    labelEn: "Subscribers",
  },
] as const;


export function NewsletterSubNav() {
  const { i18n } = useTranslation();
  const isPl = (i18n.language ?? "pl").startsWith("pl");
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <div className="sticky top-0 z-30 -mx-4 md:-mx-6 px-4 md:px-6 py-3 bg-background/95 backdrop-blur border-b border-border">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 pr-3 mr-1 border-r border-border/60">
          <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center">
            <Mail className="w-4 h-4 text-primary" />
          </div>
          <h1 className="font-display text-base sm:text-lg leading-none">Newsletter</h1>
        </div>
        <nav className="flex items-center gap-1 p-1 rounded-lg bg-muted/60 border border-border/60">
          {tabs.map((t) => {
            const active = pathname.startsWith(t.to);
            const Icon = t.icon;
            return (
              <Link
                key={t.key}
                to={t.to}
                className={
                  "flex items-center gap-2 px-3 py-1.5 rounded-md text-xs sm:text-sm font-medium transition-colors " +
                  (active
                    ? "bg-background shadow-sm text-foreground"
                    : "text-muted-foreground hover:text-foreground")
                }
              >
                <Icon className="w-3.5 h-3.5" />
                {isPl ? t.labelPl : t.labelEn}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
