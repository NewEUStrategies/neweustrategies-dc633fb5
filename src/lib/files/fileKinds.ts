// Rozpoznawanie typu pliku dla podglądu w platformie.
//
// CZYSTA WARSTWA DECYZJI: nic tu nie renderuje i nic nie pobiera. Dzięki temu
// ta sama funkcja odpowiada na pytanie "czy pokazać przycisk Podgląd?" w
// kompozytorze, na karcie wpisu i w panelu dokumentów - bez trzech różnych
// list rozszerzeń, które prędzej czy później się rozjadą.
//
// MIME NIE WYSTARCZA. Przeglądarki potrafią oddać puste `type` dla .csv czy
// .docx wybranego z dysku sieciowego, a Windows bywa, że podaje
// `application/octet-stream`. Dlatego decyzja zawsze bierze pod uwagę także
// rozszerzenie nazwy.

export type ViewerKind =
  | "image"
  | "video"
  | "audio"
  | "pdf"
  | "docx"
  | "xlsx"
  | "pptx"
  | "text"
  | "markdown"
  | "csv"
  | "archive"
  | "unknown";

/** Rozszerzenie bez kropki, małymi literami ("" gdy brak). */
export function extensionOf(name: string): string {
  const index = name.lastIndexOf(".");
  if (index < 0 || index === name.length - 1) return "";
  return name.slice(index + 1).toLowerCase();
}

/** Etykieta typu pokazywana na kaflu pliku ("PDF", "DOCX", "PLIK"). */
export function fileLabel(name: string, mime: string): string {
  const ext = extensionOf(name);
  if (ext !== "") return ext.toUpperCase().slice(0, 5);
  const subtype = mime.split("/")[1];
  return subtype === undefined || subtype === "" ? "FILE" : subtype.toUpperCase().slice(0, 5);
}

const IMAGE_EXT = ["jpg", "jpeg", "png", "webp", "gif", "avif", "bmp", "svg"];
const VIDEO_EXT = ["mp4", "webm", "mov", "m4v"];
const AUDIO_EXT = ["mp3", "wav", "ogg", "m4a", "aac", "flac"];
const TEXT_EXT = ["txt", "log", "json", "xml", "yml", "yaml", "html", "css", "js", "ts", "sql"];
const ARCHIVE_EXT = ["zip", "rar", "7z", "tar", "gz"];

/**
 * Do jakiego podglądu prowadzi ten plik. Kolejność nie jest przypadkowa:
 * najpierw formaty biurowe (mają najbardziej mylące MIME), potem media.
 */
export function viewerKindFor(mime: string, name: string): ViewerKind {
  const ext = extensionOf(name);
  const type = mime.toLowerCase();

  if (ext === "pdf" || type === "application/pdf") return "pdf";
  if (ext === "docx" || ext === "doc" || type.includes("wordprocessingml")) return "docx";
  if (ext === "xlsx" || ext === "xls" || ext === "ods" || type.includes("spreadsheetml"))
    return "xlsx";
  if (ext === "pptx" || ext === "ppt" || ext === "odp" || type.includes("presentationml"))
    return "pptx";
  if (ext === "csv" || type === "text/csv") return "csv";
  if (ext === "md" || ext === "markdown" || type === "text/markdown") return "markdown";
  if (IMAGE_EXT.includes(ext) || type.startsWith("image/")) return "image";
  if (VIDEO_EXT.includes(ext) || type.startsWith("video/")) return "video";
  if (AUDIO_EXT.includes(ext) || type.startsWith("audio/")) return "audio";
  if (TEXT_EXT.includes(ext) || type.startsWith("text/")) return "text";
  if (ARCHIVE_EXT.includes(ext)) return "archive";
  return "unknown";
}

/** Czy dla tego pliku otwieramy popup podglądu (a nie tylko pobranie). */
export function isPreviewable(mime: string, name: string): boolean {
  const kind = viewerKindFor(mime, name);
  return kind !== "unknown" && kind !== "archive";
}

/** Czy podgląd wymaga pobrania i przetworzenia zawartości po stronie klienta. */
export function needsClientParse(kind: ViewerKind): boolean {
  return kind === "docx" || kind === "xlsx" || kind === "pptx";
}

/** Rozmiar w formie czytelnej dla człowieka (neutralny językowo). */
export function humanSize(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || bytes <= 0) return "";
  const units = ["B", "kB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}
