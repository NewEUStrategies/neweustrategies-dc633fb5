import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Copy,
  Facebook,
  Linkedin,
  Mail,
  MessageCircle,
  Share2,
} from "lucide-react";
import { toast } from "sonner";
import { ReadingHeader } from "@/components/share/ReadingHeader";
import { Footer } from "@/components/Footer";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { BrandIcon } from "@/components/atoms/BrandIcon";
import {
  QuizBackground,
  QUIZ_BG_PRELOAD_LINKS,
  QUIZ_BG_PRELOAD_SCRIPT,
} from "@/components/quiz/QuizBackground";
import { LazyQuizIframe } from "@/components/quiz/LazyQuizIframe";
import { activeLang } from "@/lib/seo/head";
import { getOrigin, getRequestUrl } from "@/lib/seo/request";
import { buildContentHead, splitUrl, SITE_NAME, SITE_CANONICAL_ORIGIN } from "@/lib/seo/meta";
import { platformLandingJsonLd, safeJsonLd } from "@/lib/seo/jsonld";
import { localizedPath } from "@/lib/i18n/localePath";
import { useLang } from "@/lib/i18n/useLang";

import { QUIZ_PLATFORM_URL, QUIZ_EMBED_URL, QUIZ_TITLE } from "@/lib/quiz/platform";

export const Route = createFileRoute("/quiz")({
  // Strona quizu ma własny układ: renderujemy globalny header NES,
  // a pod nim rozbudowany obszar z dużym iframe'em quizu oraz paskiem powrotu.
  staticData: { ownChrome: true },
  // Landing jest zrobiony do udostępniania, więc metadane MUSZĄ iść za językiem
  // renderu: wcześniej opis i OG były zahardkodowane po polsku i odwiedzający
  // /en/quiz dostawał polski snippet w podglądzie linku. `activeLang` czyta
  // prefiks ścieżki (nie globalny singleton i18next - patrz lib/seo/head.ts),
  // więc jest poprawny także przy współbieżnym SSR.
  head: () => {
    const url = getRequestUrl() || "/quiz";
    const lang = activeLang(url);
    const description =
      lang === "en"
        ? "Test your knowledge in the EuroChallenge Quiz - interactive questions on Europe, the economy and international politics."
        : "Sprawdź swoją wiedzę w EuroChallenge Quiz - interaktywne pytania o Europie, gospodarce i polityce międzynarodowej.";
    // Self-referencing canonical + og:url + klaster hreflang PL/EN. Strona ma
    // własną, unikalną treść (header, panel udostępniania, stopka) i jest celem
    // swoich własnych przycisków „udostępnij", więc canonical zostaje tutaj;
    // promowaną platformę kredytuje JSON-LD (mainEntity -> WebApplication).
    const head = buildContentHead({
      url,
      lang,
      type: "website",
      title: QUIZ_TITLE,
      // Marka w tytule karty przeglądarki/SERP; og:title zostaje krótki
      // (og:site_name i tak niesie brand w karcie społecznościowej).
      documentTitle: `${QUIZ_TITLE} - ${SITE_NAME}`,
      description,
    });
    const { origin } = splitUrl(url);
    return {
      ...head,
      meta: [
        // viewport-fit=cover: strona rysuje się pod notchem (env(safe-area-inset-*)
        // niżej w komponencie), więc nadpisuje globalny viewport z root head.
        { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
        ...head.meta,
      ],
      // Preload wariantu LIGHT (SSR default). DARK preloaduje inline-script
      // poniżej, tylko dla użytkowników z aktywnym trybem ciemnym.
      links: [...head.links, ...QUIZ_BG_PRELOAD_LINKS],
      scripts: [
        { children: QUIZ_BG_PRELOAD_SCRIPT },
        {
          type: "application/ld+json",
          children: safeJsonLd(
            platformLandingJsonLd({
              origin,
              lang,
              path: "/quiz",
              name: QUIZ_TITLE,
              description,
              platformUrl: QUIZ_PLATFORM_URL,
              platformName: QUIZ_TITLE,
            }),
          ),
        },
      ],
    };
  },
  component: QuizPage,
});

function useShareUrl() {
  const { t } = useTranslation();
  const lang = useLang();
  // SSR nie zna window.location, a przyciski udostępniania renderują się już
  // z serwera - fallback musi więc trafiać w wariant językowy tego renderu,
  // inaczej HTML dla /en/quiz niesie polski adres do udostępnienia.
  //
  // HOST ŻĄDANIA, NIE KANONICZNY ORIGIN MARKI. Wcześniej fallback wpisywał
  // twardo `SITE_CANONICAL_ORIGIN`, więc HTML wyrenderowany na DRUGIEJ domenie
  // obszaru roboczego niósł przyciski udostępniania prowadzące na domenę
  // pierwszego. Klient naprawiał to po hydratacji, ale podgląd linku, crawler
  // i kliknięcie przed hydracją dostawały cudzy host. `getOrigin()` jest
  // izomorficzny i na serwerze czyta host bieżącego żądania (proxy-aware),
  // a marka zostaje wyłącznie jako ostatnia deska ratunku.
  const url =
    typeof window !== "undefined"
      ? window.location.href
      : `${getOrigin() || SITE_CANONICAL_ORIGIN}${localizedPath("/quiz", lang)}`;
  const encodedUrl = encodeURIComponent(url);
  const title = t("quiz.share.title");
  // DYWIZ, NIE PAUZA. Ten ciąg jedzie do WhatsAppa jako tekst udostępnienia,
  // czyli jest treścią widoczną - a house style dopuszcza tu wyłącznie dywiz.
  const text = encodeURIComponent(`${title} - ${SITE_NAME}`);

  return {
    url,
    encodedUrl,
    text,
    subject: encodeURIComponent(title),
    body: encodeURIComponent(`${title}\n${url}`),
  };
}

function QuizShareSidebar({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const share = useShareUrl();

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(share.url);
      setCopied(true);
      toast.success(t("quiz.share.copiedToast"));
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t("common.retry"));
    }
  };

  const items = [
    {
      key: "copy",
      iconName: copied ? "check" : "copy",
      fallback: copied ? Check : Copy,
      label: copied ? t("quiz.share.copied") : t("quiz.share.copy"),
      onClick: handleCopy,
      active: copied,
    },
    {
      key: "linkedin",
      iconName: "linkedin",
      fallback: Linkedin,
      label: t("quiz.share.linkedin"),
      href: `https://www.linkedin.com/sharing/share-offsite/?url=${share.encodedUrl}`,
    },
    {
      key: "facebook",
      iconName: "facebook",
      fallback: Facebook,
      label: t("quiz.share.facebook"),
      href: `https://www.facebook.com/sharer/sharer.php?u=${share.encodedUrl}`,
    },
    {
      key: "messenger",
      iconName: "messenger",
      fallback: MessageCircle,
      label: t("quiz.share.messenger"),
      href: `https://www.facebook.com/dialog/send?link=${share.encodedUrl}&app_id=145634995501895&redirect_uri=${share.encodedUrl}`,
    },
    {
      key: "whatsapp",
      iconName: "whatsapp",
      fallback: () => (
        <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4" aria-hidden="true">
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
        </svg>
      ),
      label: t("quiz.share.whatsapp"),
      href: `https://wa.me/?text=${share.text}%20${share.encodedUrl}`,
    },
    {
      key: "email",
      iconName: "email",
      fallback: Mail,
      label: t("quiz.share.email"),
      href: `mailto:?subject=${share.subject}&body=${share.body}`,
    },
  ];

  return (
    <aside
      className={cn(
        "flex shrink-0 flex-col gap-1 rounded-[6px] border border-border bg-card shadow-sm",
        compact ? "gap-0.5 p-1" : "gap-1 p-1.5",
      )}
      aria-label={t("quiz.share.title")}
    >
      {!compact && (
        <div className="mb-1 flex items-center gap-1.5 px-1">
          <BrandIcon name="share" fallback={Share2} className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="hidden text-[11px] font-medium text-foreground lg:inline">
            {t("quiz.share.title")}
          </span>
        </div>
      )}

      {items.map((item) => {
        const Fallback = item.fallback;
        const content = (
          <>
            <BrandIcon
              name={item.iconName}
              fallback={Fallback}
              className={cn(
                "h-4 w-4 shrink-0 transition-colors",
                item.active ? "text-emerald-500" : "text-foreground",
              )}
            />
            {!compact && (
              <span className="hidden text-[11px] font-medium lg:inline">{item.label}</span>
            )}
          </>
        );

        const baseClasses = cn(
          "flex items-center justify-center rounded-[6px] transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          compact ? "h-8 w-8 p-0" : "gap-2 px-2 py-1.5 lg:justify-start",
        );

        return item.href ? (
          <a
            key={item.key}
            href={item.href}
            target="_blank"
            rel="noopener noreferrer"
            className={baseClasses}
            aria-label={item.label}
            title={item.label}
          >
            {content}
          </a>
        ) : (
          <button
            key={item.key}
            type="button"
            onClick={item.onClick}
            className={baseClasses}
            aria-label={item.label}
            title={item.label}
          >
            {content}
          </button>
        );
      })}
    </aside>
  );
}

function QuizPage() {
  const { t } = useTranslation();
  const [shareOpen, setShareOpen] = useState(false);

  return (
    <div
      className="relative flex min-h-screen flex-col"
      style={{
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
      aria-label={QUIZ_TITLE}
    >
      {/* Background + overlay cover only the area above the footer */}
      <div className="relative flex flex-1 flex-col overflow-hidden">
        {/* Responsive background: warianty light/dark + overlay w środku */}
        <QuizBackground />

        {/* Minimalny pasek NES - dokładnie ten sam, który przejmuje górną
            krawędź na wpisie po przewinięciu. Landing quizu jest jednoekranowy,
            więc pokazujemy go od razu (pinned) i rezerwujemy jego wysokość. */}
        <ReadingHeader title={QUIZ_TITLE} entityType="page" pinned centerLogo hideLeftLogo />
        <div aria-hidden className="h-10 shrink-0 sm:h-11 lg:h-12" />

        {/* Główny obszar: iframe quizu + sidebar udostępniania */}
        <div className="flex flex-1">
          {/* Obszar quizu: znacznie wyższy iframe, strona może scrollować */}
          <main className="relative flex flex-1 min-w-0 items-center justify-center p-2 pb-8 sm:p-3 sm:pb-10 md:pb-12 lg:pb-16">
            {/* Floating back button - minimal overlay, does not steal height from iframe */}
            <Link
              to="/"
              className="absolute left-3 top-3 z-10 inline-flex items-center gap-1 rounded-[6px] bg-background/90 px-2 py-1 text-xs font-medium text-foreground shadow-sm backdrop-blur transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:left-4 sm:top-4"
            >
              <BrandIcon name="arrow-left" fallback={ArrowLeft} className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{t("common.back")}</span>
            </Link>

            <div className="relative w-full max-w-5xl overflow-y-auto rounded-[6px] border border-border bg-black shadow-lg h-[clamp(800px,95vh,1000px)] sm:h-[clamp(880px,93vh,1200px)] md:h-[clamp(960px,90vh,1350px)] lg:h-[clamp(1040px,88vh,1550px)] xl:h-[clamp(1120px,86vh,1700px)]">
              <LazyQuizIframe
                src={QUIZ_EMBED_URL}
                title={QUIZ_TITLE}
                className="h-full w-full border-0"
              />
            </div>
          </main>

          {/* Sidebar udostępniania - zawsze widoczny na desktopie, zwijany na mobile */}
          <div className="hidden shrink-0 border-l border-border bg-background/95 p-1 backdrop-blur supports-[backdrop-filter]:bg-background/60 sm:p-1.5 lg:block">
            <div className="flex h-full flex-col items-stretch">
              <QuizShareSidebar />
            </div>
          </div>

          {/* Mobile: zwijany panel udostępniania */}
          <div
            className={cn(
              "flex shrink-0 flex-col items-center gap-1 border-l border-border bg-background/95 p-1 backdrop-blur transition-all duration-300 ease-out supports-[backdrop-filter]:bg-background/60 lg:hidden",
              shareOpen ? "w-auto" : "w-10",
            )}
          >
            <button
              type="button"
              onClick={() => setShareOpen((v) => !v)}
              aria-expanded={shareOpen}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-secondary text-secondary-foreground transition-colors hover:bg-secondary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={shareOpen ? t("quiz.share.collapse") : t("quiz.share.expand")}
              title={shareOpen ? t("quiz.share.collapse") : t("quiz.share.expand")}
            >
              {shareOpen ? (
                <BrandIcon name="chevron-right" fallback={ChevronRight} className="h-4 w-4" />
              ) : (
                <BrandIcon name="share" fallback={Share2} className="h-4 w-4" />
              )}
            </button>
            {shareOpen && <QuizShareSidebar compact />}
          </div>
        </div>
      </div>

      <div className="relative z-10 bg-background">
        <Footer />
      </div>
    </div>
  );
}
