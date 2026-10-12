import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { fetchMyBillingProfile, fetchPlanById } from "@/lib/billing/queries";
import { formatMoney, planDescription, planName } from "@/lib/billing/types";
import { billingKeys } from "@/lib/billing/keys";
import {
  CHECKOUT_SUPERSEDED_ERROR,
  isLivePlanSubscriptionStatus,
  SUBSCRIPTION_EXISTS_ERROR,
  visiblePlanPurchaseConflict,
  type PlanPurchaseConflict,
} from "@/lib/billing/planSubscriptionGuard";
import { fetchMyStripeSubscription } from "@/lib/billing/subscriptionQueries";
import { getStripeEnvironmentSafe } from "@/lib/stripe";
import {
  convertToDisplayCurrency,
  displayCurrencyForLang,
  formatDisplayMoney,
} from "@/lib/billing/displayCurrency";

import { useCheckoutSettings } from "@/hooks/useCheckoutSettings";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { GuestCheckoutGate } from "@/components/checkout/GuestCheckoutGate";
import { CheckoutAssurances } from "@/components/checkout/CheckoutAssurances";
import { BillingProfileForm } from "@/components/billing/molecules/BillingProfileForm";
import { CouponInput } from "@/components/checkout/CouponInput";
import { FxRateNotice } from "@/components/checkout/FxRateNotice";
import { Lock, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { ensureI18n as ensureProfileI18n } from "@/lib/i18n-profile";
import { catalogPriceForPlan } from "@/lib/billing/catalog";
import {
  normalizeNewsletterLanguage,
  PREMIUM_NEWSLETTER_CONSENT_VERSION,
} from "@/lib/billing/premiumNewsletter";
import { useCheckout } from "@/hooks/useCheckout";
// Ramka operatora wchodzi przez granicę `React.lazy` (patrz nagłówek
// EmbeddedCheckoutFrame) - trasa checkoutu nie może być drugim statycznym
// importerem `@stripe/react-stripe-js`, bo wspólny przodek dwóch takich
// importerów to chunk entry, który pobiera każdy czytelnik.
import { EmbeddedCheckoutFrame } from "@/components/checkout/EmbeddedCheckoutFrame";
import { checkoutIntentHandlers } from "@/components/checkout/checkoutIntent";
import { PaymentTestModeBanner } from "@/components/PaymentTestModeBanner";
import { PROFILE_PLAN_PATH, PROFILE_PORTAL_PATH } from "@/lib/profile/routes";

/**
 * Komunikat i JEDYNA ścieżka, która dla danego konfliktu naprawdę działa
 * (`planPurchaseConflict` = reguła zmiany planu). Dawniej każdy konflikt
 * odsyłał do „Zmień plan", także tam, gdzie zmiana planu odmawia (ten sam
 * plan, cena spoza katalogu) - kupujący lądował w ślepym zaułku.
 */
const CONFLICT_PATH: Record<
  PlanPurchaseConflict,
  { message: string; cta: string; to: typeof PROFILE_PLAN_PATH | typeof PROFILE_PORTAL_PATH }
> = {
  change_plan: {
    message: "checkout.subscriptionExists",
    cta: "checkout.changePlanCta",
    to: PROFILE_PLAN_PATH,
  },
  same_plan: {
    message: "checkout.subscriptionSamePlan",
    cta: "checkout.manageSubscriptionCta",
    to: PROFILE_PLAN_PATH,
  },
  unmanaged: {
    message: "checkout.subscriptionUnmanaged",
    cta: "checkout.billingPortalCta",
    to: PROFILE_PORTAL_PATH,
  },
};

export const Route = createFileRoute("/checkout/$planId")({
  component: CheckoutPage,
  head: () => ({
    meta: [
      { title: "Checkout · Finalizacja zamówienia" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

function CheckoutPage() {
  // Rejestracja słowników w chunku trasy (nie w entry) - patrz lib/i18n-*.
  ensureProfileI18n();
  const { planId } = Route.useParams();
  const { t, i18n } = useTranslation();
  const { session } = useAuth();
  const [busy, setBusy] = useState(false);
  const [coupon, setCoupon] = useState<{ code: string; discountCents: number } | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  // Zgoda na newsletter: pole NIEZAZNACZONE domyślnie i niezależne od zakupu
  // (art. 7 ust. 4 RODO - zgoda nie jest warunkiem umowy). Tylko jawne
  // zaznaczenie wysyła zgodę na serwer; bez niego zakup nie dotyka listy (SUB-15).
  const [newsletterOptIn, setNewsletterOptIn] = useState(false);
  // Po utworzeniu sesji przewijamy do ramki - inaczej na mobile formularz
  // płatności ląduje poza ekranem i wygląda, jakby przycisk nic nie zrobił.
  const frameRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (clientSecret) frameRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [clientSecret]);
  const { openPlanCheckout } = useCheckout();
  const queryClient = useQueryClient();

  const plan = useQuery({
    queryKey: ["plan", planId],
    queryFn: () => fetchPlanById(planId),
  });

  const billing = useQuery({
    queryKey: ["my-billing"],
    queryFn: fetchMyBillingProfile,
    enabled: !!session,
  });

  const { data: checkoutSettings } = useCheckoutSettings();

  // Subskrypcja kupującego w tym środowisku (lustro `subscriptions` pod RLS).
  // To tylko PODPOWIEDŹ dla nakładki - serwer sprawdza to samo i odmawia
  // (`subscription_exists`), ale klient ma się o tym dowiedzieć przed
  // kliknięciem, a nie dopiero po nim. Ten sam klucz co profil, więc odczyt
  // współdzieli cache z kartą subskrypcji.
  const stripeEnv = getStripeEnvironmentSafe();
  const mySubscription = useQuery({
    queryKey: billingKeys.myStripeSubscription(session?.user?.id, stripeEnv),
    queryFn: fetchMyStripeSubscription,
    enabled: !!session,
  });

  // IZOLACJA OBSZARÓW ROBOCZYCH. Autorytetem jest RLS i NIE WOLNO go tu dublować
  // porównaniem z tenantem z profilu (`useAuth().tenantId`). `access_plans` czyta
  // polityka `plans public read` przez `public_tenant_id()`, czyli tenanta
  // PRZEGLĄDANEJ domeny, a ta funkcja rozstrzyga go szczeblem zaufania hosta:
  //   * poświadczenie krawędzi (host zweryfikowany) -> DOWOLNY tenant, więc
  //     czytelnik z tenantem domowym A legalnie kupuje plan tenanta B na domenie B;
  //   * sama deklaracja `x-tenant-host` u ZALOGOWANEGO -> tenant domowy, jeśli host
  //     mówi coś innego (host nie jest dowodem tożsamości obszaru roboczego).
  // Klient porównujący `plan.tenant_id` z tenantem z profilu byłby więc albo
  // no-opem (drugi przypadek: te wartości są wtedy równe z konstrukcji), albo
  // BLOKADĄ legalnego zakupu (pierwszy przypadek) - patrz test „kupujący z innym
  // tenantem domowym...". Brak planu z odczytu = brak oferty; to cała reguła.
  const planData = plan.data ?? null;

  useEffect(() => {
    if (plan.isSuccess && !planData) {
      toast.error(t("checkout.notFound"));
    }
  }, [plan.isSuccess, planData, t]);

  const hasBilling = !!billing.data?.address_line1 && !!billing.data?.city;
  // Tryb sesji u operatora wynika z cyklu planu - plan jednorazowy jedzie jako
  // `payment`, każdy cykliczny jako `subscription` (patrz `catalog.ts`).
  const checkoutMode: "payment" | "subscription" =
    planData?.interval === "one_time" ? "payment" : "subscription";
  // Język etykiety zgody = język zapisany w dowodzie. Słownik bierze treść
  // z tego samego rejestru wersji, z którego serwer odtworzy tekst.
  const consentLang = normalizeNewsletterLanguage(i18n.language);
  const offersNewsletterOptIn = checkoutMode === "subscription";
  const displayCurrency = displayCurrencyForLang(i18n.language);
  const planCurrency = planData?.currency ?? "PLN";
  // Kwoty do wyświetlenia po konwersji (parytet z /pricing i /support).
  const originalDisplay = convertToDisplayCurrency(
    planData?.price_cents ?? 0,
    planCurrency,
    displayCurrency,
  );
  const discountDisplay = convertToDisplayCurrency(
    coupon?.discountCents ?? 0,
    planCurrency,
    displayCurrency,
  );
  const finalCentsDisplay = Math.max(originalDisplay.cents - discountDisplay.cents, 0);

  const existingSubscription = mySubscription.data ?? null;
  // Żywa subskrypcja planu blokuje drugi zakup TYLKO tam, gdzie istnieje
  // działająca ścieżka obok (zmiana planu, zarządzanie, portal) - ta sama
  // reguła co na serwerze (`planSubscriptionGuard`). `incomplete` (porzucone
  // 3DS) nie blokuje: serwer unieważnia jego fakturę przed nową sesją.
  const purchaseConflict: PlanPurchaseConflict | null =
    checkoutMode === "subscription" && planData
      ? visiblePlanPurchaseConflict(existingSubscription, catalogPriceForPlan(planData))
      : null;
  const blockedByExistingSubscription = purchaseConflict !== null;
  const conflictPath = purchaseConflict ? CONFLICT_PATH[purchaseConflict] : null;
  // Inny model rozliczenia (Zespół za miejsce <-> plan indywidualny) to OSOBNY
  // zakup - zmiana planu go odrzuca. Obecna subskrypcja zostaje i dalej
  // obciąża, więc kupujący ma to wiedzieć przed płatnością; profil pokazuje
  // tylko najnowszą subskrypcję, dlatego jej rezygnacja idzie przez portal.
  const separatePurchase =
    checkoutMode === "subscription" &&
    !purchaseConflict &&
    isLivePlanSubscriptionStatus(existingSubscription?.status);
  // Trial raz na konto: kto miał już subskrypcję planu, nie dostanie okresu
  // próbnego, więc nakładka nie może go obiecywać. Wolimy nie obiecać triala,
  // który by przysługiwał, niż obiecać taki, którego operator nie da.
  const trialOffered =
    !!planData &&
    planData.trial_days > 0 &&
    planData.interval !== "one_time" &&
    mySubscription.isSuccess &&
    existingSubscription === null;

  const submit = async () => {
    if (!planData || !hasBilling) return;
    setBusy(true);
    try {
      const price = catalogPriceForPlan(planData);
      if (!price) {
        toast.error(t("checkout.paymentsNotConfigured"));
        setBusy(false);
        return;
      }
      const result = await openPlanCheckout({
        planId: planData.id,
        priceId: price.priceId,
        couponCode: coupon?.code,
        returnUrl: `${window.location.origin}/checkout/success`,
        newsletterConsent:
          offersNewsletterOptIn && newsletterOptIn
            ? { version: PREMIUM_NEWSLETTER_CONSENT_VERSION, lang: consentLang }
            : undefined,
      });
      if (!result.ok) {
        if (result.error === SUBSCRIPTION_EXISTS_ERROR) {
          // Serwer widzi pełną historię (i operatora) - nakładka tylko najnowszy
          // wiersz lustra. Odświeżenie pokazuje kartę z właściwą ścieżką.
          toast.error(t((conflictPath ?? CONFLICT_PATH.change_plan).message));
          void queryClient.invalidateQueries({ queryKey: billingKeys.myStripeSubscriptionAll() });
        } else if (result.error === CHECKOUT_SUPERSEDED_ERROR) {
          // Równolegle otwarta płatność (druga karta) wygrała - ta jest wygaszona.
          toast.error(t("checkout.sessionSuperseded"));
        } else if (result.error === "not_found" || result.error === "limit_reached") {
          toast.error(t("checkout.applyFailed"));
        } else if (result.error === "rate_limited") {
          // Limit prób kodów - to nie brak konfiguracji płatności.
          toast.error(t("coupon.error.rateLimited"));
        } else {
          toast.error(t("checkout.paymentsNotConfigured"));
        }
        setBusy(false);
        return;
      }
      setClientSecret(result.session.clientSecret);
      setBusy(false);
    } catch {
      // Never surface a raw backend error string to the visitor.
      toast.error(t("checkout.paymentsNotConfigured"));
      setBusy(false);
    }
  };

  return (
    <GuestCheckoutGate>
      <div className="container mx-auto max-w-4xl px-4 py-12">
        <h1 className="text-3xl font-bold mb-8">{t("checkout.title")}</h1>
        <div className="grid gap-8 md:grid-cols-[1fr_360px]">
          <section className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>{t("checkout.billingDetails")}</CardTitle>
              </CardHeader>
              <CardContent>
                {hasBilling ? (
                  <div className="space-y-1 text-sm">
                    <div className="font-medium">
                      {billing.data?.is_company ? billing.data?.company : billing.data?.full_name}
                    </div>
                    {billing.data?.tax_id && (
                      <div className="text-muted-foreground">NIP: {billing.data.tax_id}</div>
                    )}
                    <div>{billing.data?.address_line1}</div>
                    {billing.data?.address_line2 && <div>{billing.data.address_line2}</div>}
                    <div>
                      {billing.data?.postal_code} {billing.data?.city}
                    </div>
                    <div>{billing.data?.country_code}</div>
                    <Button asChild variant="link" className="p-0 h-auto">
                      <Link to="/profile/billing">{t("profile.billing.title")}</Link>
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">{t("checkout.fillBilling")}</p>
                    {/* Capture billing inline - no ejecting out of the funnel. On
                        save the my-billing query invalidates, hasBilling flips and
                        the pay button enables in place. */}
                    <BillingProfileForm submitLabel={t("checkout.saveBillingContinue")} />
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{t("checkout.paymentMethod")}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <ShieldCheck className="h-4 w-4 text-primary" />
                  <span>{t("checkout.secured")}</span>
                </div>
              </CardContent>
            </Card>
          </section>

          <aside>
            <Card className="sticky top-6">
              <CardHeader>
                <CardTitle>{t("checkout.summary")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {planData ? (
                  <>
                    <div>
                      <div className="text-xs uppercase text-muted-foreground">
                        {t("checkout.item")}
                      </div>
                      <div className="font-semibold">{planName(planData, i18n.language)}</div>
                      {planDescription(planData, i18n.language) && (
                        <p className="text-sm text-muted-foreground">
                          {planDescription(planData, i18n.language)}
                        </p>
                      )}
                    </div>
                    {conflictPath ? (
                      <div className="space-y-2 rounded-md border px-3 py-2 text-xs">
                        <p>{t(conflictPath.message)}</p>
                        <Button asChild variant="link" className="h-auto p-0 text-xs">
                          <Link to={conflictPath.to}>{t(conflictPath.cta)}</Link>
                        </Button>
                      </div>
                    ) : separatePurchase ? (
                      <div className="space-y-2 rounded-md border px-3 py-2 text-xs">
                        <p>{t("checkout.separatePurchase")}</p>
                        <Button asChild variant="link" className="h-auto p-0 text-xs">
                          <Link to={PROFILE_PORTAL_PATH}>{t("checkout.billingPortalCta")}</Link>
                        </Button>
                      </div>
                    ) : trialOffered ? (
                      <p className="rounded-md bg-primary/10 px-3 py-2 text-xs font-medium text-primary">
                        {t("checkout.trialLine", { days: planData.trial_days })}
                      </p>
                    ) : null}
                    <CouponInput
                      planId={planData.id}
                      amountCents={planData.price_cents}
                      currency={planData.currency}
                      onChange={(payload) =>
                        setCoupon(
                          payload
                            ? {
                                code: payload.code,
                                discountCents: payload.result.discount_cents,
                              }
                            : null,
                        )
                      }
                    />
                    <FxRateNotice displayCurrency={displayCurrency} />
                    <div className="border-t pt-4 space-y-1">
                      {coupon && coupon.discountCents > 0 && (
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>{t("checkout.subtotal")}</span>
                          <span className="line-through">
                            {formatDisplayMoney(planData.price_cents, planCurrency, i18n.language)}
                          </span>
                        </div>
                      )}
                      {coupon && coupon.discountCents > 0 && (
                        <div className="flex items-center justify-between text-xs text-emerald-600 dark:text-emerald-400">
                          <span>{t("coupon.discount")}</span>
                          <span>
                            -{formatDisplayMoney(coupon.discountCents, planCurrency, i18n.language)}
                          </span>
                        </div>
                      )}

                      <div className="flex items-center justify-between pt-1">
                        <span className="font-medium">{t("checkout.total")}</span>
                        <span className="text-2xl font-bold">
                          {formatMoney(finalCentsDisplay, originalDisplay.currency, i18n.language)}
                        </span>
                      </div>
                    </div>
                    {/* Po utworzeniu sesji pole jest zablokowane: decyzja już
                        jedzie w metadanych tej sesji, a przełączenie po cichu
                        rozjechałoby ekran z dowodem (nowa sesja = nowe
                        zamówienie i druga rezerwacja kuponu). Wycofanie zgody
                        to jeden klik w każdej wiadomości. */}
                    {offersNewsletterOptIn && (
                      <label
                        htmlFor="checkout-newsletter-opt-in"
                        className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground"
                      >
                        <Checkbox
                          id="checkout-newsletter-opt-in"
                          checked={newsletterOptIn}
                          onCheckedChange={(value) => setNewsletterOptIn(value === true)}
                          disabled={busy || !!clientSecret}
                          className="mt-0.5 h-4 w-4"
                        />
                        <span>{t("checkout.newsletterOptIn")}</span>
                      </label>
                    )}
                    <Button
                      className="w-full"
                      size="lg"
                      disabled={busy || !hasBilling || blockedByExistingSubscription}
                      onClick={submit}
                      {...checkoutIntentHandlers}
                    >
                      {busy ? (
                        t("checkout.processing")
                      ) : (
                        <>
                          <Lock className="mr-2 h-4 w-4" />
                          {t("checkout.payNow", {
                            amount: formatMoney(
                              finalCentsDisplay,
                              originalDisplay.currency,
                              i18n.language,
                            ),
                          })}
                        </>
                      )}
                    </Button>
                    <p className="text-xs text-muted-foreground text-center">
                      {t("checkout.terms")}
                    </p>
                    {/* Wskazówki liczone tą samą czystą funkcją, którą serwer
                        rozwija w parametrach sesji Stripe - obietnica nie może
                        rozjechać się z tym, co zobaczy kupujący w formularzu. */}
                    <CheckoutAssurances
                      settings={checkoutSettings}
                      mode={checkoutMode}
                      hasDiscount={!!coupon && coupon.discountCents > 0}
                    />
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">{t("checkout.notFound")}</p>
                )}
              </CardContent>
            </Card>
          </aside>
        </div>

        {/* Formularz operatora dostaje pełną szerokość kontenera - w kolumnie
            360 px ramka Stripe zwijała się do jednokolumnowego widoku i pola
            karty wychodziły poza kartę podsumowania. */}
        {clientSecret && (
          <div ref={frameRef} className="mt-10 space-y-3">
            <PaymentTestModeBanner />
            <EmbeddedCheckoutFrame clientSecret={clientSecret} />
          </div>
        )}
      </div>
    </GuestCheckoutGate>
  );
}
