// Compact, professional company picker dialog. Users search existing
// companies from the tenant's CRM (autocomplete) and either link one to their
// profile or create a new one - inline form, single dialog surface. The new
// company also lands in the CRM (crm_companies) so the sales stack stays in
// sync with what users declare on their profile.
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Check, Loader2, Plus, Search } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { profileEditorKey } from "@/lib/profile/useProfileEditor";

type CompanyRow = {
  id: string;
  name: string;
  country: string | null;
  branch: string | null;
  city: string | null;
  address: string | null;
  postal_code: string | null;
  website: string | null;
  phone: string | null;
  domain: string | null;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentCompanyId?: string | null;
  currentCompanyName?: string | null;
  returnFocusRef?: React.RefObject<HTMLElement | null>;
};

const EMPTY_FORM = {
  name: "",
  country: "",
  branch: "",
  city: "",
  address: "",
  postal_code: "",
  website: "",
  phone: "",
};

type FormState = typeof EMPTY_FORM;

export function CompanyPickerDialog({
  open,
  onOpenChange,
  currentCompanyId,
  currentCompanyName,
}: Props) {
  const { t } = useTranslation();
  const { user, tenantId } = useAuth();
  const qc = useQueryClient();
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"search" | "create">("search");
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setQuery(currentCompanyName ?? "");
    setMode("search");
    setForm(EMPTY_FORM);
    // Autofocus the search field after the dialog transition.
    const id = window.setTimeout(() => inputRef.current?.focus(), 60);
    return () => window.clearTimeout(id);
  }, [open, currentCompanyName]);

  const trimmed = query.trim();
  const search = useQuery({
    queryKey: ["crm-companies-search", tenantId, trimmed.toLowerCase()],
    enabled: open && !!tenantId,
    staleTime: 30_000,
    queryFn: async (): Promise<CompanyRow[]> => {
      const q = supabase
        .from("crm_companies")
        .select(
          "id, name, country, branch, city, address, postal_code, website, phone, domain",
        )
        .order("name", { ascending: true })
        .limit(12);
      const { data, error } = trimmed.length > 0 ? await q.ilike("name", `%${trimmed}%`) : await q;
      if (error) throw error;
      return (data ?? []) as CompanyRow[];
    },
  });

  const results = search.data ?? [];
  const exactMatch = useMemo(
    () => results.some((r) => r.name.trim().toLowerCase() === trimmed.toLowerCase()),
    [results, trimmed],
  );

  const invalidateProfile = () => {
    if (user?.id) {
      void qc.invalidateQueries({ queryKey: profileEditorKey(user.id) });
      void qc.invalidateQueries({ queryKey: ["header-profile", user.id] });
      void qc.invalidateQueries({ queryKey: ["profile-sidebar", user.id] });
    }
  };

  const linkCompany = async (companyId: string | null) => {
    if (saving) return;
    setSaving(true);
    try {
      if (companyId) {
        const { error } = await supabase.rpc("link_current_company", {
          _company_id: companyId,
        });
        if (error) throw error;
      } else {
        if (!user?.id) throw new Error("not_authenticated");
        const { error } = await supabase
          .from("profiles")
          .update({ current_company_id: null, current_company: null })
          .eq("id", user.id);
        if (error) throw error;
      }
      invalidateProfile();
      onOpenChange(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(
        t("company.errors.linkFailed", { defaultValue: "Nie udało się przypisać firmy" }) +
          ` (${msg})`,
      );
    } finally {
      setSaving(false);
    }
  };

  const startCreate = () => {
    setForm({ ...EMPTY_FORM, name: trimmed });
    setMode("create");
  };

  const submitCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (saving) return;
    const name = form.name.trim();
    if (!name) {
      toast.error(t("company.errors.nameRequired", { defaultValue: "Nazwa jest wymagana" }));
      return;
    }
    if (!tenantId || !user?.id) {
      toast.error(t("company.errors.linkFailed", { defaultValue: "Nie udało się przypisać firmy" }));
      return;
    }
    setSaving(true);
    try {
      const payload = {
        tenant_id: tenantId,
        created_by: user.id,
        name,
        country: form.country.trim() || null,
        branch: form.branch.trim() || null,
        city: form.city.trim() || null,
        address: form.address.trim() || null,
        postal_code: form.postal_code.trim() || null,
        website: form.website.trim() || null,
        phone: form.phone.trim() || null,
      };
      const { data, error } = await supabase
        .from("crm_companies")
        .insert(payload)
        .select("id")
        .single();
      if (error) throw error;
      await supabase.rpc("link_current_company", { _company_id: data.id });
      void qc.invalidateQueries({ queryKey: ["crm-companies-search"] });
      invalidateProfile();
      toast.success(t("company.toast.created", { defaultValue: "Firma dodana" }));
      onOpenChange(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(t("company.errors.createFailed", { defaultValue: "Nie udało się dodać firmy" }) + ` (${msg})`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-border">
          <DialogTitle className="flex items-center gap-2 text-[15px] font-semibold">
            <Building2 className="h-4 w-4 text-primary" />
            {mode === "create"
              ? t("company.createTitle", { defaultValue: "Dodaj nową firmę" })
              : t("company.pickTitle", { defaultValue: "Wybierz firmę" })}
          </DialogTitle>
          <DialogDescription className="text-[12px] text-muted-foreground">
            {mode === "create"
              ? t("company.createDesc", {
                  defaultValue: "Wymagana jest tylko nazwa. Pozostałe dane możesz uzupełnić później.",
                })
              : t("company.pickDesc", {
                  defaultValue: "Wpisz nazwę firmy - podpowiedzi zaciągają się z CRM.",
                })}
          </DialogDescription>
        </DialogHeader>

        {mode === "search" ? (
          <div className="flex flex-col">
            <div className="px-5 py-3 border-b border-border">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  ref={inputRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("company.searchPh", { defaultValue: "np. New European Strategies" })}
                  className="h-9 pl-8 text-[13px] rounded-md"
                  autoComplete="off"
                />
              </div>
            </div>

            <div className="max-h-72 overflow-y-auto py-1">
              {search.isLoading ? (
                <div className="flex items-center justify-center py-8 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </div>
              ) : results.length === 0 ? (
                <div className="px-5 py-6 text-center text-[12px] text-muted-foreground">
                  {trimmed
                    ? t("company.noMatches", { defaultValue: "Brak dopasowań" })
                    : t("company.startTyping", { defaultValue: "Zacznij pisać, aby zobaczyć firmy" })}
                </div>
              ) : (
                <ul className="py-1">
                  {results.map((c) => {
                    const active = c.id === currentCompanyId;
                    const meta = [c.city, c.country, c.branch].filter(Boolean).join(" - ");
                    return (
                      <li key={c.id}>
                        <button
                          type="button"
                          onClick={() => void linkCompany(c.id)}
                          disabled={saving}
                          className={cn(
                            "w-full flex items-center gap-3 px-5 py-2 text-left transition-colors hover:bg-muted/70 disabled:opacity-60",
                            active && "bg-muted/50",
                          )}
                        >
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                            <Building2 className="h-3.5 w-3.5" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] font-medium text-foreground">
                              {c.name}
                            </span>
                            {meta && (
                              <span className="block truncate text-[11px] text-muted-foreground">
                                {meta}
                              </span>
                            )}
                          </span>
                          {active && <Check className="h-4 w-4 text-primary shrink-0" />}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {trimmed && !exactMatch && !search.isLoading && (
              <button
                type="button"
                onClick={startCreate}
                className="flex items-center gap-2 px-5 py-2.5 border-t border-border text-left text-[13px] font-medium text-primary hover:bg-primary/5 transition-colors"
              >
                <Plus className="h-4 w-4" />
                <span className="min-w-0 truncate">
                  {t("company.createNamed", {
                    defaultValue: 'Dodaj nową firmę: "{{name}}"',
                    name: trimmed,
                  })}
                </span>
              </button>
            )}

            <DialogFooter className="flex-row justify-between gap-2 px-5 py-3 border-t border-border bg-muted/30">
              {currentCompanyId ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 text-[12px] text-muted-foreground hover:text-destructive"
                  onClick={() => void linkCompany(null)}
                  disabled={saving}
                >
                  {t("company.detach", { defaultValue: "Odłącz firmę" })}
                </Button>
              ) : (
                <span />
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 text-[12px]"
                onClick={() => onOpenChange(false)}
                disabled={saving}
              >
                {t("common.cancel", { defaultValue: "Anuluj" })}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={submitCreate} className="flex flex-col">
            <div className="px-5 py-4 space-y-3 max-h-[60vh] overflow-y-auto">
              <FieldRow label={t("company.fields.name", { defaultValue: "Nazwa" })} required>
                <Input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className="h-9 text-[13px] rounded-md"
                  required
                  autoFocus
                  maxLength={200}
                />
              </FieldRow>
              <div className="grid grid-cols-2 gap-3">
                <FieldRow label={t("company.fields.country", { defaultValue: "Kraj" })}>
                  <Input
                    value={form.country}
                    onChange={(e) => setForm((f) => ({ ...f, country: e.target.value }))}
                    className="h-9 text-[13px] rounded-md"
                    maxLength={80}
                  />
                </FieldRow>
                <FieldRow label={t("company.fields.branch", { defaultValue: "Oddział / dział" })}>
                  <Input
                    value={form.branch}
                    onChange={(e) => setForm((f) => ({ ...f, branch: e.target.value }))}
                    className="h-9 text-[13px] rounded-md"
                    maxLength={120}
                  />
                </FieldRow>
              </div>
              <div className="grid grid-cols-[1fr_120px] gap-3">
                <FieldRow label={t("company.fields.city", { defaultValue: "Miasto" })}>
                  <Input
                    value={form.city}
                    onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
                    className="h-9 text-[13px] rounded-md"
                    maxLength={80}
                  />
                </FieldRow>
                <FieldRow label={t("company.fields.postalCode", { defaultValue: "Kod pocztowy" })}>
                  <Input
                    value={form.postal_code}
                    onChange={(e) => setForm((f) => ({ ...f, postal_code: e.target.value }))}
                    className="h-9 text-[13px] rounded-md"
                    maxLength={20}
                  />
                </FieldRow>
              </div>
              <FieldRow label={t("company.fields.address", { defaultValue: "Adres" })}>
                <Input
                  value={form.address}
                  onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                  className="h-9 text-[13px] rounded-md"
                  maxLength={200}
                />
              </FieldRow>
              <div className="grid grid-cols-2 gap-3">
                <FieldRow label={t("company.fields.website", { defaultValue: "Strona WWW" })}>
                  <Input
                    type="url"
                    value={form.website}
                    onChange={(e) => setForm((f) => ({ ...f, website: e.target.value }))}
                    placeholder="https://"
                    className="h-9 text-[13px] rounded-md"
                    maxLength={200}
                  />
                </FieldRow>
                <FieldRow label={t("company.fields.phone", { defaultValue: "Telefon" })}>
                  <Input
                    type="tel"
                    value={form.phone}
                    onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                    className="h-9 text-[13px] rounded-md"
                    maxLength={40}
                  />
                </FieldRow>
              </div>
            </div>

            <DialogFooter className="flex-row justify-between gap-2 px-5 py-3 border-t border-border bg-muted/30">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 text-[12px]"
                onClick={() => setMode("search")}
                disabled={saving}
              >
                {t("company.back", { defaultValue: "Wróć do wyszukiwania" })}
              </Button>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 text-[12px]"
                  onClick={() => onOpenChange(false)}
                  disabled={saving}
                >
                  {t("common.cancel", { defaultValue: "Anuluj" })}
                </Button>
                <Button type="submit" size="sm" className="h-8 text-[12px]" disabled={saving}>
                  {saving ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    t("company.save", { defaultValue: "Dodaj firmę" })
                  )}
                </Button>
              </div>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function FieldRow({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
        {required && <span className="ml-0.5 text-primary">*</span>}
      </Label>
      {children}
    </div>
  );
}
