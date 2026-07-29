// Formularz darowizny osadzany w widgecie CMS: warianty kwot + (opcjonalnie)
// własna kwota i wiadomość. Zawsze uruchamia `createDonationCheckout` przez
// wspólny hook - żadna ścieżka nie omija walidacji serwerowej.
import { useState, type CSSProperties } from "react";
import { Heart } from "@/lib/lucide-shim";
import { useDonationCheckout } from "@/hooks/useDonationCheckout";
import { parseCustomAmountCents } from "@/lib/billing/donationPresets";
import type { DonationCurrency } from "@/lib/billing/donations.schema";

export interface DonationAmountFormProps {
  presetsCents: number[];
  currency: DonationCurrency;
  lang: "pl" | "en";
  submitLabel: string;
  showCustomAmount?: boolean;
  showMessage?: boolean;
  accent?: string;
  className?: string;
}

const COPY = {
  pl: {
    custom: "Inna kwota",
    customPlaceholder: "np. 75",
    message: "Wiadomość (opcjonalnie)",
    messagePlaceholder: "Dlaczego wspierasz naszą redakcję?",
    secure: "Płatność obsługiwana przez operatora - bezpiecznie i szyfrowane.",
  },
  en: {
    custom: "Other amount",
    customPlaceholder: "e.g. 75",
    message: "Message (optional)",
    messagePlaceholder: "Why are you supporting our newsroom?",
    secure: "Payment handled by our provider - secure and encrypted.",
  },
} as const;

function money(cents: number, currency: DonationCurrency, lang: "pl" | "en"): string {
  try {
    return new Intl.NumberFormat(lang === "pl" ? "pl-PL" : "en-GB", {
      style: "currency",
      currency,
      maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(0)} ${currency}`;
  }
}

export function DonationAmountForm({
  presetsCents,
  currency,
  lang,
  submitLabel,
  showCustomAmount = true,
  showMessage = false,
  accent,
  className,
}: DonationAmountFormProps) {
  const c = COPY[lang];
  const { start, pending } = useDonationCheckout();
  const [selected, setSelected] = useState<number>(presetsCents[0] ?? 5000);
  const [custom, setCustom] = useState("");
  const [message, setMessage] = useState("");

  const customCents = custom.trim() ? parseCustomAmountCents(custom) : null;
  const effectiveCents = customCents ?? selected;

  const accentStyle: CSSProperties | undefined = accent
    ? { background: accent, color: "#fff", borderColor: accent }
    : undefined;

  return (
    <div className={className ?? "mt-4 space-y-3"}>
      <div className="flex flex-wrap gap-2" role="group" aria-label={submitLabel}>
        {presetsCents.map((cents) => {
          const active = !customCents && cents === selected;
          return (
            <button
              key={cents}
              type="button"
              aria-pressed={active}
              onClick={() => {
                setSelected(cents);
                setCustom("");
              }}
              className={`rounded-[6px] border px-3 py-2 text-sm font-semibold tabular-nums transition ${
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background hover:border-primary/60"
              }`}
              style={active ? accentStyle : undefined}
            >
              {money(cents, currency, lang)}
            </button>
          );
        })}
      </div>

      {showCustomAmount && (
        <label className="block text-xs font-medium text-muted-foreground">
          {c.custom}
          <input
            type="number"
            inputMode="decimal"
            min={5}
            value={custom}
            placeholder={c.customPlaceholder}
            onChange={(e) => setCustom(e.target.value)}
            className="mt-1 w-full rounded-[6px] border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/70"
          />
        </label>
      )}

      {showMessage && (
        <label className="block text-xs font-medium text-muted-foreground">
          {c.message}
          <textarea
            rows={2}
            value={message}
            maxLength={500}
            placeholder={c.messagePlaceholder}
            onChange={(e) => setMessage(e.target.value)}
            className="mt-1 w-full rounded-[6px] border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/70"
          />
        </label>
      )}

      <button
        type="button"
        disabled={pending}
        onClick={() =>
          void start({
            amountCents: effectiveCents,
            currency,
            message: showMessage ? message : undefined,
            lang,
          })
        }
        className="inline-flex w-full items-center justify-center gap-1.5 rounded-[6px] bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
        style={accent ? { background: accent, color: "#fff" } : undefined}
      >
        <Heart className="h-4 w-4" aria-hidden="true" />
        {submitLabel} · {money(effectiveCents, currency, lang)}
      </button>

      <p className="text-[11px] text-muted-foreground">{c.secure}</p>
    </div>
  );
}
