// Fabryka dokumentów newslettera dla testów runtime renderera.
//
// MAILA NIE DA SIĘ WYCOFAĆ. Dokument zbudowany w panelu idzie w tej samej
// postaci do dwudziestu tysięcy skrzynek; defekt renderu zostaje w nich na
// zawsze, a poprawka dotyczy dopiero NASTĘPNEJ wysyłki. Dlatego cały dowód
// musi powstać PRZED wysyłką - a to znaczy, że trzeba umieć tanio zbudować
// każdy możliwy kształt dokumentu, nie tylko ten wygodny.
//
// Plik jest wspólny dla trzech plików testowych (funkcje czyste + walidacja,
// widgety, sekcje i całość) i CELOWO nie ma w nim ani jednego testu - literały
// dokumentu powtórzone w trzech miejscach rozjeżdżają się po pierwszej zmianie
// modelu i wtedy testy przestają opisywać to, co naprawdę leci do skrzynek.
//
// Wszystkie kształty pochodzą z `@/lib/newsletter-builder/types` - fabryka nie
// zgaduje pól, bo widget wymyślony w teście dowodziłby renderu, którego panel
// nigdy nie wyprodukuje.
import {
  defaultNewsletterSettings,
  type NewsletterMailingList,
  type NewsletterSettings,
} from "@/hooks/useNewsletterSettings";
import type {
  NlCheckboxWidget,
  NlCloseButtonWidget,
  NlCountdownWidget,
  NlCouponWidget,
  NlCtaButtonWidget,
  NlDividerWidget,
  NlDoc,
  NlEmailFieldWidget,
  NlHeadingWidget,
  NlI18n,
  NlImageWidget,
  NlMailingListsWidget,
  NlParagraphWidget,
  NlSection,
  NlSelectWidget,
  NlSocialProofWidget,
  NlSpacerWidget,
  NlSubmitWidget,
  NlSuccessMessageWidget,
  NlTextFieldWidget,
  NlWidget,
} from "@/lib/newsletter-builder/types";

/**
 * Payload, który renderer wysyła do `subscribeToNewsletter`. Odtworzony tutaj,
 * bo to on jest przedmiotem dowodu w testach walidacji: pola widoczne na
 * ekranie nie dowodzą, że wartości dojechały do zapisu.
 */
export interface SubscribeConsent {
  key: string;
  text: string;
  given: boolean;
  lang: "pl" | "en";
}

export interface SubscribePayload {
  email: string;
  firstName?: string;
  lastName?: string;
  name?: string;
  language: "pl" | "en";
  source: string;
  formName: string;
  consents: SubscribeConsent[];
  meta?: Record<string, string>;
  requiredFields?: string[];
}

// Identyfikatory rosną deterministycznie - żadnego `crypto.randomUUID()`
// w teście, bo dwa przebiegi tej samej suity muszą dać ten sam DOM.
let seq = 0;
function nextId(kind: string): string {
  seq += 1;
  return `${kind}-${seq}`;
}

/** Zerowanie licznika identyfikatorów - do wywołania w `beforeEach`. */
export function resetDocIds(): void {
  seq = 0;
}

const i18n = (pl: string, en: string): NlI18n => ({ pl, en });

export function makeHeading(over: Partial<NlHeadingWidget> = {}): NlHeadingWidget {
  return {
    id: nextId("heading"),
    type: "heading",
    level: 2,
    text: i18n("Zapisz sie na newsletter", "Subscribe to the newsletter"),
    ...over,
  };
}

export function makeParagraph(over: Partial<NlParagraphWidget> = {}): NlParagraphWidget {
  return {
    id: nextId("paragraph"),
    type: "paragraph",
    html: i18n("<b>Analizy z Brukseli</b>", "<b>Analyses from Brussels</b>"),
    ...over,
  };
}

export function makeImage(over: Partial<NlImageWidget> = {}): NlImageWidget {
  return {
    id: nextId("image"),
    type: "image",
    url: "https://cdn.example.test/okladka.png",
    alt: "Okladka newslettera",
    ...over,
  };
}

export function makeDivider(over: Partial<NlDividerWidget> = {}): NlDividerWidget {
  return { id: nextId("divider"), type: "divider", ...over };
}

export function makeSpacer(over: Partial<NlSpacerWidget> = {}): NlSpacerWidget {
  return { id: nextId("spacer"), type: "spacer", size: 24, ...over };
}

export function makeEmailField(over: Partial<NlEmailFieldWidget> = {}): NlEmailFieldWidget {
  return {
    id: nextId("email"),
    type: "field.email",
    label: i18n("Adres e-mail", "Email address"),
    placeholder: i18n("jan@example.pl", "jane@example.com"),
    ...over,
  };
}

export function makeTextField(
  name: NlTextFieldWidget["name"],
  over: Partial<NlTextFieldWidget> = {},
): NlTextFieldWidget {
  return {
    id: nextId(`text-${name}`),
    type: "field.text",
    name,
    label: i18n(`Pole ${name}`, `Field ${name}`),
    placeholder: i18n(`Wpisz ${name}`, `Type ${name}`),
    ...over,
  };
}

export function makeCheckbox(over: Partial<NlCheckboxWidget> = {}): NlCheckboxWidget {
  return {
    id: nextId("checkbox"),
    type: "field.checkbox",
    key: "terms",
    html: i18n(
      "Akceptuje <a href='/regulamin'>regulamin</a>",
      "I accept the <a href='/tos'>ToS</a>",
    ),
    ...over,
  };
}

export function makeSelect(over: Partial<NlSelectWidget> = {}): NlSelectWidget {
  return {
    id: nextId("select"),
    type: "field.select",
    name: "country",
    label: i18n("Kraj", "Country"),
    placeholder: i18n("Wybierz kraj", "Choose a country"),
    options: [
      { value: "pl", labelPl: "Polska", labelEn: "Poland" },
      { value: "be", labelPl: "Belgia", labelEn: "Belgium" },
    ],
    ...over,
  };
}

export function makeMailingLists(over: Partial<NlMailingListsWidget> = {}): NlMailingListsWidget {
  return {
    id: nextId("ml"),
    type: "field.mailing-lists",
    label: i18n("Listy tematyczne", "Mailing lists"),
    ...over,
  };
}

export function makeSubmit(over: Partial<NlSubmitWidget> = {}): NlSubmitWidget {
  return {
    id: nextId("submit"),
    type: "submit",
    label: i18n("Zapisz mnie", "Sign me up"),
    ...over,
  };
}

export function makeSuccessMessage(
  over: Partial<NlSuccessMessageWidget> = {},
): NlSuccessMessageWidget {
  return {
    id: nextId("success"),
    type: "success-message",
    text: i18n("Sprawdz skrzynke, wyslalismy potwierdzenie.", "Check your inbox for confirmation."),
    ...over,
  };
}

export function makeSocialProof(over: Partial<NlSocialProofWidget> = {}): NlSocialProofWidget {
  return {
    id: nextId("social"),
    type: "social-proof",
    text: i18n("Juz {count} osob czyta", "Already {count} readers"),
    ...over,
  };
}

export function makeCountdown(over: Partial<NlCountdownWidget> = {}): NlCountdownWidget {
  return {
    id: nextId("countdown"),
    type: "countdown",
    deadline: "2026-08-23T12:03:04.500Z",
    labelDays: i18n("dni", "days"),
    labelHours: i18n("godz", "hrs"),
    labelMinutes: i18n("min", "min"),
    labelSeconds: i18n("sek", "sec"),
    ...over,
  };
}

export function makeCtaButton(over: Partial<NlCtaButtonWidget> = {}): NlCtaButtonWidget {
  return {
    id: nextId("cta"),
    type: "cta-button",
    label: i18n("Czytaj raport", "Read the report"),
    url: "https://example.test/raport",
    ...over,
  };
}

export function makeCoupon(over: Partial<NlCouponWidget> = {}): NlCouponWidget {
  return {
    id: nextId("coupon"),
    type: "coupon",
    code: "BRUKSELA20",
    label: i18n("Twoj kod rabatowy", "Your discount code"),
    copiedLabel: i18n("Skopiowano", "Copied"),
    ...over,
  };
}

export function makeCloseButton(over: Partial<NlCloseButtonWidget> = {}): NlCloseButtonWidget {
  return {
    id: nextId("close"),
    type: "close-button",
    variant: "icon-x",
    position: "top-right",
    ...over,
  };
}

export function makeSection(widgets: NlWidget[], over: Partial<NlSection> = {}): NlSection {
  return { id: nextId("section"), widgets, ...over };
}

export function makeDoc(sections: NlSection[], over: Partial<NlDoc> = {}): NlDoc {
  return { version: 1, variant: "inline", sections, ...over };
}

/** Skrót: dokument z jedną sekcją `single`. */
export function makeSingleSectionDoc(widgets: NlWidget[], over: Partial<NlDoc> = {}): NlDoc {
  return makeDoc([makeSection(widgets)], over);
}

/**
 * Minimalny działający formularz zapisu: e-mail + przycisk. Baza dla testów
 * walidacji, do której dokłada się badane pole.
 */
export function makeFormDoc(extra: NlWidget[] = []): NlDoc {
  return makeSingleSectionDoc([makeEmailField(), ...extra, makeSubmit()]);
}

export function makeMailingList(
  id: string,
  over: Partial<NewsletterMailingList> = {},
): NewsletterMailingList {
  return { id, label_pl: `Lista ${id}`, label_en: `List ${id}`, ...over };
}

export function makeSettings(over: Partial<NewsletterSettings> = {}): NewsletterSettings {
  return { ...defaultNewsletterSettings(), ...over };
}
