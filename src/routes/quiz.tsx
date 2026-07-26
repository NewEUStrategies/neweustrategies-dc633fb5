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
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/quiz")({
  // Strona quizu ma własny układ: renderujemy globalny header NES,
  // ale zamiast standardowego <main> wklejamy pełnoekranowy, niescrollujący
  // obszar z iframe'em oraz kompaktowy pasek powrotu.
  staticData: { ownChrome: true },
  head: () => ({
    meta: [
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: "EuroChallenge Quiz — New European Strategies" },
      {
        name: "description",
        content:
          "Sprawdź swoją wiedzę w EuroChallenge Quiz. Interaktywne pytania o Europie, gospodarce i polityce międzynarodowej.",
      },
      {
        property: "og:title",
        content: "EuroChallenge Quiz — New European Strategies",
      },
      {
        property: "og:description",
        content:
          "Sprawdź swoją wiedzę w EuroChallenge Quiz. Interaktywne pytania o Europie, gospodarce i polityce międzynarodowej.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: QuizPage,
});

const SHARE_BUTTONS = [
  { key: "linkedin", icon: Linkedin, color: "hover:text-[#0A66C2]" },
  { key: "facebook", icon: Facebook, color: "hover:text-[#1877F3]" },
  { key: "messenger", icon: MessageCircle, color: "hover:text-[#00B2FF]" },
] as const;

function useShareUrl() {
  const { t, i18n } = useTranslation();
  const url =
    (typeof window !== "undefined" ? window.location.href : "https://neweustrategies.lovable.app/quiz");
  const encodedUrl = encodeURIComponent(url);
  const title = t("quiz.share.title");
  const text = encodeURIComponent(
    `${title} — New European Strategies`
  );

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
      icon: copied ? Check : Copy,
      label: copied ? t("quiz.share.copied") : t("quiz.share.copy"),
      onClick: handleCopy,
      active: copied,
    },
    {
      key: "linkedin",
      icon: Linkedin,
      label: t("quiz.share.linkedin"),
      href: `https://www.linkedin.com/sharing/share-offsite/?url=${share.encodedUrl}`,
    },
    {
      key: "facebook",
      icon: Facebook,
      label: t("quiz.share.facebook"),
      href: `https://www.facebook.com/sharer/sharer.php?u=${share.encodedUrl}`,
    },
    {
      key: "messenger",
      icon: MessageCircle,
      label: t("quiz.share.messenger"),
      href: `https://www.facebook.com/dialog/send?link=${share.encodedUrl}&app_id=145634995501895&redirect_uri=${share.encodedUrl}`,
    },
    {
      key: "whatsapp",
      icon: () => (
        <svg
          viewBox="0 0 24 24"
          fill="currentColor"
          className="h-4 w-4"
          aria-hidden="true"
        >
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
        </svg>
      ),
      label: t("quiz.share.whatsapp"),
      href: `https://wa.me/?text=${share.text}%20${share.encodedUrl}`,
    },
    {
      key: "email",
      icon: Mail,
      label: t("quiz.share.email"),
      href: `mailto:?subject=${share.subject}&body=${share.body}`,
    },
  ];

  return (
    <aside
      className={cn(
        "flex shrink-0 flex-col gap-1 rounded-[6px] border border-border bg-card shadow-sm",
        compact ? "gap-0.5 p-1" : "gap-1 p-1.5"
      )}
      aria-label={t("quiz.share.title")}
    >
      {!compact && (
        <div className="mb-1 flex items-center gap-1.5 px-1">
          <Share2 className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="hidden text-[11px] font-medium text-foreground lg:inline">
            {t("quiz.share.title")}
          </span>
        </div>
      )}

      {items.map((item) => {
        const Icon = item.icon;
        const content = (
          <>
            <Icon
              className={cn(
                "h-4 w-4 shrink-0 transition-colors",
                item.active ? "text-emerald-500" : "text-foreground"
              )}
            />
            {!compact && (
              <span className="hidden text-[11px] font-medium lg:inline">
                {item.label}
              </span>
            )}
          </>
        );

        const baseClasses = cn(
          "flex items-center justify-center rounded-[6px] transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          compact ? "h-8 w-8 p-0" : "gap-2 px-2 py-1.5 lg:justify-start"
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
      className="flex h-screen flex-col overflow-hidden bg-background supports-[height:100dvh]:h-[100dvh]"
      style={{
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
      aria-label="EuroChallenge Quiz"
    >
      {/* Globalny header New European Strategies */}
      <Header adPageType="all" />

      {/* Kompaktowy pasek powrotu i tytułu quizu */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-3 py-2 sm:px-4">
        <div className="min-w-0">
          <h1 className="truncate font-display text-sm font-semibold leading-tight text-foreground sm:text-base">
            EuroChallenge Quiz
          </h1>
          <p className="truncate text-[11px] leading-tight text-muted-foreground sm:text-xs">
            Sprawdź swoją wiedzę o Europie, gospodarce i polityce
            międzynarodowej.
          </p>
        </div>
        <Link
          to="/"
          className="inline-flex shrink-0 items-center gap-1 rounded-[6px] bg-secondary px-2 py-1.5 text-xs font-medium text-secondary-foreground transition-colors hover:bg-secondary/80"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{t("common.back")}</span>
        </Link>
      </div>

      {/* Główny obszar: iframe quizu + sidebar udostępniania */}
      <div className="flex flex-1 min-h-0">
        {/* Obszar quizu: responsywnie dopasowuje się do pozostałej wysokości
            viewportu. Na dużych ekranach centrujemy i ograniczamy szerokość,
            aby quiz nie rozciągał się nieproporcjonalnie. */}
        <main className="relative flex flex-1 min-w-0 items-center justify-center p-2 sm:p-3 lg:p-4">
          <div className="relative h-full min-h-[85dvh] w-full max-w-5xl overflow-hidden rounded-[6px] border border-border bg-black shadow-lg md:min-h-[88dvh]">
            <iframe
              src="https://nes-quiz.com/embed"
              className="absolute inset-0 h-full w-full border-0"
              allow="clipboard-write"
              loading="eager"
              title="EuroChallenge Quiz"
            />
          </div>
        </main>

        {/* Sidebar udostępniania — zawsze widoczny na desktopie, zwijany na mobile */}
        <div className="hidden shrink-0 border-l border-border bg-background/95 p-2 backdrop-blur supports-[backdrop-filter]:bg-background/60 sm:p-3 lg:block">
          <div className="flex h-full flex-col items-stretch">
            <QuizShareSidebar />
          </div>
        </div>

        {/* Mobile: zwijany panel udostępniania */}
        <div
          className={cn(
            "flex shrink-0 flex-col items-center gap-2 border-l border-border bg-background/95 p-1.5 backdrop-blur transition-all duration-300 ease-out supports-[backdrop-filter]:bg-background/60 lg:hidden",
            shareOpen ? "w-auto" : "w-11"
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
              <ChevronRight className="h-4 w-4" />
            ) : (
              <Share2 className="h-4 w-4" />
            )}
          </button>
          {shareOpen && <QuizShareSidebar compact />}
        </div>
      </div>

      <p className="shrink-0 px-3 py-1.5 text-center text-[10px] leading-tight text-muted-foreground/80 sm:text-xs">
        Quiz dostarczany przez zewnętrzną platformę{" "}
        <a
          href="https://nes-quiz.com"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-foreground"
        >
          nes-quiz.com
        </a>
        .
      </p>

      <Footer />
    </div>
  );
}
