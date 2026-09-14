// Kotwice deep-linków z powiadomień sieciowych - JEDNO źródło formatu dzielone
// przez producenta (wyzwalacz w bazie) i konsumenta (wiersz w DOM).
//
// PRZYCZYNA ŹRÓDŁOWA. Migracja 20260812101000 była NAPRAWĄ MARTWYCH LINKÓW
// i naprawiła połowę kontraktu. Jej własny nagłówek (punkt 2, linie 30-38)
// deklaruje, że "fragment #i-<id>-<status> wskazuje wiersz" - a w całym `src/`
// nie istniał ANI JEDEN atrybut `id` w tym formacie. Wyzwalacze budowały
// adresy `'/profile?tab=activity&intro=<rola>#i-' || NEW.id || '-<status>'`
// (linie 92, 113, 125, 141) oraz bliźniacze `#r-<id>-<status>` dla
// rekomendacji (linie 201, 216), parametry `?tab` i `?intro` działały, a
// HASH NIE MIAŁ W CO TRAFIĆ: powiadomienie doprowadzało na właściwą zakładkę
// i zostawiało użytkownika na górze listy.
//
// Dlatego format mieszka tutaj, a nie w literale przy `<div>`: producent jest
// w SQL-u i nie ma jak sprawdzić konsumenta, więc jedyne, co można zrobić, to
// nie pozwolić konsumentowi rozjechać się po dwóch plikach naraz.
//
// DLACZEGO KOTWICA NIESIE STATUS, SKORO STATUS SIĘ ZMIENIA. Bo tak robi
// producent: powiadomienie stempluje status Z CHWILI WYSYŁKI (`-pending`
// przy prośbie, `-forwarded` po przekazaniu). Wiersz oglądany później może
// stać już na innym statusie, więc dokładne id nie trafi. `resolveAnchorId`
// niżej rozstrzyga to po stronie ODBIORCY: najpierw szuka dokładnego id,
// a gdy go nie ma - wiersza o tym samym identyfikatorze w dowolnym stanie.
// Alternatywa (kotwica bez statusu) wymagałaby zmiany producenta, czyli nowej
// migracji na wszystkich czterech wyzwalaczach, i unieważniłaby powiadomienia
// już wysłane.

/** Kotwica wiersza wprowadzenia: `i-<id>-<status>` (20260812101000:92). */
export function introductionAnchorId(id: string, status: string): string {
  return `i-${id}-${status}`;
}

/** Kotwica wiersza rekomendacji: `r-<id>-<status>` (20260812101000:201). */
export function recommendationAnchorId(id: string, status: string): string {
  return `r-${id}-${status}`;
}

/**
 * Element wskazany fragmentem adresu, z zejściem na "ten sam wiersz w innym
 * stanie". Zwraca ID ZNALEZIONEGO elementu (nie element), bo tego oczekuje
 * `smoothScrollToAnchor`; `null`, gdy w DOM nie ma ani jednego kandydata.
 */
export function resolveAnchorId(hash: string, doc: Document): string | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw) return null;
  if (doc.getElementById(raw)) return raw;

  // `i-<uuid>-<status>`: obcinamy ostatni człon i szukamy po prefiksie.
  // Przez `[id]` + `startsWith`, a nie przez selektor `[id^="..."]`: fragment
  // pochodzi z adresu, więc wstawiony wprost do selektora wymagałby
  // escapowania, a `CSS.escape` nie jest w tym środowisku niczym pewnym.
  const lastDash = raw.lastIndexOf("-");
  if (lastDash <= 0) return null;
  const prefix = raw.slice(0, lastDash + 1);
  for (const el of doc.querySelectorAll("[id]")) {
    if (el.id.startsWith(prefix)) return el.id;
  }
  return null;
}
