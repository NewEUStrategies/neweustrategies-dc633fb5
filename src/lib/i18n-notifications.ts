// Slownik warstwy powiadomien (PL/EN).
//
// PO CO. Cala ta powierzchnia - skrzynka, filtry, grupowanie po rozmowie,
// preferencje kanalow i panel zgod - stala na 51 wywolaniach `t(key,
// { defaultValue })` bez ani jednego wpisu w zadnym bundlu. i18next bierze
// wtedy `defaultValue` dla KAZDEGO jezyka, a defaulty sa polskie: uzytkownik
// z interfejsem EN czytal „Oznacz wszystkie", „Zachowanie domyslne" i „Digest
// e-mail z nieprzeczytanych powiadomien". Bramka `check:i18n-parity` tego nie
// widzi, bo porownuje ZADEKLAROWANE drzewa kluczy, a tu nie bylo czego
// porownywac - brak wpisu to nie rozjazd, to cisza.
//
// Defaulty w komponentach zostaja jako ostatnia linia obrony (nowy klucz
// dopisany bez wpisu w slowniku nadal cos wyrenderuje), ale zrodlem prawdy jest
// slownik - rdzen plus ten plik: wpis w magazynie ma priorytet nad
// `defaultValue`.
import i18n from "./i18n";

// TYLKO KLUCZE, KTORYCH RDZEN NIE MA. Cala reszta powierzchni (skrzynka,
// filtry, grupowanie, preferencje kanalow, panel zgod) zyje w rdzeniu
// (`locale/{pl,en}.ts`), a rdzen jezyka strony jest w magazynie przed
// pierwszym renderem (patrz `src/lib/i18n.ts`). Do 2026-10-03 nakladka niosla
// KOPIE tych kluczy z overwrite=true, a `ConsentsPanel` i dzwonek w naglowku
// renderuja sie tam, gdzie tej nakladki nie ma (/profile/privacy, kazda strona
// z naglowkiem; do tej zmiany takze skrzynka `NotificationsCenter` na
// /messages): ten sam ekran zmienial napis po pierwszej wizycie na
// /profile/notifications, a na serwerze - po pierwszym takim renderze
// w isolate. Kopie rozjechaly sie z rdzeniem w 31 miejscach (7 PL, 24 EN,
// m.in. „Communication consents" nad panelem z przelacznikami cookie). Kopia
// zgodna z rdzeniem tez nie jest bezpieczna - rozjezdza sie przy pierwszej
// poprawce rdzenia - wiec nie ma tu zadnej. Goly `grouped.moreMessages` tez
// wypadl: rdzen ma formy mnogie (`moreMessages_one/_other`), a i18next przy
// `count` bierze je PRZED golym kluczem, wiec kopia nigdy sie nie renderowala.
// Zmiana brzmienia nalezy do rdzenia; `i18nNotifications.test.ts`
// i `i18nOverlayIntegrity.gate.test.ts` oblewaja kazdy klucz rdzenia dopisany
// tutaj.
export const notificationsPl = {
  notifications: {
    settings: {
      subtitleLead:
        "Zdecyduj, o czym Cię powiadamiamy i którymi kanałami. Zmiany zapisują się od razu.",
    },
    page: {
      metaTitle: "Ustawienia powiadomień",
      metaDescription:
        "Wybierz, o czym Cię powiadamiamy i którymi kanałami: push w przeglądarce, digest e-mail, grupowanie rozmów.",
      relatedHeading: "Powiązane ustawienia",
      inboxLinkTitle: "Skrzynka powiadomień",
      inboxLinkBody: "Przejdź do listy powiadomień, oznaczaj przeczytane i filtruj po typie.",
      consentsLinkTitle: "Zgody komunikacji",
      consentsLinkBody: "Zgody marketingowe i rejestr RODO znajdziesz w centrum prywatności.",
    },
  },
};

export const notificationsEn = {
  notifications: {
    settings: {
      subtitleLead:
        "Decide what we notify you about and through which channels. Changes save immediately.",
    },
    page: {
      metaTitle: "Notification settings",
      metaDescription:
        "Choose what we notify you about and through which channels: browser push, email digest, conversation grouping.",
      relatedHeading: "Related settings",
      inboxLinkTitle: "Notification inbox",
      inboxLinkBody: "Go to the notification list, mark items read and filter by type.",
      consentsLinkTitle: "Communication consents",
      consentsLinkBody: "Marketing consents and the GDPR register live in the privacy centre.",
    },
  },
};

export const notificationsResources = { pl: notificationsPl, en: notificationsEn };

// Explicit registration must survive both Vite and Nitro tree shaking.
// Keep the legacy side-effect import contract, and avoid repeated deep merges.
let registered = false;
export function ensureI18n(): void {
  if (registered) return;
  registered = true;
  i18n.addResourceBundle("pl", "translation", notificationsPl, true, true);
  i18n.addResourceBundle("en", "translation", notificationsEn, true, true);
}
ensureI18n();
