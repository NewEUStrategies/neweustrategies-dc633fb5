// Pakiet i18n systemu „Zapytanie do eksperta" (Expert Request).
// Rejestracja przy pierwszym imporcie modułu (patrz ExpertRequestDialogHost).
import i18n from "./i18n";

export const expertRequestPl = {
  expertRequest: {
    cta: "Zapytanie do eksperta",
    ctaShort: "Zapytanie",
    dialogTitle: "Wyślij zapytanie do eksperta lub VIP-a",
    dialogSubtitle:
      "Prześlij formalne zapytanie - jeśli odbiorca je zaakceptuje, otworzymy stałą konwersację.",
    upgradeCta: "Zobacz plan VIP (bezpośrednia rozmowa z ekspertami i VIP-ami)",
    recipientLabel: "Odbiorca",
    quota: {
      remaining: "Pozostało {{remaining}} z {{quota}} zapytań w tym miesiącu.",
      direct: "Twój plan pozwala pisać do ekspertów bezpośrednio - bez limitu zapytań.",
      none: "Twój plan nie obejmuje zapytań do ekspertów. Zaktualizuj plan, aby napisać.",
      exhausted: "Wykorzystałeś miesięczną pulę zapytań ({{quota}}). Odnowi się 1. dnia miesiąca.",
      cancelledCounts:
        "Wysłane zapytanie zużywa pulę także po wycofaniu - pula odnawia się 1. dnia miesiąca.",
    },
    fields: {
      subject: "Temat rozmowy",
      subjectHint: "Krótko - o czym chcesz porozmawiać (5-140 znaków).",
      reason: "Dlaczego piszesz",
      reasonHint: "Kontekst i cel rozmowy (20-2000 znaków).",
      questions: "Twoje pytania (opcjonalnie, do 5)",
      questionPlaceholder: "Pytanie nr {{n}}",
      addQuestion: "Dodaj pytanie",
      removeQuestion: "Usuń pytanie",
      expectedAnswers: "Oczekiwane odpowiedzi (opcjonalnie)",
      expectedAnswersHint: "Jakiego typu odpowiedzi się spodziewasz - forma, zakres, format.",
      links: "Linki zewnętrzne (opcjonalnie, do 3)",
      linkPlaceholder: "https://…",
      addLink: "Dodaj link",
      removeLink: "Usuń link",
    },
    validation: {
      subject: "Temat musi mieć od 5 do 140 znaków.",
      reason: "Uzasadnienie musi mieć od 20 do 2000 znaków.",
      question: "Każde pytanie musi mieć od 5 do 500 znaków.",
      link: "Każdy link musi zaczynać się od http(s)://.",
      questionsMax: "Możesz podać maksymalnie 5 pytań.",
      linksMax: "Możesz podać maksymalnie 3 linki.",
    },
    submit: "Wyślij zapytanie",
    cancel: "Anuluj",
    sending: "Wysyłam…",
    sentToast: "Zapytanie wysłane. Poinformujemy Cię o odpowiedzi.",
    error: {
      rateLimit: "Wysłałeś już maksymalną liczbę zapytań w krótkim czasie.",
      monthlyQuota:
        "Wyczerpałeś miesięczną pulę zapytań do ekspertów. Zwiększ plan, aby napisać do kolejnych ekspertów lub VIP-ów.",
      notExpert:
        "Ten użytkownik nie wymaga zapytania - napisz do niego bezpośrednio z listy kontaktów.",
      tierDisabled:
        "Twoja warstwa nie umożliwia wysyłania zapytań do ekspertów. Zaktualizuj plan (Plus, Pro lub VIP).",
      recipientDisabled: "Ten ekspert wstrzymał przyjmowanie zapytań. Spróbuj ponownie później.",
      featureDisabled: "Zapytania do ekspertów są wyłączone w tej organizacji.",
      notAvailable: "Ten odbiorca jest niedostępny w Twoim obszarze roboczym.",
      invalidTransition: "To zapytanie zostało już rozstrzygnięte - odśwież listę.",
      notFound: "Nie znaleziono zapytania - mogło zostać usunięte.",
      forbidden: "Nie masz uprawnień do tej operacji.",
      generic: "Nie udało się wysłać. Spróbuj ponownie.",
    },
    status: {
      pending: "Oczekuje",
      approved: "Zatwierdzone",
      declined: "Odrzucone",
      answered: "Odpowiedziano",
      cancelled: "Anulowane",
    },
    box: {
      sent: "Wysłane",
      received: "Otrzymane",
      empty: "Brak wiadomości w tej skrzynce.",
    },
    inbox: {
      tab: "Zapytania",
      title: "Zapytania z formularzy",
      empty: "Brak zapytań. Gdy ktoś wypełni formularz zapytania do Ciebie, pojawi się tutaj.",
      more: "Pokaż szczegóły",
      less: "Ukryj szczegóły",
      questions: "Pytania",
      reply: "Odpowiedz w czacie",
      openedToast: "Rozmowa otwarta - odpowiedz w czacie.",
    },
    actions: {
      approve: "Otwórz rozmowę",
      decline: "Odrzuć",
      answered: "Oznacz jako odpowiedziane",
      cancel: "Wycofaj",
      openConversation: "Otwórz konwersację",
      noteLabel: "Notatka (opcjonalna)",
      declineReasonLabel: "Powód odrzucenia (opcjonalny)",
      confirm: "Zatwierdź",
    },
    confirmCancel: {
      title: "Wycofać to zapytanie?",
      description:
        "Ekspert przestanie je widzieć jako oczekujące. Wycofanie NIE zwraca puli - zapytanie nadal liczy się do limitu w tym miesiącu.",
      confirm: "Wycofaj zapytanie",
      keep: "Zostaw",
      doneToast: "Zapytanie wycofane.",
    },
    admin: {
      title: "Zapytania do ekspertów",
      subtitle:
        "Sformalizowane zapytania od użytkowników do ekspertów. Zatwierdź - powstaje bezpośrednia konwersacja; odrzuć - zapytanie kończy się z powodem.",
      filter: "Status",
      filterAll: "Wszystkie",
      countTotal: "Łącznie: {{count}}",
    },
    profile: {
      title: "Zapytania do ekspertów",
      subtitle: "Sformalizowane zapytania - wysłane i otrzymane od ekspertów.",
    },
    chatGate: {
      tierDisabledToast: "Twoja warstwa nie pozwala rozpocząć rozmowy. Zaktualizuj plan.",
      requestOpened: "Otwieramy okno zapytania - napisz formalnie do eksperta.",
      openPricing: "Zobacz plany",
    },
  },
};

export const expertRequestEn = {
  expertRequest: {
    cta: "Expert request",
    ctaShort: "Request",
    dialogTitle: "Send an expert request to an expert or VIP",
    dialogSubtitle:
      "Send a formal request - if the recipient approves, we open an ongoing conversation.",
    upgradeCta: "See the VIP plan (direct chat with experts and VIPs)",
    recipientLabel: "Recipient",
    quota: {
      remaining: "{{remaining}} of {{quota}} requests left this month.",
      direct: "Your plan lets you message experts directly - no request limit.",
      none: "Your plan does not include expert requests. Upgrade your plan to write.",
      exhausted: "You have used your monthly quota ({{quota}}). It renews on the 1st of the month.",
      cancelledCounts:
        "A sent request uses your quota even after you withdraw it - the quota renews on the 1st of the month.",
    },
    fields: {
      subject: "Subject",
      subjectHint: "Briefly - what would you like to discuss (5-140 characters).",
      reason: "Why you are writing",
      reasonHint: "Context and goal of the conversation (20-2000 characters).",
      questions: "Your questions (optional, up to 5)",
      questionPlaceholder: "Question #{{n}}",
      addQuestion: "Add question",
      removeQuestion: "Remove question",
      expectedAnswers: "Expected answers (optional)",
      expectedAnswersHint: "What kind of answers you expect - form, scope, format.",
      links: "External links (optional, up to 3)",
      linkPlaceholder: "https://…",
      addLink: "Add link",
      removeLink: "Remove link",
    },
    validation: {
      subject: "Subject must be between 5 and 140 characters.",
      reason: "Reason must be between 20 and 2000 characters.",
      question: "Each question must be between 5 and 500 characters.",
      link: "Each link must start with http(s)://.",
      questionsMax: "You may include up to 5 questions.",
      linksMax: "You may include up to 3 links.",
    },
    submit: "Send request",
    cancel: "Cancel",
    sending: "Sending…",
    sentToast: "Expert request sent. You will be notified about the reply.",
    error: {
      rateLimit: "You have sent too many requests in a short period.",
      monthlyQuota:
        "You have used your monthly expert request quota. Upgrade to reach more experts or VIPs.",
      notExpert: "This user does not require a request - send a normal DM instead.",
      tierDisabled:
        "Your tier does not include expert requests. Upgrade your plan (Plus, Pro or VIP).",
      recipientDisabled: "This expert has paused incoming requests. Please try again later.",
      featureDisabled: "Expert requests are switched off for this organisation.",
      notAvailable: "This recipient is not available in your workspace.",
      invalidTransition: "This request has already been resolved - refresh the list.",
      notFound: "Request not found - it may have been removed.",
      forbidden: "You do not have permission for this action.",
      generic: "Could not send. Please try again.",
    },
    status: {
      pending: "Pending",
      approved: "Approved",
      declined: "Declined",
      answered: "Answered",
      cancelled: "Cancelled",
    },
    box: {
      sent: "Sent",
      received: "Received",
      empty: "This inbox is empty.",
    },
    inbox: {
      tab: "Requests",
      title: "Form requests",
      empty: "No requests yet. When someone submits a request to you, it shows up here.",
      more: "Show details",
      less: "Hide details",
      questions: "Questions",
      reply: "Reply in chat",
      openedToast: "Conversation opened - reply in chat.",
    },
    actions: {
      approve: "Open conversation",
      decline: "Decline",
      answered: "Mark as answered",
      cancel: "Withdraw",
      openConversation: "Open conversation",
      noteLabel: "Note (optional)",
      declineReasonLabel: "Decline reason (optional)",
      confirm: "Confirm",
    },
    confirmCancel: {
      title: "Withdraw this request?",
      description:
        "The expert will no longer see it as pending. Withdrawing does NOT refund your quota - the request still counts towards this month's limit.",
      confirm: "Withdraw request",
      keep: "Keep it",
      doneToast: "Request withdrawn.",
    },
    admin: {
      title: "Expert requests",
      subtitle:
        "Formal requests from users to experts. Approve to open a direct conversation; decline to end the request with a reason.",
      filter: "Status",
      filterAll: "All",
      countTotal: "Total: {{count}}",
    },
    profile: {
      title: "Expert requests",
      subtitle: "Formal requests - sent and received from experts.",
    },
    chatGate: {
      tierDisabledToast: "Your tier does not allow starting a conversation. Upgrade your plan.",
      requestOpened: "Opening the expert request dialog - please write to the expert formally.",
      openPricing: "See plans",
    },
  },
};

i18n.addResourceBundle("pl", "translation", expertRequestPl, true, true);
i18n.addResourceBundle("en", "translation", expertRequestEn, true, true);

/** No-op - side-effect import registers the bundle. */
export function ensureI18n(): void {}
