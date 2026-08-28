import { Link, useLocation } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { useMyOrganization } from "@/lib/billing/membership";
import {
  BellRing,
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
  Receipt,
  RefreshCw,
  Shield,
  Ticket,
  Lock,
  MessageSquareQuote,
} from "lucide-react";
import type { ComponentType, ReactNode } from "react";

type NavKey =
  | "overview"
  | "edit"
  | "interests"
  | "personality"
  | "bookmarks"
  | "notifications"
  | "notificationSettings"
  | "follows"
  | "network"
  | "membership"
  | "plan"
  | "organization"
  | "billing"
  | "payments"
  | "tickets"
  | "security"
  | "privacy"
  | "expertRequests";

type NavItem = {
  to: string;
  key: NavKey;
  search?: Record<string, string>;
  icon: ComponentType<{ className?: string }>;
};

// 13 pozycji w płaskiej liście przytłaczało (audyt IA profilu) - nawigacja
// jest pogrupowana w nazwane sekcje. Konsolidacja tożsamości (ocena modułów
// 2026-07-20): trzy dawne pozycje edycji (account/author/social) to teraz
// JEDNA strona z zakładkami.
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
  { to: "/profile/expert-requests", key: "expertRequests", icon: MessageSquareQuote },
];

// FINANSE - cztery pozycje zamiast sześciu (§11 audytu IA). Dwie z dawnej listy
// były osobnymi wejściami do tej samej treści i zostały przekierowane:
//   * „Subskrypcja" (/profile/subscription) renderowała wyłącznie
//     SubscriptionManagerSection - komponent, który i tak jest częścią huba
//     członkostwa; jego pełniejszy odpowiednik to „Plan i subskrypcja",
//   * „Zamówienia" (/profile/orders) i „Historia płatności" (/profile/payments)
//     to były dwie listy tych samych transakcji, obie z InvoiceLookupCard.
// Użytkownik nie musi już zgadywać, czy faktury są pod „Zamówieniami", czy pod
// „Historią płatności" - jest jedno miejsce: „Płatności i faktury".
const FINANCE: NavItem[] = [
  { to: "/profile/membership", key: "membership", icon: Crown },
  { to: "/profile/plan", key: "plan", icon: RefreshCw },
  { to: "/profile/payments", key: "payments", icon: Receipt },
  // „Moje zgłoszenia" stoi w finansach, bo o zgłoszeniu na wydarzenie
  // rozstrzyga wynik płatności - to tu użytkownik szuka odpowiedzi „dlaczego
  // anulowano" i „gdzie mój zwrot".
  { to: "/profile/tickets", key: "tickets", icon: Ticket },
  { to: "/profile/billing", key: "billing", icon: FileText },
];

// PRYWATNOŚĆ I BEZPIECZEŃSTWO - własna grupa (§10 audytu IA). Do 06.08 obie
// pozycje wisiały w grupie nazwanej „Płatności i bezpieczeństwo": ustawienia
// prywatności i kasowanie konta stały pod nagłówkiem o płatnościach, a same
// przełączniki widoczności mieszkały w formularzu edycji profilu.
const PRIVACY: NavItem[] = [
  { to: "/profile/privacy", key: "privacy", icon: Lock },
  // Ustawienia powiadomien stoja TUTAJ, a nie przy pozycji „Powiadomienia"
  // (ktora prowadzi do skrzynki), bo uzytkownik szukajacy „jak wylaczyc te
  // maile" idzie do ustawien konta, nie do listy powiadomien. Do 12.08 ta
  // strona nie istniala i cala zakladka preferencji byla nieosiagalna -
  // patrz nota w src/routes/profile.notifications.tsx.
  { to: "/profile/notifications", key: "notificationSettings", icon: BellRing },
  { to: "/profile/security", key: "security", icon: Shield },
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
  collapsed?: boolean;
  children: ReactNode;
};

function NavGroup({ titleKey, icon: Icon, collapsed = false, children }: NavGroupProps) {
  const { t } = useTranslation();
  if (collapsed) {
    return (
      <div
        className="flex flex-col items-center gap-0.5 rounded-lg border border-border bg-background/60 p-1.5 shadow-sm"
        aria-label={t(titleKey)}
      >
        {children}
      </div>
    );
  }
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

export function ProfileNav({ collapsed = false }: { collapsed?: boolean }) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const myOrg = useMyOrganization();

  const isActive = (to: string) =>
    pathname === to || (to !== "/profile" && pathname.startsWith(to));

  const renderItem = (item: NavItem) => {
    const active = isActive(item.to);
    const Icon = item.icon;
    const label = t(`profile.nav.${item.key}`);
    return (
      <Link
        key={item.to}
        to={item.to}
        {...(item.search ? { search: item.search } : {})}
        aria-current={active ? "page" : undefined}
        title={collapsed ? label : undefined}
        aria-label={collapsed ? label : undefined}
        className={cn(
          "group relative flex items-center rounded-[6px] text-sm font-medium transition-all",
          collapsed ? "h-9 w-9 justify-center" : "gap-2.5 px-2.5 py-2",
          active
            ? "bg-primary/10 text-foreground font-semibold shadow-sm ring-1 ring-primary/20"
            : "text-muted-foreground hover:bg-muted hover:text-foreground",
        )}
      >
        {!collapsed && (
          <span
            aria-hidden
            className={cn(
              "absolute left-0 top-1/2 -translate-y-1/2 w-0.5 rounded-full bg-primary transition-all duration-200",
              active ? "h-5 opacity-100" : "h-0 opacity-0 group-hover:h-3 group-hover:opacity-60",
            )}
          />
        )}
        <Icon
          className={cn(
            "h-4 w-4 shrink-0 transition-colors",
            active ? "text-primary" : "text-muted-foreground group-hover:text-foreground",
          )}
        />
        {!collapsed && <span className="truncate">{label}</span>}
      </Link>
    );
  };

  const financeItems = myOrg.data ? [FINANCE[0], ORGANIZATION_ITEM, ...FINANCE.slice(1)] : FINANCE;

  return (
    <nav
      className={cn("flex flex-col gap-3", collapsed && "items-center gap-2")}
      aria-label={t("profile.title")}
    >
      <NavGroup titleKey="profile.navGroups.identity" icon={UserCircle} collapsed={collapsed}>
        {IDENTITY.map(renderItem)}
      </NavGroup>

      <NavGroup titleKey="profile.navGroups.content" icon={Heart} collapsed={collapsed}>
        {CONTENT.map(renderItem)}
      </NavGroup>

      <NavGroup titleKey="profile.navGroups.finance" icon={CreditCard} collapsed={collapsed}>
        {financeItems.map(renderItem)}
      </NavGroup>

      <NavGroup titleKey="profile.navGroups.privacy" icon={Lock} collapsed={collapsed}>
        {PRIVACY.map(renderItem)}
      </NavGroup>
    </nav>
  );
}
