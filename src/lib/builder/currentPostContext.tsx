// Current post / archive context surfaced to dynamic-tag widgets so they
// render real values on public pages and sensible placeholders elsewhere.
import { createContext, useContext, type ReactNode } from "react";

export interface CurrentPostAuthor {
  id?: string;
  name?: string;
  slug?: string;
  avatarUrl?: string;
  bio_pl?: string;
  bio_en?: string;
}

export interface CurrentPostCategory {
  slug: string;
  name: string;
}

export interface CurrentPostTag {
  slug: string;
  name: string;
}

export interface CurrentPostCtx {
  kind: "post" | "page" | "archive" | "search" | "preview";
  id?: string;
  slug?: string;
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

// Safe placeholder used inside the admin builder canvas so widgets render
// something meaningful without real route data.
export const PLACEHOLDER_POST_CTX: CurrentPostCtx = {
  kind: "preview",
  id: "preview",
  slug: "podglad",
  title_pl: "Tytuł przykładowego wpisu",
  title_en: "Sample post title",
  excerpt_pl: "Krótki opis wpisu pojawi się tutaj.",
  excerpt_en: "A short post excerpt will appear here.",
  publishedAt: new Date().toISOString(),
  readingTimeMin: 5,
  viewCount: 1234,
  author: {
    name: "Jan Kowalski",
    slug: "jan-kowalski",
    bio_pl: "Redaktor naczelny.",
    bio_en: "Editor in chief.",
  },
  categories: [{ slug: "wiadomosci", name: "Wiadomości" }],
  tags: [
    { slug: "lovable", name: "Lovable" },
    { slug: "cms", name: "CMS" },
  ],
  breadcrumbs: [
    { label: "Start", href: "/" },
    { label: "Wiadomości", href: "/category/wiadomosci" },
    { label: "Tytuł przykładowego wpisu" },
  ],
};
