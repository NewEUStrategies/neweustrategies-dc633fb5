// /admin/newsletter/campaigns — lista i tworzenie kampanii.
// Przy montowaniu odpala opportunistic tick (`processDueCampaigns`), który
// wysyła zaległe kampanie zaplanowane - fallback zamiast pg_cron, bo wysyłka
// wymaga env HTTP (RESEND_API_KEY). Patrz docs/ARCHITECTURE.md §2.6.
import { useEffect, useRef } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { uiLocale } from "@/lib/i18n/format";
import { toast } from "sonner";
import {
  Plus,
  Trash2,
  Send,
  Clock,
  CheckCircle2,
  XCircle,
  FileText,
  RefreshCw,
} from "lucide-react";
import {
  listCampaigns,
  upsertCampaign,
  deleteCampaign,
  sendCampaign,
  processDueCampaigns,
  type CampaignRow,
} from "@/lib/newsletter-campaigns.functions";
import { JobRunnerCard } from "@/components/admin/newsletter/runner/JobRunnerCard";
import { createDefaultEmailDoc } from "@/lib/newsletter/emailDoc";

import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/admin/newsletter/campaigns/")({
  component: CampaignsList,
});

// Mapa WSKAZUJE KLUCZE, nie napisy: pary `{ labelPl, labelEn }` byly kolejnym
// rownoleglym slownikiem, ktorego bramka parytetu nie widziala.
const STATUS_META: Record<
  CampaignRow["status"],
  { icon: typeof Send; className: string; labelKey: string }
> = {
  draft: {
    icon: FileText,
    className: "bg-muted text-muted-foreground",
    labelKey: "adminNewsletter.campaigns.status.draft",
  },
  scheduled: {
    icon: Clock,
    className: "bg-blue-100 text-blue-800",
    labelKey: "adminNewsletter.campaigns.status.scheduled",
  },
  sending: {
    icon: Send,
    className: "bg-amber-100 text-amber-800",
    labelKey: "adminNewsletter.campaigns.status.sending",
  },
  sent: {
    icon: CheckCircle2,
    className: "bg-emerald-100 text-emerald-800",
    labelKey: "adminNewsletter.campaigns.status.sent",
  },
  failed: {
    icon: XCircle,
    className: "bg-red-100 text-red-800",
    labelKey: "adminNewsletter.campaigns.status.failed",
  },
  cancelled: {
    icon: XCircle,
    className: "bg-muted text-muted-foreground",
    labelKey: "adminNewsletter.campaigns.status.cancelled",
  },
};

// Kampania w `sending` bez aktywnej dzierżawy = wznawialna natychmiast
// (porcja się skończyła albo poprzedni proces zginął). Model lease zastąpił
// dawną 20-minutową heurystykę "stuck".
function isResumableSending(c: CampaignRow): boolean {
  if (c.status !== "sending") return false;
  if (!c.lease_until) return true;
  const lease = Date.parse(c.lease_until);
  return !Number.isFinite(lease) || lease < Date.now();
}

function CampaignsList() {
  const { i18n, t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const list = useServerFn(listCampaigns);
  const create = useServerFn(upsertCampaign);
  const remove = useServerFn(deleteCampaign);
  const send = useServerFn(sendCampaign);
  const processDue = useServerFn(processDueCampaigns);

  const { data: campaigns = [], isLoading } = useQuery({
    queryKey: ["admin", "newsletter-campaigns"],
    queryFn: () => list(),
  });

  // Opportunistic tick: raz przy montowaniu + co 12 s, dopóki jakaś kampania
  // jest w `sending` (kontynuacja porcji po zamkniętej karcie edytora, gdy
  // cron/pg_net nie jest jeszcze skonfigurowany). Fire-and-forget; toast
  // tylko gdy faktycznie coś ruszyło.
  const tickRan = useRef(false);
  const anySending = campaigns.some((c) => c.status === "sending");
  useEffect(() => {
    const tick = () =>
      processDue()
        .then((res) => {
          if (res.fired > 0 || res.continued > 0) {
            if (res.fired > 0) {
              toast.success(t("adminNewsletter.campaigns.dueFired", { count: res.fired }));
            }
            qc.invalidateQueries({ queryKey: ["admin", "newsletter-campaigns"] });
          }
        })
        .catch(() => undefined);
    if (!tickRan.current) {
      tickRan.current = true;
      void tick();
    }
    if (!anySending) return;
    const handle = setInterval(tick, 12_000);
    return () => clearInterval(handle);
  }, [processDue, qc, t, anySending]);

  const processDueMut = useMutation({
    mutationFn: () => processDue(),
    onSuccess: (res) => {
      if (res.fired > 0 || res.continued > 0) {
        toast.success(
          t("adminNewsletter.campaigns.dueSummary", {
            fired: res.fired,
            continued: res.continued,
          }),
        );
      } else {
        toast.info(t("adminNewsletter.campaigns.noDueCampaigns"));
      }
      qc.invalidateQueries({ queryKey: ["admin", "newsletter-campaigns"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const resumeMut = useMutation({
    mutationFn: (id: string) => send({ data: { id } }),
    onSuccess: (res) => {
      toast.success(
        t("adminNewsletter.campaigns.resumeResult", { sent: res.sent, failed: res.failed }),
      );
      qc.invalidateQueries({ queryKey: ["admin", "newsletter-campaigns"] });
    },
    onError: (err: Error) => {
      toast.error(err.message);
      qc.invalidateQueries({ queryKey: ["admin", "newsletter-campaigns"] });
    },
  });

  const createMut = useMutation({
    mutationFn: () =>
      create({
        data: {
          name: t("adminNewsletter.campaigns.newCampaign"),
          subject_pl: "",
          subject_en: "",
          html_pl: "",
          html_en: "",
          // Nowe kampanie startują w kreatorze bloków; legacy zostają na html.
          editor: "doc",
          content_doc: createDefaultEmailDoc(),
          audience_filter: {},
        },
      }),
    onSuccess: ({ id }) => {
      toast.success(t("adminCampaigns.created", "Utworzono kampanię"));
      navigate({ to: "/admin/newsletter/campaigns/$id", params: { id } });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const removeMut = useMutation({
    mutationFn: (id: string) => remove({ data: { id } }),
    onSuccess: () => {
      toast.success(t("adminCampaigns.deleted", "Kampania usunięta"));
      qc.invalidateQueries({ queryKey: ["admin", "newsletter-campaigns"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">{t("adminNewsletter.campaigns.listHeading")}</h2>
          <p className="text-sm text-muted-foreground">
            {t("adminNewsletter.campaigns.listSubtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => processDueMut.mutate()}
            disabled={processDueMut.isPending}
          >
            <Clock className={`w-4 h-4 mr-2 ${processDueMut.isPending ? "animate-pulse" : ""}`} />
            {t("adminNewsletter.campaigns.processDue")}
          </Button>
          <Button onClick={() => createMut.mutate()} disabled={createMut.isPending}>
            <Plus className="w-4 h-4 mr-2" />
            {t("adminNewsletter.campaigns.newCampaign")}
          </Button>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("adminNewsletter.campaigns.colName")}</TableHead>
              <TableHead>{t("adminNewsletter.campaigns.colStatus")}</TableHead>
              <TableHead>{t("adminNewsletter.campaigns.scheduledFor")}</TableHead>
              <TableHead className="text-right">
                {t("adminNewsletter.campaigns.recipients")}
              </TableHead>
              <TableHead className="text-right">
                {t("adminNewsletter.campaigns.sentLabel")}
              </TableHead>
              <TableHead>{t("adminNewsletter.campaigns.colCreated")}</TableHead>
              <TableHead className="w-16" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                  {t("adminNewsletter.campaigns.detailLoading")}
                </TableCell>
              </TableRow>
            ) : campaigns.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                  {t("adminNewsletter.campaigns.listEmpty")}
                </TableCell>
              </TableRow>
            ) : (
              campaigns.map((c) => {
                const meta = STATUS_META[c.status];
                const Icon = meta.icon;
                const canDelete = c.status !== "sending" && c.status !== "sent";
                const stuck = isResumableSending(c);
                const resuming = resumeMut.isPending && resumeMut.variables === c.id;
                return (
                  <TableRow key={c.id}>
                    <TableCell>
                      <Link
                        to="/admin/newsletter/campaigns/$id"
                        params={{ id: c.id }}
                        className="font-medium hover:underline"
                      >
                        {c.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col items-start gap-1">
                        <Badge className={meta.className}>
                          <Icon className="w-3 h-3 mr-1" />
                          {t(meta.labelKey)}
                        </Badge>
                        {stuck && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            disabled={resumeMut.isPending}
                            onClick={() => resumeMut.mutate(c.id)}
                          >
                            <RefreshCw
                              className={`w-3 h-3 mr-1 ${resuming ? "animate-spin" : ""}`}
                            />
                            {t("adminNewsletter.campaigns.resume")}
                          </Button>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {c.scheduled_at
                        ? new Date(c.scheduled_at).toLocaleString(uiLocale(i18n.language))
                        : "-"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{c.recipient_count}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {c.sent_count}
                      {c.failed_count > 0 && (
                        <span className="text-red-600 ml-1">/ {c.failed_count}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(c.created_at).toLocaleString(uiLocale(i18n.language))}
                    </TableCell>
                    <TableCell>
                      {canDelete && (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon" aria-label="Delete">
                              <Trash2 className="w-4 h-4 text-red-600" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>
                                {t("adminNewsletter.campaigns.deleteHeading")}
                              </AlertDialogTitle>
                              <AlertDialogDescription>
                                {t("adminNewsletter.campaigns.deleteBody", { name: c.name })}
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>
                                {t("adminNewsletter.campaigns.cancel")}
                              </AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => removeMut.mutate(c.id)}
                                className="bg-red-600 hover:bg-red-700"
                              >
                                {t("adminNewsletter.campaigns.delete")}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <JobRunnerCard />
    </div>
  );
}
