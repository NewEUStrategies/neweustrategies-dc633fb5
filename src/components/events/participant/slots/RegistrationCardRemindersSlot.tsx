// GNIAZDO `RegistrationCardRemindersSlot` - karty zgłoszenia w „Moich zgłoszeniach” - pod sekcją kanałów.
//
// WŁAŚCICIEL: tor A. Foundation montuje gniazdo w hoście i zostawia PUSTE
// (renderuje `null`), żeby host nie zmieniał się, gdy tor A dopisze treść:
// karta preferencji przypomnień (zwinięta, pobierana po rozwinięciu).
//
// Właściwości są zamrożone (`slotTypes.ts`); tor przepisuje ciało tego pliku
// i jego test (`__tests__/RegistrationCardRemindersSlot.test.tsx`), nigdy hosta.
import type { RegistrationCardSlotProps } from "@/components/events/participant/slots/slotTypes";

export function RegistrationCardRemindersSlot(_props: RegistrationCardSlotProps): null {
  return null;
}
