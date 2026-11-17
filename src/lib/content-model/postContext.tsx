// Current post / archive context surfaced to dynamic-tag widgets so they
// render real values on public pages and a clearly-marked sample ONLY inside
// the admin builder canvas.
//
// Ten moduł jedzie w chunku startowym (`BuilderRenderer`, `SimpleWidgets`):
// kod bootu czyta stąd tylko kontekst, provider i `useCurrentPostCtx`. Próbka
// kanwy (`PLACEHOLDER_POST_CTX`, okładka SVG) i `useCurrentPostCtxOrPreview`
// mieszkają w liściu `./postContextPreview` - czytają je wyłącznie widgety
// dynamiczne (chunk leniwy) i panel (roadmapa ładowania §9.10).
import { createContext, useContext, type ReactNode } from "react";

export interface CustomAuthorSocial {
  label: string;
  url: string;
  /** Optional custom icon URL (upload from Media Library). Fallback = lucide Link icon. */
  iconUrl?: string;
}

export interface CurrentPostAuthor {
  id?: string;
  name?: string;
  slug?: string;
  avatarUrl?: string;
  bio_pl?: string;
  bio_en?: string;
  jobTitle?: string;
  company?: string;
  contactEmail?: string;
  phone?: string;
  /** X (dawniej Twitter). Zachowujemy `twitterUrl` dla kompatybilności wstecznej. */
  xUrl?: string;
  twitterUrl?: string;
  linkedinUrl?: string;
  facebookUrl?: string;
  instagramUrl?: string;
  spotifyUrl?: string;
  websiteUrl?: string;
  customSocials?: CustomAuthorSocial[];
}

interface CurrentPostCategory {
  slug: string;
  name: string;
}

interface CurrentPostTag {
  slug: string;
  name: string;
}

export interface CurrentPostCtx {
  kind: "post" | "page" | "archive" | "search" | "preview";
  id?: string;
  slug?: string;
  /**
   * Adres kanoniczny BIEŻĄCEGO wpisu bez prefiksu języka
   * (`/<pełna ścieżka strony-rodzica>/<slug>`). Ustawia go wyłącznie trasa
   * wpisu, z okruszków loadera; brak pola (strona, archiwum, podgląd, wpis bez
   * okruszka rodzica) = widget linkuje swoim dotychczasowym adresem.
   */
  href?: string;
  title_pl?: string;
  title_en?: string;
  excerpt_pl?: string;
  excerpt_en?: string;
  coverUrl?: string;
  publishedAt?: string;
  updatedAt?: string;
  readingTimeMin?: number;
  viewCount?: number;
  author?: CurrentPostAuthor | null;
  categories?: CurrentPostCategory[];
  tags?: CurrentPostTag[];
  breadcrumbs?: Array<{ label: string; href?: string }>;
  archive?: {
    type: "author" | "tag" | "category" | "search";
    label: string;
    description?: string;
    count?: number;
  };
}

const Ctx = createContext<CurrentPostCtx | null>(null);

export function CurrentPostProvider({
  value,
  children,
}: {
  value: CurrentPostCtx | null;
  children: ReactNode;
}) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCurrentPostCtx(): CurrentPostCtx | null {
  return useContext(Ctx);
}
