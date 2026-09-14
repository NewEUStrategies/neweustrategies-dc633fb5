// Serializowalna treść dokumentu prawnego (ikony jako nazwy, nie komponenty).
// Jedno źródło prawdy dla publicznej strony oraz dla wersjonowania w /admin.
//
// ZAKRES: RODO jako INSTRUKCJA OBSŁUGI, nie jako druga polityka prywatności.
// `/polityka-prywatnosci` odpowiada na pytanie „co robicie z moimi danymi”;
// ten dokument odpowiada na pytanie „co MOGĘ z tym zrobić i jak” - jedno
// żądanie, jeden kanał, jeden termin, jedna ścieżka odwoławcza.
import type { LegalDocContent } from "../types";
import { RODO_META } from "../meta";
import {
  COMPLIANCE_PACK_UPDATED,
  LEGAL_CONTACT_EMAIL,
  LEGAL_ENTITY,
  PRIVACY_HUB_PATH,
  SUPERVISORY_AUTHORITY,
} from "@/lib/legal/entity";

export const RODO_CONTENT: LegalDocContent = {
  pl: {
    eyebrow: "RODO",
    ...RODO_META.pl,
    updated: `Ostatnia aktualizacja: ${COMPLIANCE_PACK_UPDATED}`,
    footnote: `Ten dokument opisuje wykonywanie praw z RODO. Pełny opis celów, podstaw prawnych i odbiorców danych znajdziesz w polityce prywatności (/polityka-prywatnosci), a warstwę operacyjną - w polityce przetwarzania danych (/polityka-przetwarzania-danych).`,
    sections: [
      {
        id: "czym-jest",
        icon: "Scale",
        heading: "Czym jest RODO i kiedy Cię chroni",
        paragraphs: [
          "RODO to rozporządzenie Parlamentu Europejskiego i Rady (UE) 2016/679 z 27 kwietnia 2016 r. o ochronie osób fizycznych w związku z przetwarzaniem danych osobowych. W Polsce uzupełnia je ustawa z 10 maja 2018 r. o ochronie danych osobowych.",
          `Chroni Cię zawsze, gdy ${LEGAL_ENTITY} przetwarza informacje, po których da się Ciebie zidentyfikować - także pośrednio, np. przez identyfikator konta, adres IP czy identyfikator urządzenia. Nie ma znaczenia, czy masz u nas konto: prawa z RODO przysługują również osobom, które tylko zapisały się na newsletter, wysłały formularz kontaktowy albo wzięły udział w wydarzeniu.`,
          `Administratorem danych jest ${LEGAL_ENTITY}. Kontakt we wszystkich sprawach ochrony danych: ${LEGAL_CONTACT_EMAIL}.`,
        ],
      },
      {
        id: "prawa",
        icon: "ListChecks",
        heading: "Twoje prawa - pełna lista",
        bullets: [
          "Dostęp do danych i kopia danych (art. 15 RODO) - potwierdzenie, czy przetwarzamy Twoje dane, jakie, w jakim celu, komu je przekazujemy i jak długo je trzymamy, wraz z kopią.",
          "Sprostowanie (art. 16 RODO) - poprawienie danych nieprawidłowych i uzupełnienie niekompletnych. Większość danych profilowych poprawisz samodzielnie.",
          "Usunięcie, tzw. prawo do bycia zapomnianym (art. 17 RODO) - usunięcie danych, gdy nie są już potrzebne, gdy wycofasz zgodę lub gdy skutecznie wniesiesz sprzeciw.",
          "Ograniczenie przetwarzania (art. 18 RODO) - „zamrożenie” danych na czas sporu o ich prawidłowość lub o zasadność naszego prawnie uzasadnionego interesu.",
          "Przenoszenie danych (art. 20 RODO) - otrzymanie danych przetwarzanych na podstawie zgody lub umowy w ustrukturyzowanym, powszechnie używanym formacie nadającym się do odczytu maszynowego.",
          "Sprzeciw (art. 21 RODO) - wobec przetwarzania opartego na prawnie uzasadnionym interesie. Sprzeciw wobec marketingu bezpośredniego jest BEZWARUNKOWY: honorujemy go zawsze i bez pytania o powód.",
          "Wycofanie zgody (art. 7 ust. 3 RODO) - w każdej chwili, równie łatwo jak jej udzielenie. Wycofanie działa na przyszłość i nie podważa legalności tego, co zrobiliśmy wcześniej.",
          "Niepodleganie decyzji automatycznej (art. 22 RODO) - prawo do interwencji człowieka tam, gdzie decyzja wywołuje skutki prawne lub podobnie istotne.",
          "Skarga do organu nadzorczego (art. 77 RODO) - niezależnie od kontaktu z nami i bez konieczności wyczerpania trybu u administratora.",
        ],
      },
      {
        id: "jak-zlozyc",
        icon: "Send",
        heading: "Jak złożyć żądanie",
        paragraphs: [
          `Najszybszy kanał to panel: na stronie „Prywatność” w profilu (${PRIVACY_HUB_PATH}) samodzielnie pobierzesz komplet swoich danych, zmienisz zgody, ustawisz widoczność w katalogu osób i uruchomisz usunięcie konta. To są te same operacje, które wykonalibyśmy na Twoje żądanie - tylko bez czekania na odpowiedź.`,
          `Kanał pisemny: ${LEGAL_CONTACT_EMAIL}. Wystarczy wskazać, czego dotyczy żądanie - nie wymagamy formularza ani uzasadnienia (poza sprzeciwem wobec przetwarzania innego niż marketing, gdzie RODO każe wskazać szczególną sytuację).`,
        ],
        bullets: [
          "Nie musisz powoływać się na konkretny artykuł RODO - wystarczy opisać, o co Ci chodzi.",
          "Żądanie jest wolne od opłat. Opłatę lub odmowę dopuszcza art. 12 ust. 5 RODO wyłącznie przy żądaniach ewidentnie nieuzasadnionych lub nadmiernych, np. powtarzanych seryjnie; jeśli kiedykolwiek się na to powołamy, uzasadnimy to na piśmie.",
          "Jeżeli nie jesteśmy w stanie Cię zidentyfikować, poprosimy o dodatkowe informacje (art. 12 ust. 6 RODO). Prosimy o minimum potrzebne do potwierdzenia tożsamości - nigdy o skan dokumentu tożsamości „na wszelki wypadek”.",
          "Żądanie w imieniu innej osoby wymaga pełnomocnictwa. Bez niego nie wydamy cudzych danych, nawet członkowi rodziny.",
        ],
      },
      {
        id: "terminy",
        icon: "AlarmClock",
        heading: "W jakim terminie odpowiadamy",
        bullets: [
          "Bez zbędnej zwłoki, najpóźniej w ciągu miesiąca od otrzymania żądania (art. 12 ust. 3 RODO).",
          "Termin można przedłużyć o kolejne dwa miesiące, jeśli żądanie jest skomplikowane lub zbiega się z innymi. O przedłużeniu i jego przyczynie informujemy w ciągu pierwszego miesiąca.",
          "Jeżeli nie podejmiemy działania, w ciągu miesiąca wyjaśniamy dlaczego i pouczamy o skardze do organu nadzorczego oraz o drodze sądowej.",
          "Sprzeciw wobec marketingu bezpośredniego i wycofanie zgody marketingowej realizujemy niezwłocznie, nie czekając na upływ miesiąca.",
        ],
      },
      {
        id: "eksport",
        icon: "Download",
        heading: "Eksport danych - co dokładnie dostajesz",
        paragraphs: [
          "Eksport uruchamiany z panelu zwraca plik JSON z manifestem: sekcja po sekcji wymienia, co plik zawiera, a także CO ŚWIADOMIE POMIJA i dlaczego. Manifest jest częścią paczki, więc brak danej kategorii jest widoczny dla Ciebie, a nie tylko dla nas.",
          "Sekcje o dużym wolumenie (wiadomości, historia czytania, komentarze) mają zadeklarowany limit wierszy. Gdy paczka zostanie przycięta, manifest oznacza taką sekcję jako uciętą - dzięki temu plik nigdy nie udaje kompletu. Jeżeli potrzebujesz pełnej historii ponad limit, napisz do nas i przygotujemy ją ręcznie.",
        ],
        bullets: [
          "Zawartość: konto i profil, subskrypcje i zamówienia, zgody wraz z historią decyzji, treści (komentarze, wątki, odpowiedzi), wiadomości i kontakty, zapisy na wydarzenia, zgłoszenia i reklamacje.",
          "Wyłączenia: dane innych osób (np. treść cudzych wiadomości), dane objęte tajemnicą przedsiębiorstwa oraz logi bezpieczeństwa, których wydanie osłabiłoby ochronę Twojego konta. Każde wyłączenie jest nazwane w manifeście.",
        ],
      },
      {
        id: "usuniecie",
        icon: "Trash2",
        heading: "Usunięcie konta i granice prawa do bycia zapomnianym",
        paragraphs: [
          "Usunięcie konta uruchomisz samodzielnie w panelu. Operacja jest nieodwracalna: nie odtworzymy profilu, historii ani dostępu do treści płatnych.",
          "Prawo do usunięcia nie jest bezwzględne. Art. 17 ust. 3 RODO pozwala zachować dane, gdy przetwarzanie jest niezbędne do wywiązania się z obowiązku prawnego albo do ustalenia, dochodzenia lub obrony roszczeń.",
        ],
        bullets: [
          "Zachowujemy dokumenty księgowe i rozliczeniowe przez okres wymagany przepisami podatkowymi - faktury nie znikają razem z kontem.",
          "Zachowujemy minimalny ślad niezbędny do obsługi sporu, jeśli spór jest w toku.",
          "Adres e-mail objęty rezygnacją z marketingu zostaje na liście wykluczeń - to jedyny sposób, żeby wypis został skutecznie zapamiętany i żebyś nie dostał kolejnej wiadomości po ponownym imporcie listy.",
          "Twoje publiczne wypowiedzi (komentarze, wątki) możemy zachować w formie zanonimizowanej, żeby nie rozbić kontekstu cudzej dyskusji. Powiązanie z Tobą jest wtedy usuwane.",
        ],
      },
      {
        id: "profilowanie",
        icon: "Fingerprint",
        heading: "Profilowanie i decyzje automatyczne",
        paragraphs: [
          "Nie podejmujemy wobec Ciebie decyzji opartych wyłącznie na zautomatyzowanym przetwarzaniu, które wywoływałyby skutki prawne lub w podobny sposób istotnie na Ciebie wpływały w rozumieniu art. 22 ust. 1 RODO.",
          "Używamy natomiast profilowania o niskim ryzyku: dobieramy rekomendacje treści, kolejność materiałów i segmentację newslettera na podstawie tego, co czytasz i jakie tematy śledzisz. Możesz je wyłączyć, cofając zgodę na personalizację.",
          "Automatyczne filtry antyspamowe mogą wstrzymać komentarz do przeglądu. Nie jest to decyzja ostateczna: każdą taką treść ocenia człowiek, a tryb odwołania opisuje dokument o moderacji (/moderacja-komentarzy).",
        ],
      },
      {
        id: "naruszenia",
        icon: "ShieldAlert",
        heading: "Naruszenia ochrony danych",
        bullets: [
          "Naruszenie zgłaszamy organowi nadzorczemu bez zbędnej zwłoki, w miarę możliwości w ciągu 72 godzin od stwierdzenia (art. 33 RODO).",
          "Jeżeli naruszenie może powodować wysokie ryzyko dla Twoich praw i wolności, zawiadamiamy również Ciebie, bez zbędnej zwłoki i prostym językiem (art. 34 RODO).",
          "Zawiadomienie opisuje charakter naruszenia, prawdopodobne konsekwencje, podjęte środki zaradcze i to, co możesz zrobić sam.",
          `Podejrzenie naruszenia możesz zgłosić nam na adres ${LEGAL_CONTACT_EMAIL} - traktujemy takie zgłoszenia priorytetowo.`,
        ],
      },
      {
        id: "skarga",
        icon: "Landmark",
        heading: "Skarga do organu nadzorczego",
        paragraphs: [
          `Jeżeli uważasz, że przetwarzamy Twoje dane niezgodnie z prawem, masz prawo wnieść skargę do organu nadzorczego. Właściwy dla nas organ to ${SUPERVISORY_AUTHORITY.pl}.`,
          "Skargę możesz wnieść także w państwie swojego zwykłego pobytu lub miejsca pracy, jeśli jest to inne państwo członkowskie UE. Niezależnie od skargi przysługuje Ci droga sądowa (art. 79 RODO) oraz prawo do odszkodowania (art. 82 RODO).",
          "Nie musisz najpierw kontaktować się z nami - ale jeśli to zrobisz, zwykle rozwiążemy sprawę szybciej niż potrwa postępowanie administracyjne.",
        ],
      },
      {
        id: "kontakt",
        icon: "Mail",
        heading: "Kontakt",
        paragraphs: [
          `Wszystkie sprawy z zakresu ochrony danych: ${LEGAL_CONTACT_EMAIL}. W tytule wiadomości wystarczy słowo „RODO” - kierujemy ją wtedy od razu do osoby odpowiedzialnej za ochronę danych.`,
          "Nie wyznaczyliśmy inspektora ochrony danych, ponieważ nie zachodzi żadna z przesłanek art. 37 ust. 1 RODO. Nie zmienia to niczego w Twoich prawach ani w terminach odpowiedzi - zmienia tylko to, że nie ma osobnego adresu IOD.",
        ],
      },
    ],
  },
  en: {
    eyebrow: "GDPR",
    ...RODO_META.en,
    updated: `Last updated: ${COMPLIANCE_PACK_UPDATED}`,
    footnote: `This document covers how to exercise your GDPR rights. The full description of purposes, legal bases and recipients is in the privacy notice (/polityka-prywatnosci); the operational layer is in the data processing policy (/polityka-przetwarzania-danych).`,
    sections: [
      {
        id: "czym-jest",
        icon: "Scale",
        heading: "What the GDPR is and when it protects you",
        paragraphs: [
          "The GDPR is Regulation (EU) 2016/679 of the European Parliament and of the Council of 27 April 2016 on the protection of natural persons with regard to the processing of personal data. In Poland it is supplemented by the Personal Data Protection Act of 10 May 2018.",
          `It protects you whenever ${LEGAL_ENTITY} processes information that can identify you - including indirectly, for example through an account identifier, an IP address or a device identifier. Having an account is irrelevant: GDPR rights also apply to people who only subscribed to the newsletter, sent a contact form or attended an event.`,
          `The data controller is ${LEGAL_ENTITY}. For all data protection matters: ${LEGAL_CONTACT_EMAIL}.`,
        ],
      },
      {
        id: "prawa",
        icon: "ListChecks",
        heading: "Your rights - the full list",
        bullets: [
          "Access and a copy of your data (Article 15) - confirmation of whether we process your data, which data, for what purpose, who receives it and how long we keep it, together with a copy.",
          "Rectification (Article 16) - correction of inaccurate data and completion of incomplete data. Most profile data you can correct yourself.",
          "Erasure, the right to be forgotten (Article 17) - deletion when the data is no longer needed, when you withdraw consent or when you successfully object.",
          "Restriction of processing (Article 18) - freezing the data while we resolve a dispute over its accuracy or over our legitimate interest.",
          "Data portability (Article 20) - receiving data processed on the basis of consent or a contract in a structured, commonly used, machine-readable format.",
          "Objection (Article 21) - against processing based on legitimate interest. An objection to direct marketing is UNCONDITIONAL: we always honour it and never ask why.",
          "Withdrawal of consent (Article 7(3)) - at any time and as easily as it was given. Withdrawal takes effect for the future and does not affect the lawfulness of what we did before.",
          "Not being subject to an automated decision (Article 22) - the right to human intervention where a decision produces legal or similarly significant effects.",
          "Complaint to a supervisory authority (Article 77) - independently of contacting us and without having to exhaust our internal route first.",
        ],
      },
      {
        id: "jak-zlozyc",
        icon: "Send",
        heading: "How to submit a request",
        paragraphs: [
          `The fastest channel is the app: the Privacy page in your profile (${PRIVACY_HUB_PATH}) lets you download a full copy of your data, change consents, set your visibility in the people directory and start account deletion yourself. These are exactly the operations we would perform on request - without the wait.`,
          `The written channel: ${LEGAL_CONTACT_EMAIL}. Just tell us what the request is about - no form and no justification required (except for an objection to processing other than marketing, where the GDPR requires you to point to your particular situation).`,
        ],
        bullets: [
          "You do not need to cite a specific GDPR article - describing what you want is enough.",
          "Requests are free of charge. Article 12(5) allows a fee or a refusal only for manifestly unfounded or excessive requests, for example serially repeated ones; if we ever rely on that, we will justify it in writing.",
          "If we cannot identify you, we will ask for additional information (Article 12(6)). We ask for the minimum needed to confirm identity - never for a scan of an ID document just in case.",
          "A request on behalf of someone else requires a power of attorney. Without it we will not release another person's data, not even to a family member.",
        ],
      },
      {
        id: "terminy",
        icon: "AlarmClock",
        heading: "How quickly we respond",
        bullets: [
          "Without undue delay and within one month of receiving the request at the latest (Article 12(3)).",
          "That period may be extended by a further two months where the request is complex or where several requests coincide. We inform you of the extension and its reason within the first month.",
          "If we take no action, within one month we explain why and inform you about the complaint to a supervisory authority and about judicial remedies.",
          "Objections to direct marketing and withdrawals of marketing consent are actioned immediately - we do not wait out the month.",
        ],
      },
      {
        id: "eksport",
        icon: "Download",
        heading: "Data export - exactly what you get",
        paragraphs: [
          "The export you start from the panel returns a JSON file with a manifest: section by section it lists what the file contains and also WHAT IT DELIBERATELY OMITS and why. The manifest travels inside the package, so a missing category is visible to you, not only to us.",
          "High-volume sections (messages, reading history, comments) have a declared row limit. When a package is truncated, the manifest marks that section as truncated - so the file never pretends to be complete. If you need history beyond the limit, write to us and we will prepare it manually.",
        ],
        bullets: [
          "Included: account and profile, subscriptions and orders, consents with their decision history, content (comments, threads, replies), messages and contacts, event registrations, reports and complaints.",
          "Excluded: other people's data (for example the content of their messages), trade secrets, and security logs whose release would weaken the protection of your own account. Every exclusion is named in the manifest.",
        ],
      },
      {
        id: "usuniecie",
        icon: "Trash2",
        heading: "Account deletion and the limits of erasure",
        paragraphs: [
          "You can start account deletion yourself in the panel. The operation is irreversible: we will not restore the profile, the history or access to paid content.",
          "The right to erasure is not absolute. Article 17(3) allows us to keep data where processing is necessary to comply with a legal obligation or for the establishment, exercise or defence of legal claims.",
        ],
        bullets: [
          "We keep accounting and settlement documents for the period required by tax law - invoices do not disappear with the account.",
          "We keep the minimum trace needed to handle a dispute while that dispute is ongoing.",
          "An email address covered by a marketing opt-out stays on a suppression list - that is the only way an unsubscribe is remembered reliably and you do not receive another message after a list is re-imported.",
          "Your public contributions (comments, threads) may be kept in anonymised form so that other people's discussions do not fall apart. The link to you is removed.",
        ],
      },
      {
        id: "profilowanie",
        icon: "Fingerprint",
        heading: "Profiling and automated decisions",
        paragraphs: [
          "We do not take decisions about you based solely on automated processing that would produce legal effects or similarly significantly affect you within the meaning of Article 22(1).",
          "We do use low-risk profiling: we select content recommendations, ordering and newsletter segmentation based on what you read and which topics you follow. You can switch this off by withdrawing the personalisation consent.",
          "Automated anti-spam filters may hold a comment for review. That is not a final decision: every such item is assessed by a human, and the appeal route is described in the moderation document (/moderacja-komentarzy).",
        ],
      },
      {
        id: "naruszenia",
        icon: "ShieldAlert",
        heading: "Personal data breaches",
        bullets: [
          "We notify the supervisory authority without undue delay and, where feasible, within 72 hours of becoming aware of a breach (Article 33).",
          "Where a breach is likely to result in a high risk to your rights and freedoms, we also notify you, without undue delay and in plain language (Article 34).",
          "The notification describes the nature of the breach, its likely consequences, the measures taken and what you can do yourself.",
          `You can report a suspected breach to us at ${LEGAL_CONTACT_EMAIL} - we treat such reports as a priority.`,
        ],
      },
      {
        id: "skarga",
        icon: "Landmark",
        heading: "Complaint to a supervisory authority",
        paragraphs: [
          `If you believe we process your data unlawfully, you have the right to lodge a complaint with a supervisory authority. The authority competent for us is the ${SUPERVISORY_AUTHORITY.en}.`,
          "You may also complain in the EU Member State of your habitual residence or place of work, if that is a different country. Independently of a complaint you have the right to an effective judicial remedy (Article 79) and to compensation (Article 82).",
          "You do not have to contact us first - but if you do, we will usually resolve the matter faster than administrative proceedings would.",
        ],
      },
      {
        id: "kontakt",
        icon: "Mail",
        heading: "Contact",
        paragraphs: [
          `All data protection matters: ${LEGAL_CONTACT_EMAIL}. Putting "GDPR" in the subject line is enough - we then route the message straight to the person responsible for data protection.`,
          "We have not appointed a data protection officer because none of the conditions in Article 37(1) applies. This changes nothing about your rights or our response times - it only means there is no separate DPO address.",
        ],
      },
    ],
  },
};
