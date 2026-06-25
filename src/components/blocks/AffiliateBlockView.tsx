// Affiliate product card (Foxiz-style).
import { Star } from "lucide-react";

interface Props {
  title: string;
  description?: string;
  image?: string;
  price?: string;
  currency?: string;
  store?: string;
  ctaLabel?: string;
  ctaHref?: string;
  rating?: number;
  sponsored?: boolean;
  lang?: "pl" | "en";
}

export function AffiliateBlockView(p: Props) {
  const L = p.lang === "pl"
    ? { sponsored: "Sponsorowane", buy: "Sprawdź ofertę", at: "w" }
    : { sponsored: "Sponsored", buy: "Check the offer", at: "at" };
  if (!p.title) return null;
  const rel = p.sponsored !== false ? "noopener noreferrer sponsored nofollow" : "noopener noreferrer";

  return (
    <aside className="not-prose my-6 rounded-lg border border-border bg-card overflow-hidden grid grid-cols-1 sm:grid-cols-[140px_1fr] gap-0">
      {p.image ? (
        <div className="bg-muted">
          <img src={p.image} alt={p.title} className="w-full h-full object-cover aspect-square sm:aspect-auto" loading="lazy" />
        </div>
      ) : (
        <div className="bg-muted aspect-square sm:aspect-auto" />
      )}
      <div className="p-4 flex flex-col gap-2">
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            {p.sponsored !== false && (
              <span className="inline-block text-[10px] uppercase tracking-wider text-muted-foreground border border-border rounded px-1.5 py-0.5 mb-1">
                {L.sponsored}
              </span>
            )}
            <h3 className="text-base font-semibold m-0 leading-tight">{p.title}</h3>
            {p.store && <p className="text-xs text-muted-foreground mt-0.5">{L.at} {p.store}</p>}
          </div>
          {p.price && (
            <div className="text-right shrink-0">
              <p className="text-lg font-bold leading-none">{p.price}</p>
              {p.currency && <p className="text-[10px] uppercase text-muted-foreground">{p.currency}</p>}
            </div>
          )}
        </div>
        {typeof p.rating === "number" && p.rating > 0 && (
          <div className="flex items-center gap-0.5">
            {[1, 2, 3, 4, 5].map((n) => (
              <Star
                key={n}
                className={`w-3.5 h-3.5 ${n <= Math.round(p.rating ?? 0) ? "fill-amber-400 text-amber-400" : "text-muted-foreground"}`}
              />
            ))}
            <span className="ml-1 text-xs text-muted-foreground">{p.rating.toFixed(1)}</span>
          </div>
        )}
        {p.description && <p className="text-sm text-muted-foreground m-0">{p.description}</p>}
        {p.ctaHref && (
          <a
            href={p.ctaHref}
            target="_blank"
            rel={rel}
            className="mt-1 inline-flex items-center justify-center px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 self-start"
          >
            {p.ctaLabel || L.buy}
          </a>
        )}
      </div>
    </aside>
  );
}
