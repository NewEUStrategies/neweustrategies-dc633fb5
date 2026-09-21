// Wspólny panel powitalny po aktywacji konta (/welcome) oraz po zakupie
// (/checkout/success). Źródłem benefitów jest warstwa członkostwa użytkownika
// rozstrzygana serwerowo (RPC current_membership_tier) - klient tylko
// prezentuje gotowy klucz warstwy i jej listę korzyści z membership_tiers.
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Check, Loader2 } from "@/lib/lucide-shim";
import { resolveSetting, siteSettingsQueryOptions } from "@/lib/useSiteSetting";
import { useTheme } from "@/components/ThemeProvider";
import { Button } from "@/components/ui/button";
import {
  parseTierBenefits,
  tierName,
  useCurrentTier,
  useMembershipTiers,
  type MembershipTierRow,
  type TierBenefit,
} from "@/lib/billing/tiers";

const BRAND_NAME = "New European Strategies";

type ThemeLogoCfg = {
  logo?: { main?: string; main_dark?: string; mobile?: string; mobile_dark?: string };
};

/**
 * Znak marki New European Strategies zamiast ikony dekoracyjnej. Logo pochodzi
 * z ustawień motywu (Branding -> Logo), z wariantem dla trybu ciemnego; gdy
 * administrator nie wgrał pliku, zostaje sam wyróżniony napis marki.
 */
function BrandMark() {
  const { data: settingsMap } = useQuery(siteSettingsQueryOptions);
  const { theme } = useTheme();
  const cfg = resolveSetting<ThemeLogoCfg>(settingsMap, "theme_options", {});
  const logo = cfg.logo ?? {};
  const src =
    theme === "dark"
      ? logo.main_dark || logo.mobile_dark || logo.main || logo.mobile || ""
      : logo.main || logo.mobile || logo.main_dark || logo.mobile_dark || "";
  if (!src) return null;
  return (
    <img
      src={src}
      alt={BRAND_NAME}
      className="h-6 w-auto shrink-0 object-contain"
      loading="lazy"
      decoding="async"
      data-testid="membership-welcome-logo"
    />
  );
}

export type WelcomeMode = "activated" | "upgraded";

interface Copy {
  title: string;
  subtitle: string;
  benefitsTitle: string;
  loading: string;
  empty: string;
  explore: string;
  profile: string;
  upgrade: string;
  upgradeHint: string;
}

export function welcomeCopy(lang: "pl" | "en", mode: WelcomeMode, planName: string): Copy {
  if (lang === "en") {
    return {
      title:
        mode === "upgraded"
          ? "Your plan is active"
          : "Congratulations, you are a member of New European Strategies",
      subtitle:
        mode === "upgraded"
          ? `Your ${planName} plan is now active on your account.`
          : `Your account is active. Plan: ${planName}.`,
      benefitsTitle: `What your ${planName} plan includes`,
      loading: "Loading your plan benefits…",
      empty: "Benefits for this plan will appear here shortly.",
      explore: "Explore the platform",
      profile: "Go to my profile",
      upgrade: "Compare plans",
      upgradeHint: "Need more? See what higher plans add.",
    };
  }
  return {
    title:
      mode === "upgraded"
        ? "Twój plan jest aktywny"
        : "Gratulacje, jesteś członkiem New European Strategies",
    subtitle:
      mode === "upgraded"
        ? `Plan ${planName} jest już aktywny na Twoim koncie.`
        : `Twoje konto jest aktywne. Plan: ${planName}.`,
    benefitsTitle: `Lista benefitów planu ${planName}`,
    loading: "Wczytujemy korzyści Twojego planu…",
    empty: "Korzyści tego planu pojawią się tutaj wkrótce.",
    explore: "Przejdź do platformy",
    profile: "Przejdź do profilu",
    upgrade: "Porównaj plany",
    upgradeHint: "Potrzebujesz więcej? Zobacz, co dają wyższe plany.",
  };
}

function benefitText(benefit: TierBenefit, lang: "pl" | "en"): string {
  return lang === "en" ? benefit.en || benefit.pl : benefit.pl || benefit.en;
}

function benefitDetail(benefit: TierBenefit, lang: "pl" | "en"): string {
  const detail = lang === "en" ? benefit.detail_en : benefit.detail_pl;
  return detail ?? "";
}

export function MembershipWelcome({ mode = "activated" }: { mode?: WelcomeMode }) {
  const { i18n } = useTranslation();
  const lang: "pl" | "en" = i18n.language?.startsWith("en") ? "en" : "pl";
  const tierQ = useCurrentTier();
  const tiersQ = useMembershipTiers();

  const tiers: MembershipTierRow[] = tiersQ.data ?? [];
  const currentKey = tierQ.data?.key ?? null;
  const row = currentKey ? (tiers.find((t) => t.key === currentKey) ?? null) : null;
  const planName = row
    ? tierName(row, lang)
    : tierQ.data
      ? lang === "en"
        ? tierQ.data.name_en || tierQ.data.name_pl
        : tierQ.data.name_pl || tierQ.data.name_en
      : "";
  const copy = welcomeCopy(lang, mode, planName || (lang === "en" ? "Member" : "Członkowski"));
  const benefits = row ? parseTierBenefits(row.benefits) : [];
  const maxRank = tiers.reduce((acc, t) => (t.rank > acc ? t.rank : acc), 0);
  const canUpgrade = (tierQ.data?.rank ?? 0) < maxRank;
  const loading = tierQ.isLoading || tiersQ.isLoading;

  return (
    <section className="mx-auto w-full max-w-3xl" data-testid="membership-welcome">
      <div className="rounded-[6px] border bg-card p-6 sm:p-8">
        <div className="flex items-center gap-2 text-primary">
          <BrandMark />
          <span className="text-xs font-semibold uppercase tracking-[0.14em]">{BRAND_NAME}</span>
        </div>
        <h1 className="mt-3 text-2xl font-semibold leading-tight sm:text-3xl">{copy.title}</h1>
        <p className="mt-2 text-muted-foreground">{copy.subtitle}</p>

        <h2 className="mt-8 text-lg font-semibold">{copy.benefitsTitle}</h2>
        {loading ? (
          <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            {copy.loading}
          </p>
        ) : benefits.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">{copy.empty}</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {benefits.map((benefit, index) => {
              const detail = benefitDetail(benefit, lang);
              return (
                <li key={`${benefitText(benefit, lang)}-${index}`} className="flex gap-3">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] bg-primary/10 text-primary">
                    <Check className="h-3.5 w-3.5" aria-hidden="true" />
                  </span>
                  <span>
                    <span className="block text-sm font-medium">{benefitText(benefit, lang)}</span>
                    {detail ? (
                      <span className="block text-sm text-muted-foreground">{detail}</span>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        <div className="mt-8 flex flex-wrap gap-3">
          <Button asChild className="h-12 rounded-[6px]">
            <Link to="/">{copy.explore}</Link>
          </Button>
          <Button asChild variant="outline" className="h-12 rounded-[6px]">
            <Link to="/profile">{copy.profile}</Link>
          </Button>
          {canUpgrade ? (
            <Button asChild variant="ghost" className="h-12 rounded-[6px]">
              <Link to="/pricing">{copy.upgrade}</Link>
            </Button>
          ) : null}
        </div>
        {canUpgrade ? (
          <p className="mt-3 text-xs text-muted-foreground">{copy.upgradeHint}</p>
        ) : null}
      </div>
    </section>
  );
}
