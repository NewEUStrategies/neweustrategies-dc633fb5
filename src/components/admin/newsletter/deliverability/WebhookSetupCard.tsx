// Organizm: status pętli zwrotnej dostawcy (webhook bounce/complaint).
//
// Najczęstszy powód, dla którego lista wykluczeń jest pusta mimo odbić, to
// niepodłączony webhook. Kafel mówi wprost: czy sekret jest ustawiony, jaki
// adres wkleić u dostawcy poczty, na jakie zdarzenia nasłuchiwać i kiedy
// ostatnio COKOLWIEK przyszło (bo skonfigurowany != działający).
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle2, Copy, AlertTriangle, Webhook } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { DeliverabilitySetup } from "@/lib/newsletter-deliverability.functions";
import "@/lib/i18n-newsletter-deliverability";

interface WebhookSetupCardProps {
  setup: DeliverabilitySetup;
  locale: string;
}

export function WebhookSetupCard({ setup, locale }: WebhookSetupCardProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const healthy = setup.webhookConfigured && setup.lastEventAt !== null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(setup.webhookUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Schowek bywa niedostępny (brak HTTPS / uprawnień) - adres i tak jest
      // widoczny na ekranie i można go zaznaczyć ręcznie.
    }
  };

  return (
    <section
      className={cn(
        "rounded-xl border p-5 space-y-4",
        setup.webhookConfigured ? "bg-card border-border" : "bg-amber-500/5 border-amber-500/40",
      )}
    >
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className={cn(
              "w-8 h-8 rounded-md flex items-center justify-center shrink-0",
              setup.webhookConfigured ? "bg-primary/10" : "bg-amber-500/15",
            )}
          >
            <Webhook
              className={cn(
                "w-4 h-4",
                setup.webhookConfigured ? "text-primary" : "text-amber-600 dark:text-amber-400",
              )}
            />
          </div>
          <div className="min-w-0">
            <h3 className="font-display text-lg leading-tight">
              {t("adminDeliverability.setup.title")}
            </h3>
            <p className="text-[11px] text-muted-foreground">
              {setup.lastEventAt
                ? t("adminDeliverability.setup.lastEvent", {
                    when: new Date(setup.lastEventAt).toLocaleString(locale),
                  })
                : t("adminDeliverability.setup.noEvents")}
            </p>
          </div>
        </div>
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium whitespace-nowrap",
            healthy
              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              : setup.webhookConfigured
                ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                : "bg-destructive/10 text-destructive",
          )}
        >
          {setup.webhookConfigured ? (
            <CheckCircle2 className="w-3.5 h-3.5" />
          ) : (
            <AlertTriangle className="w-3.5 h-3.5" />
          )}
          {setup.webhookConfigured
            ? t("adminDeliverability.setup.configured")
            : t("adminDeliverability.setup.missing")}
        </span>
      </header>

      {!setup.webhookConfigured && (
        <p className="text-xs text-amber-700 dark:text-amber-400 leading-relaxed">
          {t("adminDeliverability.setup.missingBody")}
        </p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-2 items-end">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">
            {t("adminDeliverability.setup.urlLabel")}
          </div>
          <code className="block w-full truncate rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-xs">
            {setup.webhookUrl || "-"}
          </code>
        </div>
        <Button variant="outline" size="sm" onClick={copy} disabled={!setup.webhookUrl}>
          <Copy className="w-3.5 h-3.5 mr-2" />
          {copied ? t("adminDeliverability.setup.copied") : t("adminDeliverability.setup.copy")}
        </Button>
      </div>

      <div>
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">
          {t("adminDeliverability.setup.eventsLabel")}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {setup.events.map((event) => (
            <code
              key={event}
              className="rounded border border-border bg-muted/40 px-2 py-0.5 font-mono text-[11px] text-muted-foreground"
            >
              {event}
            </code>
          ))}
        </div>
        {/* Lista powyżej zależy od tego, kto jest źródłem prawdy dla otwarć
            i kliknięć. Bez tego zdania operator dopisuje `email.opened` „na
            wszelki wypadek" i wraca podwójne zliczanie - usterka, którą zamyka
            migracja 20260814150000. */}
        <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
          {setup.engagementSource === "provider"
            ? t("adminDeliverability.setup.engagementProvider")
            : t("adminDeliverability.setup.engagementFirstParty")}
        </p>
      </div>
    </section>
  );
}
