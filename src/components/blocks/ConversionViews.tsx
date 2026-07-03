// Publiczne renderery dla Phase 4 batch 13 (konwersja / SEO).

import type { Json } from "@/lib/blocks/types";
import { AppLink } from "@/components/atoms/AppLink";
import { Check, X as XIcon } from "lucide-react";

// ===== Step List =====

interface StepLite {
  title: string;
  description: string;
}

type StepOrientation = "vertical" | "horizontal";
type StepNumberStyle = "circle" | "square" | "plain";

interface StepProps {
  title?: string;
  items?: Json[];
  orientation?: StepOrientation;
  numberStyle?: StepNumberStyle;
  cls?: string;
}

const NUMBER_STYLE_CLS: Record<StepNumberStyle, string> = {
  circle: "rounded-full",
  square: "rounded-lg",
  plain: "rounded-none bg-transparent text-primary",
};

export function StepListView({
  title,
  items,
  orientation = "vertical",
  numberStyle = "circle",
  cls,
}: StepProps) {
  const list: StepLite[] = (Array.isArray(items) ? items : [])
    .map((i) => {
      const o = (i ?? {}) as Record<string, Json>;
      return { title: String(o.title ?? ""), description: String(o.description ?? "") };
    })
    .filter((s) => s.title);
  if (list.length === 0) return null;
  const numCls = [
    "inline-flex items-center justify-center w-10 h-10 shrink-0 font-bold text-sm",
    NUMBER_STYLE_CLS[numberStyle],
    numberStyle === "plain" ? "text-xl font-serif" : "bg-primary text-primary-foreground",
  ].join(" ");

  if (orientation === "horizontal") {
    return (
      <section className={`space-y-6 ${cls ?? ""}`}>
        {title ? (
          <h2 className="font-serif text-2xl md:text-3xl font-bold text-center text-foreground">
            {title}
          </h2>
        ) : null}
        <ol className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {list.map((s, idx) => (
            <li key={idx} className="rounded-2xl border border-border bg-card p-6 space-y-3">
              <div className={numCls}>{idx + 1}</div>
              <div className="font-serif text-lg font-semibold text-foreground">{s.title}</div>
              {s.description ? (
                <p className="text-sm text-muted-foreground leading-relaxed">{s.description}</p>
              ) : null}
            </li>
          ))}
        </ol>
      </section>
    );
  }

  return (
    <section className={`space-y-6 ${cls ?? ""}`}>
      {title ? (
        <h2 className="font-serif text-2xl md:text-3xl font-bold text-foreground">{title}</h2>
      ) : null}
      <ol className="relative space-y-6 before:absolute before:left-5 before:top-2 before:bottom-2 before:w-px before:bg-border">
        {list.map((s, idx) => (
          <li key={idx} className="relative flex gap-4">
            <div className={numCls}>{idx + 1}</div>
            <div className="pt-1.5 space-y-1">
              <div className="font-serif text-lg font-semibold text-foreground">{s.title}</div>
              {s.description ? (
                <p className="text-sm text-muted-foreground leading-relaxed">{s.description}</p>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

// ===== Comparison Table =====

interface CompProps {
  title?: string;
  columns?: Json[];
  rows?: Json[];
  featuredIndex?: number;
  cls?: string;
}

function renderCellValue(v: string) {
  const t = v.trim().toLowerCase();
  if (t === "✓" || t === "yes" || t === "tak" || t === "true") {
    return <Check className="w-5 h-5 text-emerald-600 mx-auto" aria-label="Tak" />;
  }
  if (t === "✗" || t === "no" || t === "nie" || t === "false") {
    return <XIcon className="w-5 h-5 text-muted-foreground mx-auto" aria-label="Nie" />;
  }
  return <span className="text-sm text-foreground">{v}</span>;
}

export function ComparisonTableView({ title, columns, rows, featuredIndex = -1, cls }: CompProps) {
  const cols: string[] = (Array.isArray(columns) ? columns : []).map((c) => String(c ?? ""));
  const rowList = (Array.isArray(rows) ? rows : []).map((r) => {
    const o = (r ?? {}) as Record<string, Json>;
    const vs = Array.isArray(o.values) ? (o.values as Json[]) : [];
    return { feature: String(o.feature ?? ""), values: vs.map((v) => String(v ?? "")) };
  });
  if (cols.length === 0 || rowList.length === 0) return null;

  return (
    <section className={`space-y-4 ${cls ?? ""}`}>
      {title ? (
        <h2 className="font-serif text-2xl md:text-3xl font-bold text-center text-foreground">
          {title}
        </h2>
      ) : null}
      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="text-left p-4 font-semibold text-muted-foreground">Funkcja</th>
              {cols.map((c, i) => (
                <th
                  key={i}
                  className={[
                    "p-4 text-center font-semibold",
                    i === featuredIndex ? "bg-primary/10 text-primary" : "text-foreground",
                  ].join(" ")}
                  scope="col"
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rowList.map((r, ri) => (
              <tr key={ri} className="border-b border-border last:border-0">
                <th className="text-left p-4 font-medium text-foreground" scope="row">
                  {r.feature}
                </th>
                {cols.map((_, ci) => (
                  <td
                    key={ci}
                    className={["p-4 text-center", ci === featuredIndex ? "bg-primary/5" : ""].join(
                      " ",
                    )}
                  >
                    {renderCellValue(r.values[ci] ?? "")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ===== Banner Image =====

const BANNER_ASPECT: Record<string, string> = {
  "21:9": "aspect-[21/9]",
  "16:9": "aspect-[16/9]",
  "4:3": "aspect-[4/3]",
  "3:1": "aspect-[3/1]",
};

const BANNER_POS: Record<string, string> = {
  left: "items-start text-left",
  center: "items-center text-center",
  right: "items-end text-right",
};

interface BannerImageProps {
  image?: string;
  alt?: string;
  title?: string;
  description?: string;
  ctaLabel?: string;
  ctaHref?: string;
  position?: "left" | "center" | "right";
  theme?: "dark" | "light";
  aspect?: string;
  overlay?: number;
  cls?: string;
}

export function BannerImageView({
  image,
  alt,
  title,
  description,
  ctaLabel,
  ctaHref,
  position = "left",
  theme = "dark",
  aspect = "21:9",
  overlay = 35,
  cls,
}: BannerImageProps) {
  const aspectCls = BANNER_ASPECT[aspect] ?? BANNER_ASPECT["21:9"];
  const posCls = BANNER_POS[position] ?? BANNER_POS.left;
  const ov = Math.max(0, Math.min(90, overlay));
  const textCls = theme === "light" ? "text-foreground" : "text-white";
  const subCls = theme === "light" ? "text-muted-foreground" : "text-white/85";

  return (
    <section className={`relative overflow-hidden rounded-2xl ${aspectCls} ${cls ?? ""}`}>
      {image ? (
        <img
          src={image}
          alt={alt || ""}
          className="absolute inset-0 w-full h-full object-cover"
          loading="lazy"
        />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-primary/30 to-muted" aria-hidden />
      )}
      <div
        className="absolute inset-0"
        style={{
          backgroundColor:
            theme === "light" ? `rgba(255,255,255,${ov / 100})` : `rgba(0,0,0,${ov / 100})`,
        }}
        aria-hidden
      />
      <div className={`relative h-full w-full p-6 md:p-10 flex flex-col justify-center ${posCls}`}>
        <div className="max-w-xl space-y-3">
          {title ? (
            <h2 className={`font-serif text-2xl md:text-4xl font-bold leading-tight ${textCls}`}>
              {title}
            </h2>
          ) : null}
          {description ? (
            <p className={`text-sm md:text-base leading-relaxed ${subCls}`}>{description}</p>
          ) : null}
          {ctaLabel && ctaHref ? (
            <AppLink
              href={ctaHref}
              className={[
                "inline-flex items-center justify-center px-5 py-2.5 rounded-lg text-sm font-semibold transition-colors mt-2",
                theme === "light"
                  ? "bg-primary text-primary-foreground hover:bg-primary/90"
                  : "bg-white text-foreground hover:bg-white/90",
              ].join(" ")}
            >
              {ctaLabel}
            </AppLink>
          ) : null}
        </div>
      </div>
    </section>
  );
}

// ===== Video Hero =====

const VIDEO_HERO_HEIGHT: Record<string, string> = {
  md: "min-h-[480px] md:min-h-[560px]",
  lg: "min-h-[600px] md:min-h-[720px]",
  screen: "min-h-[80vh] md:min-h-[90vh]",
};

interface VideoHeroProps {
  src?: string;
  poster?: string;
  title?: string;
  subtitle?: string;
  ctaLabel?: string;
  ctaHref?: string;
  height?: "md" | "lg" | "screen";
  align?: "left" | "center";
  overlay?: number;
  autoplay?: boolean;
  loop?: boolean;
  cls?: string;
}

export function VideoHeroView({
  src,
  poster,
  title,
  subtitle,
  ctaLabel,
  ctaHref,
  height = "lg",
  align = "center",
  overlay = 45,
  autoplay = true,
  loop = true,
  cls,
}: VideoHeroProps) {
  const heightCls = VIDEO_HERO_HEIGHT[height] ?? VIDEO_HERO_HEIGHT.lg;
  const isCenter = align === "center";
  const ov = Math.max(0, Math.min(90, overlay));

  return (
    <section className={`relative overflow-hidden rounded-2xl ${heightCls} ${cls ?? ""}`}>
      {src ? (
        <video
          className="absolute inset-0 w-full h-full object-cover"
          src={src}
          poster={poster || undefined}
          autoPlay={autoplay}
          muted
          loop={loop}
          playsInline
          preload="metadata"
          aria-hidden
        />
      ) : poster ? (
        <img
          src={poster}
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
          loading="lazy"
        />
      ) : (
        <div
          className="absolute inset-0 bg-gradient-to-br from-primary/40 via-background to-muted"
          aria-hidden
        />
      )}
      <div className="absolute inset-0 bg-black" style={{ opacity: ov / 100 }} aria-hidden />
      <div
        className={[
          "relative h-full w-full p-6 md:p-12 flex flex-col justify-center",
          isCenter ? "items-center text-center" : "items-start text-left",
        ].join(" ")}
      >
        <div className={`max-w-3xl ${isCenter ? "mx-auto" : ""} space-y-4`}>
          {title ? (
            <h1 className="font-serif text-3xl md:text-5xl lg:text-6xl font-bold leading-tight text-white">
              {title}
            </h1>
          ) : null}
          {subtitle ? (
            <p className="text-base md:text-lg leading-relaxed text-white/90">{subtitle}</p>
          ) : null}
          {ctaLabel && ctaHref ? (
            <div className="pt-2">
              <AppLink
                href={ctaHref}
                className="inline-flex items-center justify-center px-6 py-3 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors"
              >
                {ctaLabel}
              </AppLink>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
