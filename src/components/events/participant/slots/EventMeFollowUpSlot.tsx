// GNIAZDO `EventMeFollowUpSlot` - panelu „Moje” - zakładka „Po wydarzeniu” (`?tab=follow-up`).
//
// WŁAŚCICIEL: tor C. Foundation montuje gniazdo w hoście i zostawia PUSTE
// (renderuje `null`), żeby host nie zmieniał się, gdy tor C dopisze treść:
// ankieta po wydarzeniu i certyfikat (`MyFollowUpPanel`, ładowany leniwie).
//
// Właściwości są zamrożone (`slotTypes.ts`); tor przepisuje ciało tego pliku
// i jego test (`__tests__/EventMeFollowUpSlot.test.tsx`), nigdy hosta.
//
// Host renderuje TREŚĆ zakładki dla `?tab=follow-up` także wtedy, gdy flagi
// wydarzenia jeszcze się wczytują (MIN-16); przycisk zakładki pokazuje dopiero
// przy `options.certificateEnabled || options.surveyEnabled`.
import type { EventMeSlotProps } from "@/components/events/participant/slots/slotTypes";

export function EventMeFollowUpSlot(_props: EventMeSlotProps): null {
  return null;
}
