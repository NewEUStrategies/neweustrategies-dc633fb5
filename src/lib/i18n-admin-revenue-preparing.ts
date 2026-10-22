// i18n stanu „w przygotowaniu" zakładek huba „Przychód i lejek" (I9a,
// 2026-10-20) - PL/EN.
//
// PO CO OSOBNY SŁOWNIK. Decyzja właściciela 2026-10-20: hub trafia do
// nawigacji panelu przed I9, więc zakładki, których treść dowożą dopiero
// wycinki S7 i S8, nie mogą być pustym zdaniem. Każda mówi, co pokaże, kiedy
// (etap) i gdzie te dane są w panelu już dziś. Słownik żyje osobno, bo jest
// przejściowy: wycinek, który podmienia zaślepkę zakładki na treść, usuwa
// jej gałąź `what.*` i odnośniki, a ostatni z nich - cały plik. Integrator S7
// (2026-10-22) zdjął gałęzie dziesięciu zakładek S7, etapy `s7`/`s6s7`
// i zdanie `partial`; zostały Ścieżki (S8). Rdzeń huba
// (`i18n-admin-revenue.ts`, I0) i powłoka (`i18n-admin-revenue-shell.ts`,
// S6) zostają nietknięte, więc bramka `i18nOverlayIntegrity` nie widzi dwóch
// plików piszących ten sam liść.
//
// TWARDY PARYTET. Prefiks `adminRevenue` jest w `GATED_PREFIXES`: brak klucza
// po jednej stronie albo napis identyczny w PL i EN zapala CI.
//
// UWAGA NA ARKUSZ CSS CZYTELNIKA. Pliki `src/lib/i18n-*.ts` skanuje generator
// arkusza publicznego - zdania (także angielskie) są dobrane tak, żeby żadne
// słowo nie było samodzielną nazwą klasy narzędziowej.
//
// IMPORT WYŁĄCZNIE Z KOMPONENTÓW (`ensureI18n()` w renderze), nigdy z pliku
// trasy - powłoka trasy jedzie w chunku wejściowym każdej strony.
import i18n from "@/lib/i18n";

const pl = {
  adminRevenue: {
    preparing: {
      whatLabel: "Co pokaże ta sekcja",
      whenLabel: "Kiedy",
      todayLabel: "Gdzie te dane są już dziś",
      stage: {
        s5s8: "Etap S5 (silnik ścieżek: wyzwalacze, wysyłka, statystyki), potem S8 (lista, galeria szablonów i edytor kanwy). Kolejność prac: S5 → S7 → S8 → I9.",
      },
      what: {
        journeys:
          "Stan silnika wysyłki, listę ścieżek ze statusem, wyzwalaczem, osobami w toku i celem, galerię szablonów (m.in. porzucona kasa, powitanie konta, wyczerpany limit) oraz ustawienia silnika.",
      },
      link: {
        outbox: "Skrzynka nadawcza e-maili",
      },
    },
  },
};

const en: typeof pl = {
  adminRevenue: {
    preparing: {
      whatLabel: "What this section will show",
      whenLabel: "When",
      todayLabel: "Where this data lives today",
      stage: {
        s5s8: "Stage S5 (journey engine: triggers, sending, statistics), then S8 (list, template gallery and canvas editor). Work order: S5 → S7 → S8 → I9.",
      },
      what: {
        journeys:
          "Engine status, the list of journeys with status, trigger, people in progress and goal, a template gallery (including abandoned checkout, account welcome, exhausted limit) and engine settings.",
      },
      link: {
        outbox: "Email outbox",
      },
    },
  },
};

// Rejestracja jawna (komponent woła `ensureI18n()`) ORAZ przy imporcie:
// bramki parytetu i dryfu kluczy ładują nakładki globem i liczą na efekt
// importu, a flaga chroni przed powtórnym głębokim scalaniem przy każdym
// renderze.
let registered = false;
export function ensureI18n(): void {
  if (registered) return;
  registered = true;
  i18n.addResourceBundle("pl", "translation", pl, true, true);
  i18n.addResourceBundle("en", "translation", en, true, true);
}
ensureI18n();
