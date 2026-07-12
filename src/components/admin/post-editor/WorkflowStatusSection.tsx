import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  isoToLocalInput,
  localInputToIso,
  type PostWorkflowStatus,
  type StatusOption,
} from "@/lib/content/workflow";

interface Props {
  status: PostWorkflowStatus;
  publishAt: string | null;
  publishedAt: string | null;
  canPublish: boolean;
  busy: boolean;
  statusOptions: StatusOption[];
  scheduledInPast: boolean;
  uiLang: string;
  onStatusChange: (status: PostWorkflowStatus) => void;
  onPublishAtChange: (iso: string | null) => void;
  onApplyStatus: (status: PostWorkflowStatus) => void;
}

export function WorkflowStatusSection({
  status,
  publishAt,
  publishedAt,
  canPublish,
  busy,
  statusOptions,
  scheduledInPast,
  uiLang,
  onStatusChange,
  onPublishAtChange,
  onApplyStatus,
}: Props) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      <div>
        <Label>{t("admin.posts.status")}</Label>
        <Select value={status} onValueChange={(v) => onStatusChange(v as PostWorkflowStatus)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {statusOptions.map((o) => (
              <SelectItem key={o.value} value={o.value} disabled={o.publisherOnly}>
                {t(`admin.status.${o.value}`)}
                {o.publisherOnly
                  ? ` - ${t("admin.workflow.adminOnly", { defaultValue: "tylko administrator" })}`
                  : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {!canPublish && (
          <p className="mt-1 text-[11px] text-muted-foreground">
            {t("admin.workflow.writerHint", {
              defaultValue:
                "Publikuje administrator - wyślij wpis do recenzji, a redakcja go zatwierdzi.",
            })}
          </p>
        )}
      </div>

      {status === "scheduled" && (
        <div>
          <Label>{t("admin.workflow.publishAt", { defaultValue: "Data publikacji" })}</Label>
          <Input
            type="datetime-local"
            value={isoToLocalInput(publishAt)}
            onChange={(e) => onPublishAtChange(localInputToIso(e.target.value))}
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            {!publishAt
              ? t("admin.workflow.publishAtRequired", {
                  defaultValue: "Zaplanowany wpis wymaga daty publikacji.",
                })
              : scheduledInPast
                ? t("admin.workflow.publishAtPast", {
                    defaultValue:
                      "Data jest w przeszłości - wpis zostanie opublikowany natychmiast.",
                  })
                : t("admin.workflow.publishAtHint", {
                    defaultValue: "Wpis opublikuje się automatycznie o wskazanej godzinie.",
                  })}
          </p>
        </div>
      )}

      {status === "published" && publishedAt && (
        <p className="text-[11px] text-muted-foreground">
          {t("admin.workflow.publishedAt", {
            defaultValue: "Opublikowano: {{date}}",
            date: new Date(publishedAt).toLocaleString(uiLang),
          })}
        </p>
      )}

      {!canPublish && status === "draft" && (
        <Button
          type="button"
          size="sm"
          className="w-full"
          disabled={busy}
          onClick={() => onApplyStatus("pending_review")}
        >
          {t("admin.workflow.submitReview", { defaultValue: "Wyślij do recenzji" })}
        </Button>
      )}
      {status === "pending_review" &&
        (canPublish ? (
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              className="flex-1"
              disabled={busy}
              onClick={() => onApplyStatus("published")}
            >
              {t("admin.workflow.approvePublish", { defaultValue: "Zatwierdź i opublikuj" })}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="flex-1"
              disabled={busy}
              onClick={() => onApplyStatus("draft")}
            >
              {t("admin.workflow.rejectToDraft", { defaultValue: "Odrzuć do szkicu" })}
            </Button>
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            {t("admin.workflow.awaitingReview", {
              defaultValue: "Wpis czeka na recenzję administratora.",
            })}
          </p>
        ))}
    </div>
  );
}
