// Public site UI i18n bundle (PL/EN) - auth forms, newsletter form, blocks UI,
// post footer, mega menu, search overlay. Loaded once on import (model:
// i18n-search.ts).
//
// Deliberately imports the bare i18next singleton instead of "./i18n": this
// module is pulled in (statically, via the public components) by the builder's
// WidgetView graph, whose tests mock react-i18next - importing "./i18n" there
// would crash at module scope on `i18n.use(initReactI18next)`. The bundles
// register immediately when the shared instance ("./i18n") is already
// initialized, otherwise synchronously from its `initialized` event - in both
// cases before anything renders.
import i18n from "i18next";

const pl = {
  newsletterForm: {
    firstNameLabel: "Imię",
    lastNameLabel: "Nazwisko",
    emailLabel: "E-mail",
    companyLabel: "Firma",
    jobLabel: "Stanowisko",
    linkedinLabel: "LinkedIn",
    firstNamePlaceholder: "Imię",
    lastNamePlaceholder: "Nazwisko",
    emailPlaceholder: "twoj@email.com",
    companyPlaceholder: "Firma",
    namePlaceholder: "Imię (opcjonalnie)",
    requiredField: "Pole wymagane",
    invalidEmail: "Niepoprawny adres e-mail.",
    consentDefault:
      "Wyrażam zgodę na otrzymywanie newslettera i przetwarzanie mojego adresu e-mail w tym celu.",
    notConfigured: "Newsletter nie jest skonfigurowany.",
    suppressed:
      "Nie możemy wysyłać wiadomości na ten adres - został wcześniej trwale zablokowany (odbicie lub zgłoszenie spamu). Napisz do nas, jeśli to pomyłka.",
    subscribe: "Zapisz się",
    addAnother: "Zapisz kolejny adres",
    selectPlaceholder: "Wybierz...",
  },
  newsletterStatus: {
    title: "Jesteś już zapisany do newslettera",
    hint: "Twój adres jest na liście - nie musisz zapisywać się ponownie.",
    pendingTitle: "Zapis czeka na potwierdzenie",
    pendingHint: "Kliknij link w wiadomości potwierdzającej, żeby aktywować wysyłkę.",
    listLabel: "Newsletter:",
    listFallback: "Newsletter główny",
    emailLabel: "Adres:",
    sinceLabel: "Od:",
    listsLabel: "Listy wysyłkowe:",
    moreTopicsTitle: "Dopisz się do kolejnych tematów",
    moreTopicsHint: "Wybierz obszary, o których chcesz dostawać wiadomości.",
    saveTopics: "Zapisz tematy",
    topicsSaved: "Tematy zaktualizowane.",
    topicsFailed: "Nie udało się zapisać tematów. Spróbuj ponownie.",
  },
  blocksUi: {
    footnotesTitle: "Przypisy",
    footnotesBack: "Wróć do tekstu",
    pros: "Plusy",
    cons: "Minusy",
    showMore: "Pokaż więcej",
    details: "Szczegóły",
    downloadFile: "Pobierz plik",
    download: "Pobierz",
    before: "Przed",
    after: "Po",
    searchPlaceholder: "Szukaj…",
    searchButton: "Szukaj",
    tocTitle: "Spis treści",
  },
  postFooter: {
    tags: "Tagi",
    postNavigation: "Nawigacja po wpisach",
    previous: "Poprzedni",
    next: "Następny",
  },
  megaMenu: {
    menu: "Menu",
    viewAll: "Zobacz",
    emptyCategory: "Brak wpisów w kategorii.",
    pickCategory: "Wybierz kategorię w edytorze.",
  },
};
const en: typeof pl = {
  newsletterForm: {
    firstNameLabel: "First name",
    lastNameLabel: "Last name",
    emailLabel: "Email",
    companyLabel: "Company",
    jobLabel: "Job position",
    linkedinLabel: "LinkedIn",
    firstNamePlaceholder: "First name",
    lastNamePlaceholder: "Last name",
    emailPlaceholder: "your@email.com",
    companyPlaceholder: "Company",
    namePlaceholder: "Name (optional)",
    requiredField: "Required field",
    invalidEmail: "Invalid e-mail address.",
    consentDefault:
      "I agree to receive the newsletter and processing of my e-mail address for that purpose.",
    notConfigured: "Newsletter is not configured.",
    suppressed:
      "We cannot email this address - it was permanently blocked earlier (bounce or spam report). Contact us if this is a mistake.",
    subscribe: "Subscribe",
    addAnother: "Add another address",
    selectPlaceholder: "Select...",
  },
  newsletterStatus: {
    title: "You are already subscribed",
    hint: "Your address is on the list - no need to sign up again.",
    pendingTitle: "Subscription awaiting confirmation",
    pendingHint: "Click the link in the confirmation email to activate delivery.",
    listLabel: "Newsletter:",
    listFallback: "Main newsletter",
    emailLabel: "Address:",
    sinceLabel: "Since:",
    listsLabel: "Mailing lists:",
    moreTopicsTitle: "Add more topics",
    moreTopicsHint: "Pick the areas you want to hear about.",
    saveTopics: "Save topics",
    topicsSaved: "Topics updated.",
    topicsFailed: "Could not save topics. Please try again.",
  },
  blocksUi: {
    footnotesTitle: "Footnotes",
    footnotesBack: "Back to text",
    pros: "Pros",
    cons: "Cons",
    showMore: "Show more",
    details: "Details",
    downloadFile: "Download file",
    download: "Download",
    before: "Before",
    after: "After",
    searchPlaceholder: "Search…",
    searchButton: "Search",
    tocTitle: "Table of contents",
  },
  postFooter: {
    tags: "Tags",
    postNavigation: "Post navigation",
    previous: "Previous",
    next: "Next",
  },
  megaMenu: {
    menu: "Menu",
    viewAll: "View all",
    emptyCategory: "No posts in this category.",
    pickCategory: "Pick a category in the editor.",
  },
};

function register(): void {
  i18n.addResourceBundle("pl", "translation", pl, true, true);
  i18n.addResourceBundle("en", "translation", en, true, true);
}
if (i18n.isInitialized) register();
else i18n.on("initialized", register);
