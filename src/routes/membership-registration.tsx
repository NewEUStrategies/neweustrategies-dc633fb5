// Publiczna strona rejestracji członkostwa (/membership-registration).
// Renderowana z kodu - używa dokładnie tego samego portalu uwierzytelnienia
// co /login (wariant "Zarejestruj się"), więc oba widoki nigdy się nie rozjadą.
import { createFileRoute } from "@tanstack/react-router";
import { AuthPortal } from "@/components/auth/AuthPortal";
import { activeLang } from "@/lib/seo/head";
import { getRequestUrl } from "@/lib/seo/request";
import { buildContentHead, SITE_NAME } from "@/lib/seo/meta";

export const Route = createFileRoute("/membership-registration")({
  ssr: false,
  head: () => {
    const url = getRequestUrl() || "/membership-registration";
    const lang = activeLang(url);
    const isEn = lang === "en";
    const title = isEn ? `Create your account - ${SITE_NAME}` : `Załóż konto - ${SITE_NAME}`;
    const description = isEn
      ? "Register a New European Strategies account: strategy, knowledge and impact in one ecosystem."
      : "Załóż konto w New European Strategies: strategia, wiedza i wpływ - jeden ekosystem.";
    return buildContentHead({ url, lang, type: "website", title, description });
  },
  component: MembershipRegistrationPage,
});

function MembershipRegistrationPage() {
  return <AuthPortal initialMode="signup" />;
}
