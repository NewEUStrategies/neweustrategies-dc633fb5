// KONTRAKT GNIAZD (slotów) powierzchni uczestnika - funkcje F1-F5.
//
// PO CO GNIAZDA. Trzy tory (A: plan i przypomnienia, B: oferty, przekazanie,
// zwrot, C: ankieta i certyfikat) dokładają UI do tych samych trzech
// organizmów: panelu „Moje" (`EventMePanel`), karty zgłoszenia w „Moich
// zgłoszeniach" (`ParticipantTicketsPanel`) i samoobsługi po kluczu
// (`RegistrationManagePanel`). Gdyby każdy tor edytował te pliki, scalenie
// trzech gałęzi byłoby konfliktem w każdym z nich. Foundation montuje więc
// w organizmach PUSTE gniazda, a każdy tor przepisuje WYŁĄCZNIE swój plik
// gniazda.
//
// WŁAŚCIWOŚCI SĄ ZAMROŻONE (spec B.11). Tor może w swoim gnieździe robić,
// co chce, ale nie zmienia tych trzech interfejsów - host przekazuje je
// dokładnie w tym kształcie, a testy hosta przypinają właśnie te właściwości.
//
// Plik czysto typowy: bez progu pokrycia (nie ma czego wykonać).
import type { EventParticipantOptions } from "@/lib/events/participantOptionsApi";
import type { MyEventRegistrationState } from "@/lib/events/myEventProfileApi";
import type { ParticipantRegistration } from "@/lib/events/participantTicketsApi";
import type { RegistrationManageView } from "@/lib/events/publicRegistrationApi";

/** Zgłoszenie wołającego na TYM wydarzeniu, tak jak widzi je panel „Moje". */
export type MyEventRegistrationSummary = MyEventRegistrationState;

/** Gniazda panelu „Moje" (`/events/<slug>/me`): harmonogram i „Po wydarzeniu". */
export interface EventMeSlotProps {
  slug: string;
  /** `null`, gdy konto nie ma zgłoszenia na to wydarzenie (albo jeszcze się wczytuje). */
  registration: MyEventRegistrationSummary | null;
  /** Publiczne flagi funkcji (`event_participant_options`); `null` dopóki nie przyszły. */
  options: EventParticipantOptions | null;
}

/** Gniazda karty zgłoszenia w „Moich zgłoszeniach" (`/profile/tickets`, zakładka biletów). */
export interface RegistrationCardSlotProps {
  item: ParticipantRegistration;
}

/** Gniazda samoobsługi zgłoszenia po kluczu (`/events/<slug>/manage`). */
export interface ManagePanelSlotProps {
  slug: string;
  /** Aktywny klucz `manage_token` (z adresu albo wklejony); `null` bez klucza. */
  token: string | null;
  view: RegistrationManageView;
}
