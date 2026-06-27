// Publiczne renderery dla Phase 4 batch 10 (prezentacyjne).

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import type { Json } from "@/lib/blocks/types";
import { AppLink } from "@/components/atoms/AppLink";
import {
  Star, Heart, Zap, Shield, Trophy, Rocket, Sparkles, Check,
  Clock, Globe, Users, Award, Gem, Flame, Leaf, Target,
  ChevronLeft, ChevronRight,
  type LucideIcon,
} from "lucide-react";

const ICON_MAP: Record<string, LucideIcon> = {
  star: Star, heart: Heart, zap: Zap, shield: Shield, trophy: Trophy, rocket: Rocket,
  sparkles: Sparkles, check: Check, clock: Clock, globe: Globe, users: Users,
  award: Award, gem: Gem, flame: Flame, leaf: Leaf, target: Target,
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

export function IconBoxView({ icon = "star", title, description, href, linkLabel, align = "center", cls }: IconBoxProps) {
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
      {description ? <p className="text-sm text-muted-foreground leading-relaxed">{description}</p> : null}
      {href && linkLabel ? (
        <AppLink
          to={href}
          className="inline-flex items-center gap-1 text-sm font-medium text-primary mt-3 hover:underline"
        >
          {linkLabel} <ChevronRight className="w-3.5 h-3.5" aria-hidden />
        </AppLink>
      ) : null}
    </div>
  );
}

// ===== Stats Counter =====

interface StatItemLite { value: string; label: string; suffix: string }

function parseNumber(v: string): { num: number; prefix: string } {
  const match = v.match(/^([^\d-]*)(-?\d+(?:[.,]\d+)?)/);
  if (!match) return { num: 0, prefix: v };
  return { num: Number(match[2].replace(",", ".")) || 0, prefix: match[1] ?? "" };
}

function useInView<T extends HTMLElement>(): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => entries.forEach((e) => { if (e.isIntersecting) { setInView(true); obs.disconnect(); } }),
      { threshold: 0.2 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return [ref, inView];
}

function formatNumber(n: number): string {
  return Number.isInteger(n) ? n.toLocaleString("pl-PL") : n.toLocaleString("pl-PL", { maximumFractionDigits: 2 });
}

function AnimatedCounter({ target, duration, run }: { target: number; duration: number; run: boolean }) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (!run) return;
    if (typeof window === "undefined") { setVal(target); return; }
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
  }, [run, target, duration]);
  return <>{formatNumber(Math.round(val))}</>;
}

interface StatsProps { items?: Json[]; duration?: number; cls?: string }

export function StatsCounterView({ items, duration = 1500, cls }: StatsProps) {
  const parsed: StatItemLite[] = useMemo(() => {
    if (!Array.isArray(items)) return [];
    return items.map((i) => {
      const o = (i ?? {}) as Record<string, Json>;
      return {
        value: String(o.value ?? ""),
        label: String(o.label ?? ""),
        suffix: String(o.suffix ?? ""),
      };
    });
  }, [items]);
  const [ref, inView] = useInView<HTMLDivElement>();
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
        const { num, prefix } = parseNumber(it.value);
        return (
          <div key={idx} className="space-y-1">
            <div className="text-3xl md:text-4xl font-bold text-foreground tabular-nums">
              {prefix}
              <AnimatedCounter target={num} duration={duration} run={inView} />
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

interface TestimonialLite { quote: string; author: string; role: string; avatar: string; rating: number }

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

function TestimonialCard({ t }: { t: TestimonialLite }) {
  return (
    <figure className="h-full rounded-2xl border border-border bg-card p-6 flex flex-col">
      {t.rating > 0 ? (
        <div className="flex items-center gap-0.5 mb-3 text-amber-500" aria-label={`Ocena: ${t.rating}/5`}>
          {Array.from({ length: 5 }).map((_, i) => (
            <Star key={i} className={`w-4 h-4 ${i < t.rating ? "fill-current" : "opacity-25"}`} aria-hidden />
          ))}
        </div>
      ) : null}
      <blockquote className="text-sm text-foreground leading-relaxed flex-1">
        {t.quote ? `"${t.quote}"` : null}
      </blockquote>
      {(t.author || t.avatar) ? (
        <figcaption className="mt-4 flex items-center gap-3">
          {t.avatar ? (
            <img src={t.avatar} alt="" loading="lazy" className="w-10 h-10 rounded-full object-cover" />
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

interface TestimonialsProps { items?: Json[]; layout?: "grid" | "slider"; cls?: string }

export function TestimonialsView({ items, layout = "grid", cls }: TestimonialsProps) {
  const parsed = useMemo(() => parseTestimonials(items), [items]);
  const [idx, setIdx] = useState(0);
  const total = parsed.length;
  const go = useCallback((d: number) => {
    setIdx((cur) => (cur + d + total) % Math.max(1, total));
  }, [total]);
  if (total === 0) return null;

  if (layout === "slider") {
    const t = parsed[idx];
    return (
      <div className={`relative ${cls ?? ""}`}>
        <TestimonialCard t={t} />
        {total > 1 ? (
          <div className="flex items-center justify-between mt-3">
            <button
              type="button"
              onClick={() => go(-1)}
              className="inline-flex items-center justify-center w-8 h-8 rounded-full border border-border hover:bg-muted"
              aria-label="Poprzednia"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="text-xs text-muted-foreground tabular-nums">{idx + 1} / {total}</div>
            <button
              type="button"
              onClick={() => go(1)}
              className="inline-flex items-center justify-center w-8 h-8 rounded-full border border-border hover:bg-muted"
              aria-label="Następna"
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
      {parsed.map((t, i) => <TestimonialCard key={i} t={t} />)}
    </div>
  );
}

// ===== Pricing Table =====

interface PricingPlanLite {
  name: string; price: string; period: string; description: string;
  features: string[]; ctaLabel: string; ctaHref: string; featured: boolean;
}

function parsePlans(raw: Json[] | undefined): PricingPlanLite[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((i) => {
    const o = (i ?? {}) as Record<string, Json>;
    const feats = Array.isArray(o.features) ? (o.features as Json[]).map((f) => String(f)) : [];
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

interface PricingProps { plans?: Json[]; cls?: string }

export function PricingTableView({ plans, cls }: PricingProps) {
  const parsed = useMemo(() => parsePlans(plans), [plans]);
  if (parsed.length === 0) return null;
  return (
    <div className={`grid gap-4 md:grid-cols-${Math.min(parsed.length, 4)} ${cls ?? ""}`}>
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
                Polecane
              </div>
            ) : null}
            {p.name ? <div className="text-sm font-semibold text-muted-foreground">{p.name}</div> : null}
            <div className="mt-3 flex items-baseline gap-1">
              <span className="text-3xl font-bold text-foreground">{p.price}</span>
              {p.period ? <span className="text-sm text-muted-foreground">{p.period}</span> : null}
            </div>
            {p.description ? <p className="mt-2 text-sm text-muted-foreground">{p.description}</p> : null}
            {p.features.length > 0 ? (
              <ul className="mt-4 space-y-2 text-sm text-foreground flex-1">
                {p.features.map((f, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <Check className="w-4 h-4 mt-0.5 text-primary shrink-0" aria-hidden />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            ) : <div className="flex-1" />}
            {p.ctaLabel && p.ctaHref ? (
              <AppLink
                to={p.ctaHref}
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

interface TimelineLite { date: string; title: string; description: string }

interface TimelineProps { items?: Json[]; cls?: string }

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
            <time className="block text-xs font-semibold uppercase tracking-wide text-primary">{it.date}</time>
          ) : null}
          {it.title ? <h3 className="text-base font-semibold text-foreground mt-0.5">{it.title}</h3> : null}
          {it.description ? <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{it.description}</p> : null}
        </li>
      ))}
    </ol>
  );
}
