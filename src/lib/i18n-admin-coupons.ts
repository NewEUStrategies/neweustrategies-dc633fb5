// Słownik modułu kuponów w administracji (PL/EN) - lista kuponów B2B,
// kampanie rabatowe, walidacja i komunikaty operacyjne.
//
// PO CO POWSTAŁ. Dwa ekrany kuponów niosły cztery kopie tego samego bliźniaka
// językowego `const L = (pl, en) => (lang === "pl" ? pl : en)` - po dwie na
// plik, bo każdy komponent deklarował własną. 84 napisy istniały wyłącznie
// w kodzie: warunki kampanii, powody odrzucenia kuponu i komunikaty o kolizji
// kodu. To treść, którą operator czyta w momencie, gdy klient stoi przy
// płatności - a nie dało się jej ani przetłumaczyć, ani sprawdzić bramką
// parytetu.
//
// S1 (P04, P10, def. 10). Słownik niesie też panel kampanii kuponowej
// w edytorze kampanii newslettera (`newsletterCampaign.*`) - razem z powodem
// wyłączenia wysyłki dla autora, bo słownik newslettera leży poza wycinkiem S1
// (przeniesienie `newsletterCampaign.roleRequired` do `adminNewsletter.*` -
// zgłoszenie „Do integracji"). Analityka (`analytics.*`) definiuje konwersję
// OPŁACONĄ i kwoty per waluta.
//
// UWAGA NA ARKUSZ CSS. Pliki `src/lib/i18n-*.ts` skanuje generator arkusza
// PUBLICZNEGO - słowo równe nazwie klasy narzędziowej Tailwinda (angielskie
// odpowiedniki słów „ukryty", „widoczny", „ramka", „tabela") dokłada regułę
// do CSS każdej strony czytelnika. Nowe napisy niżej są dobrane tak, żeby
// takich słów nie zawierały - także w tym komentarzu.
// Znaczniki szablonu e-maila (`{{coupon_code}}`) NIE trafiają do napisów -
// i18next podstawiłby je jak zmienną.
import i18n from "./i18n";

const pl = {
  adminCoupons: {
    // Wspólny komunikat awarii odczytu dla zakładek Realizacje i Analityka.
    // Oba panele liczą pieniądze, więc pusty wynik i BŁĄD muszą wyglądać
    // inaczej - inaczej odmowa RLS czyta się jak "w tym okresie nic nie było".
    loadError: {
      title: "Nie udało się wczytać danych.",
      hint: "To NIE jest pusty zakres - odczyt się nie powiódł (uprawnienia, baza albo sieć). Liczby i eksport pozostają niedostępne, dopóki odczyt się nie uda.",
      placeholder: "Dane niedostępne - odczyt się nie powiódł.",
    },
    codesGenerated_one: "Wygenerowano {{count}} kod",
    codesGenerated_few: "Wygenerowano {{count}} kody",
    codesGenerated_many: "Wygenerowano {{count}} kodów",
    codesGenerated_other: "Wygenerowano {{count}} kodów",
    searchCodeName: "Szukaj po kodzie/nazwie",
    all: "Wszystkie",
    active: "Aktywne",
    inactive: "Nieaktywne",
    expired: "Wygasłe",
    newCoupon: "Nowy kupon",
    total: "Wszystkie",
    totalRedemptions: "Użycia łącznie",
    couponList: "Lista kuponów",
    loading: "Wczytywanie…",
    results: "Brak wyników.",
    code: "Kod",
    discount: "Rabat",
    uses: "Użycia",
    validity: "Ważność",
    planSubscription: "Plan / Subskrypcja",
    status: "Status",
    actions: "Akcje",
    copied: "Skopiowano",
    copyCode: "Kopiuj kod",
    toggleActive: "Przełącz aktywność kuponu",
    deleteAction: "Usuń kupon",
    active2: "Aktywny",
    inactive2: "Nieaktywny",
    deleteCoupon: "Usunąć kupon?",
    deleteCouponBody: "Kod {{code}} zniknie razem z historią użyć. Tej operacji nie można cofnąć.",
    deleteConfirm: "Usuń",
    enterCode: "Podaj kod",
    percent1100: "Procent 1–100",
    amount0: "Kwota > 0",
    couponCreated: "Kupon utworzony",
    newB2bCoupon: "Nowy kupon B2B",
    nameOptional: "Nazwa (opcjonalnie)",
    internalDescription: "Opis wewnętrzny",
    discountType: "Typ rabatu",
    fixed: "Kwotowy",
    percent: "Procent",
    amountCents: "Kwota (grosze)",
    currency: "Waluta",
    maxRedemptions: "Limit użyć",
    unlimited: "bez limitu",
    valid: "Ważny od",
    validUntil: "Ważny do",
    grantsSubscriptionOptional: "Nadaje subskrypcję (opcjonalnie)",
    none: "Brak",
    durationDays: "Czas trwania (dni)",
    unlimited2: "bezterminowo",
    restrictPlansOptional: "Ogranicz do planów (opcjonalnie)",
    plansAvailable: "Brak planów",
    createCoupon: "Utwórz kupon",
    csvExported: "Wyeksportowano CSV",
    createBulkCampaignsGenerateUnique:
      "Twórz kampanie masowo, generuj unikalne kody i rozsyłaj przez newsletter.",
    newCampaign: "Nowa kampania",
    campaigns: "Kampanie",
    campaignsYet: "Brak kampanii. Utwórz pierwszą.",
    name: "Nazwa",
    codes: "Kody",
    subscription: "Subskrypcja",
    segment: "Segment",
    generate: "Generuj",
    archiveAction: "Archiwizuj kampanię",
    // Stany kampanii z kolumny `b2b_coupon_campaigns.status`. Odznaka
    // renderowala surowa wartosc z bazy, wiec redakcja pracujaca po polsku
    // musiala zgadywac, czym rozni sie „generated" od „sent" - a od tej roznicy
    // zalezy, czy kody juz poszly do subskrybentow.
    campaignStatus: {
      draft: "Szkic",
      generated: "Wygenerowana",
      sent: "Wysłana",
      archived: "Zarchiwizowana",
    },
    enterName: "Podaj nazwę",
    campaignCreatedDraft: "Kampania utworzona (draft)",
    newCouponCampaign: "Nowa kampania kuponowa",
    descriptionOptional: "Opis (opcjonalnie)",
    prefix: "Prefix",
    codeLength: "Długość kodu",
    codeCount: "Ilość kodów",
    amountCents2: "Kwota (gr)",
    validUntil2: "Ważne do",
    grantsSubscription: "Nadaje subskrypcję",
    createCampaign: "Utwórz kampanię",
    layout: {
      title: "Kupony B2B",
      subtitle:
        "Zarządzaj kodami, kampaniami masowymi i analityką. Integracja z CRM, newsletterem i subskrypcjami platformy.",
      tabsLabel: "Zakładki kuponów",
      tabs: {
        list: "Kupony",
        campaigns: "Kampanie",
        redemptions: "Realizacje",
        analytics: "Analityka",
      },
    },
    campaignLink: "Kod z kampanii",
    redemptionsTruncated:
      "Pokazano pierwsze {{limit}} realizacji okresu - kafle i eksport liczą tylko tę część. Zawęź okres, żeby zobaczyć wszystkie.",
    // Kampanie kuponowe (P04): wysyłka idzie przez kampanię newslettera, którą
    // przygotowuje SERWER; status „Wysłana" ustawia dopiero zakończona wysyłka.
    campaignsFlow: {
      prepareSend: "Przygotuj wysyłkę",
      prepareSendHint:
        "Tworzy szkic kampanii newslettera z osobnym kodem dla każdego odbiorcy. Wysyłasz go dopiero po sprawdzeniu odbiorców.",
      prepared: "Szkic kampanii newslettera gotowy - sprawdź odbiorców i wyślij.",
      linked: "Podpięta kampania newslettera",
      openNewsletter: "Otwórz kampanię newslettera",
      restoreAction: "Przywróć kampanię",
      archived: "Kampania zarchiwizowana.",
      restored: "Kampania przywrócona.",
      notGenerated: "Kampanię newslettera można przygotować dopiero po wygenerowaniu kodów.",
      notFound: "Kampania kuponowa nie istnieje albo należy do innej organizacji.",
      segmentInvalid:
        "Lista mailingowa kampanii nie istnieje już w ustawieniach newslettera. Utwórz kampanię z istniejącą listą, zanim wyślesz kody.",
      highlighted: "Kampania wskazana w adresie",
    },
    segmentField: {
      label: "Lista mailingowa (odbiorcy kodów)",
      placeholder: "Wybierz listę",
      wholeList: "Cała lista subskrybentów",
      wholeListWarning:
        "Kody trafią do WSZYSTKICH potwierdzonych subskrybentów, nie do jednej listy. Wybierz tę opcję tylko świadomie.",
      noLists:
        "W ustawieniach popupu newslettera nie ma list mailingowych - dostępna jest wyłącznie cała lista.",
      required: "Wybierz listę mailingową albo świadomie całą listę subskrybentów.",
      unknown: "nieznana lista ({{id}})",
    },
    // Panel kampanii kuponowej w edytorze kampanii newslettera (R-25: liczba
    // odbiorców i wolnych kodów widoczna PRZED wysyłką).
    newsletterCampaign: {
      title: "Kampania kuponowa",
      intro: "Każdy odbiorca dostaje własny, jednorazowy kod rabatowy.",
      openCoupon: "Otwórz kampanię kuponową",
      segment: "Lista mailingowa",
      recipients: "Odbiorcy",
      codesFree: "Wolne kody",
      codesOf: "{{free}} z {{total}}",
      counting: "Liczę odbiorców - wysyłka ruszy, gdy liczba będzie znana.",
      codesShort:
        "Za mało kodów: {{available}} wolnych na {{recipients}} odbiorców. Wygeneruj kampanię z większą liczbą kodów albo zawęź odbiorców - wysyłka jest zablokowana.",
      confirmCodes: "Każdy odbiorca dostanie własny kod (wolnych kodów: {{available}}).",
      roleRequired: "Kampanie newslettera tworzy, zapisuje i wysyła administrator albo redaktor.",
      errors: {
        codesInsufficient:
          "Za mało wolnych kodów: potrzeba {{needed}}, dostępnych {{available}}. Wysyłka zatrzymana przed pierwszym mailem.",
        segmentInvalid:
          "Lista mailingowa kampanii kuponowej jest nieznana albo niezgodna z filtrem odbiorców. Wysyłka zatrzymana, żeby kody nie trafiły do całej listy.",
        notLinked:
          "Treść zawiera znacznik kodu kuponu, ale kampania nie jest podpięta pod kampanię kuponową.",
        ambiguous:
          "Pod tę kampanię newslettera podpięto kilka kampanii kuponowych. Wysyłka zatrzymana.",
      },
    },
    // Analityka (P10, D-S1-08): kwoty WYŁĄCZNIE per waluta i wyłącznie
    // z wykorzystań opłaconych; konwersja = kohorta wydanych.
    analytics: {
      from: "Od",
      to: "Do",
      issued: "Wydane kupony",
      conversion: "Konwersja opłacona",
      conversionHelp: "Co znaczy konwersja opłacona?",
      conversionDefinition:
        "Kohorta wydanych: odsetek kuponów utworzonych w wybranym okresie, które mają co najmniej jedno OPŁACONE wykorzystanie (do dziś). Rezerwacje bez płatności, płatności w piaskownicy i testowe się nie liczą.",
      paid: "Wykorzystania opłacone",
      reserved: "Rezerwacje bez płatności",
      revenueNet: "Przychód netto · {{currency}}",
      discount: "Rabat udzielony · {{currency}}",
      revenueNone: "Przychód netto",
      discountNone: "Rabat udzielony",
      truncated:
        "Kwoty policzone z pierwszych {{limit}} opłaconych wykorzystań okresu - zawęź okres, żeby zobaczyć pełne sumy.",
      adminOnly:
        "Przychód, rabat i konwersję opłaconą widzi administrator - dane płatności są dostępne tylko dla tej roli.",
      rankingTitle: "TOP 10 kuponów",
      redemptions: "Wykorzystania",
      detailTitle: "Szczegóły per kupon",
      code: "Kod",
      detailRedemptions: "Wykorzystania (z rezerwacjami)",
      detailNote:
        "Kwot per kupon tu nie ma: nie dzielą się na waluty i obejmują rezerwacje bez płatności. Przychód i rabat pokazują kafle powyżej, osobno dla każdej waluty.",
      noData: "Brak danych.",
    },
  },
};

const en: typeof pl = {
  adminCoupons: {
    loadError: {
      title: "Could not load the data.",
      hint: "This is NOT an empty range - the read failed (permissions, database or network). Figures and export stay unavailable until the read succeeds.",
      placeholder: "Data unavailable - the read failed.",
    },
    codesGenerated_one: "Generated {{count}} code",
    // `typeof pl` wymaga form polskich; angielski czyta tylko `_one`/`_other`.
    codesGenerated_few: "Generated {{count}} codes",
    codesGenerated_many: "Generated {{count}} codes",
    codesGenerated_other: "Generated {{count}} codes",
    searchCodeName: "Search by code/name",
    all: "All",
    active: "Active",
    inactive: "Inactive",
    expired: "Expired",
    newCoupon: "New coupon",
    total: "Total",
    totalRedemptions: "Total redemptions",
    couponList: "Coupon list",
    loading: "Loading…",
    results: "No results.",
    code: "Code",
    discount: "Discount",
    uses: "Uses",
    validity: "Validity",
    planSubscription: "Plan / Subscription",
    status: "Status",
    actions: "Actions",
    copied: "Copied",
    copyCode: "Copy code",
    toggleActive: "Toggle coupon active",
    deleteAction: "Delete coupon",
    active2: "Active",
    inactive2: "Inactive",
    deleteCoupon: "Delete coupon?",
    deleteCouponBody:
      "Code {{code}} disappears together with its redemption history. This cannot be undone.",
    deleteConfirm: "Delete",
    enterCode: "Enter a code",
    percent1100: "Percent 1–100",
    amount0: "Amount > 0",
    couponCreated: "Coupon created",
    newB2bCoupon: "New B2B coupon",
    nameOptional: "Name (optional)",
    internalDescription: "Internal description",
    discountType: "Discount type",
    fixed: "Fixed",
    percent: "Percent",
    amountCents: "Amount (cents)",
    currency: "Currency",
    maxRedemptions: "Max redemptions",
    unlimited: "unlimited",
    valid: "Valid from",
    validUntil: "Valid until",
    grantsSubscriptionOptional: "Grants subscription (optional)",
    none: "None",
    durationDays: "Duration (days)",
    unlimited2: "unlimited",
    restrictPlansOptional: "Restrict to plans (optional)",
    plansAvailable: "No plans available",
    createCoupon: "Create coupon",
    csvExported: "CSV exported",
    createBulkCampaignsGenerateUnique:
      "Create bulk campaigns, generate unique codes and send via newsletter.",
    newCampaign: "New campaign",
    campaigns: "Campaigns",
    campaignsYet: "No campaigns yet.",
    name: "Name",
    codes: "Codes",
    subscription: "Subscription",
    segment: "Segment",
    generate: "Generate",
    archiveAction: "Archive campaign",
    campaignStatus: {
      draft: "Draft",
      generated: "Generated",
      sent: "Sent",
      archived: "Archived",
    },
    enterName: "Enter a name",
    campaignCreatedDraft: "Campaign created (draft)",
    newCouponCampaign: "New coupon campaign",
    descriptionOptional: "Description (optional)",
    prefix: "Prefix",
    codeLength: "Code length",
    codeCount: "Code count",
    amountCents2: "Amount (cents)",
    validUntil2: "Valid until",
    grantsSubscription: "Grants subscription",
    createCampaign: "Create campaign",
    layout: {
      title: "B2B coupons",
      subtitle:
        "Manage codes, bulk campaigns and analytics. Integrated with CRM, newsletter and platform subscriptions.",
      tabsLabel: "Coupon tabs",
      tabs: {
        list: "Coupons",
        campaigns: "Campaigns",
        redemptions: "Redemptions",
        analytics: "Analytics",
      },
    },
    campaignLink: "Code from a campaign",
    redemptionsTruncated:
      "Showing the first {{limit}} redemptions of the period - tiles and export count only this part. Narrow the period to see them all.",
    campaignsFlow: {
      prepareSend: "Prepare sending",
      prepareSendHint:
        "Creates a draft newsletter campaign with a separate code for every recipient. You send it only after checking the recipients.",
      prepared: "Draft newsletter campaign ready - check the recipients and send it.",
      linked: "Linked newsletter campaign",
      openNewsletter: "Open the newsletter campaign",
      restoreAction: "Restore campaign",
      archived: "Campaign archived.",
      restored: "Campaign restored.",
      notGenerated: "A newsletter campaign can be prepared only after the codes are generated.",
      notFound: "The coupon campaign does not exist or belongs to another organisation.",
      segmentInvalid:
        "The campaign's mailing list no longer exists in the newsletter settings. Create the campaign with an existing list before sending codes.",
      highlighted: "Campaign selected in the address",
    },
    segmentField: {
      label: "Mailing list (code recipients)",
      placeholder: "Choose a list",
      wholeList: "Entire subscriber list",
      wholeListWarning:
        "Codes will go to ALL confirmed subscribers, not to a single list. Choose this option only deliberately.",
      noLists:
        "The newsletter popup settings define no mailing lists - only the entire list is available.",
      required: "Choose a mailing list or, deliberately, the entire subscriber list.",
      unknown: "unknown list ({{id}})",
    },
    newsletterCampaign: {
      title: "Coupon campaign",
      intro: "Every recipient gets their own single-use discount code.",
      openCoupon: "Open the coupon campaign",
      segment: "Mailing list",
      recipients: "Recipients",
      codesFree: "Free codes",
      codesOf: "{{free}} of {{total}}",
      counting: "Counting recipients - sending starts once the number is known.",
      codesShort:
        "Not enough codes: {{available}} free for {{recipients}} recipients. Create a campaign with more codes or narrow the recipients - sending is blocked.",
      confirmCodes: "Every recipient gets their own code (free codes: {{available}}).",
      roleRequired:
        "Newsletter campaigns are created, saved and sent by an administrator or editor.",
      errors: {
        codesInsufficient:
          "Not enough free codes: {{needed}} needed, {{available}} available. Sending stopped before the first email.",
        segmentInvalid:
          "The coupon campaign's mailing list is unknown or does not match the chosen recipients. Sending stopped so the codes do not reach the entire list.",
        notLinked:
          "The content contains the coupon code marker, but the campaign is not linked to a coupon campaign.",
        ambiguous:
          "Several coupon campaigns are linked to this newsletter campaign. Sending stopped.",
      },
    },
    analytics: {
      from: "From",
      to: "To",
      issued: "Coupons issued",
      conversion: "Paid conversion",
      conversionHelp: "What does paid conversion mean?",
      conversionDefinition:
        "Issued cohort: the share of coupons created in the selected period that have at least one PAID redemption (to date). Reservations without payment, sandbox and test payments do not count.",
      paid: "Paid redemptions",
      reserved: "Reservations without payment",
      revenueNet: "Net revenue · {{currency}}",
      discount: "Discount granted · {{currency}}",
      revenueNone: "Net revenue",
      discountNone: "Discount granted",
      truncated:
        "Amounts computed from the first {{limit}} paid redemptions of the period - narrow the period to see full totals.",
      adminOnly:
        "Revenue, discount and paid conversion are shown to an administrator only - payment data is available just to that role.",
      rankingTitle: "TOP 10 coupons",
      redemptions: "Redemptions",
      detailTitle: "Per-coupon detail",
      code: "Code",
      detailRedemptions: "Redemptions (including reservations)",
      detailNote:
        "Per-coupon amounts are not shown here: they are not split by currency and include reservations without payment. Revenue and discount are in the tiles above, separately for each currency.",
      noData: "No data.",
    },
  },
};

// Explicit registration must survive both Vite and Nitro tree shaking.
// Keep the legacy side-effect import contract, and avoid repeated deep merges.
let registered = false;
export function ensureI18n(): void {
  if (registered) return;
  registered = true;
  i18n.addResourceBundle("pl", "translation", pl, true, true);
  i18n.addResourceBundle("en", "translation", en, true, true);
}
ensureI18n();
