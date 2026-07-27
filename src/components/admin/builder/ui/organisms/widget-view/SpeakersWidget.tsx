// Widget "Speakers" - kartowa siatka prelegentów z filtrem kategorii.
// Wzorzec UI zainspirowany designem "mentors-section" (portret + rola + ocena
// + opis), zaadaptowany do naszej typografii (.cms-*), tokenów Theme Design
// i dark/light modes. Każdy speaker ma pola i18n (rola/kategoria/opis) oraz
// opcjonalny link `href` (np. do profilu eksperta).
import { useMemo, useState, type CSSProperties } from "react";
import type { WidgetNode, WidgetContent } from "@/lib/builder/types";
import { safeImageUrl, safeUrl } from "@/lib/sanitize";
import { Star, User as UserIcon } from "@/lib/lucide-shim";
import { OptimizedImage } from "@/components/atoms/OptimizedImage";
import { AppLink } from "@/components/atoms/AppLink";
import { getStr, type Lang } from "./frame";

type SpeakerItem = Record<string, unknown>;

const ALL_KEY = "__all__";

function loc(item: SpeakerItem, base: string, lang: Lang): string {
  const v =
    (item[`${base}_${lang}`] as unknown) ??
    (item[`${base}_pl`] as unknown) ??
    (item[`${base}_en`] as unknown) ??
    item[base];
  return typeof v === "string" ? v : "";
}

function numOf(v: unknown, fallback = 0): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function StarRow({ rating }: { rating: number }) {
  const rounded = Math.round(rating);
  return (
    <span aria-hidden className="inline-flex items-center gap-[1px]">
      {[0, 1, 2, 3, 4].map((i) => (
        <Star
          key={i}
          className={
            "h-3 w-3 " +
            (i < rounded ? "fill-[color:var(--brand)] text-[color:var(--brand)]" : "text-muted-foreground/40")
          }
        />
      ))}
    </span>
  );
}

export function SpeakersWidget({ node, lang }: { node: WidgetNode; lang: Lang }) {
  const c = (node.content ?? {}) as WidgetContent;
  const cRaw = c as unknown as Record<string, unknown>;

  const heading = loc(cRaw, "heading", lang);
  const columnsRaw = numOf(cRaw.columns, 3);
  const columns = Math.min(4, Math.max(2, Math.round(columnsRaw))) as 2 | 3 | 4;
  const accent = getStr(c, "accentColor") || "var(--brand)";

  const speakers: SpeakerItem[] = Array.isArray(cRaw.speakers)
    ? (cRaw.speakers as unknown[]).filter(
        (x): x is SpeakerItem => typeof x === "object" && x !== null && !Array.isArray(x),
      )
    : [];

  const categories = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const s of speakers) {
      const cat = loc(s, "category", lang).trim();
      if (!cat || seen.has(cat)) continue;
      seen.add(cat);
      out.push(cat);
    }
    return out;
  }, [speakers, lang]);

  const [active, setActive] = useState<string>(ALL_KEY);

  const visible = useMemo(() => {
    if (active === ALL_KEY) return speakers;
    return speakers.filter((s) => loc(s, "category", lang).trim() === active);
  }, [speakers, active, lang]);

  const gridClass =
    columns === 2
      ? "sm:grid-cols-2"
      : columns === 4
        ? "sm:grid-cols-2 lg:grid-cols-4"
        : "sm:grid-cols-2 lg:grid-cols-3";

  const accentStyle: CSSProperties = { ["--speakers-accent" as string]: accent };
  const allLabel = lang === "pl" ? "Wszyscy" : "All";

  return (
    <section className="cms-speakers space-y-6" style={accentStyle}>
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        {heading ? <h2 className="cms-block-heading text-foreground">{heading}</h2> : <span />}
        {(categories.length > 0 || speakers.length > 0) && (
          <div
            role="tablist"
            aria-label={lang === "pl" ? "Filtruj prelegentów" : "Filter speakers"}
            className="flex flex-wrap gap-1.5"
          >
            <FilterChip
              active={active === ALL_KEY}
              onClick={() => setActive(ALL_KEY)}
              label={allLabel}
            />
            {categories.map((cat) => (
              <FilterChip
                key={cat}
                active={active === cat}
                onClick={() => setActive(cat)}
                label={cat}
              />
            ))}
          </div>
        )}
      </header>

      <div
        key={active}
        className={`grid animate-in fade-in-0 duration-200 grid-cols-1 ${gridClass} gap-4 sm:gap-5`}
      >
        {visible.map((s, i) => (
          <SpeakerCard key={(s.id as string) ?? i} item={s} lang={lang} />
        ))}
        {visible.length === 0 && (
          <p className="cms-meta col-span-full text-center italic text-muted-foreground">
            {lang === "pl" ? "Brak prelegentów w tej kategorii." : "No speakers in this category."}
          </p>
        )}
      </div>
    </section>
  );
}

function FilterChip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={
        "rounded-[6px] px-3 py-1.5 text-xs font-medium transition-colors " +
        (active
          ? "bg-[color:var(--speakers-accent)] text-white shadow-sm"
          : "bg-muted text-muted-foreground hover:bg-muted/70")
      }
    >
      {label}
    </button>
  );
}

function SpeakerCard({ item, lang }: { item: SpeakerItem; lang: Lang }) {
  const photo = safeImageUrl(getStr(item as WidgetContent, "photo") || getStr(item as WidgetContent, "image"));
  const name = getStr(item as WidgetContent, "name");
  const role = loc(item, "role", lang);
  const description = loc(item, "description", lang);
  const gigs = numOf(item.gigs);
  const rating = numOf(item.rating);
  const reviews = numOf(item.reviews);
  const rawHref = getStr(item as WidgetContent, "href");
  const href = rawHref ? safeUrl(rawHref, "") : "";

  const body = (
    <article
      className={
        "group relative flex h-full flex-col overflow-hidden rounded-[10px] border border-border/60 bg-card text-card-foreground shadow-sm transition-all duration-300 " +
        (href ? "hover:-translate-y-0.5 hover:shadow-md hover:border-[color:var(--speakers-accent)]/40" : "")
      }
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-muted">
        {photo ? (
          <OptimizedImage
            src={photo}
            alt={name || ""}
            responsive
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
          />
        ) : (
          <span
            aria-hidden
            className="absolute inset-0 flex items-center justify-center text-muted-foreground/40"
          >
            <UserIcon className="h-12 w-12" />
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-4">
        {name && (
          <h3 className="text-base font-semibold leading-tight text-foreground">{name}</h3>
        )}
        {(role || gigs > 0) && (
          <p className="cms-meta">
            {role}
            {role && gigs > 0 ? " · " : ""}
            {gigs > 0 ? `${gigs} ${lang === "pl" ? "wystąpień" : "gigs"}` : ""}
          </p>
        )}
        {(rating > 0 || reviews > 0) && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {rating > 0 && (
              <span className="font-semibold text-foreground">{rating.toFixed(1)}</span>
            )}
            <StarRow rating={rating} />
            {reviews > 0 && (
              <span>
                ({reviews} {lang === "pl" ? "opinii" : "reviews"})
              </span>
            )}
          </div>
        )}
        {description && (
          <p className="cms-meta mt-1 line-clamp-3 text-muted-foreground">{description}</p>
        )}
      </div>
    </article>
  );

  if (href) {
    return (
      <AppLink
        href={href}
        className="block h-full rounded-[10px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--speakers-accent)]/60"
        aria-label={name || undefined}
      >
        {body}
      </AppLink>
    );
  }
  return body;
}
