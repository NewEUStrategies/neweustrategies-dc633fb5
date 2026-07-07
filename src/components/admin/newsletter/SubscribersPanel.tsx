// /admin/newsletter/subscribers - tabela + filtry + eksport CSV.
// Wyodrebnione z bylego admin.newsletter.tsx (Tura 1).
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Download, Search, Trash2, Upload } from "lucide-react";
import { ImportCsvDialog } from "./subscribers/ImportCsvDialog";
import { SubscriberDetailDialog } from "./subscribers/SubscriberDetailDialog";

interface SubRow {
  id: string;
  email: string;
  display_name: string | null;
  language: string;
  status: string;
  source: string | null;
  created_at: string;
  confirmed_at: string | null;
}

type StatusFilter = "all" | "subscribed" | "pending" | "unsubscribed";

export function SubscribersPanel() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [lang, setLang] = useState<"all" | "pl" | "en">("all");
  const [importOpen, setImportOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const { data: subs, isLoading } = useQuery({
    queryKey: ["newsletter-subscribers"],
    queryFn: async (): Promise<SubRow[]> => {
      const { data, error } = await supabase
        .from("newsletter_subscribers")
        .select("id, email, display_name, language, status, source, created_at, confirmed_at")
        .order("created_at", { ascending: false })
        .limit(2000);
      if (error) throw error;
      return (data ?? []) as SubRow[];
    },
  });

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (subs ?? []).filter((s) => {
      if (status !== "all" && s.status !== status) return false;
      if (lang !== "all" && s.language !== lang) return false;
      if (term && !s.email.toLowerCase().includes(term) && !(s.display_name ?? "").toLowerCase().includes(term)) {
        return false;
      }
      return true;
    });
  }, [subs, q, status, lang]);

  const exportCsv = () => {
    const head = ["email", "display_name", "language", "status", "source", "created_at", "confirmed_at"] as const;
    const csv = [head.join(",")]
      .concat(
        filtered.map((r) =>
          head
            .map((k) => {
              const v = String((r as unknown as Record<string, string | null>)[k] ?? "");
              return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
            })
            .join(","),
        ),
      )
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `newsletter-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const remove = async (id: string) => {
    if (!confirm("Usunac subskrybenta?")) return;
    const { error } = await supabase.from("newsletter_subscribers").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Usunieto");
    qc.invalidateQueries({ queryKey: ["newsletter-subscribers"] });
    qc.invalidateQueries({ queryKey: ["newsletter-kpis"] });
  };

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-display text-xl">Subskrybenci ({filtered.length})</h2>
          <p className="text-sm text-muted-foreground">
            Zarzadzaj lista mailingowa - filtruj, eksportuj, usuwaj.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            <Upload className="w-4 h-4 mr-2" />
            Import CSV
          </Button>
          <Button variant="outline" onClick={exportCsv} disabled={!filtered.length}>
            <Download className="w-4 h-4 mr-2" />
            Eksportuj CSV
          </Button>
        </div>
      </header>
      <ImportCsvDialog open={importOpen} onOpenChange={setImportOpen} />


      <div className="grid grid-cols-1 md:grid-cols-[1fr_180px_180px] gap-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Szukaj po e-mailu lub imieniu"
            className="pl-9"
          />
        </div>
        <Select value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
          <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Wszystkie statusy</SelectItem>
            <SelectItem value="subscribed">Aktywni</SelectItem>
            <SelectItem value="pending">Oczekujacy</SelectItem>
            <SelectItem value="unsubscribed">Wypisani</SelectItem>
          </SelectContent>
        </Select>
        <Select value={lang} onValueChange={(v) => setLang(v as typeof lang)}>
          <SelectTrigger><SelectValue placeholder="Jezyk" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Wszystkie jezyki</SelectItem>
            <SelectItem value="pl">PL</SelectItem>
            <SelectItem value="en">EN</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-b border-border bg-muted/40">
              <tr>
                <th className="text-left p-3">E-mail</th>
                <th className="text-left p-3">Imie</th>
                <th className="text-left p-3">Jezyk</th>
                <th className="text-left p-3">Status</th>
                <th className="text-left p-3">Zrodlo</th>
                <th className="text-left p-3">Data</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-muted-foreground">
                    Ladowanie...
                  </td>
                </tr>
              )}
              {!isLoading && !filtered.length && (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-muted-foreground">
                    Brak subskrybentow spelniajacych kryteria.
                  </td>
                </tr>
              )}
              {filtered.map((s) => (
                <tr
                  key={s.id}
                  className="border-b border-border/60 hover:bg-muted/30 cursor-pointer"
                  onClick={() => setDetailId(s.id)}
                >
                  <td className="p-3 font-mono text-xs">{s.email}</td>
                  <td className="p-3">{s.display_name ?? "-"}</td>
                  <td className="p-3 uppercase text-xs">{s.language}</td>
                  <td className="p-3">
                    <StatusBadge status={s.status} />
                  </td>
                  <td className="p-3 text-muted-foreground text-xs">{s.source ?? "-"}</td>
                  <td className="p-3 text-muted-foreground text-xs whitespace-nowrap">
                    {new Date(s.created_at).toLocaleDateString()}
                  </td>
                  <td className="p-3 text-right">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        remove(s.id);
                      }}
                      className="text-destructive hover:bg-destructive/10 p-1.5 rounded"
                      aria-label="Usun"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <SubscriberDetailDialog
        subscriberId={detailId}
        onOpenChange={(o) => !o && setDetailId(null)}
      />
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const style =
    status === "subscribed"
      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
      : status === "pending"
        ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
        : "bg-muted text-muted-foreground";
  return <span className={`text-[11px] px-2 py-0.5 rounded font-medium ${style}`}>{status}</span>;
}
