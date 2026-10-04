// Molekuła: „Dodaj do Apple Wallet” / „Dodaj do Google Wallet” pod kodem QR
// na stronie biletu (`EventTicketCodePanel`).
//
// KOD BILETU JEDZIE W CIELE POST, NIGDY W ADRESIE. Apple dostaje zwykły
// formularz tej samej domeny: najpierw `intent=check` przez `fetch` (błąd
// pokazujemy na stronie), potem natywne `form.submit()` - tylko tak iOS Safari
// otwiera arkusz „Dodaj przepustkę” (pobranie z `blob:` jest tam zawodne).
// Google oddaje `saveUrl`, pod który przeglądarka przechodzi sama
// (`location.assign`); przekierowanie z serwera zablokowałoby CSP.
//
// PLATFORMA W EFEKCIE, NIE W RENDERZE. `navigator` istnieje dopiero
// w przeglądarce; trasa biletu i tak jest `ssr: false`, ale pierwszy render
// jest deterministyczny (szkielet), a wybór przycisków zapada po montażu.
// iPhone widzi tylko Apple, Android tylko Google, komputer - oba.
//
// NIESKONFIGUROWANY PORTFEL SIĘ NIE POKAZUJE. Gdy platforma nie ma sekretów
// żadnego portfela, sekcji nie ma wcale - uczestnik nie widzi przycisku,
// który zawsze kończy się błędem. Awaria samego pytania o dostępność daje
// krótką notkę, że kod QR działa bez zmian.
//
// Plakietki są w stylu oficjalnych przycisków (czarne tło, znak portfela,
// dwie linie tekstu), ale znak jest własnym, uproszczonym rysunkiem - nazwa
// usługi stoi w tekście przycisku, więc czytnik ekranu czyta „Dodaj do Apple
// Wallet”, a nie opis grafiki.
import { useEffect, useId, useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { Skeleton } from "@/components/ui/skeleton";
import {
  detectWalletDevice,
  WALLET_ENDPOINTS,
  walletButtonsFor,
  walletErrorKey,
  type WalletDevice,
} from "@/lib/events/ticketWallet";
import { checkAppleWalletPass, requestGoogleWalletSaveUrl } from "@/lib/events/ticketWalletApi";
import { useWalletAvailability } from "@/lib/events/useTicketWallet";
import { uiLang } from "@/lib/i18n/format";
import { ensureEventWalletI18n } from "@/lib/i18n-event-wallet";

ensureEventWalletI18n();

const BADGE =
  "inline-flex h-12 min-w-44 items-center gap-3 rounded-[10px] border border-black bg-black px-4 text-left text-white " +
  "transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
  "focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60 dark:border-white/40";

function AppleWalletGlyph() {
  return (
    <svg viewBox="0 0 32 32" className="h-7 w-7 shrink-0" aria-hidden="true" focusable="false">
      <rect x="3" y="5" width="26" height="22" rx="4" fill="#ffffff" />
      <rect x="5" y="8" width="22" height="4" rx="1.5" fill="#3b82f6" />
      <rect x="5" y="12" width="22" height="4" rx="1.5" fill="#22c55e" />
      <rect x="5" y="16" width="22" height="4" rx="1.5" fill="#FA9346" />
      <path
        d="M5 21h7c1 2.4 2.4 3.5 4 3.5s3-1.1 4-3.5h7v2a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z"
        fill="#ef4444"
      />
    </svg>
  );
}

function GoogleWalletGlyph() {
  return (
    <svg viewBox="0 0 32 32" className="h-7 w-7 shrink-0" aria-hidden="true" focusable="false">
      <rect x="4" y="6" width="24" height="7" rx="3" fill="#ea4335" />
      <rect x="4" y="10" width="24" height="7" rx="3" fill="#fbbc04" />
      <rect x="4" y="14" width="24" height="7" rx="3" fill="#34a853" />
      <rect x="4" y="18" width="24" height="8" rx="3" fill="#4285f4" />
    </svg>
  );
}

function BadgeText({ prefix, name }: { prefix: string; name: string }) {
  return (
    <span className="flex flex-col leading-tight">
      <span className="text-[11px]">{prefix}</span>
      <span className="text-base font-semibold">{name}</span>
    </span>
  );
}

export function TicketWalletButtons({ qrToken }: { qrToken: string }) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const headingId = useId();
  const [device, setDevice] = useState<WalletDevice | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const availability = useWalletAvailability();

  useEffect(() => {
    setDevice(detectWalletDevice(navigator.userAgent, navigator.maxTouchPoints));
  }, []);

  const apple = useMutation({
    mutationFn: (form: HTMLFormElement) => checkAppleWalletPass(qrToken, lang).then(() => form),
    // `submit()` NIE wywołuje `onSubmit` - formularz nawiguje natywnie.
    onSuccess: (form) => form.submit(),
    onError: (error) => setErrorKey(walletErrorKey(error)),
  });
  const google = useMutation({
    mutationFn: () => requestGoogleWalletSaveUrl(qrToken, lang),
    onSuccess: (saveUrl) => window.location.assign(saveUrl),
    onError: (error) => setErrorKey(walletErrorKey(error)),
  });

  if (device === null || availability.isPending) {
    return (
      <div aria-busy="true" className="flex flex-wrap gap-2">
        <Skeleton className="h-12 w-44 rounded-[10px]" />
      </div>
    );
  }

  if (availability.isError) {
    return <p className="text-xs text-muted-foreground">{t("eventWallet.unavailable")}</p>;
  }

  const shown = walletButtonsFor(device, availability.data);
  if (!shown.apple && !shown.google) return null;
  const busy = apple.isPending || google.isPending;

  function onAppleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorKey(null);
    apple.mutate(event.currentTarget);
  }

  function onGoogleClick() {
    setErrorKey(null);
    google.mutate();
  }

  return (
    <section aria-labelledby={headingId} className="space-y-3 border-t border-border pt-4">
      <div className="space-y-1">
        <h2 id={headingId} className="text-sm font-semibold text-foreground">
          {t("eventWallet.title")}
        </h2>
        <p className="text-xs text-muted-foreground">{t("eventWallet.lead")}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {shown.apple && (
          <form method="post" action={WALLET_ENDPOINTS.apple} onSubmit={onAppleSubmit}>
            <input type="hidden" name="token" value={qrToken} />
            <input type="hidden" name="lang" value={lang} />
            <button type="submit" className={BADGE} disabled={busy}>
              <AppleWalletGlyph />
              <BadgeText
                prefix={t("eventWallet.apple.prefix")}
                name={t("eventWallet.apple.name")}
              />
            </button>
          </form>
        )}
        {shown.google && (
          <button type="button" className={BADGE} disabled={busy} onClick={onGoogleClick}>
            <GoogleWalletGlyph />
            <BadgeText
              prefix={t("eventWallet.google.prefix")}
              name={t("eventWallet.google.name")}
            />
          </button>
        )}
      </div>
      <p role="status" aria-live="polite" className="min-h-4 text-xs text-muted-foreground">
        {busy ? t("eventWallet.working") : null}
      </p>
      {errorKey !== null && (
        <p role="alert" className="text-sm text-destructive">
          {t(errorKey)}
        </p>
      )}
    </section>
  );
}
