// Organizm: treść maila „Poproś o zgodę na pomiar" (I9d-Y2) w treściach maili
// newslettera (`/admin/newsletter/email-content`) - obok prośby wygaszania,
// bo tam redakcja szuka edytowalnych maili. Od I9d-Y2b prośba dotyczy
// OSOBNEJ zgody na pomiar (w mailu - treść pola pomiaru, którą zapisze
// kliknięcie); edytor dotyczy wyłącznie próśb z panelu - prośba po zapisie
// bez double opt-in ma treść stałą (`NEWSLETTER_MEASUREMENT_SIGNUP_COPY`).
//
// JEDEN EDYTOR, DWIE PROŚBY. Ciało (pola PL/EN z limitami, „Przywróć
// domyślne" per język, podgląd renderu serwera z treścią szkicu, zapis z CAS
// bez wycierania szkicu przy konflikcie) to `MailCopyEditorBody` - ten sam
// co prośby wygaszania (kształt nadpisań i schemat zapisu są wspólne). Tu
// zostają mutatory pomiaru, treść domyślna, zmienna `{firstName}` i napisy.
// Treść zgody w mailu (ta, którą zapisze kliknięcie), przycisk i wypis
// dokłada system - nie są do edycji (prawo wyboru odbiorcy).
//
// LENIWY CHUNK: wchodzi przez `NewsletterMeasurementCopySection`.
import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { MailQuestion } from "lucide-react";

import { SectionCard } from "@/components/admin/membership/atoms/SectionCard";
import { MailCopyEditorBody } from "@/components/admin/settings/dataRetention/MailCopyEditorBody";
import { Button } from "@/components/ui/button";
import { ensureI18n } from "@/lib/i18n-admin-newsletter-measurement";
import type { NewsletterMeasurementCopyDto } from "@/lib/privacy/measurement.functions";
import {
  newsletterMeasurementCopyQueryOptions,
  usePreviewNewsletterMeasurementEmail,
  useSaveNewsletterMeasurementCopy,
} from "@/lib/privacy/measurementQueries";
import {
  NEWSLETTER_MEASUREMENT_DEFAULT_COPY,
  NEWSLETTER_MEASUREMENT_TOKENS,
} from "@/lib/privacy/measurementReconfirm";
import { NEWSLETTER_MEASUREMENT_COPY_ANCHOR } from "./consentTextRules";

export default function NewsletterMeasurementCopyEditor() {
  ensureI18n();
  const { t } = useTranslation();
  const copyQ = useQuery(newsletterMeasurementCopyQueryOptions());
  const read = copyQ.data;
  const anchorRef = useRef<HTMLDivElement>(null);

  // Odnośnik z karty „Poproś o zgodę na pomiar" niesie kotwicę, a edytor jest
  // leniwy - przeglądarka szukała jej, zanim powstała.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.location.hash === `#${NEWSLETTER_MEASUREMENT_COPY_ANCHOR}`) {
      anchorRef.current?.scrollIntoView?.({ block: "start" });
    }
  }, []);

  return (
    <div id={NEWSLETTER_MEASUREMENT_COPY_ANCHOR} ref={anchorRef} className="scroll-mt-24">
      <SectionCard
        icon={MailQuestion}
        title={t("adminNewsletterMeasurement.copy.title")}
        description={t("adminNewsletterMeasurement.copy.subtitle")}
      >
        {copyQ.isLoading ? (
          <p role="status" className="text-sm text-muted-foreground">
            {t("adminNewsletterMeasurement.copy.loading")}
          </p>
        ) : copyQ.isError || read === undefined ? (
          <div role="alert" className="flex flex-wrap items-center gap-3 text-sm">
            {t("adminNewsletterMeasurement.copy.readError")}
            <Button size="sm" variant="outline" onClick={() => void copyQ.refetch()}>
              {t("adminNewsletterMeasurement.retry")}
            </Button>
          </div>
        ) : read.state === "forbidden" ? (
          <p role="status" className="text-sm text-muted-foreground">
            {t("adminNewsletterMeasurement.copy.forbidden")}
          </p>
        ) : read.state === "unavailable" ? (
          <p role="status" className="text-sm text-muted-foreground">
            {t("adminNewsletterMeasurement.copy.unavailable")}
          </p>
        ) : (
          <EditorBody saved={read.data} />
        )}
      </SectionCard>
    </div>
  );
}

function EditorBody({ saved }: { saved: NewsletterMeasurementCopyDto }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const saveM = useSaveNewsletterMeasurementCopy();
  const previewM = usePreviewNewsletterMeasurementEmail();
  return (
    <MailCopyEditorBody
      saved={saved}
      defaults={NEWSLETTER_MEASUREMENT_DEFAULT_COPY}
      texts={{
        tokens: t("adminNewsletterMeasurement.copy.tokens", {
          tokens: NEWSLETTER_MEASUREMENT_TOKENS.map((token) => `{${token}}`).join(", "),
        }),
        saved: t("adminNewsletterMeasurement.copy.saved"),
        saveError: t("adminNewsletterMeasurement.copy.saveError"),
        conflict: t("adminNewsletterMeasurement.copy.conflict"),
        forbidden: t("adminNewsletterMeasurement.copy.forbidden"),
        previewFrame: t("adminNewsletterMeasurement.copy.previewFrame"),
        previewNote: t("adminNewsletterMeasurement.copy.previewNote"),
      }}
      saving={saveM.isPending}
      save={(input) => saveM.mutateAsync(input)}
      latest={() => {
        const latest = queryClient.getQueryData(newsletterMeasurementCopyQueryOptions().queryKey);
        return latest?.state === "ready" ? latest.data : null;
      }}
      preview={previewM}
    />
  );
}
