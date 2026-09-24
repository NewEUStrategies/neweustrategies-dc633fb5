// Encje inline (firma / osoba) osadzane w treści akapitu - model danych.
//
// ZASADA: dane encji są KOPIĄ należącą do materiału. Firma zaciągnięta z CRM
// albo osoba zaciągnięta z profilu autora trafia do rejestru dokumentu
// (`doc.meta.inlineEntities`), a każda późniejsza edycja w artykule zmienia
// TYLKO tę kopię - nigdy kartoteki CRM ani profilu autora. Źródło (`source`)
// zostaje zapamiętane wyłącznie po to, żeby redakcja mogła świadomie
// „odświeżyć z CRM / z profilu".
//
// Treść akapitu niesie jedynie odwołanie `<span data-nes-entity="id">`, więc
// wklejenie encji w drugie miejsce materiału daje DWA odwołania do JEDNEGO
// rekordu: zmiana w jednym miejscu jest z konstrukcji widoczna w obu, a oba
// publikują się razem z dokumentem.
//
// Moduł jest czysty (zero Reacta, zero Supabase) - czyta go i SSR, i kanwa
// edytora, i testy jednostkowe.

import { toJson, type Json } from "@/lib/content-model/json";
import { safeImageUrl } from "@/lib/sanitizePure";

export type InlineEntityKind = "company" | "person";
export type InlineEntityLang = "pl" | "en";

/** Sieci społecznościowe obsługiwane przez kartę (kolejność = kolejność ikon). */
export const SOCIAL_NETWORKS = ["linkedin", "x", "facebook", "instagram", "youtube"] as const;
export type SocialNetwork = (typeof SOCIAL_NETWORKS)[number];
export type SocialLinks = Partial<Record<SocialNetwork, string>>;

export interface LocalizedText {
  pl: string;
  en: string;
}

/** Kraj jako kod ISO 3166-1 alfa-2 plus nazwy - renderer nie ładuje słownika krajów. */
export interface InlineEntityCountry {
  code: string;
  pl: string;
  en: string;
}

/**
 * Obraz encji (logo firmy / zdjęcie osoby). `src` to gotowy, przycięty kwadrat
 * (wyświetlany z zaokrągleniem 6 px). `original` + `area` pozwalają ponownie
 * otworzyć kadrowanie bez utraty jakości - `area` to obszar kadru w procentach
 * oryginału (kształt `croppedArea` z react-easy-crop), `zoom` - powiększenie.
 */
export interface InlineEntityImage {
  src: string;
  original?: string;
  area?: { x: number; y: number; width: number; height: number };
  zoom?: number;
}

export type InlineEntitySource =
  | { type: "manual" }
  | { type: "crm"; id: string; syncedAt: string }
  | { type: "author"; id: string; slug: string | null; syncedAt: string };

interface InlineEntityBase {
  id: string;
  image: InlineEntityImage | null;
  /** Firma: strona www. Osoba: strona zewnętrzna (np. własna witryna, bio). */
  website: string;
  socials: SocialLinks;
  source: InlineEntitySource;
  updatedAt: string;
}

export interface InlineCompanyEntity extends InlineEntityBase {
  kind: "company";
  name: string;
  country: InlineEntityCountry | null;
  industry: LocalizedText;
  specialization: LocalizedText;
}

export interface InlinePersonEntity extends InlineEntityBase {
  kind: "person";
  firstName: string;
  lastName: string;
  position: LocalizedText;
  company: string;
}

export type InlineEntity = InlineCompanyEntity | InlinePersonEntity;
export type InlineEntityRegistry = Readonly<Record<string, InlineEntity>>;

// ---------------------------------------------------------------------------
// Limity - rejestr jest częścią jsonb wpisu, więc pilnujemy jego rozmiaru.
// ---------------------------------------------------------------------------

export const INLINE_ENTITY_LIMITS = {
  /** Maksymalna liczba encji w jednym dokumencie. */
  perDocument: 200,
  name: 160,
  text: 200,
  url: 1000,
  code: 2,
} as const;

const ID_RE = /^[a-z0-9_-]{4,64}$/i;
const COUNTRY_CODE_RE = /^[A-Z]{2}$/;
const HTTP_URL_RE = /^https?:\/\//i;

/** Nowy identyfikator encji (stabilny w obrębie dokumentu, bezpieczny w atrybucie). */
export function newInlineEntityId(): string {
  const random =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 12)
      : Math.random().toString(36).slice(2, 14);
  return `ie_${random}`;
}

export function isInlineEntityId(value: unknown): value is string {
  return typeof value === "string" && ID_RE.test(value);
}

// ---------------------------------------------------------------------------
// Normalizacja (granica zaufania: rejestr przychodzi z jsonb albo ze schowka)
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, max: number = INLINE_ENTITY_LIMITS.text): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function localized(value: unknown): LocalizedText {
  if (typeof value === "string") {
    const v = text(value);
    return { pl: v, en: v };
  }
  if (!isRecord(value)) return { pl: "", en: "" };
  return { pl: text(value.pl), en: text(value.en) };
}

/**
 * Adres http(s). Użytkownik często wpisuje „example.com" - dopisujemy schemat,
 * a wszystko, co po normalizacji nie jest http(s), odrzucamy (javascript:,
 * data:, mailto: nie mają sensu jako strona firmy).
 */
export function normalizeExternalUrl(value: unknown): string {
  const raw = text(value, INLINE_ENTITY_LIMITS.url);
  if (!raw) return "";
  const candidate = HTTP_URL_RE.test(raw) ? raw : `https://${raw.replace(/^\/+/, "")}`;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    if (!url.hostname.includes(".")) return "";
    return url.toString();
  } catch {
    return "";
  }
}

function normalizeImage(value: unknown): InlineEntityImage | null {
  if (!isRecord(value)) return null;
  const src = safeImageUrl(text(value.src, INLINE_ENTITY_LIMITS.url));
  // `data:` jest dozwolone przez sanitizer obrazów, ale w rejestrze oznaczałoby
  // megabajty base64 w jsonb wpisu - obraz ma być zawsze wgrany do biblioteki.
  if (!src || src.startsWith("data:")) return null;
  const out: InlineEntityImage = { src };
  const original = safeImageUrl(text(value.original, INLINE_ENTITY_LIMITS.url));
  if (original && !original.startsWith("data:")) out.original = original;
  const area = value.area;
  if (isRecord(area)) {
    const nums = [area.x, area.y, area.width, area.height].map((n) =>
      typeof n === "number" && Number.isFinite(n) ? Math.min(Math.max(n, 0), 100) : NaN,
    );
    if (nums.every((n) => !Number.isNaN(n)) && nums[2] > 0 && nums[3] > 0) {
      out.area = { x: nums[0], y: nums[1], width: nums[2], height: nums[3] };
    }
  }
  if (typeof value.zoom === "number" && Number.isFinite(value.zoom)) {
    out.zoom = Math.min(Math.max(value.zoom, 1), 6);
  }
  return out;
}

function normalizeSocials(value: unknown): SocialLinks {
  const out: SocialLinks = {};
  if (!isRecord(value)) return out;
  for (const network of SOCIAL_NETWORKS) {
    const url = normalizeExternalUrl(value[network]);
    if (url) out[network] = url;
  }
  return out;
}

function normalizeCountry(value: unknown): InlineEntityCountry | null {
  if (!isRecord(value)) return null;
  const code = text(value.code, 8).toUpperCase();
  const pl = text(value.pl);
  const en = text(value.en);
  if (!pl && !en) return null;
  return { code: COUNTRY_CODE_RE.test(code) ? code : "", pl: pl || en, en: en || pl };
}

function normalizeSource(value: unknown): InlineEntitySource {
  if (!isRecord(value)) return { type: "manual" };
  const id = text(value.id, 64);
  const syncedAt = text(value.syncedAt, 40);
  if (value.type === "crm" && id) return { type: "crm", id, syncedAt };
  if (value.type === "author" && id) {
    const slug = text(value.slug, 200);
    return { type: "author", id, slug: slug || null, syncedAt };
  }
  return { type: "manual" };
}

/** Waliduje i przycina pojedynczą encję. `null` = rekord nie do uratowania. */
export function normalizeInlineEntity(value: unknown): InlineEntity | null {
  if (!isRecord(value) || !isInlineEntityId(value.id)) return null;
  const base = {
    id: value.id,
    image: normalizeImage(value.image),
    website: normalizeExternalUrl(value.website),
    socials: normalizeSocials(value.socials),
    source: normalizeSource(value.source),
    updatedAt: text(value.updatedAt, 40),
  };
  if (value.kind === "company") {
    const name = text(value.name, INLINE_ENTITY_LIMITS.name);
    if (!name) return null;
    return {
      ...base,
      kind: "company",
      name,
      country: normalizeCountry(value.country),
      industry: localized(value.industry),
      specialization: localized(value.specialization),
    };
  }
  if (value.kind === "person") {
    const firstName = text(value.firstName, INLINE_ENTITY_LIMITS.name);
    const lastName = text(value.lastName, INLINE_ENTITY_LIMITS.name);
    if (!firstName && !lastName) return null;
    return {
      ...base,
      kind: "person",
      firstName,
      lastName,
      position: localized(value.position),
      company: text(value.company, INLINE_ENTITY_LIMITS.name),
    };
  }
  return null;
}

/** Normalizuje cały rejestr; klucze zawsze równe `entity.id`. */
export function normalizeInlineEntityRegistry(value: unknown): Record<string, InlineEntity> {
  const out: Record<string, InlineEntity> = {};
  if (!isRecord(value)) return out;
  let count = 0;
  for (const raw of Object.values(value)) {
    if (count >= INLINE_ENTITY_LIMITS.perDocument) break;
    const entity = normalizeInlineEntity(raw);
    if (!entity) continue;
    out[entity.id] = entity;
    count += 1;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Prezentacja (wspólna dla SSR, karty i kanwy edytora)
// ---------------------------------------------------------------------------

/** Nazwa wyświetlana w tekście i w nagłówku karty. */
export function inlineEntityDisplayName(entity: InlineEntity): string {
  if (entity.kind === "company") return entity.name;
  return [entity.firstName, entity.lastName].filter(Boolean).join(" ");
}

/** Wartość w języku materiału, z awaryjnym powrotem do drugiego języka. */
const OTHER_LANG: Readonly<Record<InlineEntityLang, InlineEntityLang>> = { pl: "en", en: "pl" };

export function pickLocalized(value: LocalizedText, lang: InlineEntityLang): string {
  return value[lang] || value[OTHER_LANG[lang]] || "";
}

/** Inicjały do zastępczego awatara (gdy encja nie ma obrazu). */
export function inlineEntityInitials(entity: InlineEntity): string {
  const name = inlineEntityDisplayName(entity);
  const parts = name.split(/\s+/).filter(Boolean);
  const letters =
    entity.kind === "person" || parts.length > 1
      ? parts.slice(0, 2).map((p) => p[0] ?? "")
      : [parts[0]?.slice(0, 2) ?? ""];
  return letters.join("").toUpperCase() || "?";
}

/** Flaga z kodu ISO (znaki regionalne Unicode) - zero zasobów graficznych. */
export function countryFlagEmoji(code: string): string {
  if (!COUNTRY_CODE_RE.test(code)) return "";
  const base = 0x1f1e6;
  return String.fromCodePoint(base + code.charCodeAt(0) - 65, base + code.charCodeAt(1) - 65);
}

/** Host bez `www.` - czytelna etykieta linku do strony. */
export function urlHostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return url;
  }
}

/** Kopia encji jako `Json` (zapis do `doc.meta`). */
export function inlineEntityToJson(entity: InlineEntity): Json {
  return toJson(entity);
}

/**
 * Pusty szkic encji danego rodzaju (okno „Wstaw firmę / osobę"). Nazwa z
 * zaznaczonego tekstu trafia do nazwy firmy albo jest dzielona na imię
 * i nazwisko (ostatni wyraz = nazwisko).
 */
export function createBlankInlineEntity(
  kind: InlineEntityKind,
  options: { id?: string; name?: string; now?: string } = {},
): InlineEntity {
  const id = options.id ?? newInlineEntityId();
  const now = options.now ?? "";
  const name = text(options.name, INLINE_ENTITY_LIMITS.name);
  const base = {
    id,
    image: null,
    website: "",
    socials: {},
    source: { type: "manual" } as const,
    updatedAt: now,
  };
  if (kind === "company") {
    return {
      ...base,
      kind: "company",
      name,
      country: null,
      industry: { pl: "", en: "" },
      specialization: { pl: "", en: "" },
    };
  }
  const parts = name.split(" ").filter(Boolean);
  return {
    ...base,
    kind: "person",
    firstName: parts.length > 1 ? parts.slice(0, -1).join(" ") : (parts[0] ?? ""),
    lastName: parts.length > 1 ? (parts[parts.length - 1] ?? "") : "",
    position: { pl: "", en: "" },
    company: "",
  };
}
