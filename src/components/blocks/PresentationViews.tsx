// Publiczne renderery dla Phase 4 batch 10 (prezentacyjne).
import { htmlToPlainText } from "@/lib/sanitize";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { Json } from "@/lib/blocks/types";
import { useRevealOnScroll, type RevealState } from "@/hooks/useRevealOnScroll";
import { AppLink } from "@/components/atoms/AppLink";
import {
  Star,
  Heart,
  Zap,
  Shield,
  Trophy,
  Rocket,
  Sparkles,
  Check,
  Clock,
  Globe,
  Users,
  Award,
  Gem,
  Flame,
  Leaf,
  Target,
  ChevronLeft,
  ChevronRight,
  type LucideIcon,
} from "lucide-react";
import "@/lib/i18n-public";

/** Język treści bloku - napisy interfejsu idą w nim, nie w języku panelu. */
type Lang = "pl" | "en";

const ICON_MAP: Record<string, LucideIcon> = {
  star: Star,
  heart: Heart,
  zap: Zap,
  shield: Shield,
  trophy: Trophy,
  rocket: Rocket,
  sparkles: Sparkles,
  check: Check,
  clock: Clock,
  globe: Globe,
  users: Users,
  award: Award,
  gem: Gem,
  flame: Flame,
  leaf: Leaf,
  target: Target,
};

// ===== Icon Box =====

interface IconBoxProps {
  icon?: string;
  title?: string;
  description?: string;
  href?: string;
  linkLabel?: string;
  align?: "left" | "center";
  cls?: string;
}

export function IconBoxView({
  icon = "star",
  title,
  description,
  href,
  linkLabel,
  align = "center",
  cls,
}: IconBoxProps) {
  const Icon = ICON_MAP[icon] ?? Star;
  const isCenter = align === "center";
  return (
    <div
      className={[
        "rounded-2xl border border-border bg-card p-6 transition-shadow hover:shadow-md",
        isCenter ? "text-center" : "text-left",
        cls ?? "",
      ].join(" ")}
    >
      <div
        className={[
          "inline-flex items-center justify-center w-12 h-12 rounded-xl bg-primary/10 text-primary mb-4",
          isCenter ? "mx-auto" : "",
        ].join(" ")}
      >
        <Icon className="w-6 h-6" aria-hidden />
      </div>
      {title ? <h3 className="text-lg font-semibold text-foreground mb-2">{title}</h3> : null}
      {description ? (
        <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>
      ) : null}
      {href && linkLabel ? (
        <AppLink
          href={href}
          className="inline-flex items-center gap-1 text-sm font-medium text-primary mt-3 hover:underline"
        >
          {linkLabel} <ChevronRight className="w-3.5 h-3.5" aria-hidden />
        </AppLink>
      ) : null}
    </div>
  );
}

// ===== Stats Counter =====

interface CountableValue {
  prefix: string;
  num: number;
  /** Cyfry po przecinku w treści z CMS-u - licznik kończy na tej samej precyzji. */
  decimals: number;
}

interface StatItemLite {
  value: string;
  label: string;
  suffix: string;
  /** `null` - wartość nie jest „przedrostek + liczba"; pokazujemy ją dosłownie. */
  countable: CountableValue | null;
}

/**
 * Liczy tylko wartość w kształcie „przedrostek + liczba" (np. „€1200", „4,5").
 * Wszystko inne („N/A", „24/7", „1.000.000", puste pole) zostaje tekstem:
 * wcześniej „N/A" malowało się jako „N/A0", puste pole jako „0", a „24/7"
 * gubiło „/7".
 */
function parseCountable(raw: string): CountableValue | null {
  const match = raw.trim().match(/^([^\d-]*)(-?\d+)(?:[.,](\d+))?$/);
  if (!match) return null;
  const fraction = match[3] ?? "";
  return {
    prefix: match[1],
    num: Number(fraction ? `${match[2]}.${fraction}` : match[2]),
    decimals: fraction.length,
  };
}

function formatNumber(n: number, lang: "pl" | "en", decimals: number): string {
  const locale = lang === "en" ? "en-GB" : "pl-PL";
  return n.toLocaleString(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Licznik napędzany współdzielonym useRevealOnScroll:
 *  - "static" (SSR / element widoczny przy załadowaniu / reduced motion):
 *    wartość KOŃCOWA od razu - crawler i czytelnik bez JS widzą liczby,
 *    nie zera (wcześniej SSR renderował 0),
 *  - "armed" (poza viewportem): 0,
 *  - "run": count-up rAF z easingiem cubic-out.
 */
function AnimatedCounter({
  target,
  decimals,
  duration,
  state,
  lang,
}: {
  target: number;
  decimals: number;
  duration: number;
  state: RevealState;
  lang: "pl" | "en";
}) {
  const [val, setVal] = useState(target);
  useEffect(() => {
    if (state === "armed") {
      setVal(0);
      return;
    }
    if (state !== "run") {
      setVal(target);
      return;
    }
    const start = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / Math.max(100, duration));
      const eased = 1 - Math.pow(1 - p, 3);
      setVal(target * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
      else setVal(target);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [state, target, duration]);
  // Precyzja z treści: `Math.round` zamieniało ocenę „4,5" w „5".
  return <>{formatNumber(val, lang, decimals)}</>;
}

interface StatsProps {
  items?: Json[];
  duration?: number;
  cls?: string;
  lang?: "pl" | "en";
}

export function StatsCounterView({ items, duration = 1500, cls, lang = "pl" }: StatsProps) {
  const parsed: StatItemLite[] = useMemo(() => {
    if (!Array.isArray(items)) return [];
    return items.map((i) => {
      const o = (i ?? {}) as Record<string, Json>;
      const value = String(o.value ?? "");
      return {
        value,
        label: String(o.label ?? ""),
        suffix: String(o.suffix ?? ""),
        countable: parseCountable(value),
      };
    });
  }, [items]);
  const { ref, state } = useRevealOnScroll<HTMLDivElement>(true);
  if (parsed.length === 0) return null;
  return (
    <div
      ref={ref}
      className={[
        "grid gap-6 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 text-center",
        cls ?? "",
      ].join(" ")}
    >
      {parsed.map((it, idx) => {
        const c = it.countable;
        return (
          <div key={idx} className="space-y-1">
            <div className="text-3xl md:text-4xl font-bold text-foreground tabular-nums">
              {c ? (
                <>
                  {c.prefix}
                  <AnimatedCounter
                    target={c.num}
                    decimals={c.decimals}
                    duration={duration}
                    state={state}
                    lang={lang}
                  />
                </>
              ) : (
                it.value
              )}
              {it.suffix}
            </div>
            {it.label ? <div className="text-sm text-muted-foreground">{it.label}</div> : null}
          </div>
        );
      })}
    </div>
  );
}

// ===== Testimonials =====

interface TestimonialLite {
  quote: string;
  author: string;
  role: string;
  avatar: string;
  rating: number;
}

function parseTestimonials(items: Json[] | undefined): TestimonialLite[] {
  if (!Array.isArray(items)) return [];
  return items.map((i) => {
    const o = (i ?? {}) as Record<string, Json>;
    return {
      quote: String(o.quote ?? ""),
      author: String(o.author ?? ""),
      role: String(o.role ?? ""),
      avatar: String(o.avatar ?? ""),
      rating: Math.max(0, Math.min(5, Number(o.rating ?? 0))),
    };
  });
}

function TestimonialCard({ t, ratingLabel }: { t: TestimonialLite; ratingLabel: string }) {
  return (
    <figure className="h-full rounded-2xl border border-border bg-card p-6 flex flex-col">
      {t.rating > 0 ? (
        // `role="img"`: sam `aria-label` na `<div>` bez roli czytniki pomijają,
        // a gwiazdki są `aria-hidden` - ocena nie docierała do nikogo.
        <div
          className="flex items-center gap-0.5 mb-3 text-brand"
          role="img"
          aria-label={ratingLabel}
        >
          {Array.from({ length: 5 }).map((_, i) => (
            <Star
              key={i}
              className={`w-4 h-4 ${i < t.rating ? "fill-current" : "opacity-25"}`}
              aria-hidden
            />
          ))}
        </div>
      ) : null}
      <blockquote className="text-sm text-foreground leading-relaxed flex-1">
        {t.quote ? `"${t.quote}"` : null}
      </blockquote>
      {t.author || t.avatar ? (
        <figcaption className="mt-4 flex items-center gap-3">
          {t.avatar ? (
            <img
              src={t.avatar}
              alt=""
              loading="lazy"
              className="w-10 h-10 rounded-full object-cover"
            />
          ) : (
            <div className="w-10 h-10 rounded-full bg-muted" aria-hidden />
          )}
          <div className="text-xs">
            <div className="font-semibold text-foreground">{t.author}</div>
            {t.role ? <div className="text-muted-foreground">{t.role}</div> : null}
          </div>
        </figcaption>
      ) : null}
    </figure>
  );
}

interface TestimonialsProps {
  items?: Json[];
  layout?: "grid" | "slider";
  lang?: Lang;
  cls?: string;
}

export function TestimonialsView({ items, layout = "grid", lang = "pl", cls }: TestimonialsProps) {
  const { t: translate } = useTranslation();
  const ratingLabel = (value: number) => translate("blocksUi.ratingLabel", { lng: lang, value });
  const parsed = useMemo(() => parseTestimonials(items), [items]);
  const [idx, setIdx] = useState(0);
  const total = parsed.length;
  const go = useCallback(
    (d: number) => {
      setIdx((cur) => (Math.min(cur, total - 1) + d + total) % Math.max(1, total));
    },
    [total],
  );
  if (total === 0) return null;

  if (layout === "slider") {
    // Indeks przycięty do bieżącej listy: usunięcie ostatniej opinii na
    // kanwie buildera (podgląd na żywo) zostawiało `parsed[idx]` = undefined
    // i wywracało render.
    const current = Math.min(idx, total - 1);
    const t = parsed[current];
    return (
      <div className={`relative ${cls ?? ""}`}>
        <TestimonialCard t={t} ratingLabel={ratingLabel(t.rating)} />
        {total > 1 ? (
          <div className="flex items-center justify-between mt-3">
            <button
              type="button"
              onClick={() => go(-1)}
              className="inline-flex items-center justify-center w-8 h-8 rounded-full border border-border hover:bg-muted"
              aria-label={translate("blocksUi.testimonialsPrevious", { lng: lang })}
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="text-xs text-muted-foreground tabular-nums">
              {current + 1} / {total}
            </div>
            <button
              type="button"
              onClick={() => go(1)}
              className="inline-flex items-center justify-center w-8 h-8 rounded-full border border-border hover:bg-muted"
              aria-label={translate("blocksUi.testimonialsNext", { lng: lang })}
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className={`grid gap-4 sm:grid-cols-2 lg:grid-cols-3 ${cls ?? ""}`}>
      {parsed.map((t, i) => (
        <TestimonialCard key={i} t={t} ratingLabel={ratingLabel(t.rating)} />
      ))}
    </div>
  );
}

// ===== Pricing Table =====

interface PricingPlanLite {
  name: string;
  price: string;
  period: string;
  description: string;
  features: string[];
  ctaLabel: string;
  ctaHref: string;
  featured: boolean;
}

/**
 * Cechy planu: napis i liczba to treść; `null`, obiekt czy tablica z importu
 * nie są cechą - `String()` malował z nich „null" i „[object Object]". Ten sam
 * filtr co `readFeatures` w edytorze bloku, więc strona pokazuje to, co panel.
 */
function readFeatures(raw: Json | undefined): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((f): f is string | number => typeof f === "string" || typeof f === "number")
    .map(String);
}

function parsePlans(raw: Json[] | undefined): PricingPlanLite[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((i) => {
    const o = (i ?? {}) as Record<string, Json>;
    const feats = readFeatures(o.features);
    return {
      name: String(o.name ?? ""),
      price: String(o.price ?? ""),
      period: String(o.period ?? ""),
      description: String(o.description ?? ""),
      features: feats,
      ctaLabel: String(o.ctaLabel ?? ""),
      ctaHref: String(o.ctaHref ?? ""),
      featured: o.featured === true,
    };
  });
}

/**
 * Kolumny siatki cennika jako PEŁNE literały. Tailwind generuje tylko klasy,
 * które znajdzie dosłownie w źródłach - `md:grid-cols-${n}` składane w runtime
 * działało wyłącznie dlatego, że te same klasy przypadkiem stały gdzieś
 * indziej w kodzie; ich usunięcie tam po cichu łamałoby cennik.
 */
const PRICING_COLS_CLS: Record<number, string> = {
  1: "md:grid-cols-1",
  2: "md:grid-cols-2",
  3: "md:grid-cols-3",
  4: "md:grid-cols-4",
};

interface PricingProps {
  plans?: Json[];
  lang?: Lang;
  cls?: string;
}

export function PricingTableView({ plans, lang = "pl", cls }: PricingProps) {
  const { t } = useTranslation();
  const parsed = useMemo(() => parsePlans(plans), [plans]);
  if (parsed.length === 0) return null;
  const colsCls = PRICING_COLS_CLS[Math.min(parsed.length, 4)];
  return (
    <div className={`grid gap-4 ${colsCls} ${cls ?? ""}`}>
      {parsed.map((p, idx) => {
        const featured = p.featured;
        return (
          <div
            key={idx}
            className={[
              "relative rounded-2xl border p-6 flex flex-col bg-card transition-shadow",
              featured ? "border-primary shadow-lg md:scale-[1.03]" : "border-border",
            ].join(" ")}
          >
            {featured ? (
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold uppercase tracking-wide">
                {t("blocksUi.pricingFeatured", { lng: lang })}
              </div>
            ) : null}
            {p.name ? (
              <div className="text-sm font-semibold text-muted-foreground">{p.name}</div>
            ) : null}
            <div className="mt-3 flex items-baseline gap-1">
              <span className="text-3xl font-bold text-foreground">{p.price}</span>
              {p.period ? <span className="text-sm text-muted-foreground">{p.period}</span> : null}
            </div>
            {p.description ? (
              <p className="mt-2 text-sm text-muted-foreground whitespace-pre-line">
                {htmlToPlainText(p.description)}
              </p>
            ) : null}
            {p.features.length > 0 ? (
              <ul className="mt-4 space-y-2 text-sm text-foreground flex-1">
                {p.features.map((f, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <Check className="w-4 h-4 mt-0.5 text-primary shrink-0" aria-hidden />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="flex-1" />
            )}
            {p.ctaLabel && p.ctaHref ? (
              <AppLink
                href={p.ctaHref}
                className={[
                  "mt-6 inline-flex items-center justify-center px-4 py-2 rounded-lg text-sm font-medium transition-colors",
                  featured
                    ? "bg-primary text-primary-foreground hover:bg-primary/90"
                    : "border border-border text-foreground hover:bg-muted",
                ].join(" ")}
              >
                {p.ctaLabel}
              </AppLink>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

// ===== Timeline =====

interface TimelineLite {
  date: string;
  title: string;
  description: string;
}

interface TimelineProps {
  items?: Json[];
  cls?: string;
}

export function TimelineView({ items, cls }: TimelineProps) {
  const parsed: TimelineLite[] = useMemo(() => {
    if (!Array.isArray(items)) return [];
    return items.map((i) => {
      const o = (i ?? {}) as Record<string, Json>;
      return {
        date: String(o.date ?? ""),
        title: String(o.title ?? ""),
        description: String(o.description ?? ""),
      };
    });
  }, [items]);
  if (parsed.length === 0) return null;
  return (
    <ol className={`relative border-l-2 border-border ml-3 space-y-6 ${cls ?? ""}`}>
      {parsed.map((it, idx) => (
        <li key={idx} className="ml-5">
          <span
            className="absolute -left-[7px] mt-1.5 w-3 h-3 rounded-full bg-primary ring-4 ring-background"
            aria-hidden
          />
          {it.date ? (
            <time className="block text-xs font-semibold uppercase tracking-wide text-primary">
              {it.date}
            </time>
          ) : null}
          {it.title ? (
            <h3 className="text-base font-semibold text-foreground mt-0.5">{it.title}</h3>
          ) : null}
          {it.description ? (
            <p className="text-sm text-muted-foreground mt-1 leading-relaxed whitespace-pre-line">
              {htmlToPlainText(it.description)}
            </p>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
