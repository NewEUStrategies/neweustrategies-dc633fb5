// Widget "event-sponsors" - strona sponsorow i partnerow wydarzenia:
// poziomy sponsorskie (np. Partner glowny / Zloci / Medialni) z siatka
// logotypow o rozmiarze zaleznym od rangi (lg/md/sm), opcjonalnymi opisami
// i linkami. Logotypy moga byc wyszarzone do hovera (spójnie z logo-cloud).
// i18n PL/EN, dark/light przez tokeny, 6px rounding, akcent --speakers-accent.
import { useMemo, type CSSProperties } from "react";
import type { WidgetContent } from "@/lib/builder/types";
import { safeImageUrl, safeUrl } from "@/lib/sanitize";
import { Handshake } from "@/lib/lucide-shim";
import { OptimizedImage } from "@/components/atoms/OptimizedImage";
import {
  parseSponsorTiers,
  type SponsorEntry,
  type SponsorTierSize as TierSize,
} from "@/lib/events/sponsors";
import { getBool, getStr, type Lang } from "./frame";

const GRID_BY_SIZE: Record<TierSize, string> = {
  lg: "grid-cols-1 sm:grid-cols-2",
  md: "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4",
  sm: "grid-cols-3 sm:grid-cols-4 lg:grid-cols-6",
};

const LOGO_H_BY_SIZE: Record<TierSize, string> = {
  lg: "h-16",
  md: "h-12",
  sm: "h-8",
};

function SponsorCard({
  sponsor,
  size,
  lang,
  grayscale,
}: {
  sponsor: SponsorEntry;
  size: TierSize;
  lang: Lang;
  grayscale: boolean;
}) {
  const logo = safeImageUrl(sponsor.logo);
  const url = sponsor.url ? safeUrl(sponsor.url, "") : "";
  const description =
    (lang === "pl" ? sponsor.description_pl : sponsor.description_en) ||
    sponsor.description_pl ||
    sponsor.description_en;
  const showDescription = size === "lg" && description;

  const body = (
    <article
      className={
        "flex h-full flex-col items-center justify-center gap-3 rounded-[6px] border border-border/60 bg-card p-4 text-center transition-all duration-300 " +
        (url
          ? "group-hover/spo:-translate-y-0.5 group-hover/spo:border-[color:var(--speakers-accent,var(--brand))]/40 group-hover/spo:shadow-md"
          : "")
      }
    >
      {logo ? (
        <OptimizedImage
          src={logo}
          alt={sponsor.name}
          className={
            `${LOGO_H_BY_SIZE[size]} w-auto max-w-full object-contain transition-all duration-300 ` +
            (grayscale
              ? "opacity-70 grayscale group-hover/spo:opacity-100 group-hover/spo:grayscale-0"
              : "")
          }
        />
      ) : (
        <span className="font-display text-base font-semibold text-foreground">{sponsor.name}</span>
      )}
      {logo && sponsor.name && size !== "sm" && (
        <span className="text-xs font-medium text-muted-foreground">{sponsor.name}</span>
      )}
      {showDescription && (
        <p className="cms-post-excerpt line-clamp-3 text-sm text-muted-foreground">{description}</p>
      )}
    </article>
  );

  if (url) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noreferrer noopener"
        aria-label={sponsor.name || undefined}
        className="group/spo block h-full rounded-[6px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--speakers-accent,var(--brand))]/50"
      >
        {body}
      </a>
    );
  }
  return body;
}

export function EventSponsorsView({ c, lang }: { c: WidgetContent; lang: Lang }) {
  const heading =
    getStr(c, `heading_${lang}`) || getStr(c, "heading_pl") || getStr(c, "heading_en");
  const intro = getStr(c, `intro_${lang}`) || getStr(c, "intro_pl") || getStr(c, "intro_en");
  const accent = getStr(c, "accentColor");
  const grayscale = getBool(c, "grayscale", true);
  const tiers = useMemo(() => parseSponsorTiers(c), [c]);
  const visibleTiers = tiers.filter((t) => t.sponsors.length > 0);

  const accentStyle: CSSProperties | undefined = accent
    ? { ["--speakers-accent" as string]: accent }
    : undefined;

  if (visibleTiers.length === 0) {
    return (
      <section className="cms-event-sponsors">
        <p className="rounded-[6px] border border-dashed border-border/70 p-10 text-center text-sm text-muted-foreground">
          {lang === "pl"
            ? "Dodaj poziomy sponsorskie i logotypy w panelu widgetu."
            : "Add sponsor tiers and logos in the widget panel."}
        </p>
      </section>
    );
  }

  return (
    <section className="cms-event-sponsors space-y-8" style={accentStyle}>
      {(heading || intro) && (
        <header className="space-y-2">
          {heading ? <h2 className="cms-block-heading text-foreground">{heading}</h2> : null}
          {intro ? <p className="max-w-2xl text-sm text-muted-foreground">{intro}</p> : null}
        </header>
      )}

      {visibleTiers.map((tier) => {
        const tierName =
          (lang === "pl" ? tier.name_pl : tier.name_en) || tier.name_pl || tier.name_en;
        return (
          <div key={tier.id} className="space-y-3">
            {tierName && (
              <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <Handshake aria-hidden className="h-3.5 w-3.5 text-brand-ink" />
                {tierName}
                <span aria-hidden className="h-px flex-1 bg-border/70" />
              </h3>
            )}
            <div className={`grid gap-3 sm:gap-4 ${GRID_BY_SIZE[tier.size]}`}>
              {tier.sponsors.map((sponsor) => (
                <SponsorCard
                  key={sponsor.id}
                  sponsor={sponsor}
                  size={tier.size}
                  lang={lang}
                  grayscale={grayscale}
                />
              ))}
            </div>
          </div>
        );
      })}
    </section>
  );
}
