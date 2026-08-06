// Formularz darowizny oparty o nasz własny checkout Stripe.
//
// Kwota jest wyłącznie SUGESTIĄ interfejsu - o dopuszczalnym zakresie decyduje
// serwer (`donations.server.ts`), więc manipulacja polem nie tworzy wpłaty
// spoza limitów. Po utworzeniu sesji formularz osadza Stripe Embedded Checkout
// w modalu, bez opuszczania serwisu.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { HandHeart, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { EmbeddedCheckoutDialog } from "@/components/checkout/EmbeddedCheckoutDialog";
import { checkoutIntentHandlers } from "@/components/checkout/checkoutIntent";
import { getStripeEnvironment } from "@/lib/stripe";
import { normalizeCheckoutLocale } from "@/lib/billing/checkoutLocale";
import {
  createDonationCheckout,
  getDonationsConfig,
  getDonationsPublicStats,
} from "@/lib/billing/donations.functions";
import { formatDonationAmount, type DonationsConfig } from "@/lib/billing/donationsConfig";
import "@/lib/i18n-donate";

type Mode = "once" | "monthly";

function useLang(): "pl" | "en" {
  const { i18n } = useTranslation();
  return i18n.language?.startsWith("en") ? "en" : "pl";
}

export function DonationForm({ className }: { className?: string }) {
  const { t } = useTranslation();
  const lang = useLang();
  const submit = useServerFn(createDonationCheckout);

  const configQuery = useQuery({
    queryKey: ["donations", "config"],
    queryFn: () => getDonationsConfig(),
    staleTime: 5 * 60_000,
  });
  const statsQuery = useQuery({
    queryKey: ["donations", "stats"],
    queryFn: () => getDonationsPublicStats(),
    staleTime: 60_000,
  });

  const config: DonationsConfig | undefined = configQuery.data;
  const [mode, setMode] = useState<Mode>("once");
  const [selected, setSelected] = useState<number | null>(null);
  const [custom, setCustom] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [clientSecret, setClientSecret] = useState<string | null>(null);

  const presets = config?.presetsCents ?? [];
  const amountCents = useMemo(() => {
    if (selected !== null) return selected;
    const parsed = Number.parseFloat(custom.replace(",", "."));
    return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
  }, [selected, custom]);

  if (configQuery.isLoading) {
    return <div className="h-40 animate-pulse rounded-md bg-muted" aria-hidden />;
  }
  if (!config || !config.enabled) {
    return <p className="text-sm text-muted-foreground">{t("donate.disabled")}</p>;
  }
  if (config.provider === "external") {
    return (
      <Button asChild size="lg">
        <a href={config.externalUrl} target="_blank" rel="noopener noreferrer">
          <HandHeart className="mr-2 h-4 w-4" aria-hidden />
          {t("donate.external")}
        </a>
      </Button>
    );
  }

  const goalCents = config.goalCents;
  const raisedCents = statsQuery.data?.totalCents ?? 0;
  const progress = goalCents > 0 ? Math.min(100, Math.round((raisedCents / goalCents) * 100)) : 0;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!config) return;
    setError(null);
    setPending(true);
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
    <form onSubmit={handleSubmit} className={className}>
      {goalCents > 0 && (
        <div className="mb-5">
          <div className="mb-1 flex items-baseline justify-between text-sm">
            <span className="text-muted-foreground">{t("donate.raised")}</span>
            <span className="font-medium">
              {formatDonationAmount(raisedCents, config.currency, lang)} /{" "}
              {formatDonationAmount(goalCents, config.currency, lang)}
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-primary" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}

      {config.allowRecurring && (
        <div
          className="mb-4 inline-flex rounded-md border p-1"
          role="radiogroup"
          aria-label={t("donate.amount")}
        >
          {(["once", "monthly"] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={mode === value}
              onClick={() => setMode(value)}
              className={`rounded px-3 py-1.5 text-sm transition-colors ${
                mode === value ? "bg-primary text-primary-foreground" : "text-muted-foreground"
              }`}
            >
              {t(`donate.${value}`)}
            </button>
          ))}
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
              }}
              className={`rounded-md border px-4 py-2 text-sm transition-colors ${
                selected === preset ? "border-primary bg-primary/10" : "hover:bg-muted"
              }`}
            >
              {formatDonationAmount(preset, config.currency, lang)}
            </button>
          ))}
        </div>
      </fieldset>

      {config.allowCustom && (
        <label className="mb-4 block text-sm">
          <span className="mb-1 block font-medium">{t("donate.customAmount")}</span>
          <Input
            inputMode="decimal"
            value={custom}
            onChange={(e) => {
              setCustom(e.target.value);
              setSelected(null);
            }}
            placeholder={config.currency === "EUR" ? "50.00" : "100,00"}
          />
        </label>
      )}

      <label className="mb-4 block text-sm">
        <span className="mb-1 block font-medium">{t("donate.email")}</span>
        <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>

      {config.allowMessage && (
        <label className="mb-4 block text-sm">
          <span className="mb-1 block font-medium">{t("donate.message")}</span>
          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={3}
            maxLength={500}
          />
        </label>
      )}

      {error && (
        <p role="alert" className="mb-3 text-sm text-destructive">
          {error}
        </p>
      )}

      <Button
        type="submit"
        size="lg"
        disabled={pending || amountCents <= 0}
        {...checkoutIntentHandlers}
      >
        <HandHeart className="mr-2 h-4 w-4" aria-hidden />
        {pending ? t("donate.submitting") : t("donate.submit")}
      </Button>

      <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
        <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
        {t("donate.secure")}
      </p>

      <EmbeddedCheckoutDialog
        clientSecret={clientSecret}
        onOpenChange={(open) => {
          if (!open) setClientSecret(null);
        }}
        title={t("donate.checkoutTitle")}
      />
    </form>
  );
}
