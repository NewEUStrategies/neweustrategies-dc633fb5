// Organizm: SIATKA PRZEGLĄDU WYDARZENIA - trzy kolumny, jedno źródło rysunku.
//
// UKŁAD JEST ZMIERZONY, NIE ZGADNIĘTY. Zrzut wzorca
// `docs/zrzuty/swapcard-2026-08-23/38-preview-event-home-desktop.png`: kolumny
// mają 483 / 963 / 481 pikseli obrazu przy rynnach po 39 - czyli 1 : 2 : 1
// z rynną 20 punktów logicznych, a cała treść ma ~1000 punktów. Stąd
// `max-w-5xl` (1024, przez `EVENT_PORTAL_CONTENT_CLASS`) i
// `grid-cols-[1fr_2fr_1fr] gap-5`: kolumna środkowa wychodzi 492 punkty przy
// zmierzonych 481. TYCH PROPORCJI NIE WOLNO ZMIENIAĆ „na oko”.
//
// PO CO OSOBNY KOMPONENT NA SIATKĘ. Bo była tylko w trasie, a podgląd w studiu
// rysował na tym samym ekranie JEDNĄ kolumnę `max-w-3xl` - i to właśnie zobaczył
// właściciel („nadal jest stary layout”). Dopóki siatka mieszkała w pliku trasy,
// jedynym sposobem pokazania jej w panelu było przepisanie jej tam drugi raz.
//
// KOLEJNOŚĆ W DOM-ie NIE JEST KOLEJNOŚCIĄ NA EKRANIE i to jest celowe: kolumna
// ŚRODKOWA idzie pierwsza (czytnik ekranu i crawler czytają dokument, nie
// siatkę), potem PRAWA (decyzja uczestnika), a LEWA - która na szerokim ekranie
// stoi pierwsza - jest w dokumencie ostatnia. Na telefonie siatka zwija się do
// jednej kolumny i wtedy kolejność dokumentu jest jedyną, jaka istnieje: tytuł,
// potem zapisy, potem szczegóły. Pozycje wymuszają `lg:col-start-*`, więc
// kolejność wizualna nie zależy od kolejności w kodzie.
//
// CZEGO W KOLUMNACH BOCZNYCH NIE ODWZOROWUJEMY I DLACZEGO. Na wzorcu po lewej
// stoi KARTA PROFILU ZALOGOWANEGO WIDZA („Edytuj”, zdjęcie, stanowisko), a po
// prawej BANER PROMOCYJNY z przyciskiem „Dowiedz się więcej”. Nie mamy źródła
// danych ani dla jednego, ani dla drugiego, a wypełnienie kolumny atrapą
// opublikowałoby treść, której nikt nie wpisał. Zamiast tego kolumny biorą to,
// co ma dane i po co czytelnik tu przychodzi: po lewej karta „kiedy, gdzie, ile
// miejsc”, po prawej powierzchnia zapisów. To jest ZAMIENNIK, nie odwzorowanie
// wzorca - jeśli kiedyś powstanie źródło banera, jego miejsce jest po prawej.
//
// ZERO HOOKÓW ROUTERA I ZERO ZAPYTAŃ: treść kolumn wnosi wołający, bo podgląd
// studia wnosi ją ze szkicu formularza, a strona publiczna z bazy.
import type { ReactNode } from "react";

import { EVENT_PORTAL_CONTENT_CLASS } from "@/components/events/public/atoms/EventPortalContent";

export function EventOverviewLayout({
  main,
  left,
  right,
}: {
  /** Kolumna środkowa: okładka, tytuł, opis, sekcje treści. */
  main: ReactNode;
  /** Kolumna lewa: „co, kiedy, gdzie”. */
  left: ReactNode;
  /** Kolumna prawa: decyzja uczestnika (zapis, bilet, kalendarz). */
  right: ReactNode;
}) {
  return (
    <article className={EVENT_PORTAL_CONTENT_CLASS} data-testid="event-overview-layout">
      <div className="grid gap-5 lg:grid-cols-[1fr_2fr_1fr]">
        <div className="min-w-0 lg:col-start-2 lg:row-start-1">{main}</div>
        <aside className="min-w-0 space-y-3 lg:col-start-3 lg:row-start-1">{right}</aside>
        <aside className="min-w-0 space-y-4 lg:col-start-1 lg:row-start-1">{left}</aside>
      </div>
    </article>
  );
}

/**
 * Tytuł wydarzenia na przeglądzie - JEDYNY `h1` tej strony.
 *
 * PO CO KOMPONENT NA JEDEN NAGŁÓWEK. Bo to jest zmierzony rozjazd, nie hipoteza:
 * trasa miała `text-3xl`, podgląd studia `text-4xl`. Nikt tego nie zauważył, bo
 * dwa niezależne rysunki nie mają jak się o to pokłócić.
 */
export function EventOverviewTitle({ children }: { children: ReactNode }) {
  return <h1 className="mt-3 text-3xl font-bold tracking-tight">{children}</h1>;
}

/**
 * Opis wydarzenia - blok `prose` kolumny środkowej.
 *
 * TEN SAM POWÓD, CO PRZY TYTULE: literał klas stał w trasie i w podglądzie
 * studia, więc pierwsza zmiana typografii opisu rozjechałaby oba rysunki.
 * `whitespace-pre-line`, bo opis jest zwykłym tekstem z panelu (akapity to
 * znaki nowej linii), a nie dokumentem buildera.
 */
export function EventOverviewDescription({ children }: { children: ReactNode }) {
  return (
    <div className="prose prose-neutral mt-8 max-w-none whitespace-pre-line dark:prose-invert">
      {children}
    </div>
  );
}
