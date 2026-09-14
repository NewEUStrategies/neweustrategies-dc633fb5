// Serializowalna treść dokumentu prawnego (ikony jako nazwy, nie komponenty).
// Jedno źródło prawdy dla publicznej strony oraz dla wersjonowania w /admin.
//
// ZAKRES: WARSTWA HANDLOWA. Regulamin (/regulamin) opisuje umowę o świadczenie
// usług drogą elektroniczną w ogóle; ten dokument opisuje PIENIĄDZE - plany,
// okresy, odnowienia, bilety, faktury i prawo odstąpienia.
//
// DLACZEGO PRAWO ODSTĄPIENIA MA TU TRZY RÓŻNE ODPOWIEDZI, A NIE JEDNĄ.
// Konsument kupujący subskrypcję, konsument kupujący bilet na wydarzenie
// z oznaczoną datą i konsument pobierający treść cyfrową podlegają TRZEM
// różnym reżimom ustawy o prawach konsumenta. Sklejenie ich w jedno zdanie
// („masz 14 dni”) jest nieprawdziwe w dwóch przypadkach na trzy, a różnica jest
// niekorzystna dla kupującego akurat tam, gdzie kwoty są największe.
import type { LegalDocContent } from "../types";
import { SUBSCRIPTIONS_META } from "../meta";
import {
  COMPLIANCE_PACK_UPDATED,
  LEGAL_CONTACT_EMAIL,
  LEGAL_ENTITY_FULL,
  PAYMENT_PROVIDER_DISCLOSURE,
  PAYMENT_PROVIDER_NAME,
  PAYMENT_PROVIDER_STATEMENT_DESCRIPTOR,
  REFUND_WINDOW_DAYS,
} from "@/lib/legal/entity";

export const SUBSCRIPTIONS_CONTENT: LegalDocContent = {
  pl: {
    eyebrow: "Zakupy",
    ...SUBSCRIPTIONS_META.pl,
    updated: `Ostatnia aktualizacja: ${COMPLIANCE_PACK_UPDATED}`,
    footnote: `Dokument uzupełnia regulamin serwisu (/regulamin) i politykę zwrotów (/zwroty-i-reklamacje). W razie rozbieżności w sprawach zwrotów pierwszeństwo ma polityka zwrotów.`,
    sections: [
      {
        id: "sprzedawca",
        icon: "Store",
        heading: "Kto jest sprzedawcą",
        paragraphs: [
          `Sprzedawcą i stroną umowy jest ${LEGAL_ENTITY_FULL} - pełne dane rejestrowe znajdziesz na stronie statutu (/statut).`,
          PAYMENT_PROVIDER_DISCLOSURE.pl,
        ],
      },
      {
        id: "plany",
        icon: "CreditCard",
        heading: "Plany i okresy rozliczeniowe",
        bullets: [
          "Oferujemy plany w kilku okresach rozliczeniowych - dwutygodniowym, miesięcznym, kwartalnym i rocznym - oraz zakupy jednorazowe (bilety, dostępy czasowe, materiały).",
          "Cena, okres rozliczeniowy i zakres uprawnień każdego planu są prezentowane na stronie cennika przed zawarciem umowy. Wiążąca jest cena widoczna w podsumowaniu zamówienia.",
          "Ceny podajemy wraz z informacją o podatku. Podatek właściwy dla Twojej jurysdykcji nalicza i rozlicza operator płatności; ostateczna kwota jest widoczna przed potwierdzeniem zakupu.",
          "Jeżeli plan obejmuje okres próbny, jego długość i moment pierwszego obciążenia są podane przed zakupem. Brak informacji o okresie próbnym oznacza, że plan go nie ma.",
          "Zmiana planu na wyższy działa od razu; różnicę rozliczamy proporcjonalnie. Zmiana na niższy działa od początku kolejnego okresu rozliczeniowego - nie skracamy dostępu, za który już zapłaciłeś.",
        ],
      },
      {
        id: "odnowienia",
        icon: "RotateCcw",
        heading: "Odnowienia i anulowanie",
        paragraphs: [
          "Subskrypcje odnawiają się automatycznie na kolejny okres rozliczeniowy, dopóki ich nie anulujesz. Mówimy o tym wprost przed zakupem, a nie dopiero w regulaminie.",
        ],
        bullets: [
          "Anulowanie uruchomisz samodzielnie w ustawieniach subskrypcji - bez kontaktu z obsługą i bez podawania powodu.",
          "Anulowanie działa na koniec bieżącego okresu. Zachowujesz dostęp do dnia, do którego zapłaciłeś - nie odbieramy go w chwili kliknięcia.",
          "Nieudane obciążenie nie kończy subskrypcji natychmiast: operator płatności ponawia próbę, a my informujemy Cię o konieczności aktualizacji metody płatności. Po wyczerpaniu prób dostęp wygasa.",
          "Zamknięcie konta zamyka także otwarte subskrypcje. Nie zostawiamy aktywnego obciążenia po usunięciu konta.",
        ],
      },
      {
        id: "zmiana-ceny",
        icon: "Megaphone",
        heading: "Zmiana ceny lub warunków",
        bullets: [
          "O zmianie ceny subskrypcji odnawialnej informujemy z wyprzedzeniem co najmniej 30 dni przed dniem, w którym nowa cena miałaby zostać pobrana.",
          "Zawiadomienie wysyłamy na adres przypisany do konta. Jest to wiadomość serwisowa - dostaniesz ją niezależnie od zgód marketingowych.",
          "Nowa cena obowiązuje dopiero od kolejnego okresu rozliczeniowego. Do tego czasu możesz anulować subskrypcję bez żadnych konsekwencji, a anulowanie przed datą odnowienia oznacza, że nowa cena nigdy Cię nie obciąży.",
          "Obniżki i promocje nie działają wstecz: nie rekompensujemy różnicy osobom, które kupiły wcześniej w wyższej cenie, chyba że wprost tak ogłosimy.",
        ],
      },
      {
        id: "platnosci",
        icon: "Wallet",
        heading: "Płatności, waluty i faktury",
        bullets: [
          "Płatność obsługuje operator płatności. Danych karty nie widzimy i nie przechowujemy - trafiają bezpośrednio do operatora.",
          `Na wyciągu bankowym obok naszej nazwy może pojawić się dopisek ${PAYMENT_PROVIDER_STATEMENT_DESCRIPTOR}. To nie jest obca transakcja - to deskryptor operatora płatności.`,
          "Waluta rozliczenia jest prezentowana przed zakupem. Przy zapłacie kartą w innej walucie bank może doliczyć własny koszt przewalutowania - to opłata banku, nie nasza.",
          "Dokument księgowy jest dostępny w panelu w sekcji rozliczeń niezwłocznie po zaksięgowaniu płatności.",
          "Fakturę na dane firmowe wystawimy, jeśli podasz je przed zakupem albo niezwłocznie po nim. Dane nabywcy po wystawieniu dokumentu można korygować wyłącznie w trybie przewidzianym przepisami podatkowymi.",
          "Kupony i kody rabatowe mają własne warunki - okres ważności, zakres planów i liczbę użyć - pokazywane przy ich zastosowaniu. Kodów nie łączymy, chyba że wprost na to wskażemy.",
        ],
      },
      {
        id: "odstapienie",
        icon: "Scale",
        heading: "Prawo odstąpienia - trzy różne sytuacje",
        paragraphs: [
          "Konsumentowi przysługuje co do zasady prawo odstąpienia od umowy zawartej na odległość w terminie 14 dni bez podania przyczyny (art. 27 ustawy z 30 maja 2014 r. o prawach konsumenta). Ustawa przewiduje jednak wyjątki, które realnie Cię dotyczą - opisujemy je wprost, bo różnią się między sobą.",
          "Te same uprawnienia przysługują osobie fizycznej prowadzącej działalność gospodarczą, która zawiera umowę bezpośrednio związaną z tą działalnością, gdy nie ma ona dla niej charakteru zawodowego (art. 7aa ustawy o prawach konsumenta).",
        ],
        bullets: [
          "Subskrypcja i dostęp do serwisu: masz 14 dni na odstąpienie. Jeżeli poprosisz o rozpoczęcie świadczenia przed upływem tego terminu, zapłacisz za część faktycznie wykorzystaną - proporcjonalnie do czasu, przez który miałeś dostęp.",
          "Treści cyfrowe dostarczane jednorazowo (na przykład raport do pobrania): prawo odstąpienia wygasa z chwilą rozpoczęcia spełniania świadczenia, jeżeli wyraziłeś na to uprzednią, wyraźną zgodę i przyjąłeś do wiadomości utratę tego prawa (art. 38 ust. 1 pkt 13 ustawy o prawach konsumenta). Pytamy o to osobno, przed pobraniem.",
          "Bilety na wydarzenia z oznaczonym dniem lub okresem: prawo odstąpienia NIE przysługuje. Wynika to z art. 38 ust. 1 pkt 12 ustawy o prawach konsumenta, który wyłącza je dla usług związanych z wydarzeniami kulturalnymi i podobnymi, jeżeli w umowie oznaczono dzień lub okres świadczenia. Zasady rezygnacji z udziału opisuje regulamin wydarzeń (/regulamin-wydarzen-i-biletow).",
          "Niezależnie od powyższego stosujemy własną, umowną gwarancję zwrotu - opisaną niżej i szerszą niż wymaga ustawa.",
        ],
      },
      {
        id: "gwarancja",
        icon: "HeartHandshake",
        heading: "Nasza gwarancja zwrotu",
        paragraphs: [
          `Niezależnie od uprawnień ustawowych dajemy gwarancję zwrotu pieniędzy przez ${REFUND_WINDOW_DAYS} dni od zakupu, bez ukrytych warunków. To zobowiązanie umowne, które przyznajemy dobrowolnie - nie ogranicza ono ani nie zastępuje praw konsumenta.`,
          `Zgłoszenie wystarczy wysłać na ${LEGAL_CONTACT_EMAIL}. Szczegółowy tryb i terminy opisuje polityka zwrotów i reklamacji (/zwroty-i-reklamacje).`,
        ],
      },
      {
        id: "zgodnosc",
        icon: "FileCheck2",
        heading: "Zgodność usługi z umową i reklamacje",
        bullets: [
          "Odpowiadamy za zgodność treści cyfrowej i usługi cyfrowej z umową na zasadach rozdziału 5b ustawy o prawach konsumenta. Jeżeli usługa jest niezgodna z umową, możesz żądać doprowadzenia jej do zgodności, a gdy to niemożliwe lub nieskuteczne - obniżenia ceny albo odstąpienia od umowy.",
          "Reklamację przyjmujemy pod adresem kontaktowym. Odpowiadamy w terminie 14 dni od jej otrzymania.",
          "Przerwy techniczne planowane zapowiadamy. Jeżeli niedostępność usługi z naszej winy jest istotna i długotrwała, przedłużamy okres subskrypcji o czas przerwy albo zwracamy odpowiednią część opłaty.",
          "Spór, którego nie uda się rozwiązać bezpośrednio, konsument może skierować do polubownego rozwiązania - w Polsce do powiatowego (miejskiego) rzecznika konsumentów, wojewódzkiego inspektora Inspekcji Handlowej albo innego podmiotu uprawnionego z wykazu prowadzonego przez Prezesa UOKiK. Europejska platforma ODR została wyłączona 20 lipca 2025 r. na mocy rozporządzenia (UE) 2024/3228 i nie przyjmuje już zgłoszeń.",
        ],
      },
      {
        id: "darowizny",
        icon: "HeartHandshake",
        heading: "Darowizny i wsparcie",
        bullets: [
          "Darowizna nie jest zakupem: nie wiąże się z żadnym świadczeniem wzajemnym i nie daje dostępu do treści płatnych.",
          "Darowizna jednorazowa nie podlega prawu odstąpienia, bo nie jest umową sprzedaży ani umową o świadczenie usług. Darowiznę cykliczną możesz zatrzymać w dowolnym momencie.",
          "Wpłata omyłkowa lub w błędnej kwocie - napisz do nas, zwrócimy ją.",
          "Środki z darowizn przeznaczamy wyłącznie na cele statutowe fundacji (/statut).",
        ],
      },
      {
        id: "kontakt",
        icon: "Mail",
        heading: "Kontakt w sprawach zakupów",
        paragraphs: [
          `Rozliczenia, faktury, zwroty i reklamacje: ${LEGAL_CONTACT_EMAIL}. Obsługę produktową i reklamacje prowadzimy my; rozliczenie zwrotu i ewentualny spór o obciążenie realizuje operator płatności (${PAYMENT_PROVIDER_NAME}).`,
        ],
      },
    ],
  },
  en: {
    eyebrow: "Purchases",
    ...SUBSCRIPTIONS_META.en,
    updated: `Last updated: ${COMPLIANCE_PACK_UPDATED}`,
    footnote: `This document supplements the terms and conditions (/regulamin) and the refund policy (/zwroty-i-reklamacje). Where they differ on refunds, the refund policy prevails.`,
    sections: [
      {
        id: "sprzedawca",
        icon: "Store",
        heading: "Who the seller is",
        paragraphs: [
          `The seller and party to the contract is ${LEGAL_ENTITY_FULL} - full registration details are on the statute page (/statut).`,
          PAYMENT_PROVIDER_DISCLOSURE.en,
        ],
      },
      {
        id: "plany",
        icon: "CreditCard",
        heading: "Plans and billing periods",
        bullets: [
          "We offer plans in several billing periods - two-weekly, monthly, quarterly and annual - as well as one-off purchases (tickets, time-limited access, materials).",
          "The price, billing period and entitlements of each plan are presented on the pricing page before the contract is concluded. The price shown in the order summary is the binding one.",
          "Prices are shown together with tax information. Tax for your jurisdiction is calculated and remitted by the payment provider; the final amount is visible before you confirm the purchase.",
          "If a plan includes a trial period, its length and the date of the first charge are stated before purchase. No trial information means the plan has none.",
          "Upgrading takes effect immediately and we settle the difference pro rata. Downgrading takes effect from the start of the next billing period - we do not cut short access you have already paid for.",
        ],
      },
      {
        id: "odnowienia",
        icon: "RotateCcw",
        heading: "Renewals and cancellation",
        paragraphs: [
          "Subscriptions renew automatically for a further billing period until you cancel. We say so plainly before purchase, not only in the terms.",
        ],
        bullets: [
          "You cancel yourself in subscription settings - no need to contact support and no reason required.",
          "Cancellation takes effect at the end of the current period. You keep access until the day you have paid for - we do not withdraw it the moment you click.",
          "A failed charge does not end the subscription immediately: the payment provider retries and we tell you to update your payment method. Once retries are exhausted, access expires.",
          "Closing your account also closes open subscriptions. We never leave an active charge behind after account deletion.",
        ],
      },
      {
        id: "zmiana-ceny",
        icon: "Megaphone",
        heading: "Changes to price or terms",
        bullets: [
          "We announce a price change for a renewing subscription at least 30 days before the date the new price would be charged.",
          "The notice goes to the address on your account. It is a service message - you receive it regardless of marketing consents.",
          "The new price applies only from the following billing period. Until then you may cancel with no consequences, and cancelling before the renewal date means the new price never charges you.",
          "Reductions and promotions do not apply retroactively: we do not compensate the difference to people who bought earlier at a higher price unless we expressly say so.",
        ],
      },
      {
        id: "platnosci",
        icon: "Wallet",
        heading: "Payments, currencies and invoices",
        bullets: [
          "Payment is handled by the payment provider. We neither see nor store card details - they go directly to the provider.",
          `Your bank statement may show ${PAYMENT_PROVIDER_STATEMENT_DESCRIPTOR} next to our name. That is not an unknown transaction - it is the payment provider's descriptor.`,
          "The settlement currency is shown before purchase. If you pay by card in another currency your bank may add its own conversion cost - that is the bank's fee, not ours.",
          "The accounting document is available in the billing section of your account as soon as the payment is booked.",
          "We will issue an invoice with company details if you provide them before the purchase or immediately after. Once the document is issued, buyer details can only be corrected in the manner tax law provides.",
          "Coupons and discount codes have their own conditions - validity period, eligible plans and number of uses - shown when they are applied. We do not stack codes unless expressly stated.",
        ],
      },
      {
        id: "odstapienie",
        icon: "Scale",
        heading: "The right of withdrawal - three different situations",
        paragraphs: [
          "As a rule a consumer has the right to withdraw from a distance contract within 14 days without giving a reason (Article 27 of the Polish Consumer Rights Act of 30 May 2014). The Act provides exceptions that genuinely apply to you - we set them out plainly, because they differ.",
          "The same entitlements apply to a natural person running a business who concludes a contract directly connected with that business where the contract is not of a professional character for them (Article 7aa of the Consumer Rights Act).",
        ],
        bullets: [
          "Subscriptions and access to the service: you have 14 days to withdraw. If you ask us to start providing the service before that period ends, you pay for the part actually used - in proportion to the time you had access.",
          "Digital content supplied in a single act (for example a report to download): the right of withdrawal expires once performance begins, provided you gave prior express consent and acknowledged the loss of that right (Article 38(1)(13) of the Consumer Rights Act). We ask about this separately, before the download.",
          "Tickets for events with a specified date or period: there is NO right of withdrawal. This follows from Article 38(1)(12) of the Consumer Rights Act, which excludes it for services connected with cultural and similar events where the contract specifies the date or period of performance. Rules for cancelling attendance are in the events terms (/regulamin-wydarzen-i-biletow).",
          "Regardless of the above, we apply our own contractual money-back guarantee - described below and broader than the law requires.",
        ],
      },
      {
        id: "gwarancja",
        icon: "HeartHandshake",
        heading: "Our money-back guarantee",
        paragraphs: [
          `Independently of statutory entitlements we offer a ${REFUND_WINDOW_DAYS}-day money-back guarantee with no hidden conditions. It is a contractual commitment we grant voluntarily - it neither limits nor replaces consumer rights.`,
          `Sending a request to ${LEGAL_CONTACT_EMAIL} is enough. The detailed procedure and deadlines are in the refund and complaints policy (/zwroty-i-reklamacje).`,
        ],
      },
      {
        id: "zgodnosc",
        icon: "FileCheck2",
        heading: "Conformity with the contract and complaints",
        bullets: [
          "We are liable for the conformity of digital content and digital services with the contract under Chapter 5b of the Consumer Rights Act. If the service does not conform, you may demand that it be brought into conformity and, where that is impossible or ineffective, a price reduction or withdrawal from the contract.",
          "We accept complaints at the contact address and respond within 14 days of receipt.",
          "Planned maintenance windows are announced in advance. If unavailability attributable to us is significant and prolonged, we extend the subscription by the length of the outage or refund a corresponding part of the fee.",
          "A dispute that cannot be settled directly may be referred by a consumer to alternative dispute resolution - in Poland to the district (municipal) consumer ombudsman, the regional Trade Inspection inspector or another entity from the list kept by the President of UOKiK. The European ODR platform was shut down on 20 July 2025 under Regulation (EU) 2024/3228 and no longer accepts submissions.",
        ],
      },
      {
        id: "darowizny",
        icon: "HeartHandshake",
        heading: "Donations and support",
        bullets: [
          "A donation is not a purchase: it involves no consideration in return and grants no access to paid content.",
          "A one-off donation is not subject to the right of withdrawal, because it is neither a sales contract nor a contract for services. A recurring donation can be stopped at any time.",
          "If you donated by mistake or in the wrong amount, write to us and we will return it.",
          "Donation proceeds are used solely for the foundation's statutory objectives (/statut).",
        ],
      },
      {
        id: "kontakt",
        icon: "Mail",
        heading: "Contact for purchase matters",
        paragraphs: [
          `Billing, invoices, refunds and complaints: ${LEGAL_CONTACT_EMAIL}. We handle product support and complaints ourselves; the refund settlement and any chargeback dispute are handled by the payment provider (${PAYMENT_PROVIDER_NAME}).`,
        ],
      },
    ],
  },
};
