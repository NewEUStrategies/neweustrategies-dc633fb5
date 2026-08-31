// Organizm: cala strona panelu darowizn - konfiguracja checkoutu, synchronizacja
// ze Stripe i zlozenie panelu podsumowania z panelem listy wplat.
// Zapytania zostaja TUTAJ: oba panele sa prezentacyjne, wiec `sync` nadal
// odswieza dokladnie te same dwa zapytania, co przed ekstrakcja.
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { z } from "zod";
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
  DonationsConfigSchema,
  type DonationsConfig,
} from "@/lib/billing/donationsConfig";
import { ensureI18n as ensureDonateI18n } from "@/lib/i18n-donate";
import { DonationsRecordsPanel } from "./DonationsRecordsPanel";
import { DonationsSummaryPanel } from "./DonationsSummaryPanel";

/** Identyfikatory kontrolek - `Field` wiaze po nich etykiete (`htmlFor`). */
const ID = {
  provider: "donations-provider",
  externalUrl: "donations-external-url",
  currency: "donations-currency",
  presets: "donations-presets",
  min: "donations-min-cents",
  max: "donations-max-cents",
  goal: "donations-goal-cents",
  headlinePl: "donations-headline-pl",
  headlineEn: "donations-headline-en",
  descriptionPl: "donations-description-pl",
  descriptionEn: "donations-description-en",
  environment: "donations-sync-environment",
} as const;

/**
 * Etykiety pol - jedno zrodlo dla formularza I dla komunikatu odmowy zapisu,
 * zeby komunikat wskazywal pole tym samym napisem, ktory administrator widzi
 * nad kontrolka (a nie nazwa kolumny z bazy).
 */
const FIELD_LABEL_KEYS: Record<string, string> = {
  enabled: "donate.admin.engine.enabledLabel",
  provider: "donate.admin.engine.providerLabel",
  externalUrl: "donate.admin.engine.externalUrlLabel",
  currency: "donate.admin.engine.currencyLabel",
  presetsCents: "donate.admin.amounts.presetsLabel",
  minCents: "donate.admin.amounts.minLabel",
  maxCents: "donate.admin.amounts.maxLabel",
  goalCents: "donate.admin.amounts.goalLabel",
  headlinePl: "donate.admin.content.headlinePl",
  headlineEn: "donate.admin.content.headlineEn",
  descriptionPl: "donate.admin.content.descriptionPl",
  descriptionEn: "donate.admin.content.descriptionEn",
};

/** Maksymalna liczba kwot sugerowanych - tyle dopuszcza schemat konfiguracji. */
const MAX_PRESETS = 8;

/**
 * Kwota z przecinkiem dziesietnym: przecinek stoi MIEDZY cyframi i po nim sa
 * najwyzej dwie (grosze). Tylko taki ksztalt calego kawalka czytamy jako jedna
 * kwote - patrz `parsePresetAmounts`.
 */
const DECIMAL_COMMA = /^\d+,\d{1,2}$/;

/**
 * „Kwoty sugerowane" -> grosze.
 *
 * SEPARATOR LISTY KONTRA SEPARATOR DZIESIETNY. Pole przyjmuje jedno i drugie,
 * a rozstrzygamy je gramatyka, nie zgadywaniem:
 *   1. lista rozdziela sie SPACJA albo SREDNIKIEM - to sa separatory, ktorych
 *      nie da sie pomylic z zapisem kwoty;
 *   2. w kawalku, ktory jako CALOSC wyglada jak liczba z przecinkiem
 *      dziesietnym („12,50"), przecinek jest separatorem GROSZY;
 *   3. w kazdym innym kawalku przecinek nadal rozdziela kwoty, wiec zapis
 *      „25, 50, 100" i „10,20,30" czyta sie tak, jak wyglada.
 *
 * Dzieki temu „12,50" daje JEDNA kwote 12,50 zl (dawniej: dwie - 12 zl i 50 zl,
 * bo `part.replace(",", ".")` po rozbiciu po przecinku byl kodem martwym),
 * a wieloelementowa lista pisana bez spacji nie zmienia znaczenia.
 */
function parsePresetAmounts(input: string): number[] {
  return input
    .split(/[;\s]+/)
    .map((token) => token.replace(/^,+|,+$/g, ""))
    .filter((token) => token.length > 0)
    .flatMap((token) => (DECIMAL_COMMA.test(token) ? [token.replace(",", ".")] : token.split(",")))
    .map((part) => Math.round(Number.parseFloat(part) * 100))
    .filter((cents) => Number.isFinite(cents) && cents > 0)
    .slice(0, MAX_PRESETS);
}

/** Kwoty sugerowane w postaci, w jakiej stoja w polu tekstowym. */
function formatPresetAmounts(presetsCents: readonly number[]): string {
  return presetsCents.map((cents) => String(cents / 100)).join(", ");
}

/** Nazwy pol, ktore odrzucil schemat - w jezyku panelu, bez duplikatow. */
function invalidFieldLabels(issues: readonly z.ZodIssue[], t: TFunction): string[] {
  const labels: string[] = [];
  for (const issue of issues) {
    const head = issue.path[0];
    const labelKey = typeof head === "string" ? FIELD_LABEL_KEYS[head] : undefined;
    const label = labelKey ? t(labelKey) : String(head ?? "");
    if (label.length > 0 && !labels.includes(label)) labels.push(label);
  }
  return labels;
}

export function AdminDonations() {
  // Rejestracja słownika w chunku KOMPONENTU trasy (nie w entry) - patrz
  // komentarz przy ensureI18n w lib/i18n-donate.ts.
  ensureDonateI18n();
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith("en") ? "en" : "pl";
  const { query, save } = useSettings<DonationsConfig>(DONATIONS_SETTINGS_KEY, DONATIONS_DEFAULTS);
  const [draft, setDraft] = useDraft(query.data);
  // Surowy tekst pola kwot sugerowanych. `null` = pole pokazuje postac
  // kanoniczna z konfiguracji; po pierwszej edycji pokazuje to, co administrator
  // NAPRAWDE wpisal - inaczej kazde naciśnięcie klawisza przepisywaloby wpis
  // na wynik parsowania i przecinka nie dalo by sie wpisac w ogole.
  const [presetsText, setPresetsText] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
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
    // Raport opisuje JEDEN przebieg. Zerujemy go na starcie kolejnego, zeby
    // nieudane uzgodnienie nie zostawialo pod czerwonym bledem zielonego
    // raportu z poprzedniej proby - „czesciowo przeszlo" i „nie zrobilo nic"
    // musza wygladac inaczej.
    onMutate: () => setSyncReport(null),
    onSuccess: (report) => {
      setSyncReport(report);
      void records.refetch();
      void stats.refetch();
    },
  });

  if (!draft) return <p className="text-sm text-muted-foreground">{t("admin.loading")}</p>;

  const currency = draft.currency;
  const environmentLabel = (env: "sandbox" | "live") =>
    t(env === "live" ? "donate.admin.sync.live" : "donate.admin.sync.sandbox");

  const setPresets = (value: string) => {
    setPresetsText(value);
    setDraft({ ...draft, presetsCents: parsePresetAmounts(value) });
  };

  /**
   * Zapis przez schemat konfiguracji. Publiczna strona czyta ustawienia przez
   * `parseDonationsConfig`, ktory przy nieudanym `safeParse` wraca do CALYCH
   * `DONATIONS_DEFAULTS` - jedno pole poza zakresem cofaloby wiec do wartosci
   * domyslnych takze tryb, walute, kwoty, cel i naglowki, a panel dalej
   * pokazywalby wlasny stan. Dlatego panel nie wysyla konfiguracji, ktorej
   * publiczna strona i tak by nie przyjela, i mowi WPROST, ktore pole blokuje.
   */
  const onSave = () => {
    const parsed = DonationsConfigSchema.safeParse(draft);
    if (!parsed.success) {
      setSaveError(
        t("donate.admin.save.invalid", {
          fields: invalidFieldLabels(parsed.error.issues, t).join(", "),
        }),
      );
      return;
    }
    setSaveError(null);
    save.mutate(parsed.data);
  };

  return (
    <div>
      <h2 className="font-display text-xl">{t("donate.admin.title")}</h2>
      <p className="mb-5 mt-1 text-sm text-muted-foreground">
        {t("donate.admin.intro")} <code className="rounded bg-muted px-1 py-0.5">/donate</code>.
      </p>

      <DonationsSummaryPanel stats={stats.data} currency={currency} lang={lang} />

      <section className="mb-6">
        <h3 className="mb-2 text-sm font-semibold">{t("donate.admin.engine.title")}</h3>
        <Field
          label={t("donate.admin.engine.enabledLabel")}
          hint={t("donate.admin.engine.enabledHint")}
        >
          <Checkbox
            label={t("donate.admin.engine.enabledToggle")}
            checked={draft.enabled}
            onChange={(enabled) => setDraft({ ...draft, enabled })}
          />
        </Field>
        <Field
          label={t("donate.admin.engine.providerLabel")}
          hint={t("donate.admin.engine.providerHint")}
          htmlFor={ID.provider}
        >
          <select
            id={ID.provider}
            className="h-9 w-full rounded-md border bg-background px-2 text-sm"
            value={draft.provider}
            onChange={(e) =>
              setDraft({
                ...draft,
                provider: e.target.value === "external" ? "external" : "stripe",
              })
            }
          >
            <option value="stripe">{t("donate.admin.engine.providerStripe")}</option>
            <option value="external">{t("donate.admin.engine.providerExternal")}</option>
          </select>
        </Field>
        {draft.provider === "external" && (
          <Field label={t("donate.admin.engine.externalUrlLabel")} htmlFor={ID.externalUrl}>
            <Text
              id={ID.externalUrl}
              value={draft.externalUrl}
              onChange={(e) => setDraft({ ...draft, externalUrl: e.target.value })}
            />
          </Field>
        )}
        <Field label={t("donate.admin.engine.currencyLabel")} htmlFor={ID.currency}>
          <select
            id={ID.currency}
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
        <h3 className="mb-2 text-sm font-semibold">{t("donate.admin.amounts.title")}</h3>
        <Field
          label={t("donate.admin.amounts.presetsLabel")}
          hint={t("donate.admin.amounts.presetsHint")}
          htmlFor={ID.presets}
        >
          <Text
            id={ID.presets}
            value={presetsText ?? formatPresetAmounts(draft.presetsCents)}
            onChange={(e) => setPresets(e.target.value)}
          />
        </Field>
        <Field label={t("donate.admin.amounts.minLabel")} htmlFor={ID.min}>
          <NumberInput
            id={ID.min}
            value={draft.minCents}
            onChange={(e) => setDraft({ ...draft, minCents: Number(e.target.value) || 0 })}
            min={500}
            max={5_000_000}
          />
        </Field>
        <Field label={t("donate.admin.amounts.maxLabel")} htmlFor={ID.max}>
          <NumberInput
            id={ID.max}
            value={draft.maxCents}
            onChange={(e) => setDraft({ ...draft, maxCents: Number(e.target.value) || 0 })}
            min={500}
            max={5_000_000}
          />
        </Field>
        <Field
          label={t("donate.admin.amounts.goalLabel")}
          hint={t("donate.admin.amounts.goalHint")}
          htmlFor={ID.goal}
        >
          <NumberInput
            id={ID.goal}
            value={draft.goalCents}
            onChange={(e) => setDraft({ ...draft, goalCents: Number(e.target.value) || 0 })}
            min={0}
            max={100_000_000}
          />
        </Field>
      </section>

      <section className="mb-6">
        <h3 className="mb-2 text-sm font-semibold">{t("donate.admin.form.title")}</h3>
        <Checkbox
          label={t("donate.admin.form.allowCustom")}
          checked={draft.allowCustom}
          onChange={(allowCustom) => setDraft({ ...draft, allowCustom })}
        />
        <Checkbox
          label={t("donate.admin.form.allowRecurring")}
          checked={draft.allowRecurring}
          onChange={(allowRecurring) => setDraft({ ...draft, allowRecurring })}
        />
        <Checkbox
          label={t("donate.admin.form.allowMessage")}
          checked={draft.allowMessage}
          onChange={(allowMessage) => setDraft({ ...draft, allowMessage })}
        />
        <Checkbox
          label={t("donate.admin.form.showRecent")}
          checked={draft.showRecent}
          onChange={(showRecent) => setDraft({ ...draft, showRecent })}
        />
      </section>

      <section className="mb-6">
        <h3 className="mb-2 text-sm font-semibold">{t("donate.admin.content.title")}</h3>
        <Field label={t("donate.admin.content.headlinePl")} htmlFor={ID.headlinePl}>
          <Text
            id={ID.headlinePl}
            value={draft.headlinePl}
            onChange={(e) => setDraft({ ...draft, headlinePl: e.target.value })}
          />
        </Field>
        <Field label={t("donate.admin.content.headlineEn")} htmlFor={ID.headlineEn}>
          <Text
            id={ID.headlineEn}
            value={draft.headlineEn}
            onChange={(e) => setDraft({ ...draft, headlineEn: e.target.value })}
          />
        </Field>
        <Field label={t("donate.admin.content.descriptionPl")} htmlFor={ID.descriptionPl}>
          <Text
            id={ID.descriptionPl}
            value={draft.descriptionPl}
            onChange={(e) => setDraft({ ...draft, descriptionPl: e.target.value })}
          />
        </Field>
        <Field label={t("donate.admin.content.descriptionEn")} htmlFor={ID.descriptionEn}>
          <Text
            id={ID.descriptionEn}
            value={draft.descriptionEn}
            onChange={(e) => setDraft({ ...draft, descriptionEn: e.target.value })}
          />
        </Field>
      </section>

      <section className="mb-6">
        <h3 className="mb-2 text-sm font-semibold">{t("donate.admin.sync.title")}</h3>
        <p className="mb-3 max-w-3xl text-sm text-muted-foreground">
          {t("donate.admin.sync.description")}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <select
            id={ID.environment}
            aria-label={t("donate.admin.sync.environmentLabel")}
            className="h-9 rounded-md border bg-background px-2 text-sm"
            value={environment}
            onChange={(e) => {
              // Raport dotyczy srodowiska, na ktorym przebieg sie odbyl.
              // Zostawiony pod nowym wyborem czytalby sie jak potwierdzenie
              // uzgodnienia, ktorego na tym koncie nie bylo.
              setSyncReport(null);
              setEnvironment(e.target.value === "live" ? "live" : "sandbox");
            }}
          >
            <option value="sandbox">{t("donate.admin.sync.sandbox")}</option>
            <option value="live">{t("donate.admin.sync.live")}</option>
          </select>
          <Button onClick={() => sync.mutate()} disabled={sync.isPending}>
            {sync.isPending ? t("donate.admin.sync.running") : t("donate.admin.sync.run")}
          </Button>
        </div>
        {sync.isError && (
          <p className="mt-2 text-sm text-destructive">
            {sync.error instanceof Error ? sync.error.message : t("donate.admin.sync.failed")}
          </p>
        )}
        {syncReport && (
          <p className="mt-2 text-sm text-muted-foreground">
            {t("donate.admin.sync.report", {
              environment: environmentLabel(syncReport.environment),
              settled: syncReport.settled,
              imported: syncReport.imported,
              refunded: syncReport.refunded,
              expired: syncReport.expired,
              scanned: syncReport.scannedSessions,
            })}
            {syncReport.warnings.length > 0
              ? t("donate.admin.sync.reportWarnings", { warnings: syncReport.warnings.length })
              : ""}
          </p>
        )}
      </section>

      <DonationsRecordsPanel records={records.data} isPending={records.isPending} lang={lang} />

      {saveError && <p className="mt-6 text-sm text-destructive">{saveError}</p>}
      <SaveBar onSave={onSave} saving={save.isPending} />
    </div>
  );
}
