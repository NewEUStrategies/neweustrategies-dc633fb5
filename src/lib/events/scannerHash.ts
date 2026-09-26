// SHA-256 kodu z biletu - klucz, pod którym lista offline zna bilet.
//
// BAZA NIE TRZYMA TOKENÓW, TYLKO ICH SKRÓTY. `event_registrations.qr_token_hash`
// to sha256 (hex) losowego tokenu z `_event_new_qr_token()`, więc lista offline
// jedzie na telefon w tej samej postaci: z listy skrótów nie da się wybić
// ważnego biletu (192 bity entropii plus odporność sha256 na odwrócenie).
// Skaner liczy skrót zeskanowanego kodu i szuka go na liście - dokładnie tak,
// jak `event_checkin_record` szuka go w bazie.
//
// WEBCRYPTO NAJPIERW, BIBLIOTEKA W ZAPASIE. `/scanner` działa w bezpiecznym
// kontekście (aparat i Service Worker i tak go wymagają), więc `crypto.subtle`
// zwykle jest. Stare WebView i strona otwarta po http z adresu IP w sieci
// lokalnej go nie mają - wtedy liczymy tym samym algorytmem z `@noble/hashes`,
// ładowanym DOPIERO wtedy, żeby nie powiększać pakietu skanera dla wszystkich.

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

/** Skrót SHA-256 napisu (UTF-8) jako 64 znaki szesnastkowe, małymi literami. */
export async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const subtle = typeof crypto === "undefined" ? undefined : crypto.subtle;
  if (subtle !== undefined) {
    const digest = await subtle.digest("SHA-256", data);
    return toHex(new Uint8Array(digest));
  }
  const { sha256 } = await import("@noble/hashes/sha2.js");
  return toHex(sha256(data));
}
