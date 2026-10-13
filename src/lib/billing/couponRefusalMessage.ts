// Odmowa kodu rabatowego na bilet -> klucz zdania dla kupującego.
//
// WSPÓLNE DLA OBU KAS BILETU: molekuły zgłoszenia (`RegistrationPayAction`)
// i zakupu z karty wydarzenia (`EventTicketPurchase`). Kod, który nie łączy się
// z obecną promocją biletu (`coupon_not_combinable`, TIX-13a), albo zostawiłby
// kwotę poniżej minimum operatora (`final_amount_too_low`) dostaje własne
// zdanie - ogólne „kod nie obejmuje tego biletu" byłoby w obu przypadkach
// nieprawdą. Pozostałe odmowy (nieznany, wygasły, wyczerpany kod, inny bilet)
// mówią zdaniem ogólnym, bo kupujący i tak robi to samo: poprawia albo usuwa kod.

export function couponRefusalMessageKey(error: string | null | undefined): string {
  if (error === "coupon_not_combinable") return "eventRegistration.payment.promoNotCombinable";
  if (error === "final_amount_too_low") return "eventRegistration.payment.promoTooLow";
  return "eventRegistration.payment.promoError";
}
