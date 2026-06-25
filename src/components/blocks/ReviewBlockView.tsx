// Review Box — Foxiz style. Score badge + criterion bars + verdict + CTA.
// Emits schema.org Review JSON-LD when title/score are present.
interface Criterion { label: string; score: number }
interface Props {
  title?: string;
  summary?: string;
  criteria: Criterion[];
  ctaLabel?: string;
  ctaHref?: string;
  scale?: number;
  lang?: "pl" | "en";
}

function colorForScore(pct: number): string {
  if (pct >= 0.8) return "bg-emerald-500";
  if (pct >= 0.6) return "bg-lime-500";
  if (pct >= 0.4) return "bg-amber-500";
  if (pct >= 0.2) return "bg-orange-500";
  return "bg-red-500";
}

export function ReviewBlockView({
  title, summary, criteria, ctaLabel, ctaHref, scale = 10, lang = "pl",
}: Props) {
  const L = lang === "pl"
    ? { verdict: "Werdykt", overall: "Ocena ogólna", cta: "Sprawdź" }
    : { verdict: "Verdict", overall: "Overall score", cta: "Check it out" };
  const valid = (criteria ?? []).filter((c) => c.label.trim());
  const overall = valid.length
    ? valid.reduce((a, c) => a + c.score, 0) / valid.length
    : 0;
  const overallPct = overall / scale;

  const jsonLd = title ? {
    "@context": "https://schema.org",
    "@type": "Review",
    name: title,
    reviewRating: {
      "@type": "Rating",
      ratingValue: overall.toFixed(1),
      bestRating: scale,
      worstRating: 0,
    },
    reviewBody: summary || "",
  } : null;

  return (
    <section className="not-prose my-6 rounded-lg border border-border bg-card overflow-hidden">
      <div className="flex items-stretch">
        <div className={`flex flex-col items-center justify-center px-5 py-4 text-primary-foreground ${colorForScore(overallPct)}`}>
          <span className="text-3xl md:text-4xl font-bold leading-none">{overall.toFixed(1)}</span>
          <span className="text-[10px] uppercase tracking-wider opacity-90 mt-1">/ {scale}</span>
        </div>
        <div className="flex-1 px-4 py-3 min-w-0">
          {title && <h3 className="text-base font-semibold m-0 truncate">{title}</h3>}
          <p className="text-xs uppercase tracking-wider text-muted-foreground mt-0.5">{L.overall}</p>
        </div>
        {ctaLabel && ctaHref && (
          <a
            href={ctaHref}
            target="_blank"
            rel="noopener noreferrer sponsored"
            className="hidden sm:flex items-center px-5 bg-primary text-primary-foreground font-medium text-sm hover:bg-primary/90 transition"
          >
            {ctaLabel}
          </a>
        )}
      </div>
      {valid.length > 0 && (
        <div className="px-4 py-3 border-t border-border space-y-2">
          {valid.map((c, i) => {
            const pct = (c.score / scale) * 100;
            return (
              <div key={i} className="text-xs">
                <div className="flex justify-between mb-0.5">
                  <span className="font-medium text-foreground">{c.label}</span>
                  <span className="tabular-nums text-muted-foreground">{c.score.toFixed(1)}</span>
                </div>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div className={`h-full rounded-full ${colorForScore(c.score / scale)}`} style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
      {summary && (
        <div className="px-4 py-3 border-t border-border text-sm">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{L.verdict}</p>
          <p className="m-0 whitespace-pre-line">{summary}</p>
        </div>
      )}
      {ctaLabel && ctaHref && (
        <a
          href={ctaHref}
          target="_blank"
          rel="noopener noreferrer sponsored"
          className="sm:hidden flex items-center justify-center px-5 py-3 bg-primary text-primary-foreground font-medium text-sm hover:bg-primary/90 transition border-t border-border"
        >
          {ctaLabel}
        </a>
      )}
      {jsonLd && (
        <script
          type="application/ld+json"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      )}
    </section>
  );
}
