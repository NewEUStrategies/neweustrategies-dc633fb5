// Header widget "Konto / Logowanie" - rich popover menu.
// Konfigurowane przez WidgetProperties (AccountLinkEditor):
//   - items: lista pozycji menu (section: guest/auth/staff, kind: page/preset/custom/separator/logout)
//   - labels/icons/desc per pozycja (PL/EN)
//   - style panelu: tło, kolor tekstu, akcent, zaokrąglenie, szerokość
//   - presety profilu (/profile, /profile/bookmarks, ...) + strony z DB pages + URL custom
// Atomic design: AccountMenu = molecule (Popover + lista). i18n: PL/EN.
import { lazy, Suspense, useMemo, useState, type CSSProperties } from "react";
import { useGreeting } from "@/lib/greetings/useGreeting";
import { useHeaderProfile } from "@/lib/profile/useHeaderProfile";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { LogIn, ChevronRight } from "lucide-react";
import { DynamicIcon } from "@/lib/icons/DynamicIcon";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { AppLink } from "@/components/atoms/AppLink";
import { useAuth } from "@/hooks/useAuth";

import { supabase } from "@/integrations/supabase/client";
import { NotificationsBell } from "@/components/notifications/NotificationsBell";

// Lazy: the chat bundle (incl. its i18n resources) loads only for signed-in
// users, keeping the guest header untouched and the widget graph decoupled.
const ChatBell = lazy(() =>
  import("@/components/chat/ChatBell").then((m) => ({ default: m.ChatBell })),
);

type Lang = "pl" | "en";

type AccountMenuItemKind = "preset" | "page" | "custom" | "separator" | "logout";
export type AccountMenuSection = "guest" | "auth" | "staff";

export interface AccountMenuItem {
  id: string;
  section: AccountMenuSection;
  kind: AccountMenuItemKind;
  presetKey?: string;
  pageSlug?: string;
  customHref?: string;
  icon?: string;
  label_pl?: string;
  label_en?: string;
  desc_pl?: string;
  desc_en?: string;
  external?: boolean;
}

export interface AccountMenuConfig {
  items?: AccountMenuItem[];
  signin_pl?: string;
  signin_en?: string;
  signup_pl?: string;
  signup_en?: string;
  panel_pl?: string;
  panel_en?: string;
  logout_pl?: string;
  logout_en?: string;
  signinHref?: string;
  signupHref?: string;
  panelBg?: string;
  panelText?: string;
  panelAccent?: string;
  panelRadius?: number;
  panelWidth?: number;
}

// Presety profilowe / shop / system - wystawiane jako wybierane URL-e w edytorze.
export const ACCOUNT_PRESETS: Array<{
  key: string;
  href: string;
  label_pl: string;
  label_en: string;
  icon: string;
}> = [
  {
    key: "profile",
    href: "/profile",
    label_pl: "Mój profil",
    label_en: "My profile",
    icon: "User",
  },
  {
    key: "account",
    href: "/profile/edit",
    label_pl: "Ustawienia konta",
    label_en: "Account settings",
    icon: "Settings",
  },
  {
    key: "security",
    href: "/profile/security",
    label_pl: "Bezpieczeństwo konta",
    label_en: "Account security",
    icon: "Shield",
  },
  {
    // Prywatność ma teraz własny hub (§10 IA prywatności): widoczność, zgody
    // i prawa do danych. Wcześniej dało się z tego menu wskazać tylko
    // bezpieczeństwo konta, choć to dwie różne sprawy.
    key: "privacy",
    href: "/profile/privacy",
    label_pl: "Prywatność i dane",
    label_en: "Privacy & data",
    icon: "Lock",
  },
  {
    key: "social",
    href: "/profile/edit?tab=social",
    label_pl: "Media społecznościowe",
    label_en: "Social media",
    icon: "Share2",
  },
  {
    key: "bookmarks",
    href: "/profile/bookmarks",
    label_pl: "Zapisane materiały",
    label_en: "Saved items",
    icon: "Bookmark",
  },
  {
    key: "follows",
    href: "/profile/follows",
    label_pl: "Obserwowane",
    label_en: "Following",
    icon: "Heart",
  },
  {
    key: "messages",
    href: "/messages",
    label_pl: "Wiadomości",
    label_en: "Messages",
    icon: "MessagesSquare",
  },
  {
    key: "people",
    href: "/people",
    label_pl: "Osoby",
    label_en: "People",
    icon: "Users",
  },
  {
    key: "network",
    href: "/network",
    label_pl: "Sieć kontaktów",
    label_en: "Network",
    icon: "UserPlus",
  },
  {
    // Hub klubów dyskusyjnych - moduł społecznościowy (/club).
    key: "clubs",
    href: "/club",
    label_pl: "Kluby dyskusyjne",
    label_en: "Discussion clubs",
    icon: "Landmark",
  },

  {
    key: "interests",
    href: "/profile/interests",
    label_pl: "Zainteresowania",
    label_en: "Interests",
    icon: "SlidersHorizontal",
  },
  {
    key: "reading-list",
    href: "/reading-list",
    label_pl: "Do przeczytania",
    label_en: "Reading list",
    icon: "BookOpen",
  },
  {
    // Klucz zostaje (widget zapisuje go w dokumentach buildera) - adres celuje
    // w kanoniczną trasę po konsolidacji IA finansów (§11).
    key: "subscription",
    href: "/profile/plan",
    label_pl: "Plan i członkostwo",
    label_en: "Plan & subscription",
    icon: "Crown",
  },
  {
    key: "billing",
    href: "/profile/billing",
    label_pl: "Płatności",
    label_en: "Billing",
    icon: "CreditCard",
  },
  {
    key: "orders",
    href: "/profile/payments",
    label_pl: "Płatności i faktury",
    label_en: "Payments & invoices",
    icon: "ShoppingBag",
  },
  { key: "pricing", href: "/pricing", label_pl: "Cennik", label_en: "Pricing", icon: "Tag" },
  {
    key: "admin",
    href: "/admin",
    label_pl: "Panel admina",
    label_en: "Admin panel",
    icon: "LayoutDashboard",
  },
];

function presetFor(key: string | undefined) {
  return ACCOUNT_PRESETS.find((p) => p.key === key);
}

interface PageRef {
  slug: string;
  title: string;
}

function usePagesIndex(enabled: boolean, lang: Lang) {
  return useQuery({
    queryKey: ["account-menu-pages", lang],
    enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<PageRef[]> => {
      const { data } = await supabase
        .from("pages")
        .select("slug, title_pl, title_en")
        .eq("status", "published")
        .order("title_pl");
      return (data ?? [])
        .filter((p): p is { slug: string; title_pl: string; title_en: string } => !!p?.slug)
        .map((p) => ({
          slug: p.slug,
          title: (lang === "pl" ? p.title_pl : p.title_en) || p.title_pl || p.title_en || p.slug,
        }));
    },
  });
}

function resolveItem(item: AccountMenuItem, pages: PageRef[] | undefined, lang: Lang) {
  const label =
    (lang === "pl" ? item.label_pl : item.label_en) || item.label_pl || item.label_en || "";
  const desc = (lang === "pl" ? item.desc_pl : item.desc_en) || "";
  let href = "";
  let labelFallback = label;
  if (item.kind === "preset") {
    const p = presetFor(item.presetKey);
    if (p) {
      href = p.href;
      labelFallback = label || (lang === "pl" ? p.label_pl : p.label_en);
    }
  } else if (item.kind === "page") {
    const page = pages?.find((x) => x.slug === item.pageSlug);
    if (page) {
      href = `/${page.slug}`;
      labelFallback = label || page.title;
    }
  } else if (item.kind === "custom") {
    href = item.customHref || "";
  }
  return { href, label: labelFallback, desc };
}

function IconByName({ name, className }: { name: string | undefined; className?: string }) {
  if (!name) return null;
  // DynamicIcon: kurowany zestaw synchronicznie, nietypowe nazwy leniwie -
  // bez namespace-importu całego lucide-react w eager-owej ścieżce chrome.
  return <DynamicIcon name={name} className={className} />;
}

export function AccountMenuWidget({ config, lang }: { config: AccountMenuConfig; lang: Lang }) {
  // Bez bramki `useHasMounted`: SSR i pierwszy client render renderują ten
  // sam guest-trigger (sesja przychodzi asynchronicznie z useAuth), więc
  // header nie miga pustką i nie czeka jednego dodatkowego renderu, zanim
  // ChatBell/NotificationsBell zamontują swoje zapytania. Gdy sesja
  // zhydratyzuje się z localStorage, trigger płynnie zamienia się na wariant
  // zalogowany, a dzwonki startują queries od razu.
  const { session, user, signOut, isStaff, isAdmin, isSuperAdmin } = useAuth();
  const [open, setOpen] = useState(false);
  const { t } = useTranslation();

  const items = useMemo(() => (Array.isArray(config.items) ? config.items : []), [config.items]);
  const hasPageItems = items.some((i) => i.kind === "page");
  const { data: pages } = usePagesIndex(hasPageItems, lang);

  // Shared with useGreeting - one profile round-trip for the whole header.
  const { data: profile } = useHeaderProfile(user?.id);

  const firstName = profile?.first_name ?? "";
  const displayName = profile?.display_name ?? user?.email ?? "";
  const avatarUrl = profile?.avatar_url ?? null;

  const signInLabel =
    (lang === "pl" ? config.signin_pl : config.signin_en) ||
    (lang === "pl" ? "Zaloguj" : "Sign in");
  const signUpLabel =
    (lang === "pl" ? config.signup_pl : config.signup_en) ||
    (lang === "pl" ? "Zarejestruj" : "Sign up");
  const logoutLabel =
    (lang === "pl" ? config.logout_pl : config.logout_en) ||
    (lang === "pl" ? "Wyloguj" : "Sign out");
  const signinHref = config.signinHref || "/login";
  const signupHref = config.signupHref || "/login?mode=signup";
  // Naglowek panelu konta. Klucz istnial w defaultach, w seedzie chrome i w
  // typie, ale zaden renderer go nie czytal - ustawienie bylo martwe. Puste =
  // brak widocznego naglowka (zachowanie sprzed zmiany), a nazwa dostepnosciowa
  // panelu i tak ma sensowny fallback.
  const panelLabel = (lang === "pl" ? config.panel_pl : config.panel_en) || "";

  const panelStyle: CSSProperties = {
    background: config.panelBg || undefined,
    color: config.panelText || undefined,
    borderRadius: typeof config.panelRadius === "number" ? config.panelRadius : 12,
    width: typeof config.panelWidth === "number" ? config.panelWidth : 280,
    ["--account-accent" as string]: config.panelAccent || "var(--brand, var(--primary))",
  };

  // Trigger - greeting based on time of day + gender + vocative (PL).
  const greeting = useGreeting();

  const sectionItems = (sec: AccountMenuSection) =>
    items.filter((i) => i.section === sec).map((i) => ({ raw: i, ...resolveItem(i, pages, lang) }));

  const guestItems = sectionItems("guest");
  const authItems = sectionItems("auth");
  const staffItems = sectionItems("staff");

  const fallbackHello = lang === "pl" ? "Hej!" : "Hi!";
  const triggerLabel = greeting || firstName || displayName || fallbackHello;
  const trigger = session ? (
    <button
      type="button"
      className="inline-flex h-8 items-center gap-2 rounded-full pl-1 pr-3 text-xs font-medium hover:bg-muted/60 transition-colors cursor-pointer"
      aria-label={displayName || "Account"}
      title={triggerLabel}
    >
      <Avatar className="h-6 w-6 rounded-[5px]">
        {avatarUrl ? <AvatarImage src={avatarUrl} alt="" className="rounded-[5px]" /> : null}
        <AvatarFallback className="text-[10px] rounded-[5px]">
          {(firstName || displayName || user?.email || "?").slice(0, 1).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <span className="hidden sm:inline max-w-[200px] truncate">{triggerLabel}</span>
    </button>
  ) : (
    <button
      type="button"
      className="inline-flex h-7 items-center gap-2 text-[11px] font-medium leading-none whitespace-nowrap hover:opacity-80 cursor-pointer"
      aria-label={`${signInLabel} / ${signUpLabel}`}
    >
      <LogIn className="w-3.5 h-3.5" />
      <span>{signInLabel}</span>
      <span className="text-muted-foreground/40" aria-hidden>
        |
      </span>
      <span style={{ color: "var(--brand)" }}>{signUpLabel}</span>
    </button>
  );

  // Wspólna geometria pozycji: 6 px rounding (wytyczna platformy), pasek akcentu
  // po lewej na hover/focus i wejście kaskadowe (`--am-i` = indeks pozycji).
  const ITEM_CLASS =
    "account-menu-item group relative flex w-full items-center gap-3 rounded-[6px] px-2.5 py-2 text-left text-sm outline-none transition-[background-color,transform,color] duration-200 hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:ring-2 focus-visible:ring-[color:var(--account-accent)]/40";

  const renderItem = (entry: ReturnType<typeof sectionItems>[number], index = 0) => {
    const it = entry.raw;
    const style = { ["--am-i" as string]: index } as CSSProperties;
    if (it.kind === "separator") {
      return <div key={it.id} className="my-1.5 h-px bg-border/70" role="separator" />;
    }
    if (it.kind === "logout") {
      return (
        <button
          key={it.id}
          type="button"
          style={style}
          onClick={async () => {
            setOpen(false);
            await signOut();
          }}
          className={ITEM_CLASS}
        >
          <span className="account-menu-accent" aria-hidden />
          <IconByName
            name={it.icon || "LogOut"}
            className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-[color:var(--account-accent)]"
          />
          <span className="flex-1">
            <span className="block font-medium leading-tight">{entry.label || logoutLabel}</span>
            {entry.desc ? (
              <span className="block text-xs text-muted-foreground mt-0.5">{entry.desc}</span>
            ) : null}
          </span>
        </button>
      );
    }
    if (!entry.href) return null;
    const content = (
      <>
        <span className="account-menu-accent" aria-hidden />
        <IconByName
          name={it.icon}
          className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-[color:var(--account-accent)]"
        />
        <span className="flex-1 min-w-0">
          <span className="block font-medium leading-tight truncate">{entry.label}</span>
          {entry.desc ? (
            <span className="block text-xs text-muted-foreground mt-0.5 line-clamp-2">
              {entry.desc}
            </span>
          ) : null}
        </span>
        <ChevronRight
          className="h-3.5 w-3.5 shrink-0 -translate-x-1 text-muted-foreground/50 opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100"
          aria-hidden
        />
      </>
    );
    if (it.external) {
      return (
        <a
          key={it.id}
          href={entry.href}
          target="_blank"
          rel="noreferrer noopener"
          style={style}
          className={ITEM_CLASS}
          onClick={() => setOpen(false)}
        >
          {content}
        </a>
      );
    }
    return (
      <AppLink
        key={it.id}
        href={entry.href}
        style={style}
        className={ITEM_CLASS}
        onClick={() => setOpen(false)}
      >
        {content}
      </AppLink>
    );
  };

  // Defaults when admin has not configured any menu items yet - sensible fallback so the
  // widget never looks empty even on a fresh install.
  const effectiveGuest = guestItems.length
    ? guestItems
    : [
        {
          raw: {
            id: "default-signin",
            section: "guest" as const,
            kind: "custom" as const,
            icon: "LogIn",
            label_pl: signInLabel,
            label_en: signInLabel,
            customHref: signinHref,
          },
          href: signinHref,
          label: signInLabel,
          desc: "",
        },
        {
          raw: {
            id: "default-signup",
            section: "guest" as const,
            kind: "custom" as const,
            icon: "UserPlus",
            label_pl: signUpLabel,
            label_en: signUpLabel,
            customHref: signupHref,
          },
          href: signupHref,
          label: signUpLabel,
          desc: "",
        },
      ];
  const effectiveAuth = authItems.length
    ? authItems
    : [
        {
          raw: {
            id: "default-profile",
            section: "auth" as const,
            kind: "preset" as const,
            presetKey: "profile",
            icon: "User",
          },
          href: "/profile",
          label: lang === "pl" ? "Mój profil" : "My profile",
          desc: "",
        },
        {
          raw: {
            id: "default-network",
            section: "auth" as const,
            kind: "preset" as const,
            presetKey: "network",
            icon: "UserPlus",
          },
          href: "/network",
          label: lang === "pl" ? "Sieć kontaktów" : "Network",
          desc: "",
        },
        {
          raw: {
            id: "default-clubs",
            section: "auth" as const,
            kind: "preset" as const,
            presetKey: "clubs",
            icon: "Landmark",
          },
          href: "/club",
          label: lang === "pl" ? "Kluby dyskusyjne" : "Discussion clubs",
          desc: "",
        },
        {
          raw: {
            id: "default-messages",
            section: "auth" as const,
            kind: "preset" as const,
            presetKey: "messages",
            icon: "MessageCircle",
          },
          href: "/messages",
          label: lang === "pl" ? "Czat" : "Chat",
          desc: "",
        },

        {
          raw: {
            id: "default-bookmarks",
            section: "auth" as const,
            kind: "preset" as const,
            presetKey: "bookmarks",
            icon: "Bookmark",
          },
          href: "/profile/bookmarks",
          label: lang === "pl" ? "Zapisane" : "Saved",
          desc: "",
        },

        {
          raw: {
            id: "default-logout",
            section: "auth" as const,
            kind: "logout" as const,
            icon: "LogOut",
            label_pl: logoutLabel,
            label_en: logoutLabel,
          },
          href: "",
          label: logoutLabel,
          desc: "",
        },
      ];

  // Spójne odstępy dla rzędu ikon konta (mobile-first, unifikacja z headerem).
  // gap-x-2 na <480 px, gap-x-3 od sm; pr-1.5 rezerwuje miejsce na overflow badge
  // powiadomień (badge = -right-2.5), żeby nie nachodził na powitanie/avatar.
  return (
    <div className="relative inline-flex items-center gap-x-2 sm:gap-x-3 overflow-visible">
      {session ? (
        <Suspense fallback={null}>
          <ChatBell />
        </Suspense>
      ) : null}
      {session ? (
        <span className="relative inline-flex overflow-visible pr-1.5 sm:pr-2">
          <NotificationsBell />
        </span>
      ) : null}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        <PopoverContent
          align="end"
          sideOffset={8}
          collisionPadding={12}
          sticky="always"
          hideWhenDetached={false}
          avoidCollisions
          data-account-menu=""
          className={[
            "p-1.5 shadow-xl border-border/60 backdrop-blur-md overflow-hidden",
            // Smoother in/out using Radix state + tailwindcss-animate keyframes.
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0",
            "data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95",
            "data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2",
            "data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2",
            "duration-220 ease-[cubic-bezier(0.22,0.61,0.36,1)]",
            "will-change-[transform,opacity]",
            "origin-(--radix-popover-content-transform-origin)",
          ].join(" ")}
          style={panelStyle}
          aria-label={panelLabel || (lang === "pl" ? "Menu konta" : "Account menu")}
        >
          {panelLabel && (
            <div
              className="account-menu-section px-2.5 pb-1.5 text-[11px] font-bold uppercase tracking-widest text-muted-foreground"
              style={{ ["--am-i" as string]: 0 } as CSSProperties}
            >
              {panelLabel}
            </div>
          )}
          {session ? (
            <>
              {user?.email && (
                <div
                  className="account-menu-section mb-1.5 flex items-center gap-2.5 rounded-[6px] bg-muted/40 px-2.5 py-2"
                  style={{ ["--am-i" as string]: 0 } as CSSProperties}
                >
                  <Avatar className="h-9 w-9 rounded-[6px]">
                    {avatarUrl ? (
                      <AvatarImage src={avatarUrl} alt="" className="rounded-[6px] object-cover" />
                    ) : null}
                    <AvatarFallback className="rounded-[6px] text-xs">
                      {(firstName || displayName || user.email).slice(0, 1).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">
                      {displayName || user.email}
                    </span>
                    {displayName && (
                      <span className="block truncate text-xs text-muted-foreground">
                        {user.email}
                      </span>
                    )}
                  </span>
                </div>
              )}
              <div className="flex flex-col gap-0.5">
                {effectiveAuth.map((entry, i) => renderItem(entry, i + 1))}
              </div>
              {isStaff &&
                (() => {
                  // Auto-defaults for staff: ensure admin / super-admin always have a route
                  // back into the management panels even when no custom items are configured.
                  const autoStaff: ReturnType<typeof sectionItems> = [];
                  if (isAdmin) {
                    autoStaff.push({
                      raw: {
                        id: "auto-admin",
                        section: "staff",
                        kind: "custom",
                        icon: "LayoutDashboard",
                        customHref: "/admin",
                      },
                      href: "/admin",
                      label: lang === "pl" ? "Panel admina" : "Admin panel",
                      desc: "",
                    });
                  }
                  if (isSuperAdmin) {
                    autoStaff.push({
                      raw: {
                        id: "auto-users",
                        section: "staff",
                        kind: "custom",
                        icon: "ShieldCheck",
                        customHref: "/admin/users",
                      },
                      href: "/admin/users",
                      label: lang === "pl" ? "Super admin - użytkownicy" : "Super admin - users",
                      desc:
                        lang === "pl"
                          ? "Zarządzanie rolami i wcielanie się"
                          : "Roles & impersonation",
                    });
                  }
                  // Merge: auto entries first, then admin-configured items (deduped by href).
                  const seen = new Set(autoStaff.map((x) => x.href));
                  const merged = [...autoStaff, ...staffItems.filter((x) => !seen.has(x.href))];
                  if (merged.length === 0) return null;
                  const base = effectiveAuth.length + 1;
                  return (
                    <>
                      <div className="my-1.5 h-px bg-border/70" />
                      <div
                        className="account-menu-section px-2.5 pb-1 pt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground"
                        style={{ ["--am-i" as string]: base } as CSSProperties}
                      >
                        {isSuperAdmin ? "Super Admin" : lang === "pl" ? "Zespół" : "Staff"}
                      </div>
                      <div className="flex flex-col gap-0.5">
                        {merged.map((entry, i) => renderItem(entry, base + i + 1))}
                      </div>
                    </>
                  );
                })()}
            </>
          ) : (
            <div className="flex flex-col gap-0.5">
              {effectiveGuest.map((entry, i) => renderItem(entry, i + 1))}
            </div>
          )}
          <span className="sr-only">{t("nav.account")}</span>
        </PopoverContent>
      </Popover>
    </div>
  );
}
