// Podgląd treści wiadomości na liście rozmów (ikona czatu w nagłówku).
//
// REGUŁA: pokazujemy PIERWSZE `limit` znaków treści LICZĄC SPACJE, a gdy tekst
// jest dłuższy - dokładamy wielokropek. Białe znaki na brzegach i złamania
// linii spłaszczamy do pojedynczych spacji, żeby wiersz listy nie „skakał"
// przy wiadomościach wieloliniowych.
export const CHAT_PREVIEW_CHARS = 30;

export function truncatePreview(text: string, limit: number = CHAT_PREVIEW_CHARS): string {
  const flat = text.replace(/\s+/g, " ").trim();
  // `Array.from` liczy punkty kodowe, więc emoji nie da się przeciąć na pół.
  const chars = Array.from(flat);
  if (chars.length <= limit) return flat;
  return `${chars.slice(0, limit).join("")}…`;
}
