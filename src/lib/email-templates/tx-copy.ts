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
  | "subscription_paused"
  | "subscription_resumed"
  | "payment_failed"
  | "payment_recovered"
  | "payment_refunded"
  | "subscription_renewal_reminder"
  | "subscription_expiring"
  | "team_seat_grace"
  | "team_seat_grace_reminder"
  | "team_seat_access_ended"
  | "event_registered"
  | "donation_received"
  | "newsletter_confirmed"
  | "customer_portal_link"
  | "club_application_accepted"
  | "club_application_rejected"
  | "club_application_more_info";

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
    attemptedAt: string;
    retryAt: string;
    accessUntil: string;
    transaction: string;
    ticketCode: string;
    /** Wiadomość darczyńcy przekazana w formularzu darowizny. */
    donorMessage: string;
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
  attemptedAt: "Próba obciążenia",
  retryAt: "Kolejna próba",
  accessUntil: "Dostęp aktywny do",
  transaction: "Numer transakcji",
  ticketCode: "Numer biletu",
  donorMessage: "Twoja wiadomość",
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
  attemptedAt: "Payment attempt",
  retryAt: "Next attempt",
  accessUntil: "Access active until",
  transaction: "Transaction number",
  ticketCode: "Ticket number",
  donorMessage: "Your message",
};

const HELP_PL =
  "Masz pytania dotyczące płatności lub dostępu? Napisz do nas - odpowiadamy w dni robocze.";
const HELP_EN = "Questions about billing or access? Write to us - we reply on business days.";

const PL: Dict = {
  customer_portal_link: {
    subject: () => "🔐 Link do portalu płatności | New European Strategies",
    icon: "hero-key",
    preview: "Jedno kliknięcie do faktur, metody płatności i zarządzania subskrypcją.",
    eyebrow: "Portal płatności",
    heading: "Twój link do portalu płatności",
    intro:
      "Przyciskiem poniżej otworzysz bezpieczny portal płatności. Pobierzesz w nim faktury, zmienisz metodę płatności oraz zarządzisz subskrypcją lub ją anulujesz.",
    cta: "Otwórz portal płatności",
    note: "Link jest jednorazowy i wygasa po krótkim czasie. Jeśli przestanie działać, poproś o nowy w swoim profilu.",
    labels: LABELS_PL,
    footerHelp: HELP_PL,
  },

  subscription_confirmed: {
    subject: (v) =>
      `✅ Subskrypcja aktywna${v.subject ? ` - ${v.subject}` : ""} | New European Strategies`,
    icon: "hero-check",
    preview:
      "Twoja subskrypcja jest aktywna - pełny dostęp do analiz i danych New European Strategies.",
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
  subscription_paused: {
    subject: (v) =>
      `⏸️ Subskrypcja wstrzymana${v.subject ? ` - ${v.subject}` : ""} | New European Strategies`,
    icon: "info",
    preview: "Twoja subskrypcja została wstrzymana - wznowisz ją jednym kliknięciem.",
    eyebrow: "Wstrzymanie subskrypcji",
    heading: "Subskrypcja została wstrzymana",
    intro:
      "Zgodnie z dyspozycją wstrzymaliśmy Twoją subskrypcję. W czasie pauzy nie pobieramy płatności, a Twoje dane, historia i zapisane materiały pozostają nienaruszone.",
    cta: "Wznów subskrypcję",
    note: "Subskrypcję możesz wznowić w dowolnym momencie - dostęp premium wraca natychmiast.",
    labels: LABELS_PL,
    footerHelp: HELP_PL,
  },
  subscription_resumed: {
    subject: (v) =>
      `▶️ Subskrypcja wznowiona${v.subject ? ` - ${v.subject}` : ""} | New European Strategies`,
    icon: "hero-handshake",
    preview: "Twoja subskrypcja znów działa - pełny dostęp premium jest aktywny.",
    eyebrow: "Wznowienie subskrypcji",
    heading: "Subskrypcja została wznowiona",
    intro:
      "Twoja subskrypcja została wznowiona, a pełny dostęp do materiałów premium jest już aktywny. Kolejne rozliczenie odbędzie się w standardowym cyklu.",
    cta: "Przejdź do subskrypcji",
    note: "Jeśli to nie Ty wznowiłeś subskrypcję, skontaktuj się z nami natychmiast.",
    labels: LABELS_PL,
    footerHelp: HELP_PL,
  },
  payment_failed: {
    subject: (v) =>
      `⚠️ Płatność nie powiodła się${v.subject ? ` - ${v.subject}` : ""} | New European Strategies`,
    icon: "hero-shield",
    preview: "Nie udało się pobrać płatności za subskrypcję - zaktualizuj metodę płatności.",
    eyebrow: "Płatność",
    heading: "Nie udało się pobrać płatności",
    intro:
      "Operator płatności nie zdołał obciążyć zapisanej metody płatności. Dostęp pozostaje aktywny, a my ponowimy próbę automatycznie. Najszybszym rozwiązaniem jest aktualizacja karty w panelu subskrypcji.",
    cta: "Zaktualizuj metodę płatności",
    note: "Jeśli kolejne próby również się nie powiodą, subskrypcja zostanie wstrzymana po zakończeniu opłaconego okresu.",
    labels: LABELS_PL,
    footerHelp: HELP_PL,
  },
  payment_refunded: {
    subject: (v) =>
      `↩️ Zwrot płatności${v.subject ? ` - ${v.subject}` : ""} | New European Strategies`,
    icon: "info",
    preview: "Zwróciliśmy płatność - poniżej szczegóły rozliczenia.",
    eyebrow: "Zwrot",
    heading: "Płatność została zwrócona",
    intro:
      "Potwierdzamy zwrot płatności. Środki wracają na tę samą metodę płatności, którą zrealizowano zakup - w zależności od banku księgowanie zajmuje zwykle od 3 do 10 dni roboczych.",
    cta: "Zobacz historię płatności",
    note: "Dostęp powiązany ze zwróconą płatnością został zakończony. Jeśli zwrot jest pomyłką, napisz do nas - przywrócimy dostęp od ręki.",
    labels: LABELS_PL,
    footerHelp: HELP_PL,
  },
  payment_recovered: {
    subject: (v) =>
      `✅ Płatność zaksięgowana${v.subject ? ` - ${v.subject}` : ""} | New European Strategies`,
    icon: "hero-check",
    preview: "Zaległa płatność została rozliczona - subskrypcja działa normalnie.",
    eyebrow: "Płatność",
    heading: "Płatność została zaksięgowana",
    intro:
      "Dziękujemy - zaległa płatność została rozliczona, a Twoja subskrypcja wróciła do normalnego trybu. Nie musisz podejmować żadnych działań.",
    cta: "Zobacz szczegóły subskrypcji",
    note: "Fakturę za rozliczony okres znajdziesz w profilu w zakładce Zamówienia.",
    labels: LABELS_PL,
    footerHelp: HELP_PL,
  },
  subscription_renewal_reminder: {
    subject: (v) =>
      `🗓️ Zbliża się odnowienie${v.subject ? ` - ${v.subject}` : ""} | New European Strategies`,
    icon: "info",
    preview: "Twoja subskrypcja odnowi się wkrótce - poniżej szczegóły.",
    eyebrow: "Przypomnienie",
    heading: "Zbliża się odnowienie subskrypcji",
    intro:
      "Przypominamy, że Twoja subskrypcja odnowi się automatycznie w podanym niżej terminie. Jeśli chcesz ją kontynuować, nie musisz nic robić.",
    cta: "Zarządzaj subskrypcją",
    note: "Zmiany planu lub rezygnacji możesz dokonać w profilu przed datą odnowienia.",
    labels: LABELS_PL,
    footerHelp: HELP_PL,
  },
  subscription_expiring: {
    subject: (v) =>
      `⏳ Dostęp wkrótce wygasa${v.subject ? ` - ${v.subject}` : ""} | New European Strategies`,
    icon: "hero-shield",
    preview: "Anulowana subskrypcja wkrótce się kończy - możesz ją wznowić.",
    eyebrow: "Przypomnienie",
    heading: "Twój dostęp wkrótce wygasa",
    intro:
      "Twoja subskrypcja została anulowana, a dostęp zakończy się w podanym niżej terminie. Wznowienie przed tą datą zachowuje pełną historię i ustawienia.",
    cta: "Wznów subskrypcję",
    note: "Po tej dacie treści płatne pozostaną zamknięte do czasu ponownego wykupienia subskrypcji.",
    labels: LABELS_PL,
    footerHelp: HELP_PL,
  },
  team_seat_grace: {
    subject: (v) =>
      `⏳ Twój dostęp zespołowy kończy się wkrótce${v.subject ? ` - ${v.subject}` : ""} | New European Strategies`,
    icon: "hero-shield",
    preview:
      "Liczba miejsc w zespole została zmniejszona - masz jeszcze dostęp przez okres karencji.",
    eyebrow: "Dostęp zespołowy",
    heading: "Twoje miejsce w zespole wygasa",
    intro:
      "Organizacja zmniejszyła liczbę wykupionych miejsc, dlatego Twoje miejsce zostało objęte okresem karencji. Do podanej niżej daty korzystasz ze wszystkich treści bez zmian.",
    cta: "Sprawdź swój dostęp",
    note: "Co dalej: poproś administratora organizacji o przywrócenie miejsca albo wykup własną subskrypcję przed końcem karencji - historia czytania, zapisane materiały i ustawienia zostają nienaruszone.",
    labels: LABELS_PL,
    footerHelp: HELP_PL,
  },
  team_seat_grace_reminder: {
    subject: (v) =>
      `⏰ Przypomnienie: dostęp zespołowy wygasa${v.subject ? ` - ${v.subject}` : ""} | New European Strategies`,
    icon: "hero-shield",
    preview: "Okres karencji Twojego miejsca w zespole dobiega końca.",
    eyebrow: "Dostęp zespołowy",
    heading: "Przypomnienie o końcu karencji",
    intro:
      "Przypominamy, że okres karencji Twojego miejsca w zespole dobiega końca. Do podanej niżej daty korzystasz ze wszystkich treści bez zmian.",
    cta: "Sprawdź swój dostęp",
    note: "Co dalej: poproś administratora organizacji o przywrócenie miejsca albo wykup własną subskrypcję przed końcem karencji - historia czytania, zapisane materiały i ustawienia zostają nienaruszone.",
    labels: LABELS_PL,
    footerHelp: HELP_PL,
  },
  team_seat_access_ended: {
    subject: (v) =>
      `🔒 Dostęp zespołowy zakończony${v.subject ? ` - ${v.subject}` : ""} | New European Strategies`,
    icon: "hero-shield",
    preview: "Okres karencji minął - miejsce w zespole nie nadaje już dostępu do treści płatnych.",
    eyebrow: "Dostęp zespołowy",
    heading: "Twój dostęp zespołowy został zakończony",
    intro:
      "Okres karencji po zmniejszeniu liczby miejsc w organizacji dobiegł końca, więc Twoje miejsce nie nadaje już dostępu do treści płatnych. Konto pozostaje aktywne, nic nie zostało usunięte.",
    cta: "Zobacz plany dostępu",
    note: "Co dalej: administrator organizacji może w każdej chwili przywrócić Ci miejsce, a Ty możesz wykupić własną subskrypcję - wszystkie zapisane materiały wrócą od razu.",
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
  donation_received: {
    subject: (v) =>
      `❤️ Dziękujemy za darowiznę${v.subject ? ` - ${v.subject}` : ""} | New European Strategies`,
    icon: "hero-check",
    preview: "Twoja darowizna została zaksięgowana - dziękujemy za mecenat.",
    eyebrow: "Mecenat obywatelski",
    heading: "Dziękujemy za Twoją darowiznę",
    intro:
      "Twoja wpłata została zaksięgowana. Dzięki mecenatowi obywatelskiemu utrzymujemy niezależny tracker legislacyjny UE, raporty i debaty - bez zależności od jednego sponsora.",
    cta: "Zobacz nasze analizy",
    note: "Potwierdzenie płatności otrzymasz również od operatora płatności. W razie pytań o darowiznę odpisz na tę wiadomość.",
    labels: LABELS_PL,
    footerHelp: HELP_PL,
  },
  newsletter_confirmed: {
    subject: () => "📨 Zapis do newslettera potwierdzony | New European Strategies",
    icon: "hero-mail",
    preview: "Jesteś na liście - analizy New European Strategies trafią prosto do Twojej skrzynki.",
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
  customer_portal_link: {
    subject: () => "🔐 Your billing portal link | New European Strategies",
    icon: "hero-key",
    preview: "One-click access to invoices, payment method and your subscription.",
    eyebrow: "Billing portal",
    heading: "Your billing portal link",
    intro:
      "Use the button below to open the secure billing portal. You can download invoices, update your payment method and manage or cancel your subscription there.",
    cta: "Open billing portal",
    note: "The link is single-use and expires after a short time. If it stops working, request a new one from your profile.",
    labels: LABELS_EN,
    footerHelp: HELP_EN,
  },

  subscription_confirmed: {
    subject: (v) =>
      `✅ Subscription active${v.subject ? ` - ${v.subject}` : ""} | New European Strategies`,
    icon: "hero-check",
    preview:
      "Your subscription is active - full access to New European Strategies analysis and data.",
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
  subscription_paused: {
    subject: (v) =>
      `⏸️ Subscription paused${v.subject ? ` - ${v.subject}` : ""} | New European Strategies`,
    icon: "info",
    preview: "Your subscription is paused - you can resume it in one click.",
    eyebrow: "Subscription paused",
    heading: "Your subscription has been paused",
    intro:
      "As requested, your subscription is now paused. We take no payments while it is paused, and your data, history and saved material stay exactly as they are.",
    cta: "Resume subscription",
    note: "You can resume at any time - premium access comes back immediately.",
    labels: LABELS_EN,
    footerHelp: HELP_EN,
  },
  subscription_resumed: {
    subject: (v) =>
      `▶️ Subscription resumed${v.subject ? ` - ${v.subject}` : ""} | New European Strategies`,
    icon: "hero-handshake",
    preview: "Your subscription is active again - full premium access is back.",
    eyebrow: "Subscription resumed",
    heading: "Your subscription has been resumed",
    intro:
      "Your subscription is active again and full access to premium material is restored. Billing continues on the regular cycle.",
    cta: "Go to your subscription",
    note: "If you did not resume this subscription, contact us straight away.",
    labels: LABELS_EN,
    footerHelp: HELP_EN,
  },
  payment_failed: {
    subject: (v) =>
      `⚠️ Payment failed${v.subject ? ` - ${v.subject}` : ""} | New European Strategies`,
    icon: "hero-shield",
    preview: "We could not take the payment for your subscription - please update your card.",
    eyebrow: "Payment",
    heading: "We could not take your payment",
    intro:
      "The payment provider could not charge your saved payment method. Your access stays active and we will retry automatically. Updating your card in the subscription panel is the fastest fix.",
    cta: "Update payment method",
    note: "If the following attempts fail as well, the subscription will be paused once the paid period ends.",
    labels: LABELS_EN,
    footerHelp: HELP_EN,
  },
  payment_refunded: {
    subject: (v) =>
      `↩️ Payment refunded${v.subject ? ` - ${v.subject}` : ""} | New European Strategies`,
    icon: "info",
    preview: "Your payment has been refunded - here are the details.",
    eyebrow: "Refund",
    heading: "Your payment has been refunded",
    intro:
      "We are confirming that your payment has been refunded. The funds return to the payment method used for the purchase - depending on your bank this usually takes 3 to 10 working days.",
    cta: "View payment history",
    note: "Access linked to the refunded payment has ended. If this refund was issued in error, reply to this email and we will restore access straight away.",
    labels: LABELS_EN,
    footerHelp: HELP_EN,
  },
  payment_recovered: {
    subject: (v) =>
      `✅ Payment received${v.subject ? ` - ${v.subject}` : ""} | New European Strategies`,
    icon: "hero-check",
    preview: "The outstanding payment cleared - your subscription is back to normal.",
    eyebrow: "Payment",
    heading: "Your payment has been received",
    intro:
      "Thank you - the outstanding payment has cleared and your subscription is back to normal. No further action is needed.",
    cta: "View subscription details",
    note: "The invoice for this period is available in your profile under Orders.",
    labels: LABELS_EN,
    footerHelp: HELP_EN,
  },
  subscription_renewal_reminder: {
    subject: (v) =>
      `🗓️ Upcoming renewal${v.subject ? ` - ${v.subject}` : ""} | New European Strategies`,
    icon: "info",
    preview: "Your subscription renews soon - here are the details.",
    eyebrow: "Reminder",
    heading: "Your subscription renews soon",
    intro:
      "This is a courtesy reminder that your subscription will renew automatically on the date below. No action is needed if you wish to continue.",
    cta: "Manage subscription",
    note: "If you would like to change or cancel your plan, you can do it before the renewal date in your profile.",
    labels: LABELS_EN,
    footerHelp: HELP_EN,
  },
  subscription_expiring: {
    subject: (v) =>
      `⏳ Access ends soon${v.subject ? ` - ${v.subject}` : ""} | New European Strategies`,
    icon: "hero-shield",
    preview: "Your cancelled subscription ends soon - you can resume it at any time.",
    eyebrow: "Reminder",
    heading: "Your access ends soon",
    intro:
      "Your subscription has been cancelled and access will end on the date below. Resuming before that date keeps your history and settings intact.",
    cta: "Resume subscription",
    note: "After the end date, paid content stays locked until you start a new subscription.",
    labels: LABELS_EN,
    footerHelp: HELP_EN,
  },
  team_seat_grace: {
    subject: (v) =>
      `⏳ Your team access ends soon${v.subject ? ` - ${v.subject}` : ""} | New European Strategies`,
    icon: "hero-shield",
    preview: "Your organisation reduced its seats - you keep access during a grace period.",
    eyebrow: "Team access",
    heading: "Your team seat is ending",
    intro:
      "Your organisation reduced the number of paid seats, so your seat has entered a grace period. Until the date below you keep full access to everything, unchanged.",
    cta: "Check your access",
    note: "What happens next: ask your organisation admin to restore the seat, or start your own subscription before the grace period ends - your reading history, saved items and settings stay intact.",
    labels: LABELS_EN,
    footerHelp: HELP_EN,
  },
  team_seat_grace_reminder: {
    subject: (v) =>
      `⏰ Reminder: your team access is ending${v.subject ? ` - ${v.subject}` : ""} | New European Strategies`,
    icon: "hero-shield",
    preview: "The grace period for your team seat is almost over.",
    eyebrow: "Team access",
    heading: "Reminder: your grace period ends soon",
    intro:
      "A quick reminder that the grace period for your team seat is coming to an end. Until the date below you keep full access to everything, unchanged.",
    cta: "Check your access",
    note: "What happens next: ask your organisation admin to restore the seat, or start your own subscription before the grace period ends - your reading history, saved items and settings stay intact.",
    labels: LABELS_EN,
    footerHelp: HELP_EN,
  },
  team_seat_access_ended: {
    subject: (v) =>
      `🔒 Team access ended${v.subject ? ` - ${v.subject}` : ""} | New European Strategies`,
    icon: "hero-shield",
    preview: "The grace period has ended - your team seat no longer unlocks paid content.",
    eyebrow: "Team access",
    heading: "Your team access has ended",
    intro:
      "The grace period after your organisation reduced its seats has ended, so your seat no longer unlocks paid content. Your account stays active and nothing has been deleted.",
    cta: "See access plans",
    note: "What happens next: your organisation admin can restore the seat at any time, or you can start your own subscription - everything you saved comes back immediately.",
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
  donation_received: {
    subject: (v) =>
      `❤️ Thank you for your donation${v.subject ? ` - ${v.subject}` : ""} | New European Strategies`,
    icon: "hero-check",
    preview: "Your donation has been recorded - thank you for your patronage.",
    eyebrow: "Citizen patronage",
    heading: "Thank you for your donation",
    intro:
      "Your contribution has been recorded. Citizen patronage keeps our EU legislative tracker, reports and debates independent - never tied to a single sponsor.",
    cta: "Read our analysis",
    note: "You will also receive a payment receipt from our payment provider. Reply to this message with any questions about your donation.",
    labels: LABELS_EN,
    footerHelp: HELP_EN,
  },
  newsletter_confirmed: {
    subject: () => "📨 Newsletter subscription confirmed | New European Strategies",
    icon: "hero-mail",
    preview:
      "You are on the list - New European Strategies analysis delivered straight to your inbox.",
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

/**
 * Wszystkie typy maila transakcyjnego - JEDNA lista wyprowadzona ze słownika
 * treści, więc nie da się dodać typu bez treści ani treści bez typu. Konsumenci:
 * polityka listy wykluczeń (kategoria per typ) i testy pokrycia.
 */
export const TX_EMAIL_TYPES = Object.keys(PL) as readonly TxEmailType[];

export function txCopy(type: TxEmailType, lang: EmailLang): TxCopy {
  return DICTS[lang][type];
}

export function txSubject(type: TxEmailType, lang: EmailLang, vars: TxSubjectVars = {}): string {
  return txCopy(type, lang).subject(vars);
}
