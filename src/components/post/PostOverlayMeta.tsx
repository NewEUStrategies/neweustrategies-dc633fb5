// Meta bar renderowany w overlayu / nagłówku wpisu:
// autor · data publikacji · czas czytania (widget) · pola custom_meta.
// Bilingual PL/EN; atomic-design "molecule".
import type { ReactNode } from "react";
import { AppLink } from "@/components/atoms/AppLink";
import { ReadingTimeView } from "@/components/blocks/PostUtilityViews";
import { Clock, User as UserIcon } from "@/lib/lucide-shim";

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
}

function fmtDate(iso: string, lang: Lang): string {
  try {
    return new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "pl-PL", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(new Date(iso));
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

export function PostOverlayMeta({ lang, author, publishedAt, readMinutes, customMeta }: Props) {
  const t = L[lang];
  const name = author ? authorName(author, lang) : null;
  const authorHref = author?.slug ? `/${lang === "en" ? "en/" : ""}author/${author.slug}` : null;

  return (
    <span className="inline-flex flex-wrap items-center gap-x-4 gap-y-1">
      {author && name && (
        <span className="inline-flex items-center gap-1.5">
          <UserIcon
            className="w-3.5 h-3.5 text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]"
            aria-hidden
          />
          <span className="opacity-80">{t.by}</span>
          {authorHref ? (
            <AppLink href={authorHref} className="font-medium">
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
            className="w-3.5 h-3.5 text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]"
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
        <span className="inline-flex items-center gap-1.5">
          <Clock
            className="w-3.5 h-3.5 text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]"
            aria-hidden
          />
          <span>{t.read(readMinutes)}</span>
        </span>
      ) : (
        // Fallback do widgetu wyliczającego czas z excerptu (spójny z builderem).
        <ReadingTimeView lang={lang} cls="!text-inherit" />
      )}
      {customMeta}
    </span>
  );
}
