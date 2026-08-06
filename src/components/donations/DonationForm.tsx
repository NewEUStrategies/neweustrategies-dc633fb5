// Formularz darowizny oparty o nasz własny checkout (organizm).
//
// Kwota jest wyłącznie SUGESTIĄ interfejsu - o dopuszczalnym zakresie decyduje
// serwer (`donations.server.ts`), więc manipulacja polem nie tworzy wpłaty
// spoza limitów. Walidacja po stronie klienta istnieje po to, żeby darczyńca
// zobaczył problem PRZED round-tripem, nie zamiast walidacji serwerowej.
//
// Modal kasy jest ładowany leniwie (`LazyEmbeddedCheckoutDialog`): SDK
// operatora nie ma prawa jechać do każdego, kto tylko otworzył stronę wpłaty.
// Chunk rozgrzewamy w momencie kliknięcia „przejdź do płatności", równolegle
// z tworzeniem sesji - użytkownik nie czeka szeregowo.
//
// Tryb `external` (zbiórka poza serwisem) degraduje formularz do jednego,
// jawnie oznaczonego linku - dokładnie tego samego celu, który wyznacza
// `resolveDonationTarget` dla CTA i strony /support.
import { useId, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { ExternalLink, HandHeart, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SegmentedControl } from "@/components/atoms/SegmentedControl";
import { LazyEmbeddedCheckoutDialog } from "@/components/checkout/LazyEmbeddedCheckoutDialog";
import { prefetchEmbeddedCheckoutDialog } from "@/components/checkout/checkoutDialogChunk";
import { getStripeEnvironment } from "@/lib/stripe";
import { normalizeCheckoutLocale } from "@/lib/billing/checkoutLocale";
import { createDonationCheckout, getDonationsPublicStats } from "@/lib/billing/donations.functions";
import { useDonationsConfig } from "@/lib/billing/donationsConfigQuery";
import {
  DONATION_MAX_CENTS,
  DONATION_MIN_CENTS,
  formatDonationAmount,
  type DonationsConfig,
} from "@/lib/billing/donationsConfig";
import "@/lib/i18n-donate";

type Mode = "once" | "monthly";

/** Granice wpłaty widoczne w interfejsie - te same, których pilnuje serwer. */
function amountBounds(config: DonationsConfig): { min: number; max: number } {
  return {
    min: Math.max(DONATION_MIN_CENTS, config.minCents),
    max: Math.min(DONATION_MAX_CENTS, config.maxCents),
  };
}

function useLang(): "pl" | "en" {
  const { i18n } = useTranslation();
  return i18n.language?.startsWith("en") ? "en" : "pl";
}

export function DonationForm({ className }: { className?: string }) {
  const { t } = useTranslation();
  const lang = useLang();
  const submit = useServerFn(createDonationCheckout);
  const fieldId = useId();

  const { config, target, isLoading } = useDonationsConfig();
  const statsQuery = useQuery({
    queryKey: ["donations", "stats"],
    queryFn: () => getDonationsPublicStats(),
    staleTime: 60_000,
    enabled: config.goalCents > 0,
  });

  const [mode, setMode] = useState<Mode>("once");
  const [selected, setSelected] = useState<number | null>(null);
  const [custom, setCustom] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [clientSecret, setClientSecret] = useState<string | null>(null);

  const presets = config.presetsCents;
  const amountCents = useMemo(() => {
    if (selected !== null) return selected;
    const parsed = Number.parseFloat(custom.replace(",", "."));
    return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
  }, [selected, custom]);

  const { min, max } = amountBounds(config);
  const amountEntered = amountCents > 0;
  const amountValid = amountCents >= min && amountCents <= max;
  const outOfRange = amountEntered && !amountValid;

  if (isLoading) {
    return <div className="h-40 animate-pulse rounded-md bg-muted" aria-hidden />;
  }
  if (target.kind === "disabled") {
    return <p className="text-sm text-muted-foreground">{t("donate.disabled")}</p>;
  }
  if (target.kind === "external") {
    return (
      <Button asChild size="lg">
        <a href={target.href} target="_blank" rel="noopener noreferrer">
          <HandHeart className="mr-2 h-4 w-4" aria-hidden />
          {t("donate.external")}
          <ExternalLink className="ml-2 h-3.5 w-3.5 opacity-80" aria-hidden />
          <span className="sr-only"> ({t("donate.newTab")})</span>
        </a>
      </Button>
    );
  }

  const goalCents = config.goalCents;
  const raisedCents = statsQuery.data?.totalCents ?? 0;
  const progress = goalCents > 0 ? Math.min(100, Math.round((raisedCents / goalCents) * 100)) : 0;
  const rangeHint = t("donate.range", {
    min: formatDonationAmount(min, config.currency, lang),
    max: formatDonationAmount(max, config.currency, lang),
  });

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!amountValid) {
      setError(t("donate.errors.amount_out_of_range"));
      return;
    }
    setPending(true);
    // Chunk kasy pobiera się równolegle z tworzeniem sesji, nie po nim.
    prefetchEmbeddedCheckoutDialog();
    try {
      const result = await submit({
        data: {
          environment: getStripeEnvironment(),
          amountCents,
          recurring: mode === "monthly",
          donorEmail: email.trim() || undefined,
          message: message.trim() || undefined,
          returnUrl: `${window.location.origin}/donate?status=thanks`,
          locale: normalizeCheckoutLocale(lang),
        },
      });
      if (!result.ok) {
        setError(t(`donate.errors.${result.error}`, { defaultValue: t("donate.errors.generic") }));
        return;
      }
      setClientSecret(result.clientSecret);
    } catch {
      setError(t("donate.errors.generic"));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className={className} noValidate>
      {goalCents > 0 && (
        <div className="mb-5">
          <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
            <span className="text-muted-foreground">{t("donate.raised")}</span>
            <span className="font-medium tabular-nums">
              {formatDonationAmount(raisedCents, config.currency, lang)} /{" "}
              {formatDonationAmount(goalCents, config.currency, lang)}
            </span>
          </div>
          <div
            role="progressbar"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={t("donate.goal")}
            className="h-2 w-full overflow-hidden rounded-full bg-muted"
          >
            <div
              className="h-full bg-primary transition-[width] duration-700 motion-reduce:transition-none"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {config.allowRecurring && (
        <div className="mb-4">
          <SegmentedControl<Mode>
            value={mode}
            onChange={setMode}
            ariaLabel={t("donate.frequency")}
            size="lg"
            options={[
              { value: "once", label: t("donate.once") },
              {
                value: "monthly",
                label: (
                  <>
                    <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                    {t("donate.monthly")}
                  </>
                ),
              },
            ]}
          />
          {mode === "monthly" && (
            <p className="mt-2 text-xs text-muted-foreground">{t("donate.recurringNote")}</p>
          )}
        </div>
      )}

      <fieldset className="mb-4">
        <legend className="mb-2 text-sm font-medium">{t("donate.amount")}</legend>
        <div className="flex flex-wrap gap-2">
          {presets.map((preset) => (
            <button
              key={preset}
              type="button"
              aria-pressed={selected === preset}
              onClick={() => {
                setSelected(preset);
                setCustom("");
                setError(null);
              }}
              className={`rounded-md border px-4 py-2 text-sm tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                selected === preset ? "border-primary bg-primary/10" : "hover:bg-muted"
              }`}
            >
              {formatDonationAmount(preset, config.currency, lang)}
            </button>
          ))}
        </div>
      </fieldset>

      {config.allowCustom && (
        <div className="mb-4">
          <label className="block text-sm" htmlFor={`${fieldId}-amount`}>
            <span className="mb-1 block font-medium">{t("donate.customAmount")}</span>
            <Input
              id={`${fieldId}-amount`}
              inputMode="decimal"
              autoComplete="off"
              value={custom}
              aria-describedby={`${fieldId}-range`}
              aria-invalid={outOfRange || undefined}
              onChange={(e) => {
                setCustom(e.target.value);
                setSelected(null);
                setError(null);
              }}
              placeholder={config.currency === "EUR" ? "50.00" : "100,00"}
            />
          </label>
          <p id={`${fieldId}-range`} className="mt-1 text-xs text-muted-foreground">
            {rangeHint}
          </p>
        </div>
      )}

      <label className="mb-4 block text-sm" htmlFor={`${fieldId}-email`}>
        <span className="mb-1 block font-medium">{t("donate.email")}</span>
        <Input
          id={`${fieldId}-email`}
          type="email"
          autoComplete="email"
          inputMode="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>

      {config.allowMessage && (
        <label className="mb-4 block text-sm" htmlFor={`${fieldId}-message`}>
          <span className="mb-1 block font-medium">{t("donate.message")}</span>
          <Textarea
            id={`${fieldId}-message`}
            value={message}
            onChange={(e) => setMessage(e.target.value.slice(0, 500))}
            rows={3}
            maxLength={500}
          />
          <span className="mt-1 block text-right text-xs text-muted-foreground tabular-nums">
            {message.length}/500
          </span>
        </label>
      )}

      <p role="alert" aria-live="polite" className="mb-3 min-h-[1.25rem] text-sm text-destructive">
        {error}
      </p>

      <Button
        type="submit"
        size="lg"
        disabled={pending || !amountValid}
        onPointerEnter={prefetchEmbeddedCheckoutDialog}
      >
        <HandHeart className="mr-2 h-4 w-4" aria-hidden />
        {pending ? t("donate.submitting") : t("donate.submit")}
      </Button>

      <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
        <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
        {t("donate.secure")}
      </p>

      <LazyEmbeddedCheckoutDialog
        clientSecret={clientSecret}
        onOpenChange={(open) => {
          if (!open) setClientSecret(null);
        }}
        title={mode === "monthly" ? t("donate.checkoutTitleMonthly") : t("donate.checkoutTitle")}
      />
    </form>
  );
}
