import { createFileRoute } from "@tanstack/react-router";
import { AuthPortal } from "@/components/auth/AuthPortal";
import { activeLang } from "@/lib/seo/head";
import { getRequestUrl } from "@/lib/seo/request";
import { buildContentHead, SITE_NAME } from "@/lib/seo/meta";

export const Route = createFileRoute("/login")({
  // `next` / `intent` / `plan` (P15) przechodzą tu WYŁĄCZNIE kształtem (napis
  // z limitem długości). Pełna sanitizacja ścieżki powrotu (open redirect,
  // pętle logowania) jest w `paywallLinks.parseLoginSearch`, wołanym przez
  // `AuthPortal` - walidator zostaje w chunku wejściowym trasy, więc nie
  // ciągnie tam modułu lejka.
  validateSearch: (
    search: Record<string, unknown>,
  ): { mode?: "signin" | "signup" | "reset"; next?: string; intent?: string; plan?: string } => {
    const out: {
      mode?: "signin" | "signup" | "reset";
      next?: string;
      intent?: string;
      plan?: string;
    } = {};
    const m = search.mode;
    if (m === "signup" || m === "reset" || m === "signin") out.mode = m;
    const text = (value: unknown, max: number) =>
      typeof value === "string" && value.length <= max ? value : undefined;
    const next = text(search.next, 2048);
    const intent = text(search.intent, 16);
    const plan = text(search.plan, 64);
    if (next) out.next = next;
    if (intent) out.intent = intent;
    if (plan) out.plan = plan;
    return out;
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
  const { mode, next, intent, plan } = Route.useSearch();
  return <AuthPortal initialMode={mode ?? "signin"} next={next} intent={intent} planId={plan} />;
}
