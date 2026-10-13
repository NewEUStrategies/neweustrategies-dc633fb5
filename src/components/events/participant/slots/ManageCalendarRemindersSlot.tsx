// GNIAZDO `ManageCalendarRemindersSlot` - samoobsługi zgłoszenia po kluczu - pod gniazdem toru B.
//
// WŁAŚCICIEL: tor A (przypomnienia, REG-09/REG-10). Gniazdo rysuje kartę
// preferencji przypomnień po KLUCZU z maila - to jedyna droga gościa bez
// konta do przypomnień i do zgody na SMS-y. Klucz jedzie wyłącznie w ładunku
// RPC; cache trzyma wpis pod identyfikatorem zgłoszenia z widoku. Bez klucza
// (strona otwarta bez linku) gniazdo jest puste. Miejsce na menu kalendarza
// wydarzenia (tor A) zostaje w tym samym kontenerze.
//
// Właściwości są zamrożone (`slotTypes.ts`); tor przepisuje ciało tego pliku
// i jego test (`__tests__/ManageCalendarRemindersSlot.test.tsx`), nigdy hosta.
import { ReminderPreferencesCard } from "@/components/events/participant/molecules/ReminderPreferencesCard";
import type { ManagePanelSlotProps } from "@/components/events/participant/slots/slotTypes";

const CLOSED_STATUSES: ReadonlySet<string> = new Set(["cancelled", "rejected"]);

export function ManageCalendarRemindersSlot({ token, view }: ManagePanelSlotProps) {
  if (token === null || CLOSED_STATUSES.has(view.status)) return null;
  return (
    <div className="space-y-3">
      <ReminderPreferencesCard registrationId={view.registrationId} manageToken={token} />
    </div>
  );
}
