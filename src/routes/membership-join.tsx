// Publiczna strona członkostwa (/membership-join - "Dołącz do nas").
// Trasa statyczna wygrywa z resolverem CMS ($.tsx), więc zastępuje starą,
// zaimportowaną z WordPressa treść pełnoprawnym widokiem produktowym.
// Dane oferty (warstwy i plany) pochodzą z tych samych zapytań co /pricing,
// scope'owanych tenantem po stronie bazy - jedno źródło prawdy dla obu stron.
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { useAuth } from "@/hooks/useAuth";
import { billingKeys } from "@/lib/billing/keys";
import { fetchActivePlans, type AccessPlan } from "@/lib/billing/queries";
import { fetchMembershipTiers, type MembershipTierRow } from "@/lib/billing/tiers";
import { pricingAudiencesQueryOptions, type PricingAudienceRow } from "@/lib/pricing/queries";
import {
  staticPageSeoQueryOptions,
  pickStaticSeo,
  type StaticPageSeo,
} from "@/lib/queries/staticPageSeo";
import { anyDegraded, loadResilient, resilientCacheControl } from "@/lib/ssr/resilientLoad";
import { setCacheControlHeader } from "@/lib/http/responseHeaders";
import { activeLang } from "@/lib/seo/head";
import { getRequestUrl } from "@/lib/seo/request";
import { SITE_NAME } from "@/lib/seo/meta";
import { ensureI18n as ensureProfileI18n } from "@/lib/i18n-profile";
import { ensureI18n as ensurePricingI18n } from "@/lib/i18n-pricing";
import { ensureI18n as ensureJoinI18n } from "@/lib/i18n-membership-join";
import { JoinHero } from "@/components/membership-join/organisms/JoinHero";
import { JoinPillars } from "@/components/membership-join/organisms/JoinPillars";
import { JoinPath } from "@/components/membership-join/organisms/JoinPath";
import { JoinTiers } from "@/components/membership-join/organisms/JoinTiers";
import { JoinAudience } from "@/components/membership-join/organisms/JoinAudience";
import { JoinClosing } from "@/components/membership-join/organisms/JoinClosing";

/**
 * Wspólny termin ŻĄDANIA. Cztery odczyty biegną RÓWNOLEGLE, więc budżet jest
 * jeden dla wszystkich. `catch(() => null)` bronił przed BŁĘDEM, ale nie przed
 * POWOLNOŚCIĄ - jeden zwis trzymał stronę aż do watchdoga SSR.
 */
const JOIN_SSR_BUDGET_MS = 1_400;

/** Fallbacki renderu zdegradowanego - zasiew z `updatedAt: 0` (samoleczenie). */
const NO_SEO: StaticPageSeo = null;
const NO_AUDIENCES: PricingAudienceRow[] = [];
const NO_TIERS: MembershipTierRow[] = [];
const NO_PLANS: AccessPlan[] = [];

export const Route = createFileRoute("/membership-join")({
  component: MembershipJoinPage,
  loader: async ({ context }) => {
    const qc = context.queryClient;
    const deadlineAt = Date.now() + JOIN_SSR_BUDGET_MS;
    // Każde źródło degraduje niezależnie - strona wstaje nawet, gdy oferta
    // jest chwilowo niedostępna (sekcja warstw pokazuje wtedy pusty stan).
    const [seo, audiences, tiers, plans] = await Promise.all([
      loadResilient(qc, staticPageSeoQueryOptions("membership-join"), NO_SEO, {
        deadlineAt,
        label: "join-seo",
      }),
      loadResilient(qc, pricingAudiencesQueryOptions(), NO_AUDIENCES, {
        deadlineAt,
        label: "join-audiences",
      }),
      loadResilient(
        qc,
        { queryKey: billingKeys.membershipTiers(), queryFn: fetchMembershipTiers },
        NO_TIERS,
        { deadlineAt, label: "join-tiers" },
      ),
      loadResilient(
        qc,
        { queryKey: billingKeys.plansActive(), queryFn: fetchActivePlans },
        NO_PLANS,
        { deadlineAt, label: "join-plans" },
      ),
    ]);
    // BRAMKA NAGŁÓWKA, której ta trasa nie miała: strona zapisu z PUSTĄ ofertą
    // nie ma prawa zamarznąć na brzegu jako wariant wszystkich czytelników.
    setCacheControlHeader(resilientCacheControl(anyDegraded(seo, audiences, tiers, plans)));
    return { seo: seo.data };
  },
  head: ({ loaderData }) => {
    const lang = activeLang(getRequestUrl() || "/membership-join");
    const isEn = lang === "en";
    const seo = pickStaticSeo(loaderData?.seo ?? null, lang, {
      title: isEn
        ? `Join us - New European Strategies membership`
        : `Dołącz do nas - członkostwo ${SITE_NAME}`,
      description: isEn
        ? "Become a New European Strategies member: analyses, discussion clubs, an expert network and real influence on the European agenda."
        : "Zostań członkiem New European Strategies: analizy, kluby dyskusyjne, sieć ekspertów i realny wpływ na europejską agendę.",
    });
    const meta: Array<Record<string, string>> = [
      { title: seo.title },
      { name: "description", content: seo.description },
      { property: "og:title", content: seo.title },
      { property: "og:description", content: seo.description },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ];
    if (seo.image) {
      meta.push({ property: "og:image", content: seo.image });
      meta.push({ name: "twitter:image", content: seo.image });
    }
    if (seo.noindex) meta.push({ name: "robots", content: "noindex,nofollow" });
    return { meta, links: seo.canonical ? [{ rel: "canonical", href: seo.canonical }] : [] };
  },
  errorComponent: ({ error }) => (
    <div role="alert" className="container mx-auto max-w-3xl px-4 py-16 text-sm text-destructive">
      {error.message}
    </div>
  ),
});

function MembershipJoinPage() {
  // Słowniki rejestrowane w chunku trasy - patrz lib/i18n-*.
  ensureProfileI18n();
  ensurePricingI18n();
  ensureJoinI18n();
  const { t } = useTranslation();
  const { session } = useAuth();
  const isAuthenticated = session !== null;

  return (
    <div className="container mx-auto max-w-6xl px-4 py-10 md:py-14 xl:max-w-[88rem]">
      {/* Jedyny H1 strony siedzi w JoinHero. */}
      <JoinHero isAuthenticated={isAuthenticated} />
      <JoinPillars />
      <JoinTiers isAuthenticated={isAuthenticated} />
      <JoinPath />
      <JoinAudience />
      <JoinClosing isAuthenticated={isAuthenticated} />
      <p className="sr-only">{t("membershipJoin.seo.description")}</p>
    </div>
  );
}
