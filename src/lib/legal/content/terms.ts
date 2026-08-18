// Serializowalna treść dokumentu prawnego (ikony jako nazwy, nie komponenty).
// Jedno źródło prawdy dla publicznej strony oraz dla wersjonowania w /admin.
import type { LegalDocContent } from "../types";
import { TERMS_META } from "../meta";
import {
  LEGAL_CONTACT_EMAIL,
  LEGAL_ENTITY,
  LEGAL_UPDATED,
  PAYMENT_PROVIDER_BUYER_TERMS_URL,
  PAYMENT_PROVIDER_DISCLOSURE,
  PAYMENT_PROVIDER_NAME,
  REFUND_WINDOW_DAYS,
} from "@/lib/legal/entity";

export const TERMS_CONTENT: LegalDocContent = {
  pl: {
    eyebrow: "Warunki",
    // Tytuł + lead żyją w ../meta.ts (head() tras czyta je bez pełnej treści).
    ...TERMS_META.pl,
    updated: `Ostatnia aktualizacja: ${LEGAL_UPDATED}`,
    footnote: `Regulamin prowadzi ${LEGAL_ENTITY}. O istotnych zmianach informujemy z wyprzedzeniem na tej stronie oraz mailowo dla aktywnych subskrybentów.`,
    sections: [
      {
        id: "uslugodawca",
        icon: "Building2",
        heading: "Usługodawca",
        paragraphs: [
          `Serwis neweuropeanstrategies.com prowadzi ${LEGAL_ENTITY} (dalej: "my", "Usługodawca"). Zawierasz umowę o świadczenie usług drogą elektroniczną właśnie z ${LEGAL_ENTITY}.`,
          `Kontakt: ${LEGAL_CONTACT_EMAIL}.`,
        ],
      },
      {
        id: "akceptacja",
        icon: "FileCheck2",
        heading: "Akceptacja regulaminu",
        paragraphs: [
          "Korzystanie z Serwisu, założenie konta lub zakup subskrypcji oznacza akceptację niniejszego regulaminu. Jeśli nie akceptujesz jego treści, prosimy o zaprzestanie korzystania z Serwisu.",
          "Oświadczasz, że jesteś osobą pełnoletnią, a jeśli działasz w imieniu organizacji - że masz umocowanie do jej reprezentowania.",
        ],
      },
      {
        id: "uslugi",
        icon: "Activity",
        heading: "Zakres usług",
        bullets: [
          "Dostęp do analiz, wywiadów, policy papers i podcastów - w części bezpłatnie, w części w ramach płatnej subskrypcji.",
          "Konto użytkownika wraz z profilem, siecią kontaktów i wiadomościami.",
          "Newsletter oraz powiadomienia o wydarzeniach.",
          "Płatne bilety na wydarzenia. Dobrowolne darowizny wspierające redakcję zbieramy poza Serwisem, w zewnętrznym serwisie zbiórkowym (zrzutka.pl).",
        ],
        paragraphs: [
          "Dokładamy należytej staranności, aby Serwis działał nieprzerwanie, ale nie gwarantujemy działania wolnego od przerw i błędów. Możemy prowadzić prace serwisowe i rozwijać funkcje.",
        ],
      },
      {
        id: "konto",
        icon: "ShieldAlert",
        heading: "Konto i bezpieczeństwo",
        bullets: [
          "Podajesz prawdziwe dane i aktualizujesz je w razie zmiany.",
          "Odpowiadasz za zachowanie poufności danych logowania oraz za aktywność na swoim koncie.",
          "Niezwłocznie zgłaszasz nam podejrzenie nieuprawnionego dostępu.",
        ],
      },
      {
        id: "zakazy",
        icon: "Ban",
        heading: "Zasady dozwolonego korzystania (Acceptable Use Policy)",
        bullets: [
          "Działania niezgodne z prawem, oszustwa, spam i nadużycia w komunikacji.",
          "Naruszanie praw własności intelektualnej osób trzecich.",
          "Ingerowanie w bezpieczeństwo Serwisu: złośliwe oprogramowanie, skanowanie podatności, obchodzenie limitów, masowe pobieranie treści (scraping).",
          "Odsprzedaż, redystrybucja lub udostępnianie płatnych treści osobom bez ważnego dostępu.",
          "Treści zabronione bez wyjątku: materiały dla dorosłych, mowa nienawiści, nawoływanie do przemocy i nękanie, broń i amunicja, narkotyki i substancje kontrolowane, hazard, kryptoaktywa o charakterze spekulacyjnym, piramidy finansowe oraz produkty naruszające prawa autorskie lub znaki towarowe.",
          "Korzystanie z Serwisu wymaga ukończenia 18 lat albo zgody opiekuna prawnego; konto może założyć wyłącznie osoba działająca we własnym imieniu lub w imieniu reprezentowanej firmy.",
          "Naruszenia zgłaszasz na kontakt@neweuropeanstrategies.com - rozpatrujemy je bez zbędnej zwłoki, nie później niż w 14 dni.",
          "Naruszenie tych zasad uprawnia nas do ograniczenia funkcji, zawieszenia albo rozwiązania umowy ze skutkiem natychmiastowym; opłata za niewykorzystany okres jest wtedy zwracana proporcjonalnie, chyba że naruszenie miało charakter oszustwa.",
        ],
      },
      {
        id: "wlasnosc",
        icon: "Copyright",
        heading: "Własność intelektualna",
        paragraphs: [
          `Serwis, jego oprogramowanie, znaki towarowe, warstwa graficzna oraz publikowane materiały pozostają własnością ${LEGAL_ENTITY} lub naszych licencjodawców. Otrzymujesz ograniczoną, niewyłączną i nieprzenoszalną licencję na korzystanie z treści w zakresie wykupionego planu i wyłącznie na własny użytek.`,
          "Publikując własne treści (profil, komentarze, materiały) udzielasz nam ograniczonej licencji na ich hosting i przetwarzanie wyłącznie w celu świadczenia usługi.",
        ],
      },
      {
        id: "platnosci",
        icon: "CreditCard",
        heading: "Płatności i subskrypcje",
        bullets: [
          "Subskrypcje odnawiają się automatycznie w wybranym okresie rozliczeniowym do momentu anulowania.",
          `Ceny prezentujemy w Serwisie; podatek od sprzedaży nalicza, pobiera i rozlicza nasz operator płatności, ${PAYMENT_PROVIDER_NAME}, zgodnie z Twoją jurysdykcją.`,
          "Subskrypcję możesz anulować w dowolnej chwili w portalu klienta - dostęp zachowujesz do końca opłaconego okresu.",
          `Szczegółowe warunki płatności, rozliczeń i anulowania określa regulamin kupującego ${PAYMENT_PROVIDER_NAME}/Link.`,
        ],
        paragraphs: [
          `Warunki kupującego ${PAYMENT_PROVIDER_NAME}: ${PAYMENT_PROVIDER_BUYER_TERMS_URL}.`,
        ],
      },
      {
        id: "payment-provider",
        icon: "Store",
        heading: "Sprzedawca i operator płatności",
        paragraphs: [PAYMENT_PROVIDER_DISCLOSURE.pl],
      },
      {
        id: "zwroty",
        icon: "RotateCcw",
        heading: "Zwroty",
        paragraphs: [
          `Obowiązuje gwarancja zwrotu pieniędzy przez ${REFUND_WINDOW_DAYS} dni od zakupu. Szczegóły opisuje nasza polityka zwrotów pod adresem /zwroty-i-reklamacje - zgłoszenie przyjmujemy pod adresem ${LEGAL_CONTACT_EMAIL}, a rozliczenie zwrotu realizuje nasz operator płatności.`,
        ],
      },
      {
        id: "zawieszenie",
        icon: "ShieldAlert",
        heading: "Zawieszenie i rozwiązanie",
        bullets: [
          "Możemy zawiesić lub zamknąć dostęp w przypadku istotnego naruszenia regulaminu, braku płatności, ryzyka bezpieczeństwa lub oszustwa albo powtarzających się naruszeń zasad.",
          "W miarę możliwości informujemy o przyczynie i - jeśli naruszenie da się usunąć - wyznaczamy termin na jego usunięcie.",
          "Konto możesz usunąć samodzielnie w ustawieniach profilu; dane usuwamy zgodnie z polityką prywatności.",
        ],
      },
      {
        id: "odpowiedzialnosc",
        icon: "Scale",
        heading: "Odpowiedzialność i prawo właściwe",
        bullets: [
          "W zakresie dozwolonym prawem wyłączamy odpowiedzialność za szkody pośrednie, utracone korzyści, utratę danych lub reputacji.",
          "Nasza łączna odpowiedzialność jest ograniczona do kwoty opłat wniesionych przez Ciebie w ciągu 12 miesięcy poprzedzających zdarzenie.",
          "Nie ograniczamy odpowiedzialności w zakresie, w jakim nie jest to dopuszczalne prawem, w tym za winę umyślną oraz szkody na osobie.",
          "Regulamin podlega prawu polskiemu; nie wyłącza to bezwzględnie obowiązujących praw konsumenta z kraju zamieszkania.",
        ],
      },
      {
        id: "kontakt",
        icon: "Mail",
        heading: "Kontakt",
        paragraphs: [
          `Pytania dotyczące regulaminu, płatności, faktur i zwrotów: ${LEGAL_CONTACT_EMAIL}. Techniczną obsługę transakcji i podatków zapewnia nasz operator płatności, ${PAYMENT_PROVIDER_NAME}.`,
        ],
      },
    ],
  },
  en: {
    eyebrow: "Terms",
    ...TERMS_META.en,
    updated: `Last updated: ${LEGAL_UPDATED}`,
    footnote: `These terms are maintained by ${LEGAL_ENTITY}. Material changes are announced in advance on this page and by email to active subscribers.`,
    sections: [
      {
        id: "uslugodawca",
        icon: "Building2",
        heading: "Who you contract with",
        paragraphs: [
          `neweuropeanstrategies.com is operated by ${LEGAL_ENTITY} ("we", "the Provider"). By using the service you enter into an agreement with ${LEGAL_ENTITY}.`,
          `Contact: ${LEGAL_CONTACT_EMAIL}.`,
        ],
      },
      {
        id: "akceptacja",
        icon: "FileCheck2",
        heading: "Acceptance",
        paragraphs: [
          "Using the service, creating an account or purchasing a subscription means you accept these terms. If you do not accept them, please stop using the service.",
          "You confirm that you are of legal age and, if acting for an organisation, that you are authorised to bind it.",
        ],
      },
      {
        id: "uslugi",
        icon: "Activity",
        heading: "What we provide",
        bullets: [
          "Access to analyses, interviews, policy papers and podcasts - partly free, partly under a paid subscription.",
          "A user account with a profile, professional connections and messaging.",
          "Newsletter and event notifications.",
          "Paid event tickets. Voluntary donations supporting the editorial team are collected outside the service, via an external fundraising platform (zrzutka.pl).",
        ],
        paragraphs: [
          "We take due care to keep the service available, but we do not guarantee uninterrupted or error-free performance. We may run maintenance and change features.",
        ],
      },
      {
        id: "konto",
        icon: "ShieldAlert",
        heading: "Account and security",
        bullets: [
          "Provide accurate information and keep it up to date.",
          "Keep your credentials confidential; you are responsible for activity under your account.",
          "Report any suspected unauthorised access to us without delay.",
        ],
      },
      {
        id: "zakazy",
        icon: "Ban",
        heading: "Acceptable Use Policy",
        bullets: [
          "Unlawful activity, fraud, spam and abusive communication.",
          "Infringing third-party intellectual property rights.",
          "Interfering with the security of the service: malware, vulnerability probing, circumventing limits, bulk scraping.",
          "Reselling, redistributing or sharing paid content with people who have no valid access.",
          "Categorically prohibited content: adult material, hate speech, incitement to violence and harassment, weapons and ammunition, drugs and controlled substances, gambling, speculative crypto assets, pyramid schemes, and anything infringing copyright or trademarks.",
          "You must be 18 or older (or have guardian consent) and may only register on your own behalf or on behalf of a company you represent.",
          "Report violations to kontakt@neweuropeanstrategies.com - we review reports without undue delay and within 14 days at the latest.",
          "Breaching these rules entitles us to limit features, suspend the account or terminate the agreement with immediate effect; any unused paid period is refunded pro rata unless the breach was fraudulent.",
        ],
      },
      {
        id: "wlasnosc",
        icon: "Copyright",
        heading: "Intellectual property",
        paragraphs: [
          `The service, its software, trade marks, design and published materials remain the property of ${LEGAL_ENTITY} or our licensors. You receive a limited, non-exclusive, non-transferable licence to use the content within your plan and for your own use only.`,
          "By publishing your own content (profile, comments, materials) you grant us a limited licence to host and process it solely to provide the service.",
        ],
      },
      {
        id: "platnosci",
        icon: "CreditCard",
        heading: "Payments and subscriptions",
        bullets: [
          "Subscriptions renew automatically for the selected billing period until cancelled.",
          `Prices are shown in the service; sales tax is calculated, collected and remitted by our payment provider, ${PAYMENT_PROVIDER_NAME}, for your jurisdiction.`,
          "You can cancel at any time in the customer portal - access continues until the end of the paid period.",
          `Detailed payment, billing and cancellation mechanics are governed by the ${PAYMENT_PROVIDER_NAME}/Link buyer terms.`,
        ],
        paragraphs: [`${PAYMENT_PROVIDER_NAME} buyer terms: ${PAYMENT_PROVIDER_BUYER_TERMS_URL}.`],
      },
      {
        id: "payment-provider",
        icon: "Store",
        heading: "Seller and payment provider",
        paragraphs: [PAYMENT_PROVIDER_DISCLOSURE.en],
      },
      {
        id: "zwroty",
        icon: "RotateCcw",
        heading: "Refunds",
        paragraphs: [
          `We offer a ${REFUND_WINDOW_DAYS}-day money-back guarantee. Details are in our refund policy at /zwroty-i-reklamacje - submit requests to ${LEGAL_CONTACT_EMAIL} and the refund itself is processed by our payment provider.`,
        ],
      },
      {
        id: "zawieszenie",
        icon: "ShieldAlert",
        heading: "Suspension and termination",
        bullets: [
          "We may suspend or terminate access for material breach, non-payment, security or fraud risk, or repeated policy violations.",
          "Where possible we tell you the reason and, if the breach is curable, give you time to fix it.",
          "You can delete your account in profile settings; data is removed in line with the privacy notice.",
        ],
      },
      {
        id: "odpowiedzialnosc",
        icon: "Scale",
        heading: "Liability and governing law",
        bullets: [
          "To the extent permitted by law we exclude liability for indirect or consequential damages, lost profits, data or goodwill.",
          "Our aggregate liability is capped at the fees you paid in the 12 months preceding the event.",
          "Nothing limits liability where the law does not allow it, including wilful misconduct and personal injury.",
          "These terms are governed by Polish law; this does not affect mandatory consumer rights in your country of residence.",
        ],
      },
      {
        id: "kontakt",
        icon: "Mail",
        heading: "Contact",
        paragraphs: [
          `Questions about these terms, payments, invoices and refunds: ${LEGAL_CONTACT_EMAIL}. Technical processing of transactions and taxes is provided by our payment provider, ${PAYMENT_PROVIDER_NAME}.`,
        ],
      },
    ],
  },
};
