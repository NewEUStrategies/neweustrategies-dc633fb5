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
      <div className="container mx-auto max-w-6xl px-4 py-8 md:py-12">
        <h1 className="mb-6 text-3xl font-bold tracking-tight">{t("profile.title")}</h1>
        <div className="grid gap-6 md:grid-cols-[220px_1fr]">
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
