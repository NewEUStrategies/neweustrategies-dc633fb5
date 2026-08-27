// Molekuła: KARTA PROFILU ZALOGOWANEGO WIDZA - góra lewej kolumny przeglądu.
//
// WZORZEC: docs/zrzuty/swapcard-2026-08-23/38-preview-event-home-desktop.png -
// w lewej kolumnie stoi karta z odnośnikiem „Edytuj” przy prawej krawędzi,
// pod nim wyśrodkowane zdjęcie, imię i nazwisko, stanowisko i organizacja.
// Odwzorowujemy ROZMIESZCZENIE i KOLEJNOŚĆ; krój, kolory i promień zdjęcia
// zostają nasze - `SpeakerAvatar` trzyma 6 px promienia, bo to jest spec
// produktu dla ZDJĘĆ PROFILOWYCH w tym repozytorium (patrz `ChatAvatar`),
// a okrąg ze zrzutu jest cechą tamtego systemu wizualnego, nie treścią.
//
// PO CO OSOBNA MOLEKUŁA, A NIE KARTA W TRASIE. Bo tę samą kartę musi narysować
// podgląd w studiu, a on nie może zamontować organizmu `EventViewerProfile`:
// tamten czyta TOŻSAMOŚĆ WOŁAJĄCEGO (`useAuth`) i wiersz `profiles`, czyli
// zapytanie, a do tego stawia `<Link>` do `/profile/edit`, który wyprowadziłby
// redaktora ze studia w trakcie edycji. Ten sam podział, co
// `EventTabsBar` / `EventTabsNav` i `EventSectionLinks` / `EventHomeSectionLinks`.
//
// PÓL, KTÓRYCH NIE MA, NIE ZGADUJEMY. Stanowisko (`profiles.job_title`)
// i organizacja (`profiles.current_company`) są w bazie opcjonalne, a puste
// linie w karcie czytają się jak uszkodzone dane, nie jak brak danych - więc
// każda linia istnieje tylko wtedy, gdy ma treść. Bez NAZWY karty nie ma
// wcale: sama fotografia z przyciskiem „Edytuj” nie mówi, czyj to profil,
// a rozstrzyga o tym wołający (patrz `EventViewerProfile`).
//
// ZERO HOOKÓW ROUTERA, ZERO ZAPYTAŃ I ZERO i18next: napisy i odnośnik wchodzą
// gotowe od wołającego - podgląd studia stoi poza drzewem tras, więc `<Link>`
// bez `RouterProvider` po prostu rzuca.
import type { ReactNode } from "react";

import { SpeakerAvatar } from "@/components/events/SpeakerAvatar";

export function EventViewerCard({
  name,
  jobTitle,
  company,
  avatarUrl,
  editSlot,
}: {
  /** Imię i nazwisko albo nazwa wyświetlana - bez niej karty nie ma. */
  name: string;
  /** `profiles.job_title`; pusty napis = linii nie ma. */
  jobTitle: string;
  /** `profiles.current_company`; pusty napis = linii nie ma. */
  company: string;
  /** `profiles.avatar_url`; puste = inicjały z `SpeakerAvatar`. */
  avatarUrl: string | null;
  /**
   * Odnośnik „Edytuj” - `<Link>` na stronie publicznej, `<span>` w podglądzie.
   *
   * SLOT, A NIE `href`: podgląd ma pokazać, ŻE ten odnośnik tam stoi, ale nie
   * może go uzbroić, bo klik wyprowadziłby redaktora ze studia z niezapisanym
   * szkicem w formularzu.
   */
  editSlot: ReactNode;
}) {
  return (
    <div
      data-testid="event-viewer-card"
      className="rounded-lg border border-border bg-card p-5 text-center"
    >
      {/* „Edytuj” stoi PRZY PRAWEJ KRAWĘDZI, nad zdjęciem - tak jak na wzorcu.
          Wiersz istnieje także wtedy, gdy slot jest pusty, bo inaczej zdjęcie
          skakałoby o wysokość napisu między podglądem i stroną. */}
      <div className="flex min-h-5 justify-end text-xs">{editSlot}</div>

      <div className="mt-1 flex justify-center">
        <SpeakerAvatar name={name} photoUrl={avatarUrl} size="xl" />
      </div>

      <p className="mt-4 text-base font-semibold text-foreground">{name}</p>
      {jobTitle === "" ? null : <p className="mt-1 text-sm text-muted-foreground">{jobTitle}</p>}
      {company === "" ? null : <p className="mt-0.5 text-sm text-muted-foreground">{company}</p>}
    </div>
  );
}
