// Dialog ustawień strony eksperta: przypisywanie zapisanych szablonów builder
// (scope='expert_profile') per-ekspert oraz reset do globalnego domyślnego.
// Otwierany z /admin/appearance/expert-layout obok globalnego edytora.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Settings2, RotateCcw, Users, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Lang = "pl" | "en";

interface TemplateRow {
  id: string;
  name: string;
}

interface ExpertRow {
  user_id: string;
  display_name: string | null;
  layout_template_id: string | null;
  email: string | null;
}

const TEMPLATES_KEY = ["admin", "expert-layout-templates"] as const;
const EXPERTS_KEY = ["admin", "expert-layout-experts"] as const;

async function fetchExpertTemplates(): Promise<TemplateRow[]> {
  const { data, error } = await supabase
    .from("builder_templates")
    .select("id, name")
    .eq("scope", "expert_profile")
    .order("name", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => ({ id: r.id, name: r.name }));
}

async function fetchExperts(): Promise<ExpertRow[]> {
  const { data, error } = await supabase
    .from("author_profiles")
    .select("user_id, display_name, layout_template_id, profiles(email)")
    .order("display_name", { ascending: true })
    .limit(500);
  if (error) throw error;
  type Raw = {
    user_id: string;
    display_name: string | null;
    layout_template_id: string | null;
    profiles: { email: string | null } | { email: string | null }[] | null;
  };
  return (data as unknown as Raw[]).map((r) => {
    const p = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles;
    return {
      user_id: r.user_id,
      display_name: r.display_name,
      layout_template_id: r.layout_template_id,
      email: p?.email ?? null,
    };
  });
}

async function updateExpertTemplate(userId: string, templateId: string | null): Promise<void> {
  const { error } = await supabase
    .from("author_profiles")
    .update({ layout_template_id: templateId })
    .eq("user_id", userId);
  if (error) throw error;
}

async function resetAllExperts(): Promise<void> {
  const { error } = await supabase
    .from("author_profiles")
    .update({ layout_template_id: null, layout_overrides: null })
    .not("user_id", "is", null);
  if (error) throw error;
}

export function ExpertLayoutSettingsDialog() {
  const { i18n } = useTranslation();
  const lang: Lang = i18n.language === "en" ? "en" : "pl";
  const L = (pl: string, en: string) => (lang === "pl" ? pl : en);
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");

  const tplQ = useQuery({ queryKey: TEMPLATES_KEY, queryFn: fetchExpertTemplates, enabled: open });
  const expQ = useQuery({ queryKey: EXPERTS_KEY, queryFn: fetchExperts, enabled: open });

  const templates = tplQ.data ?? [];
  const experts = expQ.data ?? [];

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return experts;
    return experts.filter((e) => {
      const name = (e.display_name ?? "").toLowerCase();
      const email = (e.email ?? "").toLowerCase();
      return name.includes(s) || email.includes(s);
    });
  }, [experts, q]);

  const setTpl = useMutation({
    mutationFn: (v: { userId: string; templateId: string | null }) =>
      updateExpertTemplate(v.userId, v.templateId),
    onSuccess: () => {
      toast.success(L("Zapisano", "Saved"));
      void qc.invalidateQueries({ queryKey: EXPERTS_KEY });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const resetAll = useMutation({
    mutationFn: () => resetAllExperts(),
    onSuccess: () => {
      toast.success(L("Zresetowano wszystkich", "All reset"));
      void qc.invalidateQueries({ queryKey: EXPERTS_KEY });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const usingDefault = experts.filter((e) => !e.layout_template_id).length;
  const usingCustom = experts.length - usingDefault;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Settings2 className="mr-1.5 h-3.5 w-3.5" />
          {L("Ustawienia dla ekspertów", "Per-expert settings")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Users className="h-4 w-4" />
            {L("Layout strony eksperta - per ekspert", "Expert page layout - per expert")}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {L(
              "Wybierz zapisany szablon dla konkretnego eksperta. „Domyślny" = globalny layout z tej sekcji.",
              "Assign a saved template per expert. \"Default\" uses the global layout from this section.",
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-2">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge variant="secondary">
              {L("Domyślny", "Default")}: {usingDefault}
            </Badge>
            <Badge variant="outline">
              {L("Własny szablon", "Custom template")}: {usingCustom}
            </Badge>
            <Badge variant="outline">
              {L("Dostępnych szablonów", "Templates available")}: {templates.length}
            </Badge>
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="text-xs text-destructive hover:text-destructive"
            disabled={resetAll.isPending || experts.length === 0}
            onClick={() => {
              if (
                confirm(
                  L(
                    "Zresetować przypisania i nadpisania dla wszystkich ekspertów?",
                    "Reset assignments and overrides for all experts?",
                  ),
                )
              ) {
                resetAll.mutate();
              }
            }}
          >
            <RotateCcw className="mr-1 h-3.5 w-3.5" />
            {L("Reset wszystkich", "Reset all")}
          </Button>
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={L("Szukaj eksperta...", "Search expert...")}
            className="h-9 pl-7 text-sm"
          />
        </div>

        <div className="max-h-[420px] overflow-y-auto rounded-md border border-border/60">
          {expQ.isLoading ? (
            <p className="p-4 text-xs text-muted-foreground">{L("Wczytywanie...", "Loading...")}</p>
          ) : filtered.length === 0 ? (
            <p className="p-4 text-xs text-muted-foreground">
              {L("Brak ekspertów.", "No experts.")}
            </p>
          ) : (
            <ul className="divide-y divide-border/60">
              {filtered.map((exp) => (
                <li
                  key={exp.user_id}
                  className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {exp.display_name ?? L("(bez nazwy)", "(no name)")}
                    </p>
                    {exp.email ? (
                      <p className="truncate text-[11px] text-muted-foreground">{exp.email}</p>
                    ) : null}
                  </div>
                  <Select
                    value={exp.layout_template_id ?? "__default__"}
                    onValueChange={(v) =>
                      setTpl.mutate({
                        userId: exp.user_id,
                        templateId: v === "__default__" ? null : v,
                      })
                    }
                  >
                    <SelectTrigger className="h-8 w-[240px] text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__default__">
                        {L("Domyślny (globalny)", "Default (global)")}
                      </SelectItem>
                      {templates.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
