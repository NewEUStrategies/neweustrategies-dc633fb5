// Current post / archive context surfaced to dynamic-tag widgets so they
// render real values on public pages and a clearly-marked sample ONLY inside
// the admin builder canvas.
import { createContext, useContext, type ReactNode } from "react";
import { useBuilderMode } from "./editorCanvas";

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

/**
 * Okładka podglądu: rysowany inline SVG (data URI), więc kanwa nigdy nie
 * strzela po sieci i nie potrafi wyświetlić cudzego zdjęcia. Dzięki temu
 * widget `post-cover` (który bez `coverUrl` zwraca `null`) jest w ogóle
 * widoczny w builderze razem ze swoimi ustawieniami proporcji i zaokrąglenia.
 */
const PREVIEW_COVER_SVG = [
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice">',
  '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">',
  '<stop offset="0" stop-color="#e2e8f0"/><stop offset="1" stop-color="#cbd5e1"/>',
  "</linearGradient></defs>",
  '<rect width="1600" height="900" fill="url(#g)"/>',
  '<circle cx="560" cy="360" r="90" fill="#94a3b8"/>',
  '<path d="M240 760l340-300 220 190 200-160 360 270z" fill="#94a3b8"/>',
  "</svg>",
].join("");

/** Data URI okładki podglądu (tylko builder - nigdy strona publiczna). */
export const PREVIEW_COVER_URL = `data:image/svg+xml;utf8,${encodeURIComponent(PREVIEW_COVER_SVG)}`;

/**
 * Bezpieczna próbka używana WYŁĄCZNIE wewnątrz kanwy buildera, żeby widgety
 * dynamiczne rysowały coś sensownego bez danych trasy.
 *
 * UWAGA BEZPIECZEŃSTWA: ta stała nie może wyciec na powierzchnie publiczne.
 * Dostęp do niej idzie przez `useCurrentPostCtxOrPreview()`, które zwraca
 * próbkę tylko wtedy, gdy komponent naprawdę siedzi w edytorze
 * (`BuilderModeProvider`). Historycznie widgety robiły
 * `useCurrentPostCtx() ?? PLACEHOLDER_POST_CTX`, więc widget wstawiony do
 * nagłówka / stopki / popupu / szuflady mobilnej / archiwum pokazywał realnym
 * odwiedzającym fikcyjnego autora, tytuł i tagi.
 */
export const PLACEHOLDER_POST_CTX: CurrentPostCtx = {
  kind: "preview",
  id: "preview",
  slug: "podglad",
  title_pl: "Tytuł przykładowego wpisu",
  title_en: "Sample post title",
  excerpt_pl: "Krótki opis wpisu pojawi się tutaj.",
  excerpt_en: "A short post excerpt will appear here.",
  coverUrl: PREVIEW_COVER_URL,
  publishedAt: new Date().toISOString(),
  readingTimeMin: 5,
  viewCount: 1234,
  author: {
    name: "Jan Kowalski",
    slug: "jan-kowalski",
    bio_pl: "Redaktor naczelny. Pisze o Europie, gospodarce i społeczeństwie od 15 lat.",
    bio_en: "Editor in chief. Covers Europe, economy and society for the last 15 years.",
    jobTitle: "Redaktor naczelny",
    contactEmail: "jan.kowalski@example.com",
    xUrl: "https://x.com/example",
    twitterUrl: "https://twitter.com/example",
    linkedinUrl: "https://linkedin.com/in/example",
    facebookUrl: "https://facebook.com/example",
    websiteUrl: "https://example.com",
  },
  categories: [{ slug: "wiadomosci", name: "Wiadomości" }],
  tags: [
    { slug: "przyklad", name: "Przykład" },
    { slug: "cms", name: "CMS" },
  ],
  breadcrumbs: [
    { label: "Start", href: "/" },
    { label: "Wiadomości", href: "/category/wiadomosci" },
    { label: "Tytuł przykładowego wpisu" },
  ],
  // Kanwa musi pokazać `archive-title` razem z jego ustawieniami; renderer nie
  // ma już własnej, zaszytej próbki, więc źródłem podglądu jest wyłącznie ten
  // (builder-only) kontekst.
  archive: {
    type: "category",
    label: "Przykładowe archiwum",
    description: "Wszystkie wpisy w tej sekcji.",
    count: 12,
  },
};

/**
 * Kontekst wpisu dla widgetów dynamicznych, z twardym rozróżnieniem edytora od
 * strony publicznej.
 *
 * - jest provider  -> realne dane trasy (wszędzie),
 * - brak providera + kanwa buildera -> `PLACEHOLDER_POST_CTX` (próbka),
 * - brak providera publicznie -> `null`, czyli widget renderuje `null`.
 *
 * `useBuilderMode()` jest niepuste wyłącznie pod `BuilderModeProvider`, który
 * montują tylko kanwa buildera (`Builder.tsx`) i podgląd właściwości widgetu
 * (`WidgetLivePreview.tsx`) - żadna trasa publiczna go nie renderuje.
 */
export function useCurrentPostCtxOrPreview(): CurrentPostCtx | null {
  const ctx = useContext(Ctx);
  const inBuilderCanvas = useBuilderMode() !== null;
  if (ctx) return ctx;
  return inBuilderCanvas ? PLACEHOLDER_POST_CTX : null;
}
