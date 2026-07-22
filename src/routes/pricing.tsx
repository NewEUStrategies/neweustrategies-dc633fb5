// Cennik 2.0 - oferta segmentowana per odbiorca (Dla Ciebie / Dla firm /
// Edukacja i NGO / Dla zespołów), w pełni CMS-owa:
//   pricing_audiences  -> przełącznik segmentów (?audience= w URL, deep-link),
//   membership_tiers   -> karty warstw (benefity NYT/FT, badge, highlight),
//   access_plans       -> ceny kart (framing miesięczny planów rocznych,
//                         realny % oszczędności - psychologia Netflix/Apple),
//   pricing_faq_items  -> FAQ (globalne + segmentowe) z zachowaną animacją.
// Wszystkie dane prefetchowane w loaderze (SSR bez migotania); warstwy bez
// segmentu nigdy nie znikają (lądują w pierwszym segmencie), a plany cykliczne
// bez warstwy dostają własną sekcję - rozjazd danych nie chowa oferty.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ShieldCheck, RefreshCcw, Zap } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { fetchActivePlans, fetchMySubscription } from "@/lib/billing/queries";
import { fetchMembershipTiers, useCurrentTier, useMembershipTiers } from "@/lib/billing/tiers";
import type { MembershipTierRow } from "@/lib/billing/tiers";
import {
  pricingAudiencesQueryOptions,
  pricingFaqQueryOptions,
  usePricingAudiences,
  usePricingFaq,
  type PricingFaqItemRow,
} from "@/lib/pricing/queries";
import {
  audienceTagline,
  faqForAudience,
  hasBothIntervals,
  maxYearlySavingsPct,
  passPlans,
  plansByTierKey,
  recurringPlans,
  sanitizeAudienceKey,
  sortTiers,
  tiersForAudience,
  type BillingInterval,
} from "@/lib/pricing/selectors";
import { AudienceSwitcher } from "@/components/pricing/AudienceSwitcher";
import { audiencePanelId, audienceTabId } from "@/components/pricing/audienceMeta";
import { IntervalToggle } from "@/components/pricing/IntervalToggle";
import { TierCard } from "@/components/pricing/TierCard";
import { SupporterStrip } from "@/components/pricing/SupporterStrip";
import { ComparisonTable } from "@/components/pricing/ComparisonTable";
import { PricingFaq } from "@/components/pricing/PricingFaq";
import { ContactSalesDialog } from "@/components/pricing/ContactSalesDialog";
import { PlanCard } from "@/components/billing/PlanCard";
import { activeLang } from "@/lib/seo/head";
import { getRequestUrl } from "@/lib/seo/request";
import { staticPageSeoQueryOptions, pickStaticSeo } from "@/lib/queries/staticPageSeo";
import { ensureI18n as ensureProfileI18n } from "@/lib/i18n-profile";
import { ensureI18n as ensurePricingI18n } from "@/lib/i18n-pricing";

export const Route = createFileRoute("/pricing")({
  component: PricingPage,
  validateSearch: (search: Record<string, unknown>): { audience?: string } => {
    const audience = sanitizeAudienceKey(search.audience);
    return audience ? { audience } : {};
  },
  loader: async ({ context }) => {
    const qc = context.queryClient;
    // Prefetch całości cennika: SSR renderuje finalny układ bez migotania,
    // a nawigacja kliencka trafia w ciepły cache. Każde źródło degraduje
    // niezależnie (catch -> null), strona zawsze wstaje.
    const [seo] = await Promise.all([
      qc.ensureQueryData(staticPageSeoQueryOptions("pricing")).catch(() => null),
      qc.ensureQueryData(pricingAudiencesQueryOptions()).catch(() => null),
      qc.ensureQueryData(pricingFaqQueryOptions()).catch(() => null),
      qc
        .ensureQueryData({ queryKey: ["membership-tiers"], queryFn: fetchMembershipTiers })
        .catch(() => null),
      qc
        .ensureQueryData({ queryKey: ["plans-active"], queryFn: fetchActivePlans })
        .catch(() => null),
    ]);
    return { seo };
  },
  head: ({ loaderData }) => {
    const lang = activeLang(getRequestUrl() || "/pricing");
    const seo = pickStaticSeo(loaderData?.seo ?? null, lang, {
      title: lang === "en" ? "Pricing - Subscription plans" : "Cennik - Plany subskrypcji",
      description:
        lang === "en"
          ? "Choose the plan that fits your needs. Monthly and yearly subscriptions."
          : "Wybierz plan dopasowany do Twoich potrzeb. Subskrypcje miesięczne i roczne.",
    });
    const meta: Array<Record<string, string>> = [
      { title: seo.title },
      { name: "description", content: seo.description },
      { property: "og:title", content: seo.title },
      { property: "og:description", content: seo.description },
    ];
    if (seo.image) meta.push({ property: "og:image", content: seo.image });
    if (seo.noindex) meta.push({ name: "robots", content: "noindex,nofollow" });
    return {
      meta,
      links: seo.canonical ? [{ rel: "canonical", href: seo.canonical }] : [],
    };
  },
});

function PricingPage() {
  // Rejestracja słowników w chunku trasy (nie w entry) - patrz lib/i18n-*.
  ensureProfileI18n();
  ensurePricingI18n();
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { session } = useAuth();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  const audiencesQ = usePricingAudiences();
  const faqQ = usePricingFaq();
  const tiersQ = useMembershipTiers();
  const plansQ = useQuery({ queryKey: ["plans-active"], queryFn: fetchActivePlans });
  const mySub = useQuery({
    queryKey: ["my-subscription"],
    queryFn: fetchMySubscription,
    enabled: !!session,
  });
  const currentTier = useCurrentTier();

  // Kotwica roczna (Netflix/Apple): domyślnie pokazujemy rozliczenie roczne;
  // segmenty bez planów rocznych i tak uczciwie spadają na ceny miesięczne.
  const [interval, setIntervalValue] = useState<BillingInterval>("year");
  const [contactOpen, setContactOpen] = useState(false);
  const [contactTier, setContactTier] = useState<MembershipTierRow | null>(null);

  const audiences = useMemo(() => audiencesQ.data ?? [], [audiencesQ.data]);
  const tiersAll = useMemo(() => tiersQ.data ?? [], [tiersQ.data]);
  const plansAll = useMemo(() => plansQ.data ?? [], [plansQ.data]);

  const defaultAudienceKey = audiences[0]?.key ?? null;
  const requestedKey = sanitizeAudienceKey(search.audience);
  const activeKey =
    requestedKey && audiences.some((a) => a.key === requestedKey)
      ? requestedKey
      : defaultAudienceKey;
  const activeAudience = audiences.find((a) => a.key === activeKey) ?? null;
  const isFirstAudience = activeKey === defaultAudienceKey;

  const setAudience = (key: string) => {
    void navigate({
      search: key === defaultAudienceKey ? {} : { audience: key },
      replace: true,
      resetScroll: false,
    });
  };

  const activeTiers = useMemo(
    () =>
      audiences.length > 0 && activeKey
        ? tiersForAudience(tiersAll, audiences, activeKey)
        : sortTiers(tiersAll),
    [tiersAll, audiences, activeKey],
  );
  const cardTiers = useMemo(
    () => activeTiers.filter((tier) => tier.key !== "supporter"),
    [activeTiers],
  );
  const supporterTier = activeTiers.find((tier) => tier.key === "supporter") ?? null;

  const plansMap = useMemo(() => plansByTierKey(plansAll), [plansAll]);
  const audiencePlans = useMemo(
    () => cardTiers.flatMap((tier) => plansMap.get(tier.key) ?? []),
    [cardTiers, plansMap],
  );
  const showToggle = hasBothIntervals(audiencePlans);
  const toggleSavings = maxYearlySavingsPct(audiencePlans);

  // Siatka bez martwych łączy danych: przepustki (dzień/tydzień/jednorazowe)
  // oraz plany cykliczne niepodpięte pod żadną warstwę dostają własne sekcje.
  const passes = useMemo(() => passPlans(plansAll), [plansAll]);
  const orphanPlans = useMemo(() => {
    const tierKeys = new Set(tiersAll.map((tier) => tier.key));
    return recurringPlans(plansAll).filter((p) => !p.tier_key || !tierKeys.has(p.tier_key));
  }, [plansAll, tiersAll]);

  const faqItems: PricingFaqItemRow[] = useMemo(() => {
    const db = faqQ.data ?? [];
    if (db.length > 0) return faqForAudience(db, activeKey);
    // Fallback: statyczne FAQ z i18n (stan sprzed migracji) - strona nigdy
    // nie zostaje bez sekcji pytań.
    const raw = t("pricing.faq", { returnObjects: true });
    const list = Array.isArray(raw) ? (raw as { q: string; a: string }[]) : [];
    return list.map((item, index) => ({
      id: `i18n-${index}`,
      tenant_id: "",
      audience_key: null,
      question_pl: item.q,
      question_en: item.q,
      answer_pl: item.a,
      answer_en: item.a,
      sort_order: index,
      active: true,
      created_at: "",
      updated_at: "",
    }));
  }, [faqQ.data, activeKey, t]);

  const openContact = (tier: MembershipTierRow | null) => {
    setContactTier(tier);
    setContactOpen(true);
  };

  const currentPlanId = mySub.data?.plan_id ?? null;
  const currentTierKey = currentTier.data?.key ?? null;

  const gridCls =
    cardTiers.length <= 1
      ? "mx-auto grid max-w-md gap-6"
      : cardTiers.length === 2
        ? "mx-auto grid max-w-3xl gap-6 sm:grid-cols-2"
        : cardTiers.length === 3
          ? "grid gap-6 md:grid-cols-2 lg:grid-cols-3"
          : "grid gap-6 md:grid-cols-2 xl:grid-cols-4";

  const isLoading = audiencesQ.isLoading || tiersQ.isLoading || plansQ.isLoading;
  const crossSellBusiness = audiences.find((a) => a.key === "business") ?? null;
  const crossSellTeam = audiences.find((a) => a.key === "team") ?? null;

  return (
    <div className="container mx-auto max-w-6xl px-4 py-12 md:py-16">
      <header className="text-center mb-8">
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight">{t("pricing.title")}</h1>
        <p className="mt-4 text-lg text-muted-foreground">{t("pricing.subtitle")}</p>
      </header>

      {/* Trust signals */}
      <ul className="mb-10 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm text-muted-foreground">
        <li className="inline-flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary" aria-hidden="true" />
          {t("pricing.trust.secure")}
        </li>
        <li className="inline-flex items-center gap-2">
          <RefreshCcw className="h-4 w-4 text-primary" aria-hidden="true" />
          {t("pricing.trust.cancel")}
        </li>
        <li className="inline-flex items-center gap-2">
          <Zap className="h-4 w-4 text-primary" aria-hidden="true" />
          {t("pricing.trust.instant")}
        </li>
      </ul>

      {audiences.length > 1 && activeKey && (
        <div className="mb-8">
          <AudienceSwitcher
            audiences={audiences}
            value={activeKey}
            onChange={setAudience}
            lang={lang}
            label={t("pricing.segmentsAria")}
          />
        </div>
      )}


      {showToggle && (
        <div className="mb-8 flex justify-center">
          <div
            role="group"
            aria-label={t("pricing.title")}
            className="inline-flex rounded-full border border-border bg-muted/40 p-1"
          >
            {(["month", "year"] as const).map((iv) => (
              <button
                key={iv}
                type="button"
                aria-pressed={interval === iv}
                onClick={() => setInterval(iv)}
                className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                  interval === iv
                    ? "bg-background text-foreground shadow"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {iv === "month" ? t("pricing.intervalMonthly") : t("pricing.intervalYearly")}
              </button>
            ))}
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-96 animate-pulse rounded-xl border border-border bg-muted/30"
            />
          ))}
        </div>
      ) : (
        <div
          key={activeKey ?? "all"}
          role={audiences.length > 1 && activeKey ? "tabpanel" : undefined}
          id={activeKey ? audiencePanelId(activeKey) : undefined}
          aria-labelledby={audiences.length > 1 && activeKey ? audienceTabId(activeKey) : undefined}
          className="animate-in fade-in slide-in-from-bottom-2 duration-300"
        >
          {activeAudience && audienceTagline(activeAudience, lang) && (
            <p className="mx-auto mt-6 max-w-2xl text-center text-base text-muted-foreground">
              {audienceTagline(activeAudience, lang)}
            </p>
          )}

          {showToggle && (
            <div className="mt-8">
              <IntervalToggle
                value={interval}
                onChange={setIntervalValue}
                savingsPct={toggleSavings}
              />
            </div>
          )}

          {cardTiers.length === 0 ? (
            <p className="mt-12 text-center text-muted-foreground">{t("pricing.empty")}</p>
          ) : (
            <div className={`mt-10 ${gridCls}`}>
              {cardTiers.map((tier) => (
                <TierCard
                  key={tier.id}
                  tier={tier}
                  plans={plansMap.get(tier.key) ?? []}
                  interval={interval}
                  lang={lang}
                  isCurrentTier={currentTierKey === tier.key}
                  currentPlanId={currentPlanId}
                  isAuthenticated={!!session}
                  onContact={openContact}
                />
              ))}
            </div>
          )}

          {supporterTier && <SupporterStrip tier={supporterTier} lang={lang} />}

          {/* Cross-sell między segmentami zespołowym a korporacyjnym - miękka
              nawigacja zamiast ślepej uliczki, gdy potrzeby są większe/mniejsze. */}
          {activeKey === "team" && crossSellBusiness && (
            <CrossSellBand
              text={t("pricing.crossSell.toBusiness")}
              cta={t("pricing.crossSell.toBusinessCta")}
              audienceKey="business"
            />
          )}
          {activeKey === "business" && crossSellTeam && (
            <CrossSellBand
              text={t("pricing.crossSell.toTeam")}
              cta={t("pricing.crossSell.toTeamCta")}
              audienceKey="team"
            />
          )}

          {isFirstAudience && orphanPlans.length > 0 && (
            <section className="mt-16">
              <h2 className="mb-6 text-center text-2xl font-bold tracking-tight">
                {t("pricing.morePlansTitle")}
              </h2>
              <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                {orphanPlans.map((plan) => (
                  <PlanCard key={plan.id} plan={plan} isCurrent={currentPlanId === plan.id} />
                ))}
              </div>
            </section>
          )}

          {isFirstAudience && passes.length > 0 && (
            <section className="mt-16">
              <h2 className="text-center text-2xl font-bold tracking-tight">
                {t("pricing.passesTitle")}
              </h2>
              <p className="mx-auto mt-2 max-w-2xl text-center text-sm text-muted-foreground">
                {t("pricing.passesSubtitle")}
              </p>
              <div className="mt-6 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                {passes.map((plan) => (
                  <PlanCard key={plan.id} plan={plan} isCurrent={currentPlanId === plan.id} />
                ))}
              </div>
            </section>
          )}

          <ComparisonTable tiers={cardTiers} lang={lang} />

          <PricingFaq
            key={`faq-${activeKey ?? "all"}`}
            items={faqItems}
            lang={lang}
            title={t("pricing.faqTitle")}
          />

          {/* Pas kontaktowy - wyjście awaryjne dla niezdecydowanych. */}
          <section className="mx-auto mt-16 max-w-3xl rounded-2xl border border-border bg-muted/20 p-8 text-center">
            <h2 className="text-xl font-bold tracking-tight">{t("pricing.contactBand.title")}</h2>
            <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">
              {t("pricing.contactBand.body")}
            </p>
            <Button className="mt-5" variant="outline" onClick={() => openContact(null)}>
              {t("pricing.contactBand.cta")}
              <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
            </Button>
          </section>
        </div>
      )}

      <ContactSalesDialog
        open={contactOpen}
        onOpenChange={setContactOpen}
        tier={contactTier}
        lang={lang}
      />
    </div>
  );
}

function CrossSellBand({
  text,
  cta,
  audienceKey,
}: {
  text: string;
  cta: string;
  audienceKey: string;
}) {
  return (
    <div className="mt-6 flex flex-col items-center justify-between gap-3 rounded-xl border border-dashed border-border p-5 text-center sm:flex-row sm:text-left">
      <p className="text-sm text-muted-foreground">{text}</p>
      <Button asChild size="sm" variant="ghost" className="shrink-0">
        <Link to="/pricing" search={{ audience: audienceKey }} resetScroll={false}>
          {cta}
          <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden="true" />
        </Link>
      </Button>
    </div>
  );
}
