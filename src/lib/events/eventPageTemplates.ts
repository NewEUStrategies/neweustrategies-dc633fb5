// SZABLONY PODSTRON WYDARZENIA - dziesiec gotowych ukladow do wyboru w chwili
// zakladania strony.
//
// PO CO SZABLON, A NIE PUSTA STRONA. Nowa podstrona wydarzenia powstawala jako
// szkic bez ani jednego bloku: redaktor widzial pozycje w menu, ktora po
// otwarciu pokazywala pustke, a podglad nie mial czego rysowac. Szablon
// odpowiada wprost na pytanie „co ta strona bedzie zawierac" - wstawia sekcje
// razem z widgetami, a redakcja podmienia tylko tresc.
//
// SZABLON TO DANE DOKUMENTU, NIE UKLAD W KODZIE. `build()` oddaje zwykle
// `SectionNode[]`, ktore zapisujemy do `pages.builder_data` przy zakladaniu
// strony. Od tej chwili strona nalezy do buildera i nikt nie musi wracac do tego
// pliku, zeby ja zmienic - inaczej szablon bylby drugim silnikiem strony.
//
// KAZDY SZABLON MA `elements` - LISTE PO POLSKU I ANGIELSKU. To nie jest opis
// marketingowy: te napisy sa jedynym miejscem, gdzie redaktor przed kliknieciem
// widzi SKLAD strony (jakie sekcje, w jakiej kolejnosci). Lista jest liczona
// recznie, bo nazwa widgetu w rejestrze („accordion") nie mowi redakcji nic
// o roli bloku na tej stronie („najczestsze pytania").
//
// WSPOLNE HELPERY Z SZABLONAMI PALETY (`lib/builder/templateKit`) - te same
// domyslne wartosci widgetow i ta sama szerokosc sekcji, wiec strona z szablonu
// wyglada jak strona zlozona recznie w builderze.
import type { BuilderDocument, SectionNode } from "@/lib/builder/types";
import { newId, toJson } from "@/lib/builder/types";
import { centered, column, contentLayout, section, widget } from "@/lib/builder/templateKit";
import type { UiLang } from "@/lib/i18n/format";

/** Dwujezyczny napis - szablony nie chodza przez i18n, bo sa danymi. */
export interface TemplateText {
  pl: string;
  en: string;
}

export interface EventPageTemplate {
  /** Stabilny identyfikator - zapisywany w telemetrii i w testach. */
  id: string;
  /** Ikona pozycji menu proponowana razem z szablonem. */
  icon: string;
  name: TemplateText;
  description: TemplateText;
  /** Sklad strony - to, co redaktor widzi przed wyborem. */
  elements: readonly TemplateText[];
  /** Swieze sekcje (nowe `id` przy kazdym wywolaniu). */
  build: () => SectionNode[];
}

export function templateText(text: TemplateText, lang: UiLang): string {
  return lang === "en" ? text.en : text.pl;
}

/* ----------------------------------------------------------- male fabryki --- */

const heading = (pl: string, en: string, tag: "h1" | "h2" = "h2") =>
  widget("heading", { text_pl: pl, text_en: en, tag });

const paragraph = (pl: string, en: string) =>
  widget("text", { html_pl: `<p>${pl}</p>`, html_en: `<p>${en}</p>` });

const label = (pl: string, en: string) =>
  widget("section-label", { label_pl: pl, label_en: en, action_pl: "", action_en: "", href: "" });

const cta = (pl: string, en: string, buttonPl: string, buttonEn: string) =>
  widget("cta", { title_pl: pl, title_en: en, cta_pl: buttonPl, cta_en: buttonEn, href: "#" });

const faqItems = () =>
  toJson([
    {
      id: newId(),
      title_pl: "Czy udział jest płatny?",
      title_en: "Is there a fee to attend?",
      content_pl: "<p>Uzupełnij odpowiedź dla tego wydarzenia.</p>",
      content_en: "<p>Fill in the answer for this event.</p>",
    },
    {
      id: newId(),
      title_pl: "Czy otrzymam nagranie?",
      title_en: "Will I get a recording?",
      content_pl: "<p>Uzupełnij odpowiedź dla tego wydarzenia.</p>",
      content_en: "<p>Fill in the answer for this event.</p>",
    },
  ]);

const oneColumn = (children: ReturnType<typeof widget>[], marginBottom = 48) =>
  section([column(12, children)], contentLayout(marginBottom));

const twoColumns = (
  left: ReturnType<typeof widget>[],
  right: ReturnType<typeof widget>[],
  marginBottom = 48,
) => section([column(6, left), column(6, right)], contentLayout(marginBottom));

/* --------------------------------------------------------------- szablony --- */

export const EVENT_PAGE_TEMPLATES: readonly EventPageTemplate[] = [
  {
    id: "event-page-blank",
    icon: "file-text",
    name: { pl: "Pusta strona", en: "Blank page" },
    description: {
      pl: "Nagłówek i akapit - reszta zostaje do złożenia w builderze.",
      en: "A heading and a paragraph - the rest is composed in the builder.",
    },
    elements: [
      { pl: "Nagłówek strony", en: "Page heading" },
      { pl: "Akapit wprowadzenia", en: "Intro paragraph" },
    ],
    build: () => [
      oneColumn([
        heading("Tytuł strony", "Page title", "h1"),
        paragraph(
          "Zacznij tutaj i dodaj kolejne sekcje w builderze.",
          "Start here and add further sections in the builder.",
        ),
      ]),
    ],
  },
  {
    id: "event-page-agenda",
    icon: "calendar-days",
    name: { pl: "Program wydarzenia", en: "Programme" },
    description: {
      pl: "Agenda z podziałem na dni, notatka o zmianach i przejście do rejestracji.",
      en: "A day-by-day schedule, a change notice and a path to registration.",
    },
    elements: [
      { pl: "Etykieta sekcji i nagłówek", en: "Section label and heading" },
      { pl: "Agenda z zakładkami dni", en: "Schedule with day tabs" },
      { pl: "Wezwanie do rejestracji", en: "Registration call to action" },
    ],
    build: () => [
      oneColumn(
        [
          label("Program", "Programme"),
          heading("Agenda wydarzenia", "Event schedule", "h1"),
          paragraph(
            "Program może się zmienić - najnowsza wersja jest zawsze na tej stronie.",
            "The programme may change - the latest version is always on this page.",
          ),
        ],
        32,
      ),
      oneColumn([
        widget("event-schedule", {
          heading_pl: "Agenda",
          heading_en: "Schedule",
          intro_pl: "",
          intro_en: "",
        }),
      ]),
      oneColumn([cta("Zarezerwuj miejsce", "Reserve your seat", "Zarejestruj się", "Register")]),
    ],
  },
  {
    id: "event-page-speakers",
    icon: "users",
    name: { pl: "Prelegenci", en: "Speakers" },
    description: {
      pl: "Siatka prelegentów z krótkim wstępem i zaproszeniem do zgłoszeń.",
      en: "A speakers grid with a short intro and a call for proposals.",
    },
    elements: [
      { pl: "Nagłówek i wstęp", en: "Heading and intro" },
      { pl: "Siatka prelegentów", en: "Speakers grid" },
      { pl: "Zaproszenie do zgłoszenia prelekcji", en: "Call for proposals" },
    ],
    build: () => [
      oneColumn(
        [
          heading("Prelegenci", "Speakers", "h1"),
          paragraph(
            "Osoby, które poprowadzą sesje tego wydarzenia.",
            "The people leading the sessions of this event.",
          ),
        ],
        32,
      ),
      oneColumn([widget("speakers", { heading_pl: "", heading_en: "" })]),
      oneColumn([
        cta("Chcesz wystąpić?", "Would you like to speak?", "Zgłoś prelekcję", "Submit a talk"),
      ]),
    ],
  },
  {
    id: "event-page-registration",
    icon: "clipboard-list",
    name: { pl: "Rejestracja", en: "Registration" },
    description: {
      pl: "Warunki udziału, odliczanie do startu i formularz kontaktowy dla pytań.",
      en: "Attendance terms, a countdown and a contact form for questions.",
    },
    elements: [
      { pl: "Nagłówek i warunki udziału", en: "Heading and attendance terms" },
      { pl: "Odliczanie do wydarzenia", en: "Countdown to the event" },
      { pl: "Formularz pytań", en: "Questions form" },
    ],
    build: () => [
      twoColumns(
        [
          heading("Rejestracja", "Registration", "h1"),
          paragraph(
            "Kto może wziąć udział, co obejmuje zapis i do kiedy trwa nabór.",
            "Who can attend, what registration covers and when it closes.",
          ),
          widget("button", {
            label_pl: "Zapisz się",
            label_en: "Register",
            href: "#",
            variant: "primary",
          }),
        ],
        [
          widget("event-countdown", {
            title_pl: "Do startu wydarzenia",
            title_en: "Event starts in",
            size: "md",
          }),
        ],
        32,
      ),
      oneColumn([heading("Masz pytanie?", "Have a question?"), widget("contact-form", {})]),
    ],
  },
  {
    id: "event-page-practical",
    icon: "map-pin",
    name: { pl: "Informacje praktyczne", en: "Practical information" },
    description: {
      pl: "Dojazd, mapa, nocleg i najczęstsze pytania w jednym miejscu.",
      en: "Getting there, a map, accommodation and the FAQ in one place.",
    },
    elements: [
      { pl: "Nagłówek i wstęp", en: "Heading and intro" },
      { pl: "Mapa miejsca", en: "Venue map" },
      { pl: "Dojazd i nocleg", en: "Travel and accommodation" },
      { pl: "Najczęstsze pytania", en: "Frequently asked questions" },
    ],
    build: () => [
      oneColumn([heading("Informacje praktyczne", "Practical information", "h1")], 32),
      oneColumn([widget("map", {})]),
      twoColumns(
        [
          heading("Dojazd", "Getting there"),
          paragraph(
            "Komunikacja miejska, parking i wejście do budynku.",
            "Public transport, parking and the building entrance.",
          ),
        ],
        [
          heading("Nocleg", "Accommodation"),
          paragraph(
            "Hotele w okolicy i kod rabatowy dla uczestników.",
            "Nearby hotels and the attendee discount code.",
          ),
        ],
      ),
      oneColumn([
        heading("Najczęstsze pytania", "Frequently asked questions"),
        widget("accordion", { items: faqItems() }),
      ]),
    ],
  },
  {
    id: "event-page-sponsors",
    icon: "handshake",
    name: { pl: "Partnerzy i sponsorzy", en: "Partners and sponsors" },
    description: {
      pl: "Poziomy partnerstwa, logotypy i zaproszenie do współpracy.",
      en: "Partnership tiers, a logo wall and an invitation to collaborate.",
    },
    elements: [
      { pl: "Nagłówek i wstęp", en: "Heading and intro" },
      { pl: "Poziomy partnerstwa", en: "Partnership tiers" },
      { pl: "Ściana logotypów", en: "Logo wall" },
      { pl: "Zaproszenie do współpracy", en: "Invitation to collaborate" },
    ],
    build: () => [
      oneColumn(
        [
          heading("Partnerzy wydarzenia", "Event partners", "h1"),
          paragraph(
            "Instytucje i firmy, bez których to wydarzenie by się nie odbyło.",
            "The institutions and companies that make this event possible.",
          ),
        ],
        32,
      ),
      oneColumn([widget("event-sponsors", {})]),
      oneColumn([widget("logo-cloud", {})]),
      oneColumn([
        cta("Zostań partnerem", "Become a partner", "Poproś o ofertę", "Request the offer"),
      ]),
    ],
  },
  {
    id: "event-page-materials",
    icon: "folder-open",
    name: { pl: "Materiały", en: "Materials" },
    description: {
      pl: "Prezentacje, dokumenty i nagrania dla zapisanych uczestników.",
      en: "Slides, documents and recordings for registered attendees.",
    },
    elements: [
      { pl: "Nagłówek i zasada dostępu", en: "Heading and access rule" },
      { pl: "Lista materiałów", en: "Materials list" },
      { pl: "Nagranie wideo", en: "Video recording" },
    ],
    build: () => [
      oneColumn(
        [
          heading("Materiały z wydarzenia", "Event materials", "h1"),
          paragraph(
            "Dostęp mają uczestnicy zapisani na wydarzenie.",
            "Access is available to attendees registered for the event.",
          ),
        ],
        32,
      ),
      oneColumn([widget("accordion", { items: faqItems() })]),
      oneColumn([widget("video", { url: "" })]),
    ],
  },
  {
    id: "event-page-networking",
    icon: "calendar-clock",
    name: { pl: "Networking i spotkania", en: "Networking and meetings" },
    description: {
      pl: "Giełda spotkań 1:1, zasady kontaktu i lista uczestników.",
      en: "The 1:1 meeting exchange, contact rules and the attendee list.",
    },
    elements: [
      { pl: "Nagłówek i zasady", en: "Heading and rules" },
      { pl: "Rezerwacja spotkań 1:1", en: "1:1 meeting booking" },
      { pl: "Wezwanie do uzupełnienia profilu", en: "Profile completion call to action" },
    ],
    build: () => [
      oneColumn(
        [
          label("Networking", "Networking"),
          heading("Spotkania 1:1", "1:1 meetings", "h1"),
          paragraph(
            "Wybierz rozmówcę i wolny termin - potwierdzenie przyjdzie mailem.",
            "Pick a counterpart and a free slot - the confirmation arrives by email.",
          ),
        ],
        32,
      ),
      oneColumn([widget("meeting-booking", {})]),
      oneColumn([
        cta(
          "Uzupełnij profil, żeby dostawać zaproszenia",
          "Complete your profile to receive invitations",
          "Przejdź do profilu",
          "Go to my profile",
        ),
      ]),
    ],
  },
  {
    id: "event-page-recap",
    icon: "image",
    name: { pl: "Relacja i galeria", en: "Recap and gallery" },
    description: {
      pl: "Podsumowanie po wydarzeniu: liczby, zdjęcia, cytaty i nagranie.",
      en: "The post-event recap: numbers, photos, quotes and the recording.",
    },
    elements: [
      { pl: "Nagłówek relacji", en: "Recap heading" },
      { pl: "Liczby wydarzenia", en: "Event numbers" },
      { pl: "Galeria zdjęć", en: "Photo gallery" },
      { pl: "Opinia uczestnika", en: "Attendee testimonial" },
    ],
    build: () => [
      oneColumn(
        [
          heading("Jak było", "How it went", "h1"),
          paragraph(
            "Krótkie podsumowanie wydarzenia i najważniejsze wnioski.",
            "A short recap of the event and its key takeaways.",
          ),
        ],
        32,
      ),
      twoColumns([widget("counter", {}, centered)], [widget("counter", {}, centered)], 32),
      oneColumn([widget("gallery", {})]),
      oneColumn([widget("testimonial", {})]),
    ],
  },
  {
    id: "event-page-contact",
    icon: "mail",
    name: { pl: "Kontakt dla uczestników", en: "Attendee contact" },
    description: {
      pl: "Osoby do kontaktu, formularz i zapis na informacje o kolejnych wydarzeniach.",
      en: "Contact people, a form and a sign-up for news about future events.",
    },
    elements: [
      { pl: "Nagłówek i wstęp", en: "Heading and intro" },
      { pl: "Dane kontaktowe", en: "Contact details" },
      { pl: "Formularz kontaktowy", en: "Contact form" },
      { pl: "Zapis na newsletter", en: "Newsletter sign-up" },
    ],
    build: () => [
      oneColumn(
        [
          heading("Kontakt", "Contact", "h1"),
          paragraph(
            "Napisz do zespołu wydarzenia - odpowiadamy w dni robocze.",
            "Write to the event team - we reply on working days.",
          ),
        ],
        32,
      ),
      twoColumns([widget("contact", {})], [widget("contact-form", {})]),
      oneColumn([
        widget("newsletter", {
          title_pl: "Informacje o kolejnych wydarzeniach",
          title_en: "News about upcoming events",
        }),
      ]),
    ],
  },
] as const;

/** Szablon domyslny - pierwszy na liscie, zeby wybor nigdy nie byl pusty. */
export const DEFAULT_EVENT_PAGE_TEMPLATE_ID = EVENT_PAGE_TEMPLATES[0].id;

export function findEventPageTemplate(id: string | null | undefined): EventPageTemplate | null {
  if (id === null || id === undefined) return null;
  return EVENT_PAGE_TEMPLATES.find((template) => template.id === id) ?? null;
}

/**
 * Dokument buildera z szablonu.
 *
 * NIEZNANY IDENTYFIKATOR ODDAJE `null`, a nie pusty dokument: „nie znam tego
 * szablonu" i „szablon jest pusty" to dwie rozne odpowiedzi, a wolajacy ma
 * prawo na pierwsza zareagowac inaczej niz na druga.
 */
export function eventPageTemplateDocument(id: string | null | undefined): BuilderDocument | null {
  const template = findEventPageTemplate(id);
  if (template === null) return null;
  return { version: 1, sections: template.build() };
}
