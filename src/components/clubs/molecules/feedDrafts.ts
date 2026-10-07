// Szkice rozmów w kartach strumienia (komentarz wpisu, odpowiedź z karty
// wątku) - poza drzewem Reacta.
//
// DLACZEGO NIE STAN KARTY. Hub podmienia cały strumień na wyniki
// wyszukiwania, szkielet albo komunikat: klik w #tag w komentarzu, chip działu
// na karcie, zmiana porządku albo trybu. Szkic trzymany w `useState` karty
// znikał wtedy bez słowa - razem z rozwiniętą sekcją - choć autor napisał już
// pół zdania. Rejestr modułowy przeżywa odmontowanie karty: po powrocie
// strumienia karta odzyskuje szkic (i sama rozwija rozmowę, w której czeka).
//
// ZAKRES. Pamięć karty przeglądarki, bez `sessionStorage`: szkic ma przetrwać
// przełączenie widoku, nie przeładowanie strony. Na serwerze rejestr się nie
// zapełnia - zapis idzie wyłącznie z efektu, czyli po stronie klienta. Pusty
// szkic znika z rejestru, a rejestr ma sufit, żeby długa sesja nie zbierała
// porzuconych zdań bez końca.
import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

/** Ile porzuconych szkiców pamiętamy naraz - najstarsze wypadają pierwsze. */
const MAX_DRAFTS = 50;

const drafts = new Map<string, string>();

/** Klucz szkicu komentarza pod wpisem ściany. */
export function postDraftKey(postId: string): string {
  return `post:${postId}`;
}

/** Klucz szkicu odpowiedzi z karty wątku. */
export function threadDraftKey(threadId: string): string {
  return `thread:${threadId}`;
}

export function readFeedDraft(key: string): string {
  return drafts.get(key) ?? "";
}

/** Czy pod kluczem czeka niewysłany tekst (sam biały znak się nie liczy). */
export function hasFeedDraft(key: string): boolean {
  return readFeedDraft(key).trim() !== "";
}

export function writeFeedDraft(key: string, value: string): void {
  drafts.delete(key);
  if (value === "") return;
  drafts.set(key, value);
  // `Map` pamięta kolejność wstawienia - pierwszy klucz to najdawniej pisany.
  while (drafts.size > MAX_DRAFTS) {
    const oldest = drafts.keys().next().value;
    if (oldest === undefined) break;
    drafts.delete(oldest);
  }
}

/** Sprzątanie między testami - rejestr żyje tyle, co moduł. */
export function clearFeedDrafts(): void {
  drafts.clear();
}

/**
 * Szkic jak `useState`, ale z pamięcią poza kartą: start z rejestru, każda
 * zmiana wraca do rejestru. Wyczyszczenie po wysyłce (`""`) usuwa wpis.
 */
export function useFeedDraft(key: string): [string, Dispatch<SetStateAction<string>>] {
  const [value, setValue] = useState(() => readFeedDraft(key));
  useEffect(() => {
    writeFeedDraft(key, value);
  }, [key, value]);
  return [value, setValue];
}
