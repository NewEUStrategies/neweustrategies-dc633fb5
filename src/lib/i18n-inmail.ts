// Supplementary i18n bundle dla systemu inMail (Plus → Ekspert).
// Rejestracja przy pierwszym imporcie modułu (patrz InMailDialogHost).
import i18n from "./i18n";

export const inmailPl = {
  inmail: {
    dialogTitle: "Wyślij wiadomość do eksperta",
    dialogSubtitle:
      "Twój plan Plus nie pozwala pisać bezpośrednio do ekspertów. Prześlij formalne zapytanie - ekspert (lub redakcja) zdecyduje, czy otworzyć rozmowę.",
    upgradeCta: "Zobacz plan Pro (bezpośrednia rozmowa z ekspertami)",
    recipientLabel: "Odbiorca",
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
    submit: "Wyślij inMail",
    cancel: "Anuluj",
    sending: "Wysyłam…",
    sentToast: "InMail wysłany. Poinformujemy Cię o odpowiedzi.",
    error: {
      rateLimit: "Wysłałeś już maksymalną liczbę zapytań do tego eksperta w ciągu ostatnich 24 h.",
      notExpert: "Ten użytkownik nie jest ekspertem - napisz do niego bezpośrednio z listy kontaktów.",
      tierDisabled: "Twoja warstwa nie umożliwia wysyłania wiadomości. Zaktualizuj plan, aby pisać w ekosystemie.",
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
    admin: {
      title: "InMaile do ekspertów",
      subtitle:
        "Sformalizowane zapytania od użytkowników Plus do ekspertów. Zatwierdź - powstaje bezpośrednia konwersacja; odrzuć - zapytanie kończy się z powodem.",
      filter: "Status",
      filterAll: "Wszystkie",
      countTotal: "Łącznie: {{count}}",
    },
    profile: {
      title: "InMaile",
      subtitle: "Sformalizowane zapytania - wysłane i otrzymane od ekspertów.",
    },
    chatGate: {
      tierDisabledToast: "Twoja warstwa nie pozwala rozpocząć rozmowy. Zaktualizuj plan.",
      inmailOpened: "Otwieramy okno inMail - napisz formalnie do eksperta.",
      openPricing: "Zobacz plany",
    },
  },
};

export const inmailEn = {
  inmail: {
    dialogTitle: "Send a message to an expert",
    dialogSubtitle:
      "Your Plus plan does not include direct chat with experts. Send a formal inMail - the expert (or the editorial team) will decide whether to open a conversation.",
    upgradeCta: "See the Pro plan (direct chat with experts)",
    recipientLabel: "Recipient",
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
    submit: "Send inMail",
    cancel: "Cancel",
    sending: "Sending…",
    sentToast: "InMail sent. You will be notified about the reply.",
    error: {
      rateLimit: "You have already sent the maximum number of requests to this expert in the last 24 h.",
      notExpert: "This user is not an expert - send a normal DM instead.",
      tierDisabled: "Your tier does not include messaging. Upgrade your plan to chat within the ecosystem.",
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
    actions: {
      approve: "Open conversation",
      decline: "Decline",
      answered: "Mark as answered",
      cancel: "Cancel",
      openConversation: "Open conversation",
      noteLabel: "Note (optional)",
      declineReasonLabel: "Decline reason (optional)",
      confirm: "Confirm",
    },
    admin: {
      title: "Expert inMails",
      subtitle:
        "Formal requests from Plus users to experts. Approve to open a direct conversation; decline to end the request with a reason.",
      filter: "Status",
      filterAll: "All",
      countTotal: "Total: {{count}}",
    },
    profile: {
      title: "InMails",
      subtitle: "Formal requests - sent and received from experts.",
    },
    chatGate: {
      tierDisabledToast: "Your tier does not allow starting a conversation. Upgrade your plan.",
      inmailOpened: "Opening the inMail dialog - please write to the expert formally.",
      openPricing: "See plans",
    },
  },
};

i18n.addResourceBundle("pl", "translation", inmailPl, true, true);
i18n.addResourceBundle("en", "translation", inmailEn, true, true);

/** No-op - side-effect import registers the bundle. */
export function ensureI18n(): void {}
