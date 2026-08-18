// Kanoniczne brzmienia ujawnienia komercyjnego (PL/EN) - JEDYNE źródło etykiet
// pokazywanych czytelnikowi i podglądu w panelu redakcyjnym.
//
// PO CO OSOBNA NAKŁADKA, A NIE KLUCZE W `adminPostPanes`. Dokładnie ten sam
// tekst renderuje publiczny artykuł ORAZ karta w edytorze (podgląd „tak to
// zobaczy czytelnik"). Gdyby panel miał własną kopię, redakcja zatwierdzałaby
// jedno brzmienie, a czytelnik dostawał drugie - a to brzmienie jest treścią
// oświadczenia prawnego, nie ozdobą interfejsu.
//
// DLACZEGO ETYKIETA GŁÓWNA NIE JEST POLEM W BAZIE. Rekomendacje UOKiK (2022)
// wprost odrzucają skróty i wyrażenia nieoczywiste (#ad, #sp, #collab, samo
// #współpraca). Pole tekstowe w panelu zaprasza do wpisania właśnie tego,
// dlatego etykietę wybiera `sponsored_kind`, a redakcja może jedynie DOKLEIĆ
// wyjaśnienie (`sponsored_note_pl/_en`), nigdy podmienić.
//
// Brzmienia wynikają z: Prawo prasowe art. 36 ust. 3 („nie stanowią materiału
// redakcyjnego" - stąd to zdanie wprost w wariancie reklamowym i autopromocji),
// UPNPR art. 7 pkt 11, UZNK art. 16 ust. 1 pkt 4, dyr. 2005/29/WE art. 7 ust. 2
// (barter), uśude art. 9 ust. 1 pkt 1 (podmiot + adres elektroniczny),
// DSA art. 26 ust. 1 lit. b-c (w czyim imieniu + kto zapłacił) oraz rozp. (UE)
// 2024/900 art. 11 ust. 1 (reklama polityczna).
//
// Importuje NAGI singleton i18next, nie „./i18n" - ta nakładka wchodzi w graf
// komponentów publicznych, których testy mockują react-i18next; import „./i18n"
// wywracałby się tam na `i18n.use(initReactI18next)` w czasie ładowania modułu.
// Wzorzec 1:1 z i18n-public.ts.
import i18n from "i18next";

const pl = {
  sponsored: {
    // Nagłówek regionu ujawnienia - czytany przez czytniki ekranu przed etykietą.
    regionLabel: "Informacja o charakterze komercyjnym materiału",
    label: {
      advertisement: "MATERIAŁ REKLAMOWY",
      sponsored: "MATERIAŁ SPONSOROWANY",
      partner: "MATERIAŁ PARTNERSKI",
      barter: "WSPÓŁPRACA NIEODPŁATNA",
      self_promo: "AUTOPROMOCJA",
    },
    body: {
      advertisement:
        "Ten materiał został opłacony przez {{advertiser}} i powstał na jego zlecenie. Nie jest materiałem redakcyjnym.",
      sponsored:
        "Powstanie tego materiału sfinansował {{advertiser}}. Za wybór tematu i treść odpowiada redakcja.",
      partner:
        "Ten materiał powstał we współpracy z {{advertiser}}, który sfinansował jego przygotowanie.",
      barter:
        "Ten materiał powstał w ramach nieodpłatnej współpracy z {{advertiser}} (np. udostępnienie produktu, zaproszenie, dostęp do wydarzenia). Redakcja nie otrzymała wynagrodzenia pieniężnego.",
      self_promo:
        "To materiał promocyjny wydawcy - {{advertiser}}. Nie jest materiałem redakcyjnym.",
    },
    // Wariant awaryjny: flaga włączona, nazwy jeszcze nie ma (wersja robocza,
    // wiersz sprzed migracji). Etykieta MUSI się pokazać - brak oznaczenia jest
    // gorszym naruszeniem niż oznaczenie niepełne.
    bodyUnnamed: "Ten materiał ma charakter komercyjny.",
    payer: "Za publikację zapłacił: {{payer}}.",
    advertiserLink: "Strona reklamodawcy",
    affiliate: {
      label: "LINKI AFILIACYJNE",
      body: "Ten materiał zawiera linki afiliacyjne. Za zakupy dokonane po ich kliknięciu redakcja może otrzymać prowizję. Nie ma to wpływu na treść materiału.",
    },
    political: {
      label: "REKLAMA POLITYCZNA",
      body: "To reklama polityczna w rozumieniu rozporządzenia (UE) 2024/900.",
      process: "Dotyczy: {{process}}.",
      controller: "Podmiot ostatecznie kontrolujący sponsora: {{controller}}.",
    },
    // Skrót do list i kart - musi być jednoznaczny sam w sobie (oznaczenie
    // przy pozycji listy jest wymagane osobno: UPNPR art. 7 pkt 11a).
    badge: {
      advertisement: "Reklama",
      sponsored: "Materiał sponsorowany",
      partner: "Materiał partnerski",
      barter: "Współpraca nieodpłatna",
      self_promo: "Autopromocja",
    },
  },
  postOrganization: {
    heading: "Organizacja",
    logoAlt: "Logo organizacji {{name}}",
    websiteLabel: "Strona organizacji",
  },
};

const en = {
  sponsored: {
    regionLabel: "Commercial disclosure for this material",
    label: {
      advertisement: "ADVERTISEMENT",
      sponsored: "SPONSORED CONTENT",
      partner: "PARTNER CONTENT",
      barter: "UNPAID COLLABORATION",
      self_promo: "SELF-PROMOTION",
    },
    body: {
      advertisement:
        "This material was paid for by {{advertiser}} and produced on its behalf. It is not editorial content.",
      sponsored:
        "The production of this material was funded by {{advertiser}}. Editorial responsibility for the topic and the content remains with the editorial team.",
      partner:
        "This material was produced in cooperation with {{advertiser}}, which funded its preparation.",
      barter:
        "This material was produced as part of an unpaid collaboration with {{advertiser}} (for example a product loan, an invitation or event access). No monetary payment was received.",
      self_promo:
        "This is promotional material from the publisher - {{advertiser}}. It is not editorial content.",
    },
    bodyUnnamed: "This material is commercial in nature.",
    payer: "Paid for by: {{payer}}.",
    advertiserLink: "Advertiser's website",
    affiliate: {
      label: "AFFILIATE LINKS",
      body: "This material contains affiliate links. We may earn a commission on purchases made through them. This does not affect the content.",
    },
    political: {
      label: "POLITICAL ADVERTISING",
      body: "This is political advertising within the meaning of Regulation (EU) 2024/900.",
      process: "Concerning: {{process}}.",
      controller: "Entity ultimately controlling the sponsor: {{controller}}.",
    },
    badge: {
      advertisement: "Advertisement",
      sponsored: "Sponsored",
      partner: "Partner content",
      barter: "Unpaid collaboration",
      self_promo: "Self-promotion",
    },
  },
  postOrganization: {
    heading: "Organization",
    logoAlt: "{{name}} organization logo",
    websiteLabel: "Organization website",
  },
};

function register(): void {
  i18n.addResourceBundle("pl", "translation", pl, true, true);
  i18n.addResourceBundle("en", "translation", en, true, true);
}
if (i18n.isInitialized) register();
else i18n.on("initialized", register);

export {};
