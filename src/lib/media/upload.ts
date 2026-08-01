// Jedyna ścieżka wgrywania plików do publicznego bucketu `media` po stronie
// klienta.
//
// DEFEKT, który ten moduł zamyka (bifurkacja uploadu -> wektor SVG-XSS).
// Upload jest dwufazowy: przeglądarka wrzuca bajty PROSTO do storage (żeby nie
// przepychać dużych plików przez workera), a dopiero potem serwer waliduje je w
// `registerMediaUpload` (allowlista MIME, limit rozmiaru, prefiks tenanta,
// audyt). Trzy niezależne implementacje tego przepływu rozjechały się w
// najgorszym możliwym miejscu - w obsłudze ODRZUCONEJ rejestracji:
//
//   * builder/ImageSlot  - kasował obiekt ze storage (`storage.remove`) i to
//                          jest zachowanie poprawne,
//   * MediaManager       - tylko `toastError(err)`,
//   * MediaPickerDialog  - tylko `toastError(err)`.
//
// W dwóch ostatnich odrzucony plik ZOSTAWAŁ w publicznym buckecie, pod znanym
// wgrywającemu publicznym URL-em. Bucket `media` jest publiczny i nie ma
// `allowed_mime_types`, a polityka storage bramkuje tylko rolę - więc każdy
// członek redakcji (także `author`) mógł wgrać `image/svg+xml` z osadzonym
// `<script>`, zobaczyć czerwony toast „Disallowed mime type" i mimo to dostać
// żywy, serwowany bezpośrednio z bajtów adres = stored XSS. Serwerowa
// allowlista wyglądała jak obrona, a w praktyce blokowała tylko WIERSZ w tabeli
// `media`, nie sam plik. Do tego builder oferował SVG w `accept` i we własnej
// liście MIME, czyli UI wprost zapraszał do wgrania typu, który platforma
// odrzuca.
//
// Kontrakt tego modułu:
//   1. walidacja PRZED uploadem, z tej samej listy dla każdego wywołującego,
//   2. upload -> rejestracja,
//   3. nieudana rejestracja = OBOWIĄZKOWE sprzątnięcie obiektu ze storage.
// Warstwa DB (migracja 20260725090400) domyka to samo od dołu: bucket dostaje
// `allowed_mime_types`, więc ręcznie skrojony klient też nie wstawi SVG.
import { supabase } from "@/integrations/supabase/client";

/**
 * Allowlista MIME - MUSI odpowiadać `ALLOWED_MIME` w `src/lib/media.functions.ts`
 * (serwer jest autorytetem, tu chodzi o to, żeby użytkownik dowiedział się o
 * odrzuceniu przed wysłaniem bajtów).
 *
 * `image/svg+xml` świadomie NIE jest dozwolony: bucket jest publiczny i serwuje
 * bajty bezpośrednio, a SVG wykonuje osadzony `<script>` w kontekście domeny.
 */
export const UPLOADABLE_MIME: readonly string[] = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
  "image/apng",
  "application/pdf",
  "audio/mpeg",
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
  "audio/aac",
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
  "audio/flac",
  "audio/webm",
  "audio/ogg",
  "video/mp4",
  "video/webm",
];

/** Wartość atrybutu `accept` dla `<input type="file">` - jawna lista, nie `image/*`. */
export const UPLOAD_ACCEPT_ATTR = UPLOADABLE_MIME.join(",");

/** Podzbiory dla pickerów ograniczonych do jednego rodzaju mediów. */
export const IMAGE_MIME = UPLOADABLE_MIME.filter((m) => m.startsWith("image/"));
export const AUDIO_MIME = UPLOADABLE_MIME.filter((m) => m.startsWith("audio/"));
export const VIDEO_MIME = UPLOADABLE_MIME.filter((m) => m.startsWith("video/"));

export const IMAGE_ACCEPT_ATTR = IMAGE_MIME.join(",");
export const AUDIO_ACCEPT_ATTR = AUDIO_MIME.join(",");

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB (obrazy / PDF)
const MAX_AUDIO_BYTES = 300 * 1024 * 1024; // 300 MB (odcinki podcastu)
const MAX_VIDEO_BYTES = 200 * 1024 * 1024; // 200 MB (tła wideo)

/** Limit rozmiaru per typ - lustrzany do `maxBytesFor` na serwerze. */
export function maxBytesForMime(mime: string): number {
  if (mime.startsWith("audio/")) return MAX_AUDIO_BYTES;
  if (mime.startsWith("video/")) return MAX_VIDEO_BYTES;
  return MAX_BYTES;
}

export type UploadRejection =
  { kind: "mime"; mime: string } | { kind: "size"; sizeBytes: number; maxBytes: number };

/** Zwraca `null`, gdy plik jest do przyjęcia, albo powód odrzucenia. */
export function checkUploadable(
  file: { type: string; size: number },
  allowed: readonly string[] = UPLOADABLE_MIME,
): UploadRejection | null {
  if (!allowed.includes(file.type)) return { kind: "mime", mime: file.type };
  const maxBytes = maxBytesForMime(file.type);
  if (file.size > maxBytes) return { kind: "size", sizeBytes: file.size, maxBytes };
  return null;
}

/** Klucz obiektu w storage: `<tenant>/<user>/[podfolder/]<losowa nazwa>.<ext>`. */
export function storageObjectPath(args: {
  tenantId: string;
  userId: string;
  filename: string;
  /** Segment ścieżki w storage (np. "widgets"), bez ukośników. */
  subfolder?: string;
  /** Wstrzykiwane w testach; produkcyjnie Date.now() + Math.random(). */
  uniqueSuffix?: string;
}): string {
  // Rozszerzeniem jest wyłącznie ostatni segment PO kropce i tylko gdy wygląda
  // jak rozszerzenie. Wcześniejsze `split(".").pop()` na nazwie bez kropki
  // brało całą nazwę pliku ("noext" -> ".noext").
  const dot = args.filename.lastIndexOf(".");
  const rawExt = dot > 0 ? args.filename.slice(dot + 1) : "";
  const ext = rawExt
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 10);
  const unique = args.uniqueSuffix ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const dir = args.subfolder ? `${args.subfolder.replace(/^\/+|\/+$/g, "")}/` : "";
  return `${args.tenantId}/${args.userId}/${dir}${unique}.${ext || "bin"}`;
}

/** Rejestracja pliku w tabeli `media` (server function `registerMediaUpload`). */
export type RegisterMediaFn = (args: {
  data: {
    storagePath: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    publicUrl: string;
    altText?: string;
  };
}) => Promise<{ id: string }>;

export interface UploadedMedia {
  mediaId: string;
  storagePath: string;
  publicUrl: string;
}

class UploadRejectedError extends Error {
  readonly rejection: UploadRejection;
  constructor(rejection: UploadRejection) {
    super(
      rejection.kind === "mime"
        ? `Disallowed mime type: ${rejection.mime || "unknown"}`
        : `File too large: ${rejection.sizeBytes} > ${rejection.maxBytes}`,
    );
    this.name = "UploadRejectedError";
    this.rejection = rejection;
  }
}

/**
 * Waliduje, wgrywa i rejestruje plik. Gdy rejestracja się nie uda, obiekt jest
 * USUWANY ze storage - to jest cały sens istnienia tej funkcji, więc żadne
 * wywołanie nie powinno składać tych kroków samodzielnie.
 */
export async function uploadAndRegisterMedia(args: {
  file: File;
  tenantId: string;
  userId: string;
  registerMedia: RegisterMediaFn;
  /** Zawężenie allowlisty (np. tylko obrazy w pickerze okładki). */
  allowedMime?: readonly string[];
  /** Segment ścieżki w storage. */
  subfolder?: string;
  altText?: string;
}): Promise<UploadedMedia> {
  const rejection = checkUploadable(args.file, args.allowedMime ?? UPLOADABLE_MIME);
  if (rejection) throw new UploadRejectedError(rejection);

  const storagePath = storageObjectPath({
    tenantId: args.tenantId,
    userId: args.userId,
    filename: args.file.name,
    ...(args.subfolder ? { subfolder: args.subfolder } : {}),
  });

  const { error: upErr } = await supabase.storage.from("media").upload(storagePath, args.file, {
    cacheControl: "3600",
    upsert: false,
    contentType: args.file.type,
  });
  if (upErr) throw upErr;

  const { data: urlData } = supabase.storage.from("media").getPublicUrl(storagePath);
  const publicUrl = urlData?.publicUrl ?? "";

  try {
    if (!publicUrl) throw new Error("storage_public_url_missing");
    const registered = await args.registerMedia({
      data: {
        storagePath,
        filename: args.file.name,
        mimeType: args.file.type,
        sizeBytes: args.file.size,
        publicUrl,
        ...(args.altText ? { altText: args.altText } : {}),
      },
    });
    return { mediaId: registered.id, storagePath, publicUrl };
  } catch (registerError) {
    // KRYTYCZNE: bez tego odrzucony plik zostaje żywy pod publicznym URL-em.
    await supabase.storage
      .from("media")
      .remove([storagePath])
      .catch(() => undefined);
    throw registerError;
  }
}
