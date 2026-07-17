// Helpers server-only dla server-fn zgód. Trzymamy je poza `.functions.ts`,
// żeby splitter tss-serverfn-split nie musiał pakować siblingów do chunków
// handlerów (co powodowało "Failed to load url ...?tss-serverfn-split").
import { z } from "zod";
import { CONSENT_KEYS } from "@/lib/notifications/consentCatalog";

export const ConsentKeyEnum = z.enum(CONSENT_KEYS as [string, ...string[]]);

export const SetConsentSchema = z.object({
  key: ConsentKeyEnum,
  given: z.boolean(),
  version: z.string().trim().min(1).max(32),
  lang: z.enum(["pl", "en"]).optional(),
  source: z.string().trim().max(64).optional(),
});

export const ListEventsSchema = z.object({
  limit: z.number().int().min(1).max(200).optional(),
});

export function readIp(req: Request | null): string | null {
  if (!req) return null;
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]?.trim() || null;
  return req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") || null;
}

export function readUserAgent(req: Request | null): string | null {
  if (!req) return null;
  const ua = req.headers.get("user-agent");
  return ua ? ua.slice(0, 500) : null;
}
