// Dynamic-tag widget renderers. Surface the current post/archive context in a
// structural, non-HTML way.
//
// ZASADA BEZPIECZEŃSTWA DANYCH (regresja naprawiona tutaj): dane przykładowe
// wolno pokazać WYŁĄCZNIE w kanwie buildera. Wcześniej `useCtx()` robiło
// `useCurrentPostCtx() ?? PLACEHOLDER_POST_CTX`, a nagłówek, stopka, popup,
// szuflada mobilna i archiwa renderują `BuilderRenderer` BEZ providera - więc
// widget `post-*` wstawiony w takie miejsce pokazywał realnym odwiedzającym
// fikcyjnego "Jana Kowalskiego", zmyślony tytuł i tagi "Przykład/CMS".
// Teraz brak kontekstu poza edytorem = `null` (widget po prostu znika).
import { createElement, type ComponentType, type ReactElement, type SVGProps } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppLink } from "@/components/atoms/AppLink";
import type { WidgetNode } from "@/lib/builder/types";
import {
  useCurrentPostCtxOrPreview,
  type CurrentPostAuthor,
  type CurrentPostCtx,
} from "@/lib/content-model/postContext";
import { asBool, asNum, asOneOf, asStr, pickI18n } from "@/lib/content-model/contentValue";
import { postViewCountQueryOptions } from "@/lib/builder/postViewCountQuery";
import { safeImageUrl, safeUrl } from "@/lib/sanitize";
import {
  User as UserIcon,
  Clock,
  Eye,
  ChevronRight,
  Search as SearchIcon,
  Globe,
  Mail,
  Facebook,
  Instagram,
  Linkedin,
  Twitter,
  Headphones,
  Link as LinkIcon,
} from "@/lib/lucide-shim";
import { AuthorByline } from "@/components/molecules/AuthorByline";
import { buildAvatarSrc, buildAvatarSrcSet } from "@/lib/cropSizes";
import {
  authorLabelText,
  defaultAuthorLabel,
  resolveAuthorDisplay,
  widgetAuthorDisplayDefaults,
} from "@/lib/builder/authorDisplay";

type Lang = "pl" | "en";

/** Zamknięte zbiory wariantów - renderer rysuje realnie każdą pozycję. */
const TITLE_TAGS = ["h1", "h2", "h3", "h4", "h5", "h6", "p"] as const;
const DATE_FORMATS = ["long", "short", "relative"] as const;
const TERM_VARIANTS = ["pill", "outline", "text"] as const;
const AUTHOR_VARIANTS = ["card", "inline", "centered"] as const;
const COVER_ASPECTS = ["16/9", "4/3", "3/2", "1/1", "21/9"] as const;
const CRUMB_SEPARATORS = ["/", ">"] as const;

type TermVariant = (typeof TERM_VARIANTS)[number];

/**
 * Kontekst wpisu dla renderera. `null` = brak realnych danych POZA edytorem;
 * w kanwie buildera zwracana jest bezpieczna próbka (patrz currentPostContext).
 */
function useCtx(): CurrentPostCtx | null {
  return useCurrentPostCtxOrPreview();
}

/** Odczyt stringa z treści widgetu z domyślną wartością (kanon: `asStr`). */
function strOr(value: unknown, fallback: string): string {
  return asStr(value) || fallback;
}

function pickLocalized(ctx: CurrentPostCtx, lang: Lang, key: "title" | "excerpt"): string {
  if (key === "title")
    return (lang === "en" ? ctx.title_en : ctx.title_pl) || ctx.title_pl || ctx.title_en || "";
  return (
    (lang === "en" ? ctx.excerpt_en : ctx.excerpt_pl) || ctx.excerpt_pl || ctx.excerpt_en || ""
  );
}

function fmtDate(iso: string | undefined, lang: Lang, fmt: string): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (fmt === "relative") {
      const diff = (Date.now() - d.getTime()) / 1000;
      if (diff < 60) return lang === "en" ? "just now" : "przed chwilą";
      if (diff < 3600)
        return lang === "en"
          ? `${Math.floor(diff / 60)} min ago`
          : `${Math.floor(diff / 60)} min temu`;
      if (diff < 86400)
        return lang === "en"
          ? `${Math.floor(diff / 3600)} h ago`
          : `${Math.floor(diff / 3600)} godz. temu`;
    }
    return new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "pl-PL", {
      day: "2-digit",
      month: fmt === "short" ? "2-digit" : "long",
      year: "numeric",
    }).format(d);
  } catch {
    return iso;
  }
}

function PostTitleWidget({ node, lang }: { node: WidgetNode; lang: Lang }) {
  const ctx = useCtx();
  const c = node.content;
  if (!ctx) return null;
  const tag = asOneOf(c.tag, TITLE_TAGS, "h1");
  const title = pickLocalized(ctx, lang, "title") || pickI18n(c, "fallback", lang);
  if (!title) return null;
  const linkToPost = asBool(c.linkToPost, false);
  const inner =
    linkToPost && ctx.slug ? (
      <AppLink href={`/${ctx.slug}`} className="hover:text-brand transition">
        {title}
      </AppLink>
    ) : (
      title
    );
  return createElement(tag, { className: "cms-post-title" }, inner);
}

function PostMetaWidget({ node, lang }: { node: WidgetNode; lang: Lang }) {
  const ctx = useCtx();
  const c = node.content;
  const wantsViews = asBool(c.showViews, false);
  // Kontekst może już nieść licznik (kanwa buildera / trasa, która go policzyła).
  // Jeśli nie - dociągamy realną wartość tenant-scoped RPC, ale WYŁĄCZNIE gdy
  // redaktor faktycznie włączył licznik. Hooki zawsze przed wczesnym returnem.
  const ctxViews = typeof ctx?.viewCount === "number" ? ctx.viewCount : null;
  const { data: fetchedViews } = useQuery({
    ...postViewCountQueryOptions(ctx?.id ?? ""),
    enabled: wantsViews && ctxViews === null && !!ctx?.id,
  });
  // Prezentacja autora (widoczność nazwiska/zdjęcia + oba rozmiary) rozstrzygana
  // wspólnym rezolwerem - ten sam kontrakt co w post-liście i sliderze.
  const authorDisplay = resolveAuthorDisplay(c, lang, widgetAuthorDisplayDefaults("post-meta", c));
  if (!ctx) return null;
  const sep = strOr(c.separator, " · ");
  const dateFmt = asOneOf(c.dateFormat, DATE_FORMATS, "long");
  const views = ctxViews ?? (typeof fetchedViews === "number" ? fetchedViews : null);
  const parts: ReactElement[] = [];
  if (authorDisplay.visible && ctx.author?.name) {
    const authorHref = ctx.author.slug ? `/author/${ctx.author.slug}` : null;
    parts.push(
      <AuthorByline
        key="a"
        name={ctx.author.name}
        avatarUrl={ctx.author.avatarUrl}
        href={authorHref}
        display={authorDisplay}
      />,
    );
  }
  if (asBool(c.showCategory, true) && ctx.categories?.[0]) {
    const cat = ctx.categories[0];
    parts.push(
      <AppLink
        key="c"
        href={`/category/${cat.slug}`}
        className="hover:text-brand uppercase tracking-wider text-[11px] font-bold"
      >
        {cat.name}
      </AppLink>,
    );
  }
  if (asBool(c.showDate, true) && ctx.publishedAt) {
    parts.push(
      <time key="d" dateTime={ctx.publishedAt}>
        {fmtDate(ctx.publishedAt, lang, dateFmt)}
      </time>,
    );
  }
  if (asBool(c.showReadingTime, true) && ctx.readingTimeMin) {
    parts.push(
      <span key="r" className="inline-flex items-center gap-1">
        <Clock className="w-3.5 h-3.5" />
        {ctx.readingTimeMin} min
      </span>,
    );
  }
  if (wantsViews && views !== null) {
    parts.push(
      <span key="v" className="inline-flex items-center gap-1">
        <Eye className="w-3.5 h-3.5" />
        {new Intl.NumberFormat(lang === "en" ? "en-GB" : "pl-PL").format(views)}
      </span>,
    );
  }
  return (
    <div className="cms-meta flex flex-wrap items-center gap-x-1 gap-y-1">
      {parts.map((p, i) => (
        <span key={i} className="inline-flex items-center">
          {i > 0 && (
            <span aria-hidden className="mx-1 opacity-60">
              {sep}
            </span>
          )}
          {p}
        </span>
      ))}
    </div>
  );
}

/** Klasy pojedynczej pozycji taksonomii dla każdego wariantu z katalogu. */
function termClass(variant: TermVariant): string {
  if (variant === "text") return "text-sm hover:text-brand underline-offset-4 hover:underline";
  if (variant === "outline")
    return "inline-flex items-center px-3 py-1 rounded-full text-xs font-medium border border-border hover:border-brand hover:text-brand transition";
  return "inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-muted hover:bg-brand hover:text-brand-foreground transition";
}

function PillList({
  items,
  base,
  variant,
}: {
  items: Array<{ slug: string; name: string }>;
  base: "tag" | "category";
  variant: TermVariant;
}) {
  if (items.length === 0) return null;
  const cls = termClass(variant);
  return (
    <ul
      className={`flex flex-wrap list-none p-0 m-0 ${variant === "text" ? "gap-x-3 gap-y-1" : "gap-2"}`}
    >
      {items.map((t) => (
        <li key={t.slug}>
          <AppLink href={`/${base}/${t.slug}`} className={cls}>
            {variant === "text" && base === "tag" ? `#${t.name}` : t.name}
          </AppLink>
        </li>
      ))}
    </ul>
  );
}

function PostTagsDynWidget({ node, lang }: { node: WidgetNode; lang: Lang }) {
  const ctx = useCtx();
  const c = node.content;
  const items = ctx?.tags ?? [];
  if (items.length === 0) return null;
  const label = asBool(c.showLabel, true)
    ? pickI18n(c, "label", lang) || (lang === "en" ? "Tags:" : "Tagi:")
    : null;
  return (
    <div className="flex flex-wrap items-center gap-3">
      {label && <span className="cms-meta">{label}</span>}
      <PillList items={items} base="tag" variant={asOneOf(c.variant, TERM_VARIANTS, "pill")} />
    </div>
  );
}

function PostCategoriesDynWidget({ node }: { node: WidgetNode; lang: Lang }) {
  const ctx = useCtx();
  const c = node.content;
  const limit = asNum(c.limit, 0);
  const items = (ctx?.categories ?? []).slice(0, limit > 0 ? limit : undefined);
  if (items.length === 0) return null;
  return (
    <PillList items={items} base="category" variant={asOneOf(c.variant, TERM_VARIANTS, "pill")} />
  );
}

type IconCmp = ComponentType<SVGProps<SVGSVGElement>>;

interface AuthorSocial {
  key: string;
  href: string;
  label: string;
  Icon?: IconCmp;
  iconUrl?: string;
}

/**
 * Linki społecznościowe autora niesione już przez `CurrentPostAuthor`
 * (wypełniane w `$.tsx` z `author_profiles_public`). Wcześniej ustawienie
 * `showSocial` widgetu było martwym kluczem - dane były, renderer ich nie czytał.
 */
function authorSocials(a: CurrentPostAuthor): AuthorSocial[] {
  const out: AuthorSocial[] = [];
  const push = (key: string, url: string | undefined, label: string, Icon: IconCmp) => {
    if (!url) return;
    const href = safeUrl(url, "");
    if (!href) return;
    out.push({ key, href, label, Icon });
  };
  if (a.contactEmail) {
    out.push({ key: "email", href: `mailto:${a.contactEmail}`, label: a.contactEmail, Icon: Mail });
  }
  push("x", a.xUrl ?? a.twitterUrl, "X", Twitter);
  push("linkedin", a.linkedinUrl, "LinkedIn", Linkedin);
  push("facebook", a.facebookUrl, "Facebook", Facebook);
  push("instagram", a.instagramUrl, "Instagram", Instagram);
  push("spotify", a.spotifyUrl, "Spotify", Headphones);
  push("website", a.websiteUrl, "WWW", Globe);
  (a.customSocials ?? []).forEach((s, i) => {
    const href = safeUrl(s.url, "");
    if (!href) return;
    const iconUrl = s.iconUrl ? safeImageUrl(s.iconUrl) : "";
    out.push({
      key: `custom-${i}`,
      href,
      label: s.label || href,
      Icon: iconUrl ? undefined : LinkIcon,
      iconUrl: iconUrl || undefined,
    });
  });
  return out;
}

function AuthorSocialRow({ socials, lang }: { socials: AuthorSocial[]; lang: Lang }) {
  if (socials.length === 0) return null;
  return (
    <ul
      className="flex flex-wrap items-center gap-2 list-none p-0 m-0 mt-2"
      aria-label={lang === "en" ? "Author links" : "Linki autora"}
    >
      {socials.map((s) => (
        <li key={s.key}>
          <a
            href={s.href}
            target={s.href.startsWith("mailto:") ? undefined : "_blank"}
            rel="noopener noreferrer"
            title={s.label}
            aria-label={s.label}
            className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-background border border-border text-muted-foreground hover:text-brand hover:border-brand transition"
          >
            {s.iconUrl ? (
              <img src={s.iconUrl} alt="" className="w-4 h-4 object-contain" />
            ) : s.Icon ? (
              <s.Icon className="w-4 h-4" />
            ) : null}
          </a>
        </li>
      ))}
    </ul>
  );
}

function PostAuthorCardWidget({ node, lang }: { node: WidgetNode; lang: Lang }) {
  const ctx = useCtx();
  const c = node.content;
  const a = ctx?.author;
  // Wspólny kontrakt autora: obie osie widoczności i oba rozmiary. Historyczny
  // przełącznik `showAvatar` tego widgetu wchodzi jako baseline osi zdjęcia
  // (patrz `widgetAuthorDisplayDefaults`), więc starsze dokumenty nie zmieniają
  // wyglądu, a redakcja dostaje jeden komplet ustawień zamiast dwóch.
  const authorDisplay = resolveAuthorDisplay(
    c,
    lang,
    widgetAuthorDisplayDefaults("post-author-card", c),
  );
  if (!a?.name) return null;
  const variant = asOneOf(c.variant, AUTHOR_VARIANTS, "card");
  const bio = lang === "en" ? a.bio_en : a.bio_pl;
  const socials = asBool(c.showSocial, true) ? authorSocials(a) : [];
  const centered = variant === "centered";
  const authorHref = a.slug ? `/author/${a.slug}` : null;

  // Wariant "inline" to zwykły byline - rysuje go ta sama molekuła, co
  // metadane wpisu i listy wpisów (domyślnie 12 px / 20 px).
  if (variant === "inline") {
    return (
      <aside className="flex items-start gap-3">
        <AuthorByline
          name={a.name}
          avatarUrl={a.avatarUrl}
          href={authorHref}
          display={authorDisplay}
        />
        {asBool(c.showBio, true) && bio && <p className="cms-post-excerpt mt-1.5">{bio}</p>}
      </aside>
    );
  }

  const shellClass = centered
    ? "flex flex-col items-center text-center gap-3 py-4"
    : "flex items-start gap-4 p-5 rounded-xl bg-muted/40 border border-border";
  // Karta to portret, nie byline: rozmiar bierzemy z ustawienia autora, ale
  // dopiero od wartości wyraźnie większej niż byline - inaczej domyślne 20 px
  // zamieniłoby kartę eksperta w miniaturkę.
  const cardAvatarPx = Math.max(authorDisplay.avatarSizePx, centered ? 80 : 64);
  // Ta sama zasada dla nazwiska: 12 px bylinu nie ma prawa zmniejszyć tytułu
  // karty, ale świadome podbicie rozmiaru w panelu już tak.
  const cardNamePx = Math.max(authorDisplay.nameSizePx, 18);
  return (
    <aside className={shellClass}>
      {authorDisplay.showAvatar && (
        <div
          className="shrink-0 overflow-hidden rounded-full bg-muted ring-2 ring-background"
          style={{ width: cardAvatarPx, height: cardAvatarPx }}
        >
          {a.avatarUrl ? (
            <img
              // Serwerowy resize do realnego boku (1x/2x/3x) - inaczej
              // przeglądarka skaluje oryginał 1600 px i twarz robi się miękka.
              src={buildAvatarSrc(safeImageUrl(a.avatarUrl), cardAvatarPx)}
              srcSet={buildAvatarSrcSet(safeImageUrl(a.avatarUrl), cardAvatarPx) || undefined}
              alt={a.name}
              width={cardAvatarPx}
              height={cardAvatarPx}
              loading="lazy"
              decoding="async"
              className="w-full h-full object-cover"
            />
          ) : (
            <UserIcon className="w-full h-full p-3 text-muted-foreground" />
          )}
        </div>
      )}
      <div className={centered ? "min-w-0" : "flex-1 min-w-0"}>
        <div className="cms-meta uppercase tracking-wider mb-1">
          {authorLabelText(c, lang) || defaultAuthorLabel(lang)}
        </div>
        {authorDisplay.showName && (
          <div className="cms-post-title" style={{ fontSize: `${cardNamePx}px` }}>
            {authorHref ? (
              <AppLink href={authorHref} className="hover:text-brand">
                {a.name}
              </AppLink>
            ) : (
              a.name
            )}
          </div>
        )}
        {asBool(c.showBio, true) && bio && <p className="cms-post-excerpt mt-1.5">{bio}</p>}
        {socials.length > 0 && (
          <div className={centered ? "flex justify-center" : ""}>
            <AuthorSocialRow socials={socials} lang={lang} />
          </div>
        )}
      </div>
    </aside>
  );
}

function PostBreadcrumbsWidget({ node, lang }: { node: WidgetNode; lang: Lang }) {
  const ctx = useCtx();
  const c = node.content;
  const sep = asOneOf(c.separator, CRUMB_SEPARATORS, "/");
  const items = ctx?.breadcrumbs ?? [];
  if (items.length === 0) return null;
  const list = asBool(c.showHome, true)
    ? [
        {
          label: pickI18n(c, "home", lang) || (lang === "en" ? "Home" : "Start"),
          href: "/",
        },
        ...items.filter((b) => b.href !== "/"),
      ]
    : items;
  return (
    <nav aria-label="Breadcrumb" className="cms-meta">
      <ol className="flex flex-wrap items-center gap-1.5 list-none p-0 m-0">
        {list.map((b, i) => {
          const isLast = i === list.length - 1;
          return (
            <li key={`${i}-${b.label}`} className="inline-flex items-center gap-1.5">
              {i > 0 &&
                (sep === "/" ? (
                  <span aria-hidden className="opacity-60">
                    /
                  </span>
                ) : (
                  <ChevronRight className="w-3.5 h-3.5 opacity-60" />
                ))}
              {b.href && !isLast ? (
                <AppLink href={b.href} className="hover:text-brand transition">
                  {b.label}
                </AppLink>
              ) : (
                <span
                  aria-current={isLast ? "page" : undefined}
                  className={isLast ? "text-foreground" : ""}
                >
                  {b.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function PostCoverWidget({ node, lang }: { node: WidgetNode; lang: Lang }) {
  const ctx = useCtx();
  const c = node.content;
  const src = safeImageUrl(ctx?.coverUrl);
  if (!src) return null;
  const aspect = asOneOf(c.aspect, COVER_ASPECTS, "16/9");
  const rounded = asBool(c.rounded, true);
  // `showCaption` było martwym kluczem: rejestr go zapisywał, renderer nie
  // czytał. Podpis pochodzi z treści widgetu (i18n), więc redaktor realnie
  // steruje tym, co widać pod okładką.
  const caption = asBool(c.showCaption, false) ? pickI18n(c, "caption", lang) : "";
  return (
    <figure className="m-0">
      <div
        className={`relative overflow-hidden ${rounded ? "rounded-xl" : ""} bg-muted`}
        style={{ aspectRatio: aspect.replace("/", " / ") }}
      >
        <img
          src={src}
          alt={ctx ? pickLocalized(ctx, lang, "title") : ""}
          className="absolute inset-0 w-full h-full object-cover"
        />
      </div>
      {caption && <figcaption className="cms-meta mt-2">{caption}</figcaption>}
    </figure>
  );
}

function PostExcerptWidget({ node, lang }: { node: WidgetNode; lang: Lang }) {
  const ctx = useCtx();
  const c = node.content;
  const max = asNum(c.maxChars, 240);
  const raw = ctx ? pickLocalized(ctx, lang, "excerpt") : "";
  if (!raw) return null;
  const text = max > 0 && raw.length > max ? raw.slice(0, max).trimEnd() + "…" : raw;
  return <p className="cms-post-excerpt">{text}</p>;
}

function ArchiveTitleWidget({ node, lang }: { node: WidgetNode; lang: Lang }) {
  const ctx = useCtx();
  const c = node.content;
  // Bez zaszytej próbki "Przykładowe archiwum / 12 wpisów": ta stała pokazywała
  // się także publicznie, bo żaden kod produkcyjny nie tworzył ctx.archive.
  // Realny kontekst dostarcza teraz TaxonomyPage; kanwa buildera bierze próbkę
  // z PLACEHOLDER_POST_CTX (tylko edytor).
  const a = ctx?.archive;
  if (!a?.label) return null;
  const kindLabel: Record<string, { pl: string; en: string }> = {
    author: { pl: "Autor", en: "Author" },
    tag: { pl: "Tag", en: "Tag" },
    category: { pl: "Kategoria", en: "Category" },
    search: { pl: "Wyniki wyszukiwania", en: "Search results" },
  };
  const kind = kindLabel[a.type] ?? kindLabel.category;
  return (
    <header className="space-y-2">
      <div className="text-xs uppercase tracking-wider text-brand font-bold">
        {lang === "en" ? kind.en : kind.pl}
      </div>
      <h1 className="cms-post-title">{a.label}</h1>
      {asBool(c.showDescription, true) && a.description && (
        <p className="text-muted-foreground max-w-2xl">{a.description}</p>
      )}
      {asBool(c.showCount, true) && typeof a.count === "number" && (
        <div className="cms-meta">
          {a.count} {lang === "en" ? "posts" : "wpisów"}
        </div>
      )}
    </header>
  );
}

function SearchFormWidget({ node, lang }: { node: WidgetNode; lang: Lang }) {
  const c = node.content;
  const action = safeUrl(asStr(c.action) || "/search") || "/search";
  const placeholder =
    pickI18n(c, "placeholder", lang) || (lang === "en" ? "Search..." : "Szukaj...");
  const button = pickI18n(c, "button", lang) || (lang === "en" ? "Search" : "Szukaj");
  return (
    <form
      action={action}
      method="get"
      role="search"
      className="flex items-stretch gap-0 w-full max-w-xl"
    >
      <div className="relative flex-1">
        <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
        <input
          type="search"
          name="q"
          placeholder={placeholder}
          aria-label={placeholder}
          className="icon-input w-full h-11 pr-3 rounded-l-md border border-r-0 border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-brand"
        />
      </div>
      <button
        type="submit"
        className="h-11 px-5 rounded-r-md bg-brand text-brand-foreground text-sm font-semibold hover:opacity-90 transition"
      >
        {button}
      </button>
    </form>
  );
}

// Helper for the dispatcher in SimpleWidgets.
export function DynamicTagWidget({ node, lang }: { node: WidgetNode; lang: Lang }) {
  switch (node.type) {
    case "post-title":
      return <PostTitleWidget node={node} lang={lang} />;
    case "post-meta":
      return <PostMetaWidget node={node} lang={lang} />;
    case "post-tags-dyn":
      return <PostTagsDynWidget node={node} lang={lang} />;
    case "post-categories-dyn":
      return <PostCategoriesDynWidget node={node} lang={lang} />;
    case "post-author-card":
      return <PostAuthorCardWidget node={node} lang={lang} />;
    case "post-breadcrumbs":
      return <PostBreadcrumbsWidget node={node} lang={lang} />;
    case "post-cover":
      return <PostCoverWidget node={node} lang={lang} />;
    case "post-excerpt":
      return <PostExcerptWidget node={node} lang={lang} />;
    case "archive-title":
      return <ArchiveTitleWidget node={node} lang={lang} />;
    case "search-form":
      return <SearchFormWidget node={node} lang={lang} />;
    default:
      return null;
  }
}
