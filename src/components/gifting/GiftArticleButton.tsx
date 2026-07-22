// Gift Articles - przycisk "Udostepnij pelny artykul" + popover podarunkowy
// (wzor NYT "Share full article" / "Gift articles"). Samowystarczalny modul:
// sam czyta ustawienia tenanta, stan uprawnien i generuje link, wiec mozna go
// osadzic w dowolnym pasku wpisu (QuickViewInfoBar, przyszly reading header).
//
// Fazy (macierz w lib/gifting/model.resolveGiftPhase):
//   gosc -> CTA logowania; zalogowany bez platnej subskrypcji -> CTA planow;
//   subskrybent -> auto-generowany, idempotentny link + kanaly udostepniania;
//   wyczerpany limit -> komunikat z licznikiem. Wylaczone w tenancie -> brak
//   przycisku w ogole.
import { useEffect, useMemo, useState, type ComponentType } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { Gift, Check } from "lucide-react";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { BrandIcon } from "@/components/atoms/BrandIcon";
import { XIcon } from "@/components/atoms/XIcon";
import { Facebook, Linkedin, Mail, Copy, Share2 } from "@/lib/lucide-shim";
import { useAuth } from "@/hooks/useAuth";
import { formatDate } from "@/lib/i18n/format";
import {
  buildGiftShareTargets,
  buildGiftUrl,
  DEFAULT_GIFT_SETTINGS,
  resolveGiftPhase,
  type GiftChannelId,
  type GiftLang,
} from "@/lib/gifting/model";
import { useCreateGiftLink, useGiftArticleState, useGiftSettings } from "@/lib/gifting/hooks";
import "@/lib/i18n-gifting";

interface Props {
  postId: string;
  title: string;
  /** Absolutny, kanoniczny URL wpisu - baza linku podarunkowego. */
  url: string;
  lang: GiftLang;
  className?: string;
}

type ChannelIcon = ComponentType<{ className?: string }>;

const CHANNEL_FALLBACK_ICONS: Record<GiftChannelId, ChannelIcon> = {
  mail: Mail,
  facebook: Facebook,
  linkedin: Linkedin,
  whatsapp: Share2,
  telegram: Share2,
  x: XIcon,
  reddit: Share2,
};

export function GiftArticleButton({ postId, title, url, lang, className }: Props) {
  const { t } = useTranslation();
  const { session } = useAuth();
  const isLoggedIn = !!session;
  const [open, setOpen] = useState(false);
  const [justCopied, setJustCopied] = useState(false);

  const settings = useGiftSettings().data ?? DEFAULT_GIFT_SETTINGS;
  const stateQuery = useGiftArticleState(postId, open && isLoggedIn);
  const state = stateQuery.data ?? null;
  const { mutation, errorKey } = useCreateGiftLink(postId);

  const phase = resolveGiftPhase({
    isLoggedIn,
    settingsEnabled: settings.enabled,
    state,
    stateLoading: stateQuery.isLoading,
  });

  // Kod: istniejacy (stan) lub swiezo wygenerowany (mutacja dopisuje go do
  // cache stanu, wiec po chwili oba zrodla sa spojne).
  const code = state?.existingCode ?? mutation.data?.code ?? null;
  const expiresAt = state?.expiresAt ?? mutation.data?.expiresAt ?? null;

  // Auto-generowanie po otwarciu popovera: create_gift_link jest idempotentne
  // per (wpis, darczynca), wiec link jest gotowy zanim czytelnik kliknie
  // pierwszy kanal - bez osobnego przycisku "wygeneruj".
  useEffect(() => {
    if (!open || phase !== "ready" || code) return;
    if (mutation.isPending || mutation.isError) return;
    mutation.mutate();
  }, [open, phase, code, mutation]);

  const giftUrl = code ? buildGiftUrl(url, code) : null;

  const targets = useMemo(() => {
    if (!giftUrl) return [];
    return buildGiftShareTargets({
      url: giftUrl,
      title,
      emailSubject: t("gifting.emailSubject", { title }),
      emailBody: t("gifting.emailBody", { title, url: giftUrl }),
    });
  }, [giftUrl, title, t]);

  const onCopy = async (): Promise<void> => {
    if (!giftUrl) return;
    try {
      await navigator.clipboard.writeText(giftUrl);
      setJustCopied(true);
      toast.success(t("gifting.copied"));
      window.setTimeout(() => setJustCopied(false), 2000);
    } catch {
      // Schowek bywa zablokowany (kontekst niezabezpieczony / brak zgody).
      toast.error(t("gifting.copyFailed"));
    }
  };

  // Funkcja wylaczona w tenancie: zadnego przycisku (zero szumu w UI).
  if (!settings.enabled) return null;

  const usageNote =
    state && state.monthlyLimit > 0
      ? t("gifting.remainingNote", { count: state.remaining ?? 0 })
      : t("gifting.unlimitedNote");

  // Blad odczytu stanu (siec/RPC): bez tego popover utknalby w "loading" -
  // resolveGiftPhase widzi brak stanu, a zapytanie juz nie jest w locie.
  const stateFailed = stateQuery.isError;
  const preparing = phase === "ready" && !giftUrl && !mutation.isError;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-gift-article-button
          aria-label={t("gifting.button")}
          className={[
            "inline-flex items-center gap-1.5 h-8 px-3 rounded-[5px]",
            "border border-border bg-background text-foreground",
            "text-[12px] font-semibold tracking-tight whitespace-nowrap",
            "hover:bg-muted hover:text-brand transition-colors active:scale-[0.98]",
            className ?? "",
          ].join(" ")}
        >
          <Gift className="w-[14px] h-[14px] text-brand" aria-hidden />
          {t("gifting.button")}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-[320px] max-w-[calc(100vw-2rem)] p-0 overflow-hidden rounded-[5px] border-border/70 shadow-[0_10px_40px_-12px_rgba(0,0,0,0.25)]"
      >
        {/* Naglowek - wspolny dla wszystkich faz. */}
        <div className="px-4 pt-4 pb-3">
          <p className="flex items-center gap-2 text-[13px] font-bold text-foreground mb-1">
            <span className="shrink-0 h-7 w-7 rounded-full bg-brand/10 grid place-items-center">
              <Gift className="w-3.5 h-3.5 text-brand" aria-hidden />
            </span>
            {t("gifting.popoverTitle")}
          </p>
          <p className="text-[12px] leading-snug text-muted-foreground">{t("gifting.lead")}</p>
        </div>

        {phase === "requiresAuth" && (
          <div className="border-t border-border/60 px-4 py-3.5">
            <p className="text-[12.5px] font-semibold text-foreground mb-1">
              {t("gifting.authTitle")}
            </p>
            <p className="text-[12px] leading-snug text-muted-foreground mb-3">
              {t("gifting.authDesc")}
            </p>
            <div className="grid grid-cols-2 gap-1.5">
              <Link
                to="/login"
                className="inline-flex items-center justify-center h-9 rounded-[5px] bg-brand text-brand-foreground text-[12px] font-semibold hover:opacity-90 transition"
              >
                {t("gifting.signIn")}
              </Link>
              <Link
                to="/login"
                search={{ mode: "signup" }}
                className="inline-flex items-center justify-center h-9 rounded-[5px] border border-border bg-background text-[12px] font-semibold hover:bg-muted transition"
              >
                {t("gifting.signUp")}
              </Link>
            </div>
          </div>
        )}

        {phase === "requiresSubscription" && (
          <div className="border-t border-border/60 px-4 py-3.5">
            <p className="text-[12.5px] font-semibold text-foreground mb-1">
              {t("gifting.subscriptionTitle")}
            </p>
            <p className="text-[12px] leading-snug text-muted-foreground mb-3">
              {t("gifting.subscriptionDesc")}
            </p>
            <Link
              to="/pricing"
              className="w-full inline-flex items-center justify-center h-9 rounded-[5px] bg-brand text-brand-foreground text-[12px] font-semibold hover:opacity-90 transition"
            >
              {t("gifting.seePlans")}
            </Link>
          </div>
        )}

        {phase === "limitReached" && state && (
          <div className="border-t border-border/60 px-4 py-3.5">
            <p className="text-[12.5px] font-semibold text-foreground mb-1">
              {t("gifting.limitTitle")}
            </p>
            <p className="text-[12px] leading-snug text-muted-foreground">
              {t("gifting.limitDesc", { used: state.used, limit: state.monthlyLimit })}
            </p>
          </div>
        )}

        {stateFailed && (
          <div className="border-t border-border/60 px-4 py-3.5" role="alert">
            <p className="text-[12px] leading-snug text-destructive mb-2">
              {t("gifting.errors.unknown")}
            </p>
            <button
              type="button"
              onClick={() => void stateQuery.refetch()}
              className="inline-flex items-center justify-center h-8 px-3 rounded-[5px] border border-border bg-background text-[12px] font-semibold hover:bg-muted transition"
            >
              {t("common.retry")}
            </button>
          </div>
        )}

        {((phase === "loading" && !stateFailed) || preparing) && (
          <div className="border-t border-border/60 px-4 py-3.5" aria-busy="true">
            <p className="text-[12px] text-muted-foreground animate-pulse">
              {t("gifting.preparing")}
            </p>
          </div>
        )}

        {phase === "ready" && mutation.isError && (
          <div className="border-t border-border/60 px-4 py-3.5" role="alert">
            <p className="text-[12px] leading-snug text-destructive mb-2">
              {t(`gifting.errors.${errorKey ?? "unknown"}`)}
            </p>
            <button
              type="button"
              onClick={() => {
                mutation.reset();
                mutation.mutate();
              }}
              className="inline-flex items-center justify-center h-8 px-3 rounded-[5px] border border-border bg-background text-[12px] font-semibold hover:bg-muted transition"
            >
              {t("common.retry")}
            </button>
          </div>
        )}

        {phase === "ready" && giftUrl && (
          <div className="border-t border-border/60 px-4 py-3.5">
            <p className="text-[12px] font-semibold text-foreground mb-2.5">{usageNote}</p>

            {/* Skopiuj link - akcja pierwszego wyboru (jak w NYT). */}
            <button
              type="button"
              onClick={onCopy}
              className={[
                "w-full inline-flex items-center justify-center gap-1.5 h-9 rounded-[5px]",
                "text-[12px] font-semibold tracking-tight transition active:scale-[0.98]",
                justCopied
                  ? "bg-brand/10 text-brand border border-brand/40"
                  : "bg-brand text-brand-foreground hover:opacity-90 shadow-sm",
              ].join(" ")}
            >
              {justCopied ? (
                <Check className="w-[14px] h-[14px]" aria-hidden />
              ) : (
                <Copy className="w-[14px] h-[14px]" aria-hidden />
              )}
              {justCopied ? t("gifting.copied") : t("gifting.copyLink")}
            </button>

            {/* Kanaly - ta sama siatka i ikonografia co panel czytania. */}
            <p className="text-[10px] font-bold tracking-widest uppercase text-muted-foreground mt-3 mb-1.5">
              {t("gifting.shareVia")}
            </p>
            <div className="grid grid-cols-7 gap-1">
              {targets.map((target) => {
                const Icon = CHANNEL_FALLBACK_ICONS[target.id];
                const label = t(`gifting.channels.${target.id}`);
                return (
                  <a
                    key={target.id}
                    href={target.href}
                    target={target.id === "mail" ? "_self" : "_blank"}
                    rel="noopener noreferrer"
                    aria-label={label}
                    title={label}
                    className="inline-flex items-center justify-center h-9 rounded-[5px] text-muted-foreground hover:text-brand hover:bg-muted transition-colors"
                  >
                    <BrandIcon
                      name={target.id}
                      fallback={Icon}
                      alt={label}
                      className="w-[15px] h-[15px]"
                    />
                  </a>
                );
              })}
            </div>
          </div>
        )}

        {/* Stopka informacyjna - widoczna, gdy link istnieje. */}
        {phase === "ready" && giftUrl && (
          <div className="border-t border-border/60 bg-muted/30 px-4 py-2.5">
            <p className="text-[11px] leading-snug text-muted-foreground">
              {t("gifting.anyoneCanRead")}
              {expiresAt ? ` ${t("gifting.expiresOn", { date: formatDate(expiresAt, lang) })}` : ""}
            </p>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
