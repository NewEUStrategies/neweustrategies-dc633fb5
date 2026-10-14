// GNIAZDO `RegistrationCardRemindersSlot` - karty zgłoszenia w „Moich zgłoszeniach” - pod sekcją kanałów.
//
// WŁAŚCICIEL: tor A (przypomnienia, REG-09/REG-10). Gniazdo rysuje kartę
// preferencji przypomnień (zwiniętą, pobieraną po rozwinięciu) po
// identyfikatorze zgłoszenia - właściciel jest zalogowany, więc RPC
// rozpoznaje go po sesji. Zgłoszenie zamknięte (odwołane, odrzucone) nie ma
// czego przypominać, więc gniazdo zostaje puste.
//
// Właściwości są zamrożone (`slotTypes.ts`); tor przepisuje ciało tego pliku
// i jego test (`__tests__/RegistrationCardRemindersSlot.test.tsx`), nigdy hosta.
import { ReminderPreferencesCard } from "@/components/events/participant/molecules/ReminderPreferencesCard";
import type { RegistrationCardSlotProps } from "@/components/events/participant/slots/slotTypes";

const CLOSED_STATUSES: ReadonlySet<string> = new Set(["cancelled", "rejected"]);

export function RegistrationCardRemindersSlot({ item }: RegistrationCardSlotProps) {
  if (CLOSED_STATUSES.has(item.status)) return null;
  return <ReminderPreferencesCard registrationId={item.registrationId} />;
}
