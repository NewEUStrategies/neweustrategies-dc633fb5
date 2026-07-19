// Model dokumentu kreatora treści kampanii newslettera (EmailDoc v1).
//
// Dwie strony czytają ten plik:
//  - edytor kampanii (/admin/newsletter/campaigns/$id) - edycja listy bloków,
//  - renderer e-mail (renderEmailHtml.ts) - render do table-based HTML przy
//    wysyłce i w podglądzie (ten sam kod = podgląd równy wysyłce).
//
// Zasady (inne niż builder stron - e-mail ma twarde ograniczenia klientów
// pocztowych): LINIOWA lista bloków (bez sekcji/kolumn), wyłącznie style
// inline, tabele layoutowe, zero interakcji. Teksty są dwujęzyczne
// ({pl, en} jak NlI18n w newsletter-builder) - struktura wspólna, język
// wybiera się przy renderze.
//
// Parser jest DEFENSYWNY (wzorzec parserów podcast/features): złe bloki
// odpadają zamiast wywracać edytor lub wysyłkę.

export type EmailLang = "pl" | "en";

export interface EmailI18n {
  pl: string;
  en: string;
}

export type EmailBlockType =
  | "heading"
  | "paragraph"
  | "image"
  | "button"
  | "divider"
  | "spacer"
  | "quote"
  | "post-list"
  | "footer-note";

export interface EmailBlockBase {
  id: string;
  type: EmailBlockType;
}

export interface EmailHeadingBlock extends EmailBlockBase {
  type: "heading";
  text: EmailI18n;
  level: 1 | 2;
  align: "left" | "center";
}

export interface EmailParagraphBlock extends EmailBlockBase {
  type: "paragraph";
  /** Ograniczony HTML (b/i/a/br) - sanityzowany centralnym sanitizeHtml przy renderze. */
  html: EmailI18n;
  align: "left" | "center";
}

export interface EmailImageBlock extends EmailBlockBase {
  type: "image";
  url: string | null;
  alt: string;
  href: string | null;
}

export interface EmailButtonBlock extends EmailBlockBase {
  type: "button";
  label: EmailI18n;
  url: string;
  align: "left" | "center";
}

export interface EmailDividerBlock extends EmailBlockBase {
  type: "divider";
}

export interface EmailSpacerBlock extends EmailBlockBase {
  type: "spacer";
  /** px, 4-96 */
  size: number;
}

export interface EmailQuoteBlock extends EmailBlockBase {
  type: "quote";
  text: EmailI18n;
  attribution: EmailI18n;
}

export type EmailPostListMode = "latest" | "manual";
export type EmailPostListLayout = "list" | "cards";

export interface EmailPostListBlock extends EmailBlockBase {
  type: "post-list";
  heading: EmailI18n;
  mode: EmailPostListMode;
  /** 1-10; tylko dla mode=latest. */
  count: number;
  /** Slug kategorii zawężający "najnowsze" (opcjonalny). */
  categorySlug: string | null;
  /** Ręcznie wybrane wpisy (mode=manual) - kolejność zachowana. */
  postIds: string[];
  layout: EmailPostListLayout;
  showExcerpt: boolean;
}

export interface EmailFooterNoteBlock extends EmailBlockBase {
  type: "footer-note";
  html: EmailI18n;
}

export type EmailBlock =
  | EmailHeadingBlock
  | EmailParagraphBlock
  | EmailImageBlock
  | EmailButtonBlock
  | EmailDividerBlock
  | EmailSpacerBlock
  | EmailQuoteBlock
  | EmailPostListBlock
  | EmailFooterNoteBlock;

export interface EmailDocStyle {
  /** Kolor akcentu (przyciski/linki), hex. */
  accent: string;
  /** Kolor tekstu, hex. */
  fg: string;
  /** Kolor tekstu wyciszonego (stopka, excerpty), hex. */
  muted: string;
  /** Tło kontenera, hex. */
  bg: string;
}

export interface EmailDoc {
  version: 1;
  blocks: EmailBlock[];
  style: EmailDocStyle;
}

export const DEFAULT_EMAIL_DOC_STYLE: EmailDocStyle = {
  accent: "#c2410c",
  fg: "#111827",
  muted: "#6b7280",
  bg: "#ffffff",
};

export const EMAIL_BLOCK_TYPES: EmailBlockType[] = [
  "heading",
  "paragraph",
  "image",
  "button",
  "divider",
  "spacer",
  "quote",
  "post-list",
  "footer-note",
];

const newId = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `blk-${Math.random().toString(36).slice(2, 10)}`;

const emptyI18n = (): EmailI18n => ({ pl: "", en: "" });

/** Fabryka bloku danego typu z sensownymi wartościami startowymi. */
export function createEmailBlock(type: EmailBlockType): EmailBlock {
  const id = newId();
  switch (type) {
    case "heading":
      return { id, type, text: emptyI18n(), level: 2, align: "left" };
    case "paragraph":
      return { id, type, html: emptyI18n(), align: "left" };
    case "image":
      return { id, type, url: null, alt: "", href: null };
    case "button":
      return { id, type, label: emptyI18n(), url: "", align: "center" };
    case "divider":
      return { id, type };
    case "spacer":
      return { id, type, size: 24 };
    case "quote":
      return { id, type, text: emptyI18n(), attribution: emptyI18n() };
    case "post-list":
      return {
        id,
        type,
        heading: emptyI18n(),
        mode: "latest",
        count: 3,
        categorySlug: null,
        postIds: [],
        layout: "list",
        showExcerpt: true,
      };
    case "footer-note":
      return { id, type, html: emptyI18n() };
  }
}

/** Dokument startowy nowej kampanii - szkielet typowego wydania. */
export function createDefaultEmailDoc(): EmailDoc {
  const heading = createEmailBlock("heading") as EmailHeadingBlock;
  heading.text = { pl: "Tytuł wydania", en: "Issue title" };
  const paragraph = createEmailBlock("paragraph") as EmailParagraphBlock;
  paragraph.html = {
    pl: "Krótki wstęp do tego wydania newslettera.",
    en: "A short intro for this issue.",
  };
  const posts = createEmailBlock("post-list") as EmailPostListBlock;
  posts.heading = { pl: "Najnowsze analizy", en: "Latest analyses" };
  return {
    version: 1,
    blocks: [heading, paragraph, posts],
    style: { ...DEFAULT_EMAIL_DOC_STYLE },
  };
}

// ---------------------------------------------------------------------------
// Parser defensywny
// ---------------------------------------------------------------------------

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);

const strOrNull = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v : null;

const bool = (v: unknown, fallback: boolean): boolean => (typeof v === "boolean" ? v : fallback);

const intIn = (v: unknown, min: number, max: number, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v)
    ? Math.min(Math.max(Math.round(v), min), max)
    : fallback;

const i18n = (v: unknown): EmailI18n => {
  if (!isRecord(v)) return emptyI18n();
  return { pl: str(v.pl), en: str(v.en) };
};

const align = (v: unknown, fallback: "left" | "center"): "left" | "center" =>
  v === "left" || v === "center" ? v : fallback;

const HEX_RE = /^#[0-9a-fA-F]{3,8}$/;
const hex = (v: unknown, fallback: string): string =>
  typeof v === "string" && HEX_RE.test(v.trim()) ? v.trim() : fallback;

function parseBlock(raw: unknown): EmailBlock | null {
  if (!isRecord(raw) || typeof raw.type !== "string") return null;
  const id = str(raw.id) || newId();
  switch (raw.type) {
    case "heading":
      return {
        id,
        type: "heading",
        text: i18n(raw.text),
        level: raw.level === 1 ? 1 : 2,
        align: align(raw.align, "left"),
      };
    case "paragraph":
      return { id, type: "paragraph", html: i18n(raw.html), align: align(raw.align, "left") };
    case "image":
      return {
        id,
        type: "image",
        url: strOrNull(raw.url),
        alt: str(raw.alt),
        href: strOrNull(raw.href),
      };
    case "button":
      return {
        id,
        type: "button",
        label: i18n(raw.label),
        url: str(raw.url),
        align: align(raw.align, "center"),
      };
    case "divider":
      return { id, type: "divider" };
    case "spacer":
      return { id, type: "spacer", size: intIn(raw.size, 4, 96, 24) };
    case "quote":
      return { id, type: "quote", text: i18n(raw.text), attribution: i18n(raw.attribution) };
    case "post-list":
      return {
        id,
        type: "post-list",
        heading: i18n(raw.heading),
        mode: raw.mode === "manual" ? "manual" : "latest",
        count: intIn(raw.count, 1, 10, 3),
        categorySlug: strOrNull(raw.categorySlug),
        postIds: Array.isArray(raw.postIds)
          ? raw.postIds.filter((x): x is string => typeof x === "string").slice(0, 10)
          : [],
        layout: raw.layout === "cards" ? "cards" : "list",
        showExcerpt: bool(raw.showExcerpt, true),
      };
    case "footer-note":
      return { id, type: "footer-note", html: i18n(raw.html) };
    default:
      return null;
  }
}

/**
 * Parsuje jsonb z bazy do EmailDoc. Zwraca null dla wartości pustych /
 * kompletnie niepoprawnych; pojedyncze złe bloki są pomijane.
 */
export function parseEmailDoc(value: unknown): EmailDoc | null {
  if (!isRecord(value)) return null;
  if (value.version !== 1 || !Array.isArray(value.blocks)) return null;
  const blocks: EmailBlock[] = [];
  for (const raw of value.blocks.slice(0, 100)) {
    const block = parseBlock(raw);
    if (block) blocks.push(block);
  }
  const styleRaw = isRecord(value.style) ? value.style : {};
  const d = DEFAULT_EMAIL_DOC_STYLE;
  return {
    version: 1,
    blocks,
    style: {
      accent: hex(styleRaw.accent, d.accent),
      fg: hex(styleRaw.fg, d.fg),
      muted: hex(styleRaw.muted, d.muted),
      bg: hex(styleRaw.bg, d.bg),
    },
  };
}

/** Czy dokument ma jakąkolwiek renderowalną treść (guard przed pustą wysyłką). */
export function emailDocHasContent(doc: EmailDoc | null): boolean {
  return Boolean(doc && doc.blocks.length > 0);
}
