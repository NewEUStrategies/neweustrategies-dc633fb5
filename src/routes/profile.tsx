import { createFileRoute, Outlet, useLocation } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ProfileNav } from "@/components/profile/ProfileNav";
import { AuthGate } from "@/components/profile/AuthGate";
import { useAuth } from "@/hooks/useAuth";
import { useHeaderProfile } from "@/lib/profile/useHeaderProfile";
import { useGuestPreview } from "@/lib/profile/guestPreviewStore";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { UserCircle, PanelLeftOpen, PanelLeftClose } from "lucide-react";
import { cn } from "@/lib/utils";
import { ensureI18n as ensureProfileI18n } from "@/lib/i18n-profile";

export const Route = createFileRoute("/profile")({
  component: ProfileLayout,
  head: () => ({
    meta: [{ title: "Profil - Mój panel" }, { name: "robots", content: "noindex, nofollow" }],
  }),
});

function initialsFrom(email: string | null | undefined, name?: string | null): string {
  const source = (name ?? email ?? "").trim();
  if (!source) return "?";
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  const letters = parts
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
  return letters || source[0]?.toUpperCase() || "?";
}

function ProfileLayout() {
  // Rejestracja słowników w chunku trasy (nie w entry) - patrz lib/i18n-*.
  ensureProfileI18n();
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const { user } = useAuth();
  const isRoot = pathname === "/profile" || pathname === "/profile/";
  const guestPreview = useGuestPreview();
  // Sidebar znika tylko na ekranie /profile (index), gdzie żyje toggle
  // "Podgląd jak gość" - podstrony /profile/* zachowują nawigację.
  const hideSidebar = isRoot && guestPreview;

  // Sidebar ustawień: domyślnie zwinięty (rail z ikonami). Stan czytamy po
  // hydracji, żeby SSR i pierwszy render klienta były identyczne.
  const [collapsed, setCollapsed] = useState(true);
  useEffect(() => {
    try {
      if (window.localStorage.getItem("profile:sidebar") === "expanded") setCollapsed(false);
    } catch {
      /* prywatny tryb przeglądarki - zostaje domyślne zwinięcie */
    }
  }, []);
  useEffect(() => {
    try {
      window.localStorage.setItem("profile:sidebar", collapsed ? "collapsed" : "expanded");
    } catch {
      /* jw. */
    }
  }, [collapsed]);
  // Szuflada na mobile MUSI otwierać się od góry: karta „Mój profil /
  // Centrum zarządzania" i grupa „Tożsamość" są pierwszym, co widzi
  // użytkownik. Bez resetu przeglądarka zachowuje poprawnią pozycję
  // przewijania i nagłówek ląduje poza ekranem (sidebar „schowany").
  const asideRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!collapsed) asideRef.current?.scrollTo({ top: 0, left: 0 });
  }, [collapsed]);

  // Rozwinięta szuflada na mobile: Escape zamyka, tło nie przewija się pod spodem.
  useEffect(() => {
    if (collapsed) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCollapsed(true);
    };
    window.addEventListener("keydown", onKey);
    const mobile = window.matchMedia("(max-width: 767px)").matches;
    const prev = document.body.style.overflow;
    if (mobile) document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [collapsed]);

  // Ta sama pamięć podręczna, którą karmi useHeaderProfile w headerze - dzięki
  // temu wejście na /profile nie powoduje drugiego round-tripu do PostgREST.
  const { data: profile } = useHeaderProfile(user?.id);

  const fullName = [profile?.first_name, profile?.last_name].filter(Boolean).join(" ").trim();
  const displayName =
    (profile?.display_name && profile.display_name.trim()) ||
    (fullName.length > 0 ? fullName : null) ||
    (user?.user_metadata?.full_name as string | undefined) ||
    (user?.user_metadata?.name as string | undefined) ||
    user?.email ||
    null;
  const initials = initialsFrom(user?.email, displayName);
  const memberLabel = t("profile.overview.memberLabel");

  return (
    <AuthGate>
      <div data-theme-typography className="profile-shell bg-muted/40 py-6 md:py-10">
        <div className="container mx-auto max-w-[90rem] px-3 sm:px-4">
          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-[0_4px_20px_-4px_color-mix(in oklab, var(--foreground) 8%, transparent)]">
            <div className="flex flex-col md:flex-row">
              {/* Sidebar - ukryty w pełnym podglądzie gościa na /profile.
                  Domyślnie zwinięty (rail z ikonami); stan pamiętany lokalnie. */}
              {/* Mobile: rozwinięty sidebar renderowany jest portalem na
                  document.body (niżej) - sticky nagłówek strony ma własny
                  kontekst nakładania i przykrywałby szufladę osadzoną w
                  drzewie treści niezależnie od z-index. */}
              {!hideSidebar && (
                <aside
                  className={cn(
                    "shrink-0 border-border transition-[width] duration-200 md:border-b-0 md:border-r",
                    collapsed
                      ? "w-full border-b bg-muted/40 p-2 md:w-[68px]"
                      // Rozwinięty stan na mobile obsługuje portal - tu tylko
                      // kolumna desktopowa.
                      : "hidden md:block md:w-72 md:max-w-none md:border-b-0 md:bg-muted/40 md:p-5",
                  )}
                  data-collapsed={collapsed ? "true" : "false"}
                >
                  <div className={cn("flex h-full flex-col", collapsed ? "gap-3" : "gap-6")}>
                    {collapsed ? (
                      <button
                        type="button"
                        onClick={() => setCollapsed(false)}
                        aria-expanded={false}
                        aria-label={t("profile.sidebar.expand")}
                        title={t("profile.sidebar.expand")}
                        className="flex h-9 items-center gap-2 rounded-[6px] border border-border/70 bg-background px-2.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:mx-auto md:w-9 md:justify-center md:px-0"
                      >
                        <PanelLeftOpen className="h-4 w-4 shrink-0" />
                        <span className="md:hidden">{t("profile.sidebar.expand")}</span>
                      </button>
                    ) : (
                      <div className="sticky top-0 z-10 -mx-4 -mt-4 bg-background px-4 pb-2 pt-4 md:static md:mx-0 md:mt-0 md:bg-transparent md:p-0">
                        <div className="relative overflow-hidden rounded-[6px] border border-border/70 bg-gradient-to-br from-primary/[0.08] via-background to-background px-3 py-3">
                          <span
                            aria-hidden
                            className="pointer-events-none absolute inset-y-0 left-0 w-[3px] rounded-l-[6px] bg-gradient-to-b from-primary via-primary/70 to-primary/30"
                          />
                          <div className="flex items-center gap-2.5">
                            <span
                              aria-hidden
                              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-primary/10 text-primary ring-1 ring-primary/15"
                            >
                              <UserCircle className="h-4 w-4" />
                            </span>
                            <div className="min-w-0">
                              <h1 className="truncate text-[15px] font-extrabold tracking-tight text-foreground">
                                {t("profile.title")}
                              </h1>
                              <p className="mt-0.5 truncate text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                                {t("profile.subtitle")}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => setCollapsed(true)}
                              aria-expanded
                              aria-label={t("profile.sidebar.collapse")}
                              title={t("profile.sidebar.collapse")}
                              className="ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] border border-border/70 bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                            >
                              <PanelLeftClose className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Zwinięty rail z ikonami tylko na desktopie - na mobile
                        zostaje sam przycisk, a profil widać od razu. */}
                    <div className={cn(collapsed && "hidden md:block")}>
                      <ProfileNav collapsed={collapsed} />
                    </div>

                    {user && !collapsed && (
                      <div className="mt-auto rounded-lg border border-border bg-background px-3 py-3 shadow-sm">
                        <div className="flex items-center gap-3">
                          <Avatar className="h-8 w-8 shrink-0 rounded-[6px]">
                            <AvatarImage
                              src={profile?.avatar_url ?? undefined}
                              alt={displayName ?? t("profile.account.unnamed")}
                              className="rounded-[6px] object-cover"
                            />
                            <AvatarFallback className="rounded-[6px] bg-foreground text-[11px] font-bold text-background">
                              {initials}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <p className="truncate text-xs font-bold text-foreground">
                              {displayName ?? t("profile.account.unnamed")}
                            </p>
                            <p className="truncate text-[10px] uppercase tracking-wide text-muted-foreground">
                              {memberLabel}
                            </p>
                          </div>
                        </div>
                      </div>
                    )}

                    {!collapsed && (
                      <button
                        type="button"
                        onClick={() => setCollapsed(true)}
                        className="mt-2 flex h-10 w-full items-center justify-center gap-2 rounded-[6px] border border-border bg-muted/60 text-xs font-semibold text-foreground transition-colors hover:bg-muted md:hidden"
                      >
                        <PanelLeftClose className="h-4 w-4" />
                        {t("profile.sidebar.collapse")}
                      </button>
                    )}
                  </div>
                </aside>
              )}

              {/* Main content */}
              <div className="min-w-0 flex-1 bg-card p-5 md:p-8">
                <Outlet />
              </div>
            </div>
          </div>
        </div>
      </div>
    </AuthGate>
  );
}
