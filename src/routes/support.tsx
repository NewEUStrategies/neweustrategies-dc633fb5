// Publiczna strona darowizn / mecenatu obywatelskiego. URL: /support
// Darowizna nie nadaje uprawnień (to nie zakup) - patrz donations.functions.ts.
// Stany ?status=success|cancelled wracają ze Stripe Checkout.
import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { CheckCircle2, HandHeart, ShieldCheck, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createDonationCheckout } from "@/lib/billing/donations.functions";
import {
  DONATION_MAX_CENTS,
  DONATION_MIN_CENTS,
  DONATION_PRESETS_CENTS,
} from "@/lib/billing/donations.schema";
import { getRequestUrl } from "@/lib/seo/request";
import { activeLang } from "@/lib/seo/head";
import { buildContentHead } from "@/lib/seo/meta";
import { ensureI18n as ensureSupportI18n } from "@/lib/i18n-support";
export const Route = createFileRoute("/support")({
  validateSearch: (search: Record<string, unknown>) => ({
    status:
      search.status === "success" || search.status === "cancelled"
        ? (search.status as "success" | "cancelled")
        : undefined,
  }),
  component: SupportPage,
  head: () => {
    const url = getRequestUrl() || "/support";
    const lang = activeLang(url);
    return buildContentHead({
      url,
      lang,
      type: "website",
      title:
        lang === "en"
          ? "Support us - New European Strategies"
          : "Wesprzyj nas - New European Strategies",
      description:
        lang === "en"
          ? "Citizen patronage funds our independent analysis: the EU legislative tracker, reports and debates."
          : "Mecenat obywatelski finansuje naszą niezależną analizę: tracker legislacyjny UE, raporty i debaty.",
    });
  },
});

function formatZl(cents: number, lang: "pl" | "en"): string {
  return new Intl.NumberFormat(lang === "pl" ? "pl-PL" : "en-GB", {
    style: "currency",
    currency: "PLN",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function SupportPage() {
  // Rejestracja słowników w chunku trasy (nie w entry) - patrz lib/i18n-*.
  ensureSupportI18n();
  const { t, i18n } = useTranslation();
  const lang: "pl" | "en" = i18n.language === "en" ? "en" : "pl";
  const { status } = Route.useSearch();
  const donate = useServerFn(createDonationCheckout);

  const [selectedCents, setSelectedCents] = useState<number>(DONATION_PRESETS_CENTS[1]);
  const [customZl, setCustomZl] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  const effectiveCents = customZl.trim()
    ? Math.round(Number(customZl.replace(",", ".")) * 100)
    : selectedCents;
  const amountValid =
    Number.isFinite(effectiveCents) &&
    effectiveCents >= DONATION_MIN_CENTS &&
    effectiveCents <= DONATION_MAX_CENTS;

  const submit = async () => {
    if (!amountValid) {
      toast.error(t("support.amountError"));
      return;
    }
    setPending(true);
    try {
      const result = await donate({
        data: {
          amount_cents: effectiveCents,
          message: message.trim() || undefined,
          lang,
        },
      });
      if (result.ok) {
        window.location.assign(result.url);
        return;
      }
      toast.error(t("support.genericError"));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      toast.error(
        msg.includes("rate_limited") ? t("support.rateLimited") : t("support.genericError"),
      );
    } finally {
      setPending(false);
    }
  };

  if (status === "success" || status === "cancelled") {
    const ok = status === "success";
    return (
      <div className="container mx-auto max-w-xl px-4 py-16 text-center">
        {ok ? (
          <CheckCircle2 className="mx-auto h-12 w-12 text-primary" aria-hidden="true" />
        ) : (
          <XCircle className="mx-auto h-12 w-12 text-muted-foreground" aria-hidden="true" />
        )}
        <h1 className="mt-4 text-2xl font-bold">
          {ok ? t("support.successTitle") : t("support.cancelledTitle")}
        </h1>
        <p className="mt-2 text-muted-foreground">
          {ok ? t("support.successBody") : t("support.cancelledBody")}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Button asChild variant="outline">
            <Link to="/">{t("support.backHome")}</Link>
          </Button>
          <Button asChild>
            <Link to="/support" search={{ status: undefined }}>
              {t("support.another")}
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-2xl px-4 py-12">
      <h1 className="flex items-start gap-2 text-3xl font-bold">
        <HandHeart className="mt-1 h-7 w-7 shrink-0 text-primary" aria-hidden="true" />
        {t("support.title")}
      </h1>
      <p className="mt-3 text-muted-foreground">{t("support.intro")}</p>

      <Card className="mt-8">
        <CardContent className="space-y-5 pt-6">
          <fieldset>
            <legend className="text-sm font-medium">{t("support.presetsLabel")}</legend>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {DONATION_PRESETS_CENTS.map((cents) => {
                const active = !customZl.trim() && selectedCents === cents;
                return (
                  <Button
                    key={cents}
                    type="button"
                    variant={active ? "default" : "outline"}
                    aria-pressed={active}
                    onClick={() => {
                      setSelectedCents(cents);
                      setCustomZl("");
                    }}
                  >
                    {formatZl(cents, lang)}
                  </Button>
                );
              })}
            </div>
          </fieldset>

          <div>
            <Label htmlFor="donation-custom" className="text-sm font-medium">
              {t("support.customLabel")}
            </Label>
            <Input
              id="donation-custom"
              inputMode="decimal"
              className="mt-1"
              placeholder={t("support.customPlaceholder")}
              value={customZl}
              onChange={(e) => setCustomZl(e.target.value)}
              aria-invalid={customZl.trim() !== "" && !amountValid}
            />
            {customZl.trim() !== "" && !amountValid && (
              <p className="mt-1 text-xs text-destructive">{t("support.amountError")}</p>
            )}
          </div>

          <div>
            <Label htmlFor="donation-message" className="text-sm font-medium">
              {t("support.messageLabel")}
            </Label>
            <Textarea
              id="donation-message"
              className="mt-1"
              rows={2}
              maxLength={500}
              placeholder={t("support.messagePlaceholder")}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          </div>

          <Button className="w-full" size="lg" disabled={pending || !amountValid} onClick={submit}>
            {pending
              ? t("support.submitting")
              : `${t("support.submit")} — ${amountValid ? formatZl(effectiveCents, lang) : "…"}`}
          </Button>
          <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
            {t("support.secureNote")}
          </p>
        </CardContent>
      </Card>

      <section className="mt-10" aria-labelledby="support-why">
        <h2 id="support-why" className="text-lg font-semibold">
          {t("support.whyTitle")}
        </h2>
        <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
          {(t("support.whyItems", { returnObjects: true }) as unknown as string[]).map((item) => (
            <li key={item} className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              {item}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
