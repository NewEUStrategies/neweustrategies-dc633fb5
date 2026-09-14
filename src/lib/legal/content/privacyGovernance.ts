// Serializowalna treść dokumentu prawnego (ikony jako nazwy, nie komponenty).
// Jedno źródło prawdy dla publicznej strony oraz dla wersjonowania w /admin.
//
// ZAKRES: ZARZĄDZANIE polityką prywatności - czyli warstwa, której zwykle nie
// ma nigdzie, a bez której polityka jest tylko tekstem: kto ją pisze, jak jest
// wersjonowana, co się dzieje z Twoją zgodą, gdy treść zgody się zmienia, jak
// ogłaszamy zmiany i gdzie użytkownik realnie steruje swoimi ustawieniami.
// To odpowiednik „polityki o politykach” - art. 5 ust. 2 RODO (rozliczalność).
import type { LegalDocContent } from "../types";
import { PRIVACY_GOVERNANCE_META } from "../meta";
import { LEGAL_CONTACT_EMAIL, LEGAL_ENTITY } from "@/lib/legal/entity";
import { COMPLIANCE_PACK_UPDATED, PRIVACY_HUB_PATH } from "@/lib/legal/registration";

export const PRIVACY_GOVERNANCE_CONTENT: LegalDocContent = {
  pl: {
    eyebrow: "Nadzór",
    ...PRIVACY_GOVERNANCE_META.pl,
    updated: `Ostatnia aktualizacja: ${COMPLIANCE_PACK_UPDATED}`,
    footnote: `Dokument opisuje proces, a nie samą treść polityk. Aktualne wersje dokumentów znajdziesz pod ich stałymi adresami - te adresy się nie zmieniają, zmienia się wyłącznie treść pod nimi.`,
    sections: [
      {
        id: "po-co",
        icon: "ClipboardList",
        heading: "Po co osobny dokument o zarządzaniu politykami",
        paragraphs: [
          "Art. 5 ust. 2 RODO wymaga od administratora nie tylko zgodności z prawem, lecz także możliwości jej WYKAZANIA. Polityka prywatności, której nikt nie wersjonuje i której zmiany nie są ogłaszane, tego nie wykazuje: po roku nie da się ustalić, na jaką treść zgodził się użytkownik, który zgodę wyraził wczoraj, a na jaką ten, który wyraził ją w zeszłym sezonie.",
          "Ten dokument opisuje więc proces: kto odpowiada za treść, jak powstaje nowa wersja, kiedy zmiana wymaga ponownej zgody i jak Cię o niej zawiadamiamy.",
        ],
      },
      {
        id: "dokumenty",
        icon: "FileText",
        heading: "Mapa dokumentów i ich zakres",
        bullets: [
          "Polityka prywatności (/polityka-prywatnosci) - co przetwarzamy, po co, na jakiej podstawie i komu przekazujemy. Dokument podstawowy w rozumieniu art. 13-14 RODO.",
          "RODO - Twoje prawa (/rodo) - instrukcja wykonywania praw: kanały, terminy, zakres eksportu, granice usunięcia, skarga do organu.",
          "Polityka przetwarzania danych (/polityka-przetwarzania-danych) - warstwa operacyjna: rejestr czynności, podmioty przetwarzające, retencja, transfery, bezpieczeństwo.",
          "Polityka cookies (/cookies) - kategorie plików cookie i podobnych technologii wraz z centrum preferencji.",
          "Komunikacja i marketing (/komunikacja-i-marketing) - newsletter, powiadomienia, zgody marketingowe i rezygnacja.",
          "Regulamin serwisu (/regulamin), zwroty i reklamacje (/zwroty-i-reklamacje) - warstwa umowna i konsumencka.",
          "Moderacja treści (/moderacja-komentarzy), kluby dyskusyjne (/regulamin-klubow-dyskusyjnych), wydarzenia i bilety (/regulamin-wydarzen-i-biletow) - regulaminy powierzchni, na których przetwarzamy dane w szczególnym kontekście.",
        ],
        paragraphs: [
          "W razie rozbieżności między dokumentami pierwszeństwo ma dokument bardziej szczegółowy dla danej powierzchni, a w sprawach ochrony danych - polityka prywatności.",
        ],
      },
      {
        id: "odpowiedzialnosc",
        icon: "UserCheck",
        heading: "Kto odpowiada za treść",
        bullets: [
          `Właścicielem merytorycznym wszystkich polityk jest ${LEGAL_ENTITY}; decyzje o zmianach zapadają na poziomie zarządu wydawcy.`,
          "Zmianę może zainicjować redakcja, zespół produktowy albo osoba odpowiedzialna za ochronę danych - najczęściej wtedy, gdy zmienia się realny proces, a nie sama redakcja tekstu.",
          "Zmiany wpływające na podstawy prawne, zakres danych, odbiorców albo okresy retencji przechodzą przegląd prawny przed publikacją.",
          "Nie wyznaczyliśmy inspektora ochrony danych - nie zachodzi żadna z przesłanek art. 37 ust. 1 RODO. Obowiązki koordynacyjne pełni wskazana osoba w zespole wydawcy.",
        ],
      },
      {
        id: "wersjonowanie",
        icon: "History",
        heading: "Wersjonowanie i rozliczalność",
        paragraphs: [
          "Każdy dokument prawny ma w systemie własną historię wersji: szkic, wersja opublikowana i wersje zarchiwizowane. W danym momencie opublikowana jest dokładnie jedna wersja dokumentu, a publikacja jest operacją atomową - nie istnieje stan, w którym pod adresem nie ma żadnej obowiązującej treści.",
          "Wersja niesie etykietę, notatkę o zakresie zmian i datę wejścia w życie. Jeżeli w bazie nie ma opublikowanej wersji, strona renderuje treść bazową wbudowaną w kod aplikacji - dzięki temu dokument prawny jest dostępny także przy awarii warstwy danych.",
        ],
        bullets: [
          "Adresy dokumentów są stałe. Zmiana treści nie zmienia adresu, więc link, który podałeś komuś rok temu, nadal prowadzi do obowiązującej wersji.",
          "Data „ostatnia aktualizacja” na stronie dotyczy TEGO dokumentu. Nie przesuwamy jej na dokumentach, w których nic się nie zmieniło - inaczej straciłaby wartość informacyjną.",
          "Zgody zbierane w serwisie są zapisywane razem z wersją treści, na którą zostały wyrażone, znacznikiem czasu i źródłem decyzji. Dzięki temu da się odtworzyć, na co dokładnie zgodziła się dana osoba.",
        ],
      },
      {
        id: "zmiany",
        icon: "BellRing",
        heading: "Jak ogłaszamy zmiany",
        bullets: [
          "Zmiany redakcyjne (poprawki językowe, doprecyzowania, nowe przykłady) publikujemy od razu, ze zaktualizowaną datą na stronie dokumentu.",
          "Zmiany istotne - nowy cel przetwarzania, nowa kategoria odbiorców, nowa podstawa prawna, wydłużenie retencji, zmiana zasad moderacji - zapowiadamy z wyprzedzeniem co najmniej 14 dni przed wejściem w życie.",
          "O zmianach istotnych informujemy zarejestrowanych użytkowników wiadomością na adres przypisany do konta oraz komunikatem w serwisie. To wiadomość serwisowa: dostaniesz ją niezależnie od zgód marketingowych.",
          "Zmiana TREŚCI ZGODY wymaga nowej decyzji. Bumpujemy wtedy wersję zgody, a poprzednia przestaje być podstawą przetwarzania - nie „dziedziczymy” starej zgody na nowy zakres.",
          "Jeżeli nie akceptujesz zmiany regulaminu, możesz zrezygnować z usługi przed jej wejściem w życie na zasadach opisanych w regulaminie serwisu.",
        ],
      },
      {
        id: "twoje-ustawienia",
        icon: "SlidersHorizontal",
        heading: "Gdzie samodzielnie zarządzasz prywatnością",
        paragraphs: [
          `Centrum ustawień znajduje się na stronie „Prywatność” w profilu (${PRIVACY_HUB_PATH}). Układ odpowiada rosnącej nieodwracalności decyzji: najpierw to, co zmieniasz codziennie, na końcu to, czego nie da się cofnąć.`,
        ],
        bullets: [
          "Widoczność i kontakt - obecność w katalogu osób, przyjmowanie zapytań, kto może rozpocząć rozmowę i zaprosić Cię do sieci kontaktów, potwierdzenia odczytu, wskaźnik pisania.",
          "Zgody - katalog zgód komunikacyjnych, produktowych i analitycznych wraz z historią decyzji oraz powiązanie z centrum preferencji plików cookie.",
          "Twoje dane - eksport kompletu danych (art. 15 i 20 RODO) oraz usunięcie konta (art. 17 RODO).",
          "Preferencje cookie zmienisz także bez logowania, z poziomu polityki cookies (/cookies) - banner zgód otwiera się wprost z tej strony.",
          "Honorujemy sygnał Global Privacy Control (GPC) wysyłany przez przeglądarkę: traktujemy go jako sprzeciw wobec przetwarzania w celach marketingowych.",
        ],
      },
      {
        id: "przeglad",
        icon: "CalendarClock",
        heading: "Cykl przeglądu",
        bullets: [
          "Pełny przegląd wszystkich polityk wykonujemy co najmniej raz na 12 miesięcy.",
          "Przegląd poza cyklem uruchamia każde z: wdrożenie nowego podmiotu przetwarzającego, uruchomienie powierzchni zbierającej nowe kategorie danych, zmiana przepisów lub wytycznych organów, incydent bezpieczeństwa.",
          "Przegląd obejmuje także zgodność deklaracji z kodem: zakres eksportu danych, katalog zgód i lista podmiotów przetwarzających są testowane automatycznie, więc rozjazd między dokumentem a systemem zatrzymuje wdrożenie.",
        ],
      },
      {
        id: "kontakt",
        icon: "Mail",
        heading: "Pytania i uwagi do polityk",
        paragraphs: [
          `Jeżeli którykolwiek fragment jest niejasny albo wygląda na rozbieżny z tym, co robi serwis, napisz na ${LEGAL_CONTACT_EMAIL}. Zgłoszenia o rozbieżności traktujemy jak zgłoszenie błędu: sprawdzamy proces, a nie tylko tekst.`,
        ],
      },
    ],
  },
  en: {
    eyebrow: "Governance",
    ...PRIVACY_GOVERNANCE_META.en,
    updated: `Last updated: ${COMPLIANCE_PACK_UPDATED}`,
    footnote: `This document describes the process, not the content of the policies themselves. Current versions live at their permanent addresses - those addresses do not change, only the content behind them does.`,
    sections: [
      {
        id: "po-co",
        icon: "ClipboardList",
        heading: "Why govern policies in a separate document",
        paragraphs: [
          "Article 5(2) GDPR requires a controller not only to comply but to be able to DEMONSTRATE compliance. A privacy notice that nobody versions and whose changes are never announced fails that test: a year later there is no way to tell which text a person consented to yesterday and which text another person consented to last season.",
          "So this document describes the process: who owns the content, how a new version is produced, when a change requires fresh consent and how we notify you.",
        ],
      },
      {
        id: "dokumenty",
        icon: "FileText",
        heading: "Map of the documents and their scope",
        bullets: [
          "Privacy notice (/polityka-prywatnosci) - what we process, why, on what basis and who receives it. The primary document under Articles 13-14 GDPR.",
          "GDPR - your rights (/rodo) - how to exercise your rights: channels, deadlines, export scope, limits of erasure, complaints to the authority.",
          "Data processing policy (/polityka-przetwarzania-danych) - the operational layer: records of processing, processors, retention, transfers, security.",
          "Cookie policy (/cookies) - categories of cookies and similar technologies together with the preference centre.",
          "Communications and marketing (/komunikacja-i-marketing) - newsletter, notifications, marketing consents and opting out.",
          "Terms and conditions (/regulamin), refunds and complaints (/zwroty-i-reklamacje) - the contractual and consumer layer.",
          "Content moderation (/moderacja-komentarzy), discussion clubs (/regulamin-klubow-dyskusyjnych), events and tickets (/regulamin-wydarzen-i-biletow) - rules for surfaces where we process data in a specific context.",
        ],
        paragraphs: [
          "Where documents differ, the one more specific to the surface prevails; in data protection matters the privacy notice prevails.",
        ],
      },
      {
        id: "odpowiedzialnosc",
        icon: "UserCheck",
        heading: "Who owns the content",
        bullets: [
          `${LEGAL_ENTITY} owns all policies; decisions about changes are taken at the publisher's management level.`,
          "A change may be initiated by the editorial team, the product team or the person responsible for data protection - usually because a real process changed, not because the wording did.",
          "Changes affecting legal bases, data scope, recipients or retention periods go through legal review before publication.",
          "We have not appointed a data protection officer - none of the conditions in Article 37(1) GDPR applies. Coordination duties sit with a designated person on the publisher's team.",
        ],
      },
      {
        id: "wersjonowanie",
        icon: "History",
        heading: "Versioning and accountability",
        paragraphs: [
          "Every legal document has its own version history in the system: draft, published version and archived versions. Exactly one version of a document is published at any moment, and publishing is atomic - there is no state in which an address carries no binding text.",
          "A version carries a label, a note on the scope of the change and an effective date. If no published version exists in the database, the page renders the baseline text built into the application code - so a legal document remains available even if the data layer fails.",
        ],
        bullets: [
          "Document addresses are permanent. Changing the content does not change the address, so a link you shared a year ago still leads to the version in force.",
          "The Last updated date on a page refers to THAT document. We do not roll it forward on documents where nothing changed - that would destroy its only informational value.",
          "Consents collected in the service are stored together with the version of the text they were given for, a timestamp and the source of the decision. That makes it possible to reconstruct exactly what a person agreed to.",
        ],
      },
      {
        id: "zmiany",
        icon: "BellRing",
        heading: "How we announce changes",
        bullets: [
          "Editorial changes (wording, clarifications, new examples) are published immediately with an updated date on the document page.",
          "Material changes - a new purpose, a new category of recipients, a new legal basis, longer retention, changed moderation rules - are announced at least 14 days before they take effect.",
          "We notify registered users of material changes by a message to the address on the account and by an in-service notice. That is a service message: you receive it regardless of marketing consents.",
          "A change to the TEXT OF A CONSENT requires a fresh decision. We bump the consent version and the previous one stops being a basis for processing - we never inherit an old consent onto a new scope.",
          "If you do not accept a change to the terms, you may terminate the service before it takes effect, on the conditions set out in the terms and conditions.",
        ],
      },
      {
        id: "twoje-ustawienia",
        icon: "SlidersHorizontal",
        heading: "Where you manage privacy yourself",
        paragraphs: [
          `The settings hub is the Privacy page in your profile (${PRIVACY_HUB_PATH}). Its layout follows increasing irreversibility: what you change daily first, what cannot be undone last.`,
        ],
        bullets: [
          "Visibility and contact - presence in the people directory, accepting enquiries, who may start a conversation or invite you to their network, read receipts, typing indicator.",
          "Consents - the catalogue of communication, product and analytics consents with their decision history, linked to the cookie preference centre.",
          "Your data - export of a full copy (Articles 15 and 20 GDPR) and account deletion (Article 17 GDPR).",
          "Cookie preferences can also be changed without signing in, from the cookie policy (/cookies) - the consent banner opens directly from that page.",
          "We honour the Global Privacy Control (GPC) signal sent by your browser and treat it as an objection to processing for marketing purposes.",
        ],
      },
      {
        id: "przeglad",
        icon: "CalendarClock",
        heading: "Review cycle",
        bullets: [
          "We perform a full review of all policies at least once every 12 months.",
          "An out-of-cycle review is triggered by any of: onboarding a new processor, launching a surface that collects new categories of data, a change in law or regulatory guidance, a security incident.",
          "The review also covers whether our statements match the code: the export scope, the consent catalogue and the processor list are tested automatically, so a drift between document and system blocks the release.",
        ],
      },
      {
        id: "kontakt",
        icon: "Mail",
        heading: "Questions and feedback on the policies",
        paragraphs: [
          `If any passage is unclear or looks inconsistent with what the service actually does, write to ${LEGAL_CONTACT_EMAIL}. We treat reports of inconsistency like bug reports: we check the process, not just the wording.`,
        ],
      },
    ],
  },
};
