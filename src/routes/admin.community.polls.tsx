// /admin/community/polls — moderacja ankiet.
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { pickLocalized, pickPair, type LocaleCode } from "@/lib/i18n/pickLocalized";
import { ensureI18n as ensureAdminCommunityI18n } from "@/lib/i18n-admin-community";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Vote, Trash2, Play, Pause, BarChart2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  fetchAdminPolls,
  fetchPollResults,
  createPoll,
  deletePoll,
  updatePollStatus,
  type PollStatus,
} from "@/lib/admin/community";

export const Route = createFileRoute("/admin/community/polls")({
  head: () => ({ meta: [{ title: "Polls · Community · Admin" }] }),
  component: PollsAdmin,
});

function PollsAdmin() {
  ensureAdminCommunityI18n();
  const { t, i18n } = useTranslation();
  const lang: LocaleCode = (i18n.language ?? "pl").startsWith("en") ? "en" : "pl";
  const qc = useQueryClient();
  const [status, setStatus] = useState<PollStatus | "all">("all");
  const [openResultsFor, setOpenResultsFor] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["admin-polls", status],
    queryFn: () => fetchAdminPolls(status),
    staleTime: 15_000,
  });

  const resultsQ = useQuery({
    queryKey: ["admin-poll-results", openResultsFor],
    queryFn: () => (openResultsFor ? fetchPollResults(openResultsFor) : Promise.resolve({})),
    enabled: !!openResultsFor,
  });

  const setStatusM = useMutation({
    mutationFn: ({ id, s }: { id: string; s: PollStatus }) => updatePollStatus(id, s),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-polls"] });
      toast.success(t("adminCommunity.polls.saved"));
    },
    onError: () => toast.error(t("adminCommunity.polls.failed")),
  });

  const deleteM = useMutation({
    mutationFn: deletePoll,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-polls"] });
      toast.success(t("adminCommunity.polls.deleted"));
    },
    onError: () => toast.error(t("adminCommunity.polls.failed")),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Vote className="w-4 h-4" />
          <h2 className="text-lg font-semibold">{t("adminCommunity.polls.polls")}</h2>
        </div>
        <div className="flex items-center gap-2">
          <Select value={status} onValueChange={(v) => setStatus(v as PollStatus | "all")}>
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("adminCommunity.polls.all")}</SelectItem>
              <SelectItem value="draft">{t("adminCommunity.polls.draft")}</SelectItem>
              <SelectItem value="open">{t("adminCommunity.polls.open")}</SelectItem>
              <SelectItem value="closed">{t("adminCommunity.polls.closed")}</SelectItem>
            </SelectContent>
          </Select>
          <CreatePollButton onCreated={() => qc.invalidateQueries({ queryKey: ["admin-polls"] })} />
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {q.isLoading ? (
            <div className="p-4 text-sm text-muted-foreground">
              {t("adminCommunity.polls.loading")}
            </div>
          ) : (q.data ?? []).length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground text-center">
              {t("adminCommunity.polls.noPolls")}
            </div>
          ) : (
            <ul className="divide-y divide-border/60">
              {(q.data ?? []).map((p) => (
                <li key={p.id} className="p-3 flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">
                      {pickLocalized(p, "question", lang)}
                    </div>
                    <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                      <Badge variant="outline">{p.status}</Badge>
                      {p.ends_at && (
                        <span>
                          {t("adminCommunity.polls.ends")}
                          {new Date(p.ends_at).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                    {openResultsFor === p.id && (
                      <PollResults data={resultsQ.data ?? {}} options={p.options} lang={lang} />
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setOpenResultsFor(openResultsFor === p.id ? null : p.id)}
                    >
                      <BarChart2 className="w-4 h-4" />
                    </Button>
                    {p.status !== "open" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setStatusM.mutate({ id: p.id, s: "open" })}
                      >
                        <Play className="w-4 h-4" />
                      </Button>
                    )}
                    {p.status === "open" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setStatusM.mutate({ id: p.id, s: "closed" })}
                      >
                        <Pause className="w-4 h-4" />
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        if (confirm(t("adminCommunity.polls.delete"))) deleteM.mutate(p.id);
                      }}
                    >
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function PollResults({
  data,
  options,
  lang,
}: {
  data: Record<string, number>;
  options: unknown;
  // Tu `lang` NIE jest etykieta interfejsu - wybiera JEZYK TRESCI z blizniaczych
  // pol opcji ankiety (`label_pl`/`label_en`), wiec zostaje jawnym parametrem.
  lang: LocaleCode;
}) {
  const { t } = useTranslation();
  const optArr = Array.isArray(options) ? (options as Array<Record<string, unknown>>) : [];
  const total = Object.values(data).reduce((a, b) => a + b, 0);
  return (
    <div className="mt-3 space-y-1">
      {optArr.map((opt, idx) => {
        const count = data[String(idx)] ?? 0;
        const pct = total > 0 ? Math.round((count / total) * 100) : 0;
        const label = pickPair(pickLocalized(opt, "label", lang), opt.label, `#${idx + 1}`);
        return (
          <div key={idx} className="text-xs">
            <div className="flex justify-between">
              <span className="truncate">{String(label)}</span>
              <span className="tabular-nums">
                {count} · {pct}%
              </span>
            </div>
            <div className="h-1.5 bg-muted rounded overflow-hidden">
              <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
      {total === 0 && (
        <div className="text-xs text-muted-foreground">{t("adminCommunity.polls.noVotes")}</div>
      )}
    </div>
  );
}

function CreatePollButton({ onCreated }: { onCreated: () => void }) {
  ensureAdminCommunityI18n();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [qPl, setQPl] = useState("");
  const [qEn, setQEn] = useState("");
  const [opts, setOpts] = useState<Array<{ label_pl: string; label_en: string }>>([
    { label_pl: "", label_en: "" },
    { label_pl: "", label_en: "" },
  ]);
  const [endsAt, setEndsAt] = useState("");
  const [status, setStatus] = useState<PollStatus>("draft");

  const reset = () => {
    setQPl("");
    setQEn("");
    setOpts([
      { label_pl: "", label_en: "" },
      { label_pl: "", label_en: "" },
    ]);
    setEndsAt("");
    setStatus("draft");
  };

  const m = useMutation({
    mutationFn: () =>
      createPoll({
        question_pl: qPl.trim(),
        question_en: qEn.trim(),
        options: opts.filter((o) => o.label_pl.trim() && o.label_en.trim()),
        ends_at: endsAt ? new Date(endsAt).toISOString() : null,
        status,
      }),
    onSuccess: () => {
      toast.success(t("adminCommunity.polls.created"));
      onCreated();
      setOpen(false);
      reset();
    },
    onError: (e: Error) => toast.error(e.message || t("adminCommunity.polls.failed")),
  });

  const validOptCount = opts.filter((o) => o.label_pl.trim() && o.label_en.trim()).length;
  const canSubmit = qPl.trim().length > 0 && qEn.trim().length > 0 && validOptCount >= 2;

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="w-4 h-4 mr-1" />
        {t("adminCommunity.polls.newPoll")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("adminCommunity.polls.newPoll")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>{t("adminCommunity.polls.questionPl")}</Label>
                <Input value={qPl} onChange={(e) => setQPl(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>{t("adminCommunity.polls.questionEn")}</Label>
                <Input value={qEn} onChange={(e) => setQEn(e.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>{t("adminCommunity.polls.options")}</Label>
              {opts.map((o, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    placeholder={`PL #${i + 1}`}
                    value={o.label_pl}
                    onChange={(e) => {
                      const next = [...opts];
                      next[i] = { ...next[i], label_pl: e.target.value };
                      setOpts(next);
                    }}
                  />
                  <Input
                    placeholder={`EN #${i + 1}`}
                    value={o.label_en}
                    onChange={(e) => {
                      const next = [...opts];
                      next[i] = { ...next[i], label_en: e.target.value };
                      setOpts(next);
                    }}
                  />
                  {opts.length > 2 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setOpts(opts.filter((_, j) => j !== i))}
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              ))}
              <Button
                size="sm"
                variant="outline"
                onClick={() => setOpts([...opts, { label_pl: "", label_en: "" }])}
                disabled={opts.length >= 8}
              >
                <Plus className="w-4 h-4 mr-1" />
                {t("adminCommunity.polls.addOption")}
              </Button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>{t("adminCommunity.polls.endsAtOptional")}</Label>
                <Input
                  type="datetime-local"
                  value={endsAt}
                  onChange={(e) => setEndsAt(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label>{t("adminCommunity.polls.status")}</Label>
                <Select value={status} onValueChange={(v) => setStatus(v as PollStatus)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">{t("adminCommunity.polls.draft")}</SelectItem>
                    <SelectItem value="open">{t("adminCommunity.polls.statusOpen")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t("adminCommunity.polls.cancel")}
            </Button>
            <Button onClick={() => m.mutate()} disabled={!canSubmit || m.isPending}>
              {t("adminCommunity.polls.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
