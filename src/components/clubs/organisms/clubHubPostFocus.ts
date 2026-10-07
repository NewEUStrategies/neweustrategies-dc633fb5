// Parametr adresu `?post=<id>` huba klubu - wejście z powiadomienia
// o komentarzu albo wzmiance we wpisie ściany.
//
// DLACZEGO PARAMETR, A NIE WŁASNA TRASA WPISU. Wpis jest krótką formą
// i nie ma strony - jego miejscem jest strumień klubu. Powiadomienie prowadzi
// więc do huba, a hub przewija do karty wpisu i rozwija jej komentarze.
//
// WALIDACJA UUID. Wartość trafia do selektora `[data-post-id="…"]`; przepuszczamy
// wyłącznie identyfikator w kanonicznym kształcie (małe litery - tak oddaje go
// baza), więc adres nie jest kanałem na dowolny tekst w selektorze ani w DOM-ie.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseClubPostFocus(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return UUID.test(trimmed) ? trimmed.toLowerCase() : null;
}
