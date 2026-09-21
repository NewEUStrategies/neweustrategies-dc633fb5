// Strona powitalna po aktywacji konta z e-maila zaproszenia oraz po zmianie
// planu (?mode=upgrade). Renderuje wspólny panel z listą benefitów warstwy
// członkostwa użytkownika. Bez sesji odsyłamy do logowania.
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { MembershipWelcome, type WelcomeMode } from "@/components/membership/MembershipWelcome";
import { activeLang } from "@/lib/seo/head";
import { getRequestUrl } from "@/lib/seo/request";
import { buildContentHead, SITE_NAME } from "@/lib/seo/meta";

export const Route = createFileRoute("/welcome")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>) => ({
    mode: search.mode === "upgrade" ? ("upgrade" as const) : undefined,
  }),
  head: () => {
    const url = getRequestUrl() || "/welcome";
    const lang = activeLang(url);
    return buildContentHead({
      url,
      lang,
      type: "website",
      title: lang === "en" ? `Welcome - ${SITE_NAME}` : `Witamy - ${SITE_NAME}`,
      description:
        lang === "en"
          ? "Your New European Strategies membership is active. See the benefits of your plan."
          : "Twoje członkostwo New European Strategies jest aktywne. Zobacz benefity swojego planu.",
      robots: "noindex, nofollow",
    });
  },
  component: WelcomePage,
});

function WelcomePage() {
  const { mode } = Route.useSearch();
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) void navigate({ to: "/login", replace: true });
  }, [loading, user, navigate]);

  const welcomeMode: WelcomeMode = mode === "upgrade" ? "upgraded" : "activated";
  return (
    <div className="container mx-auto px-4 py-16">
      {user ? <MembershipWelcome mode={welcomeMode} /> : null}
    </div>
  );
}
