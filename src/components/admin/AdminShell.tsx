import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
import {
  LogOut,
  Home,
  Moon,
  Sun,
  Globe,
  PanelLeft,
  ChevronRight,
  ChevronDown,
  Search,
  X,
  ExternalLink,
} from "@/lib/lucide-shim";
import { useTheme } from "@/components/ThemeProvider";
import { AdminLangBar } from "@/components/admin/AdminLangBar";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  buildAdminNavGroups,
  searchAdminNav,
  adminNavItemKey,
  type AdminNavGroup,
  type AdminNavItem,
} from "@/lib/admin/adminNav";
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

/** Klucz preferencji zwiniętych grup nawigacji panelu. */
const NAV_COLLAPSED_KEY = "nes.admin.nav.collapsedGroups";

/** Czy w grupie znajduje się trasa, na której właśnie jesteśmy. */
function groupContainsPath(group: AdminNavGroup, path: string): boolean {
  return group.items.some(
    (item) => "to" in item && (path === item.to || path.startsWith(`${item.to}/`)),
  );
}

type AdminNavRowProps = {
  item: AdminNavItem;
  /** Trasa JEDYNEJ aktywnej pozycji sidebara (rozstrzygnięta w adminNav). */
  activeTo: string | null;
  compact: boolean;
  externalHint: string;
  badgeLabel: string;
  groupLabel?: string;
  onNavigate?: () => void;
};


/** Pojedynczy wiersz nawigacji - wspólny dla listy grup i wyników wyszukiwania. */
function AdminNavRow({
  item,
  activeTo,
  compact,
  externalHint,
  badgeLabel,
  groupLabel,
  onNavigate,
  ...rest
}: AdminNavRowProps & Record<string, unknown>) {
  const Icon = item.icon;
  if ("href" in item) {
    return (
      <SidebarExternalNavLink
        {...rest}
        href={item.href}
        icon={Icon}
        label={item.label}
        hint={externalHint}
        compact={compact}
      />
    );
  }
  const active = item.to === activeTo;

  return (
    <Link
      {...rest}
      to={item.to}
      activeOptions={{ exact: true }}
      onClick={onNavigate}
      title={compact ? undefined : item.label}
      data-sidebar="menu-button"
      data-active={active ? "true" : "false"}
      className={cn(
        "flex items-center py-1 rounded-md text-[13px] leading-tight transition",
        compact ? "justify-center px-0" : "gap-1.5 px-2",
        active ? "bg-brand text-brand-foreground" : "text-foreground hover:bg-muted",
      )}
    >
      <Icon className="w-3 h-3 shrink-0" />
      <span className={cn("truncate", compact && "hidden")}>{item.label}</span>
      {groupLabel && !compact ? (
        <span className="ml-auto shrink-0 truncate text-[10px] uppercase tracking-wide text-muted-foreground">
          {groupLabel}
        </span>
      ) : null}
      {!groupLabel && typeof item.badge === "number" && item.badge > 0 && !compact ? (
        <span
          className="ml-auto inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500/20 px-1 text-[10px] font-semibold tabular-nums text-amber-700 dark:text-amber-300"
          aria-label={badgeLabel}
        >
          {item.badge > 99 ? "99+" : item.badge}
        </span>
      ) : null}
    </Link>
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

  const groups = useMemo(
    () => buildAdminNavGroups({ t, isAdmin, isSuperAdmin, clubPending }),
    [t, isAdmin, isSuperAdmin, clubPending],
  );

  // Wyszukiwarka wewnętrzna panelu (tylko admin) - filtruje mapę nawigacji,
  // bez sięgania po treści publiczne.
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement | null>(null);
  const results = useMemo(() => searchAdminNav(groups, query), [groups, query]);
  const searching = query.trim().length > 0;

  // Grupy zwijane; stan trzymany lokalnie w przeglądarce, żeby układ panelu
  // przetrwał przeładowanie. Grupa z aktywną trasą jest zawsze rozwinięta.
  const [collapsedGroups, setCollapsedGroups] = useState<string[]>([]);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(NAV_COLLAPSED_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setCollapsedGroups(parsed.filter((v): v is string => typeof v === "string"));
        }
      }
    } catch {
      /* brak dostępu do storage - zostajemy przy domyślnym układzie */
    }
  }, []);
  const toggleGroup = (id: string) => {
    setCollapsedGroups((prev) => {
      const next = prev.includes(id) ? prev.filter((g) => g !== id) : [...prev, id];
      try {
        window.localStorage.setItem(NAV_COLLAPSED_KEY, JSON.stringify(next));
      } catch {
        /* ignorujemy - to tylko preferencja widoku */
      }
      return next;
    });
  };

  // Skrót klawiaturowy: Cmd/Ctrl+K ustawia fokus na wyszukiwarce panelu.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
                <SidebarTooltip label={t("admin.nav.dashboard")} compact={compact}>
                  <Link
                    to="/admin"
                    data-sidebar-brand
                    title={compact ? undefined : t("admin.nav.dashboard")}
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
            {!compact && (
              <div className="p-2 border-b border-border">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <input
                    ref={searchRef}
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") setQuery("");
                      if (e.key === "Enter") {
                        const first = results[0]?.item;
                        if (first && "to" in first) {
                          setQuery("");
                          void navigate({ to: first.to });
                        }
                      }
                    }}
                    placeholder={t("admin.sidebar.searchPlaceholder")}
                    aria-label={t("admin.sidebar.searchLabel")}
                    data-admin-nav-search
                    className="h-7 w-full rounded-md border border-border bg-background pl-7 pr-6 text-[12px] text-foreground outline-none transition focus:border-brand"
                  />
                  {searching && (
                    <button
                      type="button"
                      onClick={() => setQuery("")}
                      aria-label={t("admin.sidebar.searchClear")}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
              </div>
            )}
            <nav className="flex-1 p-2 space-y-3 overflow-y-auto">
              {searching ? (
                <div className="space-y-0.5">
                  {results.length === 0 ? (
                    <p className="px-2 py-3 text-[12px] text-muted-foreground">
                      {t("admin.sidebar.searchEmpty", { query: query.trim() })}
                    </p>
                  ) : (
                    results.map((hit) => (
                      <AdminNavRow
                        key={`${hit.groupId}-${adminNavItemKey(hit.item)}`}
                        item={hit.item}
                        activeTo={activeTo}

                        compact={false}
                        groupLabel={hit.groupLabel}
                        externalHint={t("admin.nav.externalNewTab")}
                        badgeLabel={t("admin.nav.pendingItems")}
                        onNavigate={() => setQuery("")}
                      />
                    ))
                  )}
                </div>
              ) : (
                groups.map((group, idx) => {
                  const hasActive = groupContainsPath(group, path);
                  const collapsed = !compact && !hasActive && collapsedGroups.includes(group.id);
                  return (
                    <div key={group.id} className={idx > 0 ? "pt-2 border-t border-border/60" : ""}>
                      {group.label && !compact && (
                        <button
                          type="button"
                          onClick={() => toggleGroup(group.id)}
                          data-sidebar="group-label"
                          aria-expanded={!collapsed}
                          className="flex w-full items-center gap-1 rounded px-2 pt-1 pb-0.5 text-[11px] uppercase tracking-wider text-muted-foreground font-semibold hover:text-foreground"
                        >
                          <ChevronDown
                            className={cn(
                              "h-3 w-3 shrink-0 transition-transform",
                              collapsed && "-rotate-90",
                            )}
                            aria-hidden="true"
                          />
                          <span className="truncate">{group.label}</span>
                        </button>
                      )}
                      {!collapsed && (
                        <div className="space-y-0.5">
                          {group.items.map((item) => (
                            <SidebarTooltip
                              key={adminNavItemKey(item)}
                              label={item.label}
                              compact={compact}
                            >
                              <AdminNavRow
                                item={item}
                                activeTo={activeTo}
                                compact={compact}
                                externalHint={t("admin.nav.externalNewTab")}
                                badgeLabel={t("admin.nav.pendingItems")}
                              />
                            </SidebarTooltip>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })
              )}

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
