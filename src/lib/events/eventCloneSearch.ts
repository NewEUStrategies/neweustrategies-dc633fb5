// Stan adresu `/admin/events/new` (`?from=<uuid>` - tryb kopii edycji).
//
// OSOBNY LISC, BO TRASA WOLA GO W `validateSearch`. Ta czesc definicji trasy
// nie jest dzielona z komponentem i jedzie w chunku startowym (`index`) -
// import z `eventCloneDraft` wciagal tam wszystkie reguly formularza klonu
// (+4 kB przed minifikacja na KAZDYM pierwszym wejsciu na strone).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Stan adresu `/admin/events/new`: `?from=<uuid>` wlacza tryb kopii. Wszystko
 * inne jest odrzucane - adres przeklejony z literowka nie moze poleciec do RPC
 * jako nie-UUID (odmowa `22P02` nic nie mowi organizatorowi).
 *
 * KLUCZ `from` JEST ZAWSZE W WYNIKU (takze jako `undefined`). Router scala
 * search dziecka z search rodzica, a korzen nie waliduje niczego - pominiety
 * klucz przepuscilby wiec surowe `?from=nie-uuid` do komponentu. Jawny
 * `undefined` nadpisuje surowa wartosc.
 */
export function parseCloneSearch(search: Record<string, unknown>): { from: string | undefined } {
  const from = typeof search.from === "string" ? search.from.trim() : "";
  return { from: UUID_RE.test(from) ? from.toLowerCase() : undefined };
}
