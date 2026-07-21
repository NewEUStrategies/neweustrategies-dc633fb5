import { createFileRoute, Outlet, useLocation } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ProfileNav } from "@/components/profile/ProfileNav";
import { AuthGate } from "@/components/profile/AuthGate";
import { useAuth } from "@/hooks/useAuth";
import { useHeaderProfile } from "@/lib/profile/useHeaderProfile";
import { useGuestPreview } from "@/lib/profile/guestPreviewStore";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
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
  const memberLabel = t("profile.overview.memberLabel", "Członek");

  return (
    <AuthGate>
      <div className="profile-shell bg-muted/40 py-6 md:py-10">
        <div className="container mx-auto max-w-6xl px-3 sm:px-4">
          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-[0_4px_20px_-4px_color-mix(in oklab, var(--foreground) 8%, transparent)]">
            <div className="flex flex-col md:flex-row">
              {/* Sidebar - ukryty w pełnym podglądzie gościa na /profile */}
              {!hideSidebar && (
                <aside className="w-full shrink-0 border-b border-border bg-muted/40 p-5 md:w-72 md:border-b-0 md:border-r">
                  <div className="flex h-full flex-col gap-6">
                    <div className="px-2">
                      <h1 className="text-xl font-extrabold uppercase italic tracking-tight text-foreground">
                        {t("profile.title")}
                      </h1>
                      <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                        {t("profile.subtitle", { defaultValue: "Centrum zarządzania" })}
                      </p>
                    </div>

                    <ProfileNav />

                    {user && (
                      <div className="mt-auto rounded-lg border border-border bg-background px-3 py-3 shadow-sm">
                        <div className="flex items-center gap-3">
                          <Avatar className="h-8 w-8 shrink-0 rounded-[6px]">
                            <AvatarImage
                              src={profile?.avatar_url ?? undefined}
                              alt={displayName ?? t("profile.account.unnamed", "Użytkownik")}
                              className="rounded-[6px] object-cover"
                            />
                            <AvatarFallback className="rounded-[6px] bg-foreground text-[11px] font-bold text-background">
                              {initials}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <p className="truncate text-xs font-bold text-foreground">
                              {displayName ?? t("profile.account.unnamed", "Użytkownik")}
                            </p>
                            <p className="truncate text-[10px] uppercase tracking-wide text-muted-foreground">
                              {memberLabel}
                            </p>
                          </div>
                        </div>
                      </div>
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
