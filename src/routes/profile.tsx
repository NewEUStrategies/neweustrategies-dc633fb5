import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ProfileNav } from "@/components/profile/ProfileNav";
import { AuthGate } from "@/components/profile/AuthGate";
import "@/lib/i18n-profile";

export const Route = createFileRoute("/profile")({
  component: ProfileLayout,
  head: () => ({
    meta: [
      { title: "Profil - Mój panel" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

function ProfileLayout() {
  const { t } = useTranslation();
  return (
    <AuthGate>
      <div className="profile-shell container mx-auto max-w-5xl px-4 py-6 md:py-10">
        <h1 className="mb-5 text-2xl md:text-3xl font-semibold tracking-tight">{t("profile.title")}</h1>
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
