// Publiczna strona rejestracji członkostwa (/membership-registration).
// Renderowana z kodu - używa dokładnie tego samego portalu uwierzytelnienia
// co /login (wariant "Zarejestruj się"), więc oba widoki nigdy się nie rozjadą.
//
// RENDER SERWEROWY (2026-11-08). Trasa miała `ssr: false`, więc HTML serwera
// był pusty: wyszukiwarka i asystenci AI dostawali stronę pozyskania członka
// (świadomie indeksowalną) bez treści i bez linków. `/login` renderuje ten sam
// `AuthPortal` na serwerze bez problemu, a pod formularzem stoi teraz sekcja
// treści (`RegistrationGuide`) z jedynym H1 strony i linkami do analiz,
// wydarzeń, newslettera, członkostwa, logowania i dokumentów.
import { createFileRoute } from "@tanstack/react-router";
import { AuthPortal } from "@/components/auth/AuthPortal";
import { RegistrationGuide } from "@/components/membership-registration/RegistrationGuide";
import { ensureI18n as ensureRegistrationI18n } from "@/lib/i18n-membership-registration";
import { activeLang } from "@/lib/seo/head";
import { getRequestUrl } from "@/lib/seo/request";
import { buildContentHead, SITE_NAME } from "@/lib/seo/meta";

export const Route = createFileRoute("/membership-registration")({
  head: () => {
    const url = getRequestUrl() || "/membership-registration";
    const lang = activeLang(url);
    const isEn = lang === "en";
    const title = isEn ? `Create your account - ${SITE_NAME}` : `Załóż konto - ${SITE_NAME}`;
    const description = isEn
      ? "Create a free New European Strategies account - the independent think tank on European security: open analyses, event registration, the newsletter and membership plans."
      : "Załóż bezpłatne konto w New European Strategies - niezależnym think tanku o bezpieczeństwie Europy: analizy otwarte, zapisy na wydarzenia, newsletter i plany członkostwa.";
    return buildContentHead({ url, lang, type: "website", title, description });
  },
  component: MembershipRegistrationPage,
});

function MembershipRegistrationPage() {
  ensureRegistrationI18n();
  return (
    <>
      <AuthPortal initialMode="signup" />
      <RegistrationGuide />
    </>
  );
}
