// Supplementary i18n bundle dla systemu „Zapytanie do eksperta" (dawniej inMail).
// Rejestracja przy pierwszym imporcie modułu (patrz InMailDialogHost).
import i18n from "./i18n";

export const inmailPl = {
  inmail: {
    dialogTitle: "Wyślij zapytanie do eksperta lub VIP-a",
    dialogSubtitle:
      "Twoja warstwa korzysta z zapytań do ekspertów: Plus - 2 miesięcznie, Pro - 5 miesięcznie. Prześlij formalne zapytanie - jeśli odbiorca zaakceptuje, otworzymy stałą konwersację.",
    upgradeCta: "Zobacz plan VIP (bezpośrednia rozmowa z ekspertami i VIP-ami)",
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
    submit: "Wyślij zapytanie",
    cancel: "Anuluj",
    sending: "Wysyłam…",
    sentToast: "Zapytanie wysłane. Poinformujemy Cię o odpowiedzi.",
    error: {
      rateLimit: "Wysłałeś już maksymalną liczbę zapytań w krótkim czasie.",
      monthlyQuota: "Wyczerpałeś miesięczną pulę zapytań do ekspertów. Plus: 2/mies., Pro: 5/mies. Zwiększ plan, aby napisać do kolejnych ekspertów lub VIP-ów.",
      notExpert: "Ten użytkownik nie wymaga zapytania - napisz do niego bezpośrednio z listy kontaktów.",
      tierDisabled: "Twoja warstwa nie umożliwia wysyłania zapytań do ekspertów. Zaktualizuj plan (Plus - 2/mies., Pro - 5/mies., VIP - bezpośrednio).",
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
      title: "Zapytania do ekspertów",
      subtitle:
        "Sformalizowane zapytania od użytkowników Plus do ekspertów. Zatwierdź - powstaje bezpośrednia konwersacja; odrzuć - zapytanie kończy się z powodem.",
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
      inmailOpened: "Otwieramy okno zapytania - napisz formalnie do eksperta.",
      openPricing: "Zobacz plany",
    },
  },
};

export const inmailEn = {
  inmail: {
    dialogTitle: "Send an Expert Request to an expert or VIP",
    dialogSubtitle:
      "Your tier uses Expert Requests: Plus - 2 per month, Pro - 5 per month. Send a formal request - if the recipient approves, we open an ongoing conversation.",
    upgradeCta: "See the VIP plan (direct chat with experts and VIPs)",
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
    submit: "Send request",
    cancel: "Cancel",
    sending: "Sending…",
    sentToast: "Expert Request sent. You will be notified about the reply.",
    error: {
      rateLimit: "You have sent too many requests in a short period.",
      monthlyQuota: "You have used your monthly Expert Request quota. Plus: 2/mo, Pro: 5/mo. Upgrade to reach more experts or VIPs.",
      notExpert: "This user does not require an Expert Request - send a normal DM instead.",
      tierDisabled: "Your tier does not include Expert Requests. Upgrade your plan (Plus - 2/mo, Pro - 5/mo, VIP - direct).",
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
      title: "Expert Requests",
      subtitle:
        "Formal requests from Plus users to experts. Approve to open a direct conversation; decline to end the request with a reason.",
      filter: "Status",
      filterAll: "All",
      countTotal: "Total: {{count}}",
    },
    profile: {
      title: "Expert Requests",
      subtitle: "Formal requests - sent and received from experts.",
    },
    chatGate: {
      tierDisabledToast: "Your tier does not allow starting a conversation. Upgrade your plan.",
      inmailOpened: "Opening the Expert Request dialog - please write to the expert formally.",
      openPricing: "See plans",
    },
  },
};

i18n.addResourceBundle("pl", "translation", inmailPl, true, true);
i18n.addResourceBundle("en", "translation", inmailEn, true, true);

/** No-op - side-effect import registers the bundle. */
export function ensureI18n(): void {}
