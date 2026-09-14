// Serializowalna treść dokumentu prawnego (ikony jako nazwy, nie komponenty).
// Jedno źródło prawdy dla publicznej strony oraz dla wersjonowania w /admin.
//
// ZAKRES: KLUBY DYSKUSYJNE. Powierzchnia, na której obietnica poufności jest
// PRODUKTEM, a nie dodatkiem - i dlatego wymaga dokumentu, który nazywa granice
// tej obietnicy zamiast ją zaokrąglać.
//
// TRZY RZECZY, KTÓRYCH NIE WOLNO TU PRZEMILCZEĆ:
//   1. reguła Chatham House wiąże UCZESTNIKÓW, nie organy państwa - poufność
//      nie jest tajemnicą prawnie chronioną i ustępuje nakazowi sądu,
//   2. wypowiedź anonimowa NIE jest anonimowa wobec systemu: autor jest
//      zapisany, a moderacja może go ujawnić w wąsko określonym trybie,
//   3. wykluczenie z klubu ma skutek finansowy, więc musi mieć tryb odwoławczy.
import type { LegalDocContent } from "../types";
import { CLUBS_META } from "../meta";
import { COMPLIANCE_PACK_UPDATED, LEGAL_CONTACT_EMAIL, LEGAL_ENTITY } from "@/lib/legal/entity";

export const CLUBS_CONTENT: LegalDocContent = {
  pl: {
    eyebrow: "Kluby",
    ...CLUBS_META.pl,
    updated: `Ostatnia aktualizacja: ${COMPLIANCE_PACK_UPDATED}`,
    footnote: `Regulamin dotyczy wszystkich klubów dyskusyjnych i spotkań zamkniętych prowadzonych przez ${LEGAL_ENTITY}. Poszczególne kluby mogą przyjąć zasady dodatkowe - nie mogą jednak obniżyć standardu opisanego tutaj.`,
    sections: [
      {
        id: "czym-sa",
        icon: "Users",
        heading: "Czym są kluby dyskusyjne",
        paragraphs: [
          "Kluby dyskusyjne to zamknięte przestrzenie debaty skupione wokół tematu lub specjalizacji. Prowadzą wątki dyskusyjne, kalendarz spotkań, dokumenty robocze i katalog członków.",
          "Klub nie jest forum publicznym. Treści powstające w klubie są dostępne wyłącznie dla jego członków i osób z uprawnieniami zarządczymi - nie są indeksowane przez wyszukiwarki i nie pojawiają się w publicznych kanałach serwisu.",
          "Udział w klubie nie tworzy stosunku pracy, zlecenia ani członkostwa w organie fundacji. Nie uprawnia do reprezentowania fundacji ani do wypowiadania się w jej imieniu.",
        ],
      },
      {
        id: "przyjecie",
        icon: "UserCheck",
        heading: "Przyjęcie do klubu",
        bullets: [
          "Przyjęcie następuje na wniosek, na zaproszenie albo z tytułu posiadanego planu członkowskiego - zależnie od zasad danego klubu, opisanych na jego stronie.",
          "Wniosek zawiera dane potrzebne do oceny dopasowania: doświadczenie zawodowe, afiliację i motywację. Dane te przetwarzamy wyłącznie w celu rozpatrzenia wniosku i prowadzenia członkostwa.",
          "Decyzja o przyjęciu jest uznaniowa i nie wymaga uzasadnienia. Odmowa nie zamyka drogi do ponownego wniosku w przyszłości.",
          "Zaproszenie imienne jest jednorazowe i wygasa. Przekazanie go innej osobie nie daje jej dostępu.",
          "Warunkiem uczestnictwa jest akceptacja tego regulaminu oraz zasad poufności obowiązujących w danym klubie.",
        ],
      },
      {
        id: "chatham",
        icon: "EyeOff",
        heading: "Reguła Chatham House",
        paragraphs: [
          "Spotkania i wątki mogą być objęte regułą Chatham House. Oznacza ona: uczestnicy mogą swobodnie korzystać z uzyskanych informacji, ale NIE WOLNO ujawniać tożsamości ani afiliacji mówcy ani żadnego innego uczestnika.",
          "Reguła obowiązuje wtedy, gdy zostanie wyraźnie ogłoszona dla spotkania, wątku lub jego części. Oznaczenie widoczne jest przy danej powierzchni - jeśli go nie ma, reguła nie obowiązuje.",
        ],
        bullets: [
          "Możesz cytować treść wypowiedzi i wykorzystywać ją w swojej pracy - bez wskazania, kto ją wygłosił.",
          "Nie wolno publikować nagrań, zrzutów ekranu ani transkrypcji pozwalających zidentyfikować mówcę.",
          "Nie wolno ujawniać listy uczestników spotkania ani składu klubu osobom spoza niego.",
          "Reguła obowiązuje bezterminowo - także po ustaniu Twojego członkostwa.",
          "GRANICA, KTÓREJ NIE ZAOKRĄGLAMY: reguła Chatham House wiąże uczestników na podstawie umowy. Nie jest tajemnicą prawnie chronioną i nie zwalnia nikogo z obowiązków wynikających z przepisów prawa - w szczególności z obowiązku zawiadomienia o przestępstwie ani z obowiązku wykonania nakazu sądu lub uprawnionego organu.",
        ],
      },
      {
        id: "anonimowe",
        icon: "Fingerprint",
        heading: "Wypowiedzi anonimowe - co to naprawdę znaczy",
        paragraphs: [
          "Niektóre kluby pozwalają zabrać głos anonimowo. Anonimowość dotyczy POZOSTAŁYCH UCZESTNIKÓW: nie widzą, kto jest autorem wypowiedzi.",
          "System zna autora. Powiązanie jest zapisane, bo bez niego nie dałoby się odpowiedzieć na nadużycie ani wykonać obowiązku prawnego. Piszemy to wprost, żeby nikt nie budował swojego bezpieczeństwa na założeniu, którego nie spełniamy.",
        ],
        bullets: [
          "Ujawnienie autora jest możliwe wyłącznie w moderacji i wymaga podania pisemnego powodu; system odrzuca żądanie bez uzasadnienia.",
          "Każde ujawnienie jest odnotowywane w dzienniku moderacji wraz z powodem i osobą, która go dokonała.",
          "Ujawnienie stosujemy w sprawach poważnych: groźby, nękanie, treści bezprawne, zorganizowane nadużycie.",
          "Autor wypowiedzi, którego tożsamość ujawniono, jest o tym informowany - chyba że zakazuje tego przepis prawa albo treść nakazu organu.",
        ],
      },
      {
        id: "zasady-udzialu",
        icon: "ListChecks",
        heading: "Zasady udziału",
        bullets: [
          "Dyskutuj z argumentem, nie z osobą. Ostry spór merytoryczny jest wartością; atak personalny nie jest.",
          "Nie wnoś do klubu informacji, których nie masz prawa ujawnić - tajemnicy przedsiębiorstwa, informacji niejawnych, danych objętych tajemnicą zawodową.",
          "Nie wykorzystuj klubu do akwizycji. Oferta handlowa wymaga zgody zarządu klubu i jednoznacznego oznaczenia.",
          "Nie publikuj treści, których nie wolno publikować nigdzie w serwisie - katalog i tryb moderacji opisuje osobny dokument (/moderacja-komentarzy).",
          "Konto jest osobiste. Nie udostępniaj dostępu do klubu osobom trzecim, także w ramach własnej organizacji.",
          "Materiały z klubu - dokumenty robocze, opracowania, nagrania - służą Twojej pracy własnej. Dalsza dystrybucja wymaga zgody autora i zarządu klubu.",
        ],
      },
      {
        id: "moderacja-klubu",
        icon: "Gavel",
        heading: "Moderacja wewnątrz klubu",
        bullets: [
          "Klub ma własną moderację. Zarząd klubu może zatwierdzać, ukrywać i usuwać wątki oraz odpowiedzi, a także wykluczać członków.",
          "Zatwierdzenie i ukrycie są odwracalne - usunięcie nie jest. Operacje nieodwracalne wymagają dodatkowego potwierdzenia.",
          "Operacje moderacyjne trafiają do dziennika widocznego dla zarządu klubu, razem z celem i czasem operacji.",
          "Od decyzji moderacyjnej przysługuje odwołanie na zasadach opisanych w dokumencie o moderacji treści - także wtedy, gdy decyzję podjął zarząd klubu, a nie redakcja.",
        ],
      },
      {
        id: "wykluczenie",
        icon: "UserX",
        heading: "Zawieszenie i wykluczenie",
        bullets: [
          "Wykluczenie stosujemy wobec naruszenia poufności, powtarzającego się naruszania zasad udziału albo zachowania zagrażającego bezpieczeństwu innych uczestników.",
          "Naruszenie reguły Chatham House traktujemy jako naruszenie kwalifikowane: może skutkować wykluczeniem po pierwszym przypadku.",
          "Przed wykluczeniem informujemy o zarzucie i dajemy możliwość wypowiedzenia się - chyba że zwłoka groziłaby dalszą szkodą.",
          `Od wykluczenia przysługuje odwołanie na ${LEGAL_CONTACT_EMAIL} w terminie 30 dni. Odwołanie rozpatruje osoba spoza zarządu danego klubu.`,
          "Jeżeli dostęp do klubu wynikał z opłaconego planu, a wykluczenie nastąpiło bez naruszenia po Twojej stronie, zwracamy proporcjonalną część opłaty. Przy wykluczeniu za naruszenie zasad zwrot nie przysługuje.",
          "Rezygnacja z członkostwa jest możliwa w każdej chwili. Twoje dotychczasowe wypowiedzi pozostają w klubie, chyba że wniesiesz o ich usunięcie.",
        ],
      },
      {
        id: "dane",
        icon: "Database",
        heading: "Dane i poufność po stronie systemu",
        bullets: [
          "Treści klubowe są dostępne wyłącznie dla członków klubu i osób z uprawnieniami zarządczymi. Ograniczenie jest egzekwowane na poziomie bazy danych, a nie tylko w interfejsie.",
          "Katalog członków widzą wyłącznie członkowie danego klubu. Widoczność własnego profilu w katalogu regulujesz w ustawieniach prywatności.",
          "Nagrania spotkań powstają tylko wtedy, gdy zostanie to zapowiedziane przed rozpoczęciem. Uczestnik może zażądać, by jego wypowiedź nie była nagrywana.",
          "Dane z wniosku o członkostwo przechowujemy przez czas trwania członkostwa oraz przez okres przedawnienia roszczeń; wnioski odrzucone usuwamy po 12 miesiącach.",
          "Pełny opis przetwarzania danych znajdziesz w polityce prywatności (/polityka-prywatnosci) i polityce przetwarzania danych (/polityka-przetwarzania-danych).",
        ],
      },
      {
        id: "kontakt",
        icon: "Mail",
        heading: "Kontakt",
        paragraphs: [
          `Sprawy członkostwa, zgłoszenia naruszeń poufności i odwołania: ${LEGAL_CONTACT_EMAIL}. Zgłoszenie naruszenia reguły Chatham House traktujemy priorytetowo - im szybciej o nim wiemy, tym większa szansa ograniczenia szkody.`,
        ],
      },
    ],
  },
  en: {
    eyebrow: "Clubs",
    ...CLUBS_META.en,
    updated: `Last updated: ${COMPLIANCE_PACK_UPDATED}`,
    footnote: `These rules apply to all discussion clubs and closed meetings run by ${LEGAL_ENTITY}. Individual clubs may adopt additional rules - but may not lower the standard described here.`,
    sections: [
      {
        id: "czym-sa",
        icon: "Users",
        heading: "What discussion clubs are",
        paragraphs: [
          "Discussion clubs are closed spaces for debate built around a topic or a specialisation. They host discussion threads, a meeting calendar, working documents and a member directory.",
          "A club is not a public forum. Content created in a club is available only to its members and to people with management rights - it is not indexed by search engines and does not appear in the public feeds of the service.",
          "Participation creates no employment or service relationship and no membership in a body of the foundation. It confers no right to represent the foundation or to speak on its behalf.",
        ],
      },
      {
        id: "przyjecie",
        icon: "UserCheck",
        heading: "Admission to a club",
        bullets: [
          "Admission follows an application, an invitation or an existing membership plan - depending on the rules of the particular club, described on its page.",
          "An application contains the details needed to assess fit: professional background, affiliation and motivation. We process that data solely to consider the application and to run the membership.",
          "The admission decision is discretionary and needs no justification. A refusal does not bar a further application later.",
          "A personal invitation is single-use and expires. Passing it to someone else does not give them access.",
          "Participation is conditional on accepting these rules and the confidentiality rules of the particular club.",
        ],
      },
      {
        id: "chatham",
        icon: "EyeOff",
        heading: "The Chatham House Rule",
        paragraphs: [
          "Meetings and threads may be held under the Chatham House Rule. It means: participants are free to use the information received, but the identity and affiliation of the speaker or of any other participant MAY NOT be revealed.",
          "The Rule applies where it has been expressly announced for a meeting, a thread or part of one. The marking is visible on the surface concerned - if it is absent, the Rule does not apply.",
        ],
        bullets: [
          "You may quote the substance of a contribution and use it in your own work - without saying who made it.",
          "You may not publish recordings, screenshots or transcripts that would identify a speaker.",
          "You may not disclose the attendee list of a meeting or the membership of a club to people outside it.",
          "The Rule applies indefinitely - including after your membership ends.",
          "A LIMIT WE DO NOT ROUND OFF: the Chatham House Rule binds participants on a contractual basis. It is not a legally protected secret and it relieves nobody of obligations under the law - in particular the duty to report a criminal offence or to comply with an order of a court or competent authority.",
        ],
      },
      {
        id: "anonimowe",
        icon: "Fingerprint",
        heading: "Anonymous contributions - what that really means",
        paragraphs: [
          "Some clubs allow you to speak anonymously. The anonymity is towards OTHER PARTICIPANTS: they cannot see who wrote a contribution.",
          "The system knows the author. The link is stored, because without it we could not respond to abuse or comply with a legal obligation. We say so plainly, so that nobody builds their safety on an assumption we do not meet.",
        ],
        bullets: [
          "Revealing an author is possible only in moderation and requires a written reason; the system rejects a request without one.",
          "Every disclosure is recorded in the moderation log together with the reason and the person who made it.",
          "We use disclosure in serious matters: threats, harassment, unlawful content, organised abuse.",
          "An author whose identity has been revealed is informed - unless a legal provision or the terms of an authority's order prohibit it.",
        ],
      },
      {
        id: "zasady-udzialu",
        icon: "ListChecks",
        heading: "Rules of participation",
        bullets: [
          "Argue with the argument, not the person. Sharp substantive disagreement is valuable; a personal attack is not.",
          "Do not bring into a club information you have no right to disclose - trade secrets, classified information, data covered by professional secrecy.",
          "Do not use a club for solicitation. A commercial offer requires the club board's consent and unambiguous labelling.",
          "Do not post content that may not be posted anywhere in the service - the catalogue and the moderation procedure are in a separate document (/moderacja-komentarzy).",
          "An account is personal. Do not share club access with third parties, including within your own organisation.",
          "Club materials - working documents, studies, recordings - are for your own work. Further distribution requires the consent of the author and of the club board.",
        ],
      },
      {
        id: "moderacja-klubu",
        icon: "Gavel",
        heading: "Moderation inside a club",
        bullets: [
          "A club has its own moderation. The club board may approve, hide and delete threads and replies, and may exclude members.",
          "Approval and hiding are reversible - deletion is not. Irreversible operations require an additional confirmation.",
          "Moderation operations go into a log visible to the club board, together with the target and the time of the operation.",
          "A moderation decision can be appealed on the terms set out in the content moderation document - including where the decision was taken by a club board rather than the editorial team.",
        ],
      },
      {
        id: "wykluczenie",
        icon: "UserX",
        heading: "Suspension and exclusion",
        bullets: [
          "We use exclusion for breaches of confidentiality, repeated breaches of the rules of participation or conduct that endangers the safety of other participants.",
          "We treat a breach of the Chatham House Rule as an aggravated breach: it may lead to exclusion after the first instance.",
          "Before excluding someone we state the allegation and give them an opportunity to respond - unless delay would risk further harm.",
          `An exclusion may be appealed to ${LEGAL_CONTACT_EMAIL} within 30 days. The appeal is handled by a person outside the board of the club concerned.`,
          "If club access came from a paid plan and the exclusion happened without a breach on your side, we refund a proportionate part of the fee. No refund is due where exclusion follows a breach of the rules.",
          "You may resign your membership at any time. Your existing contributions remain in the club unless you ask for them to be removed.",
        ],
      },
      {
        id: "dane",
        icon: "Database",
        heading: "Data and confidentiality on the system side",
        bullets: [
          "Club content is available only to club members and people with management rights. The restriction is enforced at the database level, not only in the interface.",
          "The member directory is visible only to members of that club. You control the visibility of your own profile in the directory in privacy settings.",
          "Meetings are recorded only where this is announced before they start. A participant may ask for their contribution not to be recorded.",
          "We keep membership application data for the duration of the membership and the limitation period for claims; rejected applications are deleted after 12 months.",
          "The full description of data processing is in the privacy notice (/polityka-prywatnosci) and the data processing policy (/polityka-przetwarzania-danych).",
        ],
      },
      {
        id: "kontakt",
        icon: "Mail",
        heading: "Contact",
        paragraphs: [
          `Membership matters, reports of confidentiality breaches and appeals: ${LEGAL_CONTACT_EMAIL}. We treat a report of a Chatham House Rule breach as a priority - the sooner we know, the better the chance of limiting the harm.`,
        ],
      },
    ],
  },
};
