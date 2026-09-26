// Molekula: POLA NABYWCY faktury (sterowane, bez wlasnego zapisu).
//
// Jeden zestaw pol dla trzech miejsc: krok platnosci zapisu, zakup pakietu,
// prosba z profilu - i dla edytora szkicu w studiu. Molekula nie wie, gdzie
// stoi: dostaje wartosc, zglasza zmiane i pokazuje gotowe klucze bledow
// z `validateBuyerDraft`. Zapis, prefill i "zapamietaj" naleza do wolajacego.
//
// BLEDY POKAZUJEMY PO PROBIE WYSLANIA (`showErrors`), nie od pierwszej
// litery - formularz, ktory krzyczy "NIP niepoprawny" po wpisaniu jednej
// cyfry, uczy ignorowac komunikaty.
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ensureEventInvoicesI18n } from "@/lib/i18n-event-invoices";
import type {
  InvoiceBuyerDraft,
  InvoiceBuyerErrors,
  InvoiceBuyerField,
} from "@/lib/events/eventInvoiceBuyerDraft";

export interface InvoiceBuyerFieldsProps {
  value: InvoiceBuyerDraft;
  onChange: (next: InvoiceBuyerDraft) => void;
  errors: InvoiceBuyerErrors;
  showErrors: boolean;
  disabled?: boolean;
}

type TextField = Exclude<InvoiceBuyerField, "isCompany">;

export function InvoiceBuyerFields({
  value,
  onChange,
  errors,
  showErrors,
  disabled = false,
}: InvoiceBuyerFieldsProps) {
  ensureEventInvoicesI18n();
  const { t } = useTranslation();
  const base = useId();
  const [recipientForced, setRecipientForced] = useState(false);
  const recipientOpen =
    recipientForced || value.recipientName !== "" || value.recipientAddress !== "";

  function set<K extends InvoiceBuyerField>(field: K, next: InvoiceBuyerDraft[K]): void {
    onChange({ ...value, [field]: next });
  }

  function field(
    name: TextField,
    label: string,
    options: { hint?: string; autoComplete?: string; className?: string; maxLength: number },
  ) {
    const id = `${base}-${name}`;
    const error = showErrors ? errors[name] : undefined;
    const hintId = options.hint === undefined ? undefined : `${id}-hint`;
    const errorId = error === undefined ? undefined : `${id}-err`;
    return (
      <div className={options.className ?? "space-y-1.5"}>
        <Label htmlFor={id}>{label}</Label>
        <Input
          id={id}
          value={value[name]}
          disabled={disabled}
          maxLength={options.maxLength}
          autoComplete={options.autoComplete}
          aria-invalid={error === undefined ? undefined : true}
          aria-describedby={[errorId, hintId].filter((part) => part !== undefined).join(" ") || undefined}
          onChange={(event) => set(name, event.target.value)}
        />
        {options.hint === undefined ? null : (
          <p id={hintId} className="text-xs text-muted-foreground">
            {options.hint}
          </p>
        )}
        {error === undefined ? null : (
          <p id={errorId} className="text-xs text-destructive">
            {t(error)}
          </p>
        )}
      </div>
    );
  }

  return (
    <fieldset className="space-y-3" disabled={disabled}>
      <legend className="text-sm font-semibold">{t("eventInvoices.buyer.legend")}</legend>
      <div role="radiogroup" aria-label={t("eventInvoices.buyer.kindLabel")} className="flex gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name={`${base}-kind`}
            checked={value.isCompany}
            onChange={() => set("isCompany", true)}
          />
          {t("eventInvoices.buyer.kindCompany")}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name={`${base}-kind`}
            checked={!value.isCompany}
            onChange={() => set("isCompany", false)}
          />
          {t("eventInvoices.buyer.kindPerson")}
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {field(
          "name",
          value.isCompany ? t("eventInvoices.buyer.name") : t("eventInvoices.buyer.namePerson"),
          { autoComplete: value.isCompany ? "organization" : "name", maxLength: 200 },
        )}
        {field("taxId", t("eventInvoices.buyer.taxId"), {
          hint: t("eventInvoices.buyer.taxIdHint"),
          maxLength: 24,
        })}
        {field("address", t("eventInvoices.buyer.address"), {
          autoComplete: "street-address",
          maxLength: 200,
          className: "space-y-1.5 sm:col-span-2",
        })}
        {field("postalCode", t("eventInvoices.buyer.postalCode"), {
          autoComplete: "postal-code",
          maxLength: 20,
        })}
        {field("city", t("eventInvoices.buyer.city"), {
          autoComplete: "address-level2",
          maxLength: 100,
        })}
        {field("country", t("eventInvoices.buyer.country"), {
          autoComplete: "country",
          maxLength: 2,
        })}
        {field("email", t("eventInvoices.buyer.email"), {
          hint: t("eventInvoices.buyer.emailHint"),
          autoComplete: "email",
          maxLength: 254,
        })}
        {field("poNumber", t("eventInvoices.buyer.poNumber"), {
          maxLength: 100,
          className: "space-y-1.5 sm:col-span-2",
        })}
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={recipientOpen}
          onChange={(event) => {
            setRecipientForced(event.target.checked);
            if (!event.target.checked) onChange({ ...value, recipientName: "", recipientAddress: "" });
          }}
        />
        {t("eventInvoices.buyer.recipientToggle")}
      </label>
      {recipientOpen ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {field("recipientName", t("eventInvoices.buyer.recipientName"), { maxLength: 200 })}
          {field("recipientAddress", t("eventInvoices.buyer.recipientAddress"), {
            maxLength: 300,
          })}
        </div>
      ) : null}
    </fieldset>
  );
}
