// Meta bar renderowany w overlayu / nagłówku wpisu:
// autor · data publikacji · czas czytania (widget) · pola custom_meta.
// Bilingual PL/EN; atomic-design "molecule".
import type { ReactNode } from "react";
import { AppLink } from "@/components/atoms/AppLink";
import { ReadingTimeView } from "@/components/blocks/PostUtilityViews";
import { Clock, User as UserIcon } from "@/lib/lucide-shim";
import { formatDate } from "@/lib/i18n/format";

type Lang = "pl" | "en";

const L = {
  pl: {
    by: "Autor",
    published: "Opublikowano",
    read: (m: number) => `${m} min czytania`,
  },
  en: {
    by: "By",
    published: "Published",
    read: (m: number) => `${m} min read`,
  },
} as const;

interface AuthorLite {
  id: string;
  slug: string | null;
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
}

interface Props {
  lang: Lang;
  author: AuthorLite | null;
  publishedAt: string | null;
  readMinutes: number | null;
  customMeta?: ReactNode;
  /** Akcje renderowane pod autorem i datą - tylko mobile (np. "Udostępnij pełny artykuł"). */
  mobileActions?: ReactNode;
  /**
   * Ukryj czas czytania na mobile - pasek Quick View pod okładką pokazuje tę
   * samą wartość, więc w nakładce byłaby zdublowana na wąskim ekranie.
   */
  hideReadTimeOnMobile?: boolean;
}

function fmtDate(iso: string, lang: Lang): string {
  try {
    return formatDate(iso, lang, { day: "2-digit", month: "2-digit", year: "numeric" });
  } catch {
    return iso;
  }
}

function authorName(a: AuthorLite, lang: Lang): string {
  return (
    a.display_name ||
    [a.first_name, a.last_name].filter(Boolean).join(" ") ||
    (lang === "en" ? "Author" : "Autor")
  );
}

export function PostOverlayMeta({
  lang,
  author,
  publishedAt,
  readMinutes,
  customMeta,
  mobileActions,
  hideReadTimeOnMobile = false,
}: Props) {
  const t = L[lang];
  const name = author ? authorName(author, lang) : null;
  const authorHref = author?.slug ? `/${lang === "en" ? "en/" : ""}author/${author.slug}` : null;

  const iconCls = "w-4 h-4 text-current";

  return (
    <span className="inline-flex flex-col">
      <span className="inline-flex flex-wrap items-center gap-x-4 gap-y-1">
        {author && name && (
          <span className="inline-flex items-center gap-2">
            {author.avatar_url ? (
              authorHref ? (
                <AppLink
                  href={authorHref}
                  className="inline-flex items-center shrink-0"
                  aria-label={name}
                >
                  <img
                    src={author.avatar_url}
                    alt={name}
                    loading="lazy"
                    className="w-7 h-7 rounded-[6px] object-cover ring-2 ring-white/70 shadow-[0_1px_4px_rgba(0,0,0,0.5)]"
                  />
                </AppLink>
              ) : (
                <img
                  src={author.avatar_url}
                  alt={name}
                  loading="lazy"
                  className="w-7 h-7 rounded-[6px] object-cover ring-2 ring-white/70 shadow-[0_1px_4px_rgba(0,0,0,0.5)]"
                />
              )
            ) : (
              <UserIcon className={iconCls} aria-hidden />
            )}
            <span className="opacity-80">{t.by}</span>
            {authorHref ? (
              <AppLink href={authorHref} className="font-medium hover:underline">
                {name}
              </AppLink>
            ) : (
              <span className="font-medium">{name}</span>
            )}
          </span>
        )}
        {publishedAt && (
          <span className="inline-flex items-center gap-1.5">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={iconCls}
              aria-hidden
            >
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <path d="M16 2v4M8 2v4M3 10h18" />
            </svg>
            <span className="opacity-80">{t.published}:</span>
            <time dateTime={publishedAt}>{fmtDate(publishedAt, lang)}</time>
          </span>
        )}
        {readMinutes && readMinutes > 0 ? (
          <span
            className={`items-center gap-1.5 ${hideReadTimeOnMobile ? "hidden sm:inline-flex" : "inline-flex"}`}
          >
            <Clock className={iconCls} aria-hidden />
            <span>{t.read(readMinutes)}</span>
          </span>
        ) : hideReadTimeOnMobile ? (
          <span className="hidden sm:inline-flex">
            <ReadingTimeView lang={lang} cls="!text-inherit" />
          </span>
        ) : (
          <ReadingTimeView lang={lang} cls="!text-inherit" />
        )}
        {customMeta}
      </span>
      {mobileActions ? (
        <span className="no-print mt-2 flex w-full sm:hidden">{mobileActions}</span>
      ) : null}
    </span>
  );
}
