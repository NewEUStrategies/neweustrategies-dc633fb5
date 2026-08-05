import { createFileRoute } from "@tanstack/react-router";
import { AuthPortal } from "@/components/auth/AuthPortal";
import { activeLang } from "@/lib/seo/head";
import { getRequestUrl } from "@/lib/seo/request";
import { buildContentHead, SITE_NAME } from "@/lib/seo/meta";

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>): { mode?: "signin" | "signup" | "reset" } => {
    const m = search.mode;
    if (m === "signup" || m === "reset" || m === "signin") return { mode: m };
    return {};
  },
  head: () => {
    const url = getRequestUrl() || "/login";
    const lang = activeLang(url);
    const title = lang === "en" ? `Sign in - ${SITE_NAME}` : `Zaloguj się - ${SITE_NAME}`;
    return buildContentHead({
      url,
      lang,
      type: "website",
      title,
      description:
        lang === "en"
          ? "Sign in to your New European Strategies account."
          : "Zaloguj się do swojego konta New European Strategies.",
      robots: "noindex, nofollow",
    });
  },
  component: LoginPage,
});

function LoginPage() {
  const { mode } = Route.useSearch();
  return <AuthPortal initialMode={mode ?? "signin"} />;
}
