import { createFileRoute, Outlet, useLocation } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ProfileNav } from "@/components/profile/ProfileNav";
import { AuthGate } from "@/components/profile/AuthGate";
import "@/lib/i18n-profile";

export const Route = createFileRoute("/profile")({
  component: ProfileLayout,
  head: () => ({
    meta: [{ title: "Profil - Mój panel" }, { name: "robots", content: "noindex, nofollow" }],
  }),
});

function ProfileLayout() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  // Inline-edit hero page is the canonical /profile experience.
  // Sub-pages (billing, security, etc.) keep their own focused layout with a sidebar.
  const isRoot = pathname === "/profile" || pathname === "/profile/";

  if (isRoot) {
    return (
      <AuthGate>
        <div className="profile-shell container mx-auto max-w-7xl px-3 py-6 md:py-10 sm:px-4">
          <div className="grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
            <aside className="hidden lg:block">
              <div className="sticky top-4">
                <h2 className="mb-4 rounded-md bg-primary/10 px-3 py-2 text-sm font-bold uppercase tracking-wide text-primary">
                  {t("profile.title")}
                </h2>
                <ProfileNav />
              </div>
            </aside>
            <section className="min-w-0">
              <Outlet />
            </section>
          </div>
        </div>
      </AuthGate>
    );
  }

  return (
    <AuthGate>
      <div className="profile-shell container mx-auto max-w-5xl px-4 py-6 md:py-10">
        <h1 className="mb-5 text-2xl md:text-3xl font-semibold tracking-tight">
          {t("profile.title")}
        </h1>
        <div className="grid gap-5 md:grid-cols-[200px_1fr]">
          <aside>
            <ProfileNav />
          </aside>
          <section className="min-w-0">
            <Outlet />
          </section>
        </div>
      </div>
    </AuthGate>
  );
}
