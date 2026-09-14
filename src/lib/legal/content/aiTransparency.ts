// Serializowalna treść dokumentu prawnego (ikony jako nazwy, nie komponenty).
// Jedno źródło prawdy dla publicznej strony oraz dla wersjonowania w /admin.
//
// ZAKRES: AI ACT ART. 50. Rozporządzenie (UE) 2024/1689 obowiązuje etapami;
// obowiązki PRZEJRZYSTOŚCI z art. 50 stosuje się od 2 sierpnia 2026 r. i - co
// istotne - NIE zostały przesunięte przez omnibus cyfrowy z 2026 r., który
// odroczył wyłącznie terminy dla systemów wysokiego ryzyka.
//
// DLACZEGO WYDAWCA POTRZEBUJE TEGO DOKUMENTU. Art. 50 wiąże nie tylko dostawcę
// modelu, ale też PODMIOT STOSUJĄCY: redakcja publikująca tekst wygenerowany
// maszynowo w sprawie interesu publicznego i serwis prowadzący asystenta
// rozmowy są adresatami obowiązku ujawnienia. Jednocześnie art. 50 ust. 4
// zwalnia z oznaczania tam, gdzie treść przeszła redakcję człowieka i wydawca
// bierze za nią odpowiedzialność - i to jest realny tryb pracy redakcji, więc
// dokument musi opisać JEDNO I DRUGIE, zamiast obiecywać znakowanie wszystkiego.
import type { LegalDocContent } from "../types";
import { AI_TRANSPARENCY_META } from "../meta";
import { LEGAL_CONTACT_EMAIL, LEGAL_ENTITY } from "@/lib/legal/entity";
import { COMPLIANCE_PACK_UPDATED } from "@/lib/legal/registration";

export const AI_TRANSPARENCY_CONTENT: LegalDocContent = {
  pl: {
    eyebrow: "Sztuczna inteligencja",
    ...AI_TRANSPARENCY_META.pl,
    updated: `Ostatnia aktualizacja: ${COMPLIANCE_PACK_UPDATED}`,
    footnote: `Dokument opisuje stan na dzień ostatniej aktualizacji. Zakres wykorzystania narzędzi sztucznej inteligencji zmienia się szybciej niż przepisy - aktualizujemy tę stronę przy każdej zmianie, która dotyczy czytelnika.`,
    sections: [
      {
        id: "podstawa",
        icon: "Scale",
        heading: "Podstawa prawna",
        paragraphs: [
          "Rozporządzenie Parlamentu Europejskiego i Rady (UE) 2024/1689 (akt w sprawie sztucznej inteligencji, AI Act) nakłada obowiązki przejrzystości w art. 50. Stosuje się je od 2 sierpnia 2026 r.",
          "Obowiązki te nie zostały odroczone przez zmiany przyjęte w 2026 r. w ramach tak zwanego omnibusa cyfrowego - odroczenie objęło terminy dotyczące systemów wysokiego ryzyka, a nie przejrzystość z art. 50.",
          `${LEGAL_ENTITY} nie jest dostawcą systemów sztucznej inteligencji. Występujemy jako podmiot stosujący narzędzia dostarczane przez podmioty trzecie - i to nasze obowiązki jako podmiotu stosującego opisuje ten dokument.`,
          "Nie prowadzimy systemów wysokiego ryzyka w rozumieniu załącznika III do AI Act ani żadnej praktyki zakazanej na podstawie art. 5 AI Act.",
        ],
      },
      {
        id: "gdzie-uzywamy",
        icon: "Bot",
        heading: "Gdzie używamy sztucznej inteligencji",
        bullets: [
          "Wsparcie redakcyjne: propozycje tytułów, skrótów, zapowiedzi i opisów metadanych, korekta językowa oraz tłumaczenie robocze między wersją polską a angielską.",
          "Wyszukiwanie i rekomendacje: dobór treści powiązanych, porządek list i dopasowanie tematów do Twoich zainteresowań.",
          "Moderacja wspomagana: automatyczne wykrywanie spamu i oczywistych nadużyć, wstrzymujące treść do przeglądu człowieka.",
          "Narzędzia wewnętrzne: podsumowania materiałów źródłowych na potrzeby pracy redakcyjnej i analitycznej.",
          "Materiały graficzne: ilustracje wygenerowane maszynowo używane w roli grafiki poglądowej - nigdy w roli materiału dokumentalnego.",
        ],
      },
      {
        id: "oznaczanie",
        icon: "BadgeCheck",
        heading: "Jak oznaczamy treści",
        paragraphs: [
          "Zasada jest jedna: czytelnik ma wiedzieć, z czym ma do czynienia, zanim zdecyduje, ile temu zaufać.",
        ],
        bullets: [
          "Tekst wygenerowany maszynowo i opublikowany BEZ redakcji człowieka oznaczamy wprost jako wygenerowany przez sztuczną inteligencję - taki jest wymóg art. 50 ust. 4 AI Act dla tekstów publikowanych w celu informowania opinii publicznej o sprawach leżących w interesie publicznym.",
          "Materiał, który przeszedł redakcję i weryfikację człowieka i za który bierzemy odpowiedzialność redakcyjną, nie wymaga takiego oznaczenia zgodnie z tym samym przepisem - i tak właśnie powstaje przeważająca część naszych publikacji. Nie oznacza to, że narzędzia nie brały udziału w pracy: oznacza, że odpowiada za nią redakcja.",
          "Obraz, dźwięk lub wideo wygenerowane albo istotnie zmodyfikowane maszynowo, przedstawiające osoby, zdarzenia lub miejsca w sposób mogący uchodzić za autentyczny, oznaczamy jako materiał wygenerowany sztucznie (art. 50 ust. 4 AI Act).",
          "Ilustracje poglądowe wygenerowane maszynowo opisujemy w podpisie. Nigdy nie prezentujemy ich jako fotografii dokumentalnej ani dowodu zdarzenia.",
          "Tłumaczenia maszynowe udostępnione bez weryfikacji człowieka oznaczamy przy treści.",
          "Nie tworzymy i nie publikujemy materiałów przedstawiających realne osoby wypowiadające słowa, których nie wypowiedziały, poza jednoznacznie oznaczoną satyrą lub materiałem edukacyjnym o dezinformacji.",
        ],
      },
      {
        id: "czego-nie-robimy",
        icon: "Ban",
        heading: "Czego nie oddajemy maszynie",
        bullets: [
          "Ustaleń faktycznych. Twierdzenie o faktach w publikacji jest weryfikowane przez człowieka wobec źródła - narzędzie może je zaproponować, nie może go potwierdzić.",
          "Decyzji moderacyjnych o usunięciu treści, ograniczeniu lub zawieszeniu konta. Filtr może wstrzymać treść do przeglądu; decyzję podejmuje człowiek (/moderacja-komentarzy).",
          "Decyzji o przyjęciu do klubu dyskusyjnego, o rozpatrzeniu reklamacji i o żądaniach z RODO.",
          "Rozpoznawania emocji ani kategoryzacji biometrycznej - nie stosujemy takich systemów w żadnym procesie.",
          "Oceny wiarygodności osób ani jakiegokolwiek scoringu uczestników debaty.",
          "Publikacji pod nazwiskiem autora tekstu, którego ten autor nie zredagował i nie zaakceptował.",
        ],
      },
      {
        id: "asystent",
        icon: "MessageSquare",
        heading: "Asystenci rozmowy",
        paragraphs: [
          "Jeżeli udostępnimy asystenta rozmowy opartego na sztucznej inteligencji, poinformujemy o tym wprost przy rozpoczęciu interakcji - tego wymaga art. 50 ust. 1 AI Act. Nigdy nie sugerujemy, że po drugiej stronie jest człowiek.",
          "Rozmowy prowadzone w serwisie między użytkownikami są rozmowami między ludźmi. Nie podstawiamy do nich systemu i nie generujemy w nich wypowiedzi w czyimś imieniu.",
        ],
      },
      {
        id: "dane",
        icon: "Database",
        heading: "Twoje dane a narzędzia sztucznej inteligencji",
        bullets: [
          "Nie przekazujemy Twoich danych osobowych dostawcom modeli w celu trenowania ich modeli. Korzystamy z usług na warunkach wykluczających wykorzystanie przekazanych treści do trenowania.",
          "Treści prywatne - wiadomości, dokumenty klubowe, zgłoszenia i korespondencja - nie są przekazywane do narzędzi generatywnych.",
          "Dostawcy narzędzi, którzy przetwarzają jakiekolwiek dane w naszym imieniu, są podmiotami przetwarzającymi związanymi umową powierzenia (art. 28 RODO) i figurują w kategoriach opisanych w polityce przetwarzania danych (/polityka-przetwarzania-danych).",
          "Personalizację rekomendacji wyłączysz, cofając zgodę na personalizację w ustawieniach prywatności.",
        ],
      },
      {
        id: "bledy",
        icon: "ShieldAlert",
        heading: "Błędy, sprostowania i zgłoszenia",
        paragraphs: [
          "Narzędzia generatywne mylą się w sposób, który brzmi wiarygodnie - i to jest dokładnie powód, dla którego weryfikacja człowieka nie jest u nas opcjonalna.",
        ],
        bullets: [
          `Błąd w publikacji zgłoś na ${LEGAL_CONTACT_EMAIL}. Sprostowania publikujemy przy materiale, z datą i opisem zmiany - nie usuwamy po cichu.`,
          "Jeżeli uważasz, że materiał został oznaczony niewłaściwie (jako wygenerowany, choć nie jest - albo odwrotnie), napisz do nas; poprawimy oznaczenie albo wyjaśnimy podstawę.",
          "Jeżeli Twój wizerunek lub głos został wykorzystany w materiale wygenerowanym maszynowo bez Twojej zgody, potraktujemy zgłoszenie priorytetowo i usuniemy materiał na czas wyjaśnienia.",
          "Nadzór nad stosowaniem AI Act sprawują wyznaczone organy krajowe; niezależnie od kontaktu z nami możesz zwrócić się do organu właściwego dla Twojego państwa członkowskiego.",
        ],
      },
      {
        id: "kontakt",
        icon: "Mail",
        heading: "Kontakt",
        paragraphs: [
          `Pytania o wykorzystanie sztucznej inteligencji w konkretnym materiale albo procesie: ${LEGAL_CONTACT_EMAIL}. Odpowiadamy konkretnie - jeżeli w danej publikacji narzędzie zostało użyte, powiemy do czego.`,
        ],
      },
    ],
  },
  en: {
    eyebrow: "Artificial intelligence",
    ...AI_TRANSPARENCY_META.en,
    updated: `Last updated: ${COMPLIANCE_PACK_UPDATED}`,
    footnote: `This document describes the position as at the date of last update. The way we use AI tools changes faster than the law does - we update this page whenever a change affects readers.`,
    sections: [
      {
        id: "podstawa",
        icon: "Scale",
        heading: "Legal basis",
        paragraphs: [
          "Regulation (EU) 2024/1689 of the European Parliament and of the Council (the AI Act) imposes transparency obligations in Article 50. They have applied since 2 August 2026.",
          "Those obligations were not postponed by the 2026 amendments known as the digital omnibus - the postponement covered deadlines for high-risk systems, not the Article 50 transparency duties.",
          `${LEGAL_ENTITY} is not a provider of AI systems. We act as a deployer of tools supplied by third parties - and it is our obligations as a deployer that this document describes.`,
          "We operate no high-risk systems within the meaning of Annex III to the AI Act and no practice prohibited under Article 5 of the AI Act.",
        ],
      },
      {
        id: "gdzie-uzywamy",
        icon: "Bot",
        heading: "Where we use artificial intelligence",
        bullets: [
          "Editorial support: suggested headlines, summaries, teasers and metadata descriptions, language editing, and draft translation between the Polish and English versions.",
          "Search and recommendations: selecting related content, ordering lists and matching topics to your interests.",
          "Assisted moderation: automated detection of spam and obvious abuse, holding content for human review.",
          "Internal tooling: summaries of source material for editorial and analytical work.",
          "Visual material: machine-generated illustrations used as conceptual artwork - never as documentary material.",
        ],
      },
      {
        id: "oznaczanie",
        icon: "BadgeCheck",
        heading: "How we label content",
        paragraphs: [
          "There is one principle: the reader should know what they are looking at before deciding how much to trust it.",
        ],
        bullets: [
          "Text that is machine-generated and published WITHOUT human editorial review is labelled expressly as AI-generated - that is the requirement of Article 50(4) of the AI Act for text published to inform the public on matters of public interest.",
          "Material that has been edited and verified by a person, and for which we take editorial responsibility, does not require that label under the same provision - and that is how the overwhelming majority of our publications are produced. This does not mean no tools were involved: it means the editorial team is answerable for the result.",
          "Images, audio or video that are machine-generated or materially modified and depict people, events or places in a way that could appear authentic are labelled as artificially generated (Article 50(4) of the AI Act).",
          "Machine-generated conceptual illustrations are described in the caption. We never present them as documentary photography or as evidence of an event.",
          "Machine translations made available without human verification are labelled next to the content.",
          "We do not create or publish material depicting real people saying words they did not say, other than clearly labelled satire or educational material about disinformation.",
        ],
      },
      {
        id: "czego-nie-robimy",
        icon: "Ban",
        heading: "What we never hand over to a machine",
        bullets: [
          "Establishing facts. A factual claim in a publication is verified by a person against the source - a tool may propose it, it may not confirm it.",
          "Moderation decisions to remove content or restrict or suspend an account. A filter may hold content for review; a human takes the decision (/moderacja-komentarzy).",
          "Decisions on admission to a discussion club, on complaints and on GDPR requests.",
          "Emotion recognition and biometric categorisation - we use no such systems in any process.",
          "Assessing people's credibility or any scoring of participants in debate.",
          "Publishing under an author's name a text that the author did not edit and approve.",
        ],
      },
      {
        id: "asystent",
        icon: "MessageSquare",
        heading: "Conversational assistants",
        paragraphs: [
          "If we make an AI-based conversational assistant available, we will say so plainly at the start of the interaction - as Article 50(1) of the AI Act requires. We never imply that a human is on the other side.",
          "Conversations between users in the service are conversations between people. We do not substitute a system into them and do not generate contributions on anyone's behalf.",
        ],
      },
      {
        id: "dane",
        icon: "Database",
        heading: "Your data and AI tools",
        bullets: [
          "We do not pass your personal data to model providers for training their models. We use these services on terms that exclude the use of submitted content for training.",
          "Private content - messages, club documents, reports and correspondence - is not sent to generative tools.",
          "Tool providers that process any data on our behalf are processors bound by a data processing agreement (Article 28 GDPR) and fall within the categories described in the data processing policy (/polityka-przetwarzania-danych).",
          "You can switch off recommendation personalisation by withdrawing the personalisation consent in privacy settings.",
        ],
      },
      {
        id: "bledy",
        icon: "ShieldAlert",
        heading: "Errors, corrections and reports",
        paragraphs: [
          "Generative tools get things wrong in ways that sound convincing - which is exactly why human verification is not optional here.",
        ],
        bullets: [
          `Report an error in a publication to ${LEGAL_CONTACT_EMAIL}. We publish corrections next to the material, with a date and a description of the change - we do not edit silently.`,
          "If you believe material has been labelled incorrectly (as generated when it is not, or the other way round), write to us; we will fix the label or explain the basis for it.",
          "If your image or voice has been used in machine-generated material without your consent, we treat the report as a priority and take the material down while we investigate.",
          "Supervision of the AI Act rests with designated national authorities; independently of contacting us, you may approach the authority competent in your Member State.",
        ],
      },
      {
        id: "kontakt",
        icon: "Mail",
        heading: "Contact",
        paragraphs: [
          `Questions about the use of artificial intelligence in a specific piece or process: ${LEGAL_CONTACT_EMAIL}. We answer concretely - if a tool was used in a given publication, we will say what for.`,
        ],
      },
    ],
  },
};
