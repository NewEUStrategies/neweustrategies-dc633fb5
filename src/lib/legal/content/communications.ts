// Serializowalna treść dokumentu prawnego (ikony jako nazwy, nie komponenty).
// Jedno źródło prawdy dla publicznej strony oraz dla wersjonowania w /admin.
//
// ZAKRES: KOMUNIKACJA WYCHODZĄCA. Newsletter, powiadomienia, wiadomości
// transakcyjne i marketing. Dwa reżimy naraz - RODO (podstawa przetwarzania
// danych) i prawo komunikacji elektronicznej (zgoda na SAM KANAŁ). Rozdzielenie
// tych dwóch rzeczy jest sednem dokumentu: zgoda z RODO nie zastępuje zgody na
// przesyłanie informacji handlowej, a wypis z newslettera nie wyłącza wiadomości
// serwisowych, bez których nie da się wykonać umowy.
import type { LegalDocContent } from "../types";
import { COMMUNICATIONS_META } from "../meta";
import { LEGAL_CONTACT_EMAIL, LEGAL_ENTITY } from "@/lib/legal/entity";
import { COMPLIANCE_PACK_UPDATED, PRIVACY_HUB_PATH } from "@/lib/legal/registration";

export const COMMUNICATIONS_CONTENT: LegalDocContent = {
  pl: {
    eyebrow: "Komunikacja",
    ...COMMUNICATIONS_META.pl,
    updated: `Ostatnia aktualizacja: ${COMPLIANCE_PACK_UPDATED}`,
    footnote: `Zasady dotyczą wszystkich kanałów wychodzących ${LEGAL_ENTITY}: poczty elektronicznej, powiadomień w serwisie i powiadomień push. Pełny opis przetwarzania danych znajdziesz w polityce prywatności (/polityka-prywatnosci).`,
    sections: [
      {
        id: "dwa-rezimy",
        icon: "Scale",
        heading: "Dwie zgody, nie jedna",
        paragraphs: [
          "Wysyłka marketingowa wymaga jednoczesnego spełnienia dwóch niezależnych warunków i żaden z nich nie zastępuje drugiego.",
          "Po pierwsze RODO: musi istnieć podstawa przetwarzania Twoich danych. Dla marketingu jest nią zgoda (art. 6 ust. 1 lit. a RODO).",
          "Po drugie prawo komunikacji elektronicznej: osobnej zgody wymaga samo UŻYCIE KANAŁU do przesłania informacji handlowej. W Polsce reguluje to ustawa z 12 lipca 2024 r. - Prawo komunikacji elektronicznej, która od 10 listopada 2024 r. zastąpiła w tym zakresie art. 172-173 Prawa telekomunikacyjnego oraz art. 10 ustawy o świadczeniu usług drogą elektroniczną.",
          "Dlatego zgoda zbierana jest zawsze wprost i osobno. Nigdy nie wyprowadzamy jej z faktu założenia konta, dokonania zakupu ani zapisania się na wydarzenie.",
        ],
      },
      {
        id: "rodzaje",
        icon: "Send",
        heading: "Rodzaje wiadomości, które od nas dostaniesz",
        bullets: [
          "Wiadomości serwisowe (transakcyjne) - potwierdzenie rejestracji, reset hasła, potwierdzenie płatności, faktura, przypomnienie o wydarzeniu, zmiana regulaminu. Są niezbędne do wykonania umowy, więc nie są objęte zgodą marketingową i NIE MOŻNA ich wyłączyć bez usunięcia konta.",
          "Newsletter redakcyjny - zamawiany osobno, z własną zgodą i własnym linkiem rezygnacji w każdej wiadomości.",
          "Komunikacja marketingowa - zaproszenia na wydarzenia komercyjne, oferty subskrypcji, informacje partnerów. Zawsze na podstawie zgody marketingowej.",
          "Powiadomienia o aktywności w serwisie - odpowiedź na komentarz, wiadomość, zaproszenie do sieci kontaktów. Sterujesz nimi per kategoria w ustawieniach powiadomień.",
          "Powiadomienia push w przeglądarce - wyłącznie po zgodzie udzielonej w przeglądarce ORAZ zgodzie marketingowej, jeśli treść ma charakter handlowy.",
          "Informacje produktowe o zmianach w platformie - domyślnie włączone jako istotne dla korzystania z usługi, ale możliwe do wyłączenia w ustawieniach.",
        ],
      },
      {
        id: "zapis",
        icon: "UserCheck",
        heading: "Jak działa zapis do newslettera",
        paragraphs: [
          "Stosujemy potwierdzenie dwuetapowe (double opt-in). Po podaniu adresu wysyłamy wiadomość z linkiem potwierdzającym i dopiero jego kliknięcie uruchamia wysyłkę. Adres niepotwierdzony nie trafia na listę wysyłkową.",
          "To zabezpieczenie przed zapisaniem kogoś wbrew jego woli - i jednocześnie dowód, że zgoda pochodzi od właściciela skrzynki.",
        ],
        bullets: [
          "Przy każdej zgodzie zapisujemy jej treść w wersji, którą widziałeś, znacznik czasu, język i źródło decyzji. Zmiana treści zgody podbija jej wersję i wymaga nowej decyzji - starej zgody nie rozciągamy na nowy zakres.",
          "Pola oznaczone jako wymagane ograniczamy do adresu e-mail. Imię jest opcjonalne i służy wyłącznie personalizacji nagłówka.",
          "Nie stosujemy zgód domyślnie zaznaczonych ani zgód pakietowych - każda zgoda ma osobne pole i osobną treść.",
          "Link potwierdzający jest jednorazowy i wygasa. Ponowne kliknięcie potwierdzonego linku pokazuje stan „już potwierdzono” zamiast błędu.",
        ],
      },
      {
        id: "rezygnacja",
        icon: "Ban",
        heading: "Jak zrezygnować",
        paragraphs: [
          "Rezygnacja musi być tak łatwa jak zapis - to wymóg art. 7 ust. 3 RODO i tak to działa u nas.",
        ],
        bullets: [
          "Link rezygnacji jest w stopce każdej wiadomości marketingowej i newslettera. Działa bez logowania i bez podawania powodu.",
          "Rezygnacja jest natychmiastowa. Nie prowadzimy „okresu wygaszania” ani dodatkowych wiadomości potwierdzających chęć odejścia.",
          `Zalogowany użytkownik wyłącza poszczególne kategorie w ustawieniach zgód (${PRIVACY_HUB_PATH}) - z widoczną historią decyzji.`,
          `Możesz też napisać na ${LEGAL_CONTACT_EMAIL}; sprzeciw wobec marketingu bezpośredniego realizujemy niezwłocznie i bez pytania o powód (art. 21 ust. 2-3 RODO).`,
          "Po rezygnacji adres trafia na listę wykluczeń. To jedyny sposób, żeby wypis przetrwał ponowny import listy - dlatego sam adres zostaje, mimo usunięcia pozostałych danych newsletterowych.",
          "Honorujemy sygnał Global Privacy Control wysyłany przez przeglądarkę i traktujemy go jako sprzeciw wobec przetwarzania w celach marketingowych.",
        ],
      },
      {
        id: "personalizacja",
        icon: "Fingerprint",
        heading: "Personalizacja i segmentacja",
        paragraphs: [
          "Treść newslettera dobieramy do tego, co czytasz i jakie tematy śledzisz. To profilowanie o niskim ryzyku - nie podejmujemy na jego podstawie decyzji wywołujących skutki prawne ani podobnie istotnych w rozumieniu art. 22 RODO.",
          "Personalizację wyłączysz, cofając zgodę na personalizację. Newsletter wysyłamy wtedy w wersji nieprofilowanej, a nie przestajemy go wysyłać.",
        ],
        bullets: [
          "Segmentacja opiera się na kategoriach treści, historii otwarć i preferencjach zadeklarowanych w profilu.",
          "Nie kupujemy baz adresowych i nie wzbogacamy naszych list danymi z brokerów danych.",
          "Nie przekazujemy adresów e-mail partnerom do ich własnych wysyłek. Jeśli partner ma do Ciebie dotrzeć, robi to przez nas albo na podstawie odrębnej zgody udzielonej jemu.",
        ],
      },
      {
        id: "pomiar",
        icon: "Activity",
        heading: "Pomiar skuteczności wysyłki",
        bullets: [
          "Mierzymy doręczenia, otwarcia, kliknięcia i wypisy - w celu poprawy jakości wysyłki i utrzymania reputacji nadawcy.",
          "Pomiar otwarć wykorzystuje znacznik graficzny w wiadomości. Klient pocztowy blokujący obrazy skutecznie go wyłącza i nie ma to żadnego wpływu na dostarczanie treści.",
          "Linki w wiadomościach mogą przechodzić przez przekierowanie zliczające kliknięcie. Adres docelowy jest zawsze naszym adresem albo adresem wskazanym wprost w treści.",
          "Statystyki analizujemy zbiorczo. Nie budujemy na ich podstawie ocen pojedynczych osób ani nie udostępniamy ich reklamodawcom w formie pozwalającej zidentyfikować odbiorcę.",
        ],
      },
      {
        id: "reklama",
        icon: "Megaphone",
        heading: "Reklama, treści sponsorowane i reklama polityczna",
        bullets: [
          "Materiały płatne oznaczamy jednoznacznie jako reklamę, materiał sponsorowany albo partnerski - zarówno w serwisie, jak i w newsletterze.",
          "Reklama nie wpływa na treść redakcyjną. Decyzje publikacyjne zapadają niezależnie od relacji handlowych.",
          "Reklamę polityczną prowadzimy zgodnie z rozporządzeniem (UE) 2024/900 o przejrzystości i targetowaniu reklamy politycznej, stosowanym od 10 października 2025 r. Każdy taki materiał nosi oznaczenie reklamy politycznej, wskazanie sponsora i informację o kryteriach kierowania, a dokumentację przechowujemy zgodnie z rozporządzeniem.",
          "Rozporządzenie zakazuje kierowania reklamy politycznej z użyciem danych szczególnych kategorii oraz targetowania osób, o których wiemy, że nie osiągnęły wieku uprawniającego do głosowania - przestrzegamy obu zakazów bezwzględnie.",
          "Szczegółowe zasady współpracy reklamowej opisują nasze wytyczne dotyczące reklam.",
        ],
      },
      {
        id: "nadawca",
        icon: "ShieldCheck",
        heading: "Uwierzytelnienie nadawcy i bezpieczeństwo",
        bullets: [
          "Nasze wiadomości są uwierzytelniane mechanizmami SPF, DKIM i DMARC - dzięki temu podszycie się pod naszą domenę jest wykrywalne po stronie odbiorcy.",
          "Nigdy nie prosimy w wiadomości o hasło, kod jednorazowy ani pełne dane karty płatniczej. Wiadomość zawierająca taką prośbę nie pochodzi od nas.",
          "Linki do płatności prowadzą wyłącznie do naszego serwisu albo do strony operatora płatności.",
          `Podejrzaną wiadomość podszywającą się pod ${LEGAL_ENTITY} zgłoś na ${LEGAL_CONTACT_EMAIL} - najlepiej z nagłówkami wiadomości.`,
        ],
      },
      {
        id: "kontakt",
        icon: "Mail",
        heading: "Kontakt",
        paragraphs: [
          `Sprawy dotyczące wysyłek, zgód i rezygnacji: ${LEGAL_CONTACT_EMAIL}. Jeżeli dostajesz od nas wiadomości mimo rezygnacji, potraktuj to jak zgłoszenie incydentu - sprawdzimy, którędy adres wrócił na listę.`,
        ],
      },
    ],
  },
  en: {
    eyebrow: "Communications",
    ...COMMUNICATIONS_META.en,
    updated: `Last updated: ${COMPLIANCE_PACK_UPDATED}`,
    footnote: `These rules cover every outbound channel ${LEGAL_ENTITY} uses: email, in-service notifications and push notifications. The full description of data processing is in the privacy notice (/polityka-prywatnosci).`,
    sections: [
      {
        id: "dwa-rezimy",
        icon: "Scale",
        heading: "Two consents, not one",
        paragraphs: [
          "Marketing messages require two independent conditions to be met at the same time, and neither replaces the other.",
          "First, the GDPR: there must be a basis for processing your data. For marketing that basis is consent (Article 6(1)(a) GDPR).",
          "Second, electronic communications law: separate consent is required for USING THE CHANNEL itself to send commercial information. In Poland this is governed by the Electronic Communications Law of 12 July 2024, which from 10 November 2024 replaced Articles 172-173 of the Telecommunications Law and Article 10 of the Act on Providing Services by Electronic Means in this respect.",
          "That is why consent is always collected explicitly and separately. We never infer it from the fact that you created an account, made a purchase or registered for an event.",
        ],
      },
      {
        id: "rodzaje",
        icon: "Send",
        heading: "Types of messages you may receive",
        bullets: [
          "Service (transactional) messages - registration confirmation, password reset, payment confirmation, invoice, event reminder, change of terms. They are necessary to perform the contract, so they are not covered by marketing consent and CANNOT be switched off without deleting the account.",
          "Editorial newsletter - ordered separately, with its own consent and its own unsubscribe link in every message.",
          "Marketing communications - invitations to commercial events, subscription offers, partner information. Always based on marketing consent.",
          "Activity notifications - a reply to your comment, a message, a network invitation. You control these per category in notification settings.",
          "Browser push notifications - only after permission granted in the browser AND marketing consent, where the content is commercial.",
          "Product information about platform changes - on by default as relevant to using the service, but switchable off in settings.",
        ],
      },
      {
        id: "zapis",
        icon: "UserCheck",
        heading: "How newsletter sign-up works",
        paragraphs: [
          "We use double opt-in. After you submit an address we send a message with a confirmation link, and only clicking it starts delivery. An unconfirmed address never reaches the sending list.",
          "This protects against signing somebody up against their will - and at the same time proves that the consent came from the owner of the mailbox.",
        ],
        bullets: [
          "With every consent we store its text in the version you saw, a timestamp, the language and the source of the decision. Changing the text bumps the consent version and requires a fresh decision - we never stretch an old consent onto a new scope.",
          "Required fields are limited to the email address. A first name is optional and is used only to personalise the greeting.",
          "We use no pre-ticked boxes and no bundled consents - every consent has its own field and its own text.",
          "The confirmation link is single-use and expires. Clicking a confirmed link again shows an already confirmed state rather than an error.",
        ],
      },
      {
        id: "rezygnacja",
        icon: "Ban",
        heading: "How to opt out",
        paragraphs: [
          "Opting out must be as easy as opting in - that is the requirement of Article 7(3) GDPR and that is how it works here.",
        ],
        bullets: [
          "The unsubscribe link sits in the footer of every marketing message and newsletter. It works without signing in and without giving a reason.",
          "Unsubscribing takes effect immediately. We run no grace period and send no extra messages asking you to reconsider.",
          `Signed-in users switch individual categories off in consent settings (${PRIVACY_HUB_PATH}) - with a visible decision history.`,
          `You can also write to ${LEGAL_CONTACT_EMAIL}; we action an objection to direct marketing immediately and without asking why (Article 21(2)-(3) GDPR).`,
          "After an opt-out the address goes onto a suppression list. That is the only way an unsubscribe survives a list re-import - which is why the address itself stays even though the rest of the newsletter data is removed.",
          "We honour the Global Privacy Control signal sent by your browser and treat it as an objection to processing for marketing purposes.",
        ],
      },
      {
        id: "personalizacja",
        icon: "Fingerprint",
        heading: "Personalisation and segmentation",
        paragraphs: [
          "We tailor newsletter content to what you read and which topics you follow. This is low-risk profiling - we take no decisions on that basis that produce legal or similarly significant effects within the meaning of Article 22 GDPR.",
          "You can switch personalisation off by withdrawing the personalisation consent. We then send the newsletter in a non-profiled version rather than stopping it.",
        ],
        bullets: [
          "Segmentation is based on content categories, open history and preferences declared in your profile.",
          "We do not buy address lists and we do not enrich our lists with data from data brokers.",
          "We do not hand email addresses to partners for their own mailings. If a partner is to reach you, it happens through us or on the basis of a separate consent given to them.",
        ],
      },
      {
        id: "pomiar",
        icon: "Activity",
        heading: "Measuring delivery performance",
        bullets: [
          "We measure deliveries, opens, clicks and unsubscribes - to improve the quality of our sending and maintain sender reputation.",
          "Open measurement uses a tracking pixel in the message. A mail client that blocks images switches it off effectively, and this has no effect on content delivery.",
          "Links in messages may pass through a redirect that counts the click. The destination is always our own address or an address stated explicitly in the message.",
          "We analyse statistics in aggregate. We do not build assessments of individuals from them and do not share them with advertisers in a form that identifies a recipient.",
        ],
      },
      {
        id: "reklama",
        icon: "Megaphone",
        heading: "Advertising, sponsored content and political advertising",
        bullets: [
          "Paid material is unambiguously labelled as advertising, sponsored or partner content - both in the service and in the newsletter.",
          "Advertising does not influence editorial content. Publishing decisions are taken independently of commercial relationships.",
          "We run political advertising in line with Regulation (EU) 2024/900 on the transparency and targeting of political advertising, applicable since 10 October 2025. Every such item carries a political advertising label, the sponsor's identity and information on targeting criteria, and we retain the documentation the Regulation requires.",
          "The Regulation prohibits targeting political advertising using special categories of data and targeting people we know have not reached voting age - we observe both prohibitions absolutely.",
          "Detailed rules for advertising cooperation are set out in our advertising guidelines.",
        ],
      },
      {
        id: "nadawca",
        icon: "ShieldCheck",
        heading: "Sender authentication and security",
        bullets: [
          "Our messages are authenticated with SPF, DKIM and DMARC - so spoofing of our domain is detectable at the recipient's end.",
          "We never ask in a message for a password, a one-time code or full card details. A message containing such a request did not come from us.",
          "Payment links lead only to our own service or to the payment provider's page.",
          `Report a suspicious message impersonating ${LEGAL_ENTITY} to ${LEGAL_CONTACT_EMAIL} - ideally with the message headers.`,
        ],
      },
      {
        id: "kontakt",
        icon: "Mail",
        heading: "Contact",
        paragraphs: [
          `Matters concerning mailings, consents and opt-outs: ${LEGAL_CONTACT_EMAIL}. If you receive messages from us despite opting out, treat it as an incident report - we will check how the address got back onto the list.`,
        ],
      },
    ],
  },
};
