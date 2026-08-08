// Zgloszenie WPISU klubowego do moderacji.
//
// Osobny dialog od `ReportUserDialog`, bo zglasza sie tu co innego: nie osobe,
// tylko tresc. To nie jest kosmetyka - `report_user` przyjmuje identyfikator
// autora, a pod regula Chatham House klient go NIE MA i miec nie moze. Gdyby
// zgloszenie wymagalo autora, wpisy anonimowe bylyby jedyna tresci w serwisie,
// ktorej nie da sie zglosic - czyli dokladnie ta, w ktorej naduzycie jest
// najbardziej prawdopodobne. Autora rozwiazuje RPC po stronie bazy.
//
// Specyfikacja stawia to jednoznacznie (V1 §7): wejscie "Zglos" ma byc przy
// KAZDYM wpisie od pierwszego dnia. Czat nie ma go od szesciu wydan i to jest
// w tym dokumencie przywolane jako przestroga, nie jako wzorzec.
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useReportClubContent } from "@/lib/clubs/useClubs";
import {
  CLUB_REPORT_REASONS,
  type ClubReactionTarget,
  type ClubReportReason,
} from "@/lib/clubs/types";
import { ensureClubI18n } from "@/lib/i18n-club";

const DETAILS_MAX = 1000;

export function ClubReportDialog({
  targetType,
  targetId,
  open,
  onOpenChange,
}: {
  targetType: ClubReactionTarget;
  targetId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  ensureClubI18n();
  const { t } = useTranslation();
  const report = useReportClubContent();
  const [reason, setReason] = useState<ClubReportReason>("inappropriate");
  const [details, setDetails] = useState("");

  const submit = () => {
    report.mutate(
      { targetType, targetId, reason, details: details.trim() || null },
      {
        onSuccess: () => {
          onOpenChange(false);
          setDetails("");
          // Potwierdzenie mowi, co sie stalo DALEJ, a nie samo "gotowe":
          // zglaszajacy ma wiedziec, ze sprawa trafila do ludzi, nie w prozne.
          toast.success(t("club.report.sent"));
        },
        onError: () => toast.error(t("club.report.failed")),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("club.report.title")}</DialogTitle>
          <DialogDescription>{t("club.report.description")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="club-report-reason">{t("club.report.reasonLabel")}</Label>
            <Select value={reason} onValueChange={(v) => setReason(v as ClubReportReason)}>
              <SelectTrigger id="club-report-reason">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CLUB_REPORT_REASONS.map((value) => (
                  <SelectItem key={value} value={value}>
                    {t(`club.report.reason.${value}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="club-report-details">{t("club.report.detailsLabel")}</Label>
            <Textarea
              id="club-report-details"
              rows={4}
              maxLength={DETAILS_MAX}
              value={details}
              disabled={report.isPending}
              placeholder={t("club.report.detailsPlaceholder")}
              onChange={(e) => setDetails(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {details.length} / {DETAILS_MAX}
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={report.isPending}>
            {t("club.report.cancel")}
          </Button>
          <Button onClick={submit} disabled={report.isPending}>
            <Flag className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            {t("club.report.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
