// /admin/community/polls — moderacja ankiet.
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Vote, Trash2, Play, Pause, BarChart2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  deletePoll,
  updatePollStatus,
  type PollStatus,
} from "@/lib/admin/community";

export const Route = createFileRoute("/admin/community/polls")({
  head: () => ({ meta: [{ title: "Polls · Community · Admin" }] }),
  component: PollsAdmin,
});

function PollsAdmin() {
  const { i18n } = useTranslation();
  const isPl = (i18n.language ?? "pl").startsWith("pl");
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
      toast.success(isPl ? "Zapisano" : "Saved");
    },
    onError: () => toast.error(isPl ? "Błąd" : "Failed"),
  });

  const deleteM = useMutation({
    mutationFn: deletePoll,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-polls"] });
      toast.success(isPl ? "Usunięto" : "Deleted");
    },
    onError: () => toast.error(isPl ? "Błąd" : "Failed"),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Vote className="w-4 h-4" />
          <h2 className="text-lg font-semibold">{isPl ? "Ankiety" : "Polls"}</h2>
        </div>
        <Select value={status} onValueChange={(v) => setStatus(v as PollStatus | "all")}>
          <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{isPl ? "Wszystkie" : "All"}</SelectItem>
            <SelectItem value="draft">{isPl ? "Szkic" : "Draft"}</SelectItem>
            <SelectItem value="open">{isPl ? "Otwarte" : "Open"}</SelectItem>
            <SelectItem value="closed">{isPl ? "Zamknięte" : "Closed"}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          {q.isLoading ? (
            <div className="p-4 text-sm text-muted-foreground">{isPl ? "Ładowanie..." : "Loading..."}</div>
          ) : (q.data ?? []).length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground text-center">
              {isPl ? "Brak ankiet" : "No polls"}
            </div>
          ) : (
            <ul className="divide-y divide-border/60">
              {(q.data ?? []).map((p) => (
                <li key={p.id} className="p-3 flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">
                      {isPl ? p.question_pl : p.question_en}
                    </div>
                    <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                      <Badge variant="outline">{p.status}</Badge>
                      {p.ends_at && (
                        <span>{isPl ? "koniec: " : "ends: "}{new Date(p.ends_at).toLocaleDateString()}</span>
                      )}
                    </div>
                    {openResultsFor === p.id && (
                      <PollResults data={resultsQ.data ?? {}} options={p.options} isPl={isPl} />
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setOpenResultsFor(openResultsFor === p.id ? null : p.id)}>
                      <BarChart2 className="w-4 h-4" />
                    </Button>
                    {p.status !== "open" && (
                      <Button size="sm" variant="ghost" onClick={() => setStatusM.mutate({ id: p.id, s: "open" })}>
                        <Play className="w-4 h-4" />
                      </Button>
                    )}
                    {p.status === "open" && (
                      <Button size="sm" variant="ghost" onClick={() => setStatusM.mutate({ id: p.id, s: "closed" })}>
                        <Pause className="w-4 h-4" />
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        if (confirm(isPl ? "Usunąć?" : "Delete?")) deleteM.mutate(p.id);
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
  isPl,
}: {
  data: Record<string, number>;
  options: unknown;
  isPl: boolean;
}) {
  const optArr = Array.isArray(options) ? (options as Array<Record<string, unknown>>) : [];
  const total = Object.values(data).reduce((a, b) => a + b, 0);
  return (
    <div className="mt-3 space-y-1">
      {optArr.map((opt, idx) => {
        const count = data[String(idx)] ?? 0;
        const pct = total > 0 ? Math.round((count / total) * 100) : 0;
        const label = (isPl ? opt.label_pl : opt.label_en) ?? opt.label ?? `#${idx + 1}`;
        return (
          <div key={idx} className="text-xs">
            <div className="flex justify-between">
              <span className="truncate">{String(label)}</span>
              <span className="tabular-nums">{count} · {pct}%</span>
            </div>
            <div className="h-1.5 bg-muted rounded overflow-hidden">
              <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
      {total === 0 && <div className="text-xs text-muted-foreground">{isPl ? "Brak głosów" : "No votes"}</div>}
    </div>
  );
}
