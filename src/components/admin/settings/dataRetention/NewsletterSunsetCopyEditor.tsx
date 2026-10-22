// Organizm: edytor treści maila z prośbą o potwierdzenie subskrypcji
// (wygaszanie nieaktywnych subskrybentów, I9d-Y1, Z-I9c-08) w ustawieniach
// newslettera - obok treści maili transakcyjnych (`/admin/newsletter/
// email-content`), bo tam redakcja szuka edytowalnych maili.
//
// WZORZEC PÓL NEWSLETTERA (`TxEmailContentPanel`): PL/EN przełącznikiem,
// PUSTE pole = treść domyślna w tonie NES (placeholder pokazuje, co wyjdzie),
// „Przywróć domyślne" czyści JEDEN język (reset obu wyciera pracę tłumacza),
// podgląd z tego samego renderu co wysyłka (funkcja serwerowa Y1-B).
//
// LIMIT ODRZUCA, NIE PRZYCINA (AGENTS). Licznik liczy punkty kodowe jak
// `char_length` (`copyLength`); pole ponad limit blokuje zapis z komunikatem
// przy polu - mail nie dostanie po cichu uciętego zdania.
//
// WSPÓŁBIEŻNOŚĆ. Zapis niesie token `updated_at` odczytu (CAS). Konflikt NIE
// wyciera szkicu: edytor przyjmuje nowszą wersję jako bazę, zostawia wpisany
// tekst i mówi, że kolejny zapis nadpisze tamtą wersję - świadomie. Nowszą
// wersję bierze z pamięci zapytań (mutator czeka na ponowny odczyt przed
// oddaniem wyniku), a nie z propsów - powiadomienie obserwatora przychodzi
// dopiero w następnym takcie, a zapis z dawnym tokenem dałby drugi konflikt.
//
// LENIWY CHUNK: trasa ładuje edytor przez `lazy()` (słownik retencji, zod
// i zapytania nie trafiają do chunku sekcji newslettera).
//
// I9d-Y2: ciało edytora (pola, limity, podgląd, CAS) jest WSPÓLNE z prośbą
// o zgodę na pomiar (`MailCopyEditorBody`) - tu zostają mutatory, treść
// domyślna, zmienne i napisy prośby wygaszania.
import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Mail } from "lucide-react";

import { SectionCard } from "@/components/admin/membership/atoms/SectionCard";
import { Button } from "@/components/ui/button";
import { ensureI18n } from "@/lib/i18n-admin-data-retention";
import {
  NEWSLETTER_SUNSET_DEFAULT_COPY,
  NEWSLETTER_SUNSET_TOKENS,
} from "@/lib/privacy/newsletterSunset";
import type { NewsletterSunsetCopyDto } from "@/lib/privacy/newsletterSunset.functions";
import {
  newsletterSunsetCopyQueryOptions,
  usePreviewNewsletterSunsetEmail,
  useSaveNewsletterSunsetCopy,
} from "@/lib/privacy/newsletterSunsetQueries";
import { MailCopyEditorBody } from "./MailCopyEditorBody";
import { NEWSLETTER_SUNSET_COPY_ANCHOR } from "./sunsetCopyRules";

export default function NewsletterSunsetCopyEditor({ tenantId }: { tenantId: string }) {
  ensureI18n();
  const { t } = useTranslation();
  const copyQ = useQuery(newsletterSunsetCopyQueryOptions(tenantId));
  const read = copyQ.data;
  const anchorRef = useRef<HTMLDivElement>(null);

  // Odnośnik z karty retencji niesie `#newsletter-sunset-copy`, ale edytor
  // jest leniwy - przeglądarka szukała kotwicy, zanim powstała.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.location.hash === `#${NEWSLETTER_SUNSET_COPY_ANCHOR}`) {
      anchorRef.current?.scrollIntoView?.({ block: "start" });
    }
  }, []);

  return (
    <div id={NEWSLETTER_SUNSET_COPY_ANCHOR} ref={anchorRef} className="scroll-mt-24">
      <SectionCard
        icon={Mail}
        title={t("adminDataRetention.sunsetCopy.title")}
        description={t("adminDataRetention.sunsetCopy.subtitle")}
      >
        {copyQ.isLoading ? (
          <p role="status" className="text-sm text-muted-foreground">
            {t("adminDataRetention.sunsetCopy.loading")}
          </p>
        ) : copyQ.isError || read === undefined ? (
          <div role="alert" className="flex flex-wrap items-center gap-3 text-sm">
            {t("adminDataRetention.sunsetCopy.readError")}
            <Button size="sm" variant="outline" onClick={() => void copyQ.refetch()}>
              {t("adminDataRetention.retry")}
            </Button>
          </div>
        ) : read.state === "forbidden" ? (
          <p role="status" className="text-sm text-muted-foreground">
            {t("adminDataRetention.sunsetCopy.forbidden")}
          </p>
        ) : read.state === "unavailable" ? (
          <p role="status" className="text-sm text-muted-foreground">
            {t("adminDataRetention.sunsetCopy.unavailable")}
          </p>
        ) : (
          <EditorBody tenantId={tenantId} saved={read.data} />
        )}
      </SectionCard>
    </div>
  );
}

function EditorBody({ tenantId, saved }: { tenantId: string; saved: NewsletterSunsetCopyDto }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const saveM = useSaveNewsletterSunsetCopy(tenantId);
  const previewM = usePreviewNewsletterSunsetEmail();
  return (
    <MailCopyEditorBody
      saved={saved}
      defaults={NEWSLETTER_SUNSET_DEFAULT_COPY}
      texts={{
        tokens: t("adminDataRetention.sunsetCopy.tokens", {
          tokens: NEWSLETTER_SUNSET_TOKENS.map((token) => `{${token}}`).join(", "),
        }),
        saved: t("adminDataRetention.sunsetCopy.saved"),
        saveError: t("adminDataRetention.sunsetCopy.saveError"),
        conflict: t("adminDataRetention.sunsetCopy.conflict"),
        forbidden: t("adminDataRetention.sunsetCopy.forbidden"),
        previewFrame: t("adminDataRetention.sunsetCopy.previewFrame"),
        previewNote: t("adminDataRetention.sunsetCopy.previewNote"),
      }}
      saving={saveM.isPending}
      save={(input) => saveM.mutateAsync(input)}
      latest={() => {
        const latest = queryClient.getQueryData(
          newsletterSunsetCopyQueryOptions(tenantId).queryKey,
        );
        return latest?.state === "ready" ? latest.data : null;
      }}
      preview={previewM}
    />
  );
}
