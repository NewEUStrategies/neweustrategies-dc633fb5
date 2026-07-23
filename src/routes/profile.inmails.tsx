import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useMyInmails, useResolveInmail, type InMailBox, type InMailRow } from "@/lib/chat/useInmails";
import { ensureI18n as ensureInmailI18n } from "@/lib/i18n-inmail";

export const Route = createFileRoute("/profile/inmails")({
  head: () => ({ meta: [{ title: "Zapytania do ekspertów" }, { name: "robots", content: "noindex, nofollow" }] }),
  component: ProfileInmails,
});

function InmailList({ box }: { box: InMailBox }) {
  const { t } = useTranslation();
  const q = useMyInmails(box);
  const resolve = useResolveInmail();

  async function act(row: InMailRow, action: "approve" | "decline" | "answered" | "cancel") {
    try {
      await resolve.mutateAsync({ inmailId: row.id, action });
      toast.success(t(`inmail.status.${action === "cancel" ? "cancelled" : action === "approve" ? "approved" : action}`));
    } catch {
      toast.error(t("inmail.error.generic"));
    }
  }

  const rows = q.data ?? [];
  if (rows.length === 0) {
    return <p className="rounded-[6px] border border-dashed border-border p-6 text-center text-xs text-muted-foreground">{t("inmail.box.empty")}</p>;
  }
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((row) => (
        <li key={row.id} className="rounded-[6px] border border-border bg-card p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-sm font-semibold">{row.subject}</p>
            <span className="rounded-[6px] border border-border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider">
              {t(`inmail.status.${row.status}`)}
            </span>
          </div>
          <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">{row.reason}</p>
          {row.status === "pending" && (
            <div className="mt-2 flex flex-wrap justify-end gap-1.5">
              {box === "sent" ? (
                <Button size="sm" variant="outline" className="rounded-[6px]" onClick={() => act(row, "cancel")}>
                  {t("inmail.actions.cancel")}
                </Button>
              ) : (
                <>
                  <Button size="sm" variant="outline" className="rounded-[6px]" onClick={() => act(row, "decline")}>
                    {t("inmail.actions.decline")}
                  </Button>
                  <Button size="sm" className="rounded-[6px]" onClick={() => act(row, "approve")}>
                    {t("inmail.actions.approve")}
                  </Button>
                </>
              )}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

function ProfileInmails() {
  ensureInmailI18n();
  const { t } = useTranslation();
  const [tab, setTab] = useState<InMailBox>("received");
  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-xl font-bold uppercase italic tracking-tight text-foreground">
          {t("inmail.profile.title")}
        </h1>
        <p className="mt-1 text-xs text-muted-foreground">{t("inmail.profile.subtitle")}</p>
      </header>
      <Tabs value={tab} onValueChange={(v) => setTab(v as InMailBox)}>
        <TabsList>
          <TabsTrigger value="received">{t("inmail.box.received")}</TabsTrigger>
          <TabsTrigger value="sent">{t("inmail.box.sent")}</TabsTrigger>
        </TabsList>
        <TabsContent value="received" className="mt-3">
          <InmailList box="received" />
        </TabsContent>
        <TabsContent value="sent" className="mt-3">
          <InmailList box="sent" />
        </TabsContent>
      </Tabs>
    </div>
  );
}
