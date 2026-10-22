// WŁASNA STOPKA WYPISU W POCZCIE APLIKACJI - jedna stopka w skrzynce (Z-S5-05).
//
// DEFEKT. Mail marketingowy ścieżki komunikacji (S5) niesie własną stopkę
// „Wypisz się jednym kliknięciem" (render ścieżki), a kolejka aplikacji
// (`enqueueRawEmail`) ZAWSZE ustawia `sender_domain` - więc wysyłka idzie
// nadawcą platformy, który dokleja WŁASNĄ stopkę wypisu i nie da się jej
// wyłączyć (`unsubscribeToken.server.ts`). Odbiorca dostawał dwie stopki
// z dwoma różnymi linkami.
//
// ZMIANA. Render owija własną stopkę znacznikami, a dostawca decyduje przy
// wysyłce, bo dopiero on wie, KTÓRA droga wyjdzie:
//   * nadawca platformy - blok jest wycinany razem ze znacznikami (stopkę
//     i wypis daje platforma, `unsubscribe_token`),
//   * gateway Resend (bez stopki platformy, z nagłówkami RFC 8058) - znikają
//     same znaczniki, stopka zostaje.
// Znacznik HTML to komentarz (niewidoczny nawet bez obróbki); w tekście jest
// usuwany na KAŻDEJ drodze, więc nie trafi do skrzynki w żadnym wariancie.
//
// Moduł czysty (bez importów): woła go render ścieżki i dostawca poczty.

export const OWN_UNSUBSCRIBE_START = "<!--nes:unsub-->";
export const OWN_UNSUBSCRIBE_END = "<!--/nes:unsub-->";

// Blok razem z poprzedzającymi go znakami nowej linii - w tekście stopka
// stoi po pustej linii, a po wycięciu nie może zostawić wiszących odstępów.
const BLOCK_RE = /\n*<!--nes:unsub-->[\s\S]*?<!--\/nes:unsub-->/g;
const MARKER_RE = /<!--\/?nes:unsub-->/g;

/** Owija własną stopkę wypisu znacznikami (render). */
export function markOwnUnsubscribe(fragment: string): string {
  return fragment ? `${OWN_UNSUBSCRIBE_START}${fragment}${OWN_UNSUBSCRIBE_END}` : "";
}

/** Wycina oznaczone stopki z treścią - droga, na której stopkę dokleja nadawca. */
export function stripOwnUnsubscribe(content: string): string {
  return content.replace(BLOCK_RE, "").replace(MARKER_RE, "");
}

/** Zdejmuje same znaczniki, stopka zostaje - droga z własnym wypisem. */
export function unmarkOwnUnsubscribe(content: string): string {
  return content.replace(MARKER_RE, "");
}
