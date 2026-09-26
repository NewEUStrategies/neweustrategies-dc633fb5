// Słownik przycisków „Dodaj do portfela” (Apple Wallet / Google Wallet), PL/EN.
//
// OSOBNY, MAŁY PLIK. Czytają go strona biletu (`EventTicketCodePanel`
// -> `TicketWalletButtons`) i lista zgłoszeń w profilu (podpowiedź, skąd
// dodać przepustkę). Obie są publiczne, więc nakładka nie może ciągnąć
// słownika panelu ani całego zapisu na wydarzenie.
//
// Napisy NA PRZEPUSTCE nie mieszkają tutaj: przepustkę składa serwer, a język
// jest parametrem żądania (`lib/events/wallet/walletCopy.ts`). Ten plik mówi
// wyłącznie do uczestnika na stronie.
//
// Kody błędów odpowiadają kodom tras `/api/public/events/wallet/*`
// (`lib/events/wallet/walletRoutes.server.ts`), a mapuje je
// `lib/events/ticketWallet.ts` przez `Record` z pełnymi kluczami.
import i18n from "@/lib/i18n";

export const eventWalletPl = {
  eventWallet: {
    title: "Dodaj bilet do portfela",
    lead: "Przepustka w telefonie pokaże ten sam kod QR przy wejściu - także bez internetu.",
    apple: {
      prefix: "Dodaj do",
      name: "Apple Wallet",
    },
    google: {
      prefix: "Dodaj do",
      name: "Google Wallet",
    },
    working: "Przygotowujemy przepustkę…",
    unavailable:
      "Dodanie biletu do portfela jest chwilowo niedostępne. Kod QR powyżej działa bez zmian.",
    errors: {
      notFound:
        "Tego biletu nie da się dodać do portfela - zgłoszenie mogło zostać anulowane albo kod jest nieaktualny.",
      rateLimited: "Zbyt wiele prób w krótkim czasie. Spróbuj ponownie za kilka minut.",
      unavailable: "Dodanie do portfela jest chwilowo niedostępne.",
      generic: "Nie udało się przygotować przepustki. Spróbuj ponownie.",
    },
    profileHint:
      "Przepustkę do Apple Wallet lub Google Wallet dodasz ze strony biletu - otwórz link z maila z biletem.",
  },
} as const;

export const eventWalletEn = {
  eventWallet: {
    title: "Add the ticket to your wallet",
    lead: "The pass on your phone shows the same QR code at the entrance - even offline.",
    apple: {
      prefix: "Add to",
      name: "Apple Wallet",
    },
    google: {
      prefix: "Add to",
      name: "Google Wallet",
    },
    working: "Preparing your pass…",
    unavailable:
      "Adding the ticket to a wallet is temporarily unavailable. The QR code above still works.",
    errors: {
      notFound:
        "This ticket cannot be added to a wallet - the registration may have been cancelled or the code is out of date.",
      rateLimited: "Too many attempts in a short time. Please try again in a few minutes.",
      unavailable: "Adding to a wallet is temporarily unavailable.",
      generic: "The pass could not be prepared. Please try again.",
    },
    profileHint:
      "You can add an Apple Wallet or Google Wallet pass from the ticket page - open the link in your ticket e-mail.",
  },
} as const;

i18n.addResourceBundle("pl", "translation", eventWalletPl, true, true);
i18n.addResourceBundle("en", "translation", eventWalletEn, true, true);

/** Sam import już rejestruje słownik; wywołanie zostaje dla czytelności miejsc użycia. */
export function ensureEventWalletI18n(): void {}
