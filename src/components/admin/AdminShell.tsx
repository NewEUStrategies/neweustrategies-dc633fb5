import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
import {
  LayoutDashboard,
  FileText,
  File,
  FolderTree,
  Tags,
  Users,
  Image as ImageIcon,
  LogOut,
  Home,
  Moon,
  Sun,
  Globe,
  Settings,
  PanelLeft,
  Star,
  Mail,
  Bookmark,
  ChevronRight,
  Lock,
  Palette,
  LayoutGrid,
  Shapes,
  PanelsTopLeft,
  Smartphone,
  Newspaper,
  Megaphone,
  Mic,
  Film,
  Brush,
  Wand2,
  Share2,
  Gauge,
  MousePointerClick,
  Clock as HistoryIcon,
  Globe2,
  FlaskConical,
  Link as LinkIcon,
  Search,
  ExternalLink,
} from "@/lib/lucide-shim";
import {
  BadgePercent,
  BookOpen,
  Briefcase,
  Cable,
  Clock,
  CreditCard,
  Crown,
  Gift,
  HandHeart,
  Inbox,
  Landmark,
  ListChecks,
  MessageCircle,
  MessagesSquare,
  Radio,
  ShieldCheck,
  TrendingUp,
  Workflow,
} from "lucide-react";
import { useTheme } from "@/components/ThemeProvider";
import { AdminLangBar } from "@/components/admin/AdminLangBar";
import { useState, type ReactNode } from "react";
import {
  AdminSidebarExtrasProvider,
  useAdminSidebarExtrasSlot,
} from "@/components/admin/AdminSidebarExtras";
import { useSiteSetting } from "@/lib/useSiteSetting";
import { useClubPendingCounts } from "@/lib/clubs/useClubs";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

import type { SidebarStyle } from "@/lib/builder/sidebarStyles";

type SidebarLogoCfg = {
  logo: {
    sidebar_icon: string;
    sidebar_icon_dark: string;
    sidebar_expanded: string;
    sidebar_expanded_dark: string;
    main: string;
    main_dark: string;
  };
  sidebars?: { style?: SidebarStyle };
};
const SIDEBAR_LOGO_DEFAULTS: SidebarLogoCfg = {
  logo: {
    sidebar_icon: "",
    sidebar_icon_dark: "",
    sidebar_expanded: "",
    sidebar_expanded_dark: "",
    main: "",
    main_dark: "",
  },
  sidebars: { style: "style-1" },
};

type SidebarRowButtonProps = {
  icon?: React.ComponentType<{ className?: string }>;
  label: ReactNode;
  title?: string;
  compact?: boolean;
  tone?: "default" | "destructive" | "accent";
  active?: boolean;
  onClick: () => void;
};

// One shared row style for every icon+label action button in the sidebar
// footer/extras list (theme toggle, language toggle, sign-out, extras items),
// so the density/typography stays in one place instead of four near-identical
// hand-rolled <button> blocks.
export function SidebarRowButton({
  icon: Icon,
  label,
  title,
  compact,
  tone = "default",
  active = false,
  onClick,
}: SidebarRowButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={compact ? undefined : title}
      data-sidebar="menu-button"
      className={cn(
        "w-full flex items-center py-1 rounded-md text-[13px] text-left transition",
        compact ? "justify-center px-0" : "gap-1.5 px-2",
        tone === "destructive" && "text-destructive hover:bg-destructive/10",
        tone === "accent" &&
          (active
            ? "border-l-2 border-brand bg-brand/10 text-brand font-medium"
            : "border-l-2 border-transparent hover:bg-muted text-foreground"),
        tone === "default" && "text-muted-foreground hover:bg-muted",
      )}
    >
      {Icon && <Icon className="w-3 h-3 shrink-0" />}
      <span className={cn("truncate", tone === "accent" && "flex-1", compact && "hidden")}>
        {label}
      </span>
      {tone === "accent" && active && <ChevronRight className="w-3 h-3" />}
    </button>
  );
}

type SidebarExternalNavLinkProps = Omit<
  React.ComponentPropsWithRef<"a">,
  "target" | "rel" | "children"
> & {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  /** Dopisek dostępności: link opuszcza panel i otwiera się w nowej karcie. */
  hint: string;
  compact?: boolean;
};

// Pozycja nawigacji prowadząca do usługi ZEWNĘTRZNEJ - ten sam rytm wiersza co
// wewnętrzne <Link>, ale zawsze nowa karta z rel="noopener noreferrer" i glifem
// "external", żeby wyjście z panelu było odróżnialne od tras wewnętrznych.
// Przykład: Darowizny - zbiórka żyje na zrzutka.pl. To decyzja produktowa
// (prowadzimy ją poza operatorem płatności), nie ograniczenie operatora,
// więc panel nie ma wewnętrznego widoku.
// Spread ...rest przepuszcza propsy wstrzykiwane przez Radix Slot (tooltip
// w trybie compact) oraz ref (React 19: ref przychodzi w propsach).
export function SidebarExternalNavLink({
  href,
  icon: Icon,
  label,
  hint,
  compact = false,
  className,
  title,
  ...rest
}: SidebarExternalNavLinkProps) {
  return (
    <a
      {...rest}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={title ?? (compact ? undefined : `${label} - ${hint}`)}
      data-sidebar="menu-button"
      data-external-link="true"
      className={cn(
        "flex items-center py-1 rounded-md text-[13px] leading-tight transition text-foreground hover:bg-muted",
        compact ? "justify-center px-0" : "gap-1.5 px-2",
        className,
      )}
    >
      <Icon className="w-3 h-3 shrink-0" />
      <span className={cn("min-w-0 flex-1 truncate", compact && "hidden")}>{label}</span>
      <ExternalLink
        className={cn("w-3 h-3 shrink-0 opacity-60", compact && "hidden")}
        aria-hidden="true"
      />
      <span className="sr-only">{hint}</span>
    </a>
  );
}

function SidebarTooltip({
  label,
  compact,
  children,
}: {
  label: ReactNode;
  compact: boolean;
  children: React.ReactElement;
}) {
  if (!compact) return children;
  return (
    <Tooltip delayDuration={0}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

export function AdminShell({
  children,
  hideSidebar,
}: {
  children: ReactNode;
  hideSidebar?: boolean;
}) {
  return (
    <AdminSidebarExtrasProvider>
      <AdminShellInner hideSidebar={hideSidebar}>{children}</AdminShellInner>
    </AdminSidebarExtrasProvider>
  );
}

function AdminShellInner({
  children,
  hideSidebar,
}: {
  children: ReactNode;
  hideSidebar?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const { signOut, isAdmin, isSuperAdmin } = useAuth();
  // Licznik kolejek klubów (premoderacja + prośby o dostęp) na skrócie w menu.
  const clubCounts = useClubPendingCounts(isAdmin);
  const clubPending =
    (clubCounts.data?.moderationPending ?? 0) + (clubCounts.data?.joinRequests ?? 0);
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const lang = i18n.language ?? "pl";
  const { extras } = useAdminSidebarExtrasSlot();
  const themeOpts = useSiteSetting<SidebarLogoCfg>("theme_options", SIDEBAR_LOGO_DEFAULTS);
  const sidebarStyle = themeOpts.sidebars?.style ?? "style-1";

  const isEditRoute =
    /^\/admin\/(posts|pages)\/[^/]+$/.test(path) || path.startsWith("/admin/appearance");
  const isThemeOptions = path.startsWith("/admin/theme-options");
  const [forceCompact, setForceCompact] = useState(false);
  const compact = ((isEditRoute || forceCompact) && !extras) || sidebarStyle === "style-4";

  type NavIcon = typeof LayoutDashboard;
  // Dwa rodzaje pozycji: wewnętrzna trasa panelu (`to`, TanStack <Link>) oraz
  // usługa zewnętrzna (`href`, nowa karta przez SidebarExternalNavLink) - np.
  // Darowizny, których zbiórka żyje na zrzutka.pl i nie ma trasy w panelu.
  type NavItem =
    | { to: string; icon: NavIcon; label: string; badge?: number }
    | { href: string; icon: NavIcon; label: string };
  type NavGroup = { id: string; label?: string; items: NavItem[] };

  const groups: NavGroup[] = [
    {
      id: "overview",
      items: [{ to: "/admin", icon: LayoutDashboard, label: t("admin.nav.dashboard") }],
    },
    {
      id: "content",
      label: t("admin.navGroups.content"),
      items: [
        { to: "/admin/posts", icon: Newspaper, label: t("admin.nav.posts") },
        { to: "/admin/pages", icon: File, label: t("admin.nav.pages") },
        { to: "/admin/media", icon: ImageIcon, label: t("admin.nav.media") },
        { to: "/admin/categories", icon: FolderTree, label: t("admin.nav.categories") },
        {
          to: "/admin/category-colors",
          icon: Palette,
          label: t("admin.nav.categoryColors", {
            defaultValue: "Kolory kategorii",
          }),
        },
        { to: "/admin/tags", icon: Tags, label: t("admin.nav.tags") },
        {
          to: "/admin/glossary",
          icon: BookOpen,
          label: t("admin.nav.glossary", { defaultValue: "Słowniczek" }),
        },
        { to: "/admin/content-area", icon: FileText, label: t("admin.nav.contentArea") },
      ],
    },
    {
      id: "monetization",
      label: t("admin.navGroups.monetization"),
      items: [
        {
          to: "/admin/monetization",
          icon: TrendingUp,
          label: t("admin.nav.monetization", {
            defaultValue: lang === "pl" ? "Dashboard monetyzacji" : "Monetization",
          }),
        },
        { to: "/admin/paywall", icon: Lock, label: t("admin.nav.paywall") },
        {
          to: "/admin/gifting",
          icon: Gift,
          label: t("admin.nav.gifting", {
            defaultValue: lang === "pl" ? "Podaruj artykuł" : "Gift articles",
          }),
        },
        {
          to: "/admin/coupons",
          icon: Megaphone,
          label: t("admin.nav.coupons", {
            defaultValue: lang === "pl" ? "Kupony B2B" : "B2B coupons",
          }),
        },
        {
          to: "/admin/membership",
          icon: Crown,
          label: t("admin.nav.membership", {
            defaultValue: lang === "pl" ? "Członkostwo" : "Membership",
          }),
        },
        {
          to: "/admin/pricing",
          icon: BadgePercent,
          label: t("admin.nav.pricing", {
            defaultValue: lang === "pl" ? "Cennik i segmenty" : "Pricing & segments",
          }),
        },
        {
          to: "/admin/organizations",
          icon: Landmark,
          label: t("admin.nav.organizations", {
            defaultValue: lang === "pl" ? "Organizacje" : "Organisations",
          }),
        },
        {
          to: "/admin/library",
          icon: BookOpen,
          label: t("admin.nav.library", {
            defaultValue: lang === "pl" ? "Biblioteka" : "Library",
          }),
        },
        { to: "/admin/ads", icon: Megaphone, label: t("admin.nav.ads") },
        {
          to: "/admin/billing",
          icon: CreditCard,
          label: t("admin.nav.billing"),
        },
        {
          to: "/admin/billing-reconcile",
          icon: CreditCard,
          label: t("admin.nav.billingReconcile"),
        },
        {
          to: "/admin/donations",
          icon: HandHeart,
          label: t("admin.nav.donations", {
            defaultValue: lang === "pl" ? "Darowizny" : "Donations",
          }),
        },
      ],
    },
    {
      id: "engagement",
      label: t("admin.navGroups.engagement"),
      items: [
        { to: "/admin/newsletter", icon: Mail, label: t("admin.nav.newsletter") },
        {
          to: "/admin/popups",
          icon: MousePointerClick,
          label: t("admin.nav.popups", { defaultValue: lang === "pl" ? "Popupy" : "Popups" }),
        },
        {
          to: "/admin/settings/social-preview",
          icon: ImageIcon,
          label: t("admin.nav.socialPreview"),
        },
        {
          to: "/admin/settings/cookie-banner",
          icon: ShieldCheck,
          label: t("admin.nav.cookieBanner"),
        },
        {
          to: "/admin/versions",
          icon: HistoryIcon,
          label: t("admin.nav.versions"),
        },
        {
          to: "/admin/i18n",
          icon: Globe2,
          label: t("admin.nav.i18nAudit"),
        },
        {
          to: "/admin/experiments",
          icon: FlaskConical,
          label: t("admin.nav.experiments", {
            defaultValue: lang === "pl" ? "Testy A/B" : "A/B tests",
          }),
        },
        { to: "/admin/personalized", icon: Wand2, label: t("admin.nav.personalized") },
        { to: "/admin/related-posts", icon: Share2, label: t("admin.nav.relatedPosts") },
        {
          to: "/admin/crm",
          icon: Users,
          label: t("admin.nav.crm", {
            defaultValue: lang === "pl" ? "Kontakty CRM" : "CRM Contacts",
          }),
        },
        {
          to: "/admin/crm/funnel",
          icon: Mail,
          label: t("admin.nav.crmFunnel", {
            defaultValue: lang === "pl" ? "CRM - Lejek marketingowy" : "CRM - Marketing funnel",
          }),
        },
        {
          to: "/admin/companies",
          icon: Users,
          label: t("admin.nav.companies", {
            defaultValue: lang === "pl" ? "Firmy CRM" : "CRM companies",
          }),
        },
        {
          to: "/admin/workflows",
          icon: Workflow,
          label: t("admin.nav.workflows", {
            defaultValue: lang === "pl" ? "Automatyzacje" : "Automations",
          }),
        },
        {
          to: "/admin/integrations",
          icon: Cable,
          label: t("admin.nav.integrations", {
            defaultValue: lang === "pl" ? "Integracje" : "Integrations",
          }),
        },
      ],
    },
    {
      id: "community",
      label: t("admin.navGroups.community"),
      items: [
        {
          to: "/admin/contact",
          icon: Inbox,
          label: t("admin.nav.contact", {
            defaultValue: lang === "pl" ? "Centrum kontaktu" : "Contact center",
          }),
        },
        {
          // Zgłoszenia rekrutacyjne ze strony /zatrudniamy (Contact Center +
          // CRM), z własną skrzynką zamiast mieszania ich z kontaktem ogólnym.
          to: "/admin/careers",
          icon: Briefcase,
          label: t("admin.nav.careers"),
        },
        {
          to: "/admin/community",
          icon: Users,
          label: t("admin.nav.community", {
            defaultValue: lang === "pl" ? "Społeczność" : "Community",
          }),
        },
        {
          // Skrót wprost do zarządzania klubami dyskusyjnymi - bez niego trzeba
          // było przejść przez /admin/community i dopiero tam wybrać zakładkę.
          to: "/admin/community/clubs",
          icon: MessagesSquare,
          label: t("admin.nav.clubs"),
          badge: clubPending,
        },
        {
          // Katalog elementów Klubu - słowniki, odznaki, macierz uprawnień
          // i kody odmów bez wchodzenia w konkretny klub. Od przeniesienia do
          // panelu trasa jest administracyjna; /club/elements przekierowuje.
          to: "/admin/community/clubs/elements",
          icon: Shapes,
          label: t("admin.nav.clubElements"),
        },
        {
          // Taksonomia obszarów tematycznych jest wspólna dla całej
          // organizacji, więc mieszka obok klubów, nie w konkretnym klubie.
          to: "/admin/community/clubs/topics",
          icon: Shapes,
          label: t("admin.nav.clubTopics"),
        },
        {
          // Skrzynka zgloszen do klubow - decyzje zapadaja przekrojowo,
          // dlatego stoi obok taksonomii, a nie w karcie pojedynczego klubu.
          to: "/admin/community/clubs/applications",
          icon: Inbox,
          label: t("admin.nav.clubApplications"),
        },

        {
          // Specjalizacje sa najwyzszym poziomem taksonomii i maja wlasne
          // strony publiczne, wiec stoja obok obszarow tematycznych.
          to: "/admin/community/clubs/specializations",
          icon: Shapes,
          label: t("admin.nav.clubSpecializations"),
        },

        {
          to: "/admin/comments",
          icon: MessageCircle,
          label: t("admin.nav.comments", {
            defaultValue: lang === "pl" ? "Komentarze" : "Comments",
          }),
        },
        {
          to: "/admin/expert-requests",
          icon: Inbox,
          label: t("admin.nav.expertRequests"),
        },
        {
          to: "/admin/tracker",
          icon: Landmark,
          label: t("admin.nav.tracker", {
            defaultValue: lang === "pl" ? "Tracker UE" : "EU tracker",
          }),
        },
        { to: "/admin/podcasts", icon: Mic, label: t("admin.nav.podcasts") },
        {
          to: "/admin/research-programs",
          icon: FlaskConical,
          label: t("admin.nav.researchPrograms", {
            defaultValue: lang === "pl" ? "Programy - landing" : "Program landings",
          }),
        },
        {
          to: "/admin/programs",
          icon: FlaskConical,
          label: t("admin.nav.programs", {
            defaultValue: lang === "pl" ? "Programy - tagowanie" : "Program tags",
          }),
        },
        {
          to: "/admin/live-blog",
          icon: Radio,
          label: t("admin.nav.liveBlog", {
            defaultValue: "Live blog",
          }),
        },
        { to: "/admin/web-stories", icon: Film, label: t("admin.nav.webStories") },
      ],
    },
    {
      id: "design",
      label: t("admin.navGroups.design"),
      items: [
        { to: "/admin/appearance", icon: PanelsTopLeft, label: t("admin.nav.appearance") },
        {
          to: "/admin/appearance/category-archive",
          icon: FolderTree,
          label: t("archiveLayout.categoryTab", {
            defaultValue: lang === "pl" ? "Layout kategorii" : "Category layout",
          }),
        },
        {
          to: "/admin/appearance/tag-archive",
          icon: Tags,
          label: t("archiveLayout.tagTab", {
            defaultValue: lang === "pl" ? "Layout tagów" : "Tag layout",
          }),
        },
        { to: "/admin/theme-options", icon: Palette, label: t("admin.nav.themeOptions") },
        {
          to: "/admin/settings/mobile-bottom-bar",
          icon: Smartphone,
          label: t("admin.nav.mobileBottomBar"),
        },
        { to: "/admin/post-layouts", icon: LayoutGrid, label: t("admin.nav.postLayouts") },
        { to: "/admin/expert-layouts", icon: Users, label: t("admin.nav.expertLayouts") },
        {
          to: "/admin/key-takeaways",
          icon: ListChecks,
          label: t("admin.nav.keyTakeaways", {
            defaultValue: lang === "pl" ? "Sekcja „Dowiesz się…”" : "Key takeaways",
          }),
        },
        {
          to: "/admin/toc",
          icon: ListChecks,
          label: t("admin.nav.toc", {
            defaultValue: lang === "pl" ? "Spis treści (ToC)" : "Table of contents",
          }),
        },
        {
          to: "/admin/reading-time",
          icon: Clock,
          label: t("admin.nav.readingTime", {
            defaultValue: lang === "pl" ? "Czas czytania" : "Reading time",
          }),
        },
        { to: "/admin/icons", icon: Shapes, label: t("admin.nav.icons") },
        ...(isSuperAdmin ? [{ to: "/admin/names", icon: Users, label: t("admin.nav.names") }] : []),
        ...(isSuperAdmin
          ? [
              {
                to: "/admin/super/mobile-drawer",
                icon: PanelLeft,
                label: t("admin.nav.mobileDrawer", {
                  defaultValue: lang === "pl" ? "Mobilne menu" : "Mobile menu",
                }),
              },
            ]
          : []),
        ...(isAdmin
          ? [
              {
                to: "/admin/greetings",
                icon: MessageCircle,
                label: t("admin.nav.greetings", {
                  defaultValue: lang === "pl" ? "Powitania" : "Greetings",
                }),
              },
            ]
          : []),
      ],
    },
    ...(isAdmin
      ? [
          {
            id: "system",
            label: t("admin.navGroups.system"),
            items: [
              { to: "/admin/performance", icon: Gauge, label: t("admin.nav.performance") },
              {
                to: "/admin/analytics",
                icon: TrendingUp,
                label: t("admin.nav.analytics", {
                  defaultValue: lang === "pl" ? "Analityka (GA4 / GSC)" : "Analytics (GA4 / GSC)",
                }),
              },
              {
                to: "/admin/audience",
                icon: TrendingUp,
                label: t("admin.nav.audience", {
                  defaultValue: lang === "pl" ? "Audytorium / retencja" : "Audience / retention",
                }),
              },
              {
                to: "/admin/seo",
                icon: Search,
                label: t("admin.nav.seo", { defaultValue: "SEO" }),
              },
              {
                to: "/admin/redirects",
                icon: LinkIcon,
                label: t("admin.nav.redirects", {
                  defaultValue: lang === "pl" ? "Przekierowania" : "Redirects",
                }),
              },
              { to: "/admin/users", icon: Users, label: t("admin.nav.users") },
              {
                to: "/admin/authors",
                icon: Users,
                label: t("admin.nav.authors", {
                  defaultValue: lang === "pl" ? "Autorzy" : "Authors",
                }),
              },
              {
                to: "/admin/permissions",
                icon: ShieldCheck,
                label: t("admin.nav.permissions", {
                  // Strona opisuje role ORAZ warstwy członkostwa (macierz
                  // generowana z bramek SQL), więc etykieta nie zawęża jej do ról.
                  defaultValue: lang === "pl" ? "Macierz uprawnień" : "Permissions matrix",
                }),
              },
              {
                to: "/admin/programs",
                icon: Briefcase,
                label: t("admin.nav.programs", {
                  defaultValue: lang === "pl" ? "Programy" : "Programs",
                }),
              },
              ...(isSuperAdmin
                ? [
                    {
                      to: "/admin/login-settings",
                      icon: Lock,
                      label: t("admin.nav.loginSettings", {
                        defaultValue: lang === "pl" ? "Strona logowania" : "Login page",
                      }),
                    },
                  ]
                : []),
              { to: "/admin/settings", icon: Settings, label: t("admin.nav.settings") },
            ],
          },
        ]
      : []),
  ];
  void Star;
  void Bookmark;
  void Brush;

  const handleSignOut = async () => {
    await signOut();
    navigate({ to: "/login" });
  };

  return (
    <div className={`admin-compact min-h-screen bg-muted/30 ${hideSidebar ? "" : "flex"}`}>
      {hideSidebar && <AdminLangBar />}
      {!hideSidebar && (
        <aside
          data-sidebar="sidebar"
          data-sidebar-style={sidebarStyle}
          style={{ viewTransitionName: "admin-sidebar" }}
          className={cn(
            compact ? "w-12" : "w-56",
            "bg-card border-r border-border flex flex-col transition-all duration-200 sticky top-0 self-start h-screen max-h-screen sidebar-shell",
          )}
        >
          <TooltipProvider delayDuration={0}>
            <div className="p-3 border-b border-border">
              <div className={`flex items-center ${compact ? "justify-center" : "gap-2"}`}>
                <SidebarTooltip
                  label={t("admin.nav.dashboard", { defaultValue: "Kokpit" })}
                  compact={compact}
                >
                  <Link
                    to="/admin"
                    data-sidebar-brand
                    title={
                      compact ? undefined : t("admin.nav.dashboard", { defaultValue: "Kokpit" })
                    }
                    className={`font-display font-bold text-sm flex items-center justify-center min-w-0 ${compact ? "" : "flex-1"} bg-transparent hover:bg-transparent`}
                    style={{ background: "transparent" }}
                  >
                    <SidebarBrand compact={compact} />
                  </Link>
                </SidebarTooltip>
                {!compact && (
                  <button
                    onClick={() => setForceCompact((s) => !s)}
                    data-sidebar-toggle
                    className="ml-auto text-muted-foreground hover:text-foreground shrink-0 bg-transparent hover:bg-transparent"
                    title={t("admin.sidebar.collapse")}
                  >
                    <PanelLeft className="w-4 h-4 rotate-180 transition-transform" />
                  </button>
                )}
              </div>
              {compact && (
                <SidebarTooltip label={t("admin.sidebar.expand")} compact={compact}>
                  <button
                    onClick={() => setForceCompact((s) => !s)}
                    data-sidebar-toggle
                    className="mt-2 mx-auto flex text-muted-foreground hover:text-foreground bg-transparent hover:bg-transparent"
                  >
                    <PanelLeft className="w-4 h-4" />
                  </button>
                </SidebarTooltip>
              )}
            </div>
            <nav className="flex-1 p-2 space-y-3 overflow-y-auto">
              {groups.map((group, idx) => (
                <div key={group.id} className={idx > 0 ? "pt-2 border-t border-border/60" : ""}>
                  {group.label && !compact && (
                    <div
                      data-sidebar="group-label"
                      className="px-2 pt-1 pb-0 text-[11px] uppercase tracking-wider text-muted-foreground font-semibold"
                    >
                      {group.label}
                    </div>
                  )}
                  <div className="space-y-0.5">
                    {group.items.map((item) => {
                      const { icon: Icon, label } = item;
                      if ("href" in item) {
                        return (
                          <SidebarTooltip key={item.href} label={label} compact={compact}>
                            <SidebarExternalNavLink
                              href={item.href}
                              icon={Icon}
                              label={label}
                              hint={t("admin.nav.externalNewTab", {
                                defaultValue:
                                  lang === "pl"
                                    ? "Otwiera się w nowej karcie"
                                    : "Opens in a new tab",
                              })}
                              compact={compact}
                            />
                          </SidebarTooltip>
                        );
                      }
                      const { to } = item;
                      const isCrmContacts = to === "/admin/crm";

                      const active =
                        path === to ||
                        (to !== "/admin" &&
                          to !== "/admin/appearance" &&
                          // Skrót do klubów ma własną pozycję, więc "Społeczność"
                          // nie może się podświetlać razem z nim.
                          !(
                            to === "/admin/community" && path.startsWith("/admin/community/clubs")
                          ) &&
                          !isCrmContacts &&
                          path.startsWith(`${to}/`));

                      // Kontakty CRM powinny być podświetlone tylko na /admin/crm
                      // i szczegółach kontaktu (/admin/crm/$id), ale NIE gdy użytkownik
                      // znajduje się w lejku lub firmach CRM.
                      const crmContactsActive =
                        isCrmContacts &&
                        (path === "/admin/crm" ||
                          /^\/admin\/crm\/(?!funnel|companies)[^/]+/.test(path));

                      const finalActive = active || crmContactsActive;

                      return (
                        <SidebarTooltip key={to} label={label} compact={compact}>
                          <Link
                            to={to}
                            activeOptions={{ exact: true }}
                            title={compact ? undefined : label}
                            data-sidebar="menu-button"
                            data-active={finalActive ? "true" : "false"}
                            className={`flex items-center py-1 rounded-md text-[13px] leading-tight transition ${
                              compact ? "justify-center px-0" : "gap-1.5 px-2"
                            } ${
                              finalActive
                                ? "bg-brand text-brand-foreground"
                                : "text-foreground hover:bg-muted"
                            }`}
                          >
                            <Icon className="w-3 h-3 shrink-0" />
                            <span className={`truncate ${compact ? "hidden" : ""}`}>{label}</span>
                            {typeof item.badge === "number" && item.badge > 0 && !compact ? (
                              <span
                                className="ml-auto inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500/20 px-1 text-[10px] font-semibold tabular-nums text-amber-700 dark:text-amber-300"
                                aria-label={t("admin.nav.pendingItems")}
                              >
                                {item.badge > 99 ? "99+" : item.badge}
                              </span>
                            ) : null}
                          </Link>
                        </SidebarTooltip>
                      );
                    })}
                  </div>
                </div>
              ))}

              {extras && !compact && (
                <div className="mt-4 pt-3 border-t border-border space-y-0.5">
                  {extras.title && (
                    <div
                      data-sidebar="group-label"
                      className="px-2 pb-1 text-[11px] uppercase tracking-wider text-muted-foreground font-semibold"
                    >
                      {extras.title}
                    </div>
                  )}
                  {extras.items.map((it) => (
                    <SidebarRowButton
                      key={it.id}
                      icon={it.icon}
                      label={it.label}
                      compact={compact}
                      tone="accent"
                      active={extras.activeId === it.id}
                      onClick={() => extras.onSelect(it.id)}
                    />
                  ))}
                </div>
              )}
            </nav>

            <div className="p-2 border-t border-border space-y-0.5">
              <SidebarTooltip label={t("admin.viewSite")} compact={compact}>
                <Link
                  to="/"
                  title={compact ? undefined : t("admin.viewSite")}
                  data-sidebar="menu-button"
                  className={`flex items-center py-1 rounded-md text-[13px] text-muted-foreground hover:bg-muted ${compact ? "justify-center px-0" : "gap-1.5 px-2"}`}
                >
                  <Home className="w-3 h-3 shrink-0" />
                  <span className={compact ? "hidden" : ""}>{t("admin.viewSite")}</span>
                </Link>
              </SidebarTooltip>
              <SidebarTooltip label={t("admin.theme")} compact={compact}>
                <SidebarRowButton
                  icon={theme === "dark" ? Sun : Moon}
                  label={t("admin.theme")}
                  title={t("admin.theme")}
                  compact={compact}
                  onClick={toggle}
                />
              </SidebarTooltip>
              <SidebarTooltip label={lang.startsWith("pl") ? "PL" : "EN"} compact={compact}>
                <SidebarRowButton
                  icon={Globe}
                  label={lang.startsWith("pl") ? "PL" : "EN"}
                  title={lang.startsWith("pl") ? "PL" : "EN"}
                  compact={compact}
                  onClick={() => i18n.changeLanguage(lang.startsWith("pl") ? "en" : "pl")}
                />
              </SidebarTooltip>
              <SidebarTooltip label={t("admin.signout")} compact={compact}>
                <SidebarRowButton
                  icon={LogOut}
                  label={t("admin.signout")}
                  title={t("admin.signout")}
                  compact={compact}
                  tone="destructive"
                  onClick={handleSignOut}
                />
              </SidebarTooltip>
            </div>
          </TooltipProvider>
        </aside>
      )}
      <main
        id="main-content"
        className={`${isEditRoute ? "min-w-0" : "overflow-x-auto"} ${hideSidebar ? "w-full" : "flex-1"}`}
        style={{ viewTransitionName: "admin-main" }}
      >
        <div
          className={
            isEditRoute
              ? "p-2"
              : isThemeOptions
                ? "w-full py-4 lg:py-6 pl-3 lg:pl-4 pr-4 lg:pr-6"
                : "w-full px-3 py-4 lg:px-5 lg:py-6"
          }
        >
          {children}
        </div>
      </main>
    </div>
  );
}

function SidebarBrand({ compact }: { compact: boolean }) {
  const cfg = useSiteSetting<SidebarLogoCfg>("theme_options", SIDEBAR_LOGO_DEFAULTS);
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const logo = cfg.logo ?? SIDEBAR_LOGO_DEFAULTS.logo;
  const iconSrc =
    (isDark ? logo.sidebar_icon_dark : logo.sidebar_icon) ||
    logo.sidebar_icon ||
    logo.sidebar_icon_dark;
  const expandedSrc =
    (isDark ? logo.sidebar_expanded_dark : logo.sidebar_expanded) ||
    logo.sidebar_expanded ||
    logo.sidebar_expanded_dark ||
    (isDark ? logo.main_dark : logo.main) ||
    logo.main;

  if (compact) {
    return iconSrc ? (
      <img src={iconSrc} alt="Logo" className="w-8 h-8 object-contain" />
    ) : (
      <span className="text-base">New European Strategies</span>
    );
  }
  return expandedSrc ? (
    <img src={expandedSrc} alt="Logo" className="max-h-9 max-w-full object-contain" />
  ) : (
    <span>
      New European Strategies <span className="text-brand">Admin</span>
    </span>
  );
}
