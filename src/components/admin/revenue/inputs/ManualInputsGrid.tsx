// Organizm: siatka danych wejściowych - miesiąc × rodzaj × segment (SPEC
// §2.2 `inputs`, §6.1 `ManualInputsGrid`; S2 `useSaveRevenueInput`).
//
// TYLKO ADMINISTRATOR. Plan i koszty to dane finansowe (D-06): odczyt
// i zapis mają bramkę `has_role(…, 'admin')` w SQL, a zakładka pokazuje
// redaktorowi `RoleGateNotice` bez wywołania RPC (bramka `roleOk`).
//
// ZAPIS = MUTATOR S2, BEZ WŁASNEGO `update`. Każdy wiersz zapisuje przez
// `useSaveRevenueInput` (unieważnia dane wejściowe i ekonomikę) z tokenem
// `updatedAt` odczytu. Gdy ktoś zmienił wartość w innej karcie, baza
// odpowiada `40001` → wiersz mówi „zmienione w międzyczasie" i pokazuje obok
// siebie TWOJĄ wartość i AKTUALNĄ (odświeżoną) - admin decyduje, którą
// zapisać. `RevisionDiffDialog` panelu porównuje rewizje wpisów i stron
// (`getRevisionSnapshots`), więc dla wiersza danych wejściowych porównanie
// jest wbudowane w wiersz (odchylenie zapisane w raporcie).
//
// ZA DŁUGA NOTATKA JEST ODRZUCANA, NIE PRZYCINANA. Pole nie ma `maxLength`
// (przeglądarka obcięłaby wklejony tekst bez słowa); licznik pokazuje
// „N z 500", a zapis ponad limit nie wychodzi do serwera i mówi dlaczego.
//
// `new_customers_plan` TO LICZBA KLIENTÓW (Z-S2-06) - pole liczby z opisem
// `newCustomersHint`, bez mnożenia przez jednostki drobne waluty.
//
// MIESIĄCE LOKALNE przez `FormSelect` (`inputValues.ts`) - bez
// `toISOString().slice`.
import { useQuery } from "@tanstack/react-query";
import { useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { FormSelect } from "@/components/atoms/FormSelect";
import { SourceHeader } from "@/components/admin/revenue/molecules/SourceHeader";
import { HubCardState } from "@/components/admin/revenue/overview/HubCardState";
import { cardStatusOf } from "@/components/admin/revenue/overview/hubWindow";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { chartLangFrom, type ChartLang } from "@/lib/charts/format";
import { ensureI18n as ensureFinanceI18n } from "@/lib/i18n-admin-revenue-finance";
import { ensureI18n } from "@/lib/i18n-admin-revenue-tabs";
import type { RevenueInputInvalidCode, RevenueInputRow } from "@/lib/revenue/finance/dto";
import {
  revenueInputsQueryOptions,
  revenueOfferMatrixQueryOptions,
  useSaveRevenueInput,
} from "@/lib/revenue/finance/queries";
import { REVENUE_INPUT_KINDS, REVENUE_LIMITS, type RevenueInputKind } from "@/lib/revenue/limits";
import { REVENUE_SEGMENTS, type RevenueSegment } from "@/lib/revenue/search";
import {
  inputFieldValue,
  inputMonths,
  inputValueKind,
  localMonthKey,
  monthDate,
  monthStart,
  noteFits,
  noteLength,
  parseInputValue,
  type InputValueKind,
} from "./inputValues";

const LOCALE: Readonly<Record<ChartLang, string>> = { pl: "pl-PL", en: "en-GB" };

const KIND_KEY: Readonly<Record<RevenueInputKind, string>> = {
  mrr_plan: "adminRevenue.finance.inputs.kind.mrr_plan",
  new_customers_plan: "adminRevenue.finance.inputs.kind.new_customers_plan",
  sales_marketing_cost: "adminRevenue.finance.inputs.kind.sales_marketing_cost",
  cogs: "adminRevenue.finance.inputs.kind.cogs",
  gross_margin_pct: "adminRevenue.finance.inputs.kind.gross_margin_pct",
  ebitda_margin_pct: "adminRevenue.finance.inputs.kind.ebitda_margin_pct",
};

const SEGMENT_KEY: Readonly<Record<RevenueSegment, string>> = {
  all: "adminRevenue.segment.all",
  b2c_individual: "adminRevenue.segment.b2c_individual",
  b2c_reduced: "adminRevenue.segment.b2c_reduced",
  b2b_institution: "adminRevenue.segment.b2b_institution",
};

const INVALID_KEY: Readonly<Record<RevenueInputInvalidCode, string>> = {
  period_invalid: "adminRevenue.finance.inputs.invalid.period_invalid",
  kind_invalid: "adminRevenue.finance.inputs.invalid.kind_invalid",
  segment_invalid: "adminRevenue.finance.inputs.invalid.segment_invalid",
  note_too_long: "adminRevenue.finance.inputs.invalid.note_too_long",
  value_invalid: "adminRevenue.finance.inputs.invalid.value_invalid",
};

/** Komunikat wiersza po zapisie - trzymany w siatce, bo wiersz przebudowuje się po odświeżeniu. */
type RowNotice =
  | { kind: "saved" }
  | { kind: "deleted" }
  | { kind: "conflict"; yours: string }
  | { kind: "invalid"; code: RevenueInputInvalidCode }
  | { kind: "denied" }
  | { kind: "error" };

export interface ManualInputsGridProps {
  tenantId: string | null;
  /** Dokładne role sesji - siatka jest wyłącznie administratora. */
  roles: readonly string[];
  /** Segment z adresu huba (domyślny wybór siatki). */
  segment: RevenueSegment | null;
}

export function ManualInputsGrid({ tenantId, roles, segment }: ManualInputsGridProps) {
  ensureFinanceI18n();
  ensureI18n();
  const { t, i18n } = useTranslation();
  const lang = chartLangFrom(i18n.language);
  const headingId = useId();
  const monthId = useId();
  const segmentId = useId();
  const currencyId = useId();
  const isAdmin = roles.includes("admin");
  const [nowMs] = useState(() => Date.now());
  const months = useMemo(() => inputMonths(nowMs), [nowMs]);
  const [month, setMonth] = useState(() => localMonthKey(new Date(nowMs)));
  const [chosenSegment, setChosenSegment] = useState<RevenueSegment>(segment ?? "all");
  const [chosenCurrency, setChosenCurrency] = useState<string | null>(null);
  const [notices, setNotices] = useState<Partial<Record<RevenueInputKind, RowNotice>>>({});

  const gate = { roleOk: isAdmin };
  const inputsQ = useQuery(
    revenueInputsQueryOptions(
      tenantId,
      monthStart(months[0] as string),
      monthStart(months[months.length - 1] as string),
      gate,
    ),
  );
  const offerQ = useQuery(revenueOfferMatrixQueryOptions(tenantId, gate));
  const save = useSaveRevenueInput(tenantId);
  const status = cardStatusOf(inputsQ, tenantId);

  const rows = useMemo(
    () => (inputsQ.data?.state === "ready" ? inputsQ.data.data.rows : []),
    [inputsQ.data],
  );
  // Waluty: rynki planów (CHECK I0 wiąże kwotę z walutą planu) i waluty już
  // zapisanych danych - bez listy wymyślonej w panelu.
  // Kolejność: waluta z największą liczbą planów (główny rynek) jako domyślna.
  const currencies = useMemo(() => {
    const weight = new Map<string, number>();
    if (offerQ.data?.state === "ready") {
      for (const plan of offerQ.data.data.plans) {
        weight.set(plan.currency, (weight.get(plan.currency) ?? 0) + 1);
      }
    }
    for (const row of rows) {
      if (row.currency && !weight.has(row.currency)) weight.set(row.currency, 0);
    }
    return [...weight.entries()]
      .sort(([a, wa], [b, wb]) => wb - wa || a.localeCompare(b))
      .map(([code]) => code);
  }, [offerQ.data, rows]);
  const currency =
    chosenCurrency && currencies.includes(chosenCurrency)
      ? chosenCurrency
      : (currencies[0] ?? null);

  const monthFormat = new Intl.DateTimeFormat(LOCALE[lang], { month: "long", year: "numeric" });
  const monthLabel = monthFormat.format(monthDate(month));

  const rowFor = (kind: RevenueInputKind): RevenueInputRow | undefined => {
    const ratio = inputValueKind(kind) === "ratio";
    return rows.find(
      (row) =>
        row.periodMonth === monthStart(month) &&
        row.kind === kind &&
        row.segment === chosenSegment &&
        (ratio ? row.currency === null : row.currency === currency),
    );
  };

  const submit = (
    kind: RevenueInputKind,
    draft: { value: string; note: string },
    existing: RevenueInputRow | undefined,
  ): string | null => {
    const valueKind = inputValueKind(kind);
    const parsed = parseInputValue(draft.value, valueKind, currency);
    if (!parsed.ok) {
      return valueKind === "ratio"
        ? t("adminRevenue.inputs.invalidRatio")
        : valueKind === "count"
          ? t("adminRevenue.inputs.invalidCount")
          : t("adminRevenue.inputs.invalidAmount");
    }
    if (!noteFits(draft.note)) {
      return t("adminRevenue.finance.inputs.noteLimit", { max: REVENUE_LIMITS.inputNoteMax });
    }
    const note = draft.note.trim() === "" ? null : draft.note;
    save.mutate(
      {
        periodMonth: monthStart(month),
        kind,
        segment: chosenSegment,
        currency: valueKind === "ratio" ? null : currency,
        amountMinor: valueKind === "ratio" ? null : parsed.value,
        ratio: valueKind === "ratio" ? parsed.value : null,
        note,
        expectedUpdatedAt: existing?.updatedAt ?? null,
      },
      {
        onSuccess: (result) => {
          let notice: RowNotice;
          if (result.state === "saved") {
            notice = { kind: result.result.op === "delete" ? "deleted" : "saved" };
          } else if (result.state === "conflict") {
            notice = {
              kind: "conflict",
              yours: draft.value.trim() || t("adminRevenue.inputs.emptyValue"),
            };
          } else if (result.state === "invalid") {
            notice = { kind: "invalid", code: result.code };
          } else notice = { kind: "denied" };
          setNotices((prev) => ({ ...prev, [kind]: notice }));
        },
        onError: () => setNotices((prev) => ({ ...prev, [kind]: { kind: "error" } })),
      },
    );
    return null;
  };

  let body;
  if (status !== "ready") {
    body = (
      <HubCardState
        status={status}
        forbiddenKey="adminRevenue.finance.state.forbidden"
        unavailableKey="adminRevenue.finance.state.unavailable"
        onRetry={() => void inputsQ.refetch()}
      />
    );
  } else {
    body = (
      <div className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[11rem] space-y-1">
            <label htmlFor={monthId} className="block text-xs font-medium">
              {t("adminRevenue.inputs.month")}
            </label>
            <FormSelect
              id={monthId}
              value={month}
              onValueChange={setMonth}
              options={months.map((m) => ({ value: m, label: monthFormat.format(monthDate(m)) }))}
            />
          </div>
          <div className="min-w-[11rem] space-y-1">
            <label htmlFor={segmentId} className="block text-xs font-medium">
              {t("adminRevenue.filters.segment")}
            </label>
            <FormSelect
              id={segmentId}
              value={chosenSegment}
              onValueChange={(v) => setChosenSegment(v as RevenueSegment)}
              options={REVENUE_SEGMENTS.map((s) => ({ value: s, label: t(SEGMENT_KEY[s]) }))}
            />
          </div>
          <div className="min-w-[8rem] space-y-1">
            <label htmlFor={currencyId} className="block text-xs font-medium">
              {t("adminRevenue.inputs.currency")}
            </label>
            <FormSelect
              id={currencyId}
              value={currency ?? ""}
              onValueChange={setChosenCurrency}
              options={currencies.map((c) => ({ value: c, label: c }))}
              disabled={currencies.length === 0}
            />
          </div>
        </div>
        {currency === null ? (
          <p
            role="status"
            className="m-0 text-xs text-muted-foreground"
            data-testid="inputs-no-currency"
          >
            {t("adminRevenue.inputs.noCurrency")}
          </p>
        ) : null}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-sm">
            <caption className="pb-2 text-left text-xs text-muted-foreground">
              {t("adminRevenue.inputs.caption", {
                month: monthLabel,
                segment: t(SEGMENT_KEY[chosenSegment]),
              })}
            </caption>
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th scope="col" className="py-1 pr-3 font-medium">
                  {t("adminRevenue.inputs.kind")}
                </th>
                <th scope="col" className="py-1 pr-3 font-medium">
                  {t("adminRevenue.inputs.value")}
                </th>
                <th scope="col" className="py-1 pr-3 font-medium">
                  {t("adminRevenue.finance.inputs.note")}
                </th>
                <th scope="col" className="py-1 pr-3 font-medium">
                  {t("adminRevenue.inputs.updated")}
                </th>
                <th scope="col" className="py-1 font-medium">
                  {t("adminRevenue.inputs.action")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {REVENUE_INPUT_KINDS.map((kind) => {
                const existing = rowFor(kind);
                return (
                  <InputRow
                    // Nowy odczyt wiersza (inny token) = świeży szkic z bazy.
                    key={`${month}|${chosenSegment}|${currency ?? "-"}|${kind}|${existing?.updatedAt ?? "new"}`}
                    kind={kind}
                    existing={existing}
                    currency={currency}
                    lang={lang}
                    pending={save.isPending}
                    notice={notices[kind]}
                    onSave={(draft) => {
                      setNotices((prev) => ({ ...prev, [kind]: undefined }));
                      return submit(kind, draft, existing);
                    }}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <section
      aria-labelledby={headingId}
      data-testid="manual-inputs"
      className="min-w-0 space-y-2 rounded-[6px] border border-border bg-card p-4"
    >
      <div className="min-w-0 space-y-0.5">
        <h2 id={headingId} className="text-base font-semibold">
          {t("adminRevenue.inputs.title")}
        </h2>
        <p className="m-0 text-sm text-muted-foreground">{t("adminRevenue.inputs.description")}</p>
      </div>
      <SourceHeader entity="revenue_input" />
      {body}
    </section>
  );
}

interface InputRowProps {
  kind: RevenueInputKind;
  existing: RevenueInputRow | undefined;
  currency: string | null;
  lang: ChartLang;
  pending: boolean;
  notice: RowNotice | undefined;
  /** Zwraca komunikat walidacji (zapis nie wyszedł) albo `null`. */
  onSave: (draft: { value: string; note: string }) => string | null;
}

function InputRow({ kind, existing, currency, lang, pending, notice, onSave }: InputRowProps) {
  const { t } = useTranslation();
  const valueKind: InputValueKind = inputValueKind(kind);
  const [value, setValue] = useState(() => inputFieldValue(existing, valueKind, currency, lang));
  const [note, setNote] = useState(existing?.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const hintId = useId();
  const noteCountId = useId();
  const errorId = useId();
  const kindLabel = t(KIND_KEY[kind]);
  const blocked = valueKind !== "ratio" && currency === null;
  const tooLong = !noteFits(note);
  const updated = existing
    ? new Intl.DateTimeFormat(LOCALE[lang], { dateStyle: "medium", timeStyle: "short" }).format(
        new Date(existing.updatedAt),
      )
    : t("adminRevenue.inputs.never");
  const valueLabel =
    valueKind === "ratio"
      ? t("adminRevenue.inputs.ratioLabel")
      : valueKind === "count"
        ? t("adminRevenue.inputs.countLabel")
        : t("adminRevenue.inputs.amountLabel", { currency: currency ?? "-" });
  const hint =
    valueKind === "ratio"
      ? t("adminRevenue.finance.inputs.ratioHint")
      : valueKind === "count"
        ? t("adminRevenue.finance.inputs.newCustomersHint")
        : null;
  const current = inputFieldValue(existing, valueKind, currency, lang);

  return (
    <tr data-kind={kind}>
      <th scope="row" className="py-2 pr-3 text-left align-top font-normal">
        {kindLabel}
        {hint ? (
          <span id={hintId} className="block text-xs text-muted-foreground">
            {hint}
          </span>
        ) : null}
      </th>
      <td className="py-2 pr-3 align-top">
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          inputMode={valueKind === "count" ? "numeric" : "decimal"}
          aria-label={`${kindLabel}: ${valueLabel}`}
          aria-describedby={
            [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined
          }
          aria-invalid={error ? true : undefined}
          disabled={blocked}
          className="h-8 w-36"
        />
        {valueKind === "ratio" ? (
          <span className="mt-1 block text-xs text-muted-foreground">
            {t("adminRevenue.inputs.ratioNoCurrency")}
          </span>
        ) : null}
      </td>
      <td className="py-2 pr-3 align-top">
        <Input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          aria-label={t("adminRevenue.inputs.noteLabel", { kind: kindLabel })}
          aria-describedby={noteCountId}
          aria-invalid={tooLong ? true : undefined}
          disabled={blocked}
          className="h-8 w-56"
        />
        <span
          id={noteCountId}
          className={
            tooLong
              ? "mt-1 block text-xs tabular-nums text-destructive"
              : "mt-1 block text-xs tabular-nums text-muted-foreground"
          }
        >
          {t("adminRevenue.inputs.noteCount", {
            count: noteLength(note),
            max: REVENUE_LIMITS.inputNoteMax,
          })}
        </span>
      </td>
      <td className="py-2 pr-3 align-top text-xs text-muted-foreground">{updated}</td>
      <td className="py-2 align-top">
        <Button
          type="button"
          size="sm"
          className="h-8"
          disabled={blocked || pending}
          onClick={() => setError(onSave({ value, note }))}
        >
          {pending ? t("adminRevenue.inputs.saving") : t("adminRevenue.inputs.save")}
        </Button>
        <div aria-live="polite" className="mt-1 max-w-[16rem] space-y-0.5 text-xs">
          {error ? (
            <p id={errorId} role="alert" className="m-0 text-destructive">
              {error}
            </p>
          ) : null}
          {notice?.kind === "saved" ? (
            <p className="m-0 text-muted-foreground">{t("adminRevenue.finance.inputs.saved")}</p>
          ) : null}
          {notice?.kind === "deleted" ? (
            <p className="m-0 text-muted-foreground">{t("adminRevenue.finance.inputs.deleted")}</p>
          ) : null}
          {notice?.kind === "conflict" ? (
            <div role="alert" data-testid="input-conflict" className="space-y-0.5">
              <p className="m-0 text-destructive">{t("adminRevenue.finance.inputs.conflict")}</p>
              <p className="m-0">
                {t("adminRevenue.inputs.conflictYours", { value: notice.yours })}
              </p>
              <p className="m-0">
                {t("adminRevenue.inputs.conflictCurrent", {
                  value: current || t("adminRevenue.inputs.emptyValue"),
                })}
              </p>
            </div>
          ) : null}
          {notice?.kind === "invalid" ? (
            <p role="alert" className="m-0 text-destructive">
              {t(INVALID_KEY[notice.code])}
            </p>
          ) : null}
          {notice?.kind === "denied" ? (
            <p role="alert" className="m-0 text-destructive">
              {t("adminRevenue.finance.state.forbidden")}
            </p>
          ) : null}
          {notice?.kind === "error" ? (
            <p role="alert" className="m-0 text-destructive">
              {t("adminRevenue.overview.state.error")}
            </p>
          ) : null}
        </div>
      </td>
    </tr>
  );
}
