// Zgłoszenie użytkownika do moderacji tenanta. Dialog kontrolowany - otwiera go
// popover ConnectButton (`AuthorMoreMenu` -> `ConnectButton`). Dedup i rate
// limit egzekwuje DB (report_user).
//
// `ReportUserButton` - samodzielny przycisk owijający ten dialog - został
// USUNIĘTY 20260913 razem ze swoimi czterema przypadkami testowymi. Był
// wyeksportowany i pokryty testami, ale NIE MIAŁ ANI JEDNEGO konsumenta
// produkcyjnego: pokrycie wyglądało jak zdrowie i nic nie sygnalizowało, że
// nikt go nie woła. Metryka nagradzała trzymanie kodu bez użytkownika.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Flag } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useReportUser } from "@/lib/network/useConnections";
import { toastError } from "@/lib/toastError";
import "@/lib/i18n-network";

const REASONS = ["spam", "harassment", "impersonation", "inappropriate", "other"] as const;
const DETAILS_MAX = 1000;

export function ReportUserDialog({
  userId,
  displayName,
  open,
  onOpenChange,
}: {
  userId: string;
  displayName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const report = useReportUser();
  const [reason, setReason] = useState<(typeof REASONS)[number]>("spam");
  const [details, setDetails] = useState("");

  const submit = () => {
    report.mutate(
      { userId, reason, details },
      {
        onSuccess: () => {
          onOpenChange(false);
          setDetails("");
          toast.success(t("network.reportedToast"));
        },
        onError: (e) => {
          // `useReportUser` jest typowane na `Error`, więc bez rzutowania.
          const msg = e.message;
          if (msg.includes("rate limited")) toast.error(t("network.reportRateLimited"));
          else toastError(e, "save");
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("network.reportTitle", { name: displayName })}</DialogTitle>
          <DialogDescription>{t("network.reportBody")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <p className="text-sm font-medium">{t("network.reportReasonLabel")}</p>
            <Select
              value={reason}
              onValueChange={(next) => setReason(next as (typeof REASONS)[number])}
            >
              <SelectTrigger aria-label={t("network.reportReasonLabel")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REASONS.map((r) => (
                  <SelectItem key={r} value={r}>
                    {t(`network.reportReasons.${r}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <p className="text-sm font-medium">{t("network.reportDetailsLabel")}</p>
            <Textarea
              value={details}
              maxLength={DETAILS_MAX}
              rows={3}
              onChange={(e) => setDetails(e.target.value)}
              placeholder={t("network.reportDetailsPlaceholder")}
              aria-label={t("network.reportDetailsLabel")}
              className="resize-none text-sm"
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="destructive"
            disabled={report.isPending}
            onClick={submit}
            className="gap-1.5"
          >
            <Flag className="h-3.5 w-3.5" aria-hidden />
            {t("network.reportSubmit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
