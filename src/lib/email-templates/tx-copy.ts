import type { EmailIconName } from "./icons";
import type { EmailLang } from "./nes-layout";

/**
 * Treści maili transakcyjnych (subskrypcje, wydarzenia, newsletter) w PL i EN.
 * Jedno źródło prawdy dla szablonów (body) i sendera (subject/preheader).
 */

export type TxEmailType =
  | "subscription_confirmed"
  | "subscription_renewed"
  | "subscription_canceled"
  | "subscription_upgraded"
  | "subscription_downgraded"
  | "event_registered"
  | "newsletter_confirmed";

export interface TxSubjectVars {
  /** Nazwa planu subskrypcji lub tytuł wydarzenia. */
  subject?: string | null;
}

export interface TxCopy {
  subject: (vars: TxSubjectVars) => string;
  icon: EmailIconName;
  preview: string;
  eyebrow: string;
  heading: string;
  intro: string;
  cta: string;
  /** Sekcja "co dalej" pod szczegółami. */
  note: string;
  /** Etykiety wiersza szczegółów. */
  labels: {
    plan: string;
    price: string;
    period: string;
    renewsAt: string;
    endsAt: string;
    event: string;
    date: string;
    place: string;
    previousPlan: string;
    newPlan: string;
  };
  footerHelp: string;
}

type Dict = Record<TxEmailType, TxCopy>;

const LABELS_PL: TxCopy["labels"] = {
  plan: "Plan",
  price: "Kwota",
  period: "Okres rozliczeniowy",
  renewsAt: "Kolejne odnowienie",
  endsAt: "Dostęp do",
  event: "Wydarzenie",
  date: "Termin",
  place: "Miejsce",
  previousPlan: "Dotychczasowy plan",
  newPlan: "Nowy plan",
};

const LABELS_EN: TxCopy["labels"] = {
  plan: "Plan",
  price: "Amount",
  period: "Billing period",
  renewsAt: "Next renewal",
  endsAt: "Access until",
  event: "Event",
  date: "Date",
  place: "Location",
  previousPlan: "Previous plan",
  newPlan: "New plan",
};

const HELP_PL =
  "Masz pytania dotyczące płatności lub dostępu? Napisz do nas - odpowiadamy w dni robocze.";
const HELP_EN = "Questions about billing or access? Write to us - we reply on business days.";

const PL: Dict = {
  subscription_confirmed: {
    subject: (v) =>
      `✅ Subskrypcja aktywna${v.subject ? ` - ${v.subject}` : ""} | New European Strategies`,
    icon: "hero-check",
    preview: "Twoja subskrypcja jest aktywna - pełny dostęp do analiz i danych NES.",
    eyebrow: "Subskrypcja",
    heading: "Twoja subskrypcja jest aktywna",
    intro:
      "Dziękujemy za dołączenie do grona subskrybentów New European Strategies. Płatność została zaksięgowana, a dostęp do materiałów w ramach wybranego planu jest już aktywny.",
    cta: "Przejdź do platformy",
    note: "Fakturę i historię płatności znajdziesz w swoim profilu w zakładce Zamówienia.",
    labels: LABELS_PL,
    footerHelp: HELP_PL,
  },
  subscription_renewed: {
    subject: (v) =>
      `🔄 Subskrypcja przedłużona${v.subject ? ` - ${v.subject}` : ""} | New European Strategies`,
    icon: "hero-check",
    preview: "Subskrypcja została przedłużona na kolejny okres rozliczeniowy.",
    eyebrow: "Odnowienie subskrypcji",
    heading: "Subskrypcja przedłużona",
    intro:
      "Twoja subskrypcja została automatycznie przedłużona na kolejny okres rozliczeniowy. Nie musisz nic robić - dostęp pozostaje nieprzerwany.",
    cta: "Zobacz szczegóły subskrypcji",
    note: "Możesz w każdej chwili zarządzać subskrypcją lub pobrać fakturę w swoim profilu.",
    labels: LABELS_PL,
    footerHelp: HELP_PL,
  },
  subscription_canceled: {
    subject: (v) =>
      `🛑 Subskrypcja anulowana${v.subject ? ` - ${v.subject}` : ""} | New European Strategies`,
    icon: "hero-shield",
    preview: "Potwierdzamy anulowanie subskrypcji - dostęp trwa do końca opłaconego okresu.",
    eyebrow: "Anulowanie subskrypcji",
    heading: "Subskrypcja została anulowana",
    intro:
      "Potwierdzamy anulowanie Twojej subskrypcji. Nie pobierzemy kolejnych płatności, a dostęp do materiałów pozostaje aktywny do końca opłaconego okresu.",
    cta: "Wznów subskrypcję",
    note: "Jeśli anulowanie było pomyłką, możesz wznowić subskrypcję jednym kliknięciem - dane i historia pozostają zachowane.",
    labels: LABELS_PL,
    footerHelp: HELP_PL,
  },
  subscription_upgraded: {
    subject: (v) =>
      `⬆️ Plan podniesiony${v.subject ? ` - ${v.subject}` : ""} | New European Strategies`,
    icon: "hero-handshake",
    preview: "Twój plan subskrypcji został podniesiony - szerszy dostęp działa od razu.",
    eyebrow: "Zmiana planu",
    heading: "Twój plan został podniesiony",
    intro:
      "Zmiana planu została wykonana. Nowy, szerszy zakres dostępu obowiązuje natychmiast, a rozliczenie zostało proporcjonalnie skorygowane przez operatora płatności.",
    cta: "Zobacz nowy zakres dostępu",
    note: "Różnicę w cenie rozliczamy proporcjonalnie do pozostałego okresu rozliczeniowego.",
    labels: LABELS_PL,
    footerHelp: HELP_PL,
  },
  subscription_downgraded: {
    subject: (v) =>
      `⬇️ Plan zmieniony${v.subject ? ` - ${v.subject}` : ""} | New European Strategies`,
    icon: "info",
    preview: "Twój plan subskrypcji został zmieniony na niższy.",
    eyebrow: "Zmiana planu",
    heading: "Twój plan został zmieniony",
    intro:
      "Zmiana planu została zapisana. Zakres dostępu odpowiada nowemu planowi, a kolejne rozliczenie będzie już według niższej stawki.",
    cta: "Zobacz szczegóły planu",
    note: "W każdej chwili możesz wrócić do wyższego planu - dostęp rozszerzy się natychmiast.",
    labels: LABELS_PL,
    footerHelp: HELP_PL,
  },
  event_registered: {
    subject: (v) =>
      `🎟️ Potwierdzenie zapisu${v.subject ? ` - ${v.subject}` : ""} | New European Strategies`,
    icon: "hero-check",
    preview: "Twój udział w wydarzeniu jest potwierdzony.",
    eyebrow: "Wydarzenie",
    heading: "Zapis na wydarzenie potwierdzony",
    intro:
      "Dziękujemy za rejestrację. Twoje miejsce jest zarezerwowane - poniżej znajdziesz najważniejsze szczegóły wydarzenia.",
    cta: "Szczegóły wydarzenia",
    note: "Przypomnienie z linkiem lub instrukcją wejścia wyślemy przed rozpoczęciem wydarzenia.",
    labels: LABELS_PL,
    footerHelp: HELP_PL,
  },
  newsletter_confirmed: {
    subject: () => "📨 Zapis do newslettera potwierdzony | New European Strategies",
    icon: "hero-mail",
    preview: "Jesteś na liście - analizy NES trafią prosto do Twojej skrzynki.",
    eyebrow: "Newsletter",
    heading: "Zapis do newslettera potwierdzony",
    intro:
      "Potwierdzamy zapis do newslettera New European Strategies. Będziesz otrzymywać nasze analizy, dane i komentarze eksperckie prosto na skrzynkę.",
    cta: "Czytaj najnowsze analizy",
    note: "Z newslettera możesz wypisać się w każdej chwili jednym kliknięciem - link znajduje się w stopce każdej wiadomości.",
    labels: LABELS_PL,
    footerHelp: HELP_PL,
  },
};

const EN: Dict = {
  subscription_confirmed: {
    subject: (v) =>
      `✅ Subscription active${v.subject ? ` - ${v.subject}` : ""} | New European Strategies`,
    icon: "hero-check",
    preview: "Your subscription is active - full access to NES analysis and data.",
    eyebrow: "Subscription",
    heading: "Your subscription is active",
    intro:
      "Thank you for subscribing to New European Strategies. Your payment has been recorded and access to the content included in your plan is now active.",
    cta: "Go to the platform",
    note: "Your invoice and payment history are available in your profile under Orders.",
    labels: LABELS_EN,
    footerHelp: HELP_EN,
  },
  subscription_renewed: {
    subject: (v) =>
      `🔄 Subscription renewed${v.subject ? ` - ${v.subject}` : ""} | New European Strategies`,
    icon: "hero-check",
    preview: "Your subscription has been renewed for another billing period.",
    eyebrow: "Subscription renewal",
    heading: "Subscription renewed",
    intro:
      "Your subscription has been renewed automatically for another billing period. No action is needed - your access continues uninterrupted.",
    cta: "View subscription details",
    note: "You can manage your subscription or download the invoice in your profile at any time.",
    labels: LABELS_EN,
    footerHelp: HELP_EN,
  },
  subscription_canceled: {
    subject: (v) =>
      `🛑 Subscription cancelled${v.subject ? ` - ${v.subject}` : ""} | New European Strategies`,
    icon: "hero-shield",
    preview: "Your cancellation is confirmed - access runs until the end of the paid period.",
    eyebrow: "Subscription cancellation",
    heading: "Your subscription has been cancelled",
    intro:
      "We confirm the cancellation of your subscription. No further payments will be taken and your access remains active until the end of the period you already paid for.",
    cta: "Resume subscription",
    note: "If this was a mistake, you can resume the subscription in one click - your data and history are preserved.",
    labels: LABELS_EN,
    footerHelp: HELP_EN,
  },
  subscription_upgraded: {
    subject: (v) =>
      `⬆️ Plan upgraded${v.subject ? ` - ${v.subject}` : ""} | New European Strategies`,
    icon: "hero-handshake",
    preview: "Your subscription plan has been upgraded - wider access is live right away.",
    eyebrow: "Plan change",
    heading: "Your plan has been upgraded",
    intro:
      "The plan change is complete. Your wider access applies immediately and billing has been prorated by the payment provider.",
    cta: "See your new access",
    note: "The price difference is prorated against the remaining part of your billing period.",
    labels: LABELS_EN,
    footerHelp: HELP_EN,
  },
  subscription_downgraded: {
    subject: (v) =>
      `⬇️ Plan changed${v.subject ? ` - ${v.subject}` : ""} | New European Strategies`,
    icon: "info",
    preview: "Your subscription plan has been moved to a lower tier.",
    eyebrow: "Plan change",
    heading: "Your plan has been changed",
    intro:
      "Your plan change has been saved. Access now matches the new plan and the next invoice will use the lower rate.",
    cta: "View plan details",
    note: "You can move back to a higher plan at any time - access expands immediately.",
    labels: LABELS_EN,
    footerHelp: HELP_EN,
  },
  event_registered: {
    subject: (v) =>
      `🎟️ Registration confirmed${v.subject ? ` - ${v.subject}` : ""} | New European Strategies`,
    icon: "hero-check",
    preview: "Your attendance is confirmed.",
    eyebrow: "Event",
    heading: "Your registration is confirmed",
    intro:
      "Thank you for registering. Your seat is reserved - the key details of the event are below.",
    cta: "Event details",
    note: "We will send a reminder with the joining link or entry instructions before the event starts.",
    labels: LABELS_EN,
    footerHelp: HELP_EN,
  },
  newsletter_confirmed: {
    subject: () => "📨 Newsletter subscription confirmed | New European Strategies",
    icon: "hero-mail",
    preview: "You are on the list - NES analysis delivered straight to your inbox.",
    eyebrow: "Newsletter",
    heading: "Newsletter subscription confirmed",
    intro:
      "We confirm your subscription to the New European Strategies newsletter. You will receive our analysis, data and expert commentary directly in your inbox.",
    cta: "Read the latest analysis",
    note: "You can unsubscribe at any time in one click - the link is in the footer of every message.",
    labels: LABELS_EN,
    footerHelp: HELP_EN,
  },
};

const DICTS: Record<EmailLang, Dict> = { pl: PL, en: EN };

export function txCopy(type: TxEmailType, lang: EmailLang): TxCopy {
  return DICTS[lang][type];
}

export function txSubject(type: TxEmailType, lang: EmailLang, vars: TxSubjectVars = {}): string {
  return txCopy(type, lang).subject(vars);
}
