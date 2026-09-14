// Serializowalna treść dokumentu prawnego (ikony jako nazwy, nie komponenty).
// Jedno źródło prawdy dla publicznej strony oraz dla wersjonowania w /admin.
//
// ZAKRES: UDZIAŁ W WYDARZENIU. Warstwę pieniężną (cena, faktura, odstąpienie,
// zwrot) opisuje dokument o subskrypcjach i zakupach; tutaj jest to, co dzieje
// się WOKÓŁ biletu - identyfikator, bramka, stoisko partnera, nagranie.
//
// DLACZEGO SKANOWANIE MA WŁASNE SEKCJE, A NIE JEDNO ZDANIE. Na wydarzeniu
// działają TRZY różne skanowania o trzech różnych podstawach prawnych:
// kontrola wejścia (wykonanie umowy), druk identyfikatora (wykonanie umowy)
// i skan leadu na stoisku partnera (ZGODA, bo to przekazanie danych innemu
// administratorowi). Sklejenie ich w „skanujemy identyfikatory” ukrywa jedyne
// miejsce, w którym uczestnik realnie coś traci, jeśli nie rozumie zasady.
import type { LegalDocContent } from "../types";
import { EVENTS_META } from "../meta";
import { COMPLIANCE_PACK_UPDATED, LEGAL_CONTACT_EMAIL, LEGAL_ENTITY } from "@/lib/legal/entity";

export const EVENTS_CONTENT: LegalDocContent = {
  pl: {
    eyebrow: "Wydarzenia",
    ...EVENTS_META.pl,
    updated: `Ostatnia aktualizacja: ${COMPLIANCE_PACK_UPDATED}`,
    footnote: `Regulamin dotyczy wydarzeń organizowanych przez ${LEGAL_ENTITY}. Poszczególne wydarzenia mogą mieć własny regulamin szczegółowy prezentowany przy rejestracji - w razie rozbieżności pierwszeństwo ma regulamin konkretnego wydarzenia, o ile nie obniża standardu opisanego tutaj.`,
    sections: [
      {
        id: "rejestracja",
        icon: "CalendarDays",
        heading: "Rejestracja i zawarcie umowy",
        bullets: [
          "Umowa o udział w wydarzeniu zostaje zawarta z chwilą potwierdzenia rejestracji, a dla wydarzeń płatnych - z chwilą zaksięgowania płatności.",
          "Formularz rejestracji zbiera dane niezbędne do wpuszczenia Cię na wydarzenie i wystawienia identyfikatora: imię i nazwisko, adres e-mail, a przy wydarzeniach branżowych także organizację i stanowisko.",
          "Zgody wymagane przy rejestracji są zbierane osobno, każda z własną treścią. Zapisujemy wersję regulaminu obowiązującą w chwili zapisu - dzięki temu wiadomo, na co dokładnie się zgodziłeś.",
          "Liczba miejsc bywa ograniczona. Po wyczerpaniu limitu rejestracja przechodzi na listę rezerwową, a zwolnione miejsca przydzielamy w kolejności zgłoszeń.",
          "Przy wydarzeniach z kwalifikacją uczestników rejestracja jest wnioskiem - potwierdzenie wysyłamy po weryfikacji. Do tego czasu nie pobieramy płatności.",
        ],
      },
      {
        id: "bilety",
        icon: "Ticket",
        heading: "Bilety i pakiety",
        bullets: [
          "Bilet jest imienny i uprawnia do udziału jedną, wskazaną osobę. Uprawnienia zależą od rodzaju biletu lub pakietu i są opisane przy zakupie.",
          "Przeniesienie biletu na inną osobę jest możliwe do momentu wskazanego w opisie wydarzenia - napisz do nas, zmienimy dane uczestnika. Odsprzedaż biletu z zyskiem jest niedozwolona.",
          "Pakiety partnerskie i wystawiennicze mają odrębne warunki, w tym liczbę wejściówek, zakres ekspozycji i zasady korzystania z narzędzi dla wystawców.",
          "Kody zniżkowe i zaproszenia mają własny okres ważności i limit użyć, prezentowane przy ich zastosowaniu.",
          "Warstwę handlową - ceny, faktury, prawo odstąpienia i zwroty - opisuje dokument o subskrypcjach i zakupach (/regulamin-subskrypcji-i-zakupow).",
        ],
      },
      {
        id: "identyfikator",
        icon: "QrCode",
        heading: "Identyfikator z kodem QR",
        paragraphs: [
          "Po potwierdzeniu rejestracji otrzymujesz identyfikator z kodem QR. Kod jest przepustką - traktuj go jak bilet imienny.",
        ],
        bullets: [
          "Kod nie zawiera Twoich danych osobowych. To losowy identyfikator, który dopiero po stronie naszego systemu wskazuje na zapis uczestnictwa.",
          "Nie publikuj kodu w mediach społecznościowych. Osoba, która go zeskanuje, może próbować wejść na wydarzenie na Twoje nazwisko.",
          "Na identyfikatorze drukowanym widnieją dane, które podałeś do ekspozycji - zwykle imię, nazwisko i organizacja. Zakres druku jest widoczny przed wydarzeniem i można go ograniczyć.",
          "Zgubiony identyfikator wydamy ponownie w punkcie rejestracji po potwierdzeniu tożsamości; poprzedni kod tracimy ważność.",
        ],
      },
      {
        id: "kontrola-wejscia",
        icon: "BadgeCheck",
        heading: "Kontrola wejścia i skanowanie na bramce",
        paragraphs: [
          "Przy wejściu i w wyznaczonych punktach kontrolnych skanujemy kod QR. Podstawą jest wykonanie umowy o udział w wydarzeniu oraz nasz prawnie uzasadniony interes w bezpieczeństwie i rozliczeniu frekwencji.",
        ],
        bullets: [
          "Zapisujemy: identyfikator uczestnictwa, punkt kontrolny, kierunek (wejście albo wyjście), czas i wynik skanu. Nie zapisujemy obrazu z kamery urządzenia.",
          "Punkty kontrolne mogą działać w trybie kontroli dostępu (decydują o wpuszczeniu) albo wyłącznie pomiaru obecności w strefie.",
          "Powtórny skan w krótkim odstępie jest rozpoznawany jako duplikat i nie tworzy nowego wpisu - chroni to przed sztucznym zawyżaniem frekwencji.",
          "Niektóre strefy mają limit pojemności wynikający z przepisów bezpieczeństwa; po jego osiągnięciu bramka odmawia wejścia do czasu zwolnienia miejsca.",
          "Urządzenia skanujące działają na poświadczeniu przypisanym do JEDNEGO wydarzenia, o wąskim zakresie uprawnień, wygasającym i możliwym do unieważnienia. Przechwycone poświadczenie nie otwiera innego wydarzenia.",
          "Zapisy z kontroli wejścia usuwamy po zamknięciu rozliczeń wydarzenia, chyba że konkretny zapis jest dowodem w toczącej się sprawie.",
        ],
      },
      {
        id: "leady",
        icon: "Store",
        heading: "Skanowanie na stoiskach partnerów - tu decydujesz Ty",
        paragraphs: [
          "Partnerzy i wystawcy mogą skanować identyfikatory na swoich stoiskach. To NIE jest to samo co kontrola wejścia: skan na stoisku prowadzi do przekazania Twoich danych kontaktowych innemu podmiotowi, który staje się ich odrębnym administratorem.",
          "Dlatego przekazanie kontaktu wymaga Twojej odrębnej zgody, wyrażanej przy skanie. Bez zgody partner nie otrzymuje Twoich danych kontaktowych.",
        ],
        bullets: [
          "Zgoda jest odnotowywana razem ze skanem: partner widzi w swoim zestawieniu, czy kontakt może wykorzystać, czy nie.",
          "Skan bez zgody zostaje w zestawieniu partnera jako sam fakt odwiedzin stoiska - bez imienia, bez adresu e-mail, bez telefonu. Partner rozlicza się z liczby odwiedzin, nie z Twoich danych.",
          "Zgoda udzielona jednemu partnerowi nie działa wobec pozostałych. Każde stoisko to osobna decyzja.",
          "Zgody udzielonej na miejscu nie da się cofnąć po naszej stronie ze skutkiem wobec partnera - od chwili przekazania to partner jest administratorem Twoich danych. Wycofanie zgody i pozostałe prawa z RODO kierujesz wtedy bezpośrednio do niego; na życzenie wskażemy jego dane kontaktowe.",
          "Nie sprzedajemy list uczestników. Partner dostaje wyłącznie kontakty zebrane na własnym stoisku i wyłącznie za zgodą uczestnika.",
        ],
      },
      {
        id: "nagrania",
        icon: "MonitorSmartphone",
        heading: "Nagrania, zdjęcia i transmisje",
        bullets: [
          "Informację o nagrywaniu, transmisji lub fotografowaniu podajemy przed wydarzeniem i przypominamy na miejscu.",
          "Rejestracja ogólnych ujęć sali odbywa się na podstawie naszego prawnie uzasadnionego interesu w dokumentowaniu i promocji działalności statutowej.",
          "Wizerunek wyeksponowany indywidualnie - portret, wywiad, wypowiedź z sali w kadrze - wykorzystujemy na podstawie odrębnej zgody.",
          "Możesz poprosić o nieumieszczanie Cię w materiałach. Na wydarzeniach z nagraniem wskazujemy strefę bez rejestracji obrazu.",
          "Uczestnik może nagrywać wyłącznie za zgodą organizatora. Na spotkaniach objętych regułą Chatham House nagrywanie i publikowanie materiałów pozwalających zidentyfikować mówcę jest zabronione (/regulamin-klubow-dyskusyjnych).",
          "Prelegenci i paneliści otrzymują odrębną informację o zakresie rejestracji i sposobie wykorzystania nagrania przed wystąpieniem.",
        ],
      },
      {
        id: "na-miejscu",
        icon: "ShieldCheck",
        heading: "Zasady na miejscu i bezpieczeństwo",
        bullets: [
          "Stosuj się do poleceń porządkowych organizatora, obsługi obiektu i służb. W sytuacji zagrożenia decyduje polecenie ewakuacyjne, a nie program wydarzenia.",
          "Identyfikator noś w widocznym miejscu przez cały czas pobytu. Udostępnienie go innej osobie kończy się odebraniem wstępu bez zwrotu opłaty.",
          "Obowiązuje zakaz wnoszenia przedmiotów niebezpiecznych oraz udziału w stanie nietrzeźwości lub pod wpływem środków odurzających.",
          "Nie tolerujemy nękania, molestowania ani zachowań dyskryminacyjnych. Zgłoszenie takiego zachowania przyjmuje obsługa wydarzenia; reagujemy na miejscu.",
          "Organizator może odmówić wstępu albo wyprosić uczestnika naruszającego zasady. W przypadku wyproszenia za naruszenie zasad opłata nie podlega zwrotowi.",
          "Obiekt, w którym odbywa się wydarzenie, może mieć własny regulamin - obowiązuje on równolegle.",
        ],
      },
      {
        id: "zmiany",
        icon: "AlarmClock",
        heading: "Zmiany, odwołanie wydarzenia i rezygnacja",
        bullets: [
          "Program, lista prelegentów i godziny mogą ulec zmianie. Zmiany nieistotne nie uprawniają do zwrotu opłaty.",
          "Zmiana istotna - innego dnia, innego miasta albo zasadniczej formuły wydarzenia - uprawnia Cię do rezygnacji z pełnym zwrotem opłaty. Informujemy o takiej zmianie niezwłocznie.",
          "Jeżeli odwołamy wydarzenie, zwracamy pełną opłatę albo - za Twoją zgodą - przenosimy ją na inny termin. Wybór należy do Ciebie.",
          "Nie odpowiadamy za koszty uboczne poniesione przez uczestnika (podróż, nocleg) poza przypadkami odpowiedzialności wynikającymi z bezwzględnie obowiązujących przepisów.",
          "Rezygnację z udziału zgłoś możliwie wcześnie - zwolnione miejsce przekazujemy z listy rezerwowej. Warunki zwrotu opłaty przy rezygnacji z Twojej inicjatywy opisuje dokument o subskrypcjach i zakupach oraz polityka zwrotów (/zwroty-i-reklamacje).",
          "Przypominamy: dla biletów na wydarzenie z oznaczonym dniem ustawowe prawo odstąpienia w terminie 14 dni nie przysługuje (art. 38 ust. 1 pkt 12 ustawy o prawach konsumenta). Nie ogranicza to naszej umownej gwarancji zwrotu ani uprawnień z tytułu niezgodności usługi z umową.",
        ],
      },
      {
        id: "dane",
        icon: "Database",
        heading: "Dane uczestników",
        bullets: [
          "Dane rejestracyjne przetwarzamy w celu wykonania umowy o udział, a dane ze skanów - w celu kontroli wstępu, bezpieczeństwa i rozliczenia wydarzenia.",
          "Katalog uczestników i funkcje kojarzenia spotkań są dobrowolne. Widoczność swojego profilu na wydarzeniu ustawiasz samodzielnie i możesz ją wyłączyć.",
          "Dane uczestników wydarzenia przechowujemy przez czas niezbędny do rozliczenia i obsługi reklamacji; zapisy z kontroli wejścia usuwamy po zamknięciu rozliczeń.",
          "Pełny opis przetwarzania: polityka prywatności (/polityka-prywatnosci) oraz polityka przetwarzania danych (/polityka-przetwarzania-danych). Wykonywanie praw: /rodo.",
        ],
      },
      {
        id: "kontakt",
        icon: "Mail",
        heading: "Kontakt",
        paragraphs: [
          `Sprawy rejestracji, biletów, dostępności obiektu i szczególnych potrzeb uczestników: ${LEGAL_CONTACT_EMAIL}. O potrzebach związanych z dostępnością powiedz nam możliwie wcześnie - większość z nich da się zapewnić, jeśli wiemy o nich przed wydarzeniem.`,
        ],
      },
    ],
  },
  en: {
    eyebrow: "Events",
    ...EVENTS_META.en,
    updated: `Last updated: ${COMPLIANCE_PACK_UPDATED}`,
    footnote: `These terms apply to events organised by ${LEGAL_ENTITY}. Individual events may have their own detailed terms presented at registration - where they differ, the terms of the specific event prevail, provided they do not lower the standard described here.`,
    sections: [
      {
        id: "rejestracja",
        icon: "CalendarDays",
        heading: "Registration and conclusion of the contract",
        bullets: [
          "The contract for participation is concluded when registration is confirmed and, for paid events, when the payment is booked.",
          "The registration form collects the data needed to admit you and to issue a badge: first and last name, email address and, at industry events, also organisation and job title.",
          "Consents required at registration are collected separately, each with its own text. We store the version of the terms in force at the moment of registration - so it is clear what exactly you agreed to.",
          "Capacity may be limited. Once it is reached, registration moves to a waiting list and released places are allocated in order of application.",
          "At events with participant screening, registration is an application - we send confirmation after review. We take no payment until then.",
        ],
      },
      {
        id: "bilety",
        icon: "Ticket",
        heading: "Tickets and packages",
        bullets: [
          "A ticket is personal and admits one named person. Entitlements depend on the ticket or package type and are described at purchase.",
          "Transferring a ticket to another person is possible until the moment stated in the event description - write to us and we will change the attendee details. Reselling a ticket at a profit is not permitted.",
          "Partner and exhibitor packages have separate terms, including the number of passes, the scope of exhibition space and the rules for using exhibitor tools.",
          "Discount codes and invitations have their own validity period and usage limit, shown when they are applied.",
          "The commercial layer - prices, invoices, the right of withdrawal and refunds - is in the subscriptions and purchases document (/regulamin-subskrypcji-i-zakupow).",
        ],
      },
      {
        id: "identyfikator",
        icon: "QrCode",
        heading: "The QR badge",
        paragraphs: [
          "Once your registration is confirmed you receive a badge with a QR code. The code is your pass - treat it like a personal ticket.",
        ],
        bullets: [
          "The code contains no personal data. It is a random identifier that only points to your registration on our side.",
          "Do not post the code on social media. Anyone who scans it may try to enter the event in your name.",
          "A printed badge shows the details you provided for display - usually name and organisation. The printed scope is visible before the event and can be limited.",
          "We will reissue a lost badge at the registration desk after confirming your identity; the previous code then stops working.",
        ],
      },
      {
        id: "kontrola-wejscia",
        icon: "BadgeCheck",
        heading: "Access control and scanning at the gate",
        paragraphs: [
          "We scan the QR code at the entrance and at designated checkpoints. The basis is performance of the participation contract and our legitimate interest in safety and attendance reporting.",
        ],
        bullets: [
          "We record: the participation identifier, the checkpoint, the direction (in or out), the time and the result of the scan. We do not record the device camera image.",
          "Checkpoints may operate in access control mode (deciding on admission) or purely as presence measurement for a zone.",
          "A repeated scan within a short interval is recognised as a duplicate and creates no new entry - this prevents artificially inflated attendance figures.",
          "Some zones have a capacity limit set by safety rules; once it is reached the gate refuses entry until a place is freed.",
          "Scanning devices run on a credential bound to a SINGLE event, with a narrow scope, expiring and revocable. An intercepted credential does not open another event.",
          "We delete access control records once the event settlement closes, unless a specific record is evidence in an ongoing matter.",
        ],
      },
      {
        id: "leady",
        icon: "Store",
        heading: "Scanning at partner booths - here you decide",
        paragraphs: [
          "Partners and exhibitors may scan badges at their booths. This is NOT the same as access control: a booth scan leads to your contact details being passed to another entity, which becomes their separate controller.",
          "That is why passing on a contact requires your separate consent, given at the moment of the scan. Without consent the partner receives no contact details.",
        ],
        bullets: [
          "The consent is recorded together with the scan: the partner sees in their own report whether they may use the contact or not.",
          "A scan without consent stays in the partner's report as the bare fact of a booth visit - no name, no email, no phone. The partner accounts for the number of visits, not for your data.",
          "Consent given to one partner does not extend to the others. Every booth is a separate decision.",
          "Consent given on site cannot be withdrawn on our side with effect towards the partner - from the moment of transfer the partner is the controller of your data. You then direct a withdrawal of consent and your other GDPR rights to them; on request we will provide their contact details.",
          "We do not sell attendee lists. A partner receives only the contacts collected at their own booth and only with the attendee's consent.",
        ],
      },
      {
        id: "nagrania",
        icon: "MonitorSmartphone",
        heading: "Recordings, photographs and streaming",
        bullets: [
          "We state before the event that it will be recorded, streamed or photographed, and remind you on site.",
          "Recording general shots of the room takes place on the basis of our legitimate interest in documenting and promoting our statutory activity.",
          "An individually featured image - a portrait, an interview, a question from the floor in shot - is used on the basis of separate consent.",
          "You may ask not to be included in our materials. At recorded events we designate a zone free of image capture.",
          "Participants may record only with the organiser's consent. At meetings held under the Chatham House Rule, recording and publishing material that would identify a speaker is prohibited (/regulamin-klubow-dyskusyjnych).",
          "Speakers and panellists receive separate information about the scope of recording and its use before they take the floor.",
        ],
      },
      {
        id: "na-miejscu",
        icon: "ShieldCheck",
        heading: "On-site rules and safety",
        bullets: [
          "Follow the instructions of the organiser, venue staff and emergency services. In an emergency the evacuation instruction prevails over the programme.",
          "Wear your badge visibly throughout. Sharing it with another person results in withdrawal of admission with no refund.",
          "Bringing dangerous objects and attending while intoxicated or under the influence of drugs are prohibited.",
          "We do not tolerate harassment or discriminatory behaviour. Event staff take reports of such behaviour; we respond on site.",
          "The organiser may refuse admission or remove a participant who breaches the rules. Where removal follows a breach, the fee is not refunded.",
          "The venue may have its own rules - they apply in parallel.",
        ],
      },
      {
        id: "zmiany",
        icon: "AlarmClock",
        heading: "Changes, cancellation of the event and withdrawal",
        bullets: [
          "The programme, speaker list and timings may change. Non-material changes do not give rise to a refund.",
          "A material change - a different date, a different city or a fundamentally different format - entitles you to withdraw with a full refund. We notify you of such a change promptly.",
          "If we cancel an event, we refund the fee in full or - with your agreement - move it to another date. The choice is yours.",
          "We are not liable for incidental costs you incur (travel, accommodation) beyond the liability arising from mandatory provisions of law.",
          "Please cancel your attendance as early as you can - a released place goes to someone on the waiting list. The refund conditions for cancellation on your initiative are in the subscriptions and purchases document and in the refund policy (/zwroty-i-reklamacje).",
          "A reminder: for tickets to an event with a specified date there is no statutory 14-day right of withdrawal (Article 38(1)(12) of the Polish Consumer Rights Act). This does not limit our contractual money-back guarantee or your rights where the service does not conform with the contract.",
        ],
      },
      {
        id: "dane",
        icon: "Database",
        heading: "Attendee data",
        bullets: [
          "We process registration data to perform the participation contract, and scan data for access control, safety and event settlement.",
          "The attendee directory and meeting matchmaking features are optional. You set the visibility of your event profile yourself and can switch it off.",
          "We keep attendee data for as long as needed to settle the event and handle complaints; access control records are deleted once settlement closes.",
          "Full description of processing: the privacy notice (/polityka-prywatnosci) and the data processing policy (/polityka-przetwarzania-danych). Exercising your rights: /rodo.",
        ],
      },
      {
        id: "kontakt",
        icon: "Mail",
        heading: "Contact",
        paragraphs: [
          `Registration, tickets, venue accessibility and specific attendee needs: ${LEGAL_CONTACT_EMAIL}. Please tell us about accessibility needs as early as you can - most can be met if we know about them before the event.`,
        ],
      },
    ],
  },
};
