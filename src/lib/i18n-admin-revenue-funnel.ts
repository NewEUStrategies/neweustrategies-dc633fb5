// i18n huba „Przychód i lejek" - nakładka LEJKA i DOSTĘPU (S3).
//
// Etykieta i krótka definicja KAŻDEGO pola `RevenueFunnelDto`
// (src/lib/revenue/funnel/dto.ts) i `AccessInventoryDto`
// (src/lib/revenue/access/dto.ts). Definicja jest tym, co karta pokazuje
// w podpowiedzi, więc mówi dokładnie to samo co agregat SQL
// (`_funnel_counts`, `admin_revenue_access_inventory`): kohorty z okna,
// „brak danych" zamiast zera, odwiedzający obok lejka, a nie w mianowniku.
//
// KODY UNII MAJĄ KLUCZE PL i EN: etapy lejka (`RevenueFunnelStage`), źródła
// rejestracji (`SignupSource`), powody uderzeń (`PaywallHitReason`), etapy
// toru sprzedaży, tryby i polityki dostępu - test w
// `src/lib/revenue/funnel/__tests__/i18nRevenueFunnel.test.ts`.
//
// Prefiks `adminRevenue` jest pod TWARDĄ bramką parytetu
// (`src/__tests__/i18nParity.gate.test.ts`): brak albo napis identyczny
// w PL i EN zapala CI. Gałęzie `adminRevenue.funnel` i `adminRevenue.access`
// scalają się głęboko z rdzeniem huba (`i18n-admin-revenue.ts`).
//
// UWAGA NA ARKUSZ CSS. Pliki `src/lib/i18n-*.ts` skanuje generator arkusza
// PUBLICZNEGO - słowo będące nazwą klasy narzędziowej w angielskim napisie
// dokłada regułę do CSS każdej strony czytelnika. Napisy niżej omijają takie
// słowa (stąd np. „concealed" zamiast potocznego angielskiego „ukryty").
//
// IMPORT WYŁĄCZNIE Z KOMPONENTÓW (karta huba woła `ensureI18n()`).
import i18n from "@/lib/i18n";

const pl = {
  adminRevenue: {
    funnel: {
      title: "Lejek czytelnika",
      subtitle:
        "Od konta przez paywall i kasę do płatności - jedno okno, ta sama populacja w każdym ilorazie.",
      noData: "Brak danych",
      noDataHint:
        "Tej liczby nie da się policzyć dla wybranego okresu - to nie jest zero (np. nikt nie trafił na paywall albo nikt nie zaczął płatności).",
      amountsHidden: "Kwoty widzą administratorzy.",
      paywallDataSince: "Pomiar paywalla od {{date}}",
      paywallDataEmpty:
        "Paywall nie ma jeszcze ani jednego pomiaru - uderzenia zaczną się liczyć po wdrożeniu.",
      separateStream:
        "Odwiedzający pochodzą z analityki ze zgodą - inna populacja niż konta, więc bez udziału procentowego.",
      state: {
        forbidden: "Lejek widzą administratorzy i redaktorzy.",
        unavailable: "Dane lejka pojawią się po zakończeniu wdrożenia.",
      },
      track: {
        self_serve: "Samoobsługa",
        sales: "Sprzedaż (CRM)",
        all: "Oba tory",
      },
      stage: {
        visitors: {
          label: "Odwiedzający",
          hint: "Unikalni odwiedzający z analityki pierwszej strony (tylko osoby ze zgodą analityczną).",
        },
        accounts: {
          label: "Nowe konta",
          hint: "Konta założone w wybranym okresie.",
        },
        paywall: {
          label: "Trafili na paywall",
          hint: "Konta, które w okresie co najmniej raz zatrzymały się na paywallu albo bramce klubu.",
        },
        checkout: {
          label: "Rozpoczęte płatności",
          hint: "Zamówienia założone w kasie w okresie (środowisko produkcyjne, bez biletów wydarzeń).",
        },
        paid: {
          label: "Opłacone",
          hint: "Zamówienia z okresu, które zakończyły się płatnością (także później zwrócone).",
        },
      },
      count: {
        activeAccounts: {
          label: "Aktywne konta",
          hint: "Konta założone, zalogowane, czytające albo kupujące w okresie - mianownik zasięgu paywalla.",
        },
        paywallHitVisitors: {
          label: "Goście na paywallu",
          hint: "Niezalogowani odwiedzający zatrzymani przez paywall (identyfikator z podpisanego ciasteczka, bez adresu).",
        },
        paywallHits: {
          label: "Wszystkie uderzenia",
          hint: "Suma wyświetleń paywalla - jedna osoba może trafić na ścianę wiele razy.",
        },
        paywallConvertedAccounts: {
          label: "Kupili po paywallu",
          hint: "Konta, które zapłaciły po pierwszym uderzeniu w paywall w tym okresie.",
        },
        checkoutAbandoned: {
          label: "Bez płatności",
          hint: "Zamówienia z okresu, które nie zakończyły się płatnością (nieudane, anulowane, wygasłe, w toku).",
        },
        checkoutExpired: {
          label: "Wygasłe sesje kasy",
          hint: "Z nich: kasa wygasła, zanim czytelnik zapłacił - porzucony koszyk.",
        },
        firstPayments: {
          label: "Pierwsze płatności",
          hint: "Konta, których pierwsza płatność w historii serwisu przypadła na ten okres.",
        },
        registeredPaid: {
          label: "Nowe konta, które zapłaciły",
          hint: "Konta założone w okresie, które zapłaciły przed jego końcem.",
        },
        signupFormViews: {
          label: "Wyświetlenia formularzy zapisu",
          hint: "Otwarcia okienek i formularzy zapisu na newsletter.",
        },
        signupFormSubmits: {
          label: "Zapisy z formularzy",
          hint: "Skuteczne zapisy z okienek i formularzy.",
        },
      },
      rate: {
        registeredToPaid: {
          label: "Konwersja rejestracji",
          short: "R2P",
          hint: "Nowe konta, które zapłaciły ÷ wszystkie nowe konta z okresu.",
        },
        paywallConversion: {
          label: "Konwersja paywalla",
          short: "PSCR",
          hint: "Konta, które zapłaciły po uderzeniu w paywall ÷ konta, które w niego uderzyły.",
        },
        paywallHit: {
          label: "Zasięg paywalla",
          short: "PHR",
          hint: "Konta z uderzeniem w paywall ÷ aktywne konta. Czytaj razem z konwersją paywalla: wysoki zasięg bez sprzedaży to ściana, nie oferta.",
        },
        checkoutConversion: {
          label: "Konwersja kasy",
          short: "CCR",
          hint: "Opłacone ÷ rozpoczęte płatności z okresu.",
        },
        checkoutAbandonment: {
          label: "Porzucenie kasy",
          short: "CAR",
          hint: "Rozpoczęte bez płatności ÷ rozpoczęte - dopełnienie konwersji kasy do 100%.",
        },
        couponRedemption: {
          label: "Wykorzystanie kuponów",
          short: "Kupony",
          hint: "Kody kampanii użyte w opłaconym zamówieniu ÷ kody wydane w kampaniach ważnych w okresie.",
        },
      },
      paidAmount: {
        label: "Wpływy z opłaconych zamówień",
        hint: "Kwoty zamówień z okresu, które zakończyły się płatnością - osobno dla każdej waluty, nigdy sumowane.",
      },
      signupSources: {
        title: "Skąd przychodzą konta",
        empty: "W tym okresie nie powstało żadne konto.",
      },
      signupSource: {
        auth_page: "Strona logowania",
        login_popup: "Okienko logowania",
        popup: "Okienko zapisu",
        club_gate: "Bramka klubu",
        register_widget: "Formularz w treści",
        paywall: "Paywall",
        pricing: "Cennik",
        checkout: "Kasa",
        club_apply: "Zgłoszenie do klubu",
        join_us_form: "Formularz „Dołącz”",
        unknown: "Nieznane źródło",
      },
      paywallReasons: {
        title: "Dlaczego czytelnicy trafiają na ścianę",
        empty: "W tym okresie nikt nie trafił na paywall.",
        accounts_one: "{{count}} konto",
        accounts_few: "{{count}} konta",
        accounts_many: "{{count}} kont",
        accounts_other: "{{count}} konta",
        visitors_one: "{{count}} gość",
        visitors_few: "{{count}} gości",
        visitors_many: "{{count}} gości",
        visitors_other: "{{count}} gościa",
      },
      paywallReason: {
        members: "Tylko dla zalogowanych",
        paid: "Treść płatna",
        tier_rank: "Wymaga wyższej warstwy",
        password: "Chronione hasłem",
        quota: "Wyczerpany limit darmowych artykułów",
        registration: "Ściana rejestracji",
      },
      sales: {
        title: "Tor sprzedaży",
        subtitle:
          "Leady, które w okresie weszły w kolejne etapy cyklu życia w CRM, i zadania zespołu (bez anulowanych).",
        openTasks: "Otwarte zadania",
        overdueTasks: "Zaległe zadania",
        doneTasks: "Zadania zamknięte w okresie",
        stage: {
          lead: "Lead",
          mql: "MQL - zakwalifikowany marketingowo",
          sql: "SQL - zakwalifikowany sprzedażowo",
          opportunity: "Szansa sprzedaży",
          customer: "Klient",
        },
      },
    },
    access: {
      title: "Inwentarz dostępu",
      subtitle: "Ile treści stoi za którą bramką - i gdzie czytelnik nie ma czego kupić.",
      total_one: "{{count}} reguła dostępu",
      total_few: "{{count}} reguły dostępu",
      total_many: "{{count}} reguł dostępu",
      total_other: "{{count}} reguły dostępu",
      computedAt: "Stan na {{time}}",
      state: {
        forbidden: "Inwentarz dostępu widzą administratorzy i redaktorzy.",
        unavailable: "Inwentarz pojawi się po zakończeniu wdrożenia.",
      },
      mode: {
        public: "Publiczne",
        members: "Dla zalogowanych",
        paid: "Płatne",
        password: "Na hasło",
      },
      policy: {
        inherit: "Licznik wg ustawień",
        metered: "Zawsze w liczniku",
        exempt: "Poza licznikiem",
      },
      entity: {
        post: "Wpisy",
        page: "Strony",
        media: "Media",
      },
      columns: {
        entity: "Rodzaj treści",
        mode: "Dostęp",
        minTierRank: "Próg warstwy",
        policy: "Licznik",
        count: "Liczba",
      },
      noThreshold: "Bez progu",
      rankThreshold: "Ranga od {{rank}}",
      tiers: {
        title: "Warstwy i oferta",
        offerable: "Do kupienia",
        notOfferable: "Nie do kupienia",
        notOfferableHint:
          "Brak aktywnego planu w sprzedaży, warstwa schowana w cenniku albo tylko na zapytanie - czytelnik z treścią tej warstwy nie ma przycisku zakupu.",
      },
      deadEnds: {
        title: "Ślepe zaułki i ryzyka",
        allClear: "Każda bramka prowadzi do oferty.",
        tierWithoutOffer: {
          label: "Próg bez oferty",
          hint: "Treści z progiem warstwy, której nie da się dziś kupić - zalogowany czytelnik z niższą warstwą nie dostaje żadnej ścieżki zakupu.",
        },
        paidWithoutOffer: {
          label: "Płatne bez oferty",
          hint: "Treści płatne bez ceny jednorazowej, bez planu w sprzedaży i bez warstwy z dostępem premium - nic nie da się kupić.",
        },
        danglingPlans: {
          label: "Plany spoza sprzedaży",
          hint: "Reguły wskazują plan nieaktywny, wycofany albo usunięty - paywall pomija go po cichu.",
        },
        meteredTierGated: {
          label: "Próg ponad licznikiem",
          hint: "Treści z progiem warstwy objęte licznikiem darmowych artykułów. Licznik ich nie otwiera - czytelnik z niższą warstwą zobaczy ścieżkę do warstwy.",
        },
      },
      hits30d: {
        title: "Uderzenia w paywall - ostatnie 30 dni",
        empty: "Przez ostatnie 30 dni nikt nie trafił na paywall.",
      },
    },
  },
};

const en: typeof pl = {
  adminRevenue: {
    funnel: {
      title: "Reader funnel",
      subtitle:
        "From account through the paywall and checkout to payment - one window, the same population in every ratio.",
      noData: "No data",
      noDataHint:
        "This number cannot be computed for the selected period - it is not zero (for example nobody reached the paywall or nobody started a payment).",
      amountsHidden: "Amounts are available to administrators.",
      paywallDataSince: "Paywall measured since {{date}}",
      paywallDataEmpty:
        "The paywall has no measurement yet - hits start counting after the release.",
      separateStream:
        "Visitors come from consented analytics - a different population than accounts, so no percentage share.",
      state: {
        forbidden: "The funnel is available to administrators and editors.",
        unavailable: "Funnel data will appear once the release is complete.",
      },
      track: {
        self_serve: "Self-serve",
        sales: "Sales (CRM)",
        all: "Both tracks",
      },
      stage: {
        visitors: {
          label: "Visitors",
          hint: "Unique visitors from first-party analytics (people with analytics consent only).",
        },
        accounts: {
          label: "New accounts",
          hint: "Accounts created in the selected period.",
        },
        paywall: {
          label: "Reached the paywall",
          hint: "Accounts that stopped at the paywall or a club gate at least once in the period.",
        },
        checkout: {
          label: "Payments started",
          hint: "Orders created at checkout in the period (production environment, event tickets excluded).",
        },
        paid: {
          label: "Paid",
          hint: "Orders from the period that ended in a payment (including ones refunded later).",
        },
      },
      count: {
        activeAccounts: {
          label: "Active accounts",
          hint: "Accounts created, signed in, reading or buying in the period - the denominator of paywall reach.",
        },
        paywallHitVisitors: {
          label: "Guests at the paywall",
          hint: "Signed-out visitors stopped by the paywall (identifier from a signed cookie, no address).",
        },
        paywallHits: {
          label: "All hits",
          hint: "Total paywall views - one person can reach the wall many times.",
        },
        paywallConvertedAccounts: {
          label: "Bought after the paywall",
          hint: "Accounts that paid after their first paywall hit in this period.",
        },
        checkoutAbandoned: {
          label: "Without payment",
          hint: "Orders from the period that did not end in a payment (failed, cancelled, expired, in progress).",
        },
        checkoutExpired: {
          label: "Expired checkout sessions",
          hint: "Of these: checkout expired before the reader paid - an abandoned cart.",
        },
        firstPayments: {
          label: "First payments",
          hint: "Accounts whose first ever payment on the site fell in this period.",
        },
        registeredPaid: {
          label: "New accounts that paid",
          hint: "Accounts created in the period that paid before it ended.",
        },
        signupFormViews: {
          label: "Signup form views",
          hint: "Openings of newsletter signup popups and forms.",
        },
        signupFormSubmits: {
          label: "Signups from forms",
          hint: "Successful signups from popups and forms.",
        },
      },
      rate: {
        registeredToPaid: {
          label: "Registered-to-paid rate",
          short: "R2P rate",
          hint: "New accounts that paid ÷ all new accounts from the period.",
        },
        paywallConversion: {
          label: "Paywall conversion",
          short: "PSCR rate",
          hint: "Accounts that paid after a paywall hit ÷ accounts that hit it.",
        },
        paywallHit: {
          label: "Paywall reach",
          short: "PHR rate",
          hint: "Accounts with a paywall hit ÷ active accounts. Read it together with paywall conversion: high reach without sales is a wall, not an offer.",
        },
        checkoutConversion: {
          label: "Checkout conversion",
          short: "CCR rate",
          hint: "Paid ÷ payments started in the period.",
        },
        checkoutAbandonment: {
          label: "Checkout abandonment",
          short: "CAR rate",
          hint: "Started without payment ÷ started - the complement of checkout conversion to 100%.",
        },
        couponRedemption: {
          label: "Coupon redemption",
          short: "Coupons",
          hint: "Campaign codes used on a paid order ÷ codes issued in campaigns valid in the period.",
        },
      },
      paidAmount: {
        label: "Revenue from paid orders",
        hint: "Amounts of orders from the period that ended in a payment - per currency, never added up.",
      },
      signupSources: {
        title: "Where accounts come from",
        empty: "No account was created in this period.",
      },
      signupSource: {
        auth_page: "Sign-in page",
        login_popup: "Sign-in popup",
        popup: "Signup popup",
        club_gate: "Club gate",
        register_widget: "In-content form",
        paywall: "Paywall page",
        pricing: "Pricing page",
        checkout: "Checkout page",
        club_apply: "Club application",
        join_us_form: "“Join us” form",
        unknown: "Unknown source",
      },
      paywallReasons: {
        title: "Why readers hit the wall",
        empty: "Nobody reached the paywall in this period.",
        accounts_one: "{{count}} account",
        accounts_few: "{{count}} accounts",
        accounts_many: "{{count}} accounts",
        accounts_other: "{{count}} accounts",
        visitors_one: "{{count}} guest",
        visitors_few: "{{count}} guests",
        visitors_many: "{{count}} guests",
        visitors_other: "{{count}} guests",
      },
      paywallReason: {
        members: "Members only",
        paid: "Paid content",
        tier_rank: "Requires a higher tier",
        password: "Password protected",
        quota: "Free article limit used up",
        registration: "Registration wall",
      },
      sales: {
        title: "Sales track",
        subtitle:
          "Leads that entered the next lifecycle stages in the CRM during the period, and team tasks (cancelled ones excluded).",
        openTasks: "Open tasks",
        overdueTasks: "Overdue tasks",
        doneTasks: "Tasks closed in the period",
        stage: {
          lead: "Lead stage",
          mql: "MQL - marketing qualified",
          sql: "SQL - sales qualified",
          opportunity: "Opportunity",
          customer: "Customer",
        },
      },
    },
    access: {
      title: "Access inventory",
      subtitle: "How much content sits behind which gate - and where a reader has nothing to buy.",
      total_one: "{{count}} access rule",
      total_few: "{{count}} access rules",
      total_many: "{{count}} access rules",
      total_other: "{{count}} access rules",
      computedAt: "As of {{time}}",
      state: {
        forbidden: "The access inventory is available to administrators and editors.",
        unavailable: "The inventory will appear once the release is complete.",
      },
      mode: {
        public: "Public",
        members: "Signed-in readers",
        paid: "Paid",
        password: "Password",
      },
      policy: {
        inherit: "Meter per settings",
        metered: "Always metered",
        exempt: "Not metered",
      },
      entity: {
        post: "Posts",
        page: "Pages",
        media: "Media files",
      },
      columns: {
        entity: "Content type",
        mode: "Access",
        minTierRank: "Tier threshold",
        policy: "Meter",
        count: "Count",
      },
      noThreshold: "No threshold",
      rankThreshold: "Rank {{rank}} and up",
      tiers: {
        title: "Tiers and offer",
        offerable: "Purchasable",
        notOfferable: "Not purchasable",
        notOfferableHint:
          "No active plan on sale, the tier is concealed on the pricing page or available on request only - a reader of content at this tier has no purchase button.",
      },
      deadEnds: {
        title: "Dead ends and risks",
        allClear: "Every gate leads to an offer.",
        tierWithoutOffer: {
          label: "Threshold without offer",
          hint: "Content gated at a tier that cannot be bought today - a signed-in reader on a lower tier gets no purchase path.",
        },
        paidWithoutOffer: {
          label: "Paid without offer",
          hint: "Paid content with no one-time price, no plan on sale and no tier with premium access - nothing can be bought.",
        },
        danglingPlans: {
          label: "Plans off sale",
          hint: "Rules point at an inactive, withdrawn or deleted plan - the paywall silently skips it.",
        },
        meteredTierGated: {
          label: "Threshold above the meter",
          hint: "Tier-gated content included in the free article meter. The meter does not unlock it - a reader on a lower tier sees a path to the tier.",
        },
      },
      hits30d: {
        title: "Paywall hits - last 30 days",
        empty: "Nobody reached the paywall in the last 30 days.",
      },
    },
  },
};

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

/** Słowniki wprost - test kodów unii czyta je bez instancji i18next. */
export const revenueFunnelDictionaries = { pl, en } as const;
