// i18n ścieżek komunikacji (`adminJourneys`, S5) - etykiety silnika dla UI S8
// (kanwa, galeria szablonów, ustawienia, zdrowie silnika, wyniki).
//
// KAŻDY KOD UNII MA KLUCZ PL i EN: typy węzłów, gałęzie, statusy zapisu,
// powody wyjścia, wyniki kroków, fazy silnika, rodzaje warunków, wyzwalacze,
// zmienne, werdykty bramki maila, kody błędów grafu i zapisu, szablony -
// test `src/lib/journeys/__tests__/i18nJourneys.test.ts` (parytet z listami
// kodu). Prefiks `adminJourneys` jest pod TWARDĄ bramką parytetu
// (`src/__tests__/i18nParity.gate.test.ts`).
//
// UWAGA NA ARKUSZ CSS. Pliki `src/lib/i18n-*.ts` skanuje generator arkusza
// PUBLICZNEGO - słowo będące nazwą klasy narzędziowej w angielskim napisie
// dokłada regułę do CSS każdej strony czytelnika. Napisy niżej takich słów
// unikają.
//
// IMPORT WYŁĄCZNIE Z KOMPONENTÓW (UI S8 woła `ensureI18n()`).
import i18n from "@/lib/i18n";

const pl = {
  adminJourneys: {
    nodeType: {
      trigger: "Wyzwalacz",
      wait: "Czekanie",
      send_email: "Wyślij e-mail",
      ab_split: "Test A/B",
      if_else: "Warunek (tak/nie)",
      set_lifecycle_stage: "Ustaw etap cyklu życia",
      set_crm_stage: "Ustaw etap sprzedaży",
      create_crm_task: "Utwórz zadanie CRM",
      add_tag: "Dodaj tag",
      remove_tag: "Usuń tag",
      newsletter_list: "Lista newslettera",
      notify_staff: "Powiadom zespół",
      goal: "Cel",
      exit: "Koniec",
    },
    nodeFamily: {
      start: "Start",
      timing: "Czas",
      message: "Wiadomość",
      logic: "Logika",
      action: "Akcja CRM",
      terminal: "Zakończenie",
    },
    branch: {
      next: "Dalej",
      yes: "Tak",
      no: "Nie",
      A: "Wariant A",
      B: "Wariant B",
      event: "Zdarzenie nastąpiło",
      timeout: "Minął termin",
    },
    enrollmentStatus: {
      active: "W toku",
      waiting: "Czeka",
      completed: "Ukończona",
      goal_reached: "Cel osiągnięty",
      exited: "Wyszedł",
      failed: "Błąd",
    },
    exitReason: {
      completed: "Koniec ścieżki",
      goal: "Osiągnięty cel",
      exit_event: "Zdarzenie wyjścia",
      consent: "Brak zgody marketingowej",
      unsubscribed: "Wypis",
      suppressed: "Adres zablokowany (odbicie, skarga)",
      manual: "Wyjęty ręcznie",
      journey_archived: "Ścieżka zarchiwizowana",
      error: "Błąd kroku po 8 próbach",
      entry_filter: "Nie spełnia filtra wejścia",
      account_deleted: "Konto usunięte (RODO)",
    },
    stepOutcome: {
      next: "Dalej",
      yes: "Tak",
      no: "Nie",
      A: "Wariant A",
      B: "Wariant B",
      C: "Wariant C",
      D: "Wariant D",
      E: "Wariant E",
      event: "Zdarzenie",
      timeout: "Limit czasu",
      capped: "Limit maili na 7 dni",
      quiet: "Cisza nocna",
      no_consent: "Brak zgody",
      precedence: "Pierwszeństwo płatności lub człowieka",
      skipped: "Pominięty",
      delivery_not_ready: "Wysyłka niegotowa",
    },
    enginePhase: {
      route: "Trasa zdarzeń",
      ingest: "Skrzynka zdarzeń",
      advance: "Wykonanie kroków",
      email: "Wysyłka e-maili",
      tracking: "Śledzenie",
    },
    predicate: {
      email_opened: "Otworzył e-mail",
      email_clicked: "Kliknął w e-mailu",
      plan: "Plan członkowski",
      subscription_status: "Status subskrypcji",
      crm_stage: "Etap sprzedaży",
      lifecycle_stage: "Etap cyklu życia",
      consent: "Zgoda marketingowa",
      newsletter_status: "Status w newsletterze",
      has_tag: "Ma tag",
      score_band: "Przedział oceny leada",
      event_since_enrollment: "Zdarzenie od wejścia",
      club_member: "Członek klubu",
      event_registered: "Zapisany na wydarzenie",
      trigger_field: "Pole zdarzenia wejścia",
    },
    triggerGroup: {
      account: "Konto",
      funnel: "Lejek i kasa",
      billing: "Subskrypcja",
      retention: "Rezygnacja",
      events: "Wydarzenia",
      community: "Kluby",
      crm: "CRM",
      newsletter: "Newsletter",
    },
    trigger: {
      account_registered: "Nowe konto",
      newsletter_subscriber_confirmed: "Potwierdzony zapis na newsletter",
      newsletter_subscriber_subscribed: "Zapis na newsletter",
      paywall_hit: "Zatrzymanie na paywallu",
      metering_quota_exhausted: "Wyczerpany limit bezpłatnych analiz",
      checkout_started: "Rozpoczęta płatność",
      checkout_completed: "Opłacone zamówienie",
      checkout_failed: "Nieudana płatność w kasie",
      checkout_abandoned: "Porzucona kasa",
      billing_subscription_status_changed: "Zmiana statusu subskrypcji",
      billing_subscription_payment_failed: "Nieudana płatność subskrypcji",
      billing_subscription_payment_recovered: "Odzyskana płatność subskrypcji",
      billing_subscription_trial_ending: "Koniec okresu próbnego za 3 dni",
      subscription_renewed: "Odnowiona subskrypcja",
      subscription_expired: "Wygasły dostęp",
      retention_flow_started: "Rozpoczęta rezygnacja",
      retention_flow_completed: "Zakończona rezygnacja",
      event_registration_created: "Rejestracja na wydarzenie",
      event_registration_cancelled: "Rezygnacja z wydarzenia",
      event_registration_attended: "Obecność na wydarzeniu",
      club_application_submitted: "Zgłoszenie do klubu",
      club_application_decided: "Decyzja w sprawie zgłoszenia do klubu",
      crm_lead_created: "Nowy kontakt w CRM",
      crm_lead_stage_changed: "Zmiana etapu sprzedaży",
      crm_lead_lifecycle_changed: "Zmiana etapu cyklu życia",
    },
    variable: {
      first_name: "Imię",
      last_name: "Nazwisko",
      site_name: "Nazwa serwisu",
      plan_name: "Nazwa planu",
      event_title: "Tytuł wydarzenia",
      club_name: "Nazwa klubu",
      trial_ends_at: "Koniec okresu próbnego",
      site_url: "Adres serwisu",
      pricing_url: "Adres cennika",
      account_url: "Adres ustawień subskrypcji",
      newsletter_url: "Adres preferencji newslettera",
    },
    sendVerdict: {
      ok: "Można wysłać",
      no_consent: "Brak zgody marketingowej",
      unsubscribed: "Kontakt się wypisał",
      suppressed: "Adres zablokowany",
      capped: "Limit maili na 7 dni wyczerpany",
      quiet: "Cisza nocna - wysyłka po jej końcu",
    },
    graphIssue: {
      nodes_count: "Ścieżka musi mieć od 1 do 60 kroków.",
      node_id_duplicate: "Dwa kroki mają ten sam identyfikator.",
      trigger_count: "Ścieżka musi mieć dokładnie jeden wyzwalacz.",
      edge_dangling: "Połączenie prowadzi do nieistniejącego kroku.",
      edge_into_trigger: "Do wyzwalacza nie może prowadzić żadne połączenie.",
      edge_duplicate_branch: "Krok ma dwa połączenia tej samej gałęzi.",
      branches_incomplete: "Krok nie ma kompletu gałęzi.",
      params_invalid: "Ustawienia kroku są niepoprawne.",
      predicate_not_ancestor_email:
        "Warunek otwarcia lub kliknięcia musi wskazywać e-mail wysłany wcześniej na tej ścieżce.",
      email_on_payment_failed:
        "Przy nieudanej płatności ścieżka nie wysyła e-maili - przypomnienia wysyła windykacja.",
      graph_cycle: "Ścieżka zawraca do wcześniejszego kroku (pętla).",
      node_unreachable: "Do kroku nie da się dojść od wyzwalacza.",
      workflow_overlap:
        "Włączona automatyzacja z tym samym wyzwalaczem też tworzy zadanie CRM - powstaną dwa zadania.",
      trigger_cycle:
        "Akcja tej ścieżki wywołuje zdarzenie, na które czeka aktywna ścieżka - kontakty mogą krążyć.",
      entry_filter_history:
        "Filtr wejścia z warunkiem historii (otwarcie, kliknięcie) jest zawsze fałszywy.",
      // Kody walidatora publikacji (`journey_validate_graph`) spoza listy TS.
      graph_shape: "Zapis ścieżki ma niepoprawny kształt.",
      node_id_invalid: "Identyfikator kroku ma niedozwolone znaki albo długość.",
      node_type_unknown: "Nieznany rodzaj kroku.",
      wait_minutes: "Czas czekania musi mieścić się w dozwolonym zakresie.",
      wait_until_time: "Czekanie do godziny wymaga dni tygodnia i godziny.",
      wait_until_event: "Czekanie na zdarzenie wymaga typu zdarzenia i terminu.",
      wait_mode: "Nieznany rodzaj czekania.",
      ab_weights: "Wagi testu A/B muszą dawać razem 100.",
      if_else_empty: "Warunek wymaga co najmniej jednej reguły.",
      lifecycle_stage: "Tego etapu cyklu życia nie ustawia ścieżka (tylko płatność).",
      crm_stage: "Nieznany etap sprzedaży.",
      task_params: "Zadanie CRM wymaga tytułu i terminu w dozwolonym zakresie.",
      tag_length: "Tag musi mieć od 1 do 64 znaków.",
      newsletter_list: "Operacja na liście newslettera jest niepoprawna.",
      staff_message: "Powiadomienie zespołu wymaga treści do 500 znaków.",
    },
    simulationNote: {
      duration: "Czekanie przez określony czas",
      until_time: "Czekanie do wybranej godziny",
      until_event: "Czekanie na zdarzenie",
      simulated_bucket: "Wariant wylosowany dla tego kontaktu",
      history_predicates_false: "Warunki historii (otwarcia, kliknięcia) liczone jako niespełnione",
      would_run: "Akcja zostałaby wykonana",
    },
    mutationError: {
      forbidden: "Brak uprawnień do tej operacji.",
      conflict: "Ktoś zmienił ścieżkę w międzyczasie - odśwież i spróbuj ponownie.",
      not_found: "Nie znaleziono ścieżki lub kontaktu.",
      duplicate: "Taki klucz albo zapis już istnieje.",
      limit_exceeded: "Wartość przekracza dozwolony limit.",
      invalid: "Dane są niepoprawne.",
      unavailable: "Funkcja będzie dostępna po zakończeniu wdrożenia.",
      template_unavailable: "Ten szablon czeka na zdarzenie, którego serwis jeszcze nie wysyła.",
    },
    settings: {
      title: "Silnik ścieżek",
      enabled: "Silnik włączony",
      enabledHint: "Domyślnie wyłączony - żaden kontakt nie dostaje maila ścieżki bez włączenia.",
      marketingCap: "Limit maili marketingowych na 7 dni",
      marketingCapHint: "Liczone razem ze ścieżkami i kampaniami newslettera (D-03: 3).",
      quietStart: "Cisza nocna od",
      quietEnd: "Cisza nocna do",
      quietHint: "Maile marketingowe w ciszy nocnej czekają do jej końca.",
      timezone: "Strefa czasowa",
      defaultTaskAssignee: "Domyślna osoba dla zadań CRM",
      machineOpenSeconds: "Próg otwarć automatycznych (sekundy)",
      senderName: "Nazwa nadawcy",
      senderNameHint: "Domena nadawcza zostaje bez zmian - zmienia się nazwa w polu Od.",
      replyTo: "Adres do odpowiedzi",
      killSwitch: "Awaryjny wyłącznik środowiska jest aktywny - silnik stoi dla wszystkich.",
    },
    health: {
      title: "Stan silnika",
      inboxPending: "Zdarzenia w skrzynce",
      inboxOldestAt: "Najstarsze nieprzetworzone",
      lastIngestAt: "Ostatnie przetworzenie",
      dueNow: "Kontakty do wykonania",
      active: "W toku",
      waiting: "Czekają",
      locked: "W trakcie wykonania",
      lastStepAt: "Ostatni krok",
      failed24h: "Zapisy z błędem (24 h)",
      deadSteps24h: "Kroki porzucone po 8 próbach (24 h)",
      messages24h: "Maile ścieżek (24 h)",
      errors24h: "Błędy według faz (24 h)",
      lastErrors: "Ostatnie błędy",
      journeysActive: "Aktywne ścieżki",
    },
    templates: {
      welcome_onboarding: {
        name: "Powitanie nowego konta",
        description:
          "Trzy maile w pierwszym tygodniu: pierwszy krok, wartość członkostwa, zaproszenie do planu.",
      },
      newsletter_welcome: {
        name: "Powitanie subskrybenta",
        description:
          "Czego się spodziewać, najlepsze analizy, a przy braku otwarć - pytanie o preferencje.",
      },
      paywall_nurture: {
        name: "Po zatrzymaniu na paywallu",
        description: "Najpierw wartość, potem oferta - jedno wezwanie do działania w każdym mailu.",
      },
      quota_exhausted_upgrade: {
        name: "Wyczerpany limit analiz",
        description: "Wiadomość w chwili wyczerpania limitu i przypomnienie dla osób bez planu.",
      },
      abandoned_checkout: {
        name: "Porzucona kasa",
        description:
          "Przypomnienie po dwóch godzinach i pomoc następnego dnia; wymaga zgody marketingowej.",
      },
      trial_ending: {
        name: "Koniec okresu próbnego",
        description: "Informacja usługowa o końcu próby i warunkach dalszej subskrypcji.",
      },
      payment_failed_crm: {
        name: "Nieudana płatność - CRM",
        description:
          "Zadanie i powiadomienie dla opiekuna bez maili do klienta (maile wysyła windykacja).",
      },
      cancel_scheduled_save: {
        name: "Zaplanowane anulowanie",
        description:
          "Zadanie CRM, pytanie o powód bez utrudniania rezygnacji i informacja, co zostaje.",
      },
      winback_30d: {
        name: "Powrót po 30 dniach",
        description:
          "Co nowego i zaproszenie do powrotu - bez kontaktów, które tylko wstrzymały subskrypcję.",
      },
      event_registration_nurture: {
        name: "Przygotowanie do wydarzenia",
        description:
          "Materiały i pytania przed wydarzeniem; przypomnienia terminów zostają w poczcie wydarzeń.",
      },
      event_attended_upsell: {
        name: "Po wydarzeniu",
        description:
          "Podziękowanie i materiały dzień po wydarzeniu, potem członkostwo dla osób bez planu.",
      },
      club_application_received: {
        name: "Zgłoszenie do klubu - potwierdzenie",
        description:
          "Natychmiastowe potwierdzenie dla zgłaszającego i powiadomienie administratorów.",
      },
      club_application_followup: {
        name: "Zgłoszenie do klubu - po 7 dniach",
        description:
          "Zadanie dla zespołu klubu i informacja dla zgłaszającego, gdy decyzja się opóźnia.",
      },
      pricing_enquiry_b2b: {
        name: "Zapytanie o ofertę dla instytucji",
        description:
          "Powiadomienie i zadanie dla opiekuna w ciągu godziny. Dostępne po dodaniu zdarzenia formularza kontaktowego.",
      },
    },
  },
};

const en = {
  adminJourneys: {
    nodeType: {
      trigger: "Trigger",
      wait: "Delay",
      send_email: "Send email",
      ab_split: "A/B test",
      if_else: "Condition (yes/no)",
      set_lifecycle_stage: "Set lifecycle stage",
      set_crm_stage: "Set sales stage",
      create_crm_task: "Create CRM task",
      add_tag: "Add tag",
      remove_tag: "Remove tag",
      newsletter_list: "Newsletter list",
      notify_staff: "Notify the team",
      goal: "Goal",
      exit: "End",
    },
    nodeFamily: {
      start: "Entry",
      timing: "Timing",
      message: "Message",
      logic: "Logic",
      action: "CRM action",
      terminal: "Finish",
    },
    branch: {
      next: "Next",
      yes: "Yes",
      no: "No",
      A: "Variant A",
      B: "Variant B",
      event: "Event happened",
      timeout: "Time ran out",
    },
    enrollmentStatus: {
      active: "In progress",
      waiting: "Waiting",
      completed: "Completed",
      goal_reached: "Goal reached",
      exited: "Left",
      failed: "Error",
    },
    exitReason: {
      completed: "End of journey",
      goal: "Goal reached",
      exit_event: "Exit event",
      consent: "No marketing consent",
      unsubscribed: "Unsubscribed",
      suppressed: "Address blocked (bounce, complaint)",
      manual: "Removed by staff",
      journey_archived: "Journey archived",
      error: "Step error after 8 attempts",
      entry_filter: "Does not meet the entry filter",
      account_deleted: "Account deleted (GDPR)",
    },
    stepOutcome: {
      next: "Next",
      yes: "Yes",
      no: "No",
      A: "Variant A",
      B: "Variant B",
      C: "Variant C",
      D: "Variant D",
      E: "Variant E",
      event: "Event",
      timeout: "Time limit",
      capped: "7-day email limit",
      quiet: "Quiet hours",
      no_consent: "No consent",
      precedence: "Payment or staff takes precedence",
      skipped: "Skipped",
      delivery_not_ready: "Sending not ready",
    },
    enginePhase: {
      route: "Event routing",
      ingest: "Event inbox",
      advance: "Step execution",
      email: "Email sending",
      tracking: "Tracking",
    },
    predicate: {
      email_opened: "Opened the email",
      email_clicked: "Clicked in the email",
      plan: "Membership plan",
      subscription_status: "Subscription status",
      crm_stage: "Sales stage",
      lifecycle_stage: "Lifecycle stage",
      consent: "Marketing consent",
      newsletter_status: "Newsletter status",
      has_tag: "Has tag",
      score_band: "Lead score band",
      event_since_enrollment: "Event since entry",
      club_member: "Club member",
      event_registered: "Registered for an event",
      trigger_field: "Entry event field",
    },
    triggerGroup: {
      account: "Account",
      funnel: "Funnel and payments",
      billing: "Subscription",
      retention: "Cancellation",
      events: "Events",
      community: "Clubs",
      crm: "Sales pipeline",
      newsletter: "Newsletter subscription",
    },
    trigger: {
      account_registered: "New account",
      newsletter_subscriber_confirmed: "Confirmed newsletter subscription",
      newsletter_subscriber_subscribed: "Newsletter sign-up",
      paywall_hit: "Stopped at the paywall",
      metering_quota_exhausted: "Free analysis allowance used up",
      checkout_started: "Payment started",
      checkout_completed: "Order paid",
      checkout_failed: "Payment failed at checkout",
      checkout_abandoned: "Abandoned checkout",
      billing_subscription_status_changed: "Subscription status change",
      billing_subscription_payment_failed: "Subscription payment failed",
      billing_subscription_payment_recovered: "Subscription payment recovered",
      billing_subscription_trial_ending: "Trial ends in 3 days",
      subscription_renewed: "Subscription renewed",
      subscription_expired: "Access expired",
      retention_flow_started: "Cancellation started",
      retention_flow_completed: "Cancellation finished",
      event_registration_created: "Event registration",
      event_registration_cancelled: "Event registration withdrawn",
      event_registration_attended: "Attended an event",
      club_application_submitted: "Club application",
      club_application_decided: "Club application decision",
      crm_lead_created: "New CRM contact",
      crm_lead_stage_changed: "Sales stage change",
      crm_lead_lifecycle_changed: "Lifecycle stage change",
    },
    variable: {
      first_name: "First name",
      last_name: "Last name",
      site_name: "Site name",
      plan_name: "Plan name",
      event_title: "Event title",
      club_name: "Club name",
      trial_ends_at: "Trial end date",
      site_url: "Site address",
      pricing_url: "Pricing page address",
      account_url: "Subscription settings address",
      newsletter_url: "Newsletter preferences address",
    },
    sendVerdict: {
      ok: "Ready to send",
      no_consent: "No marketing consent",
      unsubscribed: "The contact unsubscribed",
      suppressed: "Address blocked",
      capped: "7-day email limit reached",
      quiet: "Quiet hours - sending afterwards",
    },
    graphIssue: {
      nodes_count: "A journey needs between 1 and 60 steps.",
      node_id_duplicate: "Two steps share the same identifier.",
      trigger_count: "A journey needs exactly one trigger.",
      edge_dangling: "A connection leads to a step that does not exist.",
      edge_into_trigger: "No connection may lead into the trigger.",
      edge_duplicate_branch: "A step has two connections on the same branch.",
      branches_incomplete: "A step is missing some of its branches.",
      params_invalid: "The step settings are not valid.",
      predicate_not_ancestor_email:
        "An open or click condition must point to an email sent earlier on this journey.",
      email_on_payment_failed:
        "On a failed payment the journey sends no emails - reminders come from dunning.",
      graph_cycle: "The journey loops back to an earlier step.",
      node_unreachable: "The step cannot be reached from the trigger.",
      workflow_overlap:
        "An active automation with the same trigger also creates a CRM task - two tasks will appear.",
      trigger_cycle:
        "An action on this journey emits an event an active journey waits for - contacts may loop.",
      entry_filter_history:
        "An entry filter using history conditions (open, click) is always false.",
      graph_shape: "The journey record has an unexpected shape.",
      node_id_invalid: "A step identifier has disallowed characters or length.",
      node_type_unknown: "Unknown step type.",
      wait_minutes: "The waiting time must be within the allowed range.",
      wait_until_time: "Waiting until a time needs weekdays and an hour.",
      wait_until_event: "Waiting for an event needs an event type and a deadline.",
      wait_mode: "Unknown waiting mode.",
      ab_weights: "The A/B test weights must add up to 100.",
      if_else_empty: "A condition needs at least one rule.",
      lifecycle_stage: "A journey cannot set this lifecycle stage (payments only).",
      crm_stage: "Unknown sales stage.",
      task_params: "A CRM task needs a title and a due date within the allowed range.",
      tag_length: "A tag must have between 1 and 64 characters.",
      newsletter_list: "The newsletter list operation is not valid.",
      staff_message: "A team notification needs a message of up to 500 characters.",
    },
    simulationNote: {
      duration: "Waiting for a set time",
      until_time: "Waiting until a chosen hour",
      until_event: "Waiting for an event",
      simulated_bucket: "Variant drawn for this contact",
      history_predicates_false: "History conditions (opens, clicks) counted as not met",
      would_run: "The action would run",
    },
    mutationError: {
      forbidden: "You do not have permission for this operation.",
      conflict: "Someone changed the journey in the meantime - reload and try again.",
      not_found: "The journey or contact was not found.",
      duplicate: "Such a key or entry already exists.",
      limit_exceeded: "The value exceeds the allowed limit.",
      invalid: "The data is not valid.",
      unavailable: "This feature will be available once the rollout is complete.",
      template_unavailable: "This template waits for an event the site does not send yet.",
    },
    settings: {
      title: "Journey engine",
      enabled: "Engine on",
      enabledHint: "Off by default - no contact receives a journey email until it is switched on.",
      marketingCap: "Marketing email limit per 7 days",
      marketingCapHint: "Counted across journeys and newsletter campaigns (D-03: 3).",
      quietStart: "Quiet hours from",
      quietEnd: "Quiet hours until",
      quietHint: "Marketing emails during quiet hours wait until they end.",
      timezone: "Time zone",
      defaultTaskAssignee: "Default person for CRM tasks",
      machineOpenSeconds: "Automated open threshold (seconds)",
      senderName: "Sender name",
      senderNameHint: "The sending domain stays the same - only the From name changes.",
      replyTo: "Reply-to address",
      killSwitch: "The emergency environment switch is on - the engine is stopped for everyone.",
    },
    health: {
      title: "Engine status",
      inboxPending: "Events in the inbox",
      inboxOldestAt: "Oldest unprocessed",
      lastIngestAt: "Last processed",
      dueNow: "Contacts due",
      active: "In progress",
      waiting: "Waiting",
      locked: "Being executed",
      lastStepAt: "Last step",
      failed24h: "Entries with errors (24 h)",
      deadSteps24h: "Steps dropped after 8 attempts (24 h)",
      messages24h: "Journey emails (24 h)",
      errors24h: "Errors by phase (24 h)",
      lastErrors: "Latest errors",
      journeysActive: "Active journeys",
    },
    templates: {
      welcome_onboarding: {
        name: "New account welcome",
        description:
          "Three emails in the first week: a first step, the value of membership, an invitation to a plan.",
      },
      newsletter_welcome: {
        name: "Subscriber welcome",
        description:
          "What to expect, the best analysis and, without opens, a question about preferences.",
      },
      paywall_nurture: {
        name: "After the paywall",
        description: "Value first, then the offer - one call to action in each email.",
      },
      quota_exhausted_upgrade: {
        name: "Allowance used up",
        description:
          "A message when the allowance runs out and a reminder for readers without a plan.",
      },
      abandoned_checkout: {
        name: "Abandoned checkout",
        description:
          "A reminder after two hours and help the next day; requires marketing consent.",
      },
      trial_ending: {
        name: "Trial ending",
        description:
          "A service notice about the end of the trial and the terms of the continuing subscription.",
      },
      payment_failed_crm: {
        name: "Failed payment - CRM",
        description:
          "A task and notification for the account owner, no emails to the customer (dunning sends them).",
      },
      cancel_scheduled_save: {
        name: "Scheduled cancellation",
        description:
          "A CRM task, a question about the reason without making cancelling harder, and what remains.",
      },
      winback_30d: {
        name: "Win-back after 30 days",
        description:
          "What is new and an invitation to return - excluding contacts who only paused.",
      },
      event_registration_nurture: {
        name: "Event preparation",
        description:
          "Materials and questions before the event; date reminders stay with event emails.",
      },
      event_attended_upsell: {
        name: "After the event",
        description:
          "Thanks and materials the day after, then membership for attendees without a plan.",
      },
      club_application_received: {
        name: "Club application - confirmation",
        description:
          "Instant confirmation for the applicant and a notification for administrators.",
      },
      club_application_followup: {
        name: "Club application - after 7 days",
        description:
          "A task for the club team and a status note for the applicant when the decision is late.",
      },
      pricing_enquiry_b2b: {
        name: "Institutional pricing enquiry",
        description:
          "A notification and task for the owner within an hour. Available once the contact form event exists.",
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
export const journeysDictionaries = { pl, en } as const;
