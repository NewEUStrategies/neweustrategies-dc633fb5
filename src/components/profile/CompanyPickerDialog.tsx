// Compact, professional company picker dialog. Users search existing
// companies from the tenant's CRM (autocomplete) and either link one to their
// profile or create a new one - inline form, single dialog surface. The new
// company also lands in the CRM (crm_companies) so the sales stack stays in
// sync with what users declare on their profile.
//
// Search and creation go through SECURITY DEFINER RPCs instead of direct
// table access: crm_companies read policy is staff-only, while members still
// need to pick/link a company from their own tenant.
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Check, Loader2, Plus, Search } from "lucide-react";
import { z } from "zod";

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
import { ensureI18n as ensureAdminExtrasI18n } from "@/lib/i18n-admin-extras";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { profileEditorKey } from "@/lib/profile/useProfileEditor";

const companyRowSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  country: z.string().nullable(),
  branch: z.string().nullable(),
  city: z.string().nullable(),
  address: z.string().nullable(),
  postal_code: z.string().nullable(),
  website: z.string().nullable(),
  phone: z.string().nullable(),
  domain: z.string().nullable(),
});

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
  returnFocusRef,
}: Props) {
  // company.* dictionary lives in the admin/CRM overlay; this dialog is the one
  // consumer outside /admin, so register it here too (see lib/i18n-admin-extras).
  ensureAdminExtrasI18n();
  const { t } = useTranslation();
  const { user, tenantId } = useAuth();
  const qc = useQueryClient();
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"search" | "create">("search");
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // Ziarno identyfikatorów pól formularza tworzenia firmy - `useId`, bo dialog
  // może być zamontowany więcej niż raz (edytor profilu i panel tożsamości).
  const formId = useId();

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
      const { data, error } = await supabase.rpc("search_companies_public", {
        _query: trimmed,
        _limit: 12,
      });
      if (error) throw error;
      const parsed = z.array(companyRowSchema).safeParse(data ?? []);
      if (!parsed.success) {
        console.error("search_companies_public parse error", parsed.error);
        return [];
      }
      return parsed.data;
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

  // Zamknięcie dialogu + oddanie focusu do triggera w sekcji firmy (a11y:
  // klawiaturowy użytkownik nie ląduje na <body> po zapisie).
  const closeAndRestoreFocus = () => {
    onOpenChange(false);
    window.setTimeout(() => {
      returnFocusRef?.current?.focus();
    }, 80);
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
      toast.success(companyId ? t("company.toast.linked") : t("company.toast.detached"));
      closeAndRestoreFocus();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(t("company.errors.linkFailed") + ` (${msg})`);
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
      toast.error(t("company.errors.nameRequired"));
      return;
    }
    if (!tenantId || !user?.id) {
      toast.error(t("company.errors.linkFailed"));
      return;
    }
    setSaving(true);
    try {
      const { data: companyId, error } = await supabase.rpc("create_company_self_service", {
        _name: name,
        _country: form.country.trim() || undefined,
        _branch: form.branch.trim() || undefined,
        _city: form.city.trim() || undefined,
        _address: form.address.trim() || undefined,
        _postal_code: form.postal_code.trim() || undefined,
        _website: form.website.trim() || undefined,
        _phone: form.phone.trim() || undefined,
      });
      if (error) throw error;
      if (!companyId) throw new Error("empty_response");
      // Drugi krok - powiązanie z profilem - musi zgłosić błąd tak samo jak
      // pierwszy. Bez sprawdzenia `error` tutaj firma ląduje w CRM, profil
      // zostaje BEZ powiązania, a użytkownik i tak widzi "utworzono".
      //
      // Błąd TEGO kroku dostaje WŁASNY komunikat (`linkFailed`, nie
      // `createFailed`): firma w tym miejscu JUŻ istnieje w CRM, więc
      // "nie udało się dodać firmy" jest nieprawdziwe i wysłałoby użytkownika
      // do ponownego tworzenia - czyli duplikatu firmy zamiast powtórzenia
      // samego powiązania. Lista wyszukiwania jest tu i tak unieważniana, bo
      // firma naprawdę przybyła do CRM - kolejne wpisanie tej samej nazwy w
      // wyszukiwarkę znajdzie ją i pozwoli połączyć bez tworzenia drugiej.
      const { error: linkError } = await supabase.rpc("link_current_company", {
        _company_id: companyId,
      });
      if (linkError) {
        void qc.invalidateQueries({ queryKey: ["crm-companies-search"] });
        const msg = linkError instanceof Error ? linkError.message : String(linkError);
        toast.error(t("company.errors.linkFailed") + ` (${msg})`);
        return;
      }
      void qc.invalidateQueries({ queryKey: ["crm-companies-search"] });
      invalidateProfile();
      toast.success(t("company.toast.created"));
      closeAndRestoreFocus();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(t("company.errors.createFailed") + ` (${msg})`);
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
            {mode === "create" ? t("company.createTitle") : t("company.pickTitle")}
          </DialogTitle>
          <DialogDescription className="text-[12px] text-muted-foreground">
            {mode === "create" ? t("company.createDesc") : t("company.pickDesc")}
          </DialogDescription>
        </DialogHeader>

        {mode === "search" ? (
          <div className="flex flex-col">
            <div className="px-5 py-3 border-b border-border">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <span
                  className="absolute left-9 top-1/2 -translate-y-1/2 h-4 w-px bg-border"
                  aria-hidden="true"
                />
                <Input
                  ref={inputRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("company.searchPh")}
                  className="h-9 pl-12 text-[13px] rounded-md"
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
                  {trimmed ? t("company.noMatches") : t("company.startTyping")}
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
                  {t("company.detach")}
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
                {t("common.cancel")}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={submitCreate} className="flex flex-col">
            <div className="px-5 py-4 space-y-3 max-h-[60vh] overflow-y-auto">
              <FieldRow label={t("company.fields.name")} required htmlFor={`${formId}-name`}>
                <Input
                  id={`${formId}-name`}
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className="h-9 text-[13px] rounded-md"
                  required
                  autoFocus
                  maxLength={200}
                />
              </FieldRow>
              <div className="grid grid-cols-2 gap-3">
                <FieldRow label={t("company.fields.country")} htmlFor={`${formId}-country`}>
                  <Input
                    id={`${formId}-country`}
                    value={form.country}
                    onChange={(e) => setForm((f) => ({ ...f, country: e.target.value }))}
                    className="h-9 text-[13px] rounded-md"
                    maxLength={80}
                  />
                </FieldRow>
                <FieldRow label={t("company.fields.branch")} htmlFor={`${formId}-branch`}>
                  <Input
                    id={`${formId}-branch`}
                    value={form.branch}
                    onChange={(e) => setForm((f) => ({ ...f, branch: e.target.value }))}
                    className="h-9 text-[13px] rounded-md"
                    maxLength={120}
                  />
                </FieldRow>
              </div>
              <div className="grid grid-cols-[1fr_120px] gap-3">
                <FieldRow label={t("company.fields.city")} htmlFor={`${formId}-city`}>
                  <Input
                    id={`${formId}-city`}
                    value={form.city}
                    onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
                    className="h-9 text-[13px] rounded-md"
                    maxLength={80}
                  />
                </FieldRow>
                <FieldRow label={t("company.fields.postalCode")} htmlFor={`${formId}-postal_code`}>
                  <Input
                    id={`${formId}-postal_code`}
                    value={form.postal_code}
                    onChange={(e) => setForm((f) => ({ ...f, postal_code: e.target.value }))}
                    className="h-9 text-[13px] rounded-md"
                    maxLength={20}
                  />
                </FieldRow>
              </div>
              <FieldRow label={t("company.fields.address")} htmlFor={`${formId}-address`}>
                <Input
                  id={`${formId}-address`}
                  value={form.address}
                  onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                  className="h-9 text-[13px] rounded-md"
                  maxLength={200}
                />
              </FieldRow>
              <div className="grid grid-cols-2 gap-3">
                <FieldRow label={t("company.fields.website")} htmlFor={`${formId}-website`}>
                  <Input
                    type="url"
                    id={`${formId}-website`}
                    value={form.website}
                    onChange={(e) => setForm((f) => ({ ...f, website: e.target.value }))}
                    placeholder="https://"
                    className="h-9 text-[13px] rounded-md"
                    maxLength={200}
                  />
                </FieldRow>
                <FieldRow label={t("company.fields.phone")} htmlFor={`${formId}-phone`}>
                  <Input
                    type="tel"
                    id={`${formId}-phone`}
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
                {t("company.back")}
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
                  {t("common.cancel")}
                </Button>
                <Button type="submit" size="sm" className="h-8 text-[12px]" disabled={saving}>
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t("company.save")}
                </Button>
              </div>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Wiersz pola formularza firmy.
 *
 * `htmlFor` jest WYMAGANY, bo `Label` jest tu RODZEŃSTWEM pola, nie jego
 * rodzicem - bez powiązania czytnik ekranu ogłasza osiem nienazwanych pól
 * tekstowych i nie ma z czego odczytać, które jest nazwą firmy, a które
 * kodem pocztowym (WCAG 1.3.1 / 4.1.2). Gwiazdka przy `required` jest
 * dekoracją dla wzroku - `aria-hidden`, bo pole niesie własne `required`.
 */
function FieldRow({
  label,
  htmlFor,
  required = false,
  children,
}: {
  label: string;
  htmlFor: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <Label
        htmlFor={htmlFor}
        className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
      >
        {label}
        {required && (
          <span aria-hidden="true" className="ml-0.5 text-destructive">
            *
          </span>
        )}
      </Label>
      {children}
    </div>
  );
}
