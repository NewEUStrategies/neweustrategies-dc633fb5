// Publiczne renderery dla bloków kontekstowych (post-* / site-*).
// Czerpią dane z CurrentPostCtx (dla post-*) i site_settings (dla site-*).

import { useCurrentPostCtx } from "@/lib/builder/currentPostContext";
import { useSiteSetting } from "@/lib/useSiteSetting";
import { AppLink } from "@/components/atoms/AppLink";
import { OptimizedImage } from "@/components/atoms/OptimizedImage";

type Lang = "pl" | "en";

function formatDate(iso: string | undefined, format: string, lang: Lang): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (format === "relative") {
    const diff = Date.now() - d.getTime();
    const day = 86_400_000;
    const days = Math.round(diff / day);
    const rtf = new Intl.RelativeTimeFormat(lang === "en" ? "en" : "pl", { numeric: "auto" });
    if (Math.abs(days) < 1) return rtf.format(-Math.round(diff / 3_600_000), "hour");
    if (Math.abs(days) < 30) return rtf.format(-days, "day");
    if (Math.abs(days) < 365) return rtf.format(-Math.round(days / 30), "month");
    return rtf.format(-Math.round(days / 365), "year");
  }
  if (format === "short") return new Intl.DateTimeFormat(lang === "en" ? "en" : "pl").format(d);
  return new Intl.DateTimeFormat(lang === "en" ? "en" : "pl", { dateStyle: "long" }).format(d);
}

export function PostTitleView({ level, lang, cls }: { level: number; lang: Lang; cls: string }) {
  const ctx = useCurrentPostCtx();
  const text =
    (lang === "en" ? ctx?.title_en : ctx?.title_pl) ?? ctx?.title_pl ?? ctx?.title_en ?? "";
  if (!text) return null;
  const Tag = `h${Math.min(Math.max(level, 1), 4)}` as "h1" | "h2" | "h3" | "h4";
  return <Tag className={cls}>{text}</Tag>;
}

export function PostDateView({
  format,
  showUpdated,
  lang,
  cls,
}: {
  format: string;
  showUpdated: boolean;
  lang: Lang;
  cls: string;
}) {
  const ctx = useCurrentPostCtx();
  const iso = showUpdated ? (ctx?.updatedAt ?? ctx?.publishedAt) : ctx?.publishedAt;
  if (!iso) return null;
  return (
    <time className={`text-sm text-muted-foreground ${cls}`} dateTime={iso}>
      {formatDate(iso, format, lang)}
    </time>
  );
}

export function PostAuthorView({
  showAvatar,
  showBio,
  lang,
  cls,
}: {
  showAvatar: boolean;
  showBio: boolean;
  lang: Lang;
  cls: string;
}) {
  const ctx = useCurrentPostCtx();
  const a = ctx?.author;
  if (!a?.name) return null;
  const bio = (lang === "en" ? a.bio_en : a.bio_pl) ?? "";
  return (
    <div className={`not-prose flex items-start gap-3 my-4 ${cls}`}>
      {showAvatar && a.avatarUrl && (
        <img
          src={a.avatarUrl}
          alt={a.name}
          className="w-10 h-10 rounded-full object-cover"
          loading="lazy"
        />
      )}
      <div className="min-w-0">
        {a.slug ? (
          <AppLink href={`/author/${a.slug}`} className="font-medium hover:text-primary">
            {a.name}
          </AppLink>
        ) : (
          <span className="font-medium">{a.name}</span>
        )}
        {showBio && bio && <p className="text-sm text-muted-foreground m-0 mt-1">{bio}</p>}
      </div>
    </div>
  );
}

export function PostExcerptView({
  showMore,
  lang,
  cls,
}: {
  showMore: boolean;
  lang: Lang;
  cls: string;
}) {
  const ctx = useCurrentPostCtx();
  const text = (lang === "en" ? ctx?.excerpt_en : ctx?.excerpt_pl) ?? "";
  if (!text) return null;
  return (
    <p className={`text-muted-foreground ${cls}`}>
      {text}
      {showMore && ctx?.slug && (
        <>
          {" "}
          <AppLink href={`/post/${ctx.slug}`} className="text-primary hover:underline">
            {lang === "en" ? "Read more" : "Czytaj dalej"}
          </AppLink>
        </>
      )}
    </p>
  );
}

export function PostFeaturedImageView({
  aspect,
  rounded,
  cls,
}: {
  aspect: string;
  rounded: boolean;
  cls: string;
}) {
  const ctx = useCurrentPostCtx();
  if (!ctx?.coverUrl) return null;
  const r = rounded ? "rounded-lg" : "";
  return (
    <figure
      className={`not-prose my-4 overflow-hidden ${r} ${cls}`}
      style={{ aspectRatio: aspect.replace("/", " / ") }}
    >
      <OptimizedImage
        src={ctx.coverUrl}
        alt={ctx.title_pl ?? ctx.title_en ?? ""}
        className="w-full h-full object-cover"
        responsive
        sizes="(max-width: 768px) 100vw, 1024px"
      />
    </figure>
  );
}

export function PostTermsView({ taxonomy, cls }: { taxonomy: "categories" | "tags"; cls: string }) {
  const ctx = useCurrentPostCtx();
  const items = taxonomy === "tags" ? (ctx?.tags ?? []) : (ctx?.categories ?? []);
  if (items.length === 0) return null;
  const prefix = taxonomy === "tags" ? "/tag/" : "/category/";
  return (
    <ul className={`not-prose flex flex-wrap gap-2 list-none m-0 p-0 ${cls}`}>
      {items.map((it) => (
        <li key={it.slug}>
          <AppLink
            href={`${prefix}${it.slug}`}
            className="inline-flex items-center px-2 py-1 rounded-md bg-muted text-xs hover:bg-primary hover:text-primary-foreground transition-colors"
          >
            {taxonomy === "tags" ? `#${it.name}` : it.name}
          </AppLink>
        </li>
      ))}
    </ul>
  );
}

interface SiteGeneral {
  name?: string;
  tagline?: string;
  logo_url?: string;
}

export function SiteTitleView({ level, cls }: { level: number; cls: string }) {
  const s = useSiteSetting<SiteGeneral>("general", {});
  const text = s.name ?? "";
  if (!text) return null;
  const Tag = `h${Math.min(Math.max(level, 1), 4)}` as "h1" | "h2" | "h3" | "h4";
  return (
    <Tag className={cls}>
      <AppLink href="/" className="hover:text-primary no-underline">
        {text}
      </AppLink>
    </Tag>
  );
}

export function SiteTaglineView({ cls }: { cls: string }) {
  const s = useSiteSetting<SiteGeneral>("general", {});
  if (!s.tagline) return null;
  return <p className={`text-muted-foreground ${cls}`}>{s.tagline}</p>;
}

export function SiteLogoView({ width, cls }: { width: number; cls: string }) {
  const s = useSiteSetting<SiteGeneral>("general", {});
  if (!s.logo_url) return null;
  const w = Math.min(480, Math.max(32, width));
  return (
    <AppLink href="/" className={`not-prose inline-block ${cls}`} aria-label={s.name ?? "Home"}>
      <img
        src={s.logo_url}
        alt={s.name ?? ""}
        style={{ width: w, height: "auto" }}
        loading="eager"
      />
    </AppLink>
  );
}
