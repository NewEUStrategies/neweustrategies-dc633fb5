// GNIAZDO `RegistrationCardFollowUpSlot` - karty zgłoszenia w „Moich zgłoszeniach” - nad dziennikiem płatności.
//
// WŁAŚCICIEL: tor C. Foundation montuje gniazdo w hoście i zostawia PUSTE
// (renderuje `null`), żeby host nie zmieniał się, gdy tor C dopisze treść:
// skrót ankiety i certyfikatu z jednego wspólnego zapytania dla wszystkich kart.
//
// Właściwości są zamrożone (`slotTypes.ts`); tor przepisuje ciało tego pliku
// i jego test (`__tests__/RegistrationCardFollowUpSlot.test.tsx`), nigdy hosta.
import type { RegistrationCardSlotProps } from "@/components/events/participant/slots/slotTypes";

export function RegistrationCardFollowUpSlot(_props: RegistrationCardSlotProps): null {
  return null;
}
