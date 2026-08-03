// Helpers server-only dla server-fn zgód. Trzymamy je poza `.functions.ts`,
// żeby splitter tss-serverfn-split nie musiał pakować siblingów do chunków
// handlerów (co powodowało "Failed to load url ...?tss-serverfn-split").
import { z } from "zod";
import { readGpcCookie, readGpcFromHeaders } from "@/lib/consent/gpc";
import { CONSENT_KEYS } from "@/lib/notifications/consentCatalog";

export const ConsentKeyEnum = z.enum(CONSENT_KEYS as [string, ...string[]]);

export const SetConsentSchema = z.object({
  key: ConsentKeyEnum,
  given: z.boolean(),
  version: z.string().trim().min(1).max(32),
  lang: z.enum(["pl", "en"]).optional(),
  source: z.string().trim().max(64).optional(),
  /**
   * Sygnał GPC zgłoszony przez klienta w momencie decyzji. Deklaracja klienta
   * jest tylko WSKAZÓWKĄ - `resolveGpcForWrite` OR-uje ją z sygnałem odczytanym
   * serwerowo, więc klient może sygnał wyłącznie potwierdzić, nigdy zataić.
   */
  gpc: z.boolean().optional(),
});

// Batch: jedna podróż sieciowa dla decyzji CMP obejmującej kilka kategorii
// cookie naraz (registryBridge). Limit 10 = rozmiar katalogu z zapasem.
export const SetConsentsBulkSchema = z.object({
  entries: z.array(SetConsentSchema).min(1).max(10),
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

/**
 * Sygnał GPC odczytany SERWEROWO z żądania: nagłówek `Sec-GPC` jest źródłem
 * pierwszym, cookie transportowe (`nes_gpc`, ustawiane przez `gpcMiddleware`)
 * fallbackiem. Fallback jest konieczny, bo przeglądarka dokłada `Sec-GPC` do
 * NAWIGACJI, a nie do każdego fetcha RPC - w wywołaniu server fn nagłówka może
 * po prostu nie być, choć sygnał jest aktywny.
 */
export function readGpc(req: Request | null): boolean {
  if (!req) return false;
  if (readGpcFromHeaders(req.headers).active) return true;
  return readGpcCookie(req.headers.get("cookie"));
}

/**
 * Sygnał GPC zapisywany razem z decyzją. FAIL-CLOSED W STRONĘ PRYWATNOŚCI:
 * OR deklaracji klienta i odczytu serwerowego.
 *
 * Dlaczego nie tylko serwer: patrz `readGpc` - w wywołaniu RPC nagłówka może
 * brakować, a klient widzi jeszcze `navigator.globalPrivacyControl`, którego
 * serwer nie zobaczy nigdy.
 *
 * Dlaczego nie tylko klient: deklaracja klienta jest danymi wejściowymi, a te
 * nigdy nie są dowodem. Klient może więc sygnał POTWIERDZIĆ, ale nie może go
 * ZATAIĆ - to jest cała asymetria, którą daje OR.
 */
export function resolveGpcForWrite(req: Request | null, clientClaim: boolean | undefined): boolean {
  return clientClaim === true || readGpc(req);
}
