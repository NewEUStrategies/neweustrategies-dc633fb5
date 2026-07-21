// Molekuły renderera bloków: samodzielne widżety prezentacyjne komponujące
// kilka atomów/elementów lub opakowujące gotowy widok. Statyczne (bez czytania
// danych innego tenanta na renderze) - formularze zapisują dane chronione
// osobno przez RLS, ale nie zaciągają list treści.

import type { ComponentType } from "react";
import {
  ThumbsUp,
  ThumbsDown,
  Facebook,
  Instagram,
  Youtube,
  Linkedin,
  Github,
  Mail,
  Rss,
  Search as SearchIcon,
  Music as TikTokIcon,
} from "lucide-react";
import { safeImageUrl, safeUrl } from "@/lib/sanitize";
import { parseEmbedUrl, isIframeEmbed } from "@/lib/blocks/embed";
import { XIcon } from "@/components/atoms/XIcon";
import { OptimizedImage } from "@/components/atoms/OptimizedImage";
import { NewsletterForm } from "@/components/NewsletterForm";
import type { BlockRenderer } from "./context";
import { bool, jsonList, num, objList, sanitize, str, strList } from "./data";
import { CodeBlockView } from "../CodeBlockView";
import { GalleryBlock } from "../GalleryBlock";
import { ReviewBlockView } from "../ReviewBlockView";
import { FaqBlockView } from "../FaqBlockView";
import { TocBlockView } from "../TocBlockView";
import { AffiliateBlockView } from "../AffiliateBlockView";
import { XQuoteShare } from "../XQuoteShare";
import { CompareSlider } from "../CompareSlider";
import {
  LoginFormView,
  RegisterFormView,
  LostPasswordFormView,
  ResetPasswordFormView,
} from "../AuthFormBlocks";
import { AccordionView, TabsView, CountdownView, ProgressView } from "../InteractiveViews";
import {
  IconBoxView,
  StatsCounterView,
  TestimonialsView,
  PricingTableView,
  TimelineView,
} from "../PresentationViews";
import {
  HeroView,
  CtaSectionView,
  ImageCarouselView,
  ContactFormView,
  MapView,
} from "../MarketingViews";
import {
  TeamGridView,
  LogoGridView,
  FeatureGridView,
  AlertBannerView,
  DividerTextView,
} from "../DataSocialViews";
import {
  StepListView,
  ComparisonTableView,
  BannerImageView,
  VideoHeroView,
} from "../ConversionViews";
import { ChartBlockView, DataMapBlockView } from "../DataVizViews";

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------

/** Pojedynczy obraz z podpisem, opcjonalnie linkujący. */
export const renderImage: BlockRenderer = ({ block, cls }) => {
  const url = safeImageUrl(str(block.data, "url"));
  const alt = str(block.data, "alt");
  const cap = str(block.data, "caption");
  const href = safeUrl(str(block.data, "href"), "");
  if (!url) return null;
  // Wymiary stemplowane przez edytor (naturalWidth/Height) - OptimizedImage
  // wyprowadza z nich aspect-ratio i rezerwuje miejsce zanim obraz się doczyta
  // (CLS=0). Starsze bloki bez wymiarów renderują się jak dotąd.
  const rawW = num(block.data, "width", NaN);
  const rawH = num(block.data, "height", NaN);
  const dims =
    Number.isFinite(rawW) && Number.isFinite(rawH) && rawW > 0 && rawH > 0
      ? { width: Math.round(rawW), height: Math.round(rawH) }
      : undefined;
  const img = (
    <OptimizedImage
      src={url}
      alt={alt}
      className="rounded-lg"
      responsive
      sizes="(max-width: 768px) 100vw, 800px"
      width={dims?.width}
      height={dims?.height}
    />
  );
  const wrapped = href ? (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {img}
    </a>
  ) : (
    img
  );
  return (
    <figure className={cls}>
      {wrapped}
      {cap && (
        <figcaption className="text-sm text-muted-foreground text-center italic mt-2">
          {cap}
        </figcaption>
      )}
    </figure>
  );
};

/** Blok kodu z podświetlaniem. */
export const renderCode: BlockRenderer = ({ block, cls }) => {
  const code = str(block.data, "code");
  const lang = str(block.data, "lang");
  return <CodeBlockView code={code} lang={lang} className={cls} />;
};

/** Embed (YouTube/Vimeo/X…) jako iframe lub fallback-link dla bezpiecznego URL. */
export const renderEmbed: BlockRenderer = ({ block, cls }) => {
  const url = str(block.data, "url");
  const parsed = parseEmbedUrl(url);
  if (!parsed || !isIframeEmbed(parsed)) {
    const link = safeUrl(url, "");
    return link ? (
      <p className={cls}>
        <a href={link} target="_blank" rel="noopener noreferrer">
          {link}
        </a>
      </p>
    ) : null;
  }
  return (
    <div className={`relative aspect-video w-full ${cls}`}>
      <iframe
        src={parsed.embedUrl}
        title={parsed.provider}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        loading="lazy"
        className="absolute inset-0 w-full h-full rounded-lg"
      />
    </div>
  );
};

/** Wideo (plik lub URL) z posterem. */
export const renderVideo: BlockRenderer = ({ block, cls }) => {
  const url = safeUrl(str(block.data, "url"), "");
  const poster = safeImageUrl(str(block.data, "poster"));
  if (!url) return null;
  return (
    <video
      src={url}
      poster={poster || undefined}
      controls
      preload="metadata"
      className={`w-full rounded-lg ${cls}`}
    />
  );
};

/** Galeria - siatka obrazów. */
export const renderGallery: BlockRenderer = ({ block, cls }) => {
  const images = objList(block.data, "images", (o) => ({
    url: str(o, "url"),
    alt: str(o, "alt"),
  })).filter((i) => Boolean(i.url));
  return <GalleryBlock images={images} className={cls} />;
};

/** Plik dźwiękowy z podpisem. */
export const renderAudio: BlockRenderer = ({ block, cls }) => {
  const url = str(block.data, "url");
  const caption = str(block.data, "caption");
  if (!url) return null;
  return (
    <figure className={`not-prose my-4 ${cls}`}>
      <audio src={url} controls preload="metadata" className="w-full" />
      {caption && (
        <figcaption className="text-sm text-muted-foreground text-center italic mt-2">
          {caption}
        </figcaption>
      )}
    </figure>
  );
};

/** Okładka - obraz tła z nakładką i tytułem. */
export const renderCover: BlockRenderer = ({ block, cls }) => {
  const url = safeImageUrl(str(block.data, "url"));
  const title = str(block.data, "title");
  const overlay = Math.min(100, Math.max(0, num(block.data, "overlay", 50)));
  const minHeight = Math.min(800, Math.max(120, num(block.data, "minHeight", 360)));
  if (!url) return null;
  return (
    <div
      className={`relative w-full rounded-lg overflow-hidden flex items-center justify-center not-prose my-4 ${cls}`}
      // url jest ograniczony schematem przez safeImageUrl; cytujemy go, by
      // wartość została pojedynczym tokenem url() nawet z nawiasami w środku.
      style={{
        minHeight,
        backgroundImage: `url("${url}")`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      <div className="absolute inset-0 bg-black" style={{ opacity: overlay / 100 }} />
      {title && (
        <h2 className="relative z-10 text-white text-3xl md:text-5xl font-semibold text-center px-6">
          {title}
        </h2>
      )}
    </div>
  );
};

/** Plik do pobrania (link + opcjonalny przycisk). */
export const renderFile: BlockRenderer = ({ block, cls, t }) => {
  const url = safeUrl(str(block.data, "url"), "");
  const label = str(block.data, "label") || t("blocksUi.downloadFile");
  const showButton = bool(block.data, "showButton", true);
  if (!url) return null;
  const labelDownload = t("blocksUi.download");
  return (
    <div
      className={`not-prose my-4 flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 px-4 py-3 ${cls}`}
    >
      <a
        href={url}
        className="text-foreground hover:text-primary font-medium truncate"
        target="_blank"
        rel="noopener noreferrer"
      >
        {label}
      </a>
      {showButton && (
        <a
          href={url}
          download
          className="shrink-0 inline-flex items-center px-3 py-1.5 rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90"
        >
          {labelDownload}
        </a>
      )}
    </div>
  );
};

/** Media i tekst obok siebie (50/50, media po lewej lub prawej). */
export const renderMediaText: BlockRenderer = ({ block, cls }) => {
  const url = safeImageUrl(str(block.data, "url"));
  const text = str(block.data, "text");
  const isRight = str(block.data, "mediaPosition", "left") === "right";
  return (
    <div
      className={`not-prose my-6 grid grid-cols-1 md:grid-cols-2 gap-6 items-center ${isRight ? "md:[&>*:first-child]:order-2" : ""} ${cls}`}
    >
      <div className="aspect-video rounded-lg overflow-hidden bg-muted">
        {url && (
          <OptimizedImage
            src={url}
            alt=""
            responsive
            sizes="(min-width: 768px) 50vw, 100vw"
            className="w-full h-full object-cover"
          />
        )}
      </div>
      <div className="prose dark:prose-invert max-w-none whitespace-pre-line">{text}</div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Tabela
// ---------------------------------------------------------------------------

/** Tabela z opcjonalnym wierszem nagłówka (komórki mogą nieść przypisy). */
export const renderTable: BlockRenderer = ({ block, fnHtml, cls }) => {
  const rowsRaw = Array.isArray(block.data.rows) ? block.data.rows : [];
  const rows: string[][] = rowsRaw.map((r) =>
    Array.isArray(r) ? r.map((c) => (typeof c === "string" ? c : c == null ? "" : String(c))) : [],
  );
  const header = bool(block.data, "header", false);
  if (rows.length === 0) return null;
  // Zachowujemy oryginalne indeksy wierszy, by klucze przypisów
  // (`${id}:cell:${ri}:${ci}`) pozostały zgodne z precomputeFootnotes.
  const headIdx = header ? 0 : -1;
  const head = header ? rows[0] : null;
  const body = header
    ? rows.slice(1).map((r, i) => ({ r, ri: i + 1 }))
    : rows.map((r, i) => ({ r, ri: i }));
  const renderCell = (Tag: "th" | "td", ri: number, ci: number, c: string) => {
    const withFn = fnHtml.get(`${block.id}:cell:${ri}:${ci}`);
    return withFn !== undefined ? (
      <Tag key={ci} dangerouslySetInnerHTML={{ __html: withFn }} />
    ) : (
      <Tag key={ci}>{c}</Tag>
    );
  };
  return (
    <div className={`overflow-x-auto ${cls}`}>
      <table>
        {head && (
          <thead>
            <tr>{head.map((c, ci) => renderCell("th", headIdx, ci, c))}</tr>
          </thead>
        )}
        <tbody>
          {body.map(({ r, ri }) => (
            <tr key={ri}>{r.map((c, ci) => renderCell("td", ri, ci, c))}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Grupy przycisków / ikony / wyszukiwarka
// ---------------------------------------------------------------------------

/** Grupa przycisków w jednej linii (align left/center/right). */
export const renderButtons: BlockRenderer = ({ block, cls }) => {
  const items = objList(block.data, "items", (o) => ({
    label: str(o, "label"),
    href: str(o, "href", "#"),
    variant: str(o, "variant", "default"),
  }));
  const align = str(block.data, "align", "left");
  const alignCls =
    align === "center" ? "justify-center" : align === "right" ? "justify-end" : "justify-start";
  if (items.length === 0) return null;
  return (
    <div className={`not-prose flex flex-wrap gap-2 ${alignCls} ${cls}`}>
      {items.map((it, i) => {
        const label = it.label;
        const href = safeUrl(it.href);
        const stl =
          it.variant === "outline"
            ? "border border-primary text-primary hover:bg-primary/10"
            : it.variant === "ghost"
              ? "text-primary hover:bg-primary/10"
              : "bg-primary text-primary-foreground hover:bg-primary/90";
        if (!label) return null;
        return (
          <a
            key={i}
            href={href}
            className={`inline-flex items-center px-4 py-2 rounded-md text-sm font-medium ${stl}`}
          >
            {label}
          </a>
        );
      })}
    </div>
  );
};

const SOCIAL_ICON_MAP: Record<string, ComponentType<{ className?: string }>> = {
  facebook: Facebook,
  x: XIcon,
  twitter: XIcon,
  instagram: Instagram,
  youtube: Youtube,
  linkedin: Linkedin,
  tiktok: TikTokIcon,
  github: Github,
  mail: Mail,
  rss: Rss,
};

/** Linki do mediów społecznościowych jako ikony. */
export const renderSocialIcons: BlockRenderer = ({ block, cls }) => {
  const items = objList(block.data, "items", (o) => ({
    platform: str(o, "platform"),
    url: str(o, "url"),
  }));
  const size = str(block.data, "size", "md");
  const align = str(block.data, "align", "left");
  const alignCls =
    align === "center" ? "justify-center" : align === "right" ? "justify-end" : "justify-start";
  const sizeCls = size === "sm" ? "h-4 w-4" : size === "lg" ? "h-7 w-7" : "h-5 w-5";
  if (items.length === 0) return null;
  return (
    <div className={`not-prose flex flex-wrap gap-3 ${alignCls} ${cls}`}>
      {items.map((it, i) => {
        const Icon = SOCIAL_ICON_MAP[it.platform.toLowerCase()] ?? Rss;
        const url = safeUrl(it.url, "");
        if (!url) return null;
        return (
          <a
            key={i}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={it.platform || "social"}
            className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-muted hover:bg-primary hover:text-primary-foreground transition-colors"
          >
            <Icon className={sizeCls} />
          </a>
        );
      })}
    </div>
  );
};

/** Formularz wyszukiwania witryny (GET -> action). */
export const renderSearch: BlockRenderer = ({ block, cls, t }) => {
  const placeholder = str(block.data, "placeholder") || t("blocksUi.searchPlaceholder");
  const buttonLabel = str(block.data, "buttonLabel") || t("blocksUi.searchButton");
  const action = str(block.data, "action", "/search");
  return (
    <form className={`not-prose flex gap-2 ${cls}`} action={action} method="get" role="search">
      <input
        type="search"
        name="q"
        placeholder={placeholder}
        aria-label={placeholder}
        className="flex-1 h-10 px-3 rounded-md border border-border bg-background text-sm"
      />
      <button
        type="submit"
        className="inline-flex items-center gap-1 px-4 h-10 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90"
      >
        <SearchIcon className="h-4 w-4" />
        {buttonLabel}
      </button>
    </form>
  );
};

// ---------------------------------------------------------------------------
// Widżety treści (proscons / spoiler / details / faq / toc / newsletter …)
// ---------------------------------------------------------------------------

/** Plusy i minusy - dwie kolumny. */
export const renderProsCons: BlockRenderer = ({ block, cls, t }) => {
  const title = str(block.data, "title");
  const pros = strList(block.data, "pros").filter(Boolean);
  const cons = strList(block.data, "cons").filter(Boolean);
  const LBL = { pros: t("blocksUi.pros"), cons: t("blocksUi.cons") };
  if (!pros.length && !cons.length) return null;
  return (
    <section className={`not-prose my-6 ${cls}`}>
      {title && <h3 className="text-base font-semibold mb-3">{title}</h3>}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-emerald-700 dark:text-emerald-300 mb-2">
            <ThumbsUp className="w-4 h-4" /> {LBL.pros}
          </div>
          <ul className="m-0 pl-5 list-disc space-y-1 text-sm">
            {pros.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </div>
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-red-700 dark:text-red-300 mb-2">
            <ThumbsDown className="w-4 h-4" /> {LBL.cons}
          </div>
          <ul className="m-0 pl-5 list-disc space-y-1 text-sm">
            {cons.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
};

/** Spoiler / rozwijany blok HTML. */
export const renderSpoiler: BlockRenderer = ({ block, cls, t }) => {
  const summary = str(block.data, "summary");
  const inner = sanitize(str(block.data, "html"));
  const open = bool(block.data, "defaultOpen", false);
  if (!inner) return null;
  return (
    <details
      className={`not-prose my-4 rounded-md border border-border bg-muted/30 ${cls}`}
      open={open}
    >
      <summary className="cursor-pointer select-none px-4 py-3 font-medium text-sm hover:bg-accent/50 rounded-t-md">
        {summary || t("blocksUi.showMore")}
      </summary>
      <div
        className="px-4 py-3 border-t border-border text-sm"
        dangerouslySetInnerHTML={{ __html: inner }}
      />
    </details>
  );
};

/** Rozwijane szczegóły (summary + body jako zwykły tekst). */
export const renderDetails: BlockRenderer = ({ block, cls, t }) => {
  const summary = str(block.data, "summary");
  const body = str(block.data, "body");
  if (!summary && !body) return null;
  return (
    <details className={`not-prose my-4 rounded-md border border-border bg-muted/20 ${cls}`}>
      <summary className="cursor-pointer select-none px-4 py-3 font-medium text-sm hover:bg-accent/40 rounded-t-md">
        {summary || t("blocksUi.details")}
      </summary>
      <div className="px-4 py-3 border-t border-border text-sm whitespace-pre-line">{body}</div>
    </details>
  );
};

/** FAQ (schema.org FAQPage) - deleguje do FaqBlockView. */
export const renderFaq: BlockRenderer = ({ block, cls, lang }) => {
  const items = objList(block.data, "items", (o) => ({ q: str(o, "q"), a: str(o, "a") }));
  return (
    <div className={cls}>
      <FaqBlockView items={items} title={str(block.data, "title")} lang={lang} />
    </div>
  );
};

/** Spis treści - liczony z nagłówków całego dokumentu. */
export const renderToc: BlockRenderer = ({ block, cls, lang, allBlocks }) => {
  const cols = str(block.data, "columns", "col-1");
  const columns = (cols === "col-2" || cols === "half" ? cols : "col-1") as
    | "col-1"
    | "col-2"
    | "half";
  return (
    <div className={cls}>
      <TocBlockView
        blocks={[...allBlocks]}
        title={str(block.data, "title")}
        minLevel={num(block.data, "minLevel", 2)}
        maxLevel={num(block.data, "maxLevel", 3)}
        ordered={bool(block.data, "ordered", false)}
        sticky={bool(block.data, "sticky", false)}
        columns={columns}
        lang={lang}
      />
    </div>
  );
};

/** Newsletter inline (card lub inline). */
export const renderNewsletter: BlockRenderer = ({ block, cls, lang }) => {
  const title = str(block.data, "title");
  const description = str(block.data, "description");
  const variant = (str(block.data, "variant", "card") === "inline" ? "inline" : "card") as
    | "card"
    | "inline";
  return (
    <section
      className={`not-prose my-6 rounded-lg border border-border bg-gradient-to-br from-primary/10 to-transparent p-5 ${cls}`}
    >
      {title && <h3 className="text-lg font-semibold m-0 mb-1">{title}</h3>}
      {description && <p className="text-sm text-muted-foreground mb-3 m-0">{description}</p>}
      <NewsletterForm lang={lang} source="inline-block" variant={variant} />
    </section>
  );
};

/** Recenzja (Review Box). */
export const renderReview: BlockRenderer = ({ block, cls, lang }) => {
  const criteria = objList(block.data, "criteria", (o) => ({
    label: str(o, "label"),
    score: num(o, "score", 0),
  }));
  return (
    <div className={cls}>
      <ReviewBlockView
        title={str(block.data, "title")}
        summary={str(block.data, "summary")}
        criteria={criteria}
        ctaLabel={str(block.data, "ctaLabel")}
        ctaHref={str(block.data, "ctaHref")}
        scale={num(block.data, "scale", 10)}
        lang={lang}
      />
    </div>
  );
};

/** Produkt afiliacyjny. */
export const renderAffiliate: BlockRenderer = ({ block, cls, lang }) => (
  <div className={cls}>
    <AffiliateBlockView
      title={str(block.data, "title")}
      description={str(block.data, "description")}
      image={str(block.data, "image")}
      price={str(block.data, "price")}
      currency={str(block.data, "currency")}
      store={str(block.data, "store")}
      ctaLabel={str(block.data, "ctaLabel")}
      ctaHref={str(block.data, "ctaHref")}
      rating={num(block.data, "rating", 0)}
      sponsored={bool(block.data, "sponsored", true)}
      lang={lang}
    />
  </div>
);

/** X Quote (click-to-tweet). */
export const renderXQuote: BlockRenderer = ({ block, cls, lang }) => {
  const text = str(block.data, "text");
  if (!text) return null;
  return (
    <div className={cls}>
      <XQuoteShare
        text={text}
        via={str(block.data, "via")}
        hashtags={str(block.data, "hashtags")}
        lang={lang}
      />
    </div>
  );
};

/** Before / After - slider porównujący dwa obrazy. */
export const renderCompare: BlockRenderer = ({ block, cls, t }) => {
  const before = str(block.data, "before");
  const after = str(block.data, "after");
  if (!before || !after) return null;
  return (
    <div className={`not-prose my-6 ${cls}`}>
      <CompareSlider
        before={before}
        after={after}
        labelBefore={str(block.data, "labelBefore") || t("blocksUi.before")}
        labelAfter={str(block.data, "labelAfter") || t("blocksUi.after")}
      />
    </div>
  );
};

// ---------------------------------------------------------------------------
// Formularze auth (strukturalne)
// ---------------------------------------------------------------------------

export const renderLoginForm: BlockRenderer = ({ block, cls, lang }) => (
  <div className={cls}>
    <LoginFormView data={block.data} lang={lang} />
  </div>
);

export const renderRegisterForm: BlockRenderer = ({ block, cls, lang }) => (
  <div className={cls}>
    <RegisterFormView data={block.data} lang={lang} />
  </div>
);

export const renderLostPasswordForm: BlockRenderer = ({ block, cls, lang }) => (
  <div className={cls}>
    <LostPasswordFormView data={block.data} lang={lang} />
  </div>
);

export const renderResetPasswordForm: BlockRenderer = ({ block, cls, lang }) => (
  <div className={cls}>
    <ResetPasswordFormView data={block.data} lang={lang} />
  </div>
);

// ---------------------------------------------------------------------------
// Interaktywne
// ---------------------------------------------------------------------------

export const renderAccordion: BlockRenderer = ({ block, cls }) => (
  <AccordionView
    items={jsonList(block.data, "items")}
    allowMultiple={block.data.allowMultiple === true}
    cls={cls}
  />
);

export const renderTabs: BlockRenderer = ({ block, cls }) => {
  const orient = str(block.data, "orientation", "horizontal");
  return (
    <TabsView
      items={jsonList(block.data, "items")}
      orientation={orient === "vertical" ? "vertical" : "horizontal"}
      cls={cls}
    />
  );
};

export const renderCountdown: BlockRenderer = ({ block, cls, lang }) => (
  <CountdownView
    targetAt={str(block.data, "targetAt")}
    label={str(block.data, "label")}
    expiredText={str(block.data, "expiredText")}
    lang={lang}
    cls={cls}
  />
);

export const renderProgress: BlockRenderer = ({ block, cls }) => {
  const c = str(block.data, "color", "primary");
  const color: "primary" | "success" | "warning" | "danger" =
    c === "success"
      ? "success"
      : c === "warning"
        ? "warning"
        : c === "danger"
          ? "danger"
          : "primary";
  return (
    <ProgressView
      value={num(block.data, "value", 0)}
      label={str(block.data, "label")}
      showValue={bool(block.data, "showValue", true)}
      color={color}
      cls={cls}
    />
  );
};

// ---------------------------------------------------------------------------
// Prezentacja / marketing / konwersja / dane
// ---------------------------------------------------------------------------

export const renderIconBox: BlockRenderer = ({ block, cls }) => {
  const a = str(block.data, "align", "center");
  return (
    <IconBoxView
      icon={str(block.data, "icon", "star")}
      title={str(block.data, "title")}
      description={str(block.data, "description")}
      href={str(block.data, "href")}
      linkLabel={str(block.data, "linkLabel")}
      align={a === "left" ? "left" : "center"}
      cls={cls}
    />
  );
};

export const renderStatsCounter: BlockRenderer = ({ block, cls, lang }) => (
  <StatsCounterView
    items={jsonList(block.data, "items")}
    duration={num(block.data, "duration", 1500)}
    cls={cls}
    lang={lang}
  />
);

export const renderTestimonials: BlockRenderer = ({ block, cls }) => {
  const l = str(block.data, "layout", "grid");
  return (
    <TestimonialsView
      items={jsonList(block.data, "items")}
      layout={l === "slider" ? "slider" : "grid"}
      cls={cls}
    />
  );
};

export const renderPricingTable: BlockRenderer = ({ block, cls }) => (
  <PricingTableView plans={jsonList(block.data, "plans")} cls={cls} />
);

export const renderTimeline: BlockRenderer = ({ block, cls }) => (
  <TimelineView items={jsonList(block.data, "items")} cls={cls} />
);

export const renderHero: BlockRenderer = ({ block, cls }) => {
  const a = str(block.data, "align", "center");
  const h = str(block.data, "height", "md");
  const height = h === "sm" || h === "md" || h === "lg" || h === "screen" ? h : "md";
  return (
    <HeroView
      eyebrow={str(block.data, "eyebrow")}
      title={str(block.data, "title")}
      subtitle={str(block.data, "subtitle")}
      bgImage={str(block.data, "bgImage")}
      ctaLabel={str(block.data, "ctaLabel")}
      ctaHref={str(block.data, "ctaHref")}
      secondaryLabel={str(block.data, "secondaryLabel")}
      secondaryHref={str(block.data, "secondaryHref")}
      align={a === "left" ? "left" : "center"}
      height={height}
      overlay={num(block.data, "overlay", 40)}
      cls={cls}
    />
  );
};

export const renderCtaSection: BlockRenderer = ({ block, cls }) => {
  const v = str(block.data, "variant", "primary");
  const variant = v === "muted" || v === "gradient" || v === "outline" ? v : "primary";
  return (
    <CtaSectionView
      title={str(block.data, "title")}
      description={str(block.data, "description")}
      ctaLabel={str(block.data, "ctaLabel")}
      ctaHref={str(block.data, "ctaHref")}
      variant={variant}
      cls={cls}
    />
  );
};

export const renderImageCarousel: BlockRenderer = ({ block, cls }) => (
  <ImageCarouselView
    items={jsonList(block.data, "items")}
    autoplay={block.data.autoplay === true}
    interval={num(block.data, "interval", 5000)}
    aspect={str(block.data, "aspect", "16:9")}
    cls={cls}
  />
);

export const renderContactForm: BlockRenderer = ({ block, cls, lang }) => (
  <ContactFormView
    title={str(block.data, "title")}
    description={str(block.data, "description")}
    showPhone={block.data.showPhone === true}
    showSubject={bool(block.data, "showSubject", true)}
    requireConsent={bool(block.data, "requireConsent", true)}
    submitLabel={str(block.data, "submitLabel")}
    successMessage={str(block.data, "successMessage")}
    lang={lang}
    cls={cls}
  />
);

export const renderMap: BlockRenderer = ({ block, cls }) => (
  <MapView
    lat={num(block.data, "lat", 52.2297)}
    lng={num(block.data, "lng", 21.0122)}
    zoom={num(block.data, "zoom", 13)}
    height={num(block.data, "height", 360)}
    label={str(block.data, "label")}
    cls={cls}
  />
);

export const renderTeamGrid: BlockRenderer = ({ block, cls }) => {
  const s = str(block.data, "shape", "circle");
  return (
    <TeamGridView
      title={str(block.data, "title")}
      items={jsonList(block.data, "items")}
      columns={num(block.data, "columns", 3)}
      shape={s === "square" ? "square" : "circle"}
      cls={cls}
    />
  );
};

export const renderLogoGrid: BlockRenderer = ({ block, cls }) => (
  <LogoGridView
    title={str(block.data, "title")}
    items={jsonList(block.data, "items")}
    columns={num(block.data, "columns", 5)}
    grayscale={bool(block.data, "grayscale", true)}
    bordered={block.data.bordered === true}
    cls={cls}
  />
);

export const renderFeatureGrid: BlockRenderer = ({ block, cls }) => {
  const st = str(block.data, "style", "card");
  const style = st === "minimal" || st === "bordered" ? st : "card";
  return (
    <FeatureGridView
      title={str(block.data, "title")}
      subtitle={str(block.data, "subtitle")}
      items={jsonList(block.data, "items")}
      columns={num(block.data, "columns", 3)}
      style={style}
      cls={cls}
    />
  );
};

export const renderAlertBanner: BlockRenderer = ({ block, cls }) => {
  const v = str(block.data, "variant", "info");
  const variant =
    v === "success" || v === "warning" || v === "danger" || v === "neutral" ? v : "info";
  return (
    <AlertBannerView
      variant={variant}
      title={str(block.data, "title")}
      message={str(block.data, "message")}
      ctaLabel={str(block.data, "ctaLabel")}
      ctaHref={str(block.data, "ctaHref")}
      dismissible={block.data.dismissible === true}
      showIcon={bool(block.data, "showIcon", true)}
      cls={cls}
    />
  );
};

export const renderDividerText: BlockRenderer = ({ block, cls }) => {
  const a = str(block.data, "align", "center");
  const ls = str(block.data, "lineStyle", "solid");
  return (
    <DividerTextView
      text={str(block.data, "text")}
      align={a === "left" || a === "right" ? a : "center"}
      lineStyle={ls === "dashed" || ls === "dotted" ? ls : "solid"}
      cls={cls}
    />
  );
};

export const renderStepList: BlockRenderer = ({ block, cls }) => {
  const o = str(block.data, "orientation", "vertical");
  const ns = str(block.data, "numberStyle", "circle");
  return (
    <StepListView
      title={str(block.data, "title")}
      items={jsonList(block.data, "items")}
      orientation={o === "horizontal" ? "horizontal" : "vertical"}
      numberStyle={ns === "square" || ns === "plain" ? ns : "circle"}
      cls={cls}
    />
  );
};

export const renderComparisonTable: BlockRenderer = ({ block, cls }) => (
  <ComparisonTableView
    title={str(block.data, "title")}
    columns={jsonList(block.data, "columns")}
    rows={jsonList(block.data, "rows")}
    featuredIndex={num(block.data, "featuredIndex", -1)}
    cls={cls}
  />
);

export const renderBannerImage: BlockRenderer = ({ block, cls }) => {
  const pos = str(block.data, "position", "left");
  const th = str(block.data, "theme", "dark");
  return (
    <BannerImageView
      image={str(block.data, "image")}
      alt={str(block.data, "alt")}
      title={str(block.data, "title")}
      description={str(block.data, "description")}
      ctaLabel={str(block.data, "ctaLabel")}
      ctaHref={str(block.data, "ctaHref")}
      position={pos === "center" || pos === "right" ? pos : "left"}
      theme={th === "light" ? "light" : "dark"}
      aspect={str(block.data, "aspect", "21:9")}
      overlay={num(block.data, "overlay", 35)}
      cls={cls}
    />
  );
};

export const renderVideoHero: BlockRenderer = ({ block, cls }) => {
  const h = str(block.data, "height", "lg");
  const al = str(block.data, "align", "center");
  return (
    <VideoHeroView
      src={str(block.data, "src")}
      poster={str(block.data, "poster")}
      title={str(block.data, "title")}
      subtitle={str(block.data, "subtitle")}
      ctaLabel={str(block.data, "ctaLabel")}
      ctaHref={str(block.data, "ctaHref")}
      height={h === "md" || h === "screen" ? h : "lg"}
      align={al === "left" ? "left" : "center"}
      overlay={num(block.data, "overlay", 45)}
      autoplay={bool(block.data, "autoplay", true)}
      loop={bool(block.data, "loop", true)}
      cls={cls}
    />
  );
};

export const renderChart: BlockRenderer = ({ block, cls, lang }) => (
  <ChartBlockView data={block.data} lang={lang} cls={cls} />
);

export const renderDataMap: BlockRenderer = ({ block, cls, lang }) => (
  <DataMapBlockView data={block.data} lang={lang} cls={cls} />
);
