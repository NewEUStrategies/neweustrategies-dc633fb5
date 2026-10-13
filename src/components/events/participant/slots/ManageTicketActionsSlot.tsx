// GNIAZDO `ManageTicketActionsSlot` - samoobsługi zgłoszenia po kluczu - pod kartą stanu zgłoszenia.
//
// WŁAŚCICIEL: tor B. Treść: ZASADY ZWROTU opłaconego zgłoszenia (REG-03,
// decyzja D9) - zanim uczestnik w ogóle sięgnie po rezygnację, widzi, do kiedy
// rezygnacja zwraca wpłatę, albo że zwrot zależy już od organizatora.
//
// TA SAMA ODPOWIEDŹ CO PANEL. Gniazdo czyta podgląd rezygnacji pod tym samym
// kluczem zapytania (`useCancellationPreview`), więc zdanie tutaj i skutek przy
// potwierdzeniu rezygnacji nie mogą się rozjechać, a baza dostaje jedno pytanie.
// Termin pokazujemy w strefie wydarzenia - z tego samego nagłówka, co panel.
//
// MILCZY, GDY NIE MA O CZYM MÓWIĆ: zgłoszenie bezpłatne, bilet z planu, wpłata
// już zwrócona, zgłoszenie zamknięte, brak klucza albo podgląd niedostępny.
//
// Właściwości są zamrożone (`slotTypes.ts`); tor przepisuje ciało tego pliku
// i jego test (`__tests__/ManageTicketActionsSlot.test.tsx`), nigdy hosta.
import { useQuery } from "@tanstack/react-query";
import { ReceiptText } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { ManagePanelSlotProps } from "@/components/events/participant/slots/slotTypes";
import { fetchEventPageHeader } from "@/lib/community/publicQueries";
import { uiLang } from "@/lib/i18n/format";
import { formatEventDateTime } from "@/lib/events/timezone";
import { useCancellationPreview } from "@/lib/events/useCancellationPreview";
import { ensureEventRegistrationI18n } from "@/lib/i18n-event-registration";

ensureEventRegistrationI18n();

export function ManageTicketActionsSlot({ slug, token }: ManagePanelSlotProps) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const preview = useCancellationPreview({ slug, manageToken: token }).data;
  // Ten sam klucz zapytania co nagłówek panelu - odpowiedź jest już w cache.
  const header = useQuery({
    queryKey: ["event-page-header", slug, "manage"],
    queryFn: () => fetchEventPageHeader(slug),
    staleTime: 60_000,
    enabled: token !== null,
  }).data;

  if (token === null || preview?.kind !== "ok" || preview.refund === null) return null;
  const refund = preview.refund;

  let sentence: string | null = null;
  if (refund.effect === "full_refund") {
    const date =
      refund.refundDeadlineAt === null
        ? ""
        : formatEventDateTime(refund.refundDeadlineAt, header?.timezone ?? null, lang);
    sentence =
      date === ""
        ? t("eventRegistration.cancelRefund.policyWindow")
        : t("eventRegistration.cancelRefund.policyUntil", { date });
  } else if (refund.effect === "no_refund" || refund.effect === "organizer_review") {
    sentence = t("eventRegistration.cancelRefund.policyNone");
  }
  if (sentence === null) return null;

  return (
    <section
      aria-label={t("eventRegistration.cancelRefund.policyTitle")}
      className="space-y-1 rounded-[6px] border border-border bg-card p-4"
    >
      <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <ReceiptText className="h-4 w-4" aria-hidden="true" />
        {t("eventRegistration.cancelRefund.policyTitle")}
      </h2>
      <p className="text-sm text-muted-foreground">{sentence}</p>
    </section>
  );
}
