// Publiczny regulamin świadczenia usług. Treść statyczna w kodzie - dostępna
// bez logowania i wymagana przez Paddle (Merchant of Record). URL: /regulamin.
import { createFileRoute } from "@tanstack/react-router";
import {
  Building2,
  FileCheck2,
  Ban,
  Copyright,
  Activity,
  CreditCard,
  Store,
  RotateCcw,
  ShieldAlert,
  Scale,
  Mail,
} from "lucide-react";
import { LegalPage, type LegalSection } from "@/components/legal/LegalPage";
import { activeLang } from "@/lib/seo/head";
import { getRequestUrl } from "@/lib/seo/request";
import { buildContentHead } from "@/lib/seo/meta";
import { staticPageSeoQueryOptions, pickStaticSeo } from "@/lib/queries/staticPageSeo";
import {
  LEGAL_CONTACT_EMAIL,
  LEGAL_ENTITY,
  LEGAL_UPDATED,
  PADDLE_BUYER_TERMS_URL,
  PADDLE_MOR_DISCLOSURE,
  PADDLE_SUPPORT_URL,
  REFUND_WINDOW_DAYS,
} from "@/lib/legal/entity";

const COPY = {
  pl: {
    eyebrow: "Warunki",
    title: "Regulamin serwisu",
    lead: `Warunki korzystania z serwisu neweuropeanstrategies.com prowadzonego przez ${LEGAL_ENTITY} - zakres usług, płatności, prawa i obowiązki stron.`,
    updated: `Ostatnia aktualizacja: ${LEGAL_UPDATED}`,
    footnote: `Regulamin prowadzi ${LEGAL_ENTITY}. O istotnych zmianach informujemy z wyprzedzeniem na tej stronie oraz mailowo dla aktywnych subskrybentów.`,
    sections: [
      {
        id: "uslugodawca",
        Icon: Building2,
        heading: "Usługodawca",
        paragraphs: [
          `Serwis neweuropeanstrategies.com prowadzi ${LEGAL_ENTITY} (dalej: "my", "Usługodawca"). Zawierasz umowę o świadczenie usług drogą elektroniczną właśnie z ${LEGAL_ENTITY}.`,
          `Kontakt: ${LEGAL_CONTACT_EMAIL}.`,
        ],
      },
      {
        id: "akceptacja",
        Icon: FileCheck2,
        heading: "Akceptacja regulaminu",
        paragraphs: [
          "Korzystanie z Serwisu, założenie konta lub zakup subskrypcji oznacza akceptację niniejszego regulaminu. Jeśli nie akceptujesz jego treści, prosimy o zaprzestanie korzystania z Serwisu.",
          "Oświadczasz, że jesteś osobą pełnoletnią, a jeśli działasz w imieniu organizacji - że masz umocowanie do jej reprezentowania.",
        ],
      },
      {
        id: "uslugi",
        Icon: Activity,
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
        Icon: ShieldAlert,
        heading: "Konto i bezpieczeństwo",
        bullets: [
          "Podajesz prawdziwe dane i aktualizujesz je w razie zmiany.",
          "Odpowiadasz za zachowanie poufności danych logowania oraz za aktywność na swoim koncie.",
          "Niezwłocznie zgłaszasz nam podejrzenie nieuprawnionego dostępu.",
        ],
      },
      {
        id: "zakazy",
        Icon: Ban,
        heading: "Niedozwolone korzystanie",
        bullets: [
          "Działania niezgodne z prawem, oszustwa, spam i nadużycia w komunikacji.",
          "Naruszanie praw własności intelektualnej osób trzecich.",
          "Ingerowanie w bezpieczeństwo Serwisu: złośliwe oprogramowanie, skanowanie podatności, obchodzenie limitów, masowe pobieranie treści (scraping).",
          "Odsprzedaż, redystrybucja lub udostępnianie płatnych treści osobom bez ważnego dostępu.",
        ],
      },
      {
        id: "wlasnosc",
        Icon: Copyright,
        heading: "Własność intelektualna",
        paragraphs: [
          `Serwis, jego oprogramowanie, znaki towarowe, warstwa graficzna oraz publikowane materiały pozostają własnością ${LEGAL_ENTITY} lub naszych licencjodawców. Otrzymujesz ograniczoną, niewyłączną i nieprzenoszalną licencję na korzystanie z treści w zakresie wykupionego planu i wyłącznie na własny użytek.`,
          "Publikując własne treści (profil, komentarze, materiały) udzielasz nam ograniczonej licencji na ich hosting i przetwarzanie wyłącznie w celu świadczenia usługi.",
        ],
      },
      {
        id: "platnosci",
        Icon: CreditCard,
        heading: "Płatności i subskrypcje",
        bullets: [
          "Subskrypcje odnawiają się automatycznie w wybranym okresie rozliczeniowym do momentu anulowania. Dostępne cykle zależą od planu: dwutygodniowy, miesięczny, kwartalny lub roczny.",
          "Ceny prezentujemy w Serwisie; podatki nalicza i rozlicza Paddle zgodnie z Twoją jurysdykcją.",
          "Subskrypcję możesz anulować w dowolnej chwili w portalu klienta - dostęp zachowujesz do końca opłaconego okresu.",
          "Szczegółowe warunki płatności, rozliczeń i anulowania określa regulamin kupującego Paddle.",
        ],
        paragraphs: [`Warunki kupującego Paddle: ${PADDLE_BUYER_TERMS_URL}.`],
      },
      {
        id: "paddle",
        Icon: Store,
        heading: "Merchant of Record",
        paragraphs: [PADDLE_MOR_DISCLOSURE.pl],
      },
      {
        id: "zwroty",
        Icon: RotateCcw,
        heading: "Zwroty",
        paragraphs: [
          `Obowiązuje gwarancja zwrotu pieniędzy przez ${REFUND_WINDOW_DAYS} dni od zakupu. Szczegóły opisuje nasza polityka zwrotów pod adresem /zwroty-i-reklamacje, a zgłoszenia obsługuje Paddle pod adresem ${PADDLE_SUPPORT_URL}.`,
        ],
      },
      {
        id: "zawieszenie",
        Icon: ShieldAlert,
        heading: "Zawieszenie i rozwiązanie",
        bullets: [
          "Możemy zawiesić lub zamknąć dostęp w przypadku istotnego naruszenia regulaminu, braku płatności, ryzyka bezpieczeństwa lub oszustwa albo powtarzających się naruszeń zasad.",
          "W miarę możliwości informujemy o przyczynie i - jeśli naruszenie da się usunąć - wyznaczamy termin na jego usunięcie.",
          "Konto możesz usunąć samodzielnie w ustawieniach profilu; dane usuwamy zgodnie z polityką prywatności.",
        ],
      },
      {
        id: "odpowiedzialnosc",
        Icon: Scale,
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
        Icon: Mail,
        heading: "Kontakt",
        paragraphs: [
          `Pytania dotyczące regulaminu: ${LEGAL_CONTACT_EMAIL}. Sprawy płatności, faktur i zwrotów obsługuje Paddle: ${PADDLE_SUPPORT_URL}.`,
        ],
      },
    ] satisfies readonly LegalSection[],
  },
  en: {
    eyebrow: "Terms",
    title: "Terms and conditions",
    lead: `Terms of use for neweuropeanstrategies.com operated by ${LEGAL_ENTITY} - scope of the service, payments, rights and obligations.`,
    updated: `Last updated: ${LEGAL_UPDATED}`,
    footnote: `These terms are maintained by ${LEGAL_ENTITY}. Material changes are announced in advance on this page and by email to active subscribers.`,
    sections: [
      {
        id: "uslugodawca",
        Icon: Building2,
        heading: "Who you contract with",
        paragraphs: [
          `neweuropeanstrategies.com is operated by ${LEGAL_ENTITY} ("we", "the Provider"). By using the service you enter into an agreement with ${LEGAL_ENTITY}.`,
          `Contact: ${LEGAL_CONTACT_EMAIL}.`,
        ],
      },
      {
        id: "akceptacja",
        Icon: FileCheck2,
        heading: "Acceptance",
        paragraphs: [
          "Using the service, creating an account or purchasing a subscription means you accept these terms. If you do not accept them, please stop using the service.",
          "You confirm that you are of legal age and, if acting for an organisation, that you are authorised to bind it.",
        ],
      },
      {
        id: "uslugi",
        Icon: Activity,
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
        Icon: ShieldAlert,
        heading: "Account and security",
        bullets: [
          "Provide accurate information and keep it up to date.",
          "Keep your credentials confidential; you are responsible for activity under your account.",
          "Report any suspected unauthorised access to us without delay.",
        ],
      },
      {
        id: "zakazy",
        Icon: Ban,
        heading: "Prohibited use",
        bullets: [
          "Unlawful activity, fraud, spam and abusive communication.",
          "Infringing third-party intellectual property rights.",
          "Interfering with the security of the service: malware, vulnerability probing, circumventing limits, bulk scraping.",
          "Reselling, redistributing or sharing paid content with people who have no valid access.",
        ],
      },
      {
        id: "wlasnosc",
        Icon: Copyright,
        heading: "Intellectual property",
        paragraphs: [
          `The service, its software, trade marks, design and published materials remain the property of ${LEGAL_ENTITY} or our licensors. You receive a limited, non-exclusive, non-transferable licence to use the content within your plan and for your own use only.`,
          "By publishing your own content (profile, comments, materials) you grant us a limited licence to host and process it solely to provide the service.",
        ],
      },
      {
        id: "platnosci",
        Icon: CreditCard,
        heading: "Payments and subscriptions",
        bullets: [
          "Subscriptions renew automatically for the selected billing period until cancelled. Available cycles depend on the plan: every 2 weeks, monthly, quarterly or yearly.",
          "Prices are shown in the service; taxes are calculated and remitted by Paddle for your jurisdiction.",
          "You can cancel at any time in the customer portal - access continues until the end of the paid period.",
          "Detailed payment, billing and cancellation mechanics are governed by the Paddle buyer terms.",
        ],
        paragraphs: [`Paddle buyer terms: ${PADDLE_BUYER_TERMS_URL}.`],
      },
      {
        id: "paddle",
        Icon: Store,
        heading: "Merchant of Record",
        paragraphs: [PADDLE_MOR_DISCLOSURE.en],
      },
      {
        id: "zwroty",
        Icon: RotateCcw,
        heading: "Refunds",
        paragraphs: [
          `We offer a ${REFUND_WINDOW_DAYS}-day money-back guarantee. Details are in our refund policy at /zwroty-i-reklamacje and requests are handled by Paddle at ${PADDLE_SUPPORT_URL}.`,
        ],
      },
      {
        id: "zawieszenie",
        Icon: ShieldAlert,
        heading: "Suspension and termination",
        bullets: [
          "We may suspend or terminate access for material breach, non-payment, security or fraud risk, or repeated policy violations.",
          "Where possible we tell you the reason and, if the breach is curable, give you time to fix it.",
          "You can delete your account in profile settings; data is removed in line with the privacy notice.",
        ],
      },
      {
        id: "odpowiedzialnosc",
        Icon: Scale,
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
        Icon: Mail,
        heading: "Contact",
        paragraphs: [
          `Questions about these terms: ${LEGAL_CONTACT_EMAIL}. Payments, invoices and refunds are handled by Paddle: ${PADDLE_SUPPORT_URL}.`,
        ],
      },
    ] satisfies readonly LegalSection[],
  },
} as const;

export const Route = createFileRoute("/regulamin")({
  component: TermsPage,
  loader: async ({ context }) => {
    const seo = await context.queryClient
      .ensureQueryData(staticPageSeoQueryOptions("regulamin"))
      .catch(() => null);
    return { seo };
  },
  head: ({ loaderData }) => {
    const url = getRequestUrl() || "/regulamin";
    const lang = activeLang(url);
    const c = COPY[lang];
    const seo = pickStaticSeo(loaderData?.seo ?? null, lang, {
      title: `${c.title} - ${LEGAL_ENTITY}`,
      description: c.lead,
    });
    return buildContentHead({
      url,
      lang,
      type: "website",
      title: seo.title,
      description: seo.description,
      image: seo.image ?? undefined,
      robots: seo.noindex ? "noindex,nofollow" : undefined,
      canonicalOverride: seo.canonical ?? undefined,
    });
  },
});

function TermsPage() {
  const url = typeof window !== "undefined" ? window.location.pathname : "/regulamin";
  const c = COPY[activeLang(url)];
  return (
    <LegalPage
      eyebrow={c.eyebrow}
      title={c.title}
      lead={c.lead}
      updatedLabel={c.updated}
      sections={c.sections}
      footnote={c.footnote}
    />
  );
}
