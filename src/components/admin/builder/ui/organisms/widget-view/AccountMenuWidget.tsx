// Header widget "Konto / Logowanie" - rich popover menu.
// Konfigurowane przez WidgetProperties (AccountLinkEditor):
//   - items: lista pozycji menu (section: guest/auth/staff, kind: page/preset/custom/separator/logout)
//   - labels/icons/desc per pozycja (PL/EN)
//   - style panelu: tło, kolor tekstu, akcent, zaokrąglenie, szerokość
//   - presety profilu (/profile, /profile/bookmarks, ...) + strony z DB pages + URL custom
// Atomic design: AccountMenu = molecule (Popover + lista). i18n: PL/EN.
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import * as LucideIcons from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { AppLink } from "@/components/atoms/AppLink";
import { useAuth } from "@/hooks/useAuth";
import { useHasMounted } from "@/hooks/useHasMounted";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/lib/builder/types";

type Lang = "pl" | "en";

export type AccountMenuItemKind = "preset" | "page" | "custom" | "separator" | "logout";
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
  signin_pl?: string; signin_en?: string;
  signup_pl?: string; signup_en?: string;
  panel_pl?: string; panel_en?: string;
  logout_pl?: string; logout_en?: string;
  signinHref?: string;
  signupHref?: string;
  panelBg?: string;
  panelText?: string;
  panelAccent?: string;
  panelRadius?: number;
  panelWidth?: number;
  triggerVariant?: "split" | "ghost";
}

// Presety profilowe / shop / system - wystawiane jako wybierane URL-e w edytorze.
export const ACCOUNT_PRESETS: Array<{ key: string; href: string; label_pl: string; label_en: string; icon: string }> = [
  { key: "profile", href: "/profile", label_pl: "Mój profil", label_en: "My profile", icon: "User" },
  { key: "account", href: "/profile/account", label_pl: "Ustawienia konta", label_en: "Account settings", icon: "Settings" },
  { key: "security", href: "/profile/security", label_pl: "Bezpieczeństwo", label_en: "Security", icon: "Shield" },
  { key: "social", href: "/profile/social", label_pl: "Media społecznościowe", label_en: "Social media", icon: "Share2" },
  { key: "bookmarks", href: "/profile/bookmarks", label_pl: "Zapisane materiały", label_en: "Saved items", icon: "Bookmark" },
  { key: "follows", href: "/profile/follows", label_pl: "Obserwowane", label_en: "Following", icon: "Heart" },
  { key: "interests", href: "/profile/interests", label_pl: "Zainteresowania", label_en: "Interests", icon: "Sparkles" },
  { key: "reading-list", href: "/reading-list", label_pl: "Do przeczytania", label_en: "Reading list", icon: "BookOpen" },
  { key: "subscription", href: "/profile/subscription", label_pl: "Subskrypcja", label_en: "Subscription", icon: "Crown" },
  { key: "billing", href: "/profile/billing", label_pl: "Płatności", label_en: "Billing", icon: "CreditCard" },
  { key: "orders", href: "/profile/orders", label_pl: "Zamówienia", label_en: "Orders", icon: "ShoppingBag" },
  { key: "pricing", href: "/pricing", label_pl: "Cennik", label_en: "Pricing", icon: "Tag" },
  { key: "admin", href: "/admin", label_pl: "Panel admina", label_en: "Admin panel", icon: "LayoutDashboard" },
];

function presetFor(key: string | undefined) {
  return ACCOUNT_PRESETS.find((p) => p.key === key);
}

function readNum(x: Json | undefined, fallback: number): number {
  return typeof x === "number" && Number.isFinite(x) ? x : fallback;
}

function readStr(x: Json | undefined): string | undefined {
  return typeof x === "string" && x.length ? x : undefined;
}

interface PageRef { slug: string; title: string }

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
        .map((p) => ({ slug: p.slug, title: (lang === "pl" ? p.title_pl : p.title_en) || p.title_pl || p.title_en || p.slug }));
    },
  });
}

function resolveItem(item: AccountMenuItem, pages: PageRef[] | undefined, lang: Lang) {
  const label =
    (lang === "pl" ? item.label_pl : item.label_en) ||
    item.label_pl || item.label_en || "";
  const desc = (lang === "pl" ? item.desc_pl : item.desc_en) || "";
  let href = "";
  let labelFallback = label;
  if (item.kind === "preset") {
    const p = presetFor(item.presetKey);
    if (p) { href = p.href; labelFallback = label || (lang === "pl" ? p.label_pl : p.label_en); }
  } else if (item.kind === "page") {
    const page = pages?.find((x) => x.slug === item.pageSlug);
    if (page) { href = `/${page.slug}`; labelFallback = label || page.title; }
  } else if (item.kind === "custom") {
    href = item.customHref || "";
  }
  return { href, label: labelFallback, desc };
}

function IconByName({ name, className }: { name: string | undefined; className?: string }) {
  if (!name) return null;
  const reg = LucideIcons as unknown as Record<string, React.ComponentType<{ className?: string }> | undefined>;
  const Cmp = reg[name];
  if (!Cmp) return null;
  return <Cmp className={className} />;
}

export function AccountMenuWidget({ config, lang }: { config: AccountMenuConfig; lang: Lang }) {
  const mounted = useHasMounted();
  const { session, user, signOut, isStaff, isAdmin, isSuperAdmin } = useAuth();
  const [open, setOpen] = useState(false);
  const [displayName, setDisplayName] = useState<string>("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const { t } = useTranslation();

  const items = useMemo(() => Array.isArray(config.items) ? config.items : [], [config.items]);
  const hasPageItems = items.some((i) => i.kind === "page");
  const { data: pages } = usePagesIndex(hasPageItems, lang);

  useEffect(() => {
    if (!user?.id) { setDisplayName(""); setAvatarUrl(null); return; }
    let cancelled = false;
    void supabase.from("profiles").select("display_name, avatar_url").eq("id", user.id).maybeSingle().then(({ data }) => {
      if (cancelled) return;
      setDisplayName(data?.display_name ?? user.email ?? "");
      setAvatarUrl(data?.avatar_url ?? null);
    });
    return () => { cancelled = true; };
  }, [user?.id, user?.email]);

  const signInLabel = (lang === "pl" ? config.signin_pl : config.signin_en) || (lang === "pl" ? "Zaloguj" : "Sign in");
  const signUpLabel = (lang === "pl" ? config.signup_pl : config.signup_en) || (lang === "pl" ? "Zarejestruj" : "Sign up");
  const logoutLabel = (lang === "pl" ? config.logout_pl : config.logout_en) || (lang === "pl" ? "Wyloguj" : "Sign out");
  const signinHref = config.signinHref || "/login";
  const signupHref = config.signupHref || "/login?mode=signup";

  const panelStyle: CSSProperties = {
    background: config.panelBg || undefined,
    color: config.panelText || undefined,
    borderRadius: typeof config.panelRadius === "number" ? config.panelRadius : 12,
    width: typeof config.panelWidth === "number" ? config.panelWidth : 280,
    ["--account-accent" as string]: config.panelAccent || "var(--brand, hsl(var(--primary)))",
  };

  // Hydration-safe placeholder (matches SSR neutral state).
  if (!mounted) {
    return (
      <span className="inline-flex h-7 items-center gap-2 text-[11px] leading-none opacity-0" aria-hidden>
        {signInLabel}|{signUpLabel}
      </span>
    );
  }

  const sectionItems = (sec: AccountMenuSection) =>
    items.filter((i) => i.section === sec).map((i) => ({ raw: i, ...resolveItem(i, pages, lang) }));

  const guestItems = sectionItems("guest");
  const authItems = sectionItems("auth");
  const staffItems = sectionItems("staff");

  // Trigger
  const trigger = session ? (
    <button
      type="button"
      className="inline-flex h-8 items-center gap-2 rounded-full pl-1 pr-3 text-xs font-medium hover:bg-muted/60 transition-colors"
      aria-label={displayName || "Account"}
    >
      <Avatar className="h-6 w-6">
        {avatarUrl ? <AvatarImage src={avatarUrl} alt="" /> : null}
        <AvatarFallback className="text-[10px]">
          {(displayName || user?.email || "?").slice(0, 1).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <span className="hidden sm:inline max-w-[120px] truncate">{displayName || user?.email}</span>
    </button>
  ) : (
    <button
      type="button"
      className="inline-flex h-7 items-center gap-2 text-[11px] font-medium leading-none whitespace-nowrap hover:opacity-80"
      aria-label={`${signInLabel} / ${signUpLabel}`}
    >
      <LucideIcons.LogIn className="w-3.5 h-3.5" />
      <span>{signInLabel}</span>
      <span className="text-muted-foreground/40" aria-hidden>|</span>
      <span style={{ color: "var(--brand)" }}>{signUpLabel}</span>
    </button>
  );

  const renderItem = (entry: ReturnType<typeof sectionItems>[number]) => {
    const it = entry.raw;
    if (it.kind === "separator") {
      return <div key={it.id} className="my-1 h-px bg-border/70" role="separator" />;
    }
    if (it.kind === "logout") {
      return (
        <button
          key={it.id}
          type="button"
          onClick={async () => { setOpen(false); await signOut(); }}
          className="flex w-full items-start gap-3 rounded-md px-2.5 py-2 text-left text-sm hover:bg-muted/60 transition-colors"
        >
          <IconByName name={it.icon || "LogOut"} className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="flex-1">
            <span className="block font-medium leading-tight">{entry.label || logoutLabel}</span>
            {entry.desc ? <span className="block text-xs text-muted-foreground mt-0.5">{entry.desc}</span> : null}
          </span>
        </button>
      );
    }
    if (!entry.href) return null;
    const content = (
      <>
        <IconByName name={it.icon} className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="flex-1 min-w-0">
          <span className="block font-medium leading-tight truncate">{entry.label}</span>
          {entry.desc ? <span className="block text-xs text-muted-foreground mt-0.5 line-clamp-2">{entry.desc}</span> : null}
        </span>
      </>
    );
    if (it.external) {
      return (
        <a
          key={it.id}
          href={entry.href}
          target="_blank"
          rel="noreferrer noopener"
          className="flex items-start gap-3 rounded-md px-2.5 py-2 text-sm hover:bg-muted/60 transition-colors"
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
        className="flex items-start gap-3 rounded-md px-2.5 py-2 text-sm hover:bg-muted/60 transition-colors"
        onClick={() => setOpen(false)}
      >
        {content}
      </AppLink>
    );
  };

  // Defaults when admin has not configured any menu items yet - sensible fallback so the
  // widget never looks empty even on a fresh install.
  const effectiveGuest = guestItems.length ? guestItems : [
    { raw: { id: "default-signin", section: "guest" as const, kind: "custom" as const, icon: "LogIn", label_pl: signInLabel, label_en: signInLabel, customHref: signinHref }, href: signinHref, label: signInLabel, desc: "" },
    { raw: { id: "default-signup", section: "guest" as const, kind: "custom" as const, icon: "UserPlus", label_pl: signUpLabel, label_en: signUpLabel, customHref: signupHref }, href: signupHref, label: signUpLabel, desc: "" },
  ];
  const effectiveAuth = authItems.length ? authItems : [
    { raw: { id: "default-profile", section: "auth" as const, kind: "preset" as const, presetKey: "profile", icon: "User" }, href: "/profile", label: lang === "pl" ? "Mój profil" : "My profile", desc: "" },
    { raw: { id: "default-bookmarks", section: "auth" as const, kind: "preset" as const, presetKey: "bookmarks", icon: "Bookmark" }, href: "/profile/bookmarks", label: lang === "pl" ? "Zapisane" : "Saved", desc: "" },
    { raw: { id: "default-logout", section: "auth" as const, kind: "logout" as const, icon: "LogOut", label_pl: logoutLabel, label_en: logoutLabel }, href: "", label: logoutLabel, desc: "" },
  ];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="p-2 shadow-lg border-border/60"
        style={panelStyle}
      >
        {session ? (
          <>
            {user?.email && (
              <div className="px-2.5 pt-1 pb-2 border-b border-border/60 mb-1">
                <div className="text-sm font-semibold truncate">{displayName || user.email}</div>
                {displayName && <div className="text-xs text-muted-foreground truncate">{user.email}</div>}
              </div>
            )}
            <div className="flex flex-col gap-0.5">
              {effectiveAuth.map(renderItem)}
            </div>
            {isStaff && (() => {
              // Auto-defaults for staff: ensure admin / super-admin always have a route
              // back into the management panels even when no custom items are configured.
              const autoStaff: ReturnType<typeof sectionItems> = [];
              if (isAdmin) {
                autoStaff.push({
                  raw: { id: "auto-admin", section: "staff", kind: "custom", icon: "LayoutDashboard", customHref: "/admin" },
                  href: "/admin",
                  label: lang === "pl" ? "Panel admina" : "Admin panel",
                  desc: "",
                });
              }
              if (isSuperAdmin) {
                autoStaff.push({
                  raw: { id: "auto-users", section: "staff", kind: "custom", icon: "ShieldCheck", customHref: "/admin/users" },
                  href: "/admin/users",
                  label: lang === "pl" ? "Super admin - użytkownicy" : "Super admin - users",
                  desc: lang === "pl" ? "Zarządzanie rolami i wcielanie się" : "Roles & impersonation",
                });
              }
              // Merge: auto entries first, then admin-configured items (deduped by href).
              const seen = new Set(autoStaff.map((x) => x.href));
              const merged = [...autoStaff, ...staffItems.filter((x) => !seen.has(x.href))];
              if (merged.length === 0) return null;
              return (
                <>
                  <div className="my-1 h-px bg-border/70" />
                  <div className="px-2.5 pt-1 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                    {isSuperAdmin ? (lang === "pl" ? "Super Admin" : "Super Admin") : (lang === "pl" ? "Zespół" : "Staff")}
                  </div>
                  <div className="flex flex-col gap-0.5">{merged.map(renderItem)}</div>
                </>
              );
            })()}
          </>
        ) : (
          <div className="flex flex-col gap-0.5">{effectiveGuest.map(renderItem)}</div>
        )}
        <span className="sr-only">{t("nav.account", { defaultValue: "Account menu" })}</span>
      </PopoverContent>
    </Popover>
  );
}
