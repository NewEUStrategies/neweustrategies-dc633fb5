// Lista zapytań jednej skrzynki („otrzymane"/„wysłane") z akcjami statusu.
//
// Wydzielona z routes/profile.expert-requests.tsx: eksportowany symbol w pliku
// trasy nie może zostać wycięty przez route splitter, a side-effectowy import
// słownika (i18n-* jest w package.json `sideEffects`) zostawał wtedy w shellu
// trasy - czyli w chunku wejściowym każdej strony publicznej. Jako komponent
// żyje obok pozostałych elementów zapytań (ExpertRequestCancelDialog) i ma
// własny test (components/chat/__tests__/expertRequestCancel.test.tsx).
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  useMyExpertRequests,
  useResolveExpertRequest,
  type ExpertRequestBox,
  type ExpertRequestRow,
} from "@/lib/chat/useExpertRequests";
import { expertRequestErrorI18nKey } from "@/lib/chat/expertRequestErrors";
import { ExpertRequestCancelDialog } from "@/components/chat/ExpertRequestCancelDialog";
import "@/lib/i18n-expert-request";

export function ExpertRequestList({
  box,
  highlightId,
}: {
  box: ExpertRequestBox;
  highlightId?: string;
}) {
  const { t } = useTranslation();
  const q = useMyExpertRequests(box);
  const resolve = useResolveExpertRequest();
  const highlightRef = useRef<HTMLLIElement | null>(null);
  // Wycofanie zużywa pulę miesięczną, więc wymaga jawnego potwierdzenia.
  const [pendingCancel, setPendingCancel] = useState<ExpertRequestRow | null>(null);

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
        action === "cancel"
          ? t("expertRequest.confirmCancel.doneToast")
          : t(`expertRequest.status.${action === "approve" ? "approved" : action}`),
      );
    } catch (error) {
      toast.error(t(expertRequestErrorI18nKey(error)));
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
    <>
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
                    onClick={() => setPendingCancel(row)}
                  >
                    {t("expertRequest.actions.cancel")}
                  </Button>
                ) : (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      className="rounded-[6px]"
                      onClick={() => void act(row, "decline")}
                    >
                      {t("expertRequest.actions.decline")}
                    </Button>
                    <Button
                      size="sm"
                      className="rounded-[6px]"
                      onClick={() => void act(row, "approve")}
                    >
                      {t("expertRequest.actions.approve")}
                    </Button>
                  </>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>

      <ExpertRequestCancelDialog
        subject={pendingCancel?.subject ?? null}
        busy={resolve.isPending}
        onOpenChange={(open) => {
          if (!open) setPendingCancel(null);
        }}
        onConfirm={async () => {
          const row = pendingCancel;
          if (!row) return;
          await act(row, "cancel");
          setPendingCancel(null);
        }}
      />
    </>
  );
}
