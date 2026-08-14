// Wysyłka CV kandydata do prywatnego bucketu `career-cv`.
//
// Bucket jest prywatny, a ścieżka NIESIE TENANTA:
// `<tenant_id>/uploads/<YYYY-MM-DD>/<uuid>.<ext>` (ten sam wzorzec, co bucket
// `cv`). Polityka INSERT-u pozwala anonimowi wgrać plik wyłącznie do katalogu
// tenanta przeglądanego hosta, a odczyt (podpisany URL) ma tylko personel TEGO
// tenanta - bez tenanta w ścieżce redaktor jednego najemcy mógł podpisać CV
// każdego innego (`is_staff()` sprawdza rolę, nie tenanta).
//
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
export function validateCvFile(
  file: File,
): { ok: true } | { ok: false; errorKey: "cvTooLarge" | "cvType" } {
  if (file.size > CV_MAX_BYTES) return { ok: false, errorKey: "cvTooLarge" };
  const mimeOk = (CV_ACCEPTED_MIME as readonly string[]).includes(file.type);
  if (!mimeOk && !extensionOf(file)) return { ok: false, errorKey: "cvType" };
  return { ok: true };
}

/**
 * Tenant przeglądanego hosta - pierwszy segment ścieżki w buckecie.
 *
 * Klient nie zna identyfikatora tenanta; zna host, a `public_tenant_id()`
 * rozwiązuje go po nagłówku `x-tenant-host` (dokłada go
 * `integrations/supabase/tenant-host-fetch`). Jedna dodatkowa runda przy WYBORZE
 * pliku - nie przy wysyłce formularza - więc nie wydłuża ścieżki krytycznej.
 */
export async function currentTenantFolder(): Promise<string | null> {
  const { data, error } = await supabase.rpc("public_tenant_id");
  if (error || typeof data !== "string" || data.length === 0) return null;
  return data;
}

export async function uploadCv(file: File): Promise<CvUploadResult> {
  const check = validateCvFile(file);
  if (!check.ok) return { ok: false, errorKey: check.errorKey };

  const tenant = await currentTenantFolder();
  // Bez tenanta nie ma dokąd wgrać: polityka INSERT-u odrzuci każdą ścieżkę bez
  // poprawnego pierwszego segmentu, więc lepiej zgłosić błąd od razu niż czekać
  // na 403 z magazynu.
  if (!tenant) return { ok: false, errorKey: "cvUploadFailed" };

  const ext = extensionOf(file) ?? "pdf";
  const id =
    globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const path = `${tenant}/uploads/${new Date().toISOString().slice(0, 10)}/${id}.${ext}`;

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
