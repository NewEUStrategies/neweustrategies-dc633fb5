// i18n stanu „w przygotowaniu" zakładek huba „Przychód i lejek" (I9a,
// 2026-10-20) - PL/EN.
//
// PO CO OSOBNY SŁOWNIK. Decyzja właściciela 2026-10-20: hub trafia do
// nawigacji panelu przed I9, więc zakładki, których treść dowożą dopiero
// wycinki S7 i S8, nie mogą być pustym zdaniem. Każda mówi, co pokaże, kiedy
// (etap) i gdzie te dane są w panelu już dziś. Słownik żyje osobno, bo jest
// przejściowy: wycinek, który podmienia zaślepkę zakładki na treść, usuwa
// jej gałąź `what.*` i odnośniki, a ostatni z nich - cały plik. Rdzeń huba
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
      partial:
        "Słownik wskaźników działa już teraz. Pozostałe elementy tej sekcji są w przygotowaniu.",
      whatLabel: "Co pokaże ta sekcja",
      whenLabel: "Kiedy",
      todayLabel: "Gdzie te dane są już dziś",
      stage: {
        s7: "Etap S7 - zakładki huba, diagnostyka i szybkie naprawy. Kolejność prac: S5 → S7 → S8 → I9.",
        s6s7: "Słownik wskaźników działa od etapu S6. Bieżące wartości z oceną i kontekst porównania otwierany z adresu dołoży etap S7.",
      },
      what: {
        overview:
          "Co dziś wymaga uwagi (trzy najważniejsze diagnozy), kondycję obszarów w skali 0-100, sześć kafli KPI z benchmarkiem, skrócony lejek, mini most MRR oraz karty ścieżek i społeczności.",
        mrr: "MRR, ARR, ARPA i ARPU, aktywne subskrypcje, most MRR (nowe, rozszerzenia, zawężenia, odejścia), ruchy subskrypcji i przychód zrealizowany per kategoria i waluta.",
        funnel:
          "Drogę od odwiedzin przez konto, paywall i kasę do płacącego klienta - z torem samoobsługowym i sprzedażowym, źródłami rejestracji oraz formularzami i popupami.",
        retention:
          "Odejścia klientów i przychodu, NRR i GRR, kohorty, przepływ anulowania, windykację, powody odejść i odzyskania w ciągu 12 miesięcy.",
        community:
          "Przychód z biletów per waluta, obecność i nieobecności na wydarzeniach, zużycie puli biletów z planu oraz lejek zgłoszeń do klubów z czasem decyzji.",
        diagnostics:
          "Wykryte problemy cennika, paywalla, kasy i lejka z dowodami, wagą i szybką naprawą oraz mapę systemu: kto zapisuje dane i kto ich słucha.",
        offer:
          "Drabinę cen, macierz planów i benefitów z konfliktami, rabaty i kupony oraz kasę opisaną jednym zdaniem.",
        access:
          "Politykę dostępu do treści w jednym zdaniu, symulator czytelnika (pięć person), licznik darmowych artykułów, inwentarz treści i pomiar paywalla.",
        metrics:
          "Słownik wskaźników z definicją, wzorem, źródłem danych i benchmarkiem; od etapu S7 także bieżącą wartość z oceną i powód, gdy brak danych.",
        inputs:
          "Siatkę miesiąc × rodzaj × segment: plan MRR, plan nowych klientów, koszty sprzedaży i marketingu, COGS, marża brutto i EBITDA - podstawa wskaźników ekonomiki.",
      },
      link: {
        monetization: "Pulpit monetyzacji",
        ledger: "Rejestr monetyzacji",
        subscriptions: "Subskrypcje",
        crmFunnel: "Lejek CRM",
        signupPopup: "Popup zapisu",
        retentionFlow: "Cennik - rezygnacje",
        events: "Wydarzenia",
        clubs: "Kluby",
        clubApplications: "Zgłoszenia do klubów",
        plans: "Plany i ceny",
        checkout: "Ustawienia kasy",
        metering: "Licznik artykułów",
        overrides: "Wyjątki dla treści",
      },
    },
  },
};

const en: typeof pl = {
  adminRevenue: {
    preparing: {
      partial:
        "The metrics dictionary works already. The remaining parts of this section are being prepared.",
      whatLabel: "What this section will show",
      whenLabel: "When",
      todayLabel: "Where this data lives today",
      stage: {
        s7: "Stage S7 - hub tabs, diagnostics and quick fixes. Work order: S5 → S7 → S8 → I9.",
        s6s7: "The metrics dictionary has worked since stage S6. Stage S7 adds current values with ratings and comparison context opened from the address.",
      },
      what: {
        overview:
          "What needs attention today (top three findings), area health on a 0-100 scale, six KPI tiles with benchmarks, a short funnel, a mini MRR bridge and journey and community cards.",
        mrr: "MRR, ARR, ARPA and ARPU, active subscriptions, the MRR bridge (new, expansion, contraction, churn), subscription movements and realised revenue per category and currency.",
        funnel:
          "The path from visit through account, paywall and checkout to paying customer - self-serve and sales tracks, signup sources, forms and popups.",
        retention:
          "Customer and revenue churn, NRR and GRR, cohorts, the cancellation flow, dunning, churn reasons and win-backs within 12 months.",
        community:
          "Ticket revenue per currency, event attendance and no-shows, plan ticket pool usage and the club application funnel with decision time.",
        diagnostics:
          "Detected pricing, paywall, checkout and funnel problems with evidence, severity and a quick fix, plus a system map: who writes data and who listens.",
        offer:
          "The price ladder, the plan and benefit matrix with conflicts, discounts and coupons, and checkout described in one sentence.",
        access:
          "The content access policy in one sentence, a reader simulator (five personas), the free article meter, the content inventory and paywall measurement.",
        metrics:
          "A metrics dictionary with definition, formula, data source and benchmark; from stage S7 also the current value with a rating and the reason when data is missing.",
        inputs:
          "A month × kind × segment sheet: MRR plan, new customer plan, sales and marketing cost, COGS, gross and EBITDA margin - the basis of unit economics metrics.",
      },
      link: {
        monetization: "Monetisation dashboard",
        ledger: "Monetisation ledger",
        subscriptions: "Subscriptions",
        crmFunnel: "CRM funnel",
        signupPopup: "Signup popup",
        retentionFlow: "Pricing - cancellations",
        events: "Events",
        clubs: "Clubs",
        clubApplications: "Club applications",
        plans: "Plans and prices",
        checkout: "Checkout settings",
        metering: "Article meter",
        overrides: "Content exceptions",
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
