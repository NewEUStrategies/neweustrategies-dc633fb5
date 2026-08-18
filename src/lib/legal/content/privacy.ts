// Serializowalna treść dokumentu prawnego (ikony jako nazwy, nie komponenty).
// Jedno źródło prawdy dla publicznej strony oraz dla wersjonowania w /admin.
import type { LegalDocContent } from "../types";
import { PRIVACY_META } from "../meta";
import {
  LEGAL_CONTACT_EMAIL,
  LEGAL_ENTITY,
  LEGAL_UPDATED,
  PAYMENT_PROVIDER_NAME,
} from "@/lib/legal/entity";

export const PRIVACY_CONTENT: LegalDocContent = {
  pl: {
    eyebrow: "Prywatność",
    // Tytuł + lead żyją w ../meta.ts (head() tras czyta je bez pełnej treści).
    ...PRIVACY_META.pl,
    updated: `Ostatnia aktualizacja: ${LEGAL_UPDATED}`,
    footnote: `Tę politykę prowadzi ${LEGAL_ENTITY}. Aktualizujemy ją, gdy zmieniają się nasze procesy lub przepisy - istotne zmiany komunikujemy na tej stronie.`,
    sections: [
      {
        id: "administrator",
        icon: "Building2",
        heading: "Administrator danych",
        paragraphs: [
          `Administratorem Twoich danych osobowych jest ${LEGAL_ENTITY}, wydawca serwisu neweuropeanstrategies.com (dalej: "Serwis"). Występujemy jako administrator (data controller) w rozumieniu art. 4 pkt 7 RODO i samodzielnie decydujemy o celach i sposobach przetwarzania danych opisanych poniżej.`,
          `Kontakt w sprawach ochrony danych: ${LEGAL_CONTACT_EMAIL}.`,
        ],
      },
      {
        id: "dane",
        icon: "Database",
        heading: "Jakie dane zbieramy i w jakim celu",
        bullets: [
          "Dane konta: imię i nazwisko, adres e-mail, hasło (w postaci skrótu), język i preferencje - w celu założenia i obsługi konta.",
          "Dane profilu i społeczności: zdjęcie, biogram, organizacja, kontakty i wiadomości - w celu udostępnienia funkcji profesjonalnej sieci kontaktów.",
          "Dane subskrypcji i zamówień: wybrany plan, status subskrypcji, identyfikator transakcji, historia dostępu - w celu realizacji umowy i nadania uprawnień.",
          "Dane newslettera: adres e-mail, imię, zgody i statusy doręczeń - w celu wysyłki zamówionych treści.",
          "Dane kontaktowe i zgłoszenia: treść formularzy, korespondencja - w celu udzielenia odpowiedzi i obsługi zgłoszeń.",
          "Dane techniczne i analityczne: adres IP, identyfikatory urządzenia i przeglądarki, logi bezpieczeństwa, zdarzenia korzystania z Serwisu - w celu zapewnienia bezpieczeństwa, zapobiegania nadużyciom i rozwoju produktu.",
        ],
        paragraphs: [
          "Danych kart płatniczych nie zbieramy ani nie przechowujemy - pełne dane płatnicze przetwarza nasz operator płatności, Stripe, który jako podprocesor obsługuje zamówienia w naszym imieniu.",
        ],
      },
      {
        id: "podstawy",
        icon: "Scale",
        heading: "Podstawy prawne przetwarzania",
        bullets: [
          "Art. 6 ust. 1 lit. b RODO - wykonanie umowy: prowadzenie konta, realizacja subskrypcji, dostęp do treści i wydarzeń.",
          "Art. 6 ust. 1 lit. c RODO - obowiązek prawny: rozliczenia podatkowe i księgowe, obsługa żądań uprawnionych organów.",
          "Art. 6 ust. 1 lit. f RODO - prawnie uzasadniony interes: bezpieczeństwo Serwisu, przeciwdziałanie nadużyciom, analityka produktowa, dochodzenie roszczeń.",
          "Art. 6 ust. 1 lit. a RODO - zgoda: newsletter marketingowy, pliki cookies inne niż niezbędne, wybrane powiadomienia. Zgodę możesz wycofać w każdej chwili.",
        ],
      },
      {
        id: "odbiorcy",
        icon: "Share2",
        heading: "Komu udostępniamy dane",
        bullets: [
          "Stripe Payments Europe, Ltd. (Irlandia) oraz podmioty z grupy Stripe - nasz operator płatności: obsługa transakcji, subskrypcji, faktur oraz naliczania i rozliczania podatku od sprzedaży w imieniu sprzedawcy, którym jesteśmy my.",
          "Dostawcy infrastruktury i hostingu bazy danych, plików oraz aplikacji.",
          "Dostawcy poczty transakcyjnej i newslettera - wysyłka wiadomości systemowych i raporty doręczeń.",
          "Dostawcy analityki i monitoringu błędów - w zakresie zgodnym z Twoimi zgodami na cookies.",
          "Doradcy prawni, księgowi i audytorzy - w zakresie niezbędnym do obsługi naszej działalności.",
          "Uprawnione organy publiczne - gdy wymagają tego przepisy prawa.",
        ],
        paragraphs: [
          "Nie sprzedajemy danych osobowych i nie udostępniamy ich do celów marketingowych podmiotów trzecich.",
        ],
      },
      {
        id: "transfery",
        icon: "Globe2",
        heading: "Przekazywanie poza EOG",
        paragraphs: [
          "Część naszych dostawców przetwarza dane poza Europejskim Obszarem Gospodarczym. W takich przypadkach opieramy transfer na decyzji o odpowiednim stopniu ochrony albo na standardowych klauzulach umownych Komisji Europejskiej wraz z dodatkowymi środkami bezpieczeństwa.",
        ],
      },
      {
        id: "retencja",
        icon: "Timer",
        heading: "Jak długo przechowujemy dane",
        bullets: [
          "Dane konta i profilu - przez czas posiadania konta, a po jego usunięciu do 30 dni w kopiach technicznych.",
          "Dane rozliczeniowe i dokumenty księgowe - 5 lat od końca roku podatkowego, zgodnie z przepisami.",
          "Dane newslettera - do czasu wycofania zgody, a następnie na liście wykluczeń wyłącznie w celu respektowania rezygnacji.",
          "Logi bezpieczeństwa i zdarzenia techniczne - do 12 miesięcy.",
          "Korespondencja i zgłoszenia - do 24 miesięcy od zakończenia sprawy.",
        ],
        paragraphs: ["Po upływie tych okresów dane usuwamy lub nieodwracalnie anonimizujemy."],
      },
      {
        id: "prawa",
        icon: "UserCheck",
        heading: "Twoje prawa",
        bullets: [
          "Dostęp do danych i uzyskanie ich kopii.",
          "Sprostowanie nieprawidłowych lub niekompletnych danych.",
          "Usunięcie danych (prawo do bycia zapomnianym). Usunięcie konta nie obejmuje ewidencji transakcji, którą musimy przechowywać z mocy prawa (art. 17 ust. 3 lit. b RODO): zapisy zostają, ale odcinamy je od Twojej tożsamości - identyfikator konta i adres e-mail znikają, w ich miejsce wchodzi nieodwracalny pseudonim, a po upływie okresu retencji zapis usuwamy automatycznie.",
          "Ograniczenie przetwarzania oraz sprzeciw wobec przetwarzania opartego na uzasadnionym interesie.",
          "Przenoszenie danych do innego administratora.",
          "Wycofanie zgody w dowolnym momencie, bez wpływu na zgodność z prawem wcześniejszego przetwarzania.",
          "Skarga do Prezesa Urzędu Ochrony Danych Osobowych lub innego właściwego organu nadzorczego.",
        ],
        paragraphs: [
          `Żądania realizujemy bez zbędnej zwłoki, nie później niż w ciągu miesiąca. Napisz na ${LEGAL_CONTACT_EMAIL}.`,
        ],
      },
      {
        id: "bezpieczenstwo",
        icon: "ShieldCheck",
        heading: "Bezpieczeństwo",
        bullets: [
          "Szyfrowanie transmisji (TLS) oraz szyfrowanie danych w spoczynku po stronie dostawcy bazy danych.",
          "Kontrola dostępu oparta na rolach i zasadach bezpieczeństwa na poziomie wierszy w bazie danych.",
          "Ograniczanie liczby prób logowania i monitoring nadużyć.",
          "Rejestrowanie zdarzeń administracyjnych oraz regularne przeglądy uprawnień.",
        ],
      },
      {
        id: "cookies",
        icon: "Cookie",
        heading: "Pliki cookies",
        paragraphs: [
          "Cookies inne niż niezbędne uruchamiamy dopiero po Twojej zgodzie. Kategorie, przykłady i centrum preferencji opisujemy w polityce cookies dostępnej pod adresem /cookies - decyzję możesz zmienić w każdej chwili.",
        ],
      },
      {
        id: "kontakt",
        icon: "Mail",
        heading: "Kontakt",
        paragraphs: [
          `W sprawach prywatności, płatności, faktur i zwrotów napisz na ${LEGAL_CONTACT_EMAIL}. Techniczną obsługę transakcji zapewnia nasz operator płatności, ${PAYMENT_PROVIDER_NAME}.`,
        ],
      },
    ],
  },
  en: {
    eyebrow: "Privacy",
    ...PRIVACY_META.en,
    updated: `Last updated: ${LEGAL_UPDATED}`,
    footnote: `This notice is maintained by ${LEGAL_ENTITY}. We update it whenever our processes or the law change - material changes are announced on this page.`,
    sections: [
      {
        id: "administrator",
        icon: "Building2",
        heading: "Data controller",
        paragraphs: [
          `${LEGAL_ENTITY}, publisher of neweuropeanstrategies.com (the "Service"), is the controller of your personal data within the meaning of Article 4(7) GDPR and decides on the purposes and means of the processing described below.`,
          `Data protection contact: ${LEGAL_CONTACT_EMAIL}.`,
        ],
      },
      {
        id: "dane",
        icon: "Database",
        heading: "What data we collect and why",
        bullets: [
          "Account data: name, email address, hashed password, language and preferences - to create and operate your account.",
          "Profile and community data: photo, bio, organisation, connections and messages - to provide the professional networking features.",
          "Subscription and order data: selected plan, subscription status, transaction identifier, access history - to perform the contract and grant entitlements.",
          "Newsletter data: email address, first name, consents and delivery status - to send the content you requested.",
          "Contact and support data: form content and correspondence - to answer and handle your request.",
          "Technical and analytics data: IP address, device and browser identifiers, security logs, usage events - for security, abuse prevention and product improvement.",
        ],
        paragraphs: [
          "We never collect or store card details - full payment data is processed by our payment provider, Stripe, acting as a processor on our behalf.",
        ],
      },
      {
        id: "podstawy",
        icon: "Scale",
        heading: "Legal bases",
        bullets: [
          "Article 6(1)(b) GDPR - performance of a contract: account, subscriptions, access to content and events.",
          "Article 6(1)(c) GDPR - legal obligation: tax and accounting duties, lawful requests from authorities.",
          "Article 6(1)(f) GDPR - legitimate interests: security of the Service, abuse prevention, product analytics, legal claims.",
          "Article 6(1)(a) GDPR - consent: marketing newsletter, non-essential cookies, selected notifications. Consent can be withdrawn at any time.",
        ],
      },
      {
        id: "odbiorcy",
        icon: "Share2",
        heading: "Who we share data with",
        bullets: [
          "Stripe Payments Europe, Ltd. (Ireland) and other Stripe group entities - our payment provider: transaction processing, subscription management, invoicing and calculating/remitting sales tax on behalf of the seller, which is us.",
          "Infrastructure providers hosting the database, files and application.",
          "Transactional email and newsletter providers - system messages and delivery reporting.",
          "Analytics and error-monitoring providers - within the scope of your cookie consent.",
          "Legal, accounting and audit advisers - as needed to run our business.",
          "Public authorities - where required by law.",
        ],
        paragraphs: ["We do not sell personal data and do not share it for third-party marketing."],
      },
      {
        id: "transfery",
        icon: "Globe2",
        heading: "International transfers",
        paragraphs: [
          "Some providers process data outside the European Economic Area. In those cases the transfer relies on an adequacy decision or on the European Commission's standard contractual clauses together with supplementary safeguards.",
        ],
      },
      {
        id: "retencja",
        icon: "Timer",
        heading: "Retention",
        bullets: [
          "Account and profile data - for as long as the account exists, plus up to 30 days in technical backups.",
          "Billing data and accounting documents - 5 years from the end of the tax year, as required by law.",
          "Newsletter data - until consent is withdrawn, then kept on a suppression list solely to honour the opt-out.",
          "Security logs and technical events - up to 12 months.",
          "Correspondence and support tickets - up to 24 months after the case is closed.",
        ],
        paragraphs: ["After these periods data is deleted or irreversibly anonymised."],
      },
      {
        id: "prawa",
        icon: "UserCheck",
        heading: "Your rights",
        bullets: [
          "Access to your data and a copy of it.",
          "Rectification of inaccurate or incomplete data.",
          "Erasure (right to be forgotten). Deleting your account does not cover the transaction ledger we are legally required to keep (Article 17(3)(b) GDPR): those entries stay, but we sever them from your identity - the account id and e-mail address are dropped and replaced with an irreversible pseudonym, and the entry is purged automatically once the retention period lapses.",
          "Restriction of processing and objection to processing based on legitimate interests.",
          "Data portability to another controller.",
          "Withdrawal of consent at any time, without affecting the lawfulness of prior processing.",
          "Complaint to the Polish Data Protection Authority (UODO) or another competent supervisory authority.",
        ],
        paragraphs: [
          `We answer without undue delay and within one month at the latest. Write to ${LEGAL_CONTACT_EMAIL}.`,
        ],
      },
      {
        id: "bezpieczenstwo",
        icon: "ShieldCheck",
        heading: "Security",
        bullets: [
          "Encryption in transit (TLS) and encryption at rest on the database provider side.",
          "Role-based access control and row-level security policies in the database.",
          "Login rate limiting and abuse monitoring.",
          "Audit logging of administrative actions and regular access reviews.",
        ],
      },
      {
        id: "cookies",
        icon: "Cookie",
        heading: "Cookies",
        paragraphs: [
          "Non-essential cookies are only set after your consent. Categories, examples and the preference centre are described in our cookie policy at /cookies - you can change your decision at any time.",
        ],
      },
      {
        id: "kontakt",
        icon: "Mail",
        heading: "Contact",
        paragraphs: [
          `For privacy, payment, invoice and refund matters write to ${LEGAL_CONTACT_EMAIL}. Technical transaction processing is provided by our payment provider, ${PAYMENT_PROVIDER_NAME}.`,
        ],
      },
    ],
  },
};
