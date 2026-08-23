// Molekuła: pola kreacji zależne od rodzaju slotu (html / script / image).
//
// Jedna odpowiedzialność: KTÓRE pola należą do którego rodzaju. Ostrzeżenie
// o izolowanej ramce (sandbox) stoi przy OBU polach wykonywalnych - to jedyne
// miejsce, w którym panel mówi redaktorowi, że wklejany kod nie dostanie sesji
// czytelnika ani DOM strony.
//
// Molekuła nie ma stanu własnego: dostaje wartości i JEDNO domknięcie zmiany
// (łatka na draft), więc przełączenie rodzaju nie gubi pozostałych pól.
import { FloatingInput, FloatingTextarea } from "@/components/ui/floating-input";
import { useTranslation } from "react-i18next";
import type { AdSlot, AdSlotKind } from "@/lib/ads/types";
import { ensureI18n as ensureAdsAdminI18n } from "@/lib/i18n-ads-admin";

export interface AdSlotKindValues {
  html: string;
  script: string;
  imageUrl: string;
  imageLink: string;
  imageAlt: string;
}

export function AdSlotKindFields({
  kind,
  values,
  onChange,
}: {
  kind: AdSlotKind;
  values: AdSlotKindValues;
  onChange: (patch: Partial<AdSlot>) => void;
}) {
  ensureAdsAdminI18n();
  const { t } = useTranslation();
  return (
    <>
      {kind === "html" && (
        <div className="sm:col-span-2 space-y-1.5">
          <FloatingTextarea
            label={t("adsAdmin.slots.fieldHtml")}
            rows={4}
            value={values.html}
            onChange={(e) => onChange({ html: e.target.value })}
            className="font-mono text-xs"
          />
          <p className="text-xs text-muted-foreground">
            Kreacja wykonuje się w izolowanej ramce (sandbox) - bez dostępu do sesji czytelnika i
            DOM strony.
          </p>
        </div>
      )}
      {kind === "script" && (
        <div className="sm:col-span-2 space-y-1.5">
          <FloatingTextarea
            label="Skrypt (np. AdSense)"
            rows={5}
            value={values.script}
            onChange={(e) => onChange({ script: e.target.value })}
            className="font-mono text-xs"
          />
          <p className="text-xs text-muted-foreground">
            Skrypt wykonuje się w izolowanej ramce (sandbox) - bez dostępu do sesji czytelnika i DOM
            strony.
          </p>
        </div>
      )}
      {kind === "image" && (
        <>
          <FloatingInput
            containerClassName="sm:col-span-2"
            label="URL grafiki"
            value={values.imageUrl}
            onChange={(e) => onChange({ image_url: e.target.value })}
          />
          <FloatingInput
            label={t("adsAdmin.slots.fieldClickUrl")}
            value={values.imageLink}
            onChange={(e) => onChange({ image_link: e.target.value })}
          />
          <FloatingInput
            label={t("adsAdmin.slots.fieldAlt")}
            value={values.imageAlt}
            onChange={(e) => onChange({ image_alt: e.target.value })}
          />
        </>
      )}
    </>
  );
}
