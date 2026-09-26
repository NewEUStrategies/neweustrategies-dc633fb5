// GNIAZDO `ManageTicketActionsSlot` - samoobsługi zgłoszenia po kluczu - pod kartą stanu zgłoszenia.
//
// WŁAŚCICIEL: tor B. Foundation montuje gniazdo w hoście i zostawia PUSTE
// (renderuje `null`), żeby host nie zmieniał się, gdy tor B dopisze treść:
// przekazanie biletu i samodzielny zwrot dla gościa z kluczem (treść leniwa).
//
// Właściwości są zamrożone (`slotTypes.ts`); tor przepisuje ciało tego pliku
// i jego test (`__tests__/ManageTicketActionsSlot.test.tsx`), nigdy hosta.
import type { ManagePanelSlotProps } from "@/components/events/participant/slots/slotTypes";

export function ManageTicketActionsSlot(_props: ManagePanelSlotProps): null {
  return null;
}
