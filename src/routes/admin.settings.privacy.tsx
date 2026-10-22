// /admin/settings/privacy - polityka prywatności, baner zgód, audyt zgód
// i (I9c-X2) karta „Retencja danych": okresy przechowywania, tryb podglądu,
// kontakty CRM do anonimizacji, piksel otwarć.
//
// Nagłówek sekcyjny (AGENTS.md): layout `/admin/settings` nie daje
// podstronie własnego tytułu. Karta retencji ładuje się LENIWIE (`lazy`) -
// słownik, zapytania i molekuły nie trafiają do chunku wejściowego panelu;
// plik trasy nie importuje słownika karty (bramka
// `adminRouteDictionaryImports.gate.test.ts`).
import { lazy, Suspense } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useSettings, useDraft } from "@/lib/admin/useSettings";
import { Field, Text, Checkbox, SaveBar } from "@/components/admin/settings/fields";
import { ConsentAuditSummary } from "@/components/admin/settings/ConsentAuditSummary";
import { useAuth } from "@/hooks/useAuth";
import { adminPageHead } from "@/lib/adminPageHead";

const DataRetentionCard = lazy(
  () => import("@/components/admin/settings/dataRetention/DataRetentionCard"),
);

type Privacy = {
  privacy_page_slug: string;
  cookie_banner: boolean;
};

const DEFAULTS: Privacy = { privacy_page_slug: "", cookie_banner: true };

export const Route = createFileRoute("/admin/settings/privacy")({
  head: () =>
    adminPageHead(
      "Prywatność i retencja danych - Ustawienia",
      "Polityka prywatności, baner zgód, audyt zgód i okresy przechowywania danych osobowych. Panel administracyjny New European Strategies.",
    ),
  component: PrivacySettings,
});

function PrivacySettings() {
  const { t } = useTranslation();
  const { tenantId } = useAuth();
  const { query, save } = useSettings<Privacy>("privacy", DEFAULTS);
  const [draft, setDraft] = useDraft(query.data);
  if (!draft) return <p className="text-sm text-muted-foreground">{t("admin.loading")}</p>;
  const set = <K extends keyof Privacy>(k: K, v: Privacy[K]) => setDraft({ ...draft, [k]: v });

  return (
    <div>
      <h2 className="font-display text-xl mb-4">{t("admin.privacy.title")}</h2>
      <Field label={t("admin.privacy.policyPage")} hint={t("admin.privacy.policyPageHint")}>
        <Text
          value={draft.privacy_page_slug}
          onChange={(e) => set("privacy_page_slug", e.target.value)}
          placeholder="polityka-prywatnosci"
        />
      </Field>
      <Field label={t("admin.privacy.cookieBanner")}>
        <Checkbox
          label={t("admin.privacy.cookieBannerLabel")}
          checked={draft.cookie_banner}
          onChange={(v) => set("cookie_banner", v)}
        />
      </Field>
      <SaveBar saving={save.isPending} onSave={() => save.mutate(draft)} />

      {/* Audyt zgód: kto/kiedy/jakie kategorie/wersja banera - dane z RPC
          z bramką admina i zakresem najemcy. */}
      <ConsentAuditSummary />

      {/* Retencja danych (I9c-X2): okresy, karencja, przebiegi - RPC z bramką
          admina, najemca z sesji. */}
      <div className="mt-8">
        <Suspense
          fallback={
            <p role="status" className="text-sm text-muted-foreground">
              {t("admin.loading")}
            </p>
          }
        >
          <DataRetentionCard tenantId={tenantId} />
        </Suspense>
      </div>
    </div>
  );
}
