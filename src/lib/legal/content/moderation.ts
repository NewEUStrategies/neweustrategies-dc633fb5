// Serializowalna treść dokumentu prawnego (ikony jako nazwy, nie komponenty).
// Jedno źródło prawdy dla publicznej strony oraz dla wersjonowania w /admin.
//
// ZAKRES: DSA. Rozporządzenie (UE) 2022/2065 stosuje się bezpośrednio od
// 17 lutego 2024 r. i nakłada na dostawcę usług hostingu trzy twarde obowiązki,
// których nie da się spełnić samym regulaminem: mechanizm zgłaszania (art. 16),
// UZASADNIENIE każdej decyzji wobec autora treści (art. 17) i opisanie polityki
// moderacji w warunkach korzystania z usług (art. 14).
//
// UCZCIWIE O ZAKRESIE: art. 19 DSA wyłącza stosowanie sekcji 3 (m.in. art. 20,
// 21 i 24) wobec mikro- i małych przedsiębiorstw. Wewnętrzny tryb odwoławczy
// prowadzimy więc DOBROWOLNIE i tak to nazywamy - deklarowanie obowiązku,
// którego się nie ma, jest równie mylące jak jego pominięcie.
import type { LegalDocContent } from "../types";
import { MODERATION_META } from "../meta";
import { LEGAL_CONTACT_EMAIL, LEGAL_ENTITY } from "@/lib/legal/entity";
import { COMPLIANCE_PACK_UPDATED } from "@/lib/legal/registration";

export const MODERATION_CONTENT: LegalDocContent = {
  pl: {
    eyebrow: "Moderacja",
    ...MODERATION_META.pl,
    updated: `Ostatnia aktualizacja: ${COMPLIANCE_PACK_UPDATED}`,
    footnote: `Zasady dotyczą komentarzy pod publikacjami, wątków i odpowiedzi w klubach dyskusyjnych, wypowiedzi w dyskusjach przy wydarzeniach oraz treści profilowych. Dla klubów dyskusyjnych obowiązują dodatkowo zasady poufności opisane w ich regulaminie (/regulamin-klubow-dyskusyjnych).`,
    sections: [
      {
        id: "podstawa",
        icon: "Scale",
        heading: "Podstawa prawna i nasza rola",
        paragraphs: [
          `${LEGAL_ENTITY} udostępnia przestrzeń, w której użytkownicy publikują własne wypowiedzi. W rozumieniu rozporządzenia (UE) 2022/2065 (akt o usługach cyfrowych, DSA) jesteśmy dostawcą usługi hostingu w odniesieniu do treści przekazywanych przez użytkowników.`,
          "Nie monitorujemy treści w sposób ogólny i nie mamy takiego obowiązku (art. 8 DSA). Reagujemy na zgłoszenia oraz na to, co sami wykryjemy.",
          "Nie odpowiadamy za cudzą treść, dopóki nie wiemy o jej bezprawnym charakterze; po uzyskaniu takiej wiedzy działamy niezwłocznie (art. 6 DSA).",
          "Krajowe ramy proceduralne uzupełnia ustawa zmieniająca ustawę o świadczeniu usług drogą elektroniczną, wyznaczająca Prezesa Urzędu Komunikacji Elektronicznej na koordynatora do spraw usług cyfrowych. Ustawa została uchwalona przez Sejm 31 lipca 2026 r. i przyjęta wraz z poprawką Senatu 4 września 2026 r.; wchodzi w życie po ogłoszeniu. Do czasu jej wejścia w życie stosujemy wprost przepisy DSA.",
        ],
      },
      {
        id: "zasady",
        icon: "ListChecks",
        heading: "Czego nie publikujemy",
        paragraphs: [
          "Poniższa lista jest zamknięta co do kategorii i otwarta co do formy - liczy się treść wypowiedzi, nie sposób jej zapisania.",
        ],
        bullets: [
          "Treści bezprawne: nawoływanie do przemocy lub nienawiści, groźby, zniesławienie, naruszenie dóbr osobistych, naruszenie praw autorskich, treści zakazane przepisami karnymi.",
          "Nękanie i ataki personalne: atak na osobę zamiast na argument, ujawnianie cudzych danych bez zgody, podszywanie się pod inną osobę lub instytucję.",
          "Spam i manipulacja: reklama bez oznaczenia, treści masowo powielane, sztuczne podbijanie zasięgu, konta zakładane w celu obejścia blokady.",
          "Dezinformacja szkodliwa: świadome rozpowszechnianie fałszywych twierdzeń o faktach w sprawach bezpieczeństwa, zdrowia publicznego lub procesów wyborczych. Ocenę odróżniamy od twierdzenia o faktach - z opinią można się nie zgadzać i to nie jest powód do usunięcia.",
          "Treści szkodliwe dla małoletnich oraz wszelkie materiały przedstawiające wykorzystywanie seksualne.",
          "Ujawnianie tożsamości lub afiliacji mówcy z dyskusji objętej regułą Chatham House.",
        ],
      },
      {
        id: "srodki",
        icon: "Gavel",
        heading: "Jakie środki stosujemy",
        paragraphs: [
          "Środek dobieramy do wagi naruszenia. Zaczynamy od najłagodniejszego, który realnie rozwiązuje problem.",
        ],
        bullets: [
          "Wstrzymanie do przeglądu - treść czeka na ocenę i nie jest jeszcze widoczna publicznie. Stan przejściowy, nie kara.",
          "Ukrycie treści - wypowiedź przestaje być widoczna publicznie, ale pozostaje dostępna dla autora i moderatora. Operacja odwracalna.",
          "Oznaczenie jako spam - stosowane wobec treści masowych i reklamowych.",
          "Usunięcie treści - nieodwracalne; stosowane wobec treści bezprawnych i rażących naruszeń.",
          "Ograniczenie konta - czasowe wyłączenie możliwości komentowania.",
          "Zawieszenie lub usunięcie konta - wobec powtarzających się naruszeń albo pojedynczego naruszenia o dużej wadze. Zgodnie z art. 23 DSA uprzedzamy o zawieszeniu, chyba że chodzi o treść bezprawną o charakterze przestępczym.",
          "Zawiadomienie organów ścigania - gdy treść wskazuje na podejrzenie przestępstwa zagrażającego życiu lub bezpieczeństwu osób (art. 18 DSA).",
        ],
      },
      {
        id: "zglaszanie",
        icon: "MessageSquareWarning",
        heading: "Jak zgłosić treść (mechanizm z art. 16 DSA)",
        paragraphs: [
          `Zgłoszenie może złożyć każdy - także osoba bez konta. Kanał zgłoszeń: ${LEGAL_CONTACT_EMAIL}, z dopiskiem „zgłoszenie treści” w tytule. Zalogowany użytkownik może zgłosić treść bezpośrednio z widoku wypowiedzi.`,
        ],
        bullets: [
          "Aby zgłoszenie było skuteczne, podaj: adres (link) do treści, wyjaśnienie, dlaczego uważasz ją za bezprawną lub sprzeczną z zasadami, oraz swoje dane kontaktowe.",
          "Oświadczenie o dobrej wierze i rzetelności zgłoszenia nie jest wymagane formalnie, ale zgłoszenia ewidentnie nieprawdziwe traktujemy jak nadużycie mechanizmu (art. 23 ust. 2 DSA) i możemy zawiesić możliwość ich składania.",
          "Potwierdzamy otrzymanie zgłoszenia niezwłocznie i informujemy o decyzji wraz z jej uzasadnieniem.",
          "Zgłoszenie zawierające dane kontaktowe i wystarczająco precyzyjne, by rozstrzygnąć o bezprawności bez szczegółowej analizy prawnej, daje nam wiedzę o treści w rozumieniu art. 6 DSA - i wtedy działamy niezwłocznie.",
          "Anonimowe zgłoszenie rozpatrzymy, ale nie będziemy mieli jak przekazać Ci decyzji ani przyjąć odwołania.",
        ],
      },
      {
        id: "uzasadnienie",
        icon: "FileCheck2",
        heading: "Uzasadnienie decyzji (art. 17 DSA)",
        paragraphs: [
          "Autor treści, wobec której zastosowaliśmy środek, otrzymuje jasne i konkretne uzasadnienie. Nie wysyłamy komunikatów w rodzaju „treść naruszała regulamin” bez wskazania czego dotyczy zarzut.",
        ],
        bullets: [
          "Jaki środek zastosowaliśmy i jaki jest jego zasięg terytorialny oraz czasowy.",
          "Fakty i okoliczności, na których oparliśmy decyzję - w tym informacja, czy decyzja wynikła ze zgłoszenia, czy z wykrycia własnego.",
          "Czy w rozstrzygnięciu użyto środków zautomatyzowanych.",
          "Podstawa: przepis prawa (gdy treść uznaliśmy za bezprawną) albo konkretne postanowienie naszych zasad (gdy treść uznaliśmy za sprzeczną z zasadami).",
          "Pouczenie o możliwości odwołania oraz o innych dostępnych drogach dochodzenia praw.",
        ],
      },
      {
        id: "odwolanie",
        icon: "RotateCcw",
        heading: "Odwołanie",
        paragraphs: [
          "Od każdej decyzji moderacyjnej przysługuje odwołanie. Prowadzimy wewnętrzny tryb odwoławczy DOBROWOLNIE: jako mikroprzedsiębiorca jesteśmy wyłączeni ze stosowania sekcji 3 rozdziału III DSA na podstawie art. 19 DSA, ale uważamy, że decyzja bez drogi odwoławczej jest decyzją bez kontroli.",
        ],
        bullets: [
          `Odwołanie wnosisz na ${LEGAL_CONTACT_EMAIL} w terminie 6 miesięcy od doręczenia uzasadnienia.`,
          "Odwołanie rozpatruje osoba, która nie podejmowała pierwotnej decyzji. Rozstrzygnięcie nie zapada wyłącznie automatycznie - decyzję zatwierdza człowiek.",
          "Rozpatrujemy odwołania terminowo, w sposób niedyskryminacyjny i staranny. Jeżeli odwołanie jest zasadne, niezwłocznie cofamy środek i przywracamy treść.",
          "O wyniku informujemy z uzasadnieniem. Utrzymanie decyzji również wymaga wyjaśnienia dlaczego.",
          "Odwołanie do nas nie zamyka drogi sądowej ani skargi do właściwego organu - możesz z nich skorzystać niezależnie i w każdej chwili.",
        ],
      },
      {
        id: "automatyzacja",
        icon: "Bot",
        heading: "Automatyzacja i udział człowieka",
        bullets: [
          "Stosujemy automatyczne filtry wykrywające spam, masowe powielanie treści i oczywiste nadużycia. Filtr może wstrzymać treść do przeglądu - nie usuwa jej samodzielnie.",
          "Decyzję o usunięciu treści, ograniczeniu lub zawieszeniu konta podejmuje człowiek. Nie prowadzimy w pełni automatycznego usuwania wypowiedzi.",
          "Użycie środków zautomatyzowanych w konkretnej sprawie zawsze ujawniamy w uzasadnieniu decyzji.",
          "Zakres, w jakim korzystamy z narzędzi sztucznej inteligencji, opisuje osobny dokument (/przejrzystosc-ai).",
        ],
      },
      {
        id: "przejrzystosc",
        icon: "Activity",
        heading: "Przejrzystość i statystyki",
        bullets: [
          "Prowadzimy wewnętrzną ewidencję zgłoszeń, zastosowanych środków i odwołań wraz z podstawą każdej decyzji.",
          "Obowiązki sprawozdawcze z art. 15 i 24 DSA nie obejmują nas w obecnej skali działalności (art. 19 DSA). Jeżeli próg zostanie przekroczony, zaczniemy publikować sprawozdania z przejrzystości i poinformujemy o tym na tej stronie.",
          "Operacje moderacyjne w klubach dyskusyjnych są rejestrowane w dzienniku widocznym dla zarządu klubu. Ujawnienie autora wypowiedzi anonimowej wymaga podania pisemnego powodu i jest odnotowywane osobno.",
          "Nie stosujemy tak zwanych ciemnych wzorców: decyzja o zgłoszeniu, odwołaniu albo rezygnacji jest tak samo łatwa jak decyzja przeciwna.",
        ],
      },
      {
        id: "kontakt",
        icon: "Mail",
        heading: "Punkt kontaktowy",
        paragraphs: [
          `Punktem kontaktowym dla użytkowników oraz dla organów w sprawach związanych z moderacją treści jest adres ${LEGAL_CONTACT_EMAIL}. Korespondencję przyjmujemy w języku polskim i angielskim.`,
          "Nakazy organów dotyczące usunięcia treści lub udzielenia informacji wykonujemy zgodnie z art. 9 i 10 DSA i informujemy o nich użytkownika, którego dotyczą, chyba że zakazuje tego przepis prawa lub treść samego nakazu.",
        ],
      },
    ],
  },
  en: {
    eyebrow: "Moderation",
    ...MODERATION_META.en,
    updated: `Last updated: ${COMPLIANCE_PACK_UPDATED}`,
    footnote: `These rules cover comments under publications, threads and replies in discussion clubs, contributions to event discussions and profile content. Discussion clubs are additionally subject to the confidentiality rules in their own terms (/regulamin-klubow-dyskusyjnych).`,
    sections: [
      {
        id: "podstawa",
        icon: "Scale",
        heading: "Legal basis and our role",
        paragraphs: [
          `${LEGAL_ENTITY} provides a space in which users publish their own contributions. Under Regulation (EU) 2022/2065 (the Digital Services Act, DSA) we are a hosting service provider in respect of content supplied by users.`,
          "We do not monitor content generally and are under no obligation to do so (Article 8 DSA). We act on reports and on what we detect ourselves.",
          "We are not liable for third-party content until we know it is unlawful; once we obtain such knowledge we act expeditiously (Article 6 DSA).",
          "The national procedural framework is supplemented by the act amending the Act on Providing Services by Electronic Means, which designates the President of the Office of Electronic Communications (UKE) as the Digital Services Coordinator. The Sejm passed it on 31 July 2026 and adopted it together with a Senate amendment on 4 September 2026; it enters into force after publication. Until then we apply the DSA directly.",
        ],
      },
      {
        id: "zasady",
        icon: "ListChecks",
        heading: "What we do not publish",
        paragraphs: [
          "The list below is closed as to categories and open as to form - what counts is the substance of a contribution, not how it was written.",
        ],
        bullets: [
          "Unlawful content: incitement to violence or hatred, threats, defamation, infringement of personal rights, copyright infringement, content prohibited by criminal law.",
          "Harassment and personal attacks: attacking the person instead of the argument, disclosing another person's data without consent, impersonating a person or institution.",
          "Spam and manipulation: unlabelled advertising, mass-duplicated content, artificial amplification, accounts created to evade a block.",
          "Harmful disinformation: knowingly spreading false factual claims about security, public health or electoral processes. We distinguish an assessment from a factual claim - you may disagree with an opinion and that is not a reason for removal.",
          "Content harmful to minors and any material depicting sexual abuse.",
          "Revealing the identity or affiliation of a speaker from a discussion held under the Chatham House Rule.",
        ],
      },
      {
        id: "srodki",
        icon: "Gavel",
        heading: "Measures we apply",
        paragraphs: [
          "We match the measure to the seriousness of the breach, starting with the mildest one that actually resolves the problem.",
        ],
        bullets: [
          "Held for review - the content awaits assessment and is not yet publicly visible. A transitional state, not a penalty.",
          "Hiding content - the contribution is no longer publicly visible but remains available to its author and to moderators. Reversible.",
          "Marking as spam - applied to bulk and advertising content.",
          "Removing content - irreversible; applied to unlawful content and flagrant breaches.",
          "Account restriction - temporary suspension of the ability to comment.",
          "Account suspension or deletion - for repeated breaches or a single serious one. In line with Article 23 DSA we give prior warning of a suspension, unless the content is unlawful and criminal in nature.",
          "Notifying law enforcement - where content gives rise to a suspicion of a criminal offence threatening the life or safety of persons (Article 18 DSA).",
        ],
      },
      {
        id: "zglaszanie",
        icon: "MessageSquareWarning",
        heading: "How to report content (the Article 16 DSA mechanism)",
        paragraphs: [
          `Anyone may submit a report - including people without an account. The reporting channel is ${LEGAL_CONTACT_EMAIL} with "content report" in the subject line. Signed-in users can report content directly from the contribution.`,
        ],
        bullets: [
          "For a report to be effective, provide: the address (link) of the content, an explanation of why you consider it unlawful or contrary to our rules, and your contact details.",
          "A statement of good faith is not formally required, but we treat manifestly false reports as misuse of the mechanism (Article 23(2) DSA) and may suspend the ability to submit them.",
          "We confirm receipt promptly and inform you of the decision together with its reasons.",
          "A report that contains contact details and is precise enough to establish illegality without a detailed legal examination gives us knowledge of the content within the meaning of Article 6 DSA - and we then act expeditiously.",
          "We will consider an anonymous report, but we will have no way to send you the decision or to accept an appeal.",
        ],
      },
      {
        id: "uzasadnienie",
        icon: "FileCheck2",
        heading: "Statement of reasons (Article 17 DSA)",
        paragraphs: [
          "The author of content subjected to a measure receives clear and specific reasons. We do not send messages of the kind the content breached our terms without saying what the allegation concerns.",
        ],
        bullets: [
          "Which measure we applied and its territorial and temporal scope.",
          "The facts and circumstances we relied on - including whether the decision followed a report or our own detection.",
          "Whether automated means were used in reaching the decision.",
          "The basis: the legal provision (where we found the content unlawful) or the specific clause of our rules (where we found it contrary to those rules).",
          "Information about the possibility of appeal and about other available routes of redress.",
        ],
      },
      {
        id: "odwolanie",
        icon: "RotateCcw",
        heading: "Appeals",
        paragraphs: [
          "Every moderation decision can be appealed. We run an internal complaint-handling procedure VOLUNTARILY: as a micro-enterprise we are exempt from Section 3 of Chapter III DSA under Article 19 DSA, but we consider a decision without an appeal route to be a decision without review.",
        ],
        bullets: [
          `Submit an appeal to ${LEGAL_CONTACT_EMAIL} within 6 months of receiving the statement of reasons.`,
          "The appeal is handled by a person who did not take the original decision. The outcome is not reached by automated means alone - a human approves the decision.",
          "We handle appeals in a timely, non-discriminatory and diligent manner. If an appeal is well founded we promptly reverse the measure and restore the content.",
          "We communicate the outcome with reasons. Upholding a decision also requires an explanation of why.",
          "Appealing to us does not close off judicial proceedings or a complaint to the competent authority - you may use either independently and at any time.",
        ],
      },
      {
        id: "automatyzacja",
        icon: "Bot",
        heading: "Automation and human involvement",
        bullets: [
          "We use automated filters that detect spam, mass duplication and obvious abuse. A filter may hold content for review - it does not remove it on its own.",
          "Decisions to remove content, restrict or suspend an account are taken by a human. We do not operate fully automated removal of contributions.",
          "Where automated means were used in a given case, we always disclose it in the statement of reasons.",
          "The extent to which we use artificial intelligence tools is described in a separate document (/przejrzystosc-ai).",
        ],
      },
      {
        id: "przejrzystosc",
        icon: "Activity",
        heading: "Transparency and statistics",
        bullets: [
          "We keep an internal record of reports, measures applied and appeals, together with the basis for each decision.",
          "The reporting obligations in Articles 15 and 24 DSA do not apply to us at our current scale (Article 19 DSA). If we cross that threshold we will start publishing transparency reports and will say so on this page.",
          "Moderation operations in discussion clubs are recorded in a log visible to the club's board. Revealing the author of an anonymous contribution requires a written reason and is recorded separately.",
          "We use no dark patterns: deciding to report, appeal or opt out is exactly as easy as deciding the opposite.",
        ],
      },
      {
        id: "kontakt",
        icon: "Mail",
        heading: "Point of contact",
        paragraphs: [
          `The point of contact for users and for authorities in matters relating to content moderation is ${LEGAL_CONTACT_EMAIL}. We accept correspondence in Polish and English.`,
          "We execute authorities' orders to act against content or to provide information in accordance with Articles 9 and 10 DSA and inform the affected user about them, unless a legal provision or the order itself prohibits it.",
        ],
      },
    ],
  },
};
