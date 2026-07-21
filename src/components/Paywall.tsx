import { useEffect, useState } from "react";
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
// Jeden silnik pieniędzy dla całego lejka: ten sam locale-aware formatter co
// /pricing i checkout (poprzedni, lokalny formatMoney hardkodował pl-PL, więc
// anglojęzyczny czytelnik widział polskie formatowanie cen na paywallu).
import { formatMoney, planDescription, planName } from "@/lib/billing/types";
import { createCheckoutOrder } from "@/lib/billing/checkout.functions";
import { meterPaywallVariant, type MeterState, type MeteringSettings } from "@/lib/access/metering";
import "@/lib/i18n-paywall";

type Props = {
  rule: ContentAccessRule;
  lang: "pl" | "en";
  /** Raw text content for auto-teaser when no manual teaser set */
  fallbackText?: string | null;
  /** Fired by password mode after a successful verify with the unlocked body. */
  onPasswordVerify?: (password: string) => Promise<boolean>;
  /** Async loading indicator forwarded from the parent's password unlock hook. */
  passwordVerifying?: boolean;
  /** Metering paywalla: konfiguracja tenantu (jeśli włączona). */
  meterSettings?: MeteringSettings | null;
  /** Czy ten byt uczestniczy w meteringu (meteringApplies z resolvera). */
  meterApplies?: boolean;
  /** Stan licznika z próby odblokowania (null, gdy nie próbowano). */
  meterState?: MeterState | null;
};

const MAX_ATTEMPTS = 5;
const LOCKOUT_SECONDS = 30;

export function Paywall({
  rule,
  lang,
  fallbackText,
  onPasswordVerify,
  passwordVerifying,
  meterSettings = null,
  meterApplies = false,
  meterState = null,
}: Props) {
  const { t } = useTranslation();
  const { session } = useAuth();
  const navigate = useNavigate();
  const checkout = useServerFn(createCheckoutOrder);
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState("");
  const [pwdError, setPwdError] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [lockUntil, setLockUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [hint, setHint] = useState<string | null>(null);
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
      setPwdError(false);
    }
  }, [now, lockUntil]);

  const [plans, setPlans] = useState<AccessPlan[]>([]);
  useEffect(() => {
    if (rule.mode !== "paid" || rule.plan_ids.length === 0) return;
    supabase
      .from("access_plans")
      .select("*")
      .in("id", rule.plan_ids)
      .eq("active", true)
      .order("sort_order")
      .then(({ data }) => setPlans((data as AccessPlan[]) ?? []));
  }, [rule.plan_ids, rule.mode]);

  // Load hint for password mode (never returns the hash).
  useEffect(() => {
    if (rule.mode !== "password" || !rule.entity_id) return;
    supabase
      .rpc("get_password_hint", {
        _entity_type: rule.entity_type,
        _entity_id: rule.entity_id,
      })
      .then(({ data }) => {
        const row = Array.isArray(data) ? data[0] : null;
        setHint((lang === "pl" ? row?.hint_pl : row?.hint_en) ?? null);
      });
  }, [rule.mode, rule.entity_type, rule.entity_id, lang]);

  const submitPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onPasswordVerify || !password.trim() || passwordVerifying || locked) return;
    const ok = await onPasswordVerify(password);
    if (ok) {
      setPwdError(false);
      setAttempts(0);
      return;
    }
    const next = attempts + 1;
    setAttempts(next);
    setPwdError(true);
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
    isLoggedIn: !!session,
    settings: meterSettings,
    applies: meterApplies,
    state: meterState,
  });

  const buyableEntity = rule.entity_type === "post" || rule.entity_type === "page";
  const startOneTime = async () => {
    if (!session) return;
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
        },
      });
      if (!res.ok) {
        toast.error(t("paywall.checkoutFail"));
        setBusy(false);
        return;
      }
      if (res.mode === "stripe") {
        window.location.href = res.url;
      } else {
        void navigate({ to: "/checkout/success", search: { order: res.orderId, mock: 1 } });
      }
    } catch {
      toast.error(t("paywall.checkoutFail"));
      setBusy(false);
    }
  };

  return (
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
              : rule.mode === "members"
                ? t("paywall.membersDesc")
                : rule.mode === "password"
                  ? t("paywall.passwordDesc")
                  : t("paywall.paidDesc")}
        </p>

        {/* Password-protected */}
        {rule.mode === "password" && (
          <form onSubmit={submitPassword} className="max-w-sm mx-auto space-y-2.5">
            {hint && (
              <p className="text-xs text-muted-foreground">
                <span className="font-medium">{t("paywall.passwordHintLabel")}</span> {hint}
              </p>
            )}
            <div className="flex gap-2">
              <Input
                type="password"
                autoComplete="off"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (pwdError) setPwdError(false);
                }}
                placeholder={t("paywall.passwordPlaceholder")}
                aria-invalid={pwdError}
                aria-label={t("paywall.passwordPlaceholder")}
                disabled={passwordVerifying || locked}
                className={pwdError ? "border-destructive focus-visible:ring-destructive/40" : ""}
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
            ) : pwdError ? (
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
            ) : null}
          </form>
        )}

        {/* Members-only / not logged in. Wariant "register" odwraca akcenty:
            rejestracja (wejście do darmowego limitu meteringu) jest primary. */}
        {rule.mode !== "password" && !session && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-center gap-3">
              {meterVariant === "register" ? (
                <>
                  <Link to="/login" search={{ mode: "signup" }}>
                    <Button>{t("paywall.signup")}</Button>
                  </Link>
                  <Link to="/login">
                    <Button variant="outline">
                      <LogIn className="w-4 h-4 mr-2" /> {t("paywall.signin")}
                    </Button>
                  </Link>
                </>
              ) : (
                <>
                  <Link to="/login">
                    <Button>
                      <LogIn className="w-4 h-4 mr-2" /> {t("paywall.signin")}
                    </Button>
                  </Link>
                  <Link to="/login" search={{ mode: "signup" }}>
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

        {/* Paid - logged in, show plans + one-time */}
        {session && rule.mode === "paid" && (
          <div className="space-y-4">
            {plans.length > 0 && (
              <div className="grid sm:grid-cols-2 gap-3 max-w-2xl mx-auto text-left">
                {plans.map((p) => {
                  const name = planName(p, lang);
                  const desc = planDescription(p, lang);
                  const intervalLabel =
                    p.interval === "month"
                      ? t("paywall.perMonth")
                      : p.interval === "year"
                        ? t("paywall.perYear")
                        : t("paywall.oneTime");
                  return (
                    <div
                      key={p.id}
                      className="border border-border rounded-lg p-4 bg-background hover:border-brand transition"
                    >
                      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-brand-ink mb-1">
                        <Star className="w-3.5 h-3.5" /> {name}
                      </div>
                      <div className="text-2xl font-bold">
                        {formatMoney(p.price_cents, p.currency, lang)}
                        <span className="text-xs font-normal text-muted-foreground ml-1">
                          {intervalLabel}
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
                        <Link
                          to="/checkout/$planId"
                          params={{ planId: p.id }}
                          onClick={rememberReturn}
                        >
                          {t("paywall.subscribe")}
                        </Link>
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
            {buyableEntity &&
              rule.one_time_price_cents != null &&
              rule.one_time_price_cents > 0 && (
                <div className="inline-flex items-center gap-3 border border-border rounded-lg px-4 py-3 bg-background">
                  <span className="text-sm">
                    {t("paywall.buy")}:{" "}
                    <strong>
                      {formatMoney(
                        rule.one_time_price_cents,
                        rule.one_time_currency || "PLN",
                        lang,
                      )}
                    </strong>
                    <span className="text-xs text-muted-foreground ml-1">
                      {t("paywall.oneTime")}
                    </span>
                  </span>
                  <Button size="sm" onClick={startOneTime} disabled={busy}>
                    {busy ? t("paywall.processing") : t("paywall.buy")}
                  </Button>
                </div>
              )}
            <p className="text-xs text-muted-foreground italic max-w-md mx-auto">
              {t("paywall.secureNote")}
            </p>
            {/* Kanoniczny lejek: paywall odsyła do pełnego cennika (porównanie
                planów, FAQ) zamiast być równoległym, ślepym lejkiem. */}
            <Link
              to="/pricing"
              className="inline-block text-sm text-brand-ink hover:underline"
              onClick={rememberReturn}
            >
              {t("paywall.seeAllPlans")} →
            </Link>
          </div>
        )}
      </div>
    </div>
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
