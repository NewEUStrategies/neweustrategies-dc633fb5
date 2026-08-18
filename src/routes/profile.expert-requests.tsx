import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useMyExpertRequestQuota, type ExpertRequestBox } from "@/lib/chat/useExpertRequests";
// Lista mieszka w components/chat (nie w tym pliku): eksportowany symbol
// w pliku trasy blokował route splitter i trzymał słownik zapytań w entry.
import { ExpertRequestList } from "@/components/chat/ExpertRequestList";
import { ensureI18n as ensureExpertRequestI18n } from "@/lib/i18n-expert-request";
// Głęboki link z powiadomienia (`?box=…&r=<uuid>`) - walidacja żyje w czystym
// module, więc ma własny test i nie rozszczelnia fast refresh trasy.
import { validateExpertRequestsSearch } from "@/lib/chat/expertRequestsSearch";

export const Route = createFileRoute("/profile/expert-requests")({
  head: () => ({
    meta: [{ title: "Zapytania do ekspertów" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  validateSearch: validateExpertRequestsSearch,
  component: ProfileExpertRequests,
});

/** Pasek stanu puli - ta sama liczba, którą egzekwuje bramka wysyłki. */
function QuotaNote() {
  const { t } = useTranslation();
  const quotaQ = useMyExpertRequestQuota();
  const quota = quotaQ.data;
  if (!quota || quota.direct || quota.quota <= 0) return null;

  return (
    <p className="rounded-[6px] border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
      {t("expertRequest.quota.remaining", { remaining: quota.remaining, quota: quota.quota })}{" "}
      {t("expertRequest.quota.cancelledCounts")}
    </p>
  );
}

function ProfileExpertRequests() {
  ensureExpertRequestI18n();
  const { t } = useTranslation();
  const { box, r } = Route.useSearch();
  const [tab, setTab] = useState<ExpertRequestBox>(box ?? "received");
  // Kolejne kliknięcie w powiadomienie (ta sama trasa, inna skrzynka) musi
  // przestawić zakładkę - stan lokalny sam z siebie by tego nie zauważył.
  useEffect(() => {
    if (box) setTab(box);
  }, [box]);
  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-xl font-bold uppercase italic tracking-tight text-foreground">
          {t("expertRequest.profile.title")}
        </h1>
        <p className="mt-1 text-xs text-muted-foreground">{t("expertRequest.profile.subtitle")}</p>
      </header>
      <QuotaNote />
      <Tabs value={tab} onValueChange={(v) => setTab(v as ExpertRequestBox)}>
        <TabsList>
          <TabsTrigger value="received">{t("expertRequest.box.received")}</TabsTrigger>
          <TabsTrigger value="sent">{t("expertRequest.box.sent")}</TabsTrigger>
        </TabsList>
        <TabsContent value="received" className="mt-3">
          <ExpertRequestList box="received" {...(r ? { highlightId: r } : {})} />
        </TabsContent>
        <TabsContent value="sent" className="mt-3">
          <ExpertRequestList box="sent" {...(r ? { highlightId: r } : {})} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
