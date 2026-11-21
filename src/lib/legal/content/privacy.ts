// Serializowalna treść dokumentu prawnego (ikony jako nazwy, nie komponenty).
// Jedno źródło prawdy dla publicznej strony oraz dla wersjonowania w /admin.
import type { LegalDocContent } from "../types";
import { PRIVACY_META } from "../meta";
import {
  LEGAL_CONTACT_EMAIL,
  LEGAL_ENTITY,
  PRIVACY_UPDATED,
  PAYMENT_PROVIDER_NAME,
} from "@/lib/legal/entity";

export const PRIVACY_CONTENT: LegalDocContent = {
  pl: {
    eyebrow: "Prywatność",
    // Tytuł + lead żyją w ../meta.ts (head() tras czyta je bez pełnej treści).
    ...PRIVACY_META.pl,
    updated: `Ostatnia aktualizacja: ${PRIVACY_UPDATED}`,
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
          "Dane newslettera: adres e-mail, imię, zgody (z wersją treści, którą widziałeś) i statusy doręczeń - w celu wysyłki zamówionych treści; otwarcia i kliknięcia wiadomości - wyłącznie za osobną zgodą na pomiar, potwierdzoną przyciskiem na stronie z linku w wiadomości wysłanej na Twój adres, w celu dopasowania treści i częstotliwości wysyłki oraz statystyki (szczegóły i osobne wycofanie zgody na pomiar: /komunikacja-i-marketing#pomiar).",
          "Dane kontaktowe i zgłoszenia: treść formularzy, korespondencja - w celu udzielenia odpowiedzi i obsługi zgłoszeń.",
          "Dane techniczne i analityczne: adres IP, identyfikatory urządzenia i przeglądarki, logi bezpieczeństwa, zdarzenia korzystania z Serwisu - w celu zapewnienia bezpieczeństwa, zapobiegania nadużyciom i rozwoju produktu.",
          "Dane z plików cookie i pikseli reklamowych (wyłącznie za zgodą): identyfikatory plików cookie, odwiedzane adresy, źródło wejścia, wykonane działania (np. zapis, rejestracja, zakup wraz z kwotą i walutą) - w celu statystyk, poprawy Serwisu i pomiaru skuteczności naszych reklam (szczegóły w sekcji „Analityka i pomiar reklam”).",
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
          "Art. 6 ust. 1 lit. a RODO - zgoda: newsletter marketingowy, pomiar otwarć i kliknięć wiadomości, pliki cookies inne niż niezbędne, narzędzia analityczne i piksele reklamowe, wybrane powiadomienia. Zgodę możesz wycofać w każdej chwili - zgodę na pomiar także osobno, bez rezygnacji z newslettera.",
          "Art. 399 ustawy - Prawo komunikacji elektronicznej - zapisywanie i odczyt informacji na Twoim urządzeniu (pliki cookie i podobne technologie) poza niezbędnymi wymaga Twojej uprzedniej zgody.",
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
          "Dostawcy analityki i monitoringu błędów - w zakresie zgodnym z Twoimi zgodami na cookies: Google Ireland Ltd. (Google Analytics), Microsoft Ireland Operations Ltd. (Clarity) oraz Lovable (pomiar odwiedzin bez plików cookie, w ramach hostingu).",
          "Dostawcy reklam - wyłącznie po zgodzie marketingowej: Google Ireland Ltd. (Google Ads), Meta Platforms Ireland Ltd. (Facebook, Instagram), LinkedIn Ireland Unlimited Company, X Internet Unlimited Company (X).",
          "Doradcy prawni, księgowi i audytorzy - w zakresie niezbędnym do obsługi naszej działalności.",
          "Uprawnione organy publiczne - gdy wymagają tego przepisy prawa.",
        ],
        paragraphs: [
          "Nie sprzedajemy danych osobowych. Dostawcy reklam otrzymują dane z Twojej przeglądarki (a w przypadku Meta także kopię tych samych zdarzeń z naszego serwera) wyłącznie po zgodzie marketingowej i wyłącznie do pomiaru oraz kierowania naszych reklam; Meta, LinkedIn i X mogą je dalej wykorzystywać jako samodzielni administratorzy na zasadach swoich polityk prywatności.",
        ],
      },
      {
        id: "transfery",
        icon: "Globe2",
        heading: "Przekazywanie poza EOG",
        paragraphs: [
          "Część naszych dostawców przetwarza dane poza Europejskim Obszarem Gospodarczym. W takich przypadkach opieramy transfer na decyzji o odpowiednim stopniu ochrony albo na standardowych klauzulach umownych Komisji Europejskiej wraz z dodatkowymi środkami bezpieczeństwa.",
          "Dotyczy to m.in. Google, Microsoft, Meta i LinkedIn: ich spółki w USA uczestniczą w unijno-amerykańskich ramach ochrony danych (EU-US Data Privacy Framework), objętych decyzją Komisji Europejskiej z 10 lipca 2023 r. o odpowiednim stopniu ochrony. Przekazywanie danych z piksela X do X Corp. w USA odbywa się na podstawie standardowych klauzul umownych stosowanych przez X.",
        ],
      },
      {
        id: "retencja",
        icon: "Timer",
        heading: "Jak długo przechowujemy dane",
        bullets: [
          "Dane konta i profilu - przez czas posiadania konta, a po jego usunięciu do 30 dni w kopiach technicznych.",
          "Dane rozliczeniowe i dokumenty księgowe (w tym faktury) - do końca szóstego roku po roku, w którym powstały, czyli do upływu przedawnienia zobowiązań podatkowych (ustawa o rachunkowości, Ordynacja podatkowa, ustawa o VAT).",
          "Dane newslettera - do czasu wycofania zgody, a następnie na liście wykluczeń wyłącznie w celu respektowania rezygnacji.",
          "Logi bezpieczeństwa i zdarzenia techniczne - do 12 miesięcy.",
          "Korespondencja i zgłoszenia - do 24 miesięcy od zakończenia sprawy.",
          "Pliki cookie i podobne technologie - przez okresy podane w polityce cookies (/cookies); zapis Twojego wyboru zgód - do 12 miesięcy.",
          "Pomiar odwiedzin bez plików cookie - dane szczegółowe 90 dni, dzienne podsumowania rok. Dane w narzędziach Google, Microsoft, Meta, LinkedIn i X - przez okresy ustalone przez tych dostawców.",
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
          "Cookies inne niż niezbędne uruchamiamy dopiero po Twojej zgodzie. Zgody analityczna i marketingowa są niezależne, zamknięcie banera niczego nie włącza, a sygnał Global Privacy Control traktujemy jak odmowę. Kategorie, pełną listę plików cookie z okresami i centrum preferencji opisujemy w polityce cookies dostępnej pod adresem /cookies - decyzję możesz zmienić w każdej chwili przyciskiem „Zarządzaj preferencjami” na tej stronie albo w ustawieniach prywatności konta.",
        ],
      },
      {
        id: "pomiar-reklamy",
        icon: "Megaphone",
        heading: "Analityka i pomiar reklam",
        paragraphs: [
          "Poniższe narzędzia (poza pomiarem bez plików cookie) uruchamiamy dopiero po Twojej zgodzie w banerze. Wycofanie zgody zatrzymuje wysyłkę danych od razu.",
        ],
        bullets: [
          "Pomiar odwiedzin bez plików cookie (Lovable, nasz dostawca hostingu): nie używa plików cookie, niczego nie zapisuje na urządzeniu, nie przechowuje adresów IP i nie identyfikuje odwiedzających. Rejestruje odwiedzane strony, źródło wejścia, kraj, przeglądarkę, system i typ urządzenia, czas na stronie, szybkość ładowania i błędy - u każdego odwiedzającego - a kliknięcia i zdarzenia Serwisu dopiero po zgodzie analitycznej (nigdy przy sygnale Global Privacy Control). Lovable zbiera te dane w naszym imieniu; jak je przetwarza, wyjaśnia polityka prywatności Lovable (https://lovable.dev/privacy). Podstawa: prawnie uzasadniony interes w statystyce Serwisu (art. 6 ust. 1 lit. f RODO).",
          "Google Analytics 4 (Google Ireland Ltd.) - za zgodą analityczną: statystyki odwiedzin i zdarzeń w Serwisie. Bez zgody znaczniki Google działają w trybie odmowy (Consent Mode) i nie zapisują plików cookie.",
          "Microsoft Clarity (Microsoft Ireland Operations Ltd.) - za zgodą analityczną: mapy kliknięć i przewijania oraz nagrania sesji, w których wpisywane treści są maskowane. Służą wyłącznie poprawie czytelności i nawigacji.",
          "Google Ads (Google Ireland Ltd.) - za zgodą marketingową: pomiar konwersji z reklam (formularz kontaktowy, wniosek do klubu, rejestracja, newsletter, zapis na wydarzenie, zakup z kwotą i numerem transakcji) oraz listy odbiorców do remarketingu. Nie przekazujemy Google Twoich danych kontaktowych.",
          "Piksel Meta (Meta Platforms Ireland Ltd.) - za zgodą marketingową: zdarzenia takie jak odsłona, wyświetlenie treści, wyszukiwanie, kontakt, zapis, rejestracja, rozpoczęcie płatności i zakup z kwotą, do pomiaru i kierowania naszych reklam na Facebooku i Instagramie. Z przeglądarki wysyłamy wyłącznie parametry bez danych osobowych; piksel ma jednak włączone automatyczne dopasowanie - jeśli wpiszesz w formularz adres e-mail lub numer telefonu, Meta może otrzymać ich skrót (SHA-256), aby dopasować zdarzenie do konta w swoich serwisach. Te same zdarzenia przekazujemy Meta również z naszego serwera (API konwersji) - wraz z adresem IP, krajem ustalonym z adresu IP, informacją o przeglądarce i identyfikatorami plików cookie _fbp/_fbc, a jeśli jesteś zalogowany - także ze skrótem (SHA-256) adresu e-mail konta i identyfikatora konta - aby nie ginęły, gdy przeglądarka zablokuje piksel; Meta łączy obie kopie i liczy zdarzenie raz. Bez zgody marketingowej serwer niczego nie wysyła.",
          "LinkedIn Insight Tag (LinkedIn Ireland Unlimited Company) - za zgodą marketingową: odsłony i konwersje (zapis, rejestracja, zakup) do pomiaru kampanii LinkedIn i zbiorczych statystyk odbiorców (np. branża, wielkość firmy). Nie widzimy, kim są poszczególni odwiedzający.",
          "Piksel X Ads (X Internet Unlimited Company) - za zgodą marketingową: odsłony stron do pomiaru skuteczności naszych reklam w serwisie X i docierania z reklamą do osób, które odwiedziły Serwis. Piksel odczytuje identyfikator kliknięcia reklamy z adresu i zapisuje własne pliki cookie (m.in. _twpid, _twclid); nie przekazujemy X Twoich danych kontaktowych. X przetwarza te dane jako samodzielny administrator na zasadach swojej polityki prywatności (https://x.com/privacy). Reklamy dopasowane do zainteresowań w X wyłączysz także w ustawieniach konta X (Prywatność i bezpieczeństwo -> Preferencje reklam) albo na stronie www.youronlinechoices.eu.",
          "Współadministrowanie: w zakresie zbierania i przekazania danych przez piksel Meta i LinkedIn Insight Tag jesteśmy współadministratorami z Meta Platforms Ireland Ltd. i LinkedIn Ireland Unlimited Company (art. 26 RODO). Za dalsze przetwarzanie odpowiadają te spółki jako samodzielni administratorzy; prawa wobec nich możesz wykonywać bezpośrednio albo przez nas.",
          "Nie podejmujemy wobec Ciebie decyzji opartych wyłącznie na zautomatyzowanym przetwarzaniu, które wywoływałyby skutki prawne (art. 22 RODO). Dopasowanie reklam odbywa się po stronie dostawców reklam.",
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
    updated: `Last updated: ${PRIVACY_UPDATED}`,
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
          "Newsletter data: email address, first name, consents (with the version of the text you saw) and delivery status - to send the content you requested; message opens and clicks - only with separate consent to measurement, confirmed with the button on the page opened from a link in an email sent to your address, to tailor the content and sending frequency and keep statistics (details and withdrawing consent to measurement separately: /komunikacja-i-marketing#pomiar).",
          "Contact and support data: form content and correspondence - to answer and handle your request.",
          "Technical and analytics data: IP address, device and browser identifiers, security logs, usage events - for security, abuse prevention and product improvement.",
          'Cookie and ad pixel data (only with consent): cookie identifiers, the addresses you visit, the referring source, actions you take (e.g. a sign-up, registration, purchase with its amount and currency) - for statistics, improving the Service and measuring how our ads perform (details in the "Analytics and ad measurement" section).',
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
          "Article 6(1)(a) GDPR - consent: marketing newsletter, measurement of message opens and clicks, non-essential cookies, analytics tools and ad pixels, selected notifications. Consent can be withdrawn at any time - consent to measurement also separately, without unsubscribing from the newsletter.",
          "Article 399 of the Polish Electronic Communications Law - storing and reading information on your device (cookies and similar technologies) beyond what is strictly necessary requires your prior consent.",
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
          "Analytics and error-monitoring providers - within the scope of your cookie consent: Google Ireland Ltd. (Google Analytics), Microsoft Ireland Operations Ltd. (Clarity) and Lovable (cookieless visit measurement, as part of hosting).",
          "Advertising providers - only after marketing consent: Google Ireland Ltd. (Google Ads), Meta Platforms Ireland Ltd. (Facebook, Instagram), LinkedIn Ireland Unlimited Company, X Internet Unlimited Company (X).",
          "Legal, accounting and audit advisers - as needed to run our business.",
          "Public authorities - where required by law.",
        ],
        paragraphs: [
          "We do not sell personal data. Advertising providers receive data from your browser (and, for Meta, also a copy of the same events from our server) only after marketing consent and only to measure and target our ads; Meta, LinkedIn and X may use it further as independent controllers under their own privacy policies.",
        ],
      },
      {
        id: "transfery",
        icon: "Globe2",
        heading: "International transfers",
        paragraphs: [
          "Some providers process data outside the European Economic Area. In those cases the transfer relies on an adequacy decision or on the European Commission's standard contractual clauses together with supplementary safeguards.",
          "This includes Google, Microsoft, Meta and LinkedIn: their US entities participate in the EU-US Data Privacy Framework, covered by the European Commission's adequacy decision of 10 July 2023. Data from the X pixel is transferred to X Corp. in the US on the basis of the standard contractual clauses used by X.",
        ],
      },
      {
        id: "retencja",
        icon: "Timer",
        heading: "Retention",
        bullets: [
          "Account and profile data - for as long as the account exists, plus up to 30 days in technical backups.",
          "Billing data and accounting documents (including invoices) - until the end of the sixth year after the year in which they were created, i.e. until tax liabilities become time-barred (Polish Accounting Act, Tax Ordinance and VAT Act).",
          "Newsletter data - until consent is withdrawn, then kept on a suppression list solely to honour the opt-out.",
          "Security logs and technical events - up to 12 months.",
          "Correspondence and support tickets - up to 24 months after the case is closed.",
          "Cookies and similar technologies - for the periods listed in the cookie policy (/cookies); the record of your consent choice - up to 12 months.",
          "Cookieless visit measurement - detailed data for 90 days, daily summaries for a year. Data in Google, Microsoft, Meta, LinkedIn and X tools - for the periods set by those providers.",
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
          'Non-essential cookies are only set after your consent. Analytics and marketing consents are independent, closing the banner grants nothing, and we treat the Global Privacy Control signal as a refusal. Categories, the full list of cookies with their durations and the preference centre are described in our cookie policy at /cookies - you can change your decision at any time with the "Manage preferences" button on that page or in your account privacy settings.',
        ],
      },
      {
        id: "pomiar-reklamy",
        icon: "Megaphone",
        heading: "Analytics and ad measurement",
        paragraphs: [
          "The tools below (apart from cookieless measurement) start only after you consent in the banner. Withdrawing consent stops data from being sent immediately.",
        ],
        bullets: [
          "Cookieless visit measurement (Lovable, our hosting provider): uses no cookies, stores nothing on your device, does not keep IP addresses and does not identify visitors. It records the pages visited, where visitors came from, their country, browser, operating system and device type, time on page, page load speed and errors - for every visitor - while clicks and site events are sent only after analytics consent (never with the Global Privacy Control signal). Lovable collects this data for us; Lovable's privacy policy (https://lovable.dev/privacy) explains how it handles it. Legal basis: legitimate interest in Service statistics (Article 6(1)(f) GDPR).",
          "Google Analytics 4 (Google Ireland Ltd.) - with analytics consent: statistics on visits and on-site events. Without consent Google tags run in denied mode (Consent Mode) and set no cookies.",
          "Microsoft Clarity (Microsoft Ireland Operations Ltd.) - with analytics consent: click and scroll heatmaps and session recordings in which typed input is masked. Used solely to improve readability and navigation.",
          "Google Ads (Google Ireland Ltd.) - with marketing consent: ad conversion measurement (contact form, club application, registration, newsletter, event sign-up, purchase with its value and transaction number) and remarketing audience lists. We do not pass your contact details to Google.",
          "Meta Pixel (Meta Platforms Ireland Ltd.) - with marketing consent: events such as page view, content view, search, contact, sign-up, registration, checkout start and purchase with its value, to measure and target our ads on Facebook and Instagram. From the browser we only send parameters without personal data; the pixel does, however, have automatic matching enabled - if you type an email address or phone number into a form, Meta may receive a hash of it (SHA-256) to match the event to an account on its services. We also pass the same events to Meta from our server (Conversions API) - together with the IP address, the country derived from it, browser information and the _fbp/_fbc cookie identifiers, and - if you are signed in - a hash (SHA-256) of your account email address and account ID - so they are not lost when a browser blocks the pixel; Meta merges both copies and counts the event once. Without marketing consent our server sends nothing.",
          "LinkedIn Insight Tag (LinkedIn Ireland Unlimited Company) - with marketing consent: page views and conversions (sign-up, registration, purchase) to measure LinkedIn campaigns and aggregate audience statistics (e.g. industry, company size). We cannot see who individual visitors are.",
          "X Ads pixel (X Internet Unlimited Company) - with marketing consent: page views to measure how our ads on X perform and to reach people who have visited the Service with ads. The pixel reads the ad click identifier from the address and sets its own cookies (including _twpid, _twclid); we do not pass your contact details to X. X processes this data as an independent controller under its privacy policy (https://x.com/privacy). You can also turn off interest-based ads on X in your X account settings (Privacy and safety -> Ad preferences) or at www.youronlinechoices.eu.",
          "Joint controllership: for the collection and transmission of data through the Meta Pixel and the LinkedIn Insight Tag we are joint controllers with Meta Platforms Ireland Ltd. and LinkedIn Ireland Unlimited Company (Article 26 GDPR). Those companies are responsible for any further processing as independent controllers; you can exercise your rights against them directly or through us.",
          "We do not take decisions about you based solely on automated processing that produce legal effects (Article 22 GDPR). Ad matching takes place on the advertising providers' side.",
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
