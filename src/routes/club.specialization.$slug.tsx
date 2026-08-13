// /club/specialization/$slug - publiczna strona specjalizacji klubu.
//
// To jest wejście z wyszukiwarki i z siatki na hubie: opisuje obszar, mówi co
// daje członkostwo i kończy się jednym CTA do formularza zgłoszenia (z już
// wybraną specjalizacją). Trasa jest STATYCZNA przed `/club/$clubSlug`, więc
// nie zabiera adresu żadnemu klubowi.
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CLUB_SPECIALIZATIONS, findClubSpecialization } from "@/lib/clubs/specializations";
import { buildSpecializationHead } from "@/lib/clubs/specializationHead";
import { ClubDirectory } from "@/components/clubs/organisms/ClubDirectory";
import { useClubsBySpecialization } from "@/lib/clubs/useClubSpecializations";
import { useAuth } from "@/hooks/useAuth";
import { ensureClubI18n } from "@/lib/i18n-club";

export const Route = createFileRoute("/club/specialization/$slug")({
  loader: ({ params }) => {
    const spec = findClubSpecialization(params.slug);
    if (spec === null) throw notFound();
    return { slug: spec.slug };
  },
  // Unikalny tytul/opis/OG per specjalizacja i per jezyk - patrz
  // `lib/clubs/specializationHead.ts` (jezyk z adresu zadania, nie z singletona
  // i18next, bo `head()` biegnie wspoldzielony miedzy rownolegle zadania SSR).
  head: ({ params }) => buildSpecializationHead(params.slug),
  component: ClubSpecializationPage,
});

const PILLARS = [
  { title: "club.spec.pillarAccess", desc: "club.spec.pillarAccessDesc" },
  { title: "club.spec.pillarIntel", desc: "club.spec.pillarIntelDesc" },
  { title: "club.spec.pillarNetwork", desc: "club.spec.pillarNetworkDesc" },
] as const;

function ClubSpecializationPage() {
  ensureClubI18n();
  const { t } = useTranslation();
  const { slug } = Route.useParams();
  const { session } = useAuth();
  const signedIn = Boolean(session);
  const spec = findClubSpecialization(slug);
  // Kluby czyta RPC z tymi samymi zasadami widocznosci co hub: anonim
  // dostanie wylacznie kluby publiczne, wiec sekcja nie wycieka nazw.
  const clubsQ = useClubsBySpecialization(slug);
  const clubs = clubsQ.data?.rows ?? [];

  if (spec === null) {
    return (
      <div className="mx-auto w-full max-w-[1600px] px-3 py-16 sm:px-5 lg:px-8">
        <Button asChild variant="outline">
          <Link to="/club">{t("club.backToHub")}</Link>
        </Button>
      </div>
    );
  }

  const Icon = spec.icon;

  return (
    <div className="club-prestige mx-auto w-full max-w-[1600px] px-3 py-6 sm:px-5 lg:px-8">
      <header
        className="relative overflow-hidden rounded-md border p-6 md:p-10 lg:p-14"
        style={{ background: "var(--cp-surface)", borderColor: "var(--cp-line)" }}
      >
        <div className="relative z-10 max-w-3xl">
          <Link
            to="/club"
            className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.28em]"
            style={{ color: "var(--cp-muted)" }}
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            {t("club.spec.backToSpecs")}
          </Link>

          <div className="mt-7 flex items-center gap-3">
            <Icon className="h-6 w-6" style={{ color: "var(--cp-gold)" }} aria-hidden="true" />
            <span
              className="font-display text-xs font-bold tracking-[0.28em]"
              style={{ color: "var(--cp-muted)" }}
            >
              {spec.index}
            </span>
          </div>

          <h1
            className="mt-4 font-display text-3xl font-black leading-[0.98] tracking-tight md:text-5xl"
            style={{ color: "var(--cp-ink)" }}
          >
            {t(`club.spec.items.${spec.key}.title`)}
          </h1>
          <p
            className="mt-5 text-base leading-relaxed md:text-lg"
            style={{ color: "var(--cp-gold)" }}
          >
            {t(`club.spec.items.${spec.key}.lead`)}
          </p>
          <p className="mt-4 text-sm leading-relaxed" style={{ color: "var(--cp-muted)" }}>
            {t(`club.spec.items.${spec.key}.desc`)}
          </p>

          <div className="mt-8">
            <Button
              asChild
              size="lg"
              className="border-0"
              style={{ background: "var(--cp-gold)", color: "var(--cp-gold-ink)" }}
            >
              <Link to="/club/apply" search={{ spec: spec.slug }}>
                {t("club.spec.applyCta")}
                <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden="true" />
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <section className="mt-8">
        <h2
          className="font-display text-xl font-bold tracking-tight md:text-2xl"
          style={{ color: "var(--cp-ink)" }}
        >
          {t("club.spec.pillarsTitle")}
        </h2>
        <ul className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
          {PILLARS.map((pillar) => (
            <li
              key={pillar.title}
              className="rounded-md border p-5"
              style={{ borderColor: "var(--cp-line)", background: "var(--cp-panel)" }}
            >
              <p
                className="flex items-center gap-2 font-display text-base font-bold"
                style={{ color: "var(--cp-ink)" }}
              >
                <Check className="h-4 w-4" style={{ color: "var(--cp-gold)" }} aria-hidden="true" />
                {t(pillar.title)}
              </p>
              <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--cp-muted)" }}>
                {t(pillar.desc)}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-10">
        <ClubDirectory
          title={t("club.spec.clubsTitle")}
          empty={signedIn ? t("club.spec.clubsEmpty") : t("club.spec.clubsAnon")}
          clubs={clubs}
          loading={clubsQ.isPending}
          layout="editorial"
        />
      </section>

      <section className="mt-10">
        <h2
          className="font-display text-xl font-bold tracking-tight"
          style={{ color: "var(--cp-ink)" }}
        >
          {t("club.spec.sectionTitle")}
        </h2>
        <ul className="mt-4 flex flex-wrap gap-2">
          {CLUB_SPECIALIZATIONS.filter((other) => other.slug !== spec.slug).map((other) => (
            <li key={other.slug}>
              <Link
                to="/club/specialization/$slug"
                params={{ slug: other.slug }}
                className="inline-flex rounded-md border px-3 py-1.5 text-xs font-medium transition-colors hover:border-[color:var(--cp-gold)]"
                style={{ borderColor: "var(--cp-line)", color: "var(--cp-ink)" }}
              >
                {t(`club.spec.items.${other.key}.title`)}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
