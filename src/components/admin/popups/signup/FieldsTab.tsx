// Zakładka "Pola": widoczność, wymagalność oraz etykiety i podpowiedzi PL/EN
// każdego pola formularza rejestracji. Pola e-mail i hasła są zablokowane -
// bez nich nie da się utworzyć konta.
import { useTranslation } from "react-i18next";
import { ListChecks } from "lucide-react";
import { Input } from "@/components/ui/input";
import { SectionCard, ToggleRow } from "./controls";
import type { SignupPopupTabProps } from "./types";
import {
  isPopupFieldLocked,
  resolvePopupFields,
  type PopupFieldConfig,
} from "@/lib/newsletter/popupFields";

export function FieldsTab({ value, onChange }: Pick<SignupPopupTabProps, "value" | "onChange">) {
  const { t } = useTranslation();
  const fields = resolvePopupFields(value.popup_fields);

  const patchField = (key: PopupFieldConfig["key"], patch: Partial<PopupFieldConfig>) => {
    onChange({ popup_fields: fields.map((f) => (f.key === key ? { ...f, ...patch } : f)) });
  };

  return (
    <SectionCard
      title={t("adminPopupSignup.fields.heading")}
      hint={t("adminPopupSignup.fields.extendedHint")}
      icon={<ListChecks className="h-3.5 w-3.5" />}
    >
      <ToggleRow
        label={t("adminPopupSignup.fields.extended")}
        checked={value.popup_extended_fields}
        onChange={(popup_extended_fields) => onChange({ popup_extended_fields })}
      />

      <div className="space-y-2">
        {fields.map((field) => {
          const locked = isPopupFieldLocked(field.key);
          return (
            <div key={field.key} className="space-y-2 rounded-md border border-border p-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="mr-auto text-xs font-medium">
                  {t(`adminPopupSignup.fields.keys.${field.key}`)}
                  {locked && (
                    <span className="ml-2 text-[10px] font-normal uppercase tracking-wide text-muted-foreground">
                      {t("adminPopupSignup.fields.locked")}
                    </span>
                  )}
                </span>
                <ToggleRow
                  label={t("adminPopupSignup.fields.visible")}
                  checked={field.enabled}
                  disabled={locked}
                  onChange={(enabled) => patchField(field.key, { enabled })}
                />
                <ToggleRow
                  label={t("adminPopupSignup.fields.required")}
                  checked={field.required}
                  disabled={locked || !field.enabled}
                  onChange={(required) => patchField(field.key, { required })}
                />
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <Input
                  aria-label={`${t("adminPopupSignup.fields.labelPl")} - ${field.key}`}
                  value={field.label_pl}
                  onChange={(e) => patchField(field.key, { label_pl: e.target.value })}
                  placeholder={t("adminPopupSignup.fields.labelPl")}
                />
                <Input
                  aria-label={`${t("adminPopupSignup.fields.labelEn")} - ${field.key}`}
                  value={field.label_en}
                  onChange={(e) => patchField(field.key, { label_en: e.target.value })}
                  placeholder={t("adminPopupSignup.fields.labelEn")}
                />
                <Input
                  aria-label={`${t("adminPopupSignup.fields.placeholderPl")} - ${field.key}`}
                  value={field.placeholder_pl}
                  onChange={(e) => patchField(field.key, { placeholder_pl: e.target.value })}
                  placeholder={t("adminPopupSignup.fields.placeholderPl")}
                />
                <Input
                  aria-label={`${t("adminPopupSignup.fields.placeholderEn")} - ${field.key}`}
                  value={field.placeholder_en}
                  onChange={(e) => patchField(field.key, { placeholder_en: e.target.value })}
                  placeholder={t("adminPopupSignup.fields.placeholderEn")}
                />
              </div>
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}
