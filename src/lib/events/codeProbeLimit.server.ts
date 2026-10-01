// Limit prób kodów (rabatowych i odsłaniających bilety) na publicznych
// endpointach sondy - server-only.
//
// PO CO. Odpowiedź „ten kod odsłania bilet" albo „ten kod daje rabat" jest
// wyrocznią: bez limitu da się przejść słownik kodów i zebrać ważne. Limit stoi
// WYŁĄCZNIE przed endpointami, które istnieją po to, żeby zapytać o kod
// (odsłonięcie biletów, podgląd kuponu planu, rabat dla nakładki płatności).
// Wycena i kasa ponawiają walidację tego samego kodu wiele razy w jednej
// legalnej sesji - tam pilnuje kubełek PUDEŁ w bazie (`_coupon_probe_guard`,
// migracja 20261001100000), który nie liczy trafień.
//
// DWA KUBEŁKI, NAJPIERW IP. Kubełek po adresie łapie anonima i farmę kont za
// jednym adresem; kubełek po koncie łapie jedno konto rozproszone po wielu
// adresach. Odmowa kubełka IP kończy pracę, ZANIM serwer zapyta o tożsamość
// albo o cokolwiek w bazie poza samym licznikiem.
//
// FAIL-CLOSED. Awaria licznika nie może zdjąć ochrony przed zgadywaniem - przy
// błędzie `rate_limit_hit` odmawiamy (jak `sponsorReport.server.ts`).
//
// SOLONY SKRÓT, NIE ADRES. `requestRateSubject` zapisuje w `rate_limits`
// skrót z solą: wyciek tej tabeli nie daje listy adresów IP ani kont.
import { getRequest } from "@tanstack/react-start/server";

import { optionalUserIdFromRequest } from "@/lib/auth/optionalUser.server";
import { rateLimit } from "@/lib/server/rate-limit.server";
import { requestRateSubject } from "@/lib/server/rateSubject.server";

/**
 * Prób w oknie na kubełek. Te same liczby co kubełek pudeł w bazie
 * (`coupon_probe_miss`) i limit raportu sponsora: człowiek wpisuje kod kilka
 * razy, słownik - tysiące. Trzydziesta pierwsza próba w oknie to odmowa.
 */
export const CODE_PROBE_RATE_LIMIT = { max: 30, windowMinutes: 10 } as const;

export const CODE_PROBE_IP_SCOPE = "coupon_probe.ip";
export const CODE_PROBE_USER_SCOPE = "coupon_probe.user";

/**
 * Czy wolno zadać kolejne pytanie o kod.
 *
 * `resolveUserId` jest leniwe celowo: tożsamość (weryfikacja tokenu) liczymy
 * dopiero PO przejściu kubełka IP, więc zablokowany adres nie kosztuje nawet
 * zapytania do serwera uwierzytelniania. `null` = anonim, bez drugiego kubełka.
 */
export async function allowCodeProbe(
  headers: Headers | null | undefined,
  resolveUserId: () => Promise<string | null>,
): Promise<boolean> {
  const ipAllowed = await rateLimit({
    scope: CODE_PROBE_IP_SCOPE,
    subjectId: requestRateSubject(headers),
    max: CODE_PROBE_RATE_LIMIT.max,
    windowMinutes: CODE_PROBE_RATE_LIMIT.windowMinutes,
    failClosed: true,
  });
  if (!ipAllowed) return false;

  const userId = await resolveUserId();
  if (userId === null) return true;
  return rateLimit({
    scope: CODE_PROBE_USER_SCOPE,
    subjectId: requestRateSubject(null, userId),
    max: CODE_PROBE_RATE_LIMIT.max,
    windowMinutes: CODE_PROBE_RATE_LIMIT.windowMinutes,
    failClosed: true,
  });
}

/**
 * `allowCodeProbe` dla BIEŻĄCEGO żądania publicznej funkcji serwerowej: adres
 * z nagłówków żądania, konto z sesji, gdy jest (bez sesji - sam kubełek IP).
 *
 * Brak kontekstu żądania nie znosi limitu: `requestRateSubject(null)` wpada do
 * wspólnego kubełka „adres nieznany", a nie omija bramki.
 */
export async function allowCodeProbeForRequest(): Promise<boolean> {
  let headers: Headers | null = null;
  try {
    headers = getRequest().headers;
  } catch {
    headers = null;
  }
  return allowCodeProbe(headers, optionalUserIdFromRequest);
}
