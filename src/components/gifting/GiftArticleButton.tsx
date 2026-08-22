// "Udostepnij pelny artykul" - przycisk + popover udostepniania (wzor NYT
// "Share full article"). Organizm: sam czyta ustawienia tenanta, stan
// uprawnien i generuje link, wiec mozna go osadzic w dowolnym pasku wpisu
// (QuickViewInfoBar, przyszly reading header). Sklada sie z atomow
// (GiftCopyButton, GiftChannelLink) i molekul (GiftClickBudgetMeter,
// GiftShareChannels) - tu zostaje wylacznie orkiestracja i efekty uboczne.
//
// Fazy (macierz w lib/gifting/model.resolveGiftPhase):
//   gosc -> CTA logowania/rejestracji; przy eligibility=subscribers zalogowany
//   bez subskrypcji -> CTA planow; uprawniony -> auto-generowany, idempotentny
//   link + budzet klikniec + kanaly; wyczerpany budzet linku albo miesieczny
//   limit artykulow -> komunikat terminalny. Wylaczone w tenancie -> brak
//   przycisku w ogole.
//
// Mechanika, ktora obiecuje copy: link otwiera pelna tresc PIERWSZYM N
// odbiorcom (domyslnie 5). Slot zuzywa nowy odbiorca, nie odswiezenie strony -
// egzekwuje to serwer (redeem_gift_link + rejestr post_gift_redemptions).
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { Gift } from "lucide-react";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAuth } from "@/hooks/useAuth";
import { formatDate } from "@/lib/i18n/format";
import { formatMeterResetDate } from "@/lib/access/metering";
import {
  buildGiftShareTargets,
  buildGiftUrl,
  DEFAULT_GIFT_SETTINGS,
  resolveGiftPhase,
  type GiftLang,
} from "@/lib/gifting/model";
import { useCreateGiftLink, useGiftArticleState, useGiftSettings } from "@/lib/gifting/hooks";
import { GiftCopyButton } from "@/components/gifting/atoms/GiftCopyButton";
import { GiftClickBudgetMeter } from "@/components/gifting/molecules/GiftClickBudgetMeter";
import { GiftShareChannels } from "@/components/gifting/molecules/GiftShareChannels";
import "@/lib/i18n-gifting";

interface Props {
  postId: string;
  title: string;
  /** Absolutny, kanoniczny URL wpisu - baza linku podarunkowego. */
  url: string;
  lang: GiftLang;
  className?: string;
  /** Czy wpis jest zabramkowany (paywall). Przy false pokazujemy czyste kopiowanie zwykłego linku bez gift-mechaniki. */
  gated?: boolean;
}

export function GiftArticleButton({ postId, title, url, lang, className, gated = true }: Props) {
  const { t } = useTranslation();
  const { session } = useAuth();
  const isLoggedIn = !!session;
  const [open, setOpen] = useState(false);
  const [justCopied, setJustCopied] = useState(false);

  const settings = useGiftSettings().data ?? DEFAULT_GIFT_SETTINGS;
  const stateQuery = useGiftArticleState(
    postId,
    open && isLoggedIn,
    settings.max_redemptions_per_link,
  );
  const state = stateQuery.data ?? null;
  const { mutation, errorKey } = useCreateGiftLink(postId, settings.max_redemptions_per_link);

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
  // Budzet: stan serwera wygrywa, swieza mutacja jest zapasem na jeden render
  // przed zasianiem cache.
  const budget = state?.budget ?? mutation.data?.budget ?? null;

  // Auto-generowanie po otwarciu popovera: create_gift_link jest idempotentne
  // per (wpis, darczynca), wiec link jest gotowy zanim czytelnik kliknie
  // pierwszy kanal - bez osobnego przycisku "wygeneruj".
  // Dla niegated wpisow nie tworzymy linku podarunkowego - kopiujemy zwykly URL.
  useEffect(() => {
    if (!gated || !open || phase !== "ready" || code) return;
    if (mutation.isPending || mutation.isError) return;
    mutation.mutate();
  }, [gated, open, phase, code, mutation]);

  const giftUrl = code ? buildGiftUrl(url, code) : null;

  // Kanaly dla zwyklego linku publicznego - uzywane gdy wpis nie jest gated.
  const plainTargets = useMemo(() => {
    return buildGiftShareTargets({
      url,
      title,
      emailSubject: t("gifting.emailSubject", { title }),
      emailBody: t("gifting.emailBody", { title, url }),
    });
  }, [url, title, t]);

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

  const onCopyPlain = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(url);
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
  // Copy bramki wejscia zalezy od tego, KTO moze udostepniac: przy bramce
  // rejestracyjnej obiecujemy konto, a nie subskrypcje.
  const authDescKey =
    settings.eligibility === "subscribers" ? "gifting.authDescSubscribers" : "gifting.authDesc";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-gift-article-button
          aria-label={t("gifting.button")}
          className={[
            // Geometria zsynchronizowana z badge „Preferowane zrodlo Google":
            // ta sama minimalna wysokosc, padding i skala typografii, a h-full
            // pozwala wyrownac sie do wyzszego, dwuwierszowego sasiada.
            "inline-flex items-center justify-center gap-2 min-h-8 self-stretch px-3 py-1 rounded-[5px]",
            "border border-border bg-background text-foreground",
            "text-[11.5px] font-semibold tracking-[-0.01em] whitespace-nowrap",
            "hover:bg-muted hover:text-brand transition-colors active:scale-[0.98]",
            className ?? "",
          ].join(" ")}
        >
          <Gift className="w-[18px] h-[18px] shrink-0 text-brand" aria-hidden />
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
          <p className="text-[12px] leading-snug text-muted-foreground">
            {gated
              ? settings.max_redemptions_per_link > 0
                ? t("gifting.leadCapped", { count: settings.max_redemptions_per_link })
                : t("gifting.lead")
              : t("gifting.leadFree")}
          </p>
        </div>

        {/* Niezabramkowany artykul: tylko zwykle kopiowanie linku - bez gift-mechaniki. */}
        {!gated && (
          <div className="border-t border-border/60 px-4 py-3.5">
            <GiftCopyButton
              copied={justCopied}
              label={t("gifting.copyLink")}
              copiedLabel={t("gifting.copied")}
              onClick={() => void onCopyPlain()}
            />
            <GiftShareChannels targets={plainTargets} />
          </div>
        )}

        {phase === "requiresAuth" && (
          <div className="border-t border-border/60 px-4 py-3.5">
            <p className="text-[12.5px] font-semibold text-foreground mb-1">
              {t("gifting.authTitle")}
            </p>
            <p className="text-[12px] leading-snug text-muted-foreground mb-3">{t(authDescKey)}</p>
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

        {/* Budzet klikniec wyczerpany: stan TERMINALNY do przelomu miesiaca -
          rotacja linku dziedziczy zuzycie, wiec nie obiecujemy nowego kodu. */}
        {phase === "budgetExhausted" && budget && (
          <div className="border-t border-border/60 px-4 py-3.5" data-testid="gift-budget-spent">
            <p className="text-[12.5px] font-semibold text-foreground mb-1">
              {t("gifting.budget.spentTitle")}
            </p>
            <p className="text-[12px] leading-snug text-muted-foreground mb-3">
              {t("gifting.budget.spentDesc", { limit: budget.limit })}
            </p>
            <GiftClickBudgetMeter budget={budget} className="mb-3" />
            <p className="text-[11px] leading-snug text-muted-foreground">
              {t("gifting.budget.resetsOn", { date: formatMeterResetDate(lang) })}
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
            <p
              className={`text-[12px] leading-snug mb-2 ${errorKey === "notGated" ? "text-muted-foreground" : "text-destructive"}`}
            >
              {t(`gifting.errors.${errorKey ?? "unknown"}`)}
            </p>
            {errorKey === "notGated" ? (
              <GiftCopyButton
                copied={justCopied}
                label={t("gifting.copyLink")}
                copiedLabel={t("gifting.copied")}
                onClick={() => void onCopy()}
              />
            ) : (
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
            )}
          </div>
        )}

        {phase === "ready" && giftUrl && (
          <div className="border-t border-border/60 px-4 py-3.5">
            {/* Budzet klikniec przed akcjami: nadawca widzi, ILU odbiorcow
              jeszcze przeczyta, zanim wysle link kolejnej osobie. */}
            {budget && <GiftClickBudgetMeter budget={budget} className="mb-3" />}
            <p className="text-[12px] font-semibold text-foreground mb-2.5">{usageNote}</p>

            <GiftCopyButton
              copied={justCopied}
              label={t("gifting.copyLink")}
              copiedLabel={t("gifting.copied")}
              onClick={() => void onCopy()}
            />

            <GiftShareChannels targets={targets} />
          </div>
        )}

        {/* Stopka informacyjna - widoczna, gdy link istnieje. */}
        {phase === "ready" && giftUrl && (
          <div className="border-t border-border/60 bg-muted/30 px-4 py-2.5">
            <p className="text-[11px] leading-snug text-muted-foreground">
              {budget && !budget.unlimited
                ? t("gifting.firstNCanRead", { count: budget.limit })
                : t("gifting.anyoneCanRead")}
              {expiresAt ? ` ${t("gifting.expiresOn", { date: formatDate(expiresAt, lang) })}` : ""}
            </p>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
