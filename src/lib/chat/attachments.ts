// Chat attachments - client-side mirror of the storage bucket contract
// (bucket "chat-attachments": private, 30 MB cap, strict MIME allowlist).
// The bucket + storage RLS enforce the same rules server-side; this module
// exists so users get instant, translated feedback instead of storage errors.
import { useEffect } from "react";
import { useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { chatKeys } from "./keys";

export const MAX_ATTACHMENT_BYTES = 30 * 1024 * 1024; // 30 MB

// No SVG: active content (embedded scripts) - the server-side bucket allowlist
// rejects it, so offering it here only produced a late, confusing error.
export const IMAGE_MIME_TYPES: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

export const FILE_MIME_TYPES: ReadonlySet<string> = new Set([
  "application/pdf",
  // text files
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/rtf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.oasis.opendocument.text",
  // spreadsheets
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.oasis.opendocument.spreadsheet",
  // presentations
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.oasis.opendocument.presentation",
]);

// Voice notes are recorded in-app (MediaRecorder), never via the file picker,
// so they are NOT part of ATTACHMENT_ACCEPT. Mirrors the bucket allowlist.
export const AUDIO_MIME_TYPES: ReadonlySet<string> = new Set([
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
  "audio/mpeg",
]);

/** Hard cap for a single voice note (mirrors the DB CHECK). */
export const MAX_VOICE_SECONDS = 600;

export const ATTACHMENT_ACCEPT = [...IMAGE_MIME_TYPES, ...FILE_MIME_TYPES].join(",");

export type AttachmentKind = "image" | "file" | "audio";

export function attachmentKindForMime(mime: string): AttachmentKind | null {
  if (IMAGE_MIME_TYPES.has(mime)) return "image";
  if (FILE_MIME_TYPES.has(mime)) return "file";
  if (AUDIO_MIME_TYPES.has(mime)) return "audio";
  return null;
}

export type AttachmentValidationError = "type" | "size";

export function validateAttachment(file: File): AttachmentValidationError | null {
  if (!attachmentKindForMime(file.type)) return "type";
  if (file.size <= 0 || file.size > MAX_ATTACHMENT_BYTES) return "size";
  return null;
}

export function formatBytes(bytes: number, lang: "pl" | "en"): string {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = unit === 0 ? String(value) : value.toFixed(value >= 10 ? 0 : 1);
  return `${rounded.replace(".", lang === "pl" ? "," : ".")} ${units[unit]}`;
}

function sanitizeFileName(name: string): string {
  const trimmed = name.slice(-140);
  return trimmed.replace(/[^\p{L}\p{N}._-]+/gu, "_");
}

export interface UploadedAttachment {
  path: string;
  name: string;
  mime: string;
  size: number;
}

/**
 * Upload a chat attachment to the private bucket via a signed URL + XHR so we
 * can surface real progress (same approach as the avatar/cover upload).
 * Path contract enforced by storage RLS: <tenant_id>/<conversation_id>/<uid>/<file>.
 */
export async function uploadChatAttachment(params: {
  file: File;
  tenantId: string;
  conversationId: string;
  userId: string;
  onProgress?: (percent: number) => void;
}): Promise<UploadedAttachment> {
  const { file, tenantId, conversationId, userId, onProgress } = params;
  const invalid = validateAttachment(file);
  if (invalid) throw new Error(`chat-attachment:${invalid}`);

  // Server-side upload rate limit (20/min per user). Uploads land in storage
  // BEFORE the message row exists, so the message rate-limit trigger cannot
  // gate them - this RPC is the enforcement point against storage abuse.
  const { error: quotaError } = await supabase.rpc("chat_check_upload_quota" as never);
  if (quotaError) throw new Error("chat-attachment:rate-limited");

  const path = `${tenantId}/${conversationId}/${userId}/${crypto.randomUUID()}-${sanitizeFileName(file.name)}`;
  const { data: signed, error: signError } = await supabase.storage
    .from("chat-attachments")
    .createSignedUploadUrl(path);
  if (signError || !signed) throw signError ?? new Error("chat-attachment:sign");

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", signed.signedUrl);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (evt) => {
      if (evt.lengthComputable && onProgress) {
        onProgress(Math.round((evt.loaded / evt.total) * 100));
      }
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`HTTP ${xhr.status}`));
    xhr.onerror = () => reject(new Error("chat-attachment:network"));
    xhr.send(file);
  });

  return { path, name: file.name, mime: file.type, size: file.size };
}

// 15 min: short-lived so a leaked/cached signed URL has a small window; the
// per-path query refreshes ~5 min before expiry, so playback/preview never
// break mid-session. (Was 1h - tightened for attachment confidentiality.)
const SIGNED_URL_TTL_SECONDS = 15 * 60;

/**
 * Batch-sign every not-yet-cached attachment of a thread in ONE storage call
 * (instead of one createSignedUrl round-trip per attachment) and seed the
 * per-path cache entries that useAttachmentUrl reads.
 */
export function usePrefetchAttachmentUrls(paths: ReadonlyArray<string>): void {
  const qc = useQueryClient();
  // Key is order-independent so pagination prepends don't retrigger the batch.
  const pathsKey = [...paths].sort().join("\n");
  useEffect(() => {
    const missing = pathsKey
      .split("\n")
      .filter((p) => p.length > 0 && qc.getQueryData(chatKeys.attachmentUrl(p)) === undefined);
    if (missing.length < 2) return; // a single miss is cheaper via the per-item query
    let cancelled = false;
    void supabase.storage
      .from("chat-attachments")
      .createSignedUrls(missing, SIGNED_URL_TTL_SECONDS)
      .then(({ data }) => {
        if (cancelled || !data) return;
        for (const item of data) {
          if (item.path && item.signedUrl && !item.error) {
            qc.setQueryData(chatKeys.attachmentUrl(item.path), item.signedUrl);
          }
        }
      })
      .catch(() => {
        /* per-item queries remain the fallback */
      });
    return () => {
      cancelled = true;
    };
  }, [pathsKey, qc]);
}

/**
 * Resolve a signed URL for a private attachment. Cached and refreshed before
 * the URL expires; only conversation members pass the storage RLS check.
 */
export function useAttachmentUrl(path: string | null): UseQueryResult<string> {
  return useQuery({
    queryKey: chatKeys.attachmentUrl(path ?? "none"),
    enabled: !!path,
    staleTime: (SIGNED_URL_TTL_SECONDS - 300) * 1000,
    gcTime: SIGNED_URL_TTL_SECONDS * 1000,
    queryFn: async (): Promise<string> => {
      if (!path) throw new Error("chat-attachment:path");
      // Escape hatch for local previews (demo bot, offline drafts): a path
      // that is already a resolvable URL is returned verbatim. Storage RLS
      // still gates real chat attachments because those never carry these
      // prefixes.
      if (/^(blob:|data:|https?:)/i.test(path)) return path;
      const { data, error } = await supabase.storage
        .from("chat-attachments")
        .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
      if (error || !data) throw error ?? new Error("chat-attachment:sign");
      return data.signedUrl;
    },
  });
}
