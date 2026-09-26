// GNIAZDO `RegistrationCardActionsSlot` - karty zgłoszenia w „Moich zgłoszeniach” - pod sekcją płatności.
//
// WŁAŚCICIEL: tor B. Foundation montuje gniazdo w hoście i zostawia PUSTE
// (renderuje `null`), żeby host nie zmieniał się, gdy tor B dopisze treść:
// oferta z listy rezerwowej, przekazanie biletu i samodzielny zwrot (treść leniwa).
//
// Właściwości są zamrożone (`slotTypes.ts`); tor przepisuje ciało tego pliku
// i jego test (`__tests__/RegistrationCardActionsSlot.test.tsx`), nigdy hosta.
import type { RegistrationCardSlotProps } from "@/components/events/participant/slots/slotTypes";

export function RegistrationCardActionsSlot(_props: RegistrationCardSlotProps): null {
  return null;
}
