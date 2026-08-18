// Serializowalna treść dokumentu prawnego (ikony jako nazwy, nie komponenty).
// Jedno źródło prawdy dla publicznej strony oraz dla wersjonowania w /admin.
import type { LegalDocContent } from "../types";
import { REFUNDS_META } from "../meta";
import {
  LEGAL_CONTACT_EMAIL,
  LEGAL_ENTITY,
  LEGAL_UPDATED,
  PAYMENT_PROVIDER_DISCLOSURE,
  PAYMENT_PROVIDER_NAME,
  REFUND_WINDOW_DAYS,
} from "@/lib/legal/entity";

export const REFUNDS_CONTENT: LegalDocContent = {
  pl: {
    eyebrow: "Zwroty",
    // Tytuł + lead żyją w ../meta.ts (head() tras czyta je bez pełnej treści).
    ...REFUNDS_META.pl,
    updated: `Ostatnia aktualizacja: ${LEGAL_UPDATED}`,
    footnote: `Politykę prowadzi ${LEGAL_ENTITY}. Nie stosujemy zapisów typu "sprzedaż ostateczna" - Twoje prawa konsumenckie pozostają nienaruszone.`,
    sections: [
      {
        id: "gwarancja",
        icon: "CalendarClock",
        heading: `Gwarancja ${REFUND_WINDOW_DAYS} dni`,
        paragraphs: [
          `Jeśli zakup nie spełnia Twoich oczekiwań, możesz poprosić o pełny zwrot w ciągu ${REFUND_WINDOW_DAYS} dni od daty zamówienia. Nie musisz podawać przyczyny.`,
          "Dotyczy to subskrypcji indywidualnych i zespołowych, dostępów jednorazowych do treści oraz biletów na wydarzenia płatne (z zastrzeżeniem terminu wydarzenia opisanego niżej).",
        ],
      },
      {
        id: "jak",
        icon: "Send",
        heading: "Jak złożyć wniosek",
        bullets: [
          `Napisz do nas na ${LEGAL_CONTACT_EMAIL}, podając numer transakcji z maila potwierdzającego - to nasz jedyny kanał zgłoszeń zwrotów.`,
          `Zgłoszenie przekazujemy do rozliczenia naszemu operatorowi płatności, ${PAYMENT_PROVIDER_NAME}, który technicznie realizuje zwrot środków.`,
          "Wnioski rozpatrujemy zwykle w 1-2 dni robocze.",
        ],
      },
      {
        id: "zwrot-srodkow",
        icon: "Wallet",
        heading: "Kiedy otrzymasz pieniądze",
        paragraphs: [
          "Po zatwierdzeniu zwrotu środki wracają tą samą metodą płatności, którą wykonano zakup. Zaksięgowanie po stronie banku lub operatora karty trwa zwykle 3-10 dni roboczych.",
          "Po zwrocie dostęp do treści premium wygasa, a subskrypcja nie odnawia się dalej.",
        ],
      },
      {
        id: "subskrypcje",
        icon: "RotateCcw",
        heading: "Anulowanie subskrypcji",
        paragraphs: [
          "Subskrypcję możesz anulować w każdej chwili w portalu klienta. Anulowanie zatrzymuje kolejne odnowienia, a dostęp zachowujesz do końca opłaconego okresu.",
          `Jeśli odnowienie nastąpiło przez pomyłkę, zgłoś to w ciągu ${REFUND_WINDOW_DAYS} dni - zwracamy opłatę za nowy okres.`,
        ],
      },
      {
        id: "bilety",
        icon: "Ticket",
        heading: "Bilety na wydarzenia",
        bullets: [
          "Bilet możesz zwrócić do 7 dni przed datą wydarzenia lub w ciągu 30 dni od zakupu - liczy się termin, który upływa wcześniej.",
          "Jeśli wydarzenie zostanie odwołane lub przeniesione, zwracamy pełną kwotę automatycznie, bez wniosku.",
        ],
      },
      {
        id: "darowizny",
        icon: "HeartHandshake",
        heading: "Darowizny",
        paragraphs: [
          "Darowizny zbieramy w zewnętrznym serwisie zbiórkowym (zrzutka.pl) - nie przechodzą przez operatora płatności Serwisu. Są dobrowolne i bezzwrotne z natury, ale jeśli wpłata była pomyłkowa lub w błędnej kwocie, skontaktuj się z nami w ciągu 30 dni - pomożemy ją odzyskać zgodnie z zasadami serwisu zbiórkowego.",
        ],
      },
      {
        id: "reklamacje",
        icon: "MessageSquareWarning",
        heading: "Reklamacje jakościowe",
        paragraphs: [
          `Jeśli usługa działa nieprawidłowo, opisz problem na ${LEGAL_CONTACT_EMAIL}. Odpowiadamy w ciągu 14 dni. W przypadku dłuższej awarii uniemożliwiającej korzystanie z subskrypcji przedłużamy okres dostępu lub zwracamy proporcjonalną część opłaty.`,
        ],
      },
      {
        id: "payment-provider",
        icon: "Store",
        heading: "Kto obsługuje zwroty",
        paragraphs: [
          PAYMENT_PROVIDER_DISCLOSURE.pl,
          `Zgłoszenia przyjmujemy pod adresem ${LEGAL_CONTACT_EMAIL}; techniczne rozliczenie zwrotu (w tym termin ${REFUND_WINDOW_DAYS} dni) realizuje nasz operator płatności.`,
        ],
      },
    ],
  },
  en: {
    eyebrow: "Refunds",
    ...REFUNDS_META.en,
    updated: `Last updated: ${LEGAL_UPDATED}`,
    footnote: `This policy is maintained by ${LEGAL_ENTITY}. We do not use "all sales final" clauses - your statutory consumer rights are unaffected.`,
    sections: [
      {
        id: "gwarancja",
        icon: "CalendarClock",
        heading: `${REFUND_WINDOW_DAYS}-day guarantee`,
        paragraphs: [
          `If your purchase does not meet your expectations, you can request a full refund within ${REFUND_WINDOW_DAYS} days of the order date. No reason required.`,
          "This covers individual and team subscriptions, one-off content access and paid event tickets (subject to the event deadline described below).",
        ],
      },
      {
        id: "jak",
        icon: "Send",
        heading: "How to request a refund",
        bullets: [
          `Write to ${LEGAL_CONTACT_EMAIL} with the transaction number from your confirmation email - this is our only refund request channel.`,
          `We forward the request to our payment provider, ${PAYMENT_PROVIDER_NAME}, which technically processes the refund.`,
          "Requests are usually processed within 1-2 business days.",
        ],
      },
      {
        id: "zwrot-srodkow",
        icon: "Wallet",
        heading: "When you get your money",
        paragraphs: [
          "Once approved, the refund goes back to the original payment method. Banks and card issuers typically post it within 3-10 business days.",
          "After a refund, premium access ends and the subscription does not renew.",
        ],
      },
      {
        id: "subskrypcje",
        icon: "RotateCcw",
        heading: "Cancelling a subscription",
        paragraphs: [
          "You can cancel at any time in the customer portal. Cancelling stops future renewals and access continues until the end of the paid period.",
          `If a renewal was charged by mistake, tell us within ${REFUND_WINDOW_DAYS} days and we refund the new period.`,
        ],
      },
      {
        id: "bilety",
        icon: "Ticket",
        heading: "Event tickets",
        bullets: [
          "Tickets can be refunded up to 7 days before the event or within 30 days of purchase - whichever comes first.",
          "If an event is cancelled or rescheduled, we refund the full amount automatically, no request needed.",
        ],
      },
      {
        id: "darowizny",
        icon: "HeartHandshake",
        heading: "Donations",
        paragraphs: [
          "Donations are collected on an external fundraising platform (zrzutka.pl) - they do not pass through the service's payment provider. They are voluntary and non-returnable by nature, but if a payment was made by mistake or for a wrong amount, contact us within 30 days and we will help you recover it under the fundraising platform's rules.",
        ],
      },
      {
        id: "reklamacje",
        icon: "MessageSquareWarning",
        heading: "Service complaints",
        paragraphs: [
          `If the service does not work as expected, describe the problem at ${LEGAL_CONTACT_EMAIL}. We answer within 14 days. For prolonged outages that prevent use of a subscription we extend the access period or refund a pro-rated amount.`,
        ],
      },
      {
        id: "payment-provider",
        icon: "Store",
        heading: "Who handles refunds",
        paragraphs: [
          PAYMENT_PROVIDER_DISCLOSURE.en,
          `Send requests to ${LEGAL_CONTACT_EMAIL}; the technical settlement of the refund (including the ${REFUND_WINDOW_DAYS}-day window) is carried out by our payment provider.`,
        ],
      },
    ],
  },
};
