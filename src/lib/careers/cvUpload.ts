// Wysyłka CV kandydata do prywatnego bucketu `career-cv`.
//
// Bucket jest prywatny: polityka pozwala anonimowym wgrać plik wyłącznie do
// prefiksu `uploads/`, a odczyt (podpisany URL) mają tylko osoby z personelu.
// Nazwa pliku jest generowana po stronie klienta, więc oryginalna nazwa nie
// trafia do ścieżki - zachowujemy ją osobno w metadanych zgłoszenia.
import { supabase } from "@/integrations/supabase/client";

import { CV_ACCEPTED_MIME, CV_MAX_BYTES } from "./applicationSchema";

export const CV_BUCKET = "career-cv";

export type CvUploadResult =
  | { ok: true; path: string; fileName: string; size: number }
  | { ok: false; errorKey: "cvTooLarge" | "cvType" | "cvUploadFailed" };

const EXTENSIONS: Record<string, string> = {
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
};

function extensionOf(file: File): string | null {
  const byMime = EXTENSIONS[file.type];
  if (byMime) return byMime;
  const suffix = file.name.split(".").pop()?.toLowerCase();
  return suffix && ["pdf", "doc", "docx"].includes(suffix) ? suffix : null;
}

/** Waliduje rozmiar i typ pliku bez wysyłki - używane przy wyborze pliku. */
export function validateCvFile(file: File): { ok: true } | { ok: false; errorKey: "cvTooLarge" | "cvType" } {
  if (file.size > CV_MAX_BYTES) return { ok: false, errorKey: "cvTooLarge" };
  const mimeOk = (CV_ACCEPTED_MIME as readonly string[]).includes(file.type);
  if (!mimeOk && !extensionOf(file)) return { ok: false, errorKey: "cvType" };
  return { ok: true };
}

export async function uploadCv(file: File): Promise<CvUploadResult> {
  const check = validateCvFile(file);
  if (!check.ok) return { ok: false, errorKey: check.errorKey };

  const ext = extensionOf(file) ?? "pdf";
  const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const path = `uploads/${new Date().toISOString().slice(0, 10)}/${id}.${ext}`;

  const { error } = await supabase.storage.from(CV_BUCKET).upload(path, file, {
    contentType: file.type || "application/octet-stream",
    upsert: false,
  });
  if (error) return { ok: false, errorKey: "cvUploadFailed" };

  return { ok: true, path, fileName: file.name, size: file.size };
}

/** Podpisany link do CV - tylko dla personelu (panel admina). */
export async function signCvUrl(path: string, expiresInSeconds = 300): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(CV_BUCKET)
    .createSignedUrl(path, expiresInSeconds);
  return error ? null : (data?.signedUrl ?? null);
}
