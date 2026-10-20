import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { LogIn, Star } from "@/lib/lucide-shim";

const Lock = (props: React.SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <rect width="18" height="11" x="3" y="11" rx="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import type { ContentAccessRule, AccessPlan } from "@/hooks/useContentAccess";
import type { PasswordUnlockFailure, PasswordVerifyResult } from "@/hooks/usePasswordUnlock";
// Jeden silnik pieniędzy dla całego lejka: ten sam locale-aware formatter co
// /pricing i checkout (poprzedni, lokalny formatMoney hardkodował pl-PL, więc
// anglojęzyczny czytelnik widział polskie formatowanie cen na paywallu).
import { formatMoney, planDescription, planName } from "@/lib/billing/types";
import { createCheckoutOrder } from "@/lib/billing/checkout.functions";
import { getStripeEnvironment } from "@/lib/stripe";
import { LazyEmbeddedCheckoutDialog } from "@/components/checkout/LazyEmbeddedCheckoutDialog";
import {
  formatMeterResetDate,
  meterPaywallVariant,
  type MeterState,
  type MeteringSettings,
} from "@/lib/access/metering";
import { QuotaMeter } from "@/components/atoms/QuotaMeter";
import { track } from "@/lib/analytics/track";
import { hasAnalyticsConsent } from "@/lib/ads/consent";
import { currentReturnPath, loginSearch, type LoginIntent } from "@/lib/access/paywallLinks";
// Wyłącznie typy - reguła oferty i pomiar jadą w `import()` po pierwszym
// renderze (plan B budżetu `public`, karta S3).
import type { PaywallOffer, PaywallViewer } from "@/lib/access/paywallOffer";
import "@/lib/i18n-paywall";

/**
 * Podgląd symulatora czytelnika (hub S7): persona zamiast sesji. Ten sam
 * komponent co w artykule (AD-16), ale bez efektów - bez `record_paywall_hit`,
 * bez `track()` (licznik konsumuje trasa, nie ściana), a linki są
 * `aria-disabled`.
 */
export interface PaywallPreview {
  viewer: PaywallViewer;
}

type Props = {
  rule: ContentAccessRule;
  lang: "pl" | "en";
  /** Raw text content for auto-teaser when no manual teaser set */
  fallbackText?: string | null;
  /** Password mode: server-side verify; a refusal says WHY (wrong password vs. limit/outage). */
  onPasswordVerify?: (password: string) => Promise<PasswordVerifyResult>;
  /** Async loading indicator forwarded from the parent's password unlock hook. */
  passwordVerifying?: boolean;
  /** Metering paywalla: konfiguracja tenantu (jeśli włączona). */
  meterSettings?: MeteringSettings | null;
  /** Czy ten byt uczestniczy w meteringu (meteringApplies z resolvera). */
  meterApplies?: boolean;
  /** Stan licznika z próby odblokowania (null, gdy nie próbowano). */
  meterState?: MeterState | null;
  preview?: PaywallPreview;
};

const MAX_ATTEMPTS = 5;
const LOCKOUT_SECONDS = 30;

/** Wynik zapytania oznaczony kluczem, dla którego powstał (patrz efekty niżej). */
type Loaded<T> = { key: string; value: T; failed: boolean };
type HintRow = { hint_pl: string | null; hint_en: string | null };

export function Paywall({
  rule,
  lang,
  fallbackText,
  onPasswordVerify,
  passwordVerifying,
  meterSettings = null,
  meterApplies = false,
  meterState = null,
  preview,
}: Props) {
  const { t } = useTranslation();
  const { session, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const checkout = useServerFn(createCheckoutOrder);
  // `clientSecret` sesji Stripe - modal osadzonego checkoutu zamiast nakładki.
  const [checkoutSecret, setCheckoutSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState("");
  const [pwdError, setPwdError] = useState<PasswordUnlockFailure | null>(null);
  const [attempts, setAttempts] = useState(0);
  const [lockUntil, setLockUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const teaser =
    (lang === "pl" ? rule.teaser_pl : rule.teaser_en) ||
    (fallbackText ? buildAutoTeaser(fallbackText) : "");

  const locked = lockUntil !== null && now < lockUntil;
  const secondsLeft = locked ? Math.ceil(((lockUntil ?? 0) - now) / 1000) : 0;
  const attemptsLeft = Math.max(0, MAX_ATTEMPTS - attempts);

  // Tick every second while locked to update countdown, then release.
  useEffect(() => {
    if (!locked) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [locked]);
  useEffect(() => {
    if (lockUntil !== null && now >= lockUntil) {
      setLockUntil(null);
      setAttempts(0);
      setPwdError(null);
    }
  }, [now, lockUntil]);

  // Oba zapytania ściany zapisują wynik razem z kluczem, dla którego wyszły,
  // a render bierze go tylko przy zgodnym kluczu. Trasa `$` nie przemontowuje
  // Paywalla między wpisami, więc: spóźniona odpowiedź dla poprzedniego
  // wpisu/czytelnika nie nadpisze nowszej (flaga anulowania), a reguła bez
  // oferty nie pokaże planów poprzedniego wpisu. Błąd zapytania (lub odrzucona
  // obietnica) daje stan z ponowieniem zamiast ściany bez oferty.
  //
  // OFERTA (P14). Ceny widzi także gość - ściana bez cen gubiła lejek przed
  // rejestracją. Oferty nie potrzebuje wyłącznie `members` bez progu rangi
  // (wystarczy konto) i hasło; warunek jest lustrem `needsPaywallOffer`.
  const signedIn = preview ? preview.viewer.signedIn : !!session;
  const minRank = rule.min_tier_rank ?? 0;
  const planIds = rule.plan_ids.join(",");
  const offerKey =
    rule.mode === "paid" || (rule.mode === "members" && minRank > 0)
      ? [
          rule.mode,
          planIds,
          minRank,
          preview ? JSON.stringify(preview.viewer) : (session?.user?.id ?? "anon"),
        ].join("|")
      : null;
  const [offerLoad, setOfferLoad] = useState<Loaded<PaywallOffer | null> | null>(null);
  const [offerAttempt, setOfferAttempt] = useState(0);
  const mode = rule.mode;
  const persona = preview?.viewer ?? null;
  useEffect(() => {
    if (!offerKey) return;
    let cancelled = false;
    const settle = (value: PaywallOffer | null, failed: boolean) => {
      if (!cancelled) setOfferLoad({ key: offerKey, value, failed });
    };
    import("@/lib/access/paywallOffer")
      .then((m) =>
        m.loadPaywallOffer(
          { mode, plan_ids: planIds ? planIds.split(",") : [], min_tier_rank: minRank },
          signedIn,
          persona,
        ),
      )
      .then(
        (value) => settle(value, false),
        () => settle(null, true),
      );
    return () => {
      cancelled = true;
    };
    // Klucz niesie tryb, plany, próg i czytelnika - nowa tożsamość obiektu
    // reguły z tymi samymi danymi nie powtarza zapytań.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offerKey, offerAttempt]);
  const offerState = offerLoad && offerLoad.key === offerKey ? offerLoad : null;
  const offer = offerState?.value ?? null;
  const plans = offer?.plans ?? [];
  const plansFailed = offerState?.failed ?? false;
  const ctaKind = offer?.ctaKind ?? null;
  const retryPlans = () => {
    setOfferLoad(null);
    setOfferAttempt((n) => n + 1);
  };

  // Podpowiedź hasła (RPC nigdy nie zwraca hasha). Wiersz niesie oba języki,
  // więc zmiana języka wybiera wariant w renderze bez ponownego zapytania.
  const hintKey =
    rule.mode === "password" && rule.entity_id ? `${rule.entity_type}:${rule.entity_id}` : null;
  const [hintLoad, setHintLoad] = useState<Loaded<HintRow | null> | null>(null);
  const [hintAttempt, setHintAttempt] = useState(0);
  useEffect(() => {
    if (!hintKey) return;
    let cancelled = false;
    const settle = (value: HintRow | null, failed: boolean) => {
      if (!cancelled) setHintLoad({ key: hintKey, value, failed });
    };
    supabase
      .rpc("get_password_hint", {
        _entity_type: rule.entity_type,
        _entity_id: rule.entity_id,
      })
      .then(
        ({ data, error }) =>
          settle(!error && Array.isArray(data) ? (data[0] ?? null) : null, !!error),
        () => settle(null, true),
      );
    return () => {
      cancelled = true;
    };
  }, [hintKey, hintAttempt, rule.entity_type, rule.entity_id]);
  const hintState = hintLoad && hintLoad.key === hintKey ? hintLoad : null;
  const hint = (lang === "pl" ? hintState?.value?.hint_pl : hintState?.value?.hint_en) || null;
  const hintFailed = hintState?.failed ?? false;
  const retryHint = () => {
    setHintLoad(null);
    setHintAttempt((n) => n + 1);
  };

  const submitPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onPasswordVerify || !password.trim() || passwordVerifying || locked) return;
    const result = await onPasswordVerify(password);
    if (result.ok) {
      setPwdError(null);
      setAttempts(0);
      return;
    }
    setPwdError(result.reason);
    // Limit serwera i awaria weryfikacji to nie "złe hasło": nie palą lokalnej
    // próby i zostawiają wpisane hasło do ponownego wysłania.
    if (result.reason !== "invalid") return;
    const next = attempts + 1;
    setAttempts(next);
    setPassword("");
    if (next >= MAX_ATTEMPTS) {
      setLockUntil(Date.now() + LOCKOUT_SECONDS * 1000);
      setNow(Date.now());
    }
  };

  // Remember the current article so the checkout success page can offer
  // "continue reading" instead of dead-ending the buyer on their profile.
  const rememberReturn = () => {
    try {
      sessionStorage.setItem("checkout:returnTo", window.location.pathname);
    } catch {
      /* ignore */
    }
  };

  // Wariant komunikatu wynikający z meteringu: "register" (anonim - CTA na
  // darmowe konto z limitem N/mies.) lub "exhausted" (limit wyczerpany).
  const meterVariant = meterPaywallVariant({
    isLoggedIn: signedIn,
    settings: meterSettings,
    applies: meterApplies,
    state: meterState,
  });

  // POMIAR (P18, AD-16). Serwerowy licznik uderzeń (`record_paywall_hit`) nie
  // zależy od zgody i nie ma identyfikatora przeglądarki; zdarzenia klienta
  // (`paywall_view`, `paywall_cta_click`) idą WYŁĄCZNIE przy zgodzie
  // analitycznej - także kopia do GA4. Podgląd nie mierzy niczego.
  const hitReason =
    mode === "password"
      ? "password"
      : meterVariant === "exhausted"
        ? "quota"
        : meterVariant === "register"
          ? "registration"
          : minRank > 0
            ? "tier_rank"
            : mode === "members"
              ? "members"
              : "paid";
  const variant = meterVariant ?? "default";
  const measure = (type: string, meta: Record<string, unknown>) => {
    if (preview || !hasAnalyticsConsent()) return;
    track({
      type,
      name: type,
      entityType: rule.entity_type,
      entityId: rule.entity_id,
      meta: { reason: hitReason, variant, ...meta },
    });
  };
  const hitKey = preview ? null : `${rule.entity_type}:${rule.entity_id}:${hitReason}`;
  const hitTier = offerKey ? (offerState ? (offer?.requiredTier?.key ?? null) : undefined) : null;
  const recordedHit = useRef<string | null>(null);
  useEffect(() => {
    // Czekamy na ofertę (klucz wymaganej warstwy), ale tylko raz na wpis.
    // Także na ustaloną sesję: uderzenie z rozruchu (sesja jeszcze nieznana)
    // policzyłoby zalogowanego czytelnika jako gościa.
    if (!hitKey || hitTier === undefined || authLoading || recordedHit.current === hitKey) return;
    recordedHit.current = hitKey;
    measure("paywall_view", {});
    if (
      rule.entity_type === "post" ||
      rule.entity_type === "page" ||
      rule.entity_type === "media"
    ) {
      const entityType = rule.entity_type;
      // Pomiar nigdy nie psuje ściany - także chunk, który się nie wczytał.
      void import("@/lib/access/paywallOffer")
        .then((m) =>
          m.recordPaywallHit(signedIn, {
            entityType,
            entityId: rule.entity_id,
            reason: hitReason,
            requiredTierKey: hitTier,
            variant,
          }),
        )
        .catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hitKey, hitTier, authLoading]);

  // Ścieżka powrotu po zalogowaniu (P15). Czytana PO montażu: SSR nie zna
  // `window`, a różny `href` serwera i klienta to błąd hydratacji.
  const [here, setHere] = useState<string | undefined>(undefined);
  useEffect(() => setHere(currentReturnPath()), []);
  const intent: LoginIntent = meterVariant === "register" ? "meter" : "paywall";
  const loginTo = (mode: "signin" | "signup", next = here, planId?: string) =>
    loginSearch({ mode, next, intent, planId });
  // Linki podglądu są martwe (`aria-disabled`); w artykule klik mierzy CTA.
  const ctaProps = (cta: string, planId?: string, then?: () => void) =>
    preview
      ? {
          "aria-disabled": true,
          tabIndex: -1,
          onClick: (e: React.MouseEvent) => e.preventDefault(),
        }
      : {
          onClick: () => {
            then?.();
            measure("paywall_cta_click", { cta, plan: planId ?? null });
          },
        };

  const buyableEntity = rule.entity_type === "post" || rule.entity_type === "page";
  const startOneTime = async () => {
    if (!session || preview) return;
    // Narrow entity_type to the checkout-supported union ("post" | "page").
    if (rule.entity_type !== "post" && rule.entity_type !== "page") return;
    const entityType = rule.entity_type;
    rememberReturn();
    setBusy(true);
    try {
      const res = await checkout({
        data: {
          kind: "one_time",
          entity_type: entityType,
          entity_id: rule.entity_id,
          success_path: "/checkout/success",
          cancel_path: "/checkout/cancel",
          environment: getStripeEnvironment(),
        },
      });
      if (!res.ok) {
        toast.error(t("paywall.checkoutFail"));
        setBusy(false);
        return;
      }
      if (res.mode === "stripe") {
        setCheckoutSecret(res.clientSecret);
        setBusy(false);
      } else {
        void navigate({ to: "/checkout/success", search: { order: res.orderId, mock: 1 } });
      }
    } catch {
      toast.error(t("paywall.checkoutFail"));
      setBusy(false);
    }
  };

  // Tytuł i opis: wariant licznika, potem próg rangi zalogowanego (P14:
  // „wymaga planu X" zamiast „zaloguj się"), potem tryb reguły.
  const tierName = offer?.requiredTier
    ? (lang === "pl" ? offer.requiredTier.name_pl : offer.requiredTier.name_en) ||
      offer.requiredTier.key
    : null;
  const tierWall = signedIn && tierName && (ctaKind === "upgrade" || ctaKind === "checkout");
  const intervalLabel = (interval: AccessPlan["interval"]) =>
    interval === "month"
      ? t("paywall.perMonth")
      : interval === "two_weeks"
        ? t("paywall.perTwoWeeks")
        : interval === "quarter"
          ? t("paywall.perQuarter")
          : interval === "year"
            ? t("paywall.perYear")
            : t("paywall.oneTime");
  const oneTimePrice =
    buyableEntity && rule.one_time_price_cents != null && rule.one_time_price_cents > 0
      ? formatMoney(rule.one_time_price_cents, rule.one_time_currency || "PLN", lang)
      : null;
  const enquiry = offer?.enquiryPlan ?? null;

  return (
    <>
      <LazyEmbeddedCheckoutDialog
        clientSecret={checkoutSecret}
        onOpenChange={(open) => {
          if (!open) setCheckoutSecret(null);
        }}
      />
      <div className="mt-10 border border-border rounded-xl overflow-hidden bg-gradient-to-b from-muted/40 to-background">
        {teaser && (
          <div className="px-6 pt-6 pb-2 prose prose-lg dark:prose-invert max-w-none">
            <p className="text-foreground/80">{teaser}…</p>
          </div>
        )}
        <div className="px-6 py-8 text-center border-t border-border bg-background/60">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-brand/10 text-brand-ink mb-4">
            {rule.mode === "members" ? <LogIn className="w-5 h-5" /> : <Lock className="w-5 h-5" />}
          </div>
          <h2 className="font-display text-2xl font-bold mb-2">
            {meterVariant === "register"
              ? t("paywall.meter.registerTitle")
              : meterVariant === "exhausted"
                ? t("paywall.meter.exhaustedTitle")
                : tierWall
                  ? t("paywall.offer.upgradeTitle", { tier: tierName })
                  : rule.mode === "members"
                    ? t("paywall.membersOnly")
                    : rule.mode === "password"
                      ? t("paywall.passwordOnly")
                      : t("paywall.paidOnly")}
          </h2>
          <p className="text-sm text-muted-foreground max-w-md mx-auto mb-6">
            {meterVariant === "register"
              ? t("paywall.meter.registerDesc", { count: meterSettings?.member_monthly_limit ?? 0 })
              : meterVariant === "exhausted"
                ? t("paywall.meter.exhaustedDesc", {
                    used: meterState?.used ?? 0,
                    limit: meterState?.monthlyLimit ?? 0,
                  })
                : tierWall && ctaKind === "upgrade"
                  ? t("paywall.offer.upgradeDesc")
                  : rule.mode === "members" && !tierWall
                    ? t("paywall.membersDesc")
                    : rule.mode === "password"
                      ? t("paywall.passwordDesc")
                      : t("paywall.paidDesc")}
          </p>
          {/* Wyczerpany limit: wizualny licznik zużycia (ten sam atom co baner w
            warstwie treści) + konkretna data odnowienia - czytelnik widzi, ILE
            przeczytał i KIEDY limit wróci, zanim zdecyduje o planie. */}
          {meterVariant === "exhausted" && meterState && meterState.monthlyLimit > 0 && (
            <div className="max-w-xs mx-auto mb-6" data-testid="paywall-meter">
              <QuotaMeter
                used={meterState.used}
                limit={meterState.monthlyLimit}
                label={t("paywall.meter.progressLabel")}
                valueText={t("paywall.meter.progressValue", {
                  used: Math.min(meterState.used, meterState.monthlyLimit),
                  limit: meterState.monthlyLimit,
                })}
                size="md"
              />
              <p className="mt-2 text-xs text-muted-foreground">
                {t("paywall.meter.resetsOn", { date: formatMeterResetDate(lang) })}
              </p>
            </div>
          )}

          {/* Password-protected */}
          {rule.mode === "password" && (
            <form onSubmit={submitPassword} className="max-w-sm mx-auto space-y-2.5">
              {hint && (
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium">{t("paywall.passwordHintLabel")}</span> {hint}
                </p>
              )}
              {hintFailed && (
                <p role="status" className="text-xs text-muted-foreground">
                  {t("paywall.hintLoadFailed")}{" "}
                  <Button
                    type="button"
                    variant="link"
                    className="h-auto p-0 text-xs"
                    onClick={retryHint}
                  >
                    {t("paywall.retry")}
                  </Button>
                </p>
              )}
              <div className="flex gap-2">
                <Input
                  type="password"
                  autoComplete="off"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (pwdError) setPwdError(null);
                  }}
                  placeholder={t("paywall.passwordPlaceholder")}
                  aria-invalid={pwdError === "invalid"}
                  aria-label={t("paywall.passwordPlaceholder")}
                  disabled={passwordVerifying || locked}
                  className={
                    pwdError === "invalid"
                      ? "border-destructive focus-visible:ring-destructive/40"
                      : ""
                  }
                />
                <Button
                  type="submit"
                  disabled={passwordVerifying || locked || !password.trim()}
                  className="min-w-[92px]"
                >
                  {passwordVerifying ? (
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className="h-3 w-3 rounded-full border-2 border-current border-t-transparent animate-spin"
                        aria-hidden="true"
                      />
                      {t("paywall.passwordChecking")}
                    </span>
                  ) : (
                    t("paywall.passwordSubmit")
                  )}
                </Button>
              </div>
              {locked ? (
                <div
                  role="alert"
                  className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
                >
                  <Lock className="h-3.5 w-3.5 shrink-0" />
                  <span>{t("paywall.passwordLocked", { seconds: secondsLeft })}</span>
                </div>
              ) : pwdError === "invalid" ? (
                <div
                  role="alert"
                  className="flex items-center justify-between gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
                >
                  <span className="font-medium">{t("paywall.passwordWrong")}</span>
                  {attemptsLeft > 0 && (
                    <span className="tabular-nums opacity-80">
                      {t("paywall.passwordAttemptsLeft", { count: attemptsLeft })}
                    </span>
                  )}
                </div>
              ) : pwdError ? (
                <div
                  role="alert"
                  className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
                >
                  {pwdError === "rate_limited"
                    ? t("paywall.passwordRateLimited")
                    : t("paywall.passwordFailed")}
                </div>
              ) : null}
            </form>
          )}

          {/* Gość (poza hasłem): logowanie z powrotem na ten tekst (P15).
            Wariant "register" odwraca akcenty: rejestracja (wejście do
            darmowego limitu meteringu) jest primary. */}
          {rule.mode !== "password" && !signedIn && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-center gap-3">
                {meterVariant === "register" ? (
                  <>
                    <Link to="/login" search={loginTo("signup")} {...ctaProps("signup")}>
                      <Button>{t("paywall.signup")}</Button>
                    </Link>
                    <Link to="/login" search={loginTo("signin")} {...ctaProps("signin")}>
                      <Button variant="outline">
                        <LogIn className="w-4 h-4 mr-2" /> {t("paywall.signin")}
                      </Button>
                    </Link>
                  </>
                ) : (
                  <>
                    <Link to="/login" search={loginTo("signin")} {...ctaProps("signin")}>
                      <Button>
                        <LogIn className="w-4 h-4 mr-2" /> {t("paywall.signin")}
                      </Button>
                    </Link>
                    <Link to="/login" search={loginTo("signup")} {...ctaProps("signup")}>
                      <Button variant="outline">{t("paywall.signup")}</Button>
                    </Link>
                  </>
                )}
              </div>
              {meterVariant === "register" && (
                <p className="text-xs text-muted-foreground">{t("paywall.meter.registerNote")}</p>
              )}
            </div>
          )}

          {signedIn && ctaKind === "granted" && (
            <p role="status" className="text-sm text-muted-foreground">
              {t("paywall.offer.granted")}
            </p>
          )}
          {signedIn && ctaKind === "contact_org" && (
            <p className="text-sm text-muted-foreground max-w-md mx-auto mb-4">
              {t("paywall.offer.org", { name: offer?.orgName ?? "" })}{" "}
              <Link
                to="/profile/organization"
                className="text-brand-ink hover:underline"
                {...ctaProps("contact_org")}
              >
                {t("paywall.offer.orgLink")}
              </Link>
            </p>
          )}

          {/* Oferta: płatna treść albo próg rangi - ceny widzi też gość. */}
          {offerKey && (
            <div className="space-y-4 mt-4">
              {plansFailed && (
                <div
                  role="alert"
                  className="mx-auto flex max-w-md flex-col items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                >
                  <span>{t("paywall.plansLoadFailed")}</span>
                  <Button type="button" size="sm" variant="outline" onClick={retryPlans}>
                    {t("paywall.retry")}
                  </Button>
                </div>
              )}
              {ctaKind !== "granted" && plans.length > 0 && (
                <div className="grid sm:grid-cols-2 gap-3 max-w-2xl mx-auto text-left">
                  {plans.map((p) => {
                    const name = planName(p, lang);
                    const desc = planDescription(p, lang);
                    return (
                      <div
                        key={p.id}
                        className="border border-border rounded-lg p-4 bg-background hover:border-brand transition"
                      >
                        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-brand-ink mb-1">
                          <Star className="w-3.5 h-3.5" /> {name}
                          {plans.length > 1 && offer?.recommendedPlan?.id === p.id && (
                            <span className="ml-auto normal-case tracking-normal">
                              {t("paywall.offer.recommended")}
                            </span>
                          )}
                        </div>
                        <div className="text-2xl font-bold">
                          {formatMoney(p.price_cents, p.currency, lang)}
                          <span className="text-xs font-normal text-muted-foreground ml-1">
                            {intervalLabel(p.interval)}
                          </span>
                        </div>
                        {p.trial_days > 0 && p.interval !== "one_time" && (
                          <span className="mt-1 inline-block rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-medium text-brand-ink">
                            {t("paywall.trialBadge", { days: p.trial_days })}
                          </span>
                        )}
                        {desc && (
                          <p className="text-xs text-muted-foreground mt-2 line-clamp-2">{desc}</p>
                        )}
                        <Button asChild size="sm" className="w-full mt-3" disabled={busy}>
                          {signedIn ? (
                            <Link
                              to="/checkout/$planId"
                              params={{ planId: p.id }}
                              {...ctaProps(ctaKind ?? "checkout", p.id, rememberReturn)}
                            >
                              {ctaKind === "upgrade"
                                ? t("paywall.offer.upgrade")
                                : t("paywall.subscribe")}
                            </Link>
                          ) : (
                            <Link
                              to="/login"
                              search={loginTo("signup", `/checkout/${p.id}`, p.id)}
                              {...ctaProps("signup_then_checkout", p.id, rememberReturn)}
                            >
                              {t("paywall.offer.signupBuy")}
                            </Link>
                          )}
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
              {ctaKind === "contact_sales" && enquiry && (
                <p className="text-sm text-muted-foreground">
                  {t("paywall.offer.sales")}{" "}
                  <Link
                    to="/plans/$planId"
                    params={{ planId: enquiry.id }}
                    className="text-brand-ink hover:underline"
                    {...ctaProps("contact_sales", enquiry.id)}
                  >
                    {t("paywall.offer.salesCta")}
                  </Link>
                </p>
              )}
              {rule.mode === "paid" && oneTimePrice && ctaKind !== "granted" && (
                <div className="inline-flex items-center gap-3 border border-border rounded-lg px-4 py-3 bg-background">
                  <span className="text-sm">
                    {t("paywall.buy")}: <strong>{oneTimePrice}</strong>
                    <span className="text-xs text-muted-foreground ml-1">
                      {t("paywall.oneTime")}
                    </span>
                  </span>
                  {signedIn ? (
                    <Button size="sm" onClick={startOneTime} disabled={busy || !!preview}>
                      {busy ? t("paywall.processing") : t("paywall.buy")}
                    </Button>
                  ) : (
                    <Link to="/login" search={loginTo("signup")} {...ctaProps("one_time")}>
                      <Button size="sm" variant="outline">
                        {t("paywall.signup")}
                      </Button>
                    </Link>
                  )}
                </div>
              )}
              {/* P09: kwota idzie w walucie planu - EN dostaje jawny napis. */}
              {lang === "en" && plans[0] && (
                <p className="text-xs text-muted-foreground">
                  {t("paywall.offer.chargedIn", { currency: plans[0].currency })}
                </p>
              )}
              {signedIn && (
                <p className="text-xs text-muted-foreground italic max-w-md mx-auto">
                  {t("paywall.secureNote")}
                </p>
              )}
              {/* Kanoniczny lejek: paywall odsyła do pełnego cennika (porównanie
                planów, FAQ) zamiast być równoległym, ślepym lejkiem. */}
              <Link
                to="/pricing"
                className="inline-block text-sm text-brand-ink hover:underline"
                {...ctaProps("pricing", undefined, rememberReturn)}
              >
                {t("paywall.seeAllPlans")} →
              </Link>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function buildAutoTeaser(text: string) {
  const plain = text
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const target = Math.max(120, Math.floor(plain.length * 0.2));
  if (plain.length <= target) return plain;
  const cut = plain.slice(0, target);
  const lastDot = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return (lastDot > 60 ? cut.slice(0, lastDot + 1) : cut).trim();
}
