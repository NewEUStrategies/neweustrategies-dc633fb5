// Szablony startowe buildera - gotowe kompozycje sekcji (wydarzenia,
// networking, sponsorzy...) wstawiane z sekcji szablonow w palecie
// (WidgetLibrary). W odroznieniu od szablonow uzytkownika (builder_templates,
// per tenant) sa WBUDOWANE: wersjonowane w kodzie, dostepne dla kazdego
// tenanta, dwujezyczne. Kazde build() zwraca swieze SectionNode z nowymi id
// (wzorzec homepageTemplate), wiec wstawianie wielokrotne jest bezpieczne.
//
// Szablony celowo mieszaja widgety eventowe (event-schedule, speakers,
// event-list, event-countdown, meeting-booking, event-sponsors) z pozostala
// biblioteka (heading, text, button, section-label, counter, accordion, cta,
// newsletter, gallery, testimonial, post-list) - to kompletne strony, nie
// pojedyncze bloki.
import type { SectionNode } from "./types";
import { newId, toJson } from "./types";
import { centered, column, contentLayout, section, widget } from "./templateKit";

export type Lang = "pl" | "en";

export interface StarterTemplate {
  /** Stabilny identyfikator (telemetria/testy); NIE trafia do dokumentu. */
  id: string;
  name_pl: string;
  name_en: string;
  description_pl: string;
  description_en: string;
  /** Buduje swieze sekcje (nowe id przy kazdym wywolaniu). */
  build: () => SectionNode[];
}

export function starterName(tpl: StarterTemplate, lang: Lang): string {
  return lang === "pl" ? tpl.name_pl : tpl.name_en;
}

export function starterDescription(tpl: StarterTemplate, lang: Lang): string {
  return lang === "pl" ? tpl.description_pl : tpl.description_en;
}

// --- helpers ----------------------------------------------------------------
//
// Sklad wezlow siedzi w `templateKit` - ten sam zestaw uzywaja szablony
// podstron wydarzenia, wiec domyslna szerokosc sekcji i czytanie `defaults()`
// z rejestru maja jedno miejsce, a nie dwie kopie do zsynchronizowania.


// --- przykladowa agenda (2 dni) ----------------------------------------------

const sampleScheduleDays = () =>
  toJson([
    {
      id: newId(),
      label_pl: "Dzień 1",
      label_en: "Day 1",
      date: "",
      sessions: [
        {
          id: newId(),
          timeStart: "09:00",
          timeEnd: "09:30",
          kind: "session",
          title_pl: "Otwarcie i powitanie",
          title_en: "Opening remarks",
          description_pl: "",
          description_en: "",
          room: "Scena główna",
          href: "",
          speakers: [
            {
              id: newId(),
              userId: "",
              name: "Imię Nazwisko",
              role_pl: "Rola / organizacja",
              role_en: "Role / organisation",
              photo: "",
            },
          ],
          sponsors: [],
        },
        {
          id: newId(),
          timeStart: "09:30",
          timeEnd: "10:30",
          kind: "session",
          title_pl: "Panel otwierający",
          title_en: "Opening panel",
          description_pl: "Krótki opis panelu i najważniejsze wątki dyskusji.",
          description_en: "A short description of the panel and its key threads.",
          room: "Scena główna",
          href: "",
          speakers: [],
          sponsors: [],
        },
        {
          id: newId(),
          timeStart: "10:30",
          timeEnd: "11:00",
          kind: "break",
          title_pl: "Kawa i networking",
          title_en: "Coffee & networking",
          description_pl: "",
          description_en: "",
          room: "",
          href: "",
          speakers: [],
          sponsors: [{ id: newId(), name: "Nazwa sponsora", logo: "", url: "" }],
        },
        {
          id: newId(),
          timeStart: "11:00",
          timeEnd: "12:30",
          kind: "session",
          title_pl: "Warsztaty równoległe",
          title_en: "Parallel workshops",
          description_pl: "",
          description_en: "",
          room: "Sale A i B",
          href: "",
          speakers: [],
          sponsors: [],
        },
      ],
    },
    {
      id: newId(),
      label_pl: "Dzień 2",
      label_en: "Day 2",
      date: "",
      sessions: [
        {
          id: newId(),
          timeStart: "10:00",
          timeEnd: "11:30",
          kind: "session",
          title_pl: "Debata główna",
          title_en: "Main debate",
          description_pl: "",
          description_en: "",
          room: "Scena główna",
          href: "",
          speakers: [],
          sponsors: [],
        },
        {
          id: newId(),
          timeStart: "11:30",
          timeEnd: "12:00",
          kind: "session",
          title_pl: "Podsumowanie i wnioski",
          title_en: "Closing remarks",
          description_pl: "",
          description_en: "",
          room: "",
          href: "",
          speakers: [],
          sponsors: [],
        },
      ],
    },
  ]);

const sampleSpeakers = () =>
  toJson(
    [1, 2, 3].map((i) => ({
      id: newId(),
      photo: "",
      name: `Imię Nazwisko ${i}`,
      role_pl: "Stanowisko, organizacja",
      role_en: "Position, organisation",
      category_pl: i === 3 ? "Gospodarka" : "Polityka",
      category_en: i === 3 ? "Economy" : "Politics",
      gigs: 0,
      rating: 0,
      reviews: 0,
      description_pl: "Krótki biogram prelegenta - zastąp własnym opisem.",
      description_en: "A short speaker bio - replace with your own copy.",
      href: "",
    })),
  );

const sampleSponsorTiers = () =>
  toJson([
    {
      id: newId(),
      name_pl: "Partner główny",
      name_en: "Main partner",
      size: "lg",
      sponsors: [
        {
          id: newId(),
          name: "Partner główny",
          logo: "",
          url: "",
          description_pl: "Krótki opis partnera głównego wydarzenia.",
          description_en: "A short description of the event's main partner.",
        },
      ],
    },
    {
      id: newId(),
      name_pl: "Partnerzy",
      name_en: "Partners",
      size: "md",
      sponsors: [1, 2, 3].map((i) => ({
        id: newId(),
        name: `Partner ${i}`,
        logo: "",
        url: "",
        description_pl: "",
        description_en: "",
      })),
    },
    {
      id: newId(),
      name_pl: "Partnerzy medialni",
      name_en: "Media partners",
      size: "sm",
      sponsors: [1, 2, 3, 4].map((i) => ({
        id: newId(),
        name: `Patron ${i}`,
        logo: "",
        url: "",
        description_pl: "",
        description_en: "",
      })),
    },
  ]);

const faqItems = () =>
  toJson([
    {
      q_pl: "Jak mogę się zarejestrować?",
      q_en: "How do I register?",
      a_pl: "<p>Kliknij przycisk rejestracji i wypełnij formularz.</p>",
      a_en: "<p>Click the registration button and fill in the form.</p>",
    },
    {
      q_pl: "Czy udział jest płatny?",
      q_en: "Is attendance paid?",
      a_pl: "<p>Uzupełnij informacje o biletach i dostępności.</p>",
      a_en: "<p>Fill in ticketing and availability details.</p>",
    },
    {
      q_pl: "Jak umówić spotkanie 1-1?",
      q_en: "How do I book a 1-1 meeting?",
      a_pl: "<p>Skorzystaj z sekcji networkingu i wybierz wolny slot.</p>",
      a_en: "<p>Use the networking section and pick a free slot.</p>",
    },
  ]);

// --- szablony ----------------------------------------------------------------

export const STARTER_TEMPLATES: StarterTemplate[] = [
  {
    id: "starter-event-page",
    name_pl: "Strona wydarzenia (kompletna)",
    name_en: "Event page (complete)",
    description_pl:
      "Hero z odliczaniem, agenda dni, prelegenci, sponsorzy, FAQ i sekcja rejestracji.",
    description_en:
      "Hero with countdown, day schedule, speakers, sponsors, FAQ and a registration section.",
    build: () => [
      section(
        [
          column(7, [
            widget("section-label", {
              label_pl: "Wydarzenie",
              label_en: "Event",
              action_pl: "",
              action_en: "",
              href: "",
            }),
            widget("heading", {
              text_pl: "Tytuł Twojego wydarzenia",
              text_en: "Your event title",
              tag: "h1",
            }),
            widget("text", {
              html_pl:
                "<p>Jedno-dwa zdania o tym, dlaczego warto być na tym wydarzeniu: goście, tematy, format.</p>",
              html_en:
                "<p>One or two sentences on why this event matters: guests, topics, format.</p>",
            }),
            widget("button", {
              label_pl: "Zarejestruj się",
              label_en: "Register",
              href: "#rejestracja",
              variant: "primary",
            }),
          ]),
          column(5, [
            widget("event-countdown", {
              title_pl: "Do startu wydarzenia",
              title_en: "Event starts in",
              size: "lg",
            }),
          ]),
        ],
        contentLayout(56),
      ),
      section(
        [
          column(12, [
            widget("event-schedule", {
              heading_pl: "Agenda",
              heading_en: "Schedule",
              intro_pl: "Program może ulec zmianie.",
              intro_en: "The programme is subject to change.",
              days: sampleScheduleDays(),
            }),
          ]),
        ],
        contentLayout(),
      ),
      section(
        [
          column(12, [
            widget("speakers", {
              heading_pl: "Prelegenci",
              heading_en: "Speakers",
              speakers: sampleSpeakers(),
            }),
          ]),
        ],
        contentLayout(),
      ),
      section(
        [column(12, [widget("event-sponsors", { tiers: sampleSponsorTiers() })])],
        contentLayout(),
      ),
      section(
        [
          column(6, [
            widget("heading", {
              text_pl: "Najczęstsze pytania",
              text_en: "Frequently asked questions",
              tag: "h2",
            }),
            widget("accordion", { items: faqItems() }),
          ]),
          column(6, [
            widget("cta", {
              title_pl: "Zarezerwuj miejsce już dziś",
              title_en: "Reserve your seat today",
              cta_pl: "Zarejestruj się",
              cta_en: "Register",
              href: "#",
            }),
            widget("newsletter", {
              title_pl: "Otrzymuj informacje o kolejnych wydarzeniach",
              title_en: "Get updates about upcoming events",
            }),
          ]),
        ],
        {
          ...contentLayout(0),
          advanced: { htmlId: "rejestracja" },
        },
      ),
    ],
  },
  {
    id: "starter-agenda-speakers",
    name_pl: "Agenda i prelegenci",
    name_en: "Schedule & speakers",
    description_pl: "Sekcja agendy z zakładkami dni oraz siatka prelegentów z profili (CRM).",
    description_en: "A day-tab schedule section plus a speakers grid fed from profiles (CRM).",
    build: () => [
      section(
        [
          column(12, [
            widget("event-schedule", {
              heading_pl: "Agenda",
              heading_en: "Schedule",
              days: sampleScheduleDays(),
            }),
          ]),
        ],
        contentLayout(),
      ),
      section(
        [
          column(12, [
            widget("speakers", {
              heading_pl: "Prelegenci",
              heading_en: "Speakers",
              source: "directory",
              openProfile: true,
            }),
          ]),
        ],
        contentLayout(0),
      ),
    ],
  },
  {
    id: "starter-events-hub",
    name_pl: "Centrum wydarzeń",
    name_en: "Events hub",
    description_pl: "Nadchodzące wydarzenia w kartach + minione w zwartej liście.",
    description_en: "Upcoming events as cards + past events in a compact list.",
    build: () => [
      section(
        [
          column(12, [
            widget("event-list", {
              heading_pl: "Nadchodzące wydarzenia",
              heading_en: "Upcoming events",
              scope: "upcoming",
              variant: "cards",
              limit: 6,
              showRsvpCount: true,
            }),
          ]),
        ],
        contentLayout(),
      ),
      section(
        [
          column(12, [
            widget("event-list", {
              heading_pl: "Minione wydarzenia",
              heading_en: "Past events",
              scope: "past",
              variant: "list",
              limit: 6,
              showCountdown: false,
            }),
          ]),
        ],
        contentLayout(0),
      ),
    ],
  },
  {
    id: "starter-countdown-hero",
    name_pl: "Hero z odliczaniem",
    name_en: "Countdown hero",
    description_pl: "Wyśrodkowany nagłówek, lead i duże odliczanie z przyciskiem CTA.",
    description_en: "A centered heading, lead paragraph and a large countdown with a CTA.",
    build: () => [
      section(
        [
          column(12, [
            widget(
              "heading",
              {
                text_pl: "Do zobaczenia na wydarzeniu",
                text_en: "See you at the event",
                tag: "h2",
              },
              centered,
            ),
            widget(
              "text",
              {
                html_pl: "<p>Dodaj datę, miejsce i najważniejszą korzyść z udziału.</p>",
                html_en: "<p>Add the date, the venue and the single biggest reason to attend.</p>",
              },
              centered,
            ),
            widget("event-countdown", { size: "lg" }),
            widget(
              "button",
              {
                label_pl: "Zarejestruj się",
                label_en: "Register",
                href: "#",
                variant: "primary",
              },
              centered,
            ),
          ]),
        ],
        contentLayout(0),
      ),
    ],
  },
  {
    id: "starter-speakers-directory",
    name_pl: "Katalog prelegentów (CRM)",
    name_en: "Speakers directory (CRM)",
    description_pl:
      "Publiczne profile prelegentów z wyszukiwarką, sortowaniem i dialogiem profilu + CTA.",
    description_en: "Public speaker profiles with search, sorting and the profile dialog + a CTA.",
    build: () => [
      section(
        [
          column(12, [
            widget("speakers", {
              heading_pl: "Prelegenci i eksperci",
              heading_en: "Speakers & experts",
              source: "directory",
              openProfile: true,
              pageSize: 12,
            }),
          ]),
        ],
        contentLayout(),
      ),
      section(
        [
          column(12, [
            widget("cta", {
              title_pl: "Chcesz wystąpić na naszym wydarzeniu?",
              title_en: "Want to speak at our event?",
              cta_pl: "Zgłoś się",
              cta_en: "Apply",
              href: "/contact",
            }),
          ]),
        ],
        contentLayout(0),
      ),
    ],
  },
  {
    id: "starter-sponsors-page",
    name_pl: "Strona sponsorów i partnerów",
    name_en: "Sponsors & partners page",
    description_pl: "Poziomy sponsorskie z logotypami, liczby wydarzenia i CTA „Zostań sponsorem”.",
    description_en: "Sponsor tiers with logos, event counters and a „Become a sponsor” CTA.",
    build: () => [
      section(
        [
          column(12, [
            widget("event-sponsors", {
              intro_pl: "Dziękujemy organizacjom, które wspierają nasze wydarzenia.",
              intro_en: "We thank the organisations supporting our events.",
              tiers: sampleSponsorTiers(),
            }),
          ]),
        ],
        contentLayout(),
      ),
      section(
        [
          column(4, [
            widget("counter", {
              value: 1200,
              suffix: "+",
              label_pl: "uczestników",
              label_en: "attendees",
            }),
          ]),
          column(4, [
            widget("counter", {
              value: 80,
              suffix: "+",
              label_pl: "prelegentów",
              label_en: "speakers",
            }),
          ]),
          column(4, [
            widget("counter", {
              value: 12,
              suffix: "",
              label_pl: "edycji wydarzeń",
              label_en: "event editions",
            }),
          ]),
        ],
        contentLayout(),
      ),
      section(
        [
          column(12, [
            widget("cta", {
              title_pl: "Zostań sponsorem kolejnej edycji",
              title_en: "Become a sponsor of the next edition",
              cta_pl: "Porozmawiajmy",
              cta_en: "Let's talk",
              href: "/contact",
            }),
          ]),
        ],
        contentLayout(0),
      ),
    ],
  },
  {
    id: "starter-networking",
    name_pl: "Networking 1-1",
    name_en: "1-1 networking",
    description_pl:
      "Rezerwacja slotów spotkań 1-1 (hosta lub wydarzenia) z zasadami networkingu obok.",
    description_en: "1-1 meeting slot booking (host or event) with networking rules alongside.",
    build: () => [
      section(
        [
          column(12, [
            widget("section-label", {
              label_pl: "Networking",
              label_en: "Networking",
              action_pl: "",
              action_en: "",
              href: "",
            }),
          ]),
        ],
        contentLayout(16),
      ),
      section(
        [
          column(7, [
            widget("meeting-booking", {
              heading_pl: "Umów spotkanie 1-1",
              heading_en: "Book a 1-1 meeting",
              intro_pl: "Wybierz wolny slot - potwierdzenie otrzymasz od razu.",
              intro_en: "Pick a free slot - you will get an instant confirmation.",
              mode: "event",
            }),
          ]),
          column(5, [
            widget("heading", {
              text_pl: "Zasady networkingu",
              text_en: "Networking rules",
              tag: "h3",
            }),
            widget("accordion", {
              items: toJson([
                {
                  q_pl: "Ile trwa spotkanie?",
                  q_en: "How long is a meeting?",
                  a_pl: "<p>Standardowy slot to 15-30 minut.</p>",
                  a_en: "<p>A standard slot is 15-30 minutes.</p>",
                },
                {
                  q_pl: "Jak odwołać rezerwację?",
                  q_en: "How do I cancel?",
                  a_pl: "<p>Kliknij „Anuluj” na swoim slocie.</p>",
                  a_en: "<p>Click „Cancel” on your slot.</p>",
                },
                {
                  q_pl: "Jak zostać hostem?",
                  q_en: "How do I host meetings?",
                  a_pl: "<p>Zaloguj się i opublikuj własne sloty w panelu powyżej.</p>",
                  a_en: "<p>Sign in and publish your own slots in the panel above.</p>",
                },
              ]),
            }),
          ]),
        ],
        contentLayout(0),
      ),
    ],
  },
  {
    id: "starter-event-recap",
    name_pl: "Relacja po wydarzeniu",
    name_en: "Post-event recap",
    description_pl: "Podsumowanie, galeria zdjęć, opinie uczestników i powiązane publikacje.",
    description_en: "A wrap-up, photo gallery, attendee testimonials and related coverage.",
    build: () => [
      section(
        [
          column(12, [
            widget("heading", {
              text_pl: "Tak było - relacja z wydarzenia",
              text_en: "That's a wrap - event recap",
              tag: "h1",
            }),
            widget("text", {
              html_pl:
                "<p>Krótkie podsumowanie: liczby, najważniejsze wątki, podziękowania dla gości i partnerów.</p>",
              html_en:
                "<p>A short wrap-up: numbers, key takeaways, thanks to guests and partners.</p>",
            }),
          ]),
        ],
        contentLayout(32),
      ),
      section([column(12, [widget("gallery", { columns: 3 })])], contentLayout()),
      section(
        [
          column(6, [
            widget("testimonial", {
              quote_pl: "Świetnie dobrane tematy i rozmówcy - wrócę za rok.",
              quote_en: "Great topics and great guests - I will be back next year.",
              author: "Imię Nazwisko",
              role_pl: "Uczestniczka",
              role_en: "Attendee",
            }),
          ]),
          column(6, [
            widget("testimonial", {
              quote_pl: "Networking 1-1 to strzał w dziesiątkę.",
              quote_en: "The 1-1 networking was spot on.",
              author: "Imię Nazwisko",
              role_pl: "Partner wydarzenia",
              role_en: "Event partner",
            }),
          ]),
        ],
        contentLayout(),
      ),
      section(
        [
          column(12, [
            widget("heading", {
              text_pl: "Powiązane analizy",
              text_en: "Related coverage",
              tag: "h2",
            }),
            widget("post-list", { limit: 3, columns: 3 }),
          ]),
        ],
        contentLayout(0),
      ),
    ],
  },
];
