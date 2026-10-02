// Identyfikator wiadomości wyliczany z klucza idempotencji.
//
// `email_send_log.message_id` jest tożsamością wiadomości w CAŁYM potoku: dren
// kolejki odsiewa po nim duplikaty (`alreadySent` + unikalny indeks wierszy
// 'sent'), raport poczty systemowej grupuje po nim próby, a webhook dostawcy
// wraca z nim do dziennika. Jeżeli ten sam klucz idempotencji ma dać JEDNĄ
// wiadomość, musi dawać ten sam `message_id` przy każdej próbie - losowy UUID
// per wywołanie robi z powtórzenia nową wiadomość, której żadna z tych
// warstw nie rozpozna jako duplikatu.
//
// Funkcja żyje osobno, bo potrzebują jej dwie powierzchnie wysyłki: pomocnicy
// serwerowi (`sendTxEmail`, `enqueueRawEmail`) i trasa HTTP
// `/platform/email/transactional/send`. Dwie kopie tej samej arytmetyki to
// dwie definicje tożsamości wiadomości, które wcześniej czy później się rozjadą.

/**
 * UUID (w kształcie v4) wyliczony z klucza: SHA-256 klucza, pierwsze 16 bajtów,
 * z ustawionymi bitami wersji i wariantu - żeby wartość przechodziła walidację
 * UUID u dostawcy i w narzędziach, które ją czytają. Stabilny między próbami i
 * izolatami Workera; różne klucze dają różne identyfikatory z prawdopodobieństwem
 * kolizji SHA-256.
 */
export async function deterministicMessageId(key: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  const b = Array.from(new Uint8Array(digest)).slice(0, 16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = b.map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
