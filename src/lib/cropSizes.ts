// CRUD + helpers dla custom crop sizes (tenant-scoped).
// Używane przez admin route oraz przez OptimizedImage/lightbox do
// generowania URL-i wariantów obrazu (Supabase Storage transforms).
import { supabase } from "@/integrations/supabase/client";
import { PUBLIC_MEDIA_ORIGIN } from "@/lib/media/publicUrl";

export interface CropSize {
  id: string;
  tenant_id: string;
  name: string;
  ratio_w: number;
  ratio_h: number;
  width: number;
  height: number;
  position: number;
}

export type CropSizeDraft = Omit<CropSize, "id" | "tenant_id">;

export async function listCropSizes(tenantId?: string): Promise<CropSize[]> {
  let q = supabase
    .from("custom_crop_sizes")
    .select("id, tenant_id, name, ratio_w, ratio_h, width, height, position")
    .order("position", { ascending: true })
    .order("name", { ascending: true });
  if (tenantId) q = q.eq("tenant_id", tenantId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as CropSize[];
}

export async function upsertCropSize(
  tenantId: string,
  draft: CropSizeDraft & { id?: string },
): Promise<CropSize> {
  const payload = { tenant_id: tenantId, ...draft };
  const { data, error } = await supabase
    .from("custom_crop_sizes")
    .upsert(payload)
    .select()
    .single();
  if (error) throw error;
  return data as CropSize;
}

export async function deleteCropSize(id: string): Promise<void> {
  const { error } = await supabase.from("custom_crop_sizes").delete().eq("id", id);
  if (error) throw error;
}

/**
 * Build a transformed image URL.
 * - Works for Supabase Storage public URLs (https://<host>/storage/v1/object/public/<bucket>/<path>).
 * - Switches to /render/image/public/... with width/height/resize query params.
 * - For non-Supabase URLs (CDN/external), appends `?w=&h=` so userland CDN
 *   can pick it up; harmless query params otherwise.
 */
/**
 * Jakosc rekompresji dla wariantow ze Storage. 75 dawalo widoczne zmiekczenie
 * (rozmyte twarze na awatarach i tekst na okladkach), 88 jest wizualnie
 * bezstratne przy niewielkim wzroscie wagi pliku.
 */
export const IMAGE_QUALITY = 88;

export function buildTransformedImageUrl(
  src: string,
  size: { width: number; height: number; resize?: "cover" | "contain" | "fill" },
): string {
  if (!src) return src;
  const resize = size.resize ?? "cover";
  try {
    const url = src.startsWith("/") ? new URL(src, PUBLIC_MEDIA_ORIGIN) : new URL(src);
    // Markowy adres `/media/<ścieżka>` obsługuje te same warianty rozmiarowe -
    // trasa `/media/$` przepisuje je na transformację obrazu w magazynie.
    if (url.pathname.startsWith("/media/")) {
      url.searchParams.set("width", String(size.width));
      url.searchParams.set("height", String(size.height));
      url.searchParams.set("resize", resize);
      url.searchParams.set("quality", String(IMAGE_QUALITY));
      return src.startsWith("/") ? `${url.pathname}${url.search}` : url.toString();
    }
    if (url.pathname.includes("/storage/v1/object/public/")) {
      url.pathname = url.pathname.replace(
        "/storage/v1/object/public/",
        "/storage/v1/render/image/public/",
      );
      url.searchParams.set("width", String(size.width));
      url.searchParams.set("height", String(size.height));
      url.searchParams.set("resize", resize);
      url.searchParams.set("quality", String(IMAGE_QUALITY));
      return url.toString();
    }
    url.searchParams.set("w", String(size.width));
    url.searchParams.set("h", String(size.height));
    return url.toString();
  } catch {
    return src;
  }
}

/**
 * True for Supabase Storage public/transform URLs (the ones we can scale).
 *
 * MARKER `/media/` LICZY SIĘ WYŁĄCZNIE NA NASZYM ORIGIN. To jest cała stawka
 * tej funkcji, a nie drobiazg: `/media/<ścieżka>` jest adresem MARKOWYM, który
 * umie obsłużyć tylko nasza trasa `/media/$` - przepisuje go na transformację
 * w magazynie. Dowolny obcy serwis też może mieć katalog `/media/`, a wcześniej
 * ta funkcja patrzyła na samą ścieżkę i odpowiadała „tak" również dla niego.
 * Skutkiem był `srcSet` zbudowany z adresów `…/storage/v1/render/image/public/…`
 * doklejonych do CUDZEGO hosta - kandydaci, których ten host nie obsłuży.
 * Przeglądarka wybiera kandydata po szerokości, więc dostawała martwy obrazek
 * przy nienaruszonym `src`, czyli regresję niewidoczną w teście renderującym.
 *
 * Markery `/storage/v1/...` zostają BEZ warunku na host - techniczny host
 * magazynu bywa inny niż markowy (i różny per środowisko), a te ścieżki są
 * jednoznacznie supabase'owe. Ten sam podział robi `mediaStoragePath`
 * w `@/lib/media/publicUrl` i to on jest tu wzorcem, żeby dwa miejsca nie
 * odpowiadały różnie na to samo pytanie.
 */
export function isSupabaseStorageUrl(src: string): boolean {
  if (!src) return false;
  try {
    // Ścieżka względna należy z definicji do tego serwisu - rozwinięcie
    // względem `PUBLIC_MEDIA_ORIGIN` daje jej nasz origin i przechodzi niżej.
    const url = src.startsWith("/") ? new URL(src, PUBLIC_MEDIA_ORIGIN) : new URL(src);
    return (
      (url.origin === PUBLIC_MEDIA_ORIGIN && url.pathname.startsWith("/media/")) ||
      url.pathname.includes("/storage/v1/object/public/") ||
      url.pathname.includes("/storage/v1/render/image/public/")
    );
  } catch {
    return false;
  }
}

/**
 * Width-only scaled variant (preserves aspect ratio, unlike the cropping
 * buildTransformedImageUrl). Used to build responsive srcSets.
 */
export function buildScaledImageUrl(src: string, width: number, quality = IMAGE_QUALITY): string {
  if (!src) return src;
  try {
    const url = src.startsWith("/") ? new URL(src, PUBLIC_MEDIA_ORIGIN) : new URL(src);
    // Markowy adres `/media/<ścieżka>` obsługuje te same warianty rozmiarowe -
    // trasa `/media/$` przepisuje je na transformację obrazu w magazynie.
    if (url.pathname.startsWith("/media/")) {
      url.searchParams.set("width", String(width));
      url.searchParams.set("resize", "contain");
      url.searchParams.set("quality", String(quality));
      return src.startsWith("/") ? `${url.pathname}${url.search}` : url.toString();
    }
    if (url.pathname.includes("/storage/v1/object/public/")) {
      url.pathname = url.pathname.replace(
        "/storage/v1/object/public/",
        "/storage/v1/render/image/public/",
      );
      url.searchParams.set("width", String(width));
      // CRITICAL: without `resize`, Supabase render endpoint does NOT scale
      // proportionally on width-only requests - it returns the original
      // height with a width-cropped slice (e.g. 1920x1169 -> 320x1169),
      // which manifests as extreme "zoom" in widget thumbnails.
      // `contain` keeps aspect ratio and shrinks the longer side to fit.
      url.searchParams.set("resize", "contain");
      url.searchParams.set("quality", String(quality));
      return url.toString();
    }
    url.searchParams.set("w", String(width));
    return url.toString();
  } catch {
    return src;
  }
}

/** Default responsive breakpoints (device-ish widths) for cover/card imagery.
 *  Górny wariant 2400, nie 2560: transformacje Supabase przycinają width do
 *  2500 px, więc kandydat "2560w" kłamał przeglądarce o swojej szerokości
 *  (dostawała 2500 px pod etykietą 2560w) - na ekranach 2560+ wybierany był
 *  wariant realnie mniejszy niż deklarowany. */
export const RESPONSIVE_WIDTHS = [320, 480, 640, 768, 1024, 1280, 1536, 1920, 2400] as const;

/**
 * Build a `srcSet` of width-scaled candidates for a Supabase storage image.
 * Returns "" for non-transformable URLs so callers can omit srcSet entirely
 * (the browser then just uses the original src - no broken candidates).
 */
export function buildImageSrcSet(
  src: string,
  widths: readonly number[] = RESPONSIVE_WIDTHS,
  quality = IMAGE_QUALITY,
): string {
  if (!isSupabaseStorageUrl(src)) return "";
  return widths.map((w) => `${buildScaledImageUrl(src, w, quality)} ${w}w`).join(", ");
}

/**
 * Kwadratowy wariant awatara doklejony do realnego rozmiaru wyswietlania.
 *
 * Bez tego male awatary (20-24 px) laduja oryginal 1600x1600 i to przegladarka
 * skaluje go w dol jednym przebiegiem - efekt jest wyrazny: twarz robi sie
 * miekka i "papkowata". Serwerowy resize do 2x/3x docelowego boku daje ostry
 * obraz i przy okazji kilkadziesiat razy mniejszy transfer.
 */
export function buildAvatarSrc(src: string, sizePx: number, dpr = 2): string {
  if (!src || !isSupabaseStorageUrl(src)) return src;
  const side = Math.max(32, Math.round(sizePx * dpr));
  return buildTransformedImageUrl(src, { width: side, height: side, resize: "cover" });
}

/** `srcSet` 1x/2x/3x dla awatara o zadanym boku CSS. */
export function buildAvatarSrcSet(src: string, sizePx: number): string {
  if (!src || !isSupabaseStorageUrl(src)) return "";
  return [1, 2, 3].map((d) => `${buildAvatarSrc(src, sizePx, d)} ${d}x`).join(", ");
}
