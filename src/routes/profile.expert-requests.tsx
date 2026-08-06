import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  useMyExpertRequests,
  useResolveExpertRequest,
  type ExpertRequestBox,
  type ExpertRequestRow,
} from "@/lib/chat/useExpertRequests";
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

function ExpertRequestList({ box, highlightId }: { box: ExpertRequestBox; highlightId?: string }) {
  const { t } = useTranslation();
  const q = useMyExpertRequests(box);
  const resolve = useResolveExpertRequest();
  const highlightRef = useRef<HTMLLIElement | null>(null);

  // Wejście z powiadomienia: przewiń do wskazanego zapytania, gdy tylko lista
  // się załaduje. `block: "center"` zamiast domyślnego „start", żeby wiersz nie
  // schował się pod przyklejonym nagłówkiem profilu.
  useEffect(() => {
    if (!highlightId || !highlightRef.current) return;
    highlightRef.current.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [highlightId, q.data]);

  async function act(row: ExpertRequestRow, action: "approve" | "decline" | "answered" | "cancel") {
    try {
      await resolve.mutateAsync({ requestId: row.id, action });
      toast.success(
        t(
          `expertRequest.status.${action === "cancel" ? "cancelled" : action === "approve" ? "approved" : action}`,
        ),
      );
    } catch {
      toast.error(t("expertRequest.error.generic"));
    }
  }

  const rows = q.data ?? [];
  if (rows.length === 0) {
    return (
      <p className="rounded-[6px] border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
        {t("expertRequest.box.empty")}
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((row) => (
        <li
          key={row.id}
          ref={row.id === highlightId ? highlightRef : undefined}
          className={cn(
            "rounded-[6px] border bg-card p-3 transition-colors",
            row.id === highlightId
              ? "border-[var(--brand)] ring-1 ring-[var(--brand)]/40"
              : "border-border",
          )}
        >
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-sm font-semibold">{row.subject}</p>
            <span className="rounded-[6px] border border-border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider">
              {t(`expertRequest.status.${row.status}`)}
            </span>
          </div>
          <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">{row.reason}</p>
          {row.status === "pending" && (
            <div className="mt-2 flex flex-wrap justify-end gap-1.5">
              {box === "sent" ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-[6px]"
                  onClick={() => act(row, "cancel")}
                >
                  {t("expertRequest.actions.cancel")}
                </Button>
              ) : (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-[6px]"
                    onClick={() => act(row, "decline")}
                  >
                    {t("expertRequest.actions.decline")}
                  </Button>
                  <Button size="sm" className="rounded-[6px]" onClick={() => act(row, "approve")}>
                    {t("expertRequest.actions.approve")}
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
