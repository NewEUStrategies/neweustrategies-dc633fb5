// /admin/community/contributors - moderacja zgłoszeń współtwórców.
// Statusy UI: pending / approved / rejected (mapowane w warstwie /lib do 4
// wartości DB). Filtry po statusie i języku (pl/en). Podgląd notatek redakcji.
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ensureI18n as ensureAdminCommunityI18n } from "@/lib/i18n-admin-community";
import { uiLocale } from "@/lib/i18n/format";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { UserPlus, Check, X, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  fetchContributorSubmissions,
  reviewContributorSubmission,
  type ContributorStatus,
} from "@/lib/admin/community";

export const Route = createFileRoute("/admin/community/contributors")({
  head: () => ({ meta: [{ title: "Contributors · Community · Admin" }] }),
  component: ContributorsAdmin,
});

type LangFilter = "all" | "pl" | "en";

const statusTone: Record<ContributorStatus, "default" | "outline" | "secondary" | "destructive"> = {
  pending: "default",
  approved: "secondary",
  rejected: "destructive",
};

function ContributorsAdmin() {
  ensureAdminCommunityI18n();
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const [status, setStatus] = useState<ContributorStatus | "all">("pending");
  const [language, setLanguage] = useState<LangFilter>("all");
  const [notes, setNotes] = useState<Record<string, string>>({});

  const q = useQuery({
    queryKey: ["admin-contributors", status, language],
    queryFn: () => fetchContributorSubmissions(status, language),
    staleTime: 15_000,
  });

  const reviewM = useMutation({
    mutationFn: (v: { id: string; s: Exclude<ContributorStatus, "pending">; note?: string }) =>
      reviewContributorSubmission(v.id, v.s, v.note),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-contributors"] });
      qc.invalidateQueries({ queryKey: ["admin-engagement-snapshot"] });
      toast.success(t("adminCommunity.contributors.saved"));
    },
    onError: () => toast.error(t("adminCommunity.contributors.failed")),
  });

  // Mapa WSKAZUJE KLUCZE, nie napisy: `Record<ContributorStatus, string>` wymusza
  // pokrycie kazdego wariantu, a test slownika domyka druga polowe kontraktu.
  const STATUS_LABEL_KEYS: Record<ContributorStatus, string> = {
    pending: "adminCommunity.contributors.statusPending",
    approved: "adminCommunity.contributors.statusApproved",
    rejected: "adminCommunity.contributors.statusRejected",
  };
  const statusLabel = (s: ContributorStatus) => t(STATUS_LABEL_KEYS[s]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <UserPlus className="w-4 h-4" />
          <h2 className="text-lg font-semibold">{t("adminCommunity.contributors.contributors")}</h2>
        </div>
        <div className="flex items-center gap-2">
          <Select value={language} onValueChange={(v) => setLanguage(v as LangFilter)}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("adminCommunity.contributors.allLanguages")}</SelectItem>
              <SelectItem value="pl">PL</SelectItem>
              <SelectItem value="en">EN</SelectItem>
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={(v) => setStatus(v as ContributorStatus | "all")}>
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("adminCommunity.contributors.all")}</SelectItem>
              <SelectItem value="pending">{statusLabel("pending")}</SelectItem>
              <SelectItem value="approved">{statusLabel("approved")}</SelectItem>
              <SelectItem value="rejected">{statusLabel("rejected")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {q.isLoading ? (
            <div className="p-4 text-sm text-muted-foreground">
              {t("adminCommunity.contributors.loading")}
            </div>
          ) : (q.data ?? []).length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground text-center">
              {t("adminCommunity.contributors.noSubmissions")}
            </div>
          ) : (
            <ul className="divide-y divide-border/60">
              {(q.data ?? []).map((s) => (
                <li key={s.id} className="p-4 space-y-2 animate-fade-in">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="font-medium text-sm">{s.title}</div>
                    <div className="flex items-center gap-2">
                      <Badge
                        variant="outline"
                        className="uppercase text-[10px] tracking-wider font-mono"
                      >
                        {s.language.toUpperCase()}
                      </Badge>
                      <Badge variant={statusTone[s.status]} className="capitalize">
                        {s.status === "pending" && <Clock className="w-3 h-3 mr-1" />}
                        {statusLabel(s.status)}
                      </Badge>
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">{s.pitch}</p>
                  <div className="text-xs text-muted-foreground">
                    {new Date(s.created_at).toLocaleString(uiLocale(i18n.language))}
                    {s.reviewed_at ? (
                      <>
                        {" · "}
                        {t("adminCommunity.contributors.reviewed")}
                        {new Date(s.reviewed_at).toLocaleString(uiLocale(i18n.language))}
                      </>
                    ) : null}
                  </div>
                  {s.status === "pending" && (
                    <div className="space-y-2 pt-2">
                      <Textarea
                        placeholder={t("adminCommunity.contributors.editorNoteOptional")}
                        value={notes[s.id] ?? ""}
                        onChange={(e) => setNotes({ ...notes, [s.id]: e.target.value })}
                        className="min-h-[60px]"
                      />
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          disabled={reviewM.isPending}
                          onClick={() =>
                            reviewM.mutate({ id: s.id, s: "approved", note: notes[s.id] })
                          }
                        >
                          <Check className="w-4 h-4 mr-1" />
                          {t("adminCommunity.contributors.approve")}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={reviewM.isPending}
                          onClick={() =>
                            reviewM.mutate({ id: s.id, s: "rejected", note: notes[s.id] })
                          }
                        >
                          <X className="w-4 h-4 mr-1" />
                          {t("adminCommunity.contributors.reject")}
                        </Button>
                      </div>
                    </div>
                  )}
                  {s.editor_note && (
                    <div className="text-xs bg-muted/50 rounded p-2">
                      <span className="font-medium">{t("adminCommunity.contributors.note")}</span>
                      {s.editor_note}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
