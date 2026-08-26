// Adres strukturalny wydarzenia - jedna linia i odnośnik do map.
//
// DLACZEGO OSOBNY MODUŁ, A NIE FUNKCJA W `eventGeneralDraft`. Ten sam adres
// składa się w TRZECH miejscach: w podglądzie panelu (szkic formularza), na
// publicznej stronie wydarzenia (wiersz z bazy) i w `schema.org/Event`
// (PostalAddress dla robota). Dopóki reguła siedziała w module wersji roboczej,
// front musiał albo zbudować atrapę szkicu z wiersza, albo skleić adres
// po swojemu - a dwa sklejenia tego samego adresu rozjeżdżają się przy
// pierwszym wydarzeniu bez kodu pocztowego.
//
// KSZTAŁT WEJŚCIA JEST LUŹNY CELOWO. Pola są opcjonalne i przyjmują `null`,
// bo kolumny `events.street_address`, `city`, `region`, `postal_code`
// i `country` są nullowalne, a szkic panelu trzyma w tych samych polach pusty
// napis. Jedna konwencja nazw (camelCase) i jedno traktowanie pustki znaczy,
// że i szkic, i wiersz przechodzą tą samą ścieżką bez adaptera.
//
// GRANICA WARSTW: zero Reacta, zero i18next, zero klienta bazy.

/** Człony adresu. Brak pola = „nie podano", dokładnie jak pusty napis. */
export interface EventAddressParts {
  streetAddress?: string | null;
  postalCode?: string | null;
  city?: string | null;
  region?: string | null;
  country?: string | null;
}

function part(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Adres strukturalny w jednej linii - podgląd panelu, strona wydarzenia
 * i `schema.org/Event`.
 *
 * KOD POCZTOWY I MIASTO SĄ JEDNYM CZŁONEM („00-001 Warszawa"), bo tak zapisuje
 * się je na kopercie w każdym kraju, w którym działa serwis. Rozdzielone
 * przecinkiem dałyby „00-001, Warszawa" - poprawne dla maszyny, nieczytelne
 * dla człowieka.
 */
export function eventAddressLine(parts: EventAddressParts): string {
  const cityLine = [part(parts.postalCode), part(parts.city)].filter((p) => p !== "").join(" ");
  return [part(parts.streetAddress), cityLine, part(parts.region), part(parts.country)]
    .filter((segment) => segment !== "")
    .join(", ");
}

/**
 * Odnośnik „pokaż na mapie" albo `null`, gdy adresu nie ma.
 *
 * ZAPYTANIE, NIE WSPÓŁRZĘDNE. Nie mamy geokodowania i nie chcemy go mieć dla
 * jednego odnośnika: `?api=1&query=` jest udokumentowanym kontraktem Google
 * Maps, w którym adres tekstowy jest pełnoprawnym wejściem. Adres przechodzi
 * przez `encodeURIComponent`, więc przecinki i polskie znaki nie rozjeżdżają
 * parametru - a `null` przy pustym adresie oznacza „nie rysuj odnośnika",
 * zamiast prowadzić uczestnika do wyszukiwania pustego napisu.
 */
export function eventMapUrl(parts: EventAddressParts): string | null {
  const line = eventAddressLine(parts);
  if (line === "") return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(line)}`;
}
