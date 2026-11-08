// Organizm: treść strony /membership-registration pod formularzem rejestracji.
//
// PO CO. Trasa renderowała wyłącznie `AuthPortal`, i to z `ssr: false` - HTML
// serwera był pusty, więc dla wyszukiwarki i asystentów AI strona pozyskania
// członka (świadomie indeksowalna - patrz test trasy) nie miała ani jednego
// zdania, nagłówka ani linku. Ta sekcja jest renderowana na serwerze i mówi,
// czym jest serwis, co daje konto i dokąd prowadzą kolejne kroki: analizy,
// wydarzenia, newsletter, członkostwo, logowanie i dokumenty.
//
// Jedyny H1 strony stoi tutaj - `AuthPortal` nie ma własnego `h1`.
// Adresy stron CMS idą przez trasę uniwersalną (`/$` + `_splat`), adresy tras
// kodowych - wprost; prefiks `/en` dokłada router, tak jak w pozostałych
// organizmach stron członkostwa.
import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ArrowRight } from "lucide-react";

const CARD = "flex h-full flex-col rounded-[6px] border border-border/70 bg-card/60 p-5 sm:p-6";
const LINK =
  "inline-flex items-center gap-1.5 text-sm font-semibold text-foreground underline-offset-4 hover:underline";

function CardLinks({ children }: { children: ReactNode }) {
  return <div className="mt-auto flex flex-wrap gap-x-5 gap-y-2 pt-4">{children}</div>;
}

function Arrow() {
  return <ArrowRight className="h-3.5 w-3.5" aria-hidden />;
}

export function RegistrationGuide() {
  const { t } = useTranslation();
  const k = (key: string) => t(`membershipRegistration.${key}`);

  return (
    <section
      aria-labelledby="registration-guide-title"
      className="container mx-auto max-w-6xl px-4 py-12 md:py-16"
      data-registration-guide
    >
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {k("eyebrow")}
      </p>
      <h1
        id="registration-guide-title"
        className="mt-2 text-balance text-3xl font-bold tracking-tight text-foreground sm:text-4xl"
      >
        {k("title")}
      </h1>
      <p className="mt-4 max-w-3xl text-base leading-relaxed text-muted-foreground">{k("lead")}</p>

      <h2 className="mt-10 text-xl font-bold tracking-tight text-foreground sm:text-2xl">
        {k("benefitsTitle")}
      </h2>
      <ul className="mt-5 grid gap-4 sm:grid-cols-2">
        <li className={CARD}>
          <h3 className="text-lg font-semibold text-foreground">{k("benefits.analyses.title")}</h3>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {k("benefits.analyses.body")}
          </p>
          <CardLinks>
            <Link to="/$" params={{ _splat: "analizy" }} className={LINK}>
              {k("benefits.analyses.analyses")}
              <Arrow />
            </Link>
          </CardLinks>
        </li>
        <li className={CARD}>
          <h3 className="text-lg font-semibold text-foreground">{k("benefits.events.title")}</h3>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {k("benefits.events.body")}
          </p>
          <CardLinks>
            <Link to="/$" params={{ _splat: "wydarzenia" }} className={LINK}>
              {k("benefits.events.events")}
            </Link>
            <Link to="/$" params={{ _splat: "konferencje" }} className={LINK}>
              {k("benefits.events.conferences")}
            </Link>
            <Link to="/$" params={{ _splat: "spotkania-chatham-house" }} className={LINK}>
              {k("benefits.events.meetings")}
            </Link>
          </CardLinks>
        </li>
        <li className={CARD}>
          <h3 className="text-lg font-semibold text-foreground">
            {k("benefits.newsletter.title")}
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {k("benefits.newsletter.body")}
          </p>
          <CardLinks>
            <Link to="/$" params={{ _splat: "dolacz-do-newslettera" }} className={LINK}>
              {k("benefits.newsletter.newsletter")}
              <Arrow />
            </Link>
          </CardLinks>
        </li>
        <li className={CARD}>
          <h3 className="text-lg font-semibold text-foreground">
            {k("benefits.membership.title")}
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {k("benefits.membership.body")}
          </p>
          <CardLinks>
            <Link to="/membership-join" className={LINK}>
              {k("benefits.membership.join")}
              <Arrow />
            </Link>
            <Link to="/pricing" className={LINK}>
              {k("benefits.membership.pricing")}
            </Link>
          </CardLinks>
        </li>
      </ul>

      <div className="mt-8 flex flex-col gap-3 text-sm text-muted-foreground sm:flex-row sm:flex-wrap sm:gap-x-8">
        <p>
          {k("signin.prompt")}{" "}
          <Link to="/login" className={LINK}>
            {k("signin.link")}
          </Link>
        </p>
        <p>
          {k("about.prompt")}{" "}
          <Link to="/$" params={{ _splat: "o-nas" }} className={LINK}>
            {k("about.about")}
          </Link>
          {" · "}
          <Link to="/$" params={{ _splat: "kontakt" }} className={LINK}>
            {k("about.contact")}
          </Link>
        </p>
      </div>

      <nav aria-label={k("legal.title")} className="mt-8 border-t border-border/60 pt-6">
        <ul className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
          <li>
            <Link to="/regulamin" className="hover:text-foreground hover:underline">
              {k("legal.terms")}
            </Link>
          </li>
          <li>
            <Link to="/polityka-prywatnosci" className="hover:text-foreground hover:underline">
              {k("legal.privacy")}
            </Link>
          </li>
          <li>
            <Link
              to="/regulamin-subskrypcji-i-zakupow"
              className="hover:text-foreground hover:underline"
            >
              {k("legal.subscriptions")}
            </Link>
          </li>
          <li>
            <Link to="/rodo" className="hover:text-foreground hover:underline">
              {k("legal.gdpr")}
            </Link>
          </li>
        </ul>
      </nav>
    </section>
  );
}
