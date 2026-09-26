// GNIAZDO `ManageFollowUpSlot` - samoobsługi zgłoszenia po kluczu - pod gniazdem toru A.
//
// WŁAŚCICIEL: tor C. Foundation montuje gniazdo w hoście i zostawia PUSTE
// (renderuje `null`), żeby host nie zmieniał się, gdy tor C dopisze treść:
// ankieta i certyfikat dla gościa z kluczem.
//
// Właściwości są zamrożone (`slotTypes.ts`); tor przepisuje ciało tego pliku
// i jego test (`__tests__/ManageFollowUpSlot.test.tsx`), nigdy hosta.
import type { ManagePanelSlotProps } from "@/components/events/participant/slots/slotTypes";

export function ManageFollowUpSlot(_props: ManagePanelSlotProps): null {
  return null;
}
