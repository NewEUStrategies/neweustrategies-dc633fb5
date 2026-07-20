// Karta "Linki podglądu (embargo)" w edytorze wpisu (B5): tworzenie
// tokenowych linków do szkicu (72 h domyślnie), lista aktywnych z datą
// wygaśnięcia, kopiowanie i odwołanie. Dostęp bez konta - patrz
// previewTokens.functions.ts i trasa /preview/$token.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Copy, Plus, Trash2 } from "lucide-react";
import {
  createPreviewToken,
  listPreviewTokens,
  revokePreviewToken,
} from "@/lib/content/previewTokens.functions";
import { Button } from "@/components/ui/button";
import "@/lib/i18n-admin-post-panes";

export function PreviewLinksCard({ postId }: { postId: string }) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const create$ = useServerFn(createPreviewToken);
  const list$ = useServerFn(listPreviewTokens);
  const revoke$ = useServerFn(revokePreviewToken);
  const [busy, setBusy] = useState(false);

  const queryKey = ["admin", "preview-tokens", postId] as const;
  const { data: tokens } = useQuery({
    queryKey,
    queryFn: () => list$({ data: { postId } }),
  });

  const previewUrl = (token: string) => `${window.location.origin}/preview/${token}`;

  const createM = useMutation({
    mutationFn: async () => create$({ data: { postId, ttlHours: 72 } }),
    onSuccess: async (row) => {
      void qc.invalidateQueries({ queryKey });
      try {
        await navigator.clipboard.writeText(previewUrl(row.token));
        toast.success(t("adminPostPanes.previewLinks.createdCopied"));
      } catch {
        toast.success(t("adminPostPanes.previewLinks.created"));
      }
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const onCopy = async (token: string) => {
    try {
      await navigator.clipboard.writeText(previewUrl(token));
      toast.success(t("adminPostPanes.previewLinks.copied"));
    } catch {
      toast.error(t("adminPostPanes.previewLinks.copyFailed"));
    }
  };

  const onRevoke = async (id: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await revoke$({ data: { id } });
      void qc.invalidateQueries({ queryKey });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const locale = i18n.language === "en" ? "en-GB" : "pl-PL";

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-muted-foreground -mt-1">
        {t("adminPostPanes.previewLinks.hint")}
      </p>
      <Button
        type="button"
        size="sm"
        className="w-full"
        disabled={createM.isPending}
        onClick={() => createM.mutate()}
      >
        <Plus className="w-3.5 h-3.5 mr-1" aria-hidden="true" />
        {t("adminPostPanes.previewLinks.create")}
      </Button>
      {(tokens ?? []).length > 0 && (
        <ul className="space-y-1.5">
          {(tokens ?? []).map((row) => (
            <li
              key={row.id}
              className="flex items-center justify-between gap-2 rounded border border-border/60 px-2 py-1.5 text-xs"
            >
              <span className="min-w-0 truncate tabular-nums text-muted-foreground">
                {t("adminPostPanes.previewLinks.expires")}:{" "}
                {new Date(row.expires_at).toLocaleString(locale)}
              </span>
              <span className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => void onCopy(row.token)}
                  aria-label={t("adminPostPanes.previewLinks.copy")}
                  className="text-muted-foreground hover:text-brand transition"
                >
                  <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => void onRevoke(row.id)}
                  disabled={busy}
                  aria-label={t("adminPostPanes.previewLinks.revoke")}
                  className="text-muted-foreground hover:text-destructive transition"
                >
                  <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
