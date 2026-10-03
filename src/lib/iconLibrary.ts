// Biblioteka ikon - data layer (CRUD + bulk upload do bucketu 'media').
//
// Upload pliku ikony idzie WSPÓLNĄ ścieżką mediów (`uploadAndRegisterMedia`,
// src/lib/media/upload.ts) - walidacja MIME i rozmiaru przed wysłaniem bajtów,
// rejestracja w tabeli `media` (allowlista serwera, prefiks tenanta, audyt),
// sprzątnięcie obiektu ze storage przy odrzuconej rejestracji. Wcześniej
// `uploadIconAsset` wołał `storage.upload` bezpośrednio: bez walidacji (UI
// zapraszał SVG, który bucket odrzuca nieczytelnym błędem w połowie importu)
// i bez wiersza `media`, więc plik ikony był niewidoczny w bibliotece mediów
// i nie dało się go usunąć po skasowaniu ikony.
//
// Zapis wariantów jest DOMKNIĘTY: wariant wgrany, ale nieprzypięty do wiersza
// ikony (porażka sąsiedniego wariantu albo zapisu `icon_library`), jest
// kasowany przez `discardIconAssets` - inaczej każda nieudana próba zostawiała
// w bibliotece osierocone pliki.
import { supabase } from "@/integrations/supabase/client";
import {
  IMAGE_ACCEPT_ATTR,
  IMAGE_MIME,
  checkUploadable,
  uploadAndRegisterMedia,
  type RegisterMediaFn,
  type UploadRejection,
} from "@/lib/media/upload";

export type IconKind = "custom" | "flag" | "brand";
export type IconVariant = "auto" | "light" | "dark" | "default";

export interface IconRow {
  id: string;
  tenant_id: string;
  kind: IconKind;
  name: string;
  label: string | null;
  url_default: string;
  url_light: string;
  url_dark: string;
  default_variant: IconVariant;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface IconDraft {
  kind: IconKind;
  name: string;
  label?: string | null;
  url_default?: string;
  url_light?: string;
  url_dark?: string;
  default_variant?: IconVariant;
  position?: number;
}

export async function listIcons(kind?: IconKind): Promise<IconRow[]> {
  let q = supabase
    .from("icon_library")
    .select("*")
    .order("position", { ascending: true })
    .order("name", { ascending: true });
  if (kind) q = q.eq("kind", kind);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as IconRow[];
}

export async function upsertIcon(
  tenantId: string,
  draft: IconDraft & { id?: string },
): Promise<IconRow> {
  const payload = {
    tenant_id: tenantId,
    kind: draft.kind,
    name: draft.name.trim(),
    label: draft.label ?? null,
    url_default: draft.url_default ?? "",
    url_light: draft.url_light ?? "",
    url_dark: draft.url_dark ?? "",
    default_variant: draft.default_variant ?? "auto",
    position: draft.position ?? 0,
  };
  if (draft.id) {
    const { data, error } = await supabase
      .from("icon_library")
      .update(payload)
      .eq("id", draft.id)
      .select("*")
      .single();
    if (error) throw error;
    return data as IconRow;
  }
  const { data, error } = await supabase
    .from("icon_library")
    .upsert(payload, { onConflict: "tenant_id,kind,name" })
    .select("*")
    .single();
  if (error) throw error;
  return data as IconRow;
}

export async function deleteIcon(id: string): Promise<void> {
  const { error } = await supabase.from("icon_library").delete().eq("id", id);
  if (error) throw error;
}

const SLUG_RE = /[^a-z0-9_-]+/g;
export function slugifyIconName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(SLUG_RE, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

interface BulkUploadParsed {
  base: string;
  variant: "light" | "dark" | "default";
}

/** Parsuje nazwę pliku: `foo-dark.svg` -> {base:"foo", variant:"dark"}. */
function parseUploadFilename(filename: string): BulkUploadParsed {
  const noExt = filename.replace(/\.[^.]+$/, "");
  const slug = slugifyIconName(noExt);
  if (/-dark$/.test(slug)) return { base: slug.replace(/-dark$/, ""), variant: "dark" };
  if (/-light$/.test(slug)) return { base: slug.replace(/-light$/, ""), variant: "light" };
  return { base: slug, variant: "default" };
}

/**
 * Formaty ikon = rastrowe obrazy z allowlisty mediów. `image/svg+xml` świadomie
 * NIE: bucket `media` jest publiczny i serwuje bajty bezpośrednio, a SVG
 * wykonuje osadzony `<script>` w kontekście domeny (patrz media/upload.ts).
 */
export const ICON_MIME: readonly string[] = IMAGE_MIME;
/** Wartość `accept` dla pól wyboru plików ikon - jawna lista, nie `image/*`. */
export const ICON_ACCEPT_ATTR = IMAGE_ACCEPT_ATTR;

/** Zależności uploadu wstrzykiwane przez komponent (hooki auth + server fn). */
export interface IconUploadContext {
  tenantId: string;
  userId: string;
  /** Server fn `registerMediaUpload`. */
  registerMedia: RegisterMediaFn;
  /** Server fn `bulkDeleteMedia` - sprzątanie wariantów nieprzypiętych do ikony. */
  removeMedia: (args: { data: { mediaIds: string[] } }) => Promise<unknown>;
}

export interface UploadedIconAsset {
  url: string;
  mediaId: string;
}

/** Powód odrzucenia pliku ikony przed wysłaniem albo `null`. */
export function checkIconFile(file: { type: string; size: number }): UploadRejection | null {
  return checkUploadable(file, ICON_MIME);
}

export async function uploadIconAsset(
  ctx: IconUploadContext,
  kind: IconKind,
  file: File,
): Promise<UploadedIconAsset> {
  const uploaded = await uploadAndRegisterMedia({
    file,
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    registerMedia: ctx.registerMedia,
    allowedMime: ICON_MIME,
    subfolder: `icons/${kind}`,
    // Ścieżka obiektu jest unikalna, więc plik pod adresem nigdy się nie zmienia.
    cacheControl: "31536000",
  });
  return { url: uploaded.publicUrl, mediaId: uploaded.mediaId };
}

/**
 * Kasuje wgrane warianty, które nie trafiły do wiersza ikony. Best-effort:
 * błąd sprzątania nie może przykryć pierwotnej przyczyny porażki.
 */
export async function discardIconAssets(
  ctx: IconUploadContext,
  mediaIds: readonly string[],
): Promise<void> {
  if (!mediaIds.length) return;
  await ctx.removeMedia({ data: { mediaIds: [...mediaIds] } }).catch(() => undefined);
}

export interface BulkResult {
  created: number;
  updated: number;
  skipped: number;
  errors: { file: string; message: string }[];
}

interface BulkProgress {
  index: number;
  total: number;
  base: string;
  status: "uploading" | "done" | "skipped" | "error";
  message?: string;
}

export interface BulkOptions {
  /** Set nazw, które już istnieją - takie grupy są pomijane (duplikaty). */
  existingNames?: Set<string>;
  /** Callback po każdej zmianie statusu grupy. */
  onProgress?: (p: BulkProgress) => void;
}

/** Komunikat błędu - także dla obiektów `{ message }` spoza hierarchii `Error`. */
function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "object" && e !== null && "message" in e && typeof e.message === "string") {
    return e.message;
  }
  return "Błąd";
}

function describeRejection(file: File, rejection: UploadRejection): string {
  return rejection.kind === "mime"
    ? `${file.name}: nieobsługiwany format (${rejection.mime || "nieznany"})`
    : `${file.name}: plik za duży`;
}

/** Hurtowy upload - grupuje pliki po base name; `-dark`/`-light` to warianty. */
export async function bulkImportIcons(
  ctx: IconUploadContext,
  kind: IconKind,
  files: File[],
  options: BulkOptions = {},
): Promise<BulkResult> {
  const groups = new Map<string, { default?: File; light?: File; dark?: File }>();
  for (const f of files) {
    const { base, variant } = parseUploadFilename(f.name);
    if (!base) continue;
    const g = groups.get(base) ?? {};
    g[variant] = f;
    groups.set(base, g);
  }
  const total = groups.size;
  const result: BulkResult = { created: 0, updated: 0, skipped: 0, errors: [] };
  let index = 0;
  for (const [base, files] of groups) {
    index += 1;
    if (options.existingNames?.has(base)) {
      result.skipped += 1;
      options.onProgress?.({ index, total, base, status: "skipped", message: "duplikat" });
      continue;
    }
    const variants = (["default", "light", "dark"] as const).flatMap((variant) => {
      const file = files[variant];
      return file ? [{ variant, file }] : [];
    });
    // Walidacja CAŁEJ grupy przed wysłaniem czegokolwiek: odrzucony wariant
    // nie może zostawić za sobą wgranych sąsiadów.
    const rejected = variants.flatMap(({ file }) => {
      const rejection = checkIconFile(file);
      return rejection ? [describeRejection(file, rejection)] : [];
    });
    if (rejected.length) {
      const message = rejected.join("; ");
      result.errors.push({ file: base, message });
      options.onProgress?.({ index, total, base, status: "error", message });
      continue;
    }

    options.onProgress?.({ index, total, base, status: "uploading" });
    const uploaded: string[] = [];
    try {
      const settled = await Promise.allSettled(
        variants.map(({ file }) => uploadIconAsset(ctx, kind, file)),
      );
      const urls: Record<"default" | "light" | "dark", string> = {
        default: "",
        light: "",
        dark: "",
      };
      settled.forEach((outcome, i) => {
        if (outcome.status !== "fulfilled") return;
        uploaded.push(outcome.value.mediaId);
        urls[variants[i].variant] = outcome.value.url;
      });
      const failure = settled.find((o): o is PromiseRejectedResult => o.status === "rejected");
      if (failure) throw failure.reason;

      const payload = {
        tenant_id: ctx.tenantId,
        kind,
        name: base,
        url_default: urls.default,
        url_light: urls.light,
        url_dark: urls.dark,
        default_variant: "auto" as IconVariant,
      };
      const { error } = await supabase
        .from("icon_library")
        .upsert(payload, { onConflict: "tenant_id,kind,name" });
      if (error) throw error;
      result.created += 1;
      options.existingNames?.add(base);
      options.onProgress?.({ index, total, base, status: "done" });
    } catch (e) {
      await discardIconAssets(ctx, uploaded);
      const message = errorMessage(e);
      result.errors.push({ file: base, message });
      options.onProgress?.({ index, total, base, status: "error", message });
    }
  }
  return result;
}

/** Zwraca URL ikony z uwzględnieniem trybu kolorystycznego strony. */
export function resolveIconUrl(row: IconRow, mode: "light" | "dark" = "light"): string {
  if (row.default_variant === "light") return row.url_light || row.url_default;
  if (row.default_variant === "dark") return row.url_dark || row.url_default;
  if (row.default_variant === "default") return row.url_default || row.url_light || row.url_dark;
  // auto: dobieramy do trybu
  if (mode === "dark") return row.url_dark || row.url_default || row.url_light;
  return row.url_light || row.url_default || row.url_dark;
}
