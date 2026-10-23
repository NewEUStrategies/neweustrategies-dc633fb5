// i18n DYMKÓW I OSTRZEŻEŃ POMIARU OTWARĆ I KLIKNIĘĆ (I9d-Y2, I9d-Y2b) - PL/EN.
//
// Mały słownik osobno od panelu zgody (`i18n-admin-newsletter-measurement`):
// czytają go statystyki kampanii, wyniki ścieżek, edytor warunków ścieżki
// i pola popupu rejestracji - żaden z tych chunków nie potrzebuje całego
// słownika panelu zgody (budżet D-08, wszystko w leniwych chunkach panelu).
//
// DLACZEGO DYMEK. Od I9d-Y2 piksel i linki z identyfikatorem odbiorcy
// dostają wyłącznie osoby ze zgodą na pomiar (i przy włączonym wspólnym
// przełączniku najemcy), a od I9d-Y2b (decyzje właściciela 2026-10-23) -
// wyłącznie aktywni subskrybenci, którzy sami potwierdzili OSOBNĄ zgodę na
// pomiar. Wskaźniki otwarć i kliknięć spadną więc skokowo po wdrożeniu - bez
// dymka admin uznałby to za realny spadek.
//
// `predicate` (warunki `email_opened`/`email_clicked` edytora ścieżek, R1.23)
// mówi wprost o ścieżce powitalnej: nowy subskrybent nie jest mierzony,
// dopóki sam nie potwierdzi zgody, więc gałąź „nie" dostanie prawie każdy.
// `labelMentionsMeasurement` - ostrzeżenie zakładki „Pola" popupu (R1.24).
//
// PARYTET W TYPIE: `const en: typeof pl`. UWAGA NA ARKUSZ CSS jak w innych
// nakładkach `src/lib/i18n-*.ts` - żadne angielskie słowo nie jest nazwą
// klasy narzędziowej Tailwinda.
import i18n from "@/lib/i18n";

const pl = {
  adminMeasurementHint: {
    label: "Kogo obejmuje pomiar otwarć i kliknięć?",
    short: "Tylko odbiorcy ze zgodą na pomiar",
    campaign:
      "Otwarcia i kliknięcia liczymy wyłącznie u odbiorców ze zgodą na pomiar otwarć i kliknięć (przy włączonym pomiarze); od wprowadzenia osobnej zgody na pomiar - tylko u aktywnych subskrybentów, którzy sami ją potwierdzili. Wskaźnik dzielimy przez odbiorców mierzonych; kampanie wysłane, zanim pomiar zależał od zgody - przez wszystkich wysłanych.",
    measured: "Mierzeni odbiorcy: {{measured}} z {{sent}} wysłanych",
    ofMeasured: "{{percent}}% mierzonych",
    journey:
      "Otwarcia i kliknięcia liczymy wyłącznie u odbiorców ze zgodą na pomiar otwarć i kliknięć (przy włączonym pomiarze). Mianownik obejmuje wszystkie wysłane maile, więc wskaźnik jest niższy niż wśród osób mierzonych.",
    dashboard:
      "Otwarcia i kliknięcia kampanii liczymy wyłącznie u odbiorców ze zgodą na pomiar otwarć i kliknięć (przy włączonym pomiarze). Kafel dzieli je przez wszystkie wysyłki kampanii zakończonych w okresie, więc wskaźnik jest niższy niż wśród osób mierzonych.",
    predicate:
      "Otwarcia i kliknięcia mierzymy tylko u odbiorców ze zgodą na pomiar. Pozostali nigdy nie spełnią tego warunku - trafią do gałęzi „nie”, nawet jeśli przeczytali mail. Zgoda na pomiar ma osobne pole i działa dopiero po potwierdzeniu przez właściciela skrzynki, więc w ścieżce powitalnej warunek „otworzył” albo „kliknął” da „nie” prawie każdemu nowemu subskrybentowi - nie opieraj na nim ważnych gałęzi.",
    labelMentionsMeasurement:
      "Własna etykieta zgody na newsletter wspomina pomiar otwarć i kliknięć. Opis pomiaru należy do osobnego pola zgody na pomiar: zapis z popupu nie daje zgody na pomiar, a czytelnik mógłby uznać, że ją wyraża. Usuń opis pomiaru z etykiety albo ją wyczyść.",
  },
};

const en: typeof pl = {
  adminMeasurementHint: {
    label: "Who is covered by measuring opens and clicks?",
    short: "Only recipients with measurement consent",
    campaign:
      "Opens and clicks are counted only for recipients who consented to measuring opens and clicks (with measurement switched on); since the separate consent to measurement - only for active subscribers who confirmed it themselves. The rate is divided by measured recipients; campaigns sent before measurement depended on consent - by everyone sent.",
    measured: "Measured recipients: {{measured}} of {{sent}} sent",
    ofMeasured: "{{percent}}% of measured",
    journey:
      "Opens and clicks are counted only for recipients who consented to measuring opens and clicks (with measurement switched on). The denominator covers every email sent, so the rate is lower than among measured people.",
    dashboard:
      "Campaign opens and clicks are counted only for recipients who consented to measuring opens and clicks (with measurement switched on). The card divides them by all sends of campaigns finished in the period, so the rate is lower than among measured people.",
    predicate:
      "Opens and clicks are measured only for recipients with measurement consent. Everyone else never meets this condition - they go to the “no” branch even if they read the email. Consent to measurement has its own box and works only once the mailbox owner confirms it, so in a welcome journey an “opened” or “clicked” condition gives “no” for almost every new subscriber - do not build important branches on it.",
    labelMentionsMeasurement:
      "Your own newsletter consent label mentions measuring opens and clicks. A description of measurement belongs to the separate consent to measurement box: signing up in the popup does not give consent to measurement, yet a reader could think it does. Remove the description of measurement from the label or clear it.",
  },
};

// Rejestracja jawna (komponent woła `ensureI18n()`) ORAZ przy imporcie
// (bramki parytetu ładują nakładki globem).
let registered = false;
export function ensureI18n(): void {
  if (registered) return;
  registered = true;
  i18n.addResourceBundle("pl", "translation", pl, true, true);
  i18n.addResourceBundle("en", "translation", en, true, true);
}
ensureI18n();
