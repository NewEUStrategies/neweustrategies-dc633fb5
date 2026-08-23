// Nazwy nośników bierzemy Z PRODUKCJI, nie przepisujemy ich do testu.
//
// Przepisana nazwa („nes_gpc" wklejone w test) rozjechałaby się z modułem przy
// pierwszej zmianie i test broniłby własnej kopii zamiast prawdy. `GPC_COOKIE`
// jest eksportowane; nazwa cookie CMP nie jest, więc czytamy ją ze źródła -
// i ta asymetria jest sama w sobie częścią defektu, który ten katalog opisuje:
// nie ma jednego miejsca, z którego rejestr RODO mógłby wziąć listę nośników.
import { readFileSync } from "node:fs";

import { GPC_COOKIE } from "@/lib/consent/gpc";

export { classifyKey } from "@/lib/cookieBanner/registry";

function staleZeZrodla(plik: string, nazwa: string): string {
  const src = readFileSync(plik, "utf8");
  const m = new RegExp(String.raw`const ${nazwa} = "([^"]+)"`).exec(src);
  if (!m) throw new Error(`test: nie znalazłem stałej ${nazwa} w ${plik}`);
  return m[1];
}

/** `nes_cookie_consent` - mirror decyzji CMP, 365 dni. */
export const COOKIE_CONSENT_CARRIER = staleZeZrodla("src/lib/ads/consent.ts", "COOKIE_NAME");

/** `nes_gpc` - nośnik sygnału Global Privacy Control. */
export const GPC_CARRIER = GPC_COOKIE;
