// Dialog "Poproś o wprowadzenie" - LinkedIn-style bridge introductions.
// Requester wybiera kogoś ze SWOJEJ sieci jako "bridge" i pisze notkę
// (20-600 znaków). Baza sama waliduje że bridge<->target są połączeni
// oraz że target zezwala na komunikację.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { UsersRound, Search } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { useMyConnections } from "@/lib/network/useConnections";
import {
  useRequestIntroduction,
  INTRO_MESSAGE_MIN,
  INTRO_MESSAGE_MAX,
  type IntroductionRow,
} from "@/lib/network/useIntroductions";
import { toastError } from "@/lib/toastError";
import { cn } from "@/lib/utils";
import "@/lib/i18n-network";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetId: string;
  targetName: string;
  /** Wiersze wprowadzeń, gdzie zalogowany jest requester - filtr aktywnych bridge'ów. */
  existing?: ReadonlyArray<IntroductionRow>;
}

export function RequestIntroductionDialog({
  open,
  onOpenChange,
  targetId,
  targetName,
  existing = [],
}: Props) {
  const { t } = useTranslation();
  const [bridgeId, setBridgeId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");

  const connectionsQ = useMyConnections(search, 30);
  const connections = useMemo(() => (connectionsQ.data?.pages ?? []).flat(), [connectionsQ.data]);

  // ID mostów już użytych w aktywnych wprowadzeniach do tego targetu.
  const usedBridges = useMemo(() => {
    const set = new Set<string>();
    for (const row of existing) {
      if (row.target_id === targetId && row.status === "pending") {
        set.add(row.bridge_id);
      }
    }
    return set;
  }, [existing, targetId]);

  const request = useRequestIntroduction();

  const trimmed = message.trim();
  const len = trimmed.length;
  const inRange = len >= INTRO_MESSAGE_MIN && len <= INTRO_MESSAGE_MAX;
  const canSubmit = Boolean(bridgeId) && inRange && !request.isPending;

  const reset = () => {
    setBridgeId(null);
    setMessage("");
    setSearch("");
  };

  const handleSubmit = () => {
    if (!bridgeId || !inRange) return;
    request.mutate(
      { bridgeId, targetId, message: trimmed },
      {
        onSuccess: () => {
          toast.success(t("network.introductions.requestedToast"));
          reset();
          onOpenChange(false);
        },
        onError: (err) => toastError(err, "save"),
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) reset();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <UsersRound className="h-4 w-4 text-primary" />
            {t("network.introductions.requestTitle", { name: targetName })}
          </DialogTitle>
          <DialogDescription className="text-xs leading-relaxed">
            {t("network.introductions.requestSubtitle")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t("network.introductions.bridgeLabel")}
            </label>
            <div className="relative mb-2">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("network.searchPlaceholder")}
                className="h-9 pl-8 text-sm"
              />
            </div>
            <div className="max-h-56 divide-y divide-border/60 overflow-y-auto rounded-md border border-border bg-background/60">
              {connectionsQ.isPending ? (
                <div className="p-3 text-center text-xs text-muted-foreground">
                  {t("network.loadingMore")}
                </div>
              ) : connections.length === 0 ? (
                <div className="p-3 text-center text-xs italic text-muted-foreground">
                  {t("network.introductions.noBridges")}
                </div>
              ) : (
                connections.map((c) => {
                  const used = usedBridges.has(c.user_id);
                  const selected = bridgeId === c.user_id;
                  return (
                    <button
                      type="button"
                      key={c.user_id}
                      disabled={used}
                      onClick={() => setBridgeId(c.user_id)}
                      className={cn(
                        "flex w-full items-center gap-3 px-3 py-2 text-left transition-colors",
                        selected && "bg-primary/10",
                        !selected && !used && "hover:bg-muted/60",
                        used && "cursor-not-allowed opacity-50",
                      )}
                    >
                      <div className="h-8 w-8 shrink-0 overflow-hidden rounded-full border border-border bg-muted">
                        {c.avatar_url ? (
                          <img
                            src={c.avatar_url}
                            alt=""
                            className="h-full w-full object-cover"
                            loading="lazy"
                          />
                        ) : null}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-foreground">
                          {c.display_name}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {[c.job_title, c.current_company].filter(Boolean).join(" - ")}
                        </div>
                      </div>
                      {used && (
                        <span className="shrink-0 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                          {t("network.introductions.bridgeUsed")}
                        </span>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t("network.introductions.messageLabel")}
            </label>
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value.slice(0, INTRO_MESSAGE_MAX))}
              placeholder={t("network.introductions.messagePlaceholder", { name: targetName })}
              rows={5}
              className="resize-none text-sm"
            />
            <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
              <span>{t("network.introductions.messageHint")}</span>
              <span className={cn("tabular-nums", !inRange && len > 0 && "text-destructive")}>
                {len} / {INTRO_MESSAGE_MAX}
              </span>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("network.introductions.cancel")}
          </Button>
          <Button disabled={!canSubmit} onClick={handleSubmit}>
            {request.isPending
              ? t("network.introductions.sending")
              : t("network.introductions.send")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
