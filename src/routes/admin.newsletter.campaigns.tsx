// /admin/newsletter/campaigns — lista i tworzenie kampanii.
// Przy montowaniu odpala opportunistic tick (`processDueCampaigns`), który
// wysyła zaległe kampanie zaplanowane - fallback zamiast pg_cron, bo wysyłka
// wymaga env HTTP (RESEND_API_KEY). Patrz docs/ARCHITECTURE.md §2.6.
import { useEffect, useRef } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
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

export const Route = createFileRoute("/admin/newsletter/campaigns")({
  component: CampaignsList,
});

const STATUS_META: Record<
  CampaignRow["status"],
  { icon: typeof Send; className: string; labelPl: string; labelEn: string }
> = {
  draft: {
    icon: FileText,
    className: "bg-muted text-muted-foreground",
    labelPl: "Szkic",
    labelEn: "Draft",
  },
  scheduled: {
    icon: Clock,
    className: "bg-blue-100 text-blue-800",
    labelPl: "Zaplanowana",
    labelEn: "Scheduled",
  },
  sending: {
    icon: Send,
    className: "bg-amber-100 text-amber-800",
    labelPl: "Wysyłanie",
    labelEn: "Sending",
  },
  sent: {
    icon: CheckCircle2,
    className: "bg-emerald-100 text-emerald-800",
    labelPl: "Wysłana",
    labelEn: "Sent",
  },
  failed: {
    icon: XCircle,
    className: "bg-red-100 text-red-800",
    labelPl: "Błąd",
    labelEn: "Failed",
  },
  cancelled: {
    icon: XCircle,
    className: "bg-muted text-muted-foreground",
    labelPl: "Anulowana",
    labelEn: "Cancelled",
  },
};

const STUCK_SENDING_MS = 20 * 60 * 1000;

function isStuckSending(c: CampaignRow): boolean {
  if (c.status !== "sending" || !c.started_at) return false;
  const started = Date.parse(c.started_at);
  return Number.isFinite(started) && Date.now() - started > STUCK_SENDING_MS;
}

function CampaignsList() {
  const { i18n, t } = useTranslation();
  const isPl = (i18n.language ?? "pl").startsWith("pl");
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

  // Opportunistic tick: raz przy montowaniu, fire-and-forget. Toast tylko
  // gdy faktycznie coś zostało wysłane.
  const tickRan = useRef(false);
  useEffect(() => {
    if (tickRan.current) return;
    tickRan.current = true;
    processDue()
      .then((res) => {
        if (res.fired > 0) {
          toast.success(
            isPl
              ? `Wysłano ${res.fired} zaplanowanych kampanii`
              : `Sent ${res.fired} scheduled campaigns`,
          );
          qc.invalidateQueries({ queryKey: ["admin", "newsletter-campaigns"] });
        }
      })
      .catch(() => undefined);
  }, [processDue, qc, isPl]);

  const processDueMut = useMutation({
    mutationFn: () => processDue(),
    onSuccess: (res) => {
      if (res.fired > 0) {
        toast.success(
          isPl
            ? `Wysłano ${res.fired} zaplanowanych kampanii`
            : `Sent ${res.fired} scheduled campaigns`,
        );
      } else {
        toast.info(isPl ? "Brak zaległych kampanii" : "No due campaigns");
      }
      qc.invalidateQueries({ queryKey: ["admin", "newsletter-campaigns"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const resumeMut = useMutation({
    mutationFn: (id: string) => send({ data: { id } }),
    onSuccess: (res) => {
      toast.success(
        isPl
          ? `Wznowiono wysyłkę - wysłano ${res.sent}, błędy: ${res.failed}`
          : `Send resumed - sent ${res.sent}, failed: ${res.failed}`,
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
          name: isPl ? "Nowa kampania" : "New campaign",
          subject_pl: "",
          subject_en: "",
          html_pl: "",
          html_en: "",
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
          <h2 className="text-xl font-semibold">
            {isPl ? "Kampanie newsletterowe" : "Newsletter campaigns"}
          </h2>
          <p className="text-sm text-muted-foreground">
            {isPl
              ? "Twórz i wysyłaj mailingi do wybranych segmentów subskrybentów."
              : "Compose and send mailings to selected subscriber segments."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => processDueMut.mutate()}
            disabled={processDueMut.isPending}
          >
            <Clock className={`w-4 h-4 mr-2 ${processDueMut.isPending ? "animate-pulse" : ""}`} />
            {isPl ? "Wyślij zaległe" : "Process due"}
          </Button>
          <Button onClick={() => createMut.mutate()} disabled={createMut.isPending}>
            <Plus className="w-4 h-4 mr-2" />
            {isPl ? "Nowa kampania" : "New campaign"}
          </Button>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{isPl ? "Nazwa" : "Name"}</TableHead>
              <TableHead>{isPl ? "Status" : "Status"}</TableHead>
              <TableHead>{isPl ? "Zaplanowana na" : "Scheduled for"}</TableHead>
              <TableHead className="text-right">{isPl ? "Odbiorcy" : "Recipients"}</TableHead>
              <TableHead className="text-right">{isPl ? "Wysłano" : "Sent"}</TableHead>
              <TableHead>{isPl ? "Utworzono" : "Created"}</TableHead>
              <TableHead className="w-16" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                  {isPl ? "Wczytywanie…" : "Loading…"}
                </TableCell>
              </TableRow>
            ) : campaigns.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                  {isPl ? "Brak kampanii." : "No campaigns yet."}
                </TableCell>
              </TableRow>
            ) : (
              campaigns.map((c) => {
                const meta = STATUS_META[c.status];
                const Icon = meta.icon;
                const canDelete = c.status !== "sending" && c.status !== "sent";
                const stuck = isStuckSending(c);
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
                          {isPl ? meta.labelPl : meta.labelEn}
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
                            {isPl ? "Zablokowana? Odzyskaj" : "Stuck? Recover"}
                          </Button>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {c.scheduled_at
                        ? new Date(c.scheduled_at).toLocaleString(isPl ? "pl-PL" : "en-US")
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
                      {new Date(c.created_at).toLocaleString(isPl ? "pl-PL" : "en-US")}
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
                                {isPl ? "Usunąć kampanię?" : "Delete campaign?"}
                              </AlertDialogTitle>
                              <AlertDialogDescription>
                                {isPl
                                  ? `„${c.name}" zostanie trwale usunięta.`
                                  : `"${c.name}" will be permanently deleted.`}
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>{isPl ? "Anuluj" : "Cancel"}</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => removeMut.mutate(c.id)}
                                className="bg-red-600 hover:bg-red-700"
                              >
                                {isPl ? "Usuń" : "Delete"}
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
    </div>
  );
}
