// Publiczne renderery dla Phase 4 batch 12 (data + social proof).

import { useState } from "react";
import type { Json } from "@/lib/blocks/types";
import { AppLink } from "@/components/atoms/AppLink";
import {
  Star, Zap, Shield, Rocket, Heart, Check,
  Trophy, Target, Globe, Lightbulb, Sparkles, Gauge,
  Info, CheckCircle2, AlertTriangle, XCircle, X,
  type LucideIcon,
} from "lucide-react";

const FEATURE_ICON_MAP: Record<string, LucideIcon> = {
  star: Star, zap: Zap, shield: Shield, rocket: Rocket, heart: Heart, check: Check,
  trophy: Trophy, target: Target, globe: Globe, lightbulb: Lightbulb,
  sparkles: Sparkles, gauge: Gauge,
};

const COLS_CLS: Record<number, string> = {
  2: "grid-cols-1 sm:grid-cols-2",
  3: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
  4: "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4",
  5: "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5",
  6: "grid-cols-2 sm:grid-cols-3 lg:grid-cols-6",
};

// ===== Team Grid =====

interface TeamLite { name: string; role: string; bio: string; avatar: string; href: string; social: string }

interface TeamProps {
  title?: string;
  items?: Json[];
  columns?: number;
  shape?: "circle" | "square";
  cls?: string;
}

export function TeamGridView({ title, items, columns = 3, shape = "circle", cls }: TeamProps) {
  const list: TeamLite[] = (Array.isArray(items) ? items : []).map((i) => {
    const o = (i ?? {}) as Record<string, Json>;
    return {
      name: String(o.name ?? ""), role: String(o.role ?? ""),
      bio: String(o.bio ?? ""), avatar: String(o.avatar ?? ""),
      href: String(o.href ?? ""), social: String(o.social ?? ""),
    };
  }).filter((m) => m.name);
  if (list.length === 0) return null;
  const gridCls = COLS_CLS[columns] ?? COLS_CLS[3];

  return (
    <section className={`space-y-6 ${cls ?? ""}`}>
      {title ? (
        <h2 className="font-serif text-2xl md:text-3xl font-bold text-center text-foreground">{title}</h2>
      ) : null}
      <ul className={`grid gap-6 ${gridCls}`}>
        {list.map((m, idx) => {
          const card = (
            <>
              {m.avatar ? (
                <img
                  src={m.avatar}
                  alt={m.name}
                  loading="lazy"
                  className={[
                    "object-cover w-full",
                    shape === "circle" ? "rounded-full aspect-square max-w-[160px] mx-auto" : "rounded-xl aspect-[4/5]",
                  ].join(" ")}
                />
              ) : (
                <div
                  aria-hidden
                  className={[
                    "bg-muted",
                    shape === "circle" ? "rounded-full aspect-square max-w-[160px] mx-auto" : "rounded-xl aspect-[4/5]",
                  ].join(" ")}
                />
              )}
              <div className="mt-4 text-center space-y-1">
                <div className="font-serif text-lg font-semibold text-foreground">{m.name}</div>
                {m.role ? <div className="text-xs uppercase tracking-wide text-primary">{m.role}</div> : null}
                {m.bio ? <p className="text-sm text-muted-foreground leading-relaxed mt-2">{m.bio}</p> : null}
                {m.social ? (
                  <a
                    href={m.social}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block text-xs text-primary hover:underline mt-2"
                  >
                    Profil
                  </a>
                ) : null}
              </div>
            </>
          );
          return (
            <li key={idx} className="rounded-2xl border border-border bg-card p-4">
              {m.href ? <AppLink href={m.href} className="block group">{card}</AppLink> : card}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ===== Logo Grid =====

interface LogoLite { url: string; alt: string; href: string }

interface LogoProps {
  title?: string;
  items?: Json[];
  columns?: number;
  grayscale?: boolean;
  bordered?: boolean;
  cls?: string;
}

export function LogoGridView({ title, items, columns = 5, grayscale = true, bordered = false, cls }: LogoProps) {
  const list: LogoLite[] = (Array.isArray(items) ? items : []).map((i) => {
    const o = (i ?? {}) as Record<string, Json>;
    return { url: String(o.url ?? ""), alt: String(o.alt ?? ""), href: String(o.href ?? "") };
  }).filter((l) => l.url);
  if (list.length === 0) return null;
  const gridCls = COLS_CLS[columns] ?? COLS_CLS[5];

  return (
    <section className={`space-y-4 ${cls ?? ""}`}>
      {title ? (
        <h2 className="font-serif text-xl md:text-2xl font-bold text-center text-muted-foreground">{title}</h2>
      ) : null}
      <ul className={`grid items-center gap-4 ${gridCls}`}>
        {list.map((l, idx) => {
          const img = (
            <img
              src={l.url}
              alt={l.alt || ""}
              loading="lazy"
              className={[
                "max-h-12 w-auto mx-auto object-contain",
                grayscale ? "grayscale opacity-70 hover:grayscale-0 hover:opacity-100 transition" : "",
              ].join(" ")}
            />
          );
          return (
            <li
              key={idx}
              className={[
                "flex items-center justify-center p-4",
                bordered ? "rounded-xl border border-border bg-card" : "",
              ].join(" ")}
            >
              {l.href ? <a href={l.href} target="_blank" rel="noopener noreferrer">{img}</a> : img}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ===== Feature Grid =====

interface FeatureLite { icon: string; title: string; description: string; href: string }

type FeatureStyle = "card" | "minimal" | "bordered";

interface FeatureProps {
  title?: string;
  subtitle?: string;
  items?: Json[];
  columns?: number;
  style?: FeatureStyle;
  cls?: string;
}

export function FeatureGridView({ title, subtitle, items, columns = 3, style = "card", cls }: FeatureProps) {
  const list: FeatureLite[] = (Array.isArray(items) ? items : []).map((i) => {
    const o = (i ?? {}) as Record<string, Json>;
    return {
      icon: String(o.icon ?? "star"),
      title: String(o.title ?? ""),
      description: String(o.description ?? ""),
      href: String(o.href ?? ""),
    };
  }).filter((f) => f.title);
  if (list.length === 0) return null;
  const gridCls = COLS_CLS[columns] ?? COLS_CLS[3];
  const itemCls = style === "card"
    ? "rounded-2xl border border-border bg-card p-6"
    : style === "bordered"
      ? "rounded-2xl border-2 border-border p-6"
      : "p-2";

  return (
    <section className={`space-y-6 ${cls ?? ""}`}>
      {(title || subtitle) ? (
        <header className="text-center space-y-2 max-w-2xl mx-auto">
          {title ? <h2 className="font-serif text-2xl md:text-3xl font-bold text-foreground">{title}</h2> : null}
          {subtitle ? <p className="text-sm md:text-base text-muted-foreground">{subtitle}</p> : null}
        </header>
      ) : null}
      <ul className={`grid gap-6 ${gridCls}`}>
        {list.map((f, idx) => {
          const Icon = FEATURE_ICON_MAP[f.icon] ?? Star;
          const inner = (
            <div className={`${itemCls} h-full flex flex-col gap-3`}>
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-primary/10 text-primary">
                <Icon className="w-6 h-6" aria-hidden />
              </div>
              <div className="font-serif text-lg font-semibold text-foreground">{f.title}</div>
              {f.description ? (
                <p className="text-sm text-muted-foreground leading-relaxed">{f.description}</p>
              ) : null}
              {f.href ? (
                <span className="mt-auto inline-block text-xs font-semibold text-primary group-hover:underline">
                  Dowiedz się więcej →
                </span>
              ) : null}
            </div>
          );
          return (
            <li key={idx}>
              {f.href ? <AppLink href={f.href} className="block group h-full">{inner}</AppLink> : inner}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ===== Alert Banner =====

type AlertVariant = "info" | "success" | "warning" | "danger" | "neutral";

const ALERT_STYLES: Record<AlertVariant, { bg: string; text: string; border: string; icon: LucideIcon }> = {
  info:    { bg: "bg-sky-50 dark:bg-sky-950/30",     text: "text-sky-900 dark:text-sky-100",     border: "border-sky-200 dark:border-sky-900",     icon: Info },
  success: { bg: "bg-emerald-50 dark:bg-emerald-950/30", text: "text-emerald-900 dark:text-emerald-100", border: "border-emerald-200 dark:border-emerald-900", icon: CheckCircle2 },
  warning: { bg: "bg-amber-50 dark:bg-amber-950/30", text: "text-amber-900 dark:text-amber-100", border: "border-amber-200 dark:border-amber-900", icon: AlertTriangle },
  danger:  { bg: "bg-red-50 dark:bg-red-950/30",     text: "text-red-900 dark:text-red-100",     border: "border-red-200 dark:border-red-900",     icon: XCircle },
  neutral: { bg: "bg-muted",                          text: "text-foreground",                     border: "border-border",                           icon: Info },
};

interface AlertProps {
  variant?: AlertVariant;
  title?: string;
  message?: string;
  ctaLabel?: string;
  ctaHref?: string;
  dismissible?: boolean;
  showIcon?: boolean;
  cls?: string;
}

export function AlertBannerView({
  variant = "info", title, message, ctaLabel, ctaHref,
  dismissible = false, showIcon = true, cls,
}: AlertProps) {
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;
  const s = ALERT_STYLES[variant] ?? ALERT_STYLES.info;
  const Icon = s.icon;

  return (
    <div
      role="alert"
      className={[
        "relative rounded-xl border p-4 flex items-start gap-3",
        s.bg, s.text, s.border, cls ?? "",
      ].join(" ")}
    >
      {showIcon ? (
        <div className="shrink-0 mt-0.5">
          <Icon className="w-5 h-5" aria-hidden />
        </div>
      ) : null}
      <div className="flex-1 min-w-0 space-y-1">
        {title ? <div className="font-semibold text-sm">{title}</div> : null}
        {message ? <p className="text-sm leading-relaxed">{message}</p> : null}
        {ctaLabel && ctaHref ? (
          <AppLink
            href={ctaHref}
            className="inline-block mt-1 text-xs font-semibold underline underline-offset-2 hover:no-underline"
          >
            {ctaLabel}
          </AppLink>
        ) : null}
      </div>
      {dismissible ? (
        <button
          type="button"
          onClick={() => setHidden(true)}
          className="shrink-0 -mr-1 -mt-1 p-1.5 rounded hover:bg-black/5 dark:hover:bg-white/10"
          aria-label="Zamknij alert"
        >
          <X className="w-4 h-4" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}

// ===== Divider with text =====

type DividerAlign = "left" | "center" | "right";
type DividerLineStyle = "solid" | "dashed" | "dotted";

interface DividerProps {
  text?: string;
  align?: DividerAlign;
  lineStyle?: DividerLineStyle;
  cls?: string;
}

export function DividerTextView({ text, align = "center", lineStyle = "solid", cls }: DividerProps) {
  const lineCls = `flex-1 border-t border-border ${lineStyle === "dashed" ? "border-dashed" : lineStyle === "dotted" ? "border-dotted" : ""}`;
  if (!text) {
    return <hr className={`border-0 border-t border-border my-6 ${lineStyle === "dashed" ? "border-dashed" : lineStyle === "dotted" ? "border-dotted" : ""} ${cls ?? ""}`} />;
  }
  const label = (
    <span className="px-3 text-xs uppercase tracking-wider text-muted-foreground font-medium whitespace-nowrap">{text}</span>
  );
  return (
    <div className={`flex items-center w-full my-6 ${cls ?? ""}`} role="separator" aria-label={text}>
      {align !== "left" ? <span className={lineCls} aria-hidden /> : null}
      {label}
      {align !== "right" ? <span className={lineCls} aria-hidden /> : null}
    </div>
  );
}

