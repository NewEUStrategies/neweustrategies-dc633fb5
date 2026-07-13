// /admin/community/qa — moderacja sesji Q&A i pytań.
// - Lista sesji ze statusem → workflow (draft → scheduled → open → answering → closed)
// - Drill do pytań w sesji: approve/reject/answer
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { pl as plLocale, enUS } from "date-fns/locale";
import { HelpCircle, Check, X, Play, Pause, Archive, MessageSquare, Save } from "lucide-react";
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
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus } from "lucide-react";
import {
  createQaSession,
  fetchQaQuestions,
  fetchQaSessions,
  moderateQaQuestion,
  updateQaSession,
  type QaQuestionRow,
  type QaQuestionStatus,
  type QaSessionRow,
  type QaSessionStatus,
} from "@/lib/admin/community";

export const Route = createFileRoute("/admin/community/qa")({
  head: () => ({ meta: [{ title: "Q&A · Community · Admin" }] }),
  component: AdminCommunityQa,
});

const SESSION_TONE: Record<QaSessionStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  scheduled: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  open: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  answering: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  closed: "bg-destructive/10 text-destructive",
};

const QUESTION_TONE: Record<QaQuestionStatus, string> = {
  pending: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  approved: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  rejected: "bg-destructive/15 text-destructive",
  answered: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
};

function AdminCommunityQa() {
  const { i18n } = useTranslation();
  const isPl = (i18n.language ?? "pl").startsWith("pl");
  const locale = isPl ? plLocale : enUS;
  const qc = useQueryClient();
  const [sessionStatus, setSessionStatus] = useState<QaSessionStatus | "all">("all");
  const [selected, setSelected] = useState<QaSessionRow | null>(null);

  const sessionsQ = useQuery({
    queryKey: ["admin-qa-sessions", sessionStatus],
    queryFn: () => fetchQaSessions(sessionStatus),
    staleTime: 15_000,
  });

  const sessionStatusM = useMutation({
    mutationFn: ({ id, status }: { id: string; status: QaSessionStatus }) =>
      updateQaSession(id, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-qa-sessions"] });
      qc.invalidateQueries({ queryKey: ["admin-community-stats"] });
      toast.success(isPl ? "Zaktualizowano" : "Updated");
    },
    onError: () => toast.error(isPl ? "Błąd" : "Failed"),
  });

  const rows = sessionsQ.data ?? [];

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center gap-3 justify-between">
        <div>
          <h2 className="text-xl font-semibold">{isPl ? "Sesje Q&A" : "Q&A sessions"}</h2>
          <p className="text-sm text-muted-foreground">
            {isPl
              ? "Sesje pytań i odpowiedzi. Kliknij, aby moderować pytania."
              : "Q&A sessions. Click one to moderate its questions."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={sessionStatus}
            onValueChange={(v) => setSessionStatus(v as QaSessionStatus | "all")}
          >
            <SelectTrigger className="w-[200px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{isPl ? "Wszystkie" : "All"}</SelectItem>
              <SelectItem value="draft">{isPl ? "Robocze" : "Draft"}</SelectItem>
              <SelectItem value="scheduled">{isPl ? "Zaplanowane" : "Scheduled"}</SelectItem>
              <SelectItem value="open">{isPl ? "Otwarte" : "Open"}</SelectItem>
              <SelectItem value="answering">{isPl ? "Odpowiadanie" : "Answering"}</SelectItem>
              <SelectItem value="closed">{isPl ? "Zamknięte" : "Closed"}</SelectItem>
            </SelectContent>
          </Select>
          <CreateQaSessionButton
            isPl={isPl}
            onCreated={() => qc.invalidateQueries({ queryKey: ["admin-qa-sessions"] })}
          />
        </div>
      </header>

      <Card>
        <CardContent className="p-0">
          {sessionsQ.isLoading ? (
            <div className="p-6 text-sm text-muted-foreground">
              {isPl ? "Ładowanie…" : "Loading…"}
            </div>
          ) : rows.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground text-center">
              {isPl ? "Brak sesji." : "No sessions."}
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {rows.map((s) => (
                <li key={s.id} className="p-3 hover:bg-muted/40 flex items-start gap-3">
                  <button
                    type="button"
                    onClick={() => setSelected(s)}
                    className="flex-1 text-left space-y-1"
                  >
                    <div className="flex items-center gap-2 text-sm">
                      <HelpCircle className="w-3.5 h-3.5 text-muted-foreground" />
                      <span className="font-medium truncate">{isPl ? s.title_pl : s.title_en}</span>
                      <Badge className={SESSION_TONE[s.status as QaSessionStatus]}>
                        {s.status}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      /{s.slug} ·{" "}
                      {formatDistanceToNow(new Date(s.created_at), { addSuffix: true, locale })}
                    </div>
                  </button>
                  <div className="flex items-center gap-1">
                    {s.status === "draft" && (
                      <Button
                        variant="ghost"
                        size="icon"
                        title={isPl ? "Zaplanuj" : "Schedule"}
                        onClick={() => sessionStatusM.mutate({ id: s.id, status: "scheduled" })}
                      >
                        <Play className="w-4 h-4" />
                      </Button>
                    )}
                    {(s.status === "draft" || s.status === "scheduled") && (
                      <Button
                        variant="ghost"
                        size="icon"
                        title={isPl ? "Otwórz" : "Open"}
                        onClick={() => sessionStatusM.mutate({ id: s.id, status: "open" })}
                      >
                        <Check className="w-4 h-4 text-emerald-600" />
                      </Button>
                    )}
                    {s.status === "open" && (
                      <Button
                        variant="ghost"
                        size="icon"
                        title={isPl ? "Zacznij odpowiadać" : "Start answering"}
                        onClick={() => sessionStatusM.mutate({ id: s.id, status: "answering" })}
                      >
                        <MessageSquare className="w-4 h-4 text-amber-600" />
                      </Button>
                    )}
                    {s.status !== "closed" && (
                      <Button
                        variant="ghost"
                        size="icon"
                        title={isPl ? "Zamknij" : "Close"}
                        onClick={() => sessionStatusM.mutate({ id: s.id, status: "closed" })}
                      >
                        <Archive className="w-4 h-4" />
                      </Button>
                    )}
                    {s.status === "closed" && (
                      <Button
                        variant="ghost"
                        size="icon"
                        title={isPl ? "Wznów jako draft" : "Reopen as draft"}
                        onClick={() => sessionStatusM.mutate({ id: s.id, status: "draft" })}
                      >
                        <Pause className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {selected && (
        <QuestionsDialog isPl={isPl} session={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}

function QuestionsDialog({
  isPl,
  session,
  onClose,
}: {
  isPl: boolean;
  session: QaSessionRow;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<QaQuestionStatus | "all">("all");

  const questionsQ = useQuery({
    queryKey: ["admin-qa-questions", session.id, statusFilter],
    queryFn: () => fetchQaQuestions({ sessionId: session.id, status: statusFilter }),
    staleTime: 5_000,
  });

  const moderateM = useMutation({
    mutationFn: ({
      id,
      status,
      answer,
    }: {
      id: string;
      status: QaQuestionStatus;
      answer?: string;
    }) => moderateQaQuestion(id, status, answer),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-qa-questions"] });
      qc.invalidateQueries({ queryKey: ["admin-community-stats"] });
      toast.success(isPl ? "Zapisano" : "Saved");
    },
    onError: () => toast.error(isPl ? "Błąd" : "Failed"),
  });

  const rows = questionsQ.data ?? [];

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isPl ? session.title_pl : session.title_en}{" "}
            <Badge variant="outline">{session.status}</Badge>
          </DialogTitle>
        </DialogHeader>
        <div className="flex items-center gap-2 pb-3 border-b border-border">
          <Select
            value={statusFilter}
            onValueChange={(v) => setStatusFilter(v as QaQuestionStatus | "all")}
          >
            <SelectTrigger className="w-[200px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{isPl ? "Wszystkie" : "All"}</SelectItem>
              <SelectItem value="pending">{isPl ? "Oczekujące" : "Pending"}</SelectItem>
              <SelectItem value="approved">{isPl ? "Zatwierdzone" : "Approved"}</SelectItem>
              <SelectItem value="rejected">{isPl ? "Odrzucone" : "Rejected"}</SelectItem>
              <SelectItem value="answered">{isPl ? "Odpowiedziane" : "Answered"}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          {questionsQ.isLoading ? (
            <div className="text-sm text-muted-foreground">{isPl ? "Ładowanie…" : "Loading…"}</div>
          ) : rows.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-4">
              {isPl ? "Brak pytań." : "No questions."}
            </div>
          ) : (
            rows.map((q) => (
              <QuestionCard
                key={q.id}
                q={q}
                isPl={isPl}
                onModerate={(status, answer) => moderateM.mutate({ id: q.id, status, answer })}
                pending={moderateM.isPending}
              />
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function QuestionCard({
  q,
  isPl,
  onModerate,
  pending,
}: {
  q: QaQuestionRow;
  isPl: boolean;
  onModerate: (status: QaQuestionStatus, answer?: string) => void;
  pending: boolean;
}) {
  const [answer, setAnswer] = useState(q.answer_body ?? "");
  const [showAnswer, setShowAnswer] = useState(false);

  return (
    <div className="rounded-lg border border-border p-3 space-y-2 bg-background">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 space-y-1">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Badge className={QUESTION_TONE[q.status as QaQuestionStatus]}>{q.status}</Badge>
            <span>
              {q.is_anonymous
                ? isPl
                  ? "anonimowo"
                  : "anonymous"
                : (q.author_display ?? q.user_id.slice(0, 8))}
            </span>
          </div>
          <p className="text-sm whitespace-pre-wrap">{q.body}</p>
          {q.answer_body && (
            <div className="mt-2 p-2 rounded-md bg-muted/40 text-xs">
              <div className="font-medium mb-1">{isPl ? "Odpowiedź" : "Answer"}</div>
              <div className="whitespace-pre-wrap">{q.answer_body}</div>
            </div>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {q.status !== "approved" && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onModerate("approved")}
            disabled={pending}
          >
            <Check className="w-3.5 h-3.5 mr-1" />
            {isPl ? "Zatwierdź" : "Approve"}
          </Button>
        )}
        {q.status !== "rejected" && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onModerate("rejected")}
            disabled={pending}
          >
            <X className="w-3.5 h-3.5 mr-1" />
            {isPl ? "Odrzuć" : "Reject"}
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowAnswer((v) => !v)}
          disabled={pending}
        >
          <MessageSquare className="w-3.5 h-3.5 mr-1" />
          {isPl ? "Odpowiedz" : "Answer"}
        </Button>
      </div>
      {showAnswer && (
        <div className="space-y-2 pt-2 border-t border-border/60">
          <Textarea
            rows={3}
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder={isPl ? "Treść odpowiedzi…" : "Answer body…"}
          />
          <Button
            size="sm"
            onClick={() => onModerate("answered", answer)}
            disabled={pending || answer.trim().length === 0}
          >
            <Save className="w-3.5 h-3.5 mr-1" />
            {isPl ? "Zapisz odpowiedź" : "Save answer"}
          </Button>
        </div>
      )}
    </div>
  );
}

function CreateQaSessionButton({ isPl, onCreated }: { isPl: boolean; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [slug, setSlug] = useState("");
  const [titlePl, setTitlePl] = useState("");
  const [titleEn, setTitleEn] = useState("");
  const [introPl, setIntroPl] = useState("");
  const [introEn, setIntroEn] = useState("");
  const [opensAt, setOpensAt] = useState("");
  const [closesAt, setClosesAt] = useState("");
  const [status, setStatus] = useState<QaSessionStatus>("draft");

  const reset = () => {
    setSlug("");
    setTitlePl("");
    setTitleEn("");
    setIntroPl("");
    setIntroEn("");
    setOpensAt("");
    setClosesAt("");
    setStatus("draft");
  };

  const m = useMutation({
    mutationFn: () =>
      createQaSession({
        slug: slug.trim(),
        title_pl: titlePl.trim(),
        title_en: titleEn.trim(),
        intro_pl: introPl.trim() || undefined,
        intro_en: introEn.trim() || undefined,
        opens_at: opensAt ? new Date(opensAt).toISOString() : null,
        closes_at: closesAt ? new Date(closesAt).toISOString() : null,
        status,
      }),
    onSuccess: () => {
      toast.success(isPl ? "Utworzono" : "Created");
      onCreated();
      setOpen(false);
      reset();
    },
    onError: (e: Error) => toast.error(e.message || (isPl ? "Błąd" : "Failed")),
  });

  const canSubmit =
    slug.trim().length >= 2 && titlePl.trim().length > 0 && titleEn.trim().length > 0;

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="w-4 h-4 mr-1" />
        {isPl ? "Nowa sesja" : "New session"}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{isPl ? "Nowa sesja Q&A" : "New Q&A session"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Slug</Label>
              <Input
                value={slug}
                onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))}
                placeholder="np-ai-act-2026"
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>{isPl ? "Tytuł (PL)" : "Title (PL)"}</Label>
                <Input value={titlePl} onChange={(e) => setTitlePl(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>{isPl ? "Tytuł (EN)" : "Title (EN)"}</Label>
                <Input value={titleEn} onChange={(e) => setTitleEn(e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>{isPl ? "Wstęp (PL)" : "Intro (PL)"}</Label>
                <Textarea
                  value={introPl}
                  onChange={(e) => setIntroPl(e.target.value)}
                  className="min-h-[80px]"
                />
              </div>
              <div className="space-y-1">
                <Label>{isPl ? "Wstęp (EN)" : "Intro (EN)"}</Label>
                <Textarea
                  value={introEn}
                  onChange={(e) => setIntroEn(e.target.value)}
                  className="min-h-[80px]"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label>{isPl ? "Otwiera się" : "Opens at"}</Label>
                <Input
                  type="datetime-local"
                  value={opensAt}
                  onChange={(e) => setOpensAt(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label>{isPl ? "Zamyka się" : "Closes at"}</Label>
                <Input
                  type="datetime-local"
                  value={closesAt}
                  onChange={(e) => setClosesAt(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label>Status</Label>
                <Select value={status} onValueChange={(v) => setStatus(v as QaSessionStatus)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">{isPl ? "Roboczy" : "Draft"}</SelectItem>
                    <SelectItem value="scheduled">{isPl ? "Zaplanowany" : "Scheduled"}</SelectItem>
                    <SelectItem value="open">{isPl ? "Otwarty" : "Open"}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {isPl ? "Anuluj" : "Cancel"}
            </Button>
            <Button onClick={() => m.mutate()} disabled={!canSubmit || m.isPending}>
              {isPl ? "Utwórz" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
