// CRUD + helpers dla custom crop sizes (tenant-scoped).
// Używane przez admin route oraz przez OptimizedImage/lightbox do
// generowania URL-i wariantów obrazu (Supabase Storage transforms).
import { supabase } from "@/integrations/supabase/client";
import { PUBLIC_MEDIA_ORIGIN, isBrandedMediaOrigin } from "@/lib/media/publicUrl";

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

/**
 * Jakosc malych wariantow `srcSet` (<= 640 px). Przy tej szerokosci pikseli jest
 * tak gesto, ze artefakty q76 sa niewidoczne, a plik chudnie o kilkanascie
 * procent - to dokladnie te kandydaty, ktore telefon pobiera jako obraz LCP.
 * Duże zdjęcia responsywne używają q80; kadry i awatary zachowują q88.
 */
export const IMAGE_QUALITY_SMALL = 76;

/** Responsive editorial photos: explicit crop/avatar quality stays at 88. */
export const RESPONSIVE_IMAGE_QUALITY = 80;

/** Gorna granica (wlacznie) szerokosci uznawanej za "maly wariant". */
export const SMALL_VARIANT_MAX_WIDTH = 640;

/**
 * Jakosc zalezna od szerokosci wariantu - JEDNO zrodlo prawdy dla `srcSet`.
 * Preload (`<link rel=preload imagesrcset>` / naglowek `Link`) i renderowany
 * `<img>` buduja URL-e tymi samymi funkcjami, wiec regula trzymana w jednym
 * miejscu utrzymuje parytet bajtowy obu list. Zdublowanie jej gdziekolwiek
 * indziej oznaczaloby preload innego kandydata niz malowany - podwojny transfer.
 */
export function qualityForWidth(width: number): number {
  return width <= SMALL_VARIANT_MAX_WIDTH ? IMAGE_QUALITY_SMALL : RESPONSIVE_IMAGE_QUALITY;
}

export function buildTransformedImageUrl(
  src: string,
  size: { width: number; height: number; resize?: "cover" | "contain" | "fill" },
): string {
  if (!src || /\.svg(?:[?#]|$)/i.test(src)) return src;
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
 * MARKER `/media/` LICZY SIĘ WYŁĄCZNIE NA NASZYCH ORIGINACH (kanoniczny,
 * domyślny i lista z konfiguracji - `isBrandedMediaOrigin`). To jest cała stawka
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
      (isBrandedMediaOrigin(url.origin) && url.pathname.startsWith("/media/")) ||
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
export function buildScaledImageUrl(
  src: string,
  width: number,
  quality = qualityForWidth(width),
): string {
  if (!src || /\.svg(?:[?#]|$)/i.test(src)) return src;
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

/** Domyślna drabina `srcSet` okładek i kart (P3.2a, HW-4, decyzja właściciela
 *  2026-10-08): 5 szerokości zamiast 9. Każdy kandydat to ok. 120 B w HTML-u
 *  (`<img>`, preload w `<head>`, nagłówek `Link`), a pośrednie warianty 320/1024/
 *  1536 dawały głównie podwójne pobrania tej samej okładki (karta 320w + karta
 *  480w na desktopie). 640 ZOSTAJE: na nim stoi wybór hero na telefonie PSI
 *  (412 px x DPR 1,75 przy `sizes` z marginesem kolumny, `imageSlot.ts`). Telefony
 *  DPR 3 dostają 768w (gęstość ok. 2,3x), retina full-bleed 1920w. Górny wariant
 *  ≤ 2500: transformacje Supabase przycinają width do 2500 px, więc większy
 *  deskryptor kłamałby przeglądarce o szerokości kandydata. */
export const RESPONSIVE_WIDTHS = [480, 640, 768, 1280, 1920] as const;

/**
 * Dawna drabina 9 szerokości - WYŁĄCZNIE dla zdjęć osób renderowanych przez
 * `OptimizedImage responsive` (awatar autora w bloku kontekstu wpisu, zdjęcia
 * prelegentów). Decyzja właściciela 2026-10-08: awatary bez zmian - ani
 * szerokości, ani adresu. Własna drabina (inna referencja niż `RESPONSIVE_WIDTHS`)
 * zostawia też adresy absolutne, więc `srcset` i `src` są bajt w bajt dawne.
 */
export const LEGACY_AVATAR_RESPONSIVE_WIDTHS = [
  320, 480, 640, 768, 1024, 1280, 1536, 1920, 2400,
] as const;

/**
 * Adres pliku `/media/...` KANONICZNEGO originu jako ścieżka względna (P3.2a/P4.2).
 *
 * WYŁĄCZNIE dla `src`/`srcset` renderowanego do HTML-u, preloadu obrazu w `<head>`
 * i nagłówka `Link` - nigdy dla og:image, JSON-LD, RSS, sitemap, e-maili,
 * stemplowania `public_url` ani stanu odwodnionego (te muszą być absolutne).
 * Trasa `/media/$` nie zależy od hosta, więc ścieżka działa na każdym hoście
 * aplikacji (domeny najemców, podgląd, localhost), a na domenie kanonicznej to
 * dokładnie ten sam zasób - mniej bajtów, ten sam plik i ten sam klucz cache.
 * Inny origin (także dodatkowe originy najemców i host techniczny magazynu),
 * adres względny, `data:` i śmieci wracają bez zmian. Deterministyczna (stała
 * z builda), więc SSR i hydratacja dają ten sam atrybut.
 */
export function renderedMediaUrl(url: string): string {
  if (!url.startsWith(`${PUBLIC_MEDIA_ORIGIN}/media/`)) return url;
  try {
    // Parser odrzuca segmenty `..`, `\` i inne sztuczki, po których ścieżka
    // przestaje być `/media/...` - wtedy adres zostaje absolutny.
    const { pathname, search, hash } = new URL(url);
    return pathname.startsWith("/media/") ? pathname + search + hash : url;
  } catch {
    return url;
  }
}

/**
 * Build a `srcSet` of width-scaled candidates for a Supabase storage image.
 * Returns "" for non-transformable URLs so callers can omit srcSet entirely
 * (the browser then just uses the original src - no broken candidates).
 *
 * DOMYŚLNA DRABINA = ADRESY WZGLĘDNE (P3.2a/P4.2). Reguła stoi na drabinie
 * domyślnej (porównanie referencji z `RESPONSIVE_WIDTHS`), bo wszyscy jej
 * konsumenci to renderowany `<img>`, preload w `<head>` albo nagłówek `Link`
 * (okładki, slider, preload kandydata LCP, trasy wpisu, archiwów, klubów,
 * programów, web stories, popup). Preload i `<img>` każdej trasy przesuwają się
 * więc razem, bez edycji tras - klucz zasobu (`srcSet\nsizes`) zostaje wspólny.
 * Własne drabiny (miniatury, treść wpisu, mega menu, zespół, stara drabina
 * awatarów) zostają absolutne bajt w bajt.
 */
export function buildImageSrcSet(
  src: string,
  widths: readonly number[] = RESPONSIVE_WIDTHS,
  quality?: number,
): string {
  if (!isSupabaseStorageUrl(src) || /\.svg(?:[?#]|$)/i.test(src)) return "";
  // Ścieżka względna wchodzi do `buildScaledImageUrl` i wychodzi względna.
  const base = widths === RESPONSIVE_WIDTHS ? renderedMediaUrl(src) : src;
  // Bez jawnej jakosci kazdy kandydat dostaje swoja (male warianty taniej) -
  // jawna wartosc obowiazuje caly zestaw, bo wolajacy wie lepiej.
  return widths
    .map((w) => `${buildScaledImageUrl(base, w, quality ?? qualityForWidth(w))} ${w}w`)
    .join(", ");
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

/**
 * `srcSet` 1x/2x/3x dla awatara o zadanym boku CSS.
 *
 * Celowo NIE korzysta z `qualityForWidth`: to kadr twarzy zmniejszony do
 * kilkudziesieciu pikseli, czyli dokladnie ten przypadek, w ktorym obnizona
 * jakosc dawala "papkowate" twarze (powod podniesienia stalej z 75 na 88).
 * Awatary nie leza tez na sciezce LCP, wiec nie ma czego tu oszczedzac.
 */
export function buildAvatarSrcSet(src: string, sizePx: number): string {
  if (!src || !isSupabaseStorageUrl(src)) return "";
  return [1, 2, 3].map((d) => `${buildAvatarSrc(src, sizePx, d)} ${d}x`).join(", ");
}
