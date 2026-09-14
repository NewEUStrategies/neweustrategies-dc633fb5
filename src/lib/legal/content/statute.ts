// Serializowalna treść dokumentu prawnego (ikony jako nazwy, nie komponenty).
// Jedno źródło prawdy dla publicznej strony oraz dla wersjonowania w /admin.
//
// ZAKRES: TOŻSAMOŚĆ WYDAWCY. Strona łączy dwie rzeczy, które prawo traktuje
// osobno, a czytelnik szuka w jednym miejscu:
//   1. dane rejestrowe wymagane od usługodawcy (art. 5 ustawy o świadczeniu
//      usług drogą elektroniczną, art. 12 ustawy o prawach konsumenta,
//      art. 13 ust. 1 lit. a RODO),
//   2. streszczenie statutu fundacji - cele, organy, majątek, tryb zmian.
//
// CO TU ŚWIADOMIE NIE STOI: numery PESEL członków organów. Widnieją w odpisie
// KRS, ale odpis jest rejestrem o kontrolowanym dostępie, a strona internetowa
// jest indeksowana. Publikacja identyfikatora krajowego bez potrzeby łamie
// zasadę minimalizacji (art. 5 ust. 1 lit. c RODO) - zakres reprezentacji da
// się opisać bez niej.
import type { LegalDocContent } from "../types";
import { STATUTE_META } from "../meta";
import {
  COMPLIANCE_PACK_UPDATED,
  LEGAL_CONTACT_EMAIL,
  LEGAL_ENTITY_ADDRESS,
  LEGAL_ENTITY_COURT,
  LEGAL_ENTITY_FOUNDED,
  LEGAL_ENTITY_FULL,
  LEGAL_ENTITY_KRS,
  LEGAL_ENTITY_NIP,
  LEGAL_ENTITY_REGISTERED,
  LEGAL_ENTITY_STATUTE_DATE,
  LEGAL_ENTITY_SUPERVISION,
  LEGAL_SITE_URL,
} from "@/lib/legal/entity";

export const STATUTE_CONTENT: LegalDocContent = {
  pl: {
    eyebrow: "O fundacji",
    ...STATUTE_META.pl,
    updated: `Ostatnia aktualizacja: ${COMPLIANCE_PACK_UPDATED}`,
    footnote: `Strona przedstawia dane rejestrowe i streszczenie statutu. Wiążącym dokumentem jest statut w brzmieniu złożonym w aktach rejestrowych; aktualny odpis z Krajowego Rejestru Sądowego jest dostępny publicznie w wyszukiwarce Ministerstwa Sprawiedliwości pod numerem KRS ${LEGAL_ENTITY_KRS}.`,
    sections: [
      {
        id: "dane-rejestrowe",
        icon: "Building2",
        heading: "Dane rejestrowe wydawcy",
        bullets: [
          `Pełna nazwa: ${LEGAL_ENTITY_FULL}.`,
          "Forma prawna: fundacja posiadająca osobowość prawną, działająca na podstawie ustawy z 6 kwietnia 1984 r. o fundacjach oraz własnego statutu.",
          `Adres siedziby i adres do korespondencji: ${LEGAL_ENTITY_ADDRESS}.`,
          `Numer KRS: ${LEGAL_ENTITY_KRS}. Fundacja jest wpisana także do rejestru przedsiębiorców.`,
          `NIP: ${LEGAL_ENTITY_NIP}.`,
          `Sąd rejestrowy: ${LEGAL_ENTITY_COURT.pl}.`,
          `Adres poczty elektronicznej: ${LEGAL_CONTACT_EMAIL}. Serwis: ${LEGAL_SITE_URL}.`,
          `Organy sprawujące nadzór: ${LEGAL_ENTITY_SUPERVISION.pl}.`,
          "Fundacja nie posiada statusu organizacji pożytku publicznego.",
        ],
      },
      {
        id: "powstanie",
        icon: "CalendarClock",
        heading: "Powstanie i podstawa działania",
        bullets: [
          `Fundacja została ustanowiona aktem notarialnym ${LEGAL_ENTITY_FOUNDED}.`,
          `Statut w obecnym brzmieniu sporządzono ${LEGAL_ENTITY_STATUTE_DATE}; wszedł w życie z dniem wpisu fundacji do Krajowego Rejestru Sądowego.`,
          `Wpis do Krajowego Rejestru Sądowego: ${LEGAL_ENTITY_REGISTERED}.`,
          "Czas trwania fundacji jest nieoznaczony.",
          "Fundacja jest apolityczna i niewyznaniowa; nie angażuje się w działalność polityczną ani religijną.",
        ],
      },
      {
        id: "cele",
        icon: "HeartHandshake",
        heading: "Cele statutowe",
        paragraphs: [
          "Celem fundacji jest wspieranie konstruktywnego przywództwa oraz rozwoju bezpieczeństwa, gospodarki i innowacji w Europie, w szczególności poprzez cele wymienione niżej.",
        ],
        bullets: [
          "Kształcenie i rozwijanie potencjału młodych euroatlantyckich elit oraz osób działających na rzecz wzmacniania więzi z kulturą euroatlantycką - w obszarach polityki, dyplomacji, gospodarki, bezpieczeństwa i spraw międzynarodowych.",
          "Tworzenie, publikowanie i upowszechnianie raportów, analiz i ekspertyz w dziedzinach kluczowych dla przyszłości Europy - między innymi wojskowości, energetyki, finansów, transportu i cyfryzacji.",
          "Działalność edukacyjną, naukową i kulturalną, w tym realizację programów stypendialnych.",
          "Rozwijanie i promowanie współpracy międzynarodowej oraz wspólnoty wartości demokratycznych.",
          "Wspieranie dialogu społeczno-politycznego w różnych częściach świata, z naciskiem na promowanie wartości europejskich i wzmacnianie społeczeństwa obywatelskiego.",
          "Propagowanie innowacji, zrównoważonego rozwoju i ochrony europejskiego dziedzictwa kulturowego.",
          "Współdziałanie z organizacjami pozarządowymi w obszarze badań i edukacji oraz dzielenie się wiedzą i zasobami w sferze think-tankowej.",
        ],
      },
      {
        id: "realizacja",
        icon: "ListChecks",
        heading: "Jak realizujemy cele",
        bullets: [
          "Organizowanie i współorganizowanie konferencji, kongresów, debat, sympozjów, podcastów i wywiadów eksperckich.",
          "Prowadzenie programów edukacyjnych: szkoleń, warsztatów, webinariów i programów stypendialnych.",
          "Inicjowanie i wspieranie badań naukowych oraz prac analitycznych.",
          "Nawiązywanie partnerstw medialnych i dystrybucja treści w różnych kanałach komunikacji.",
          "Świadczenie usług doradczych w zakresie strategii rozwoju oraz analizy trendów społecznych i gospodarczych.",
          "Tworzenie i wdrażanie narzędzi cyfrowych wspierających komunikację, analizę danych i zarządzanie projektami w obszarach strategicznych - do tej kategorii należy również ten serwis.",
          "Prowadzenie kampanii informacyjnych i produkcja materiałów promujących wartości fundacji, jej projekty badawcze i inicjatywy edukacyjne.",
        ],
      },
      {
        id: "organy",
        icon: "Users",
        heading: "Organy fundacji",
        paragraphs: [
          "Organami fundacji są Rada Fundacji - organ stanowiący, kontrolny i opiniujący - oraz Zarząd Fundacji, będący organem wykonawczym i zarządzającym.",
        ],
        bullets: [
          "Rada Fundacji powołuje i odwołuje członków Zarządu (w tym Prezesa), ustala kierunki działania, zatwierdza roczne sprawozdania finansowe i merytoryczne, udziela absolutorium oraz sprawuje stały nadzór nad Zarządem.",
          "Rada Fundacji uchwala zmiany statutu, decyduje o połączeniu lub likwidacji fundacji oraz podejmuje uchwały w sprawie zobowiązań finansowych powyżej 30 000 zł.",
          "Członkowie Rady nie pobierają wynagrodzenia za pełnienie funkcji; mogą otrzymać zwrot niezbędnych kosztów. Członkostwa w Radzie nie można łączyć z członkostwem w Zarządzie ani ze stosunkiem pracy z fundacją.",
          "Zarząd liczy od 1 do 5 osób, w tym Prezesa Zarządu. Odpowiada za realizację celów statutowych i uchwał Rady, dysponowanie majątkiem, sporządzanie sprawozdań oraz reprezentowanie fundacji na zewnątrz.",
          "Sposób reprezentacji ujawniony w rejestrze: fundację reprezentuje Prezes Zarządu samodzielnie; pozostali członkowie Zarządu składają oświadczenia woli wyłącznie łącznie z Prezesem Zarządu.",
          "Posiedzenia Rady odbywają się co najmniej raz w roku i są protokołowane.",
        ],
      },
      {
        id: "majatek",
        icon: "Wallet",
        heading: "Majątek, dochody i działalność gospodarcza",
        bullets: [
          "Fundusz założycielski wynosi 3 000 zł i zgodnie z wolą fundatora może być przeznaczony również na działalność gospodarczą. Fundator wniósł dodatkowo 25 000 zł darowizny na cele statutowe.",
          "Dochody mogą pochodzić w szczególności z darowizn, spadków, zapisów, dotacji i subwencji, zbiórek publicznych i kampanii crowdfundingowych, działalności gospodarczej, odsetek i lokat oraz sponsoringu i partnerstw strategicznych.",
          "Dochód fundacji może być wykorzystany wyłącznie na realizację celów statutowych i pokrycie kosztów działalności. Dochód z działalności gospodarczej w całości przeznaczany jest na cele statutowe.",
          "Działalność gospodarcza jest prowadzona wyłącznie w zakresie służącym realizacji celów statutowych i obejmuje m.in. działalność wydawniczą, produkcję materiałów audiowizualnych, badania naukowe i prace rozwojowe w naukach społecznych, badanie rynku i opinii publicznej, organizację kongresów i wystaw, przetwarzanie danych oraz pozaszkolne formy kształcenia.",
          "Rachunkowość prowadzimy zgodnie z ustawą o rachunkowości. Pierwszy rok obrotowy zakończył się 31 grudnia 2025 r.",
        ],
      },
      {
        id: "zmiany",
        icon: "History",
        heading: "Zmiana statutu i likwidacja",
        bullets: [
          "Zmian statutu dokonuje Rada Fundacji uchwałą podjętą zwykłą większością głosów przy obecności co najmniej połowy członków Rady.",
          "Zmiana statutu nie może naruszać głównych celów fundacji.",
          "Decyzję o likwidacji podejmuje Rada Fundacji większością trzech czwartych głosów przy obecności co najmniej połowy członków; Rada wyznacza wówczas likwidatora i określa zasady likwidacji.",
          "Środki pozostałe po likwidacji przekazuje się organizacjom pozarządowym o celach zbliżonych do celów fundacji.",
          "W sprawach nieuregulowanych statutem stosuje się przepisy ustawy o fundacjach i inne obowiązujące przepisy prawa.",
        ],
      },
      {
        id: "serwis",
        icon: "Globe2",
        heading: "Związek statutu z tym serwisem",
        paragraphs: [
          "Serwis neweuropeanstrategies.com jest narzędziem realizacji celów statutowych: publikujemy analizy i raporty, prowadzimy programy edukacyjne, organizujemy wydarzenia i kluby dyskusyjne oraz udostępniamy przestrzeń do debaty.",
          "Subskrypcje, bilety i darowizny finansują tę działalność. Nadwyżka nie jest dzielona między żadne osoby - w całości zasila cele statutowe, co wynika wprost ze statutu i z ustawy o fundacjach.",
          "Warunki umowne korzystania z serwisu opisuje regulamin (/regulamin), a warstwę handlową - dokument o subskrypcjach i zakupach (/regulamin-subskrypcji-i-zakupow).",
        ],
      },
      {
        id: "kontakt",
        icon: "Mail",
        heading: "Kontakt i dokumenty",
        paragraphs: [
          `Korespondencja: ${LEGAL_ENTITY_FULL}, ${LEGAL_ENTITY_ADDRESS}. Poczta elektroniczna: ${LEGAL_CONTACT_EMAIL}.`,
          `Pełny tekst statutu oraz aktualny odpis z rejestru udostępniamy na żądanie; odpis jest też dostępny publicznie w wyszukiwarce Krajowego Rejestru Sądowego pod numerem ${LEGAL_ENTITY_KRS}.`,
        ],
      },
    ],
  },
  en: {
    eyebrow: "About the foundation",
    ...STATUTE_META.en,
    updated: `Last updated: ${COMPLIANCE_PACK_UPDATED}`,
    footnote: `This page presents registration details and a summary of the statute. The binding document is the statute as filed with the registry court; a current extract from the National Court Register is publicly available in the Ministry of Justice search under KRS number ${LEGAL_ENTITY_KRS}.`,
    sections: [
      {
        id: "dane-rejestrowe",
        icon: "Building2",
        heading: "Publisher's registration details",
        bullets: [
          `Full name: ${LEGAL_ENTITY_FULL}.`,
          "Legal form: a foundation with legal personality, operating under the Polish Act on Foundations of 6 April 1984 and its own statute.",
          `Registered office and correspondence address: ${LEGAL_ENTITY_ADDRESS}.`,
          `National Court Register (KRS) number: ${LEGAL_ENTITY_KRS}. The foundation is also entered in the register of entrepreneurs.`,
          `Tax identification number (NIP): ${LEGAL_ENTITY_NIP}.`,
          `Registry court: ${LEGAL_ENTITY_COURT.en}.`,
          `Email: ${LEGAL_CONTACT_EMAIL}. Website: ${LEGAL_SITE_URL}.`,
          `Supervisory bodies: ${LEGAL_ENTITY_SUPERVISION.en}.`,
          "The foundation does not hold public benefit organisation status.",
        ],
      },
      {
        id: "powstanie",
        icon: "CalendarClock",
        heading: "Establishment and legal basis",
        bullets: [
          `The foundation was established by notarial deed on ${LEGAL_ENTITY_FOUNDED}.`,
          `The statute in its current wording was drawn up on ${LEGAL_ENTITY_STATUTE_DATE} and entered into force on the date of registration in the National Court Register.`,
          `Registered in the National Court Register on ${LEGAL_ENTITY_REGISTERED}.`,
          "The foundation is established for an indefinite period.",
          "The foundation is non-political and non-denominational; it engages in neither political nor religious activity.",
        ],
      },
      {
        id: "cele",
        icon: "HeartHandshake",
        heading: "Statutory objectives",
        paragraphs: [
          "The objective of the foundation is to support constructive leadership and the development of security, the economy and innovation in Europe, in particular through the objectives listed below.",
        ],
        bullets: [
          "Educating and developing the potential of young Euro-Atlantic elites and of people working to strengthen ties with Euro-Atlantic culture - in politics, diplomacy, the economy, security and international affairs.",
          "Producing, publishing and disseminating reports, analyses and expert opinions in fields critical to Europe's future - among them defence, energy, finance, transport and digitalisation.",
          "Educational, academic and cultural activity, including scholarship programmes.",
          "Developing and promoting international cooperation and the community of democratic values.",
          "Supporting socio-political dialogue in different parts of the world, with an emphasis on promoting European values and strengthening civil society.",
          "Promoting innovation, sustainable development and the protection of European cultural heritage.",
          "Cooperating with non-governmental organisations in research and education and sharing knowledge and resources within the think-tank community.",
        ],
      },
      {
        id: "realizacja",
        icon: "ListChecks",
        heading: "How we pursue these objectives",
        bullets: [
          "Organising and co-organising conferences, congresses, debates, symposia, podcasts and expert interviews.",
          "Running educational programmes: training, workshops, webinars and scholarship programmes.",
          "Initiating and supporting academic research and analytical work.",
          "Building media partnerships and distributing content across communication channels.",
          "Providing advisory services on development strategy and analysis of social and economic trends.",
          "Building and deploying digital tools that support communication, data analysis and project management in strategic areas - this service belongs to that category.",
          "Running information campaigns and producing material promoting the foundation's values, research projects and educational initiatives.",
        ],
      },
      {
        id: "organy",
        icon: "Users",
        heading: "Governing bodies",
        paragraphs: [
          "The bodies of the foundation are the Foundation Council - the deliberative, supervisory and advisory body - and the Management Board, which is the executive and managing body.",
        ],
        bullets: [
          "The Foundation Council appoints and dismisses Board members (including the President), sets the direction of activity, approves annual financial and activity reports, grants discharge and exercises ongoing supervision over the Board.",
          "The Council adopts amendments to the statute, decides on merger or liquidation, and passes resolutions on financial commitments above PLN 30,000.",
          "Council members receive no remuneration for serving; they may be reimbursed for necessary costs. Council membership cannot be combined with Board membership or with employment by the foundation.",
          "The Board consists of 1 to 5 people, including the President. It is responsible for pursuing the statutory objectives and Council resolutions, managing assets, preparing reports and representing the foundation externally.",
          "Representation as disclosed in the register: the President of the Board represents the foundation acting alone; other Board members may make declarations of will only jointly with the President.",
          "The Council meets at least once a year and its meetings are minuted.",
        ],
      },
      {
        id: "majatek",
        icon: "Wallet",
        heading: "Assets, income and economic activity",
        bullets: [
          "The founding fund is PLN 3,000 and, in line with the founder's will, may also be used for economic activity. The founder additionally contributed a PLN 25,000 donation for statutory purposes.",
          "Income may come in particular from donations, inheritances and bequests, grants and subsidies, public collections and crowdfunding campaigns, economic activity, interest and deposits, and sponsorship and strategic partnerships.",
          "Income may be used solely to pursue the statutory objectives and cover the costs of activity. All income from economic activity is allocated to statutory objectives.",
          "Economic activity is conducted solely to the extent that it serves the statutory objectives and covers, among others, publishing, audiovisual production, research and development in the social sciences, market and public opinion research, organising congresses and exhibitions, data processing and non-school forms of education.",
          "We keep accounts in accordance with the Accounting Act. The first financial year ended on 31 December 2025.",
        ],
      },
      {
        id: "zmiany",
        icon: "History",
        heading: "Amending the statute and liquidation",
        bullets: [
          "The statute is amended by the Foundation Council by a resolution adopted by a simple majority with at least half of the Council members present.",
          "An amendment may not affect the principal objectives of the foundation.",
          "Liquidation is decided by the Foundation Council by a three-quarters majority with at least half of its members present; the Council then appoints a liquidator and sets the rules of liquidation.",
          "Assets remaining after liquidation are transferred to non-governmental organisations with objectives similar to those of the foundation.",
          "Matters not governed by the statute are subject to the Act on Foundations and other applicable law.",
        ],
      },
      {
        id: "serwis",
        icon: "Globe2",
        heading: "How the statute relates to this service",
        paragraphs: [
          "neweuropeanstrategies.com is a tool for pursuing the statutory objectives: we publish analyses and reports, run educational programmes, organise events and discussion clubs, and provide a space for debate.",
          "Subscriptions, tickets and donations fund that activity. No surplus is distributed to any individual - all of it goes to statutory objectives, which follows directly from the statute and from the Act on Foundations.",
          "The contractual terms for using the service are in the terms and conditions (/regulamin), and the commercial layer is in the subscriptions and purchases document (/regulamin-subskrypcji-i-zakupow).",
        ],
      },
      {
        id: "kontakt",
        icon: "Mail",
        heading: "Contact and documents",
        paragraphs: [
          `Correspondence: ${LEGAL_ENTITY_FULL}, ${LEGAL_ENTITY_ADDRESS}. Email: ${LEGAL_CONTACT_EMAIL}.`,
          `We provide the full text of the statute and a current register extract on request; the extract is also publicly available in the National Court Register search under number ${LEGAL_ENTITY_KRS}.`,
        ],
      },
    ],
  },
};
