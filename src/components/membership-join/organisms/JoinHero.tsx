// Organizm: nagłówek strony "Dołącz do nas". CTA zależy od stanu sesji -
// zalogowany członek nie dostaje przycisku rejestracji, tylko skrót do profilu.
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ArrowRight, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { JoinStat } from "../atoms/JoinStat";

const STAT_KEYS = ["analyses", "experts", "clubs", "events"] as const;

export function JoinHero({ isAuthenticated }: { isAuthenticated: boolean }) {
  const { t } = useTranslation();

  return (
    <header className="relative isolate overflow-hidden rounded-[6px] border border-border/70 bg-card/50 px-5 py-10 sm:px-8 sm:py-14">
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(120%_120%_at_10%_-10%,color-mix(in_oklab,var(--primary)_18%,transparent),transparent_60%)]"
      />
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
        {t("membershipJoin.eyebrow")}
      </p>
      <h1 className="mt-3 max-w-3xl text-balance text-3xl font-black leading-[1.1] tracking-tight text-foreground sm:text-4xl lg:text-5xl">
        {t("membershipJoin.title")}
      </h1>
      <p className="mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
        {t("membershipJoin.lead")}
      </p>

      <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        {isAuthenticated ? (
          <Button asChild size="lg" className="gap-2">
            <Link to="/profile">
              {t("membershipJoin.ctaMember")}
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </Button>
        ) : (
          <Button asChild size="lg" className="gap-2">
            <Link to="/membership-registration">
              {t("membershipJoin.ctaPrimary")}
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </Button>
        )}
        <Button asChild size="lg" variant="outline">
          <Link to="/pricing">{t("membershipJoin.ctaSecondary")}</Link>
        </Button>
      </div>

      {!isAuthenticated ? (
        <p className="mt-3 inline-flex items-center gap-2 text-xs text-muted-foreground">
          <ShieldCheck className="h-4 w-4 shrink-0 text-primary" aria-hidden />
          {t("membershipJoin.trust")}
        </p>
      ) : null}

      <dl className="mt-9 grid grid-cols-2 gap-5 border-t border-border/60 pt-6 sm:grid-cols-4">
        {STAT_KEYS.map((key) => (
          <JoinStat
            key={key}
            value={t(`membershipJoin.stats.${key}.value`)}
            label={t(`membershipJoin.stats.${key}.label`)}
          />
        ))}
      </dl>
    </header>
  );
}
