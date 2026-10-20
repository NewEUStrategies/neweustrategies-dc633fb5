// i18n huba „Przychód i lejek" - nakładka FINANSÓW (S2): księga MRR, churn,
// kohorty, windykacja, przychód zrealizowany, przepływ anulowania, macierz
// oferty, dane wejściowe planu i kosztów oraz ekonomika jednostkowa.
//
// Etykieta każdej wartości słownikowej z `src/lib/revenue/finance/dto.ts`
// i `src/lib/revenue/limits.ts` (rodzaj i powód ruchu MRR, kategoria
// przychodu, problem oferty, rodzaj danej wejściowej, kod walidacji) - test
// `finance/__tests__/i18n.test.ts` pilnuje, że żadna nie zostaje surowym
// kluczem. Gałąź `adminRevenue.finance` scala się głęboko z rdzeniem huba.
//
// D-05 W SŁOWACH. „Podstawa kwoty" mówi, skąd jest MRR: z migawki operatora
// płatności (cena, ilość i rabat z subskrypcji) albo z katalogu najemcy
// (cennik planu, gdy operator nie podał kwoty). Panel podpisuje udział obu,
// więc zdania niżej muszą to mówić tak samo jak SQL (`basis_mix`).
//
// Prefiks `adminRevenue` jest pod TWARDĄ bramką parytetu
// (`src/__tests__/i18nParity.gate.test.ts`).
//
// UWAGA NA ARKUSZ CSS. Pliki `src/lib/i18n-*.ts` skanuje generator arkusza
// PUBLICZNEGO - słowo będące klasą narzędziową dokłada regułę do CSS każdej
// strony czytelnika. Napisy niżej są dobrane tak, żeby żadne nią nie było.
//
// IMPORT WYŁĄCZNIE Z KOMPONENTÓW (karta woła `ensureI18n()`).
import i18n from "@/lib/i18n";

const pl = {
  adminRevenue: {
    finance: {
      noData: "Brak danych",
      noDataHint:
        "Tej liczby nie da się policzyć dla wybranego okresu - to nie jest zero (np. brak mianownika albo okres sprzed początku księgi).",
      state: {
        forbidden: "Kwoty przychodu widzą wyłącznie administratorzy.",
        unavailable: "Dane finansowe pojawią się po zakończeniu wdrożenia.",
        error: "Nie udało się wczytać danych finansowych. Spróbuj ponownie za chwilę.",
      },
      basis: {
        label: "Podstawa kwot",
        provider: "Migawka operatora płatności",
        catalog: "Katalog najemcy",
        mix: "{{provider}} kwot z migawki operatora, {{catalog}} z katalogu",
        hint: "Migawka operatora to cena, ilość i rabat zapisane z subskrypcji. Katalog to cena planu z cennika, gdy operator nie podał kwoty - wtedy MRR jest szacunkiem.",
        none: "Brak aktywnych subskrypcji - nie ma czego podpisać.",
      },
      bridge: {
        title: "Most MRR",
        subtitle: "MRR na początku okresu, ruchy w okresie i MRR na końcu - per waluta.",
        start: "MRR na początku",
        opening: "Saldo otwarcia księgi",
        openingHint:
          "Subskrypcje sprzed uruchomienia księgi wpisane jednorazowo przy wdrożeniu. To nie jest sprzedaż z tego okresu.",
        netNew: "Nowe MRR netto",
        end: "MRR na końcu",
        activeSubscriptions: "Aktywne subskrypcje",
        activeCustomers: "Aktywni klienci",
        reconciled: "Most się domyka (początek + ruchy = koniec).",
        notReconciled:
          "Most się nie domyka: różnica {{amount}} przekracza 0,5 %. Sprawdź diagnostykę księgi.",
        unknownWindow:
          "Księga nie obejmuje tego okresu - pierwsze ruchy zapisano {{date}}. Wybierz późniejszy okres.",
        emptyLedger:
          "Księga MRR jest pusta - pierwsze ruchy pojawią się z najbliższym zdarzeniem subskrypcji.",
        dataSince: "Księga od {{date}}",
      },
      movementKind: {
        new: "Nowe",
        expansion: "Rozszerzenia",
        reactivation: "Reaktywacje",
        contraction: "Zmniejszenia",
        churn: "Odejścia",
        opening: "Saldo otwarcia",
      },
      movementReason: {
        signup: "Nowy zakup",
        trial_converted: "Koniec okresu próbnego",
        plan_change: "Zmiana planu",
        quantity: "Zmiana liczby miejsc",
        price: "Zmiana ceny",
        discount: "Rabat",
        canceled: "Rezygnacja",
        unpaid: "Nieopłacona",
        paused: "Wstrzymana",
        resumed: "Wznowiona",
        currency_switch: "Zmiana waluty",
        backfill: "Saldo otwarcia",
      },
      series: {
        title: "MRR w czasie",
        ledger: "Księga",
        snapshot: "Migawka dzienna",
        drift: "Różnica migawki i księgi",
        driftHint:
          "Drugi, niezależny pomiar: migawka liczy MRR ze stanu subskrypcji raz dziennie. Różnica oznacza zdarzenie, którego księga nie zapisała.",
      },
      churn: {
        title: "Odejścia i retencja przychodu",
        customersStart: "Klienci na początku",
        customersChurned: "Klienci utraceni",
        logoChurnRate: "Odpływ klientów",
        involuntaryShare: "Odejścia przez nieopłacenie",
        grossRevenueChurn: "Utrata przychodu brutto",
        grossRevenueRetention: "Retencja przychodu brutto (GRR)",
        netRevenueRetention: "Retencja przychodu netto (NRR)",
        reason: {
          canceled: "Rezygnacja",
          unpaid: "Nieopłacona",
          paused: "Wstrzymana",
          currency_switch: "Zmiana waluty",
        },
        currencySwitchHint:
          "Zmiana waluty to para ruchów: odejście w starej walucie i nowy przychód w nowej. Nie liczy się jako utrata klienta.",
      },
      cohorts: {
        title: "Kohorty miesięczne",
        cohortMonth: "Miesiąc startu",
        size: "Liczba subskrypcji",
        offset: "Miesiąc {{n}}",
        hint: "Udział subskrypcji z miesiąca startu, które w kolejnych miesiącach wciąż płacą. Saldo otwarcia nie tworzy kohorty.",
      },
      dunning: {
        title: "Windykacja",
        started: "Nowe zaległości",
        recovered: "Odzyskane",
        lost: "Utracone",
        open: "W toku",
        recoveryRate: "Skuteczność odzyskania",
        medianDaysToRecover: "Mediana dni do odzyskania",
        atRisk: "MRR zagrożone",
        recoveredMrr: "MRR odzyskane",
        lostMrr: "MRR utracone",
        lostHint: "Zaległość bez płatności przez 30 dni przechodzi do utraconych.",
      },
      realized: {
        title: "Przychód zrealizowany",
        subtitle: "Opłacone dokumenty sprzedaży z okresu minus zwroty - per waluta.",
        gross: "Brutto",
        refunds: "Zwroty",
        net: "Netto",
        documents: "Dokumenty",
        category: {
          subscription: "Subskrypcje",
          event: "Wydarzenia",
          content: "Treści",
          plan_one_time: "Plany jednorazowe",
          other: "Pozostałe",
        },
        ordersSource: "Zamówienia opłacone (drugie źródło)",
        ordersHint:
          "Ta sama sprzedaż policzona z zamówień. Różnica wobec dokumentów oznacza zamówienie bez dokumentu albo dokument bez zamówienia.",
        unknownEnvironment: "Dokumenty bez rozpoznanego środowiska (poza przychodem): {{count}}",
      },
      retention: {
        title: "Przepływ anulowania",
        flowsStarted: "Rozpoczęte anulowania",
        saved: "Zatrzymane",
        canceled: "Anulowane",
        abandoned: "Porzucone",
        open: "W toku",
        offersShown: "Pokazane oferty",
        offersAccepted: "Przyjęte oferty",
        saveRateGross: "Skuteczność zatrzymania",
        saveRateNet: "Skuteczność zatrzymania (z porzuconymi)",
        reasonNotGiven: "Bez podanego powodu",
        reasonNotGivenHint:
          "Osoba wybrała „Anuluj mimo to” przed wskazaniem powodu. Nie jest to osobny powód rezygnacji.",
        legacyResponses: "Ankiety sprzed przepływu",
        abandonedHint: "Przepływ bez decyzji przez 24 godziny liczy się jako porzucony.",
      },
      offer: {
        title: "Macierz oferty",
        activeSubscriptionsAdminOnly: "Liczbę płacących widzą administratorzy.",
        planIssue: {
          no_catalog_pair: "Plan nie ma pary w katalogu cen",
          tier_missing: "Plan wskazuje nieistniejący poziom",
          tier_inactive: "Poziom planu jest wyłączony",
          tier_hidden: "Poziomu nie widać w cenniku",
          inactive_for_sale: "Plan w sprzedaży, ale wyłączony",
        },
        tierIssue: {
          visible_without_plan: "Poziom w cenniku bez planu w sprzedaży",
        },
      },
      inputs: {
        title: "Plan i koszty",
        subtitle:
          "Dane, których system nie zna sam: plan MRR, plan nowych klientów, koszty i marże.",
        kind: {
          mrr_plan: "Plan MRR",
          new_customers_plan: "Plan nowych klientów",
          sales_marketing_cost: "Koszt sprzedaży i marketingu",
          cogs: "Koszt własny sprzedaży",
          gross_margin_pct: "Marża brutto",
          ebitda_margin_pct: "Marża EBITDA",
        },
        newCustomersHint: "Liczba klientów, nie kwota.",
        ratioHint: "Udział od -100 % do 100 %.",
        note: "Notatka",
        noteLimit: "Notatka może mieć najwyżej {{max}} znaków.",
        saved: "Zapisano.",
        deleted: "Usunięto wartość.",
        conflict:
          "Ktoś zmienił tę wartość w międzyczasie. Wczytaliśmy aktualną - sprawdź ją i zapisz ponownie.",
        invalid: {
          period_invalid: "Wybierz pierwszy dzień miesiąca.",
          kind_invalid: "Nieznany rodzaj danej.",
          segment_invalid: "Nieznany segment.",
          note_too_long: "Notatka jest za długa.",
          value_invalid:
            "Wartość nie pasuje do rodzaju danej (kwota z walutą albo udział bez waluty).",
        },
      },
      economics: {
        title: "Ekonomika jednostkowa",
        arpa: "Średni przychód na klienta (ARPA)",
        cac: "Koszt pozyskania klienta (CAC)",
        ltv: "Wartość klienta (LTV)",
        ltvCacRatio: "LTV do CAC",
        cacPaybackMonths: "Zwrot CAC (miesiące)",
        planAttainment: "Realizacja planu MRR",
        ruleOf40: "Reguła 40",
        ruleOf40Hint: "Wzrost MRR rok do roku plus marża EBITDA, w walucie z największym MRR.",
        missing: "Uzupełnij dane: {{kinds}}",
        missingHint: "Bez tych danych wskaźnik nie jest liczony - pokazujemy brak, a nie zero.",
      },
      billingPanel: {
        ledgerTitle: "Księga MRR (ten sam pomiar co hub)",
        mrr: "MRR",
        activeSubscriptions: "Aktywne subskrypcje",
        sameAsHub: "Liczby z tej samej funkcji i tego samego okresu co hub „Przychód i lejek”.",
        openHub: "Otwórz hub przychodu",
        window: "Bieżący miesiąc",
      },
    },
  },
};

const en: typeof pl = {
  adminRevenue: {
    finance: {
      noData: "No data",
      noDataHint:
        "This number cannot be computed for the selected period - it is not zero (e.g. no denominator or a period before the ledger began).",
      state: {
        forbidden: "Revenue amounts are available to administrators only.",
        unavailable: "Financial data will appear once the deployment completes.",
        error: "Financial data could not be loaded. Try again in a moment.",
      },
      basis: {
        label: "Amount basis",
        provider: "Payment provider snapshot",
        catalog: "Tenant catalog",
        mix: "{{provider}} of amounts from the provider snapshot, {{catalog}} from the catalog",
        hint: "The provider snapshot is the price, quantity and discount stored from the subscription. The catalog is the plan price from the price list, used when the provider sent no amount - MRR is then an estimate.",
        none: "No active subscriptions - nothing to annotate.",
      },
      bridge: {
        title: "MRR bridge",
        subtitle:
          "MRR at the beginning of the period, movements in the period and MRR at the close - per currency.",
        start: "MRR at the beginning",
        opening: "Ledger opening balance",
        openingHint:
          "Subscriptions from before the ledger launch, recorded once at deployment. This is not revenue sold in this period.",
        netNew: "Net new MRR",
        end: "MRR at the close",
        activeSubscriptions: "Active subscriptions",
        activeCustomers: "Active customers",
        reconciled: "The bridge reconciles (beginning + movements = close).",
        notReconciled:
          "The bridge does not reconcile: a difference of {{amount}} exceeds 0.5%. Check the ledger diagnostics.",
        unknownWindow:
          "The ledger does not cover this period - the first movements were recorded on {{date}}. Choose a later period.",
        emptyLedger:
          "The MRR ledger is empty - the first movements arrive with the next subscription event.",
        dataSince: "Ledger since {{date}}",
      },
      movementKind: {
        new: "New",
        expansion: "Expansion",
        reactivation: "Reactivation",
        contraction: "Contraction",
        churn: "Churn",
        opening: "Opening balance",
      },
      movementReason: {
        signup: "New purchase",
        trial_converted: "Trial converted",
        plan_change: "Plan change",
        quantity: "Seat count change",
        price: "Price change",
        discount: "Discount",
        canceled: "Cancellation",
        unpaid: "Unpaid",
        paused: "Paused",
        resumed: "Resumed",
        currency_switch: "Currency switch",
        backfill: "Opening balance",
      },
      series: {
        title: "MRR over time",
        ledger: "Ledger",
        snapshot: "Daily snapshot",
        drift: "Snapshot vs ledger difference",
        driftHint:
          "A second, independent measurement: the snapshot computes MRR from the subscription state once a day. A difference means an event the ledger did not record.",
      },
      churn: {
        title: "Churn and revenue retention",
        customersStart: "Customers at the beginning",
        customersChurned: "Customers lost",
        logoChurnRate: "Customer churn",
        involuntaryShare: "Churn from non-payment",
        grossRevenueChurn: "Gross revenue churn",
        grossRevenueRetention: "Gross revenue retention (GRR)",
        netRevenueRetention: "Net revenue retention (NRR)",
        reason: {
          canceled: "Cancellation",
          unpaid: "Unpaid",
          paused: "Paused",
          currency_switch: "Currency switch",
        },
        currencySwitchHint:
          "A currency switch is a pair of movements: churn in the old currency and new revenue in the new one. It does not count as a lost customer.",
      },
      cohorts: {
        title: "Monthly cohorts",
        cohortMonth: "Start month",
        size: "Subscriptions",
        offset: "Month {{n}}",
        hint: "The share of subscriptions from the start month that are still paying in the following months. The opening balance does not form a cohort.",
      },
      dunning: {
        title: "Dunning",
        started: "New past-due cycles",
        recovered: "Recovered",
        lost: "Lost",
        open: "In progress",
        recoveryRate: "Recovery rate",
        medianDaysToRecover: "Median days to recover",
        atRisk: "MRR at risk",
        recoveredMrr: "MRR recovered",
        lostMrr: "MRR lost",
        lostHint: "A past-due cycle without payment for 30 days moves to lost.",
      },
      realized: {
        title: "Realized revenue",
        subtitle: "Paid sales documents from the period minus refunds - per currency.",
        gross: "Gross",
        refunds: "Refunds",
        net: "Net",
        documents: "Documents",
        category: {
          subscription: "Subscriptions",
          event: "Events",
          content: "Content",
          plan_one_time: "One-off plans",
          other: "Other",
        },
        ordersSource: "Paid orders (second source)",
        ordersHint:
          "The same sales counted from orders. A difference against documents means an order without a document or a document without an order.",
        unknownEnvironment:
          "Documents without a recognized environment (excluded from revenue): {{count}}",
      },
      retention: {
        title: "Cancellation flow",
        flowsStarted: "Cancellations started",
        saved: "Saved",
        canceled: "Canceled",
        abandoned: "Abandoned",
        open: "In progress",
        offersShown: "Offers shown",
        offersAccepted: "Offers accepted",
        saveRateGross: "Save rate",
        saveRateNet: "Save rate (with abandoned)",
        reasonNotGiven: "No reason given",
        reasonNotGivenHint:
          "The person chose “Cancel anyway” before picking a reason. This is not a separate cancellation reason.",
        legacyResponses: "Surveys from before the flow",
        abandonedHint: "A flow without a decision for 24 hours counts as abandoned.",
      },
      offer: {
        title: "Offer matrix",
        activeSubscriptionsAdminOnly:
          "The number of paying customers is available to administrators.",
        planIssue: {
          no_catalog_pair: "The plan has no pair in the price catalog",
          tier_missing: "The plan points to a tier that does not exist",
          tier_inactive: "The plan tier is switched off",
          tier_hidden: "The tier is not shown on the pricing page",
          inactive_for_sale: "The plan is for sale but switched off",
        },
        tierIssue: {
          visible_without_plan: "The tier is on the pricing page without a plan for sale",
        },
      },
      inputs: {
        title: "Plan and costs",
        subtitle:
          "Data the system cannot know by itself: MRR plan, new customer plan, costs and margins.",
        kind: {
          mrr_plan: "MRR plan",
          new_customers_plan: "New customers plan",
          sales_marketing_cost: "Sales and marketing cost",
          cogs: "Cost of goods sold",
          gross_margin_pct: "Gross margin",
          ebitda_margin_pct: "EBITDA margin",
        },
        newCustomersHint: "A number of customers, not an amount.",
        ratioHint: "A share from -100% to 100%.",
        note: "Note",
        noteLimit: "The note can have at most {{max}} characters.",
        saved: "Saved.",
        deleted: "Value removed.",
        conflict:
          "Someone changed this value in the meantime. We loaded the current one - review it and save again.",
        invalid: {
          period_invalid: "Pick the first day of a month.",
          kind_invalid: "Unknown data kind.",
          segment_invalid: "Unknown segment.",
          note_too_long: "The note is too long.",
          value_invalid:
            "The value does not match the data kind (an amount with a currency or a share without one).",
        },
      },
      economics: {
        title: "Unit economics",
        arpa: "Average revenue per account (ARPA)",
        cac: "Customer acquisition cost (CAC)",
        ltv: "Customer lifetime value (LTV)",
        ltvCacRatio: "LTV to CAC",
        cacPaybackMonths: "CAC payback (months)",
        planAttainment: "MRR plan attainment",
        ruleOf40: "Rule of 40",
        ruleOf40Hint:
          "Year-over-year MRR growth plus EBITDA margin, in the currency with the largest MRR.",
        missing: "Fill in: {{kinds}}",
        missingHint: "Without this data the metric is not computed - we show a gap, not zero.",
      },
      billingPanel: {
        ledgerTitle: "MRR ledger (the same measurement as the hub)",
        mrr: "MRR",
        activeSubscriptions: "Active subscriptions",
        sameAsHub:
          "Numbers from the same function and the same period as the “Revenue and funnel” hub.",
        openHub: "Open the revenue hub",
        window: "Current month",
      },
    },
  },
};

/** Słowniki do testu pokrycia etykiet (`finance/__tests__/i18n.test.ts`). */
export const ADMIN_REVENUE_FINANCE_I18N = { pl, en } as const;

// Rejestracja jawna (komponent woła `ensureI18n()`) ORAZ przy imporcie:
// bramki parytetu i dryfu kluczy ładują nakładki globem i liczą na efekt
// importu, a flaga chroni przed powtórnym głębokim scalaniem przy renderze.
let registered = false;
export function ensureI18n(): void {
  if (registered) return;
  registered = true;
  i18n.addResourceBundle("pl", "translation", pl, true, true);
  i18n.addResourceBundle("en", "translation", en, true, true);
}
ensureI18n();
