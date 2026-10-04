// Organizm: ekran FAKTUR studia wydarzenia (`registration/invoices`).
//
// PIEC ZAKLADEK, JEDNA PRACA. "Do zafakturowania" (zamowienia pogrupowane po
// NIP-ie, faktura pojedyncza i zbiorcza, proforma, masowe wystawienie
// z prosb), "Wystawione", "Szkice i proformy", "Korekty" i "Ustawienia
// wystawcy" - te ostatnie wspolne dla wszystkich wydarzen organizatora.
//
// DWA OSTRZEZENIA NAD ZAKLADKAMI, BO DOTYCZA KAZDEJ Z NICH:
//   * fakturowanie wylaczone (brak danych wystawcy albo potwierdzenia, ze
//     organizator jest sprzedawca) - nic nie powstanie, dopoki tego nie
//     uzupelnimy;
//   * kasa w trybie operatora platnosci (Merchant of Record, ta sama regula
//     co `checkoutBillingPlane()`): sprzedawca zamowien z karty jest wtedy
//     operator i wlasnej faktury VAT za nie wystawic nie wolno (baza
//     odmawia); proformy i zamowienia z przelewu sa dostepne;
//   * kasa na wlasnym koncie z fakturami Stripe (`invoice_creation`): za
//     platnosc karta fakture wystawia juz Stripe - druga faktura VAT za te
//     sama sprzedaz nie powstanie (baza odmawia: `operator_invoice_enabled`).
//     Bez faktur Stripe - notka, ze zamowienie z karty sprzed ostatniej
//     zmiany ustawien kasy faktury organizatora nie dostanie (kasa nie
//     zapisuje plaszczyzny na zamowieniu, wiec nie wiadomo, kto je sprzedal).
//
// PO WYSTAWIENIU wysylamy kupujacym powiadomienie (funkcja serwerowa
// z bramka w bazie, klucz idempotencji per dokument) - organizator widzi,
// ile maili poszlo.
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EventInvoiceCandidatesList } from "@/components/admin/events/molecules/EventInvoiceCandidatesList";
import { EventInvoiceCorrectionDialog } from "@/components/admin/events/molecules/EventInvoiceCorrectionDialog";
import { EventInvoiceDocumentsList } from "@/components/admin/events/molecules/EventInvoiceDocumentsList";
import { EventInvoiceDraftDialog } from "@/components/admin/events/molecules/EventInvoiceDraftDialog";
import { EventInvoiceKsefDialog } from "@/components/admin/events/molecules/EventInvoiceKsefDialog";
import { EventInvoiceSettingsForm } from "@/components/admin/events/molecules/EventInvoiceSettingsForm";
import { useCheckoutSettings } from "@/hooks/useCheckoutSettings";
import { checkoutBillingPlane } from "@/lib/billing/checkoutSettings";
import type { EventInvoiceListRow, IssuedInvoice } from "@/lib/events/eventInvoicesApi";
import { notifyEventInvoicesIssued } from "@/lib/events/eventInvoiceNotify.functions";
import { pickEnum } from "@/lib/events/eventInvoiceEnums";
import { useInvoiceSettings } from "@/lib/events/useEventInvoices";
import { ensureAdminEventInvoicesI18n } from "@/lib/i18n-admin-event-invoices";

type PanelTab = "candidates" | "issued" | "drafts" | "corrections" | "settings";

const TABS: readonly PanelTab[] = ["candidates", "issued", "drafts", "corrections", "settings"];

const TAB_LABEL_KEYS: Record<PanelTab, string> = {
  candidates: "adminEventInvoices.tabs.candidates",
  issued: "adminEventInvoices.tabs.issued",
  drafts: "adminEventInvoices.tabs.drafts",
  corrections: "adminEventInvoices.tabs.corrections",
  settings: "adminEventInvoices.tabs.settings",
};

export function EventInvoicesPanel({ eventId }: { eventId: string }) {
  ensureAdminEventInvoicesI18n();
  const { t } = useTranslation();
  const settingsQ = useInvoiceSettings();
  const checkoutQ = useCheckoutSettings();
  const notify = useServerFn(notifyEventInvoicesIssued);
  const [tab, setTab] = useState<PanelTab>("candidates");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [correctingId, setCorrectingId] = useState<string | null>(null);
  const [ksefRow, setKsefRow] = useState<EventInvoiceListRow | null>(null);

  const enabled = settingsQ.data?.enabled === true;
  const plane = checkoutQ.data === undefined ? null : checkoutBillingPlane(checkoutQ.data);
  const managed = plane === "managed";
  const stripeInvoices = plane === "merchant" && checkoutQ.data?.invoice_creation === true;

  async function sendNotices(invoiceIds: readonly string[]): Promise<void> {
    if (invoiceIds.length === 0) return;
    try {
      const result = await notify({ data: { invoiceIds: [...invoiceIds] } });
      if (result.sent > 0)
        toast.success(t("adminEventInvoices.toasts.notified", { count: result.sent }));
      if (result.failed > 0) toast.error(t("adminEventInvoices.toasts.notifyFailed"));
    } catch {
      toast.error(t("adminEventInvoices.toasts.notifyFailed"));
    }
  }

  function issued(result: IssuedInvoice): void {
    toast.success(t("adminEventInvoices.toasts.issued", { number: result.number }));
    void sendNotices([result.id]);
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">{t("adminEventInvoices.description")}</p>
      {settingsQ.data !== undefined && !enabled ? (
        <div
          role="status"
          className="space-y-2 rounded-md border border-brand/50 bg-brand/10 p-3"
        >
          <p className="text-sm font-semibold">{t("adminEventInvoices.disabled.title")}</p>
          <p className="text-sm">{t("adminEventInvoices.disabled.body")}</p>
          <Button type="button" size="sm" variant="outline" onClick={() => setTab("settings")}>
            {t("adminEventInvoices.disabled.action")}
          </Button>
        </div>
      ) : null}
      {managed ? (
        <div
          role="note"
          className="space-y-1 rounded-md border border-destructive/40 bg-destructive/5 p-3"
        >
          <p className="text-sm font-semibold">{t("adminEventInvoices.mor.title")}</p>
          <p className="text-sm">{t("adminEventInvoices.mor.body")}</p>
        </div>
      ) : stripeInvoices ? (
        <div
          role="note"
          className="space-y-1 rounded-md border border-destructive/40 bg-destructive/5 p-3"
        >
          <p className="text-sm font-semibold">{t("adminEventInvoices.operatorInvoice.title")}</p>
          <p className="text-sm">{t("adminEventInvoices.operatorInvoice.body")}</p>
        </div>
      ) : plane === "merchant" ? (
        <p role="note" className="text-sm text-muted-foreground">
          {t("adminEventInvoices.planeNote")}
        </p>
      ) : null}
      <Tabs value={tab} onValueChange={(value) => setTab(pickEnum(TABS, value))}>
        <TabsList className="flex-wrap">
          {TABS.map((item) => (
            <TabsTrigger key={item} value={item}>
              {t(TAB_LABEL_KEYS[item])}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="candidates" className="pt-4">
          <EventInvoiceCandidatesList
            eventId={eventId}
            enabled={enabled}
            onDraftCreated={setEditingId}
            onBulkIssued={(result) => void sendNotices(result.issued.map((item) => item.id))}
          />
        </TabsContent>
        {(["issued", "drafts", "corrections"] as const).map((item) => (
          <TabsContent key={item} value={item} className="pt-4">
            <EventInvoiceDocumentsList
              eventId={eventId}
              tab={item}
              onEdit={setEditingId}
              onCorrect={setCorrectingId}
              onKsef={setKsefRow}
              onIssued={issued}
            />
          </TabsContent>
        ))}
        <TabsContent value="settings" className="pt-4">
          <EventInvoiceSettingsForm />
        </TabsContent>
      </Tabs>
      <EventInvoiceDraftDialog
        eventId={eventId}
        invoiceId={editingId}
        onClose={() => setEditingId(null)}
        onIssued={issued}
      />
      <EventInvoiceCorrectionDialog
        eventId={eventId}
        invoiceId={correctingId}
        onClose={() => setCorrectingId(null)}
        onCreated={(draftId) => {
          setCorrectingId(null);
          setEditingId(draftId);
        }}
      />
      <EventInvoiceKsefDialog eventId={eventId} row={ksefRow} onClose={() => setKsefRow(null)} />
    </div>
  );
}
