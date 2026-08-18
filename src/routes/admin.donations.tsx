// Admin → Darowizny. Konfiguracja własnego checkoutu darowizn (Stripe) oraz
// rejestr wpłat. Zapis do site_settings[key="donations"] - dokładnie ten sam
// kształt czyta publiczny formularz /donate.
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useSettings, useDraft } from "@/lib/admin/useSettings";
import { Field, Text, Checkbox, SaveBar, NumberInput } from "@/components/admin/settings/fields";
import { Button } from "@/components/ui/button";
import { getStripeEnvironmentSafe } from "@/lib/stripe";
import { getDonationsPublicStats } from "@/lib/billing/donations.functions";
import {
  listDonationRecords,
  syncDonationsWithStripe,
} from "@/lib/billing/donationsAdmin.functions";
import type { DonationsSyncReport } from "@/lib/billing/donationsAdmin.server";
import {
  DONATIONS_DEFAULTS,
  DONATIONS_SETTINGS_KEY,
  formatDonationAmount,
  type DonationsConfig,
} from "@/lib/billing/donationsConfig";
import { ensureI18n as ensureDonateI18n } from "@/lib/i18n-donate";

export const Route = createFileRoute("/admin/donations")({
  head: () => ({
    meta: [{ title: "Darowizny - Panel" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  component: AdminDonations,
});

function AdminDonations() {
  // Rejestracja słownika w chunku KOMPONENTU trasy (nie w entry) - patrz
  // komentarz przy ensureI18n w lib/i18n-donate.ts.
  ensureDonateI18n();
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith("en") ? "en" : "pl";
  const { query, save } = useSettings<DonationsConfig>(DONATIONS_SETTINGS_KEY, DONATIONS_DEFAULTS);
  const [draft, setDraft] = useDraft(query.data);
  const stats = useQuery({
    queryKey: ["donations", "stats", "admin"],
    queryFn: () => getDonationsPublicStats(),
    staleTime: 60_000,
  });
  const [environment, setEnvironment] = useState<"sandbox" | "live">(getStripeEnvironmentSafe());
  const [syncReport, setSyncReport] = useState<DonationsSyncReport | null>(null);
  const records = useQuery({
    queryKey: ["donations", "records", "admin"],
    queryFn: () => listDonationRecords({ data: { limit: 50 } }),
    staleTime: 30_000,
  });
  const sync = useMutation({
    mutationFn: () => syncDonationsWithStripe({ data: { environment, sinceHours: 168 } }),
    onSuccess: (report) => {
      setSyncReport(report);
      void records.refetch();
      void stats.refetch();
    },
  });

  if (!draft) return <p className="text-sm text-muted-foreground">{t("admin.loading")}</p>;

  const currency = draft.currency;

  return (
    <div>
      <h2 className="font-display text-xl">Darowizny</h2>
      <p className="mb-5 mt-1 text-sm text-muted-foreground">
        Własny checkout darowizn (jednorazowych i miesięcznych) obsługiwany przez naszego operatora
        płatności. Publiczny formularz:{" "}
        <code className="rounded bg-muted px-1 py-0.5">/donate</code>.
      </p>

      <section className="mb-6 grid gap-3 sm:grid-cols-3">
        {[
          { label: "Suma wpłat", value: stats.data?.totalCents ?? 0 },
          { label: "W tym miesiącu", value: stats.data?.monthCents ?? 0 },
        ].map((card) => (
          <div key={card.label} className="rounded-md border p-4">
            <p className="text-xs text-muted-foreground">{card.label}</p>
            <p className="mt-1 text-lg font-medium">
              {formatDonationAmount(card.value, stats.data?.currency ?? currency, lang)}
            </p>
          </div>
        ))}
        <div className="rounded-md border p-4">
          <p className="text-xs text-muted-foreground">Liczba wpłat</p>
          <p className="mt-1 text-lg font-medium">{stats.data?.count ?? 0}</p>
        </div>
      </section>

      <section className="mb-6">
        <h3 className="mb-2 text-sm font-semibold">Silnik wpłat</h3>
        <Field label="Moduł aktywny" hint="Wyłączenie ukrywa formularz i CTA darowizn.">
          <Checkbox
            label="Zbieraj darowizny"
            checked={draft.enabled}
            onChange={(enabled) => setDraft({ ...draft, enabled })}
          />
        </Field>
        <Field label="Tryb" hint="Własny checkout albo przekierowanie do zewnętrznej zbiórki.">
          <select
            className="h-9 w-full rounded-md border bg-background px-2 text-sm"
            value={draft.provider}
            onChange={(e) =>
              setDraft({
                ...draft,
                provider: e.target.value === "external" ? "external" : "stripe",
              })
            }
          >
            <option value="stripe">Nasz checkout (karta, BLIK, Apple/Google Pay)</option>
            <option value="external">Zewnętrzna zbiórka (link)</option>
          </select>
        </Field>
        {draft.provider === "external" && (
          <Field label="Adres zbiórki">
            <Text
              value={draft.externalUrl}
              onChange={(e) => setDraft({ ...draft, externalUrl: e.target.value })}
            />
          </Field>
        )}
        <Field label="Waluta">
          <select
            className="h-9 w-full rounded-md border bg-background px-2 text-sm"
            value={draft.currency}
            onChange={(e) =>
              setDraft({ ...draft, currency: e.target.value === "EUR" ? "EUR" : "PLN" })
            }
          >
            <option value="PLN">PLN</option>
            <option value="EUR">EUR</option>
          </select>
        </Field>
      </section>

      <section className="mb-6">
        <h3 className="mb-2 text-sm font-semibold">Kwoty</h3>
        <Field
          label="Kwoty sugerowane"
          hint="Lista kwot w walucie zbiórki, rozdzielona przecinkami (np. 25, 50, 100, 250)."
        >
          <Text
            value={draft.presetsCents.map((cents) => String(cents / 100)).join(", ")}
            onChange={(e) =>
              setDraft({
                ...draft,
                presetsCents: e.target.value
                  .split(",")
                  .map((part: string) =>
                    Math.round(Number.parseFloat(part.replace(",", ".")) * 100),
                  )
                  .filter((cents: number) => Number.isFinite(cents) && cents > 0)
                  .slice(0, 8),
              })
            }
          />
        </Field>
        <Field label="Kwota minimalna (grosze)">
          <NumberInput
            value={draft.minCents}
            onChange={(e) => setDraft({ ...draft, minCents: Number(e.target.value) || 0 })}
            min={500}
            max={5_000_000}
          />
        </Field>
        <Field label="Kwota maksymalna (grosze)">
          <NumberInput
            value={draft.maxCents}
            onChange={(e) => setDraft({ ...draft, maxCents: Number(e.target.value) || 0 })}
            min={500}
            max={5_000_000}
          />
        </Field>
        <Field label="Cel zbiórki (grosze)" hint="0 wyłącza pasek postępu.">
          <NumberInput
            value={draft.goalCents}
            onChange={(e) => setDraft({ ...draft, goalCents: Number(e.target.value) || 0 })}
            min={0}
            max={100_000_000}
          />
        </Field>
      </section>

      <section className="mb-6">
        <h3 className="mb-2 text-sm font-semibold">Formularz</h3>
        <Checkbox
          label="Pozwól wpisać własną kwotę"
          checked={draft.allowCustom}
          onChange={(allowCustom) => setDraft({ ...draft, allowCustom })}
        />
        <Checkbox
          label="Pozwól na wsparcie miesięczne"
          checked={draft.allowRecurring}
          onChange={(allowRecurring) => setDraft({ ...draft, allowRecurring })}
        />
        <Checkbox
          label="Pole wiadomości od darczyńcy"
          checked={draft.allowMessage}
          onChange={(allowMessage) => setDraft({ ...draft, allowMessage })}
        />
        <Checkbox
          label="Pokazuj ostatnie wpłaty"
          checked={draft.showRecent}
          onChange={(showRecent) => setDraft({ ...draft, showRecent })}
        />
      </section>

      <section className="mb-6">
        <h3 className="mb-2 text-sm font-semibold">Treści</h3>
        <Field label="Nagłówek (PL)">
          <Text
            value={draft.headlinePl}
            onChange={(e) => setDraft({ ...draft, headlinePl: e.target.value })}
          />
        </Field>
        <Field label="Nagłówek (EN)">
          <Text
            value={draft.headlineEn}
            onChange={(e) => setDraft({ ...draft, headlineEn: e.target.value })}
          />
        </Field>
        <Field label="Opis (PL)">
          <Text
            value={draft.descriptionPl}
            onChange={(e) => setDraft({ ...draft, descriptionPl: e.target.value })}
          />
        </Field>
        <Field label="Opis (EN)">
          <Text
            value={draft.descriptionEn}
            onChange={(e) => setDraft({ ...draft, descriptionEn: e.target.value })}
          />
        </Field>
      </section>

      <section className="mb-6">
        <h3 className="mb-2 text-sm font-semibold">Synchronizacja ze Stripe</h3>
        <p className="mb-3 max-w-3xl text-sm text-muted-foreground">
          Uzgadnia rejestr wpłat ze Stripe (ostatnie 7 dni): domyka wpłaty oczekujące, importuje
          brakujące opłacone sesje i oznacza zwroty. Operacja jest idempotentna.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <select
            className="h-9 rounded-md border bg-background px-2 text-sm"
            value={environment}
            onChange={(e) => setEnvironment(e.target.value === "live" ? "live" : "sandbox")}
          >
            <option value="sandbox">Środowisko testowe</option>
            <option value="live">Środowisko produkcyjne</option>
          </select>
          <Button onClick={() => sync.mutate()} disabled={sync.isPending}>
            {sync.isPending ? "Synchronizuję..." : "Synchronizuj ze Stripe"}
          </Button>
        </div>
        {sync.isError && (
          <p className="mt-2 text-sm text-destructive">
            {sync.error instanceof Error ? sync.error.message : "Synchronizacja nie powiodła się."}
          </p>
        )}
        {syncReport && (
          <p className="mt-2 text-sm text-muted-foreground">
            Zaksięgowane: {syncReport.settled} · zaimportowane: {syncReport.imported} · zwroty:{" "}
            {syncReport.refunded} · wygasłe: {syncReport.expired} · przejrzane sesje:{" "}
            {syncReport.scannedSessions}
            {syncReport.warnings.length > 0 ? ` · ostrzeżenia: ${syncReport.warnings.length}` : ""}
          </p>
        )}
      </section>

      <section className="mb-6">
        <h3 className="mb-2 text-sm font-semibold">Ostatnie wpłaty</h3>
        {records.isPending ? (
          <p className="text-sm text-muted-foreground">{t("admin.loading")}</p>
        ) : (records.data?.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground">Brak zarejestrowanych wpłat.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Data</th>
                  <th className="px-3 py-2">Kwota</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Typ</th>
                  <th className="px-3 py-2">Darczyńca</th>
                </tr>
              </thead>
              <tbody>
                {records.data?.map((row) => (
                  <tr key={row.id} className="border-t">
                    <td className="whitespace-nowrap px-3 py-2">
                      {new Date(row.createdAt).toLocaleString(lang === "en" ? "en-GB" : "pl-PL")}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">
                      {formatDonationAmount(row.amountCents, row.currency, lang)}
                    </td>
                    <td className="px-3 py-2">{row.status}</td>
                    <td className="px-3 py-2">{row.recurring ? "miesięczna" : "jednorazowa"}</td>
                    <td className="px-3 py-2">{row.donorEmail ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <SaveBar onSave={() => save.mutate(draft)} saving={save.isPending} />
    </div>
  );
}
