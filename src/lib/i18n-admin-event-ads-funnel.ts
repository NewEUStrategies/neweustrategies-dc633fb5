// Słownik ekranu „Lejek Google Ads” studia wydarzenia (PL/EN).
//
// DLACZEGO OSOBNA NAKŁADKA. Nakładki są niepodzielne - analityka, zapisy i
// sponsorzy nie wciągają słownika kampanii, kosztów i eksportu konwersji.
// Etykieta pozycji w sidebarze mieszka w `adminEvents.studio.sections.adsFunnel`
// (fundament nawigacji), a tu jest wszystko, co widać NA ekranie, plus wiersz
// odsyłacza w „Analityce” (`analyticsLink.*`).
//
// KODY BŁĘDÓW = GŁOWY `RAISE EXCEPTION` migracji 20260927000300 w camelCase
// (`invalid_cost_row` -> `errors.invalidCostRow`); `{{count}}` to numer wiersza
// wsadu kosztów. Pilnuje tego `eventErrorMapsI18n.gate.test.ts`.
//
// Rodzaje dopasowania (`matchKinds.*`) i źródła kosztu (`costSources.*`) są 1:1
// z CHECK-ami bazy - klucze nie są składane szablonem, tylko mapą
// w komponencie.
import i18n from "@/lib/i18n";

export const adminEventAdsFunnelPl = {
  adminEventAdsFunnel: {
    description:
      "Skąd przychodzą uczestnicy i ile sprzedały kampanie: wizyty, zapisy, płatności, przychód i koszt kampanii Google Ads.",
    loading: "Wczytywanie lejka…",
    loadError: "Nie udało się wczytać lejka. Spróbuj ponownie.",
    window: {
      label: "Okres",
      presets: {
        "7d": "7 dni",
        "28d": "28 dni",
        "90d": "90 dni",
        all: "Całość",
      },
    },
    summary: {
      label: "Podsumowanie",
      description:
        "Wizyty i kroki lejka liczymy dla przeglądarek ze zgodą na pomiar; zgłoszenia (także zakupy pakietów grupowych) i przychód - dla wszystkich (także bez atrybucji).",
      visits: "Wizyty",
      registrations: "Zgłoszenia",
      paid: "Opłacone",
      revenue: "Przychód netto",
      cost: "Koszt kampanii",
      roas: "ROAS",
      roasHint: "Przychód z kampanii zmapowanych na koszt (ta sama waluta).",
      mixedCurrencies: "Kilka walut - bez przeliczania",
    },
    steps: {
      visit: "Wizyta",
      registrationStart: "Rozpoczęty zapis",
      registration: "Zgłoszenie",
      checkoutStart: "Rozpoczęta płatność",
      paid: "Opłacone",
    },
    funnel: {
      label: "Lejek",
      description:
        "Kroki przeglądarek ze zgodą na pomiar. Zgłoszenia bez atrybucji (brak zgody, import, zaproszenie) nie wchodzą do lejka - są osobnym wierszem tabeli.",
      ofPrevious: "{{percent}} poprzedniego kroku",
      empty: "Jeszcze nikt nie przeszedł przez lejek w tym okresie.",
      ariaLabel: "Lejek sprzedaży wydarzenia",
    },
    table: {
      label: "Kampanie",
      description:
        "Grupa to zmapowana kampania, a bez mapowania - wartość utm_campaign albo identyfikator kampanii Google Ads. W grupie rozbicie na źródło i medium.",
      campaign: "Kampania",
      channel: "Źródło / medium",
      source: "Źródło",
      medium: "Medium",
      visits: "Wizyty",
      registrationStarts: "Rozpoczęte zapisy",
      registrations: "Zgłoszenia",
      checkoutStarts: "Rozpoczęte płatności",
      paid: "Opłacone",
      revenue: "Przychód",
      cost: "Koszt",
      cpa: "Koszt na opłacone",
      roas: "ROAS",
      conversion: "Zgłoszenie z wizyty",
      noCampaign: "Bez kampanii",
      otherCampaigns: "Pozostałe kampanie",
      otherHint: "Kampanie spoza 50 najliczniejszych w tym okresie: {{folded}}.",
      unattributed: "Bez atrybucji",
      unattributedHint:
        "Zgłoszenia i zakupy pakietów, których przeglądarka nie dała zgody na pomiar, weszła bezpośrednio z innego urządzenia albo które dodano poza formularzem (import, zaproszenie, organizator).",
      total: "Razem",
      empty: "Brak danych o kampaniach w tym okresie.",
      kinds: {
        campaign: "zmapowana",
        utm_campaign: "utm_campaign",
        gad_campaign: "id kampanii Google Ads",
        other: "zwinięte",
        none: "bez kampanii",
      },
    },
    campaigns: {
      label: "Mapowanie kampanii",
      description:
        "Połącz kampanie z wydarzeniem po utm_campaign albo po identyfikatorze kampanii Google Ads (gad_campaignid). Etykieta zastępuje surową nazwę w raporcie, a koszt pozwala liczyć CPA i ROAS.",
      add: "Dodaj kampanię",
      edit: "Edytuj",
      delete: "Usuń",
      costs: "Koszty",
      empty: "Brak zmapowanych kampanii.",
      noCosts: "Bez kosztów",
      costsSummary_one: "{{amount}} · {{count}} dzień",
      costsSummary_few: "{{amount}} · {{count}} dni",
      costsSummary_many: "{{amount}} · {{count}} dni",
      costsSummary_other: "{{amount}} · {{count}} dnia",
      conversion: "Konwersja: {{name}}",
      noConversion: "Bez nazwy konwersji",
      deleteTitle: "Usunąć kampanię?",
      deleteBody:
        "Usuniemy mapowanie i wszystkie koszty tej kampanii. Wizyty i zgłoszenia zostają - przestaną tylko być grupowane pod tą etykietą.",
      deleteConfirm: "Usuń kampanię",
      cancel: "Anuluj",
    },
    matchKinds: {
      utm_campaign: "utm_campaign",
      google_ads_campaign_id: "Identyfikator kampanii Google Ads",
    },
    campaignDialog: {
      createTitle: "Nowa kampania",
      editTitle: "Edycja kampanii",
      section: "Dopasowanie",
      matchKind: "Dopasuj po",
      matchValue: "Wartość",
      matchValueHintUtm: "Dokładnie jak w adresie, np. wiosna-2026 (wielkość liter bez znaczenia).",
      matchValueHintGad:
        "Liczba z parametru gad_campaignid albo z kolumny „Identyfikator kampanii” w Google Ads.",
      label: "Etykieta w raporcie",
      conversionName: "Nazwa konwersji (import offline)",
      conversionNameHint:
        "Nazwa akcji konwersji w Google Ads, do której trafią opłacone bilety z tej kampanii. Bez przecinków i cudzysłowów.",
      save: "Zapisz",
      saving: "Zapisywanie…",
      cancel: "Anuluj",
    },
    validation: {
      matchValueRequired: "Podaj wartość do dopasowania.",
      matchValueDigits: "Identyfikator kampanii Google Ads składa się z samych cyfr.",
      matchValueInvalid: "Ta wartość nie może być nazwą kampanii (np. adres e-mail).",
      labelRequired: "Podaj etykietę.",
      labelTooLong: "Etykieta może mieć najwyżej 120 znaków.",
      conversionNameInvalid:
        "Nazwa konwersji nie może zawierać przecinka ani cudzysłowu i nie może zaczynać się od =, +, - ani @.",
    },
    costs: {
      title: "Koszty kampanii: {{name}}",
      description:
        "Koszt dzienny z raportu Google Ads. Ponowny zapis tego samego dnia nadpisuje koszt - import tego samego raportu dwa razy niczego nie dubluje.",
      manualSection: "Dodaj dzień",
      day: "Dzień (RRRR-MM-DD)",
      amount: "Koszt",
      currency: "Waluta",
      addDay: "Zapisz dzień",
      pasteSection: "Wklej raport",
      pasteLabel: "Wiersze: dzień, koszt, [waluta], [kliknięcia], [wyświetlenia]",
      pasteHint:
        "Tabulator (kopia z arkusza), średnik albo przecinek. Pierwszy wiersz z nagłówkiem jest pomijany. Najwyżej 500 dni naraz.",
      pastePlaceholder: "2026-09-01;123,45;PLN;40;1000",
      pasteImport: "Importuj",
      listSection: "Zapisane dni",
      empty: "Brak kosztów.",
      clicks: "Kliknięcia",
      impressions: "Wyświetlenia",
      source: "Źródło",
      deleteDay: "Usuń dzień {{day}}",
      close: "Zamknij",
      lineError: "Wiersz {{line}}: {{message}}",
      rowErrors: {
        dayInvalid: "zła data (RRRR-MM-DD albo DD.MM.RRRR)",
        amountInvalid: "zła kwota",
        currencyInvalid: "zła waluta (trzy litery, np. PLN)",
        countInvalid: "zła liczba kliknięć albo wyświetleń",
        dayDuplicate: "dzień się powtarza",
        tooManyRows: "najwyżej 500 dni naraz",
        noRows: "brak wierszy z kosztem",
      },
    },
    costSources: {
      manual: "ręcznie",
      csv: "import",
    },
    export: {
      label: "Eksport",
      description:
        "Tabela lejka do arkusza oraz plik importu konwersji offline do Google Ads (Cele → Konwersje → Przesłane pliki).",
      funnelCsv: "Tabela lejka (CSV)",
      adsCsv: "Konwersje offline Google Ads (CSV)",
      defaultConversion: "Domyślna nazwa konwersji",
      defaultConversionHint:
        "Dla opłaconych biletów z kampanii bez własnej nazwy konwersji. Puste = takie wiersze nie trafią do pliku.",
      templateNote:
        "Porównaj nagłówki pliku z szablonem pobranym z docelowego konta Google Ads - konta mogą różnić się kolumnami.",
      consentNote:
        "Plik zawiera wyłącznie kliknięcia zebrane przy zgodzie marketingowej, nie starsze niż 90 dni, i płatności po kliknięciu.",
      noRows: "Brak konwersji do eksportu w tym okresie.",
      exported_one: "Plik zawiera {{count}} konwersję.",
      exported_few: "Plik zawiera {{count}} konwersje.",
      exported_many: "Plik zawiera {{count}} konwersji.",
      exported_other: "Plik zawiera {{count}} konwersji.",
      missingName_one: "{{count}} konwersja bez nazwy konwersji - pominięta.",
      missingName_few: "{{count}} konwersje bez nazwy konwersji - pominięte.",
      missingName_many: "{{count}} konwersji bez nazwy konwersji - pominiętych.",
      missingName_other: "{{count}} konwersji bez nazwy konwersji - pominiętych.",
      rejected_one: "{{count}} wiersz z niedozwolonym znakiem - pominięty.",
      rejected_few: "{{count}} wiersze z niedozwolonym znakiem - pominięte.",
      rejected_many: "{{count}} wierszy z niedozwolonym znakiem - pominiętych.",
      rejected_other: "{{count}} wiersza z niedozwolonym znakiem - pominięte.",
      skipped:
        "Poza plikiem: bez atrybucji {{unattributed}}, bez kliknięcia {{noClick}}, wygasłe {{expired}}, płatność przed kliknięciem {{beforeClick}}, cofnięta zgoda na cookies marketingowe {{consentWithdrawn}}, czekające na przyjęcie {{awaitingAdmission}}.",
    },
    privacy: {
      label: "Prywatność",
      description:
        "Identyfikator kliknięcia (gclid, gbraid, wbraid) zapisujemy wyłącznie przy zgodzie marketingowej i usuwamy po 120 dniach; przy samej zgodzie analitycznej zostają kanał i UTM. Do CRM trafia kampania (utm_source, utm_medium, utm_campaign), nigdy identyfikator kliknięcia; zgoda marketingowa kontaktu pochodzi wyłącznie z formularza zapisu.",
      retention:
        "Surowe kroki lejka (pseudonimowe, bez adresu IP) usuwamy po 400 dniach; zgłoszenie przypina kampanię najpóźniej w dobie od zapisu i tylko raz.",
    },
    toasts: {
      campaignSaved: "Zapisano kampanię.",
      campaignDeleted: "Usunięto kampanię.",
      costDeleted: "Usunięto koszt dnia.",
      costsSaved_one: "Zapisano koszt {{count}} dnia.",
      costsSaved_few: "Zapisano koszty {{count}} dni.",
      costsSaved_many: "Zapisano koszty {{count}} dni.",
      costsSaved_other: "Zapisano koszty {{count}} dnia.",
    },
    errors: {
      unknown: "Nie udało się zapisać zmian. Spróbuj ponownie.",
      forbidden: "Ten ekran jest dostępny tylko dla administratora wydarzenia.",
      notFound: "Nie znaleziono wydarzenia albo kampanii - odśwież ekran.",
      invalidPayload: "Brakuje danych do zapisu - odśwież ekran i spróbuj ponownie.",
      invalidMatchKind: "Nieznany rodzaj dopasowania kampanii.",
      invalidMatchValue: "Ta wartość nie pasuje do wybranego rodzaju dopasowania.",
      invalidLabel: "Etykieta musi mieć od 1 do 120 znaków.",
      invalidConversionName:
        "Nazwa konwersji nie może zawierać przecinka ani cudzysłowu i nie może zaczynać się od znaku formuły.",
      campaignExists: "Ta kampania jest już zmapowana na to wydarzenie.",
      invalidSource: "Nieznane źródło kosztu.",
      invalidRows: "Wsad kosztów musi mieć od 1 do 500 dni.",
      invalidCostRow: "Wiersz {{count}} ma złą datę, kwotę albo walutę.",
      duplicateCostDay: "Wiersz {{count}} powtarza dzień - każdy dzień raz.",
      invalidWindow: "Początek okresu musi być przed jego końcem.",
    },
    analyticsLink: {
      label: "Lejek Google Ads",
      description:
        "Wizyty, zapisy i płatności per kampania, koszt i ROAS, eksport konwersji offline do Google Ads.",
      open: "Otwórz lejek",
    },
  },
} as const;

export const adminEventAdsFunnelEn = {
  adminEventAdsFunnel: {
    description:
      "Where participants come from and what the campaigns sold: visits, registrations, payments, revenue and Google Ads campaign cost.",
    loading: "Loading the funnel…",
    loadError: "The funnel could not be loaded. Try again.",
    window: {
      label: "Period",
      presets: {
        "7d": "7 days",
        "28d": "28 days",
        "90d": "90 days",
        all: "All time",
      },
    },
    summary: {
      label: "Summary",
      description:
        "Visits and funnel steps are counted for browsers that consented to measurement; registrations (including group package purchases) and revenue for everyone (including unattributed).",
      visits: "Visits",
      registrations: "Registrations",
      paid: "Paid",
      revenue: "Net revenue",
      cost: "Campaign cost",
      roas: "ROAS",
      roasHint: "Revenue from mapped campaigns over cost (same currency).",
      mixedCurrencies: "Several currencies - not converted",
    },
    steps: {
      visit: "Visit",
      registrationStart: "Registration started",
      registration: "Registration",
      checkoutStart: "Checkout started",
      paid: "Paid",
    },
    funnel: {
      label: "Funnel",
      description:
        "Steps of browsers that consented to measurement. Unattributed registrations (no consent, import, invitation) are not in the funnel - they have their own table row.",
      ofPrevious: "{{percent}} of the previous step",
      empty: "Nobody has gone through the funnel in this period yet.",
      ariaLabel: "Event sales funnel",
    },
    table: {
      label: "Campaigns",
      description:
        "A group is a mapped campaign or, without a mapping, the utm_campaign value or the Google Ads campaign ID. Each group is split by source and medium.",
      campaign: "Campaign",
      channel: "Source / medium",
      source: "Source",
      medium: "Medium",
      visits: "Visits",
      registrationStarts: "Registrations started",
      registrations: "Registrations",
      checkoutStarts: "Checkouts started",
      paid: "Paid",
      revenue: "Revenue",
      cost: "Cost",
      cpa: "Cost per paid",
      roas: "ROAS",
      conversion: "Visit to registration",
      noCampaign: "No campaign",
      otherCampaigns: "Other campaigns",
      otherHint: "Campaigns outside the top 50 in this period: {{folded}}.",
      unattributed: "Unattributed",
      unattributedHint:
        "Registrations and package purchases whose browser did not consent to measurement, came directly from another device, or that were added outside the form (import, invitation, organizer).",
      total: "Total",
      empty: "No campaign data in this period.",
      kinds: {
        campaign: "mapped",
        utm_campaign: "utm_campaign",
        gad_campaign: "Google Ads campaign ID",
        other: "folded",
        none: "no campaign",
      },
    },
    campaigns: {
      label: "Campaign mapping",
      description:
        "Link campaigns to the event by utm_campaign or by the Google Ads campaign ID (gad_campaignid). The label replaces the raw name in the report, and the cost enables CPA and ROAS.",
      add: "Add campaign",
      edit: "Edit",
      delete: "Delete",
      costs: "Costs",
      empty: "No mapped campaigns.",
      noCosts: "No costs",
      costsSummary_one: "{{amount}} · {{count}} day",
      costsSummary_other: "{{amount}} · {{count}} days",
      conversion: "Conversion: {{name}}",
      noConversion: "No conversion name",
      deleteTitle: "Delete the campaign?",
      deleteBody:
        "The mapping and all costs of this campaign will be deleted. Visits and registrations stay - they just stop being grouped under this label.",
      deleteConfirm: "Delete campaign",
      cancel: "Cancel",
    },
    matchKinds: {
      utm_campaign: "utm_campaign",
      google_ads_campaign_id: "Google Ads campaign ID",
    },
    campaignDialog: {
      createTitle: "New campaign",
      editTitle: "Edit campaign",
      section: "Matching",
      matchKind: "Match by",
      matchValue: "Value",
      matchValueHintUtm: "Exactly as in the link, e.g. spring-2026 (case-insensitive).",
      matchValueHintGad:
        "The number from gad_campaignid or from the “Campaign ID” column in Google Ads.",
      label: "Label in the report",
      conversionName: "Conversion name (offline import)",
      conversionNameHint:
        "The Google Ads conversion action that paid tickets from this campaign are uploaded to. No commas or quotes.",
      save: "Save",
      saving: "Saving…",
      cancel: "Cancel",
    },
    validation: {
      matchValueRequired: "Enter the value to match.",
      matchValueDigits: "A Google Ads campaign ID consists of digits only.",
      matchValueInvalid: "This value cannot be a campaign name (e.g. an email address).",
      labelRequired: "Enter a label.",
      labelTooLong: "The label can have at most 120 characters.",
      conversionNameInvalid:
        "The conversion name cannot contain a comma or a quote and cannot start with =, +, - or @.",
    },
    costs: {
      title: "Campaign costs: {{name}}",
      description:
        "Daily cost from the Google Ads report. Saving the same day again overwrites the cost - importing the same report twice duplicates nothing.",
      manualSection: "Add a day",
      day: "Day (YYYY-MM-DD)",
      amount: "Cost",
      currency: "Currency",
      addDay: "Save day",
      pasteSection: "Paste a report",
      pasteLabel: "Rows: day, cost, [currency], [clicks], [impressions]",
      pasteHint:
        "Tab (copied from a spreadsheet), semicolon or comma. A first header row is skipped. At most 500 days at once.",
      pastePlaceholder: "2026-09-01,123.45,PLN,40,1000",
      pasteImport: "Import",
      listSection: "Saved days",
      empty: "No costs.",
      clicks: "Clicks",
      impressions: "Impressions",
      source: "Source",
      deleteDay: "Delete day {{day}}",
      close: "Close",
      lineError: "Row {{line}}: {{message}}",
      rowErrors: {
        dayInvalid: "invalid date (YYYY-MM-DD or DD.MM.YYYY)",
        amountInvalid: "invalid amount",
        currencyInvalid: "invalid currency (three letters, e.g. PLN)",
        countInvalid: "invalid number of clicks or impressions",
        dayDuplicate: "the day repeats",
        tooManyRows: "at most 500 days at once",
        noRows: "no rows with a cost",
      },
    },
    costSources: {
      manual: "manual",
      csv: "import",
    },
    export: {
      label: "Export",
      description:
        "The funnel table for a spreadsheet and the offline conversion upload file for Google Ads (Goals → Conversions → Uploads).",
      funnelCsv: "Funnel table (CSV)",
      adsCsv: "Google Ads offline conversions (CSV)",
      defaultConversion: "Default conversion name",
      defaultConversionHint:
        "For paid tickets from campaigns without their own conversion name. Empty = such rows are left out of the file.",
      templateNote:
        "Compare the file headers with the template downloaded from the target Google Ads account - accounts can differ in columns.",
      consentNote:
        "The file contains only clicks collected with marketing consent, no older than 90 days, and payments made after the click.",
      noRows: "No conversions to export in this period.",
      exported_one: "The file contains {{count}} conversion.",
      exported_other: "The file contains {{count}} conversions.",
      missingName_one: "{{count}} conversion without a conversion name - skipped.",
      missingName_other: "{{count}} conversions without a conversion name - skipped.",
      rejected_one: "{{count}} row with a disallowed character - skipped.",
      rejected_other: "{{count}} rows with a disallowed character - skipped.",
      skipped:
        "Left out: unattributed {{unattributed}}, no click {{noClick}}, expired {{expired}}, paid before the click {{beforeClick}}, marketing cookies consent withdrawn {{consentWithdrawn}}, awaiting admission {{awaitingAdmission}}.",
    },
    privacy: {
      label: "Privacy",
      description:
        "The click ID (gclid, gbraid, wbraid) is stored only with marketing consent and deleted after 120 days; with analytics consent alone, only the channel and UTM remain. CRM receives the campaign (utm_source, utm_medium, utm_campaign), never the click ID; a contact's marketing consent comes only from the registration form.",
      retention:
        "Raw funnel steps (pseudonymous, no IP address) are deleted after 400 days; a registration gets its campaign at most one day after it is made, and only once.",
    },
    toasts: {
      campaignSaved: "Campaign saved.",
      campaignDeleted: "Campaign deleted.",
      costDeleted: "Day cost deleted.",
      costsSaved_one: "Saved the cost of {{count}} day.",
      costsSaved_other: "Saved the costs of {{count}} days.",
    },
    errors: {
      unknown: "Changes could not be saved. Try again.",
      forbidden: "This screen is available to the event administrator only.",
      notFound: "The event or campaign was not found - refresh the screen.",
      invalidPayload: "Data for saving is missing - refresh the screen and try again.",
      invalidMatchKind: "Unknown campaign match kind.",
      invalidMatchValue: "This value does not fit the selected match kind.",
      invalidLabel: "The label must have 1 to 120 characters.",
      invalidConversionName:
        "The conversion name cannot contain a comma or a quote and cannot start with a formula character.",
      campaignExists: "This campaign is already mapped to the event.",
      invalidSource: "Unknown cost source.",
      invalidRows: "A cost batch must have 1 to 500 days.",
      invalidCostRow: "Row {{count}} has an invalid date, amount or currency.",
      duplicateCostDay: "Row {{count}} repeats a day - each day once.",
      invalidWindow: "The period must start before it ends.",
    },
    analyticsLink: {
      label: "Google Ads funnel",
      description:
        "Visits, registrations and payments per campaign, cost and ROAS, offline conversion export to Google Ads.",
      open: "Open the funnel",
    },
  },
} as const;

i18n.addResourceBundle("pl", "translation", adminEventAdsFunnelPl, true, true);
i18n.addResourceBundle("en", "translation", adminEventAdsFunnelEn, true, true);

/** Dla wywołań przed pierwszym renderem; sam import już rejestruje słownik. */
export function ensureAdsFunnelI18n(): void {}
