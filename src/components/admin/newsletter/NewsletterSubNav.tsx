// Sticky segmented sub-nav dla modulu /admin/newsletter.
// Uzywa TanStack Link z activeProps zeby zaznaczyc aktywna zakladke i
// pokazuje wskaznik "unsaved" (globalny store `unsavedChanges`) na zakladkach
// builderow.
import { Link, useRouterState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ensureI18n as ensureNewsletterAdminI18n } from "@/lib/i18n-newsletter-admin";
import {
  FileText,
  LayoutDashboard,
  Mail,
  MailCheck,
  MailOpen,
  ScrollText,
  Send,
  ShieldCheck,
  Users,
  Megaphone,
} from "lucide-react";

const tabs = [
  {
    to: "/admin/newsletter/overview",
    key: "overview",
    icon: LayoutDashboard,
    labelKey: "adminNewsletter.nav.overview",
  },
  {
    to: "/admin/newsletter/inline",
    key: "inline",
    icon: Mail,
    labelKey: "adminNewsletter.nav.inline",
  },
  {
    to: "/admin/newsletter/popup",
    key: "popup",
    icon: Send,
    labelKey: "adminNewsletter.nav.popup",
  },
  {
    to: "/admin/newsletter/campaigns",
    key: "campaigns",
    icon: Megaphone,
    labelKey: "adminNewsletter.nav.campaigns",
  },
  {
    to: "/admin/newsletter/subscribers",
    key: "subscribers",
    icon: Users,
    labelKey: "adminNewsletter.nav.subscribers",
  },
  {
    to: "/admin/newsletter/deliverability",
    key: "deliverability",
    icon: ShieldCheck,
    labelKey: "adminNewsletter.nav.deliverability",
  },
  {
    to: "/admin/newsletter/system-emails",
    key: "system-emails",
    icon: MailCheck,
    labelKey: "adminNewsletter.nav.systemEmails",
  },
  {
    to: "/admin/newsletter/auth-logs",
    key: "auth-logs",
    icon: ScrollText,
    labelKey: "adminNewsletter.nav.authLogs",
  },
  {
    to: "/admin/newsletter/email-content",
    key: "email-content",
    icon: FileText,
    labelKey: "adminNewsletter.nav.emailContent",
  },
  {
    to: "/admin/newsletter/email-preview",
    key: "email-preview",
    icon: MailOpen,
    labelKey: "adminNewsletter.nav.emailPreview",
  },
] as const;

export function NewsletterSubNav() {
  ensureNewsletterAdminI18n();
  const { t } = useTranslation();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <div className="sticky top-0 z-30 -mx-4 md:-mx-6 px-4 md:px-6 py-3 bg-background/95 backdrop-blur border-b border-border">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 pr-3 mr-1 border-r border-border/60">
          <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center">
            <Mail className="w-4 h-4 text-primary" />
          </div>
          <h1 className="font-display text-base sm:text-lg leading-none">
            {t("adminNewsletter.nav.sectionTitle")}
          </h1>
        </div>
        <nav
          className="flex items-center gap-1 p-1 rounded-lg bg-muted/60 border border-border/60"
          aria-label={t("adminNewsletter.nav.sectionsNavLabel")}
        >
          {tabs.map((tab) => {
            const active = pathname.startsWith(tab.to);
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
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
