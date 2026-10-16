// REZERWA WYSOKOŚCI SEKCJI PULPITU - wspólna dla /admin i /admin/analytics/bi.
//
// DLACZEGO OSOBNY MODUŁ, a nie eksport z `AdminDashboard.tsx`. Sekcje ruchu
// i mapy stoją także w warsztacie BI (`TrafficGeoDashboard`), który jedzie we
// własnym, leniwym chunku. Import stałej z pliku pulpitu wciągnąłby do tego
// chunku cały kokpit (CRM, marketing, treść); stała trzymana osobno w każdym
// z dwóch miejsc rozjechałaby się przy pierwszym pomiarze. Ten plik nie ma
// zależności, więc kosztuje oba chunki kilka bajtów.

/**
 * REZERWA UKŁADU NA CZAS ODCZYTU, per sekcja, w pikselach.
 *
 * TO SĄ PRZYBLIŻENIA, i tak mają być czytane. Każda liczba jest sumą tego, co
 * dana sekcja deklaruje SAMA: wysokości wykresu podanej wprost w jej panelu
 * (`RealtimeStrip` 200, `TrafficPanel` 240, `CrmPanel` 220, `MarketingPanel` 200,
 * `AudiencePanel` 200), wiersza kafli KPI (~90 px) i chromu karty wykresu
 * (~60 px). Mapa (`GeoPanel`) nie ma stałej wysokości - rysuje się w proporcji
 * do szerokości kolumny - więc jej rezerwa jest oszacowaniem dla typowej
 * szerokości panelu.
 *
 * PO CO, skoro to nie jest dokładne: sekcja bez rezerwy rośnie z ~56 px (wiersz
 * migotki) do kilkuset i spycha w dół WSZYSTKIE następne. Sześć sekcji
 * rozstrzygających się niezależnie daje sześć takich przesunięć na jedno
 * wejście - to połowa CLS 0,532 zmierzonego na `/admin`. Rezerwa przybliżona
 * zbija ten wkład o rząd wielkości; rezerwa dokładna wymagałaby zamrożenia
 * wysokości paneli, czyli kontraktu, którego te panele nie mają i mieć nie
 * powinny (liczba kafli zależy od danych).
 */
export const SECTION_RESERVE_PX = {
  realtime: 320,
  traffic: 420,
  geo: 420,
  crm: 400,
  marketing: 380,
  audience: 380,
  content: 300,
} as const;
