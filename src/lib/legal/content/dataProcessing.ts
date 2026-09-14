// Serializowalna treść dokumentu prawnego (ikony jako nazwy, nie komponenty).
// Jedno źródło prawdy dla publicznej strony oraz dla wersjonowania w /admin.
//
// ZAKRES: WARSTWA OPERACYJNA. Polityka prywatności mówi „komu powierzamy dane”;
// ten dokument mówi KTÓRE to kategorie podmiotów, NA JAK DŁUGO zostają dane
// i CO konkretnie robimy, żeby ich nie stracić. To jest ta część, która zwykle
// istnieje wyłącznie w wewnętrznym rejestrze czynności - a bez której czytelnik
// nie ma jak sprawdzić deklaracji z pierwszego dokumentu.
import type { LegalDocContent } from "../types";
import { DATA_PROCESSING_META } from "../meta";
import {
  COMPLIANCE_PACK_UPDATED,
  LEGAL_CONTACT_EMAIL,
  PAYMENT_PROVIDER_NAME,
} from "@/lib/legal/entity";

export const DATA_PROCESSING_CONTENT: LegalDocContent = {
  pl: {
    eyebrow: "Przetwarzanie danych",
    ...DATA_PROCESSING_META.pl,
    updated: `Ostatnia aktualizacja: ${COMPLIANCE_PACK_UPDATED}`,
    footnote: `Dokument opisuje stan procesów na dzień ostatniej aktualizacji. Pełny rejestr czynności przetwarzania (art. 30 RODO) prowadzimy wewnętrznie i udostępniamy organowi nadzorczemu na żądanie; osoba, której dane dotyczą, otrzymuje na żądanie informacje z art. 15 RODO.`,
    sections: [
      {
        id: "zasady",
        icon: "Scale",
        heading: "Zasady, które wiążą nas przy każdej czynności",
        bullets: [
          "Zgodność z prawem, rzetelność i przejrzystość - każda czynność ma nazwany cel i podstawę prawną, zanim ruszy.",
          "Ograniczenie celu - dane zebrane po to, żeby wpuścić Cię na wydarzenie, nie zasilają listy marketingowej bez odrębnej zgody.",
          "Minimalizacja - nie zbieramy pól „na przyszłość”. Pole, którego nie potrafimy przypisać do celu, jest usuwane z formularza, a nie ukrywane.",
          "Prawidłowość - dane profilowe poprawiasz samodzielnie, a my nie nadpisujemy ich danymi z zewnętrznych źródeł bez Twojej wiedzy.",
          "Ograniczenie przechowywania - każda kategoria ma termin; po jego upływie dane są usuwane albo nieodwracalnie anonimizowane.",
          "Integralność i poufność - dostęp per rola, szyfrowanie w tranzycie i w spoczynku, izolacja danych między najemcami platformy.",
          "Rozliczalność - potrafimy wykazać powyższe, a nie tylko je zadeklarować.",
        ],
      },
      {
        id: "rejestr",
        icon: "ClipboardList",
        heading: "Czynności przetwarzania - skrót rejestru",
        bullets: [
          "Prowadzenie konta i profilu zawodowego - wykonanie umowy (art. 6 ust. 1 lit. b RODO).",
          "Subskrypcje, zamówienia i rozliczenia - wykonanie umowy oraz obowiązek prawny (art. 6 ust. 1 lit. b i c RODO).",
          "Newsletter i komunikacja marketingowa - zgoda (art. 6 ust. 1 lit. a RODO) w połączeniu z przepisami o komunikacji elektronicznej.",
          "Społeczność: komentarze, wątki, wiadomości, sieć kontaktów - wykonanie umowy oraz prawnie uzasadniony interes w moderacji (art. 6 ust. 1 lit. b i f RODO).",
          "Kluby dyskusyjne: wnioski o członkostwo, roster, wypowiedzi - wykonanie umowy i prawnie uzasadniony interes w utrzymaniu poufnego formatu.",
          "Wydarzenia: rejestracja, bilety, kontrola wejścia, identyfikatory - wykonanie umowy; przekazanie kontaktu partnerowi wyłącznie na podstawie odrębnej zgody.",
          "Bezpieczeństwo i przeciwdziałanie nadużyciom: logi, ograniczanie liczby żądań, wykrywanie nadużyć - prawnie uzasadniony interes (art. 6 ust. 1 lit. f RODO).",
          "Analityka produktowa i pomiar publikacji - zgoda dla plików cookie innych niż niezbędne, prawnie uzasadniony interes dla pomiarów zagregowanych.",
          "Obsługa żądań z RODO, reklamacji i zgłoszeń treści - obowiązek prawny oraz prawnie uzasadniony interes w obronie roszczeń.",
        ],
      },
      {
        id: "kategorie",
        icon: "Database",
        heading: "Kategorie danych i szczególna ostrożność",
        paragraphs: [
          "Nie prowadzimy zbiorów danych szczególnych kategorii (art. 9 RODO) ani danych o wyrokach i naruszeniach prawa (art. 10 RODO). Nie pytamy o poglądy polityczne, przekonania, zdrowie ani pochodzenie.",
          "Uwaga na treść, którą sam publikujesz: opisując swoje doświadczenie zawodowe albo zabierając głos w dyskusji, możesz ujawnić informacje wrażliwe. Takie dane przetwarzamy wyłącznie dlatego, że sam je upubliczniłeś (art. 9 ust. 2 lit. e RODO) - i możesz je w każdej chwili usunąć.",
          "Danych kart płatniczych nie widzimy i nie przechowujemy: pełne dane płatnicze przyjmuje bezpośrednio operator płatności.",
        ],
      },
      {
        id: "podmioty",
        icon: "Server",
        heading: "Podmioty przetwarzające - kategorie i rola",
        paragraphs: [
          "Z każdym podmiotem przetwarzającym zawieramy umowę powierzenia spełniającą wymagania art. 28 ust. 3 RODO. Podprocesor wchodzi do łańcucha wyłącznie za naszą zgodą i na tych samych warunkach.",
        ],
        bullets: [
          "Infrastruktura chmurowa i baza danych - hosting aplikacji, przechowywanie danych, kopie zapasowe.",
          "Sieć dostarczania treści i ochrona przed atakami - obsługa ruchu, filtrowanie nadużyć, terminacja szyfrowania.",
          `Operator płatności (${PAYMENT_PROVIDER_NAME}) - przyjmowanie płatności, rozliczanie podatku, obsługa sporów i obciążeń zwrotnych.`,
          "Dostawca poczty transakcyjnej i newslettera - doręczanie wiadomości oraz statusy doręczeń.",
          "Narzędzia analityczne i pomiar publikacji - wyłącznie w zakresie objętym Twoją zgodą.",
          "Dostawcy narzędzi wspierających redakcję i obsługę zgłoszeń - w zakresie niezbędnym do wykonania zadania.",
          "Doradcy zewnętrzni (prawni, księgowi, audytorzy) - jako odrębni administratorzy albo podmioty przetwarzające, zależnie od charakteru usługi.",
        ],
      },
      {
        id: "transfery",
        icon: "Globe2",
        heading: "Przekazywanie poza Europejski Obszar Gospodarczy",
        paragraphs: [
          "Dążymy do przetwarzania danych w Unii Europejskiej. Część dostawców przetwarza jednak dane także poza EOG - najczęściej w Stanach Zjednoczonych.",
        ],
        bullets: [
          "Decyzja o adekwatności Komisji Europejskiej - gdy dostawca podlega uznanemu za adekwatny programowi ochrony danych, w tym ram ochrony danych UE-USA.",
          "Standardowe klauzule umowne przyjęte decyzją wykonawczą Komisji 2021/914 - podstawowy mechanizm dla pozostałych transferów.",
          "Ocena skutków transferu wraz ze środkami uzupełniającymi (szyfrowanie, minimalizacja zakresu, kontrola dostępu), gdy sam mechanizm prawny nie wystarcza.",
          "Na żądanie wskazujemy mechanizm zastosowany do konkretnego transferu i udostępniamy informację o zabezpieczeniach.",
        ],
      },
      {
        id: "retencja",
        icon: "Timer",
        heading: "Okresy przechowywania",
        bullets: [
          "Dane konta i profilu - przez czas posiadania konta; po jego usunięciu kasujemy je lub anonimizujemy, z wyjątkami opisanymi niżej.",
          "Dokumentacja księgowa i rozliczeniowa - przez okres wymagany przepisami podatkowymi, liczony od końca roku kalendarzowego, w którym upłynął termin płatności podatku.",
          "Dane niezbędne do ustalenia, dochodzenia lub obrony roszczeń - do upływu terminów przedawnienia wynikających z Kodeksu cywilnego.",
          "Dane newslettera - do wycofania zgody; po rezygnacji zachowujemy wyłącznie zapis samej rezygnacji, żeby wypis został skutecznie zapamiętany.",
          "Logi bezpieczeństwa i zapisy wykrywania nadużyć - co do zasady do 12 miesięcy, chyba że konkretny zapis jest dowodem w toczącej się sprawie.",
          "Zapisy zgód i ich historia - przez czas obowiązywania zgody i okres przedawnienia roszczeń po jej wycofaniu; to materiał dowodowy rozliczalności.",
          "Dane uczestników wydarzeń - przez czas niezbędny do rozliczenia wydarzenia i obsługi reklamacji; zapisy z kontroli wejścia usuwamy po zamknięciu rozliczeń.",
          "Treści publiczne (komentarze, wątki) - do czasu ich usunięcia przez autora lub moderatora; po usunięciu konta mogą zostać w formie zanonimizowanej.",
        ],
      },
      {
        id: "bezpieczenstwo",
        icon: "Lock",
        heading: "Środki techniczne i organizacyjne",
        bullets: [
          "Szyfrowanie transmisji, szyfrowanie danych w spoczynku po stronie dostawcy infrastruktury oraz przechowywanie haseł wyłącznie w postaci skrótu.",
          "Autoryzacja egzekwowana na poziomie bazy danych (zabezpieczenia na poziomie wiersza), a nie tylko w interfejsie - błąd w widoku nie otwiera cudzych danych.",
          "Ścisła izolacja danych między najemcami platformy - zapytania są zawężone do najemcy po stronie serwera, a nie parametrem z żądania.",
          "Dostęp personelu według zasady wiedzy koniecznej, uwierzytelnianie dwuskładnikowe dla kont administracyjnych, rejestr operacji administracyjnych.",
          "Poświadczenia urządzeń peryferyjnych (skanery na wydarzeniach) mają wąski zakres, są przypisane do jednego wydarzenia, wygasają i można je unieważnić.",
          "Kopie zapasowe wraz z testami odtworzenia; rozdzielenie środowisk produkcyjnego i testowego, bez kopiowania danych produkcyjnych do testów.",
          "Automatyczne bramki jakości uruchamiane przy każdej zmianie kodu - obejmują reguły dostępu do danych, zakres eksportu danych osobowych i redakcję danych w telemetrii.",
          "Ocena skutków dla ochrony danych (art. 35 RODO) przed uruchomieniem przetwarzania mogącego powodować wysokie ryzyko.",
        ],
      },
      {
        id: "naruszenia",
        icon: "ShieldAlert",
        heading: "Postępowanie przy naruszeniu",
        bullets: [
          "Zgłoszenie wewnętrzne trafia do osoby odpowiedzialnej za ochronę danych natychmiast po wykryciu; ocena ryzyka jest dokumentowana niezależnie od wyniku.",
          "Zawiadomienie organu nadzorczego bez zbędnej zwłoki, w miarę możliwości w ciągu 72 godzin od stwierdzenia naruszenia (art. 33 RODO).",
          "Zawiadomienie osób, których dane dotyczą, gdy naruszenie może powodować wysokie ryzyko dla ich praw i wolności (art. 34 RODO).",
          "Prowadzimy wewnętrzną ewidencję wszystkich naruszeń - także tych niepodlegających zgłoszeniu, wraz z uzasadnieniem decyzji o niezgłaszaniu.",
        ],
      },
      {
        id: "kontakt",
        icon: "Mail",
        heading: "Kontakt i weryfikacja deklaracji",
        paragraphs: [
          `Pytania o konkretną czynność przetwarzania, podmiot przetwarzający albo okres retencji: ${LEGAL_CONTACT_EMAIL}. Jeżeli reprezentujesz partnera lub klienta instytucjonalnego i potrzebujesz umowy powierzenia albo kwestionariusza bezpieczeństwa, napisz - mamy gotowy zestaw dokumentów.`,
        ],
      },
    ],
  },
  en: {
    eyebrow: "Data processing",
    ...DATA_PROCESSING_META.en,
    updated: `Last updated: ${COMPLIANCE_PACK_UPDATED}`,
    footnote: `This document describes the state of our processes on the date of last update. We maintain the full record of processing activities (Article 30 GDPR) internally and make it available to the supervisory authority on request; data subjects receive Article 15 information on request.`,
    sections: [
      {
        id: "zasady",
        icon: "Scale",
        heading: "Principles that bind every activity",
        bullets: [
          "Lawfulness, fairness and transparency - every activity has a named purpose and legal basis before it starts.",
          "Purpose limitation - data collected to let you into an event does not feed a marketing list without separate consent.",
          "Minimisation - we do not collect fields just in case. A field we cannot tie to a purpose is removed from the form, not hidden.",
          "Accuracy - you correct profile data yourself, and we do not overwrite it from external sources without your knowledge.",
          "Storage limitation - every category has a deadline; after it the data is deleted or irreversibly anonymised.",
          "Integrity and confidentiality - role-based access, encryption in transit and at rest, isolation of data between platform tenants.",
          "Accountability - we can demonstrate the above, not merely assert it.",
        ],
      },
      {
        id: "rejestr",
        icon: "ClipboardList",
        heading: "Processing activities - summary of the record",
        bullets: [
          "Running accounts and professional profiles - performance of a contract (Article 6(1)(b) GDPR).",
          "Subscriptions, orders and settlements - performance of a contract and legal obligation (Article 6(1)(b) and (c) GDPR).",
          "Newsletter and marketing communications - consent (Article 6(1)(a) GDPR) combined with electronic communications law.",
          "Community: comments, threads, messages, professional network - performance of a contract and legitimate interest in moderation (Article 6(1)(b) and (f) GDPR).",
          "Discussion clubs: membership applications, rosters, contributions - performance of a contract and legitimate interest in maintaining a confidential format.",
          "Events: registration, tickets, access control, badges - performance of a contract; passing a contact to a partner only on the basis of separate consent.",
          "Security and abuse prevention: logs, rate limiting, abuse detection - legitimate interest (Article 6(1)(f) GDPR).",
          "Product analytics and audience measurement - consent for non-essential cookies, legitimate interest for aggregate measurement.",
          "Handling GDPR requests, complaints and content reports - legal obligation and legitimate interest in defending claims.",
        ],
      },
      {
        id: "kategorie",
        icon: "Database",
        heading: "Categories of data and special care",
        paragraphs: [
          "We do not maintain collections of special categories of data (Article 9 GDPR) or data on criminal convictions and offences (Article 10 GDPR). We do not ask about political opinions, beliefs, health or origin.",
          "A caution about what you publish yourself: describing your professional background or speaking in a discussion may reveal sensitive information. We process such data only because you manifestly made it public yourself (Article 9(2)(e) GDPR) - and you can remove it at any time.",
          "We neither see nor store card details: full payment data is taken directly by the payment provider.",
        ],
      },
      {
        id: "podmioty",
        icon: "Server",
        heading: "Processors - categories and roles",
        paragraphs: [
          "With every processor we conclude a data processing agreement meeting the requirements of Article 28(3) GDPR. A sub-processor enters the chain only with our authorisation and on the same terms.",
        ],
        bullets: [
          "Cloud infrastructure and database - application hosting, data storage, backups.",
          "Content delivery network and attack protection - traffic handling, abuse filtering, TLS termination.",
          `Payment provider (${PAYMENT_PROVIDER_NAME}) - taking payments, tax settlement, handling disputes and chargebacks.`,
          "Transactional email and newsletter provider - message delivery and delivery statuses.",
          "Analytics and audience measurement tools - strictly within the scope of your consent.",
          "Providers of editorial and support tooling - to the extent necessary to perform the task.",
          "External advisers (legal, accounting, audit) - as separate controllers or as processors, depending on the nature of the service.",
        ],
      },
      {
        id: "transfery",
        icon: "Globe2",
        heading: "Transfers outside the European Economic Area",
        paragraphs: [
          "We aim to process data inside the European Union. Some providers nevertheless process data outside the EEA - most often in the United States.",
        ],
        bullets: [
          "A European Commission adequacy decision - where the provider is covered by a data protection framework recognised as adequate, including the EU-US Data Privacy Framework.",
          "Standard contractual clauses adopted by Commission Implementing Decision 2021/914 - the default mechanism for other transfers.",
          "A transfer impact assessment with supplementary measures (encryption, scope minimisation, access control) where the legal mechanism alone is not sufficient.",
          "On request we identify the mechanism applied to a specific transfer and provide information about the safeguards.",
        ],
      },
      {
        id: "retencja",
        icon: "Timer",
        heading: "Retention periods",
        bullets: [
          "Account and profile data - for as long as the account exists; after deletion we erase or anonymise it, subject to the exceptions below.",
          "Accounting and settlement records - for the period required by tax law, counted from the end of the calendar year in which the payment deadline fell.",
          "Data needed to establish, exercise or defend claims - until the limitation periods under the Civil Code expire.",
          "Newsletter data - until consent is withdrawn; after unsubscribing we keep only the record of the unsubscribe itself, so that the opt-out is reliably remembered.",
          "Security logs and abuse detection records - as a rule up to 12 months, unless a specific record is evidence in an ongoing matter.",
          "Consent records and their history - for the duration of the consent and the limitation period after withdrawal; this is the evidence of accountability.",
          "Event attendee data - for as long as needed to settle the event and handle complaints; access control records are deleted once settlement closes.",
          "Public content (comments, threads) - until removed by the author or a moderator; after account deletion it may remain in anonymised form.",
        ],
      },
      {
        id: "bezpieczenstwo",
        icon: "Lock",
        heading: "Technical and organisational measures",
        bullets: [
          "Encryption in transit, encryption at rest on the infrastructure provider's side, and password storage as hashes only.",
          "Authorisation enforced at the database level (row-level security), not only in the interface - a bug in a view does not open somebody else's data.",
          "Strict isolation of data between platform tenants - queries are scoped to the tenant server-side, never by a parameter from the request.",
          "Staff access on a need-to-know basis, two-factor authentication for administrative accounts, and an audit log of administrative operations.",
          "Credentials for peripheral devices (event scanners) are narrowly scoped, bound to a single event, expiring and revocable.",
          "Backups together with restore testing; separation of production and test environments, with no copying of production data into tests.",
          "Automated quality gates on every code change - covering data access rules, the scope of the personal data export and redaction of data in telemetry.",
          "A data protection impact assessment (Article 35 GDPR) before launching processing likely to result in a high risk.",
        ],
      },
      {
        id: "naruszenia",
        icon: "ShieldAlert",
        heading: "Breach procedure",
        bullets: [
          "An internal report reaches the person responsible for data protection immediately on detection; the risk assessment is documented regardless of its outcome.",
          "Notification of the supervisory authority without undue delay and, where feasible, within 72 hours of becoming aware of the breach (Article 33 GDPR).",
          "Notification of data subjects where the breach is likely to result in a high risk to their rights and freedoms (Article 34 GDPR).",
          "We keep an internal register of all breaches - including those that are not notifiable, together with the reasoning behind that decision.",
        ],
      },
      {
        id: "kontakt",
        icon: "Mail",
        heading: "Contact and verifying our statements",
        paragraphs: [
          `Questions about a specific processing activity, processor or retention period: ${LEGAL_CONTACT_EMAIL}. If you represent a partner or an institutional client and need a data processing agreement or a security questionnaire, write to us - we have a ready set of documents.`,
        ],
      },
    ],
  },
};
