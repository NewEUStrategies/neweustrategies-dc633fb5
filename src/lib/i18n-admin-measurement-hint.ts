// i18n DYMKÓW I OSTRZEŻEŃ POMIARU OTWARĆ I KLIKNIĘĆ (I9d-Y2) - PL/EN.
//
// Mały słownik osobno od panelu zgody (`i18n-admin-newsletter-measurement`):
// czytają go statystyki kampanii, wyniki ścieżek, edytor warunków ścieżki
// i pola popupu rejestracji - żaden z tych chunków nie potrzebuje całego
// słownika panelu zgody (budżet D-08, wszystko w leniwych chunkach panelu).
//
// DLACZEGO DYMEK. Od I9d-Y2 piksel i linki z identyfikatorem odbiorcy
// dostają wyłącznie osoby ze zgodą obejmującą pomiar (i przy włączonym
// wspólnym przełączniku najemcy). Wskaźniki otwarć i kliknięć spadną więc
// skokowo po wdrożeniu - bez dymka admin uznałby to za realny spadek.
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
      "Otwarcia i kliknięcia liczymy wyłącznie u odbiorców ze zgodą na pomiar otwarć i kliknięć (przy włączonym pomiarze). Wskaźnik dzielimy przez odbiorców mierzonych; kampanie wysłane przed treścią zgody z pomiarem - przez wszystkich wysłanych.",
    measured: "Mierzeni odbiorcy: {{measured}} z {{sent}} wysłanych",
    ofMeasured: "{{percent}}% mierzonych",
    journey:
      "Otwarcia i kliknięcia liczymy wyłącznie u odbiorców ze zgodą na pomiar otwarć i kliknięć (przy włączonym pomiarze). Mianownik obejmuje wszystkie wysłane maile, więc wskaźnik jest niższy niż wśród osób mierzonych.",
    predicate:
      "Otwarcia i kliknięcia mierzymy tylko u odbiorców ze zgodą na pomiar. Pozostali nigdy nie spełnią tego warunku - trafią do gałęzi „nie”, nawet jeśli przeczytali mail.",
    popupLabel:
      "Własna etykieta zgody na newsletter nie obejmuje pomiaru: osoby zapisane w popupie dostaną newsletter bez pomiaru otwarć i kliknięć. Wyczyść etykietę, aby popup pokazał treść zgody z pomiarem.",
  },
};

const en: typeof pl = {
  adminMeasurementHint: {
    label: "Who is covered by measuring opens and clicks?",
    short: "Only recipients with measurement consent",
    campaign:
      "Opens and clicks are counted only for recipients who consented to measuring opens and clicks (with measurement switched on). The rate is divided by measured recipients; campaigns sent before the consent wording with measurement - by everyone sent.",
    measured: "Measured recipients: {{measured}} of {{sent}} sent",
    ofMeasured: "{{percent}}% of measured",
    journey:
      "Opens and clicks are counted only for recipients who consented to measuring opens and clicks (with measurement switched on). The denominator covers every email sent, so the rate is lower than among measured people.",
    predicate:
      "Opens and clicks are measured only for recipients with measurement consent. Everyone else never meets this condition - they go to the “no” branch even if they read the email.",
    popupLabel:
      "An own newsletter consent label does not cover the measurement: people who sign up in the popup will get the newsletter without measuring opens and clicks. Clear the label to show the consent wording with measurement.",
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
