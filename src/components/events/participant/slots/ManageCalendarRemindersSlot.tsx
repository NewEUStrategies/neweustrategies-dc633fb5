// GNIAZDO `ManageCalendarRemindersSlot` - samoobsługi zgłoszenia po kluczu - pod gniazdem toru B.
//
// WŁAŚCICIEL: tor A. Foundation montuje gniazdo w hoście i zostawia PUSTE
// (renderuje `null`), żeby host nie zmieniał się, gdy tor A dopisze treść:
// preferencje przypomnień po kluczu i menu kalendarza wydarzenia.
//
// Właściwości są zamrożone (`slotTypes.ts`); tor przepisuje ciało tego pliku
// i jego test (`__tests__/ManageCalendarRemindersSlot.test.tsx`), nigdy hosta.
import type { ManagePanelSlotProps } from "@/components/events/participant/slots/slotTypes";

export function ManageCalendarRemindersSlot(_props: ManagePanelSlotProps): null {
  return null;
}
