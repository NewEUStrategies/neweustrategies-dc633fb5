// Dialog wyboru organizacji dla wpisu: szukanie w CRM + zakładanie brakującej
// (rozbudowane, z logo). Jedna powierzchnia, dwa tryby - jak w
// components/profile/CompanyPickerDialog.tsx, którego wzorzec tu powtarzamy.
//
// DLACZEGO RPC, A NIE `listCrmCompanies` / `createCrmCompany`. Te funkcje
// serwerowe stoją za `requireCrmStaff` (admin/editor/super_admin), a wpisy pisze
// TAKŻE rola `author` - dla niej katalog firm byłby niedostępny, więc „wybierz
// z listy" nie działałoby dla połowy redakcji. Polityki RLS na `crm_companies`
// wymagają tych samych roli (crm_companies_staff_read/_insert), więc problem nie
// znika po zdjęciu middleware'u. Właściwą ścieżką są istniejące funkcje
// SECURITY DEFINER, zawężone do najemcy i nadane `authenticated`:
//   * search_companies_public(_query, _limit) - zwraca 11 pól prezentacyjnych,
//     bez leadów i bez pipeline'u, więc autor nie dostaje wglądu w sprzedaż;
//   * create_company_self_service(...) - ustawia tenant_id/created_by po stronie
//     bazy i jest idempotentne po (tenant_id, name_norm).
// Migracja 20260817090000 dołożyła do obu `logo_url` - wcześniej katalog nie
// umiał ani zwrócić logo, ani go zapisać.
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Building2, Check, Loader2, Plus, Search, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
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
import { registerMediaUpload } from "@/lib/media.functions";
import { IMAGE_ACCEPT_ATTR, IMAGE_MIME, uploadAndRegisterMedia } from "@/lib/media/upload";
import { cn } from "@/lib/utils";
import "@/lib/i18n-admin-post-panes";

/** Migawka, którą dialog oddaje wywołującemu - dokładnie kolumny `posts.organization_*`. */
export interface OrganizationSelection {
  id: string;
  name: string;
  logoUrl: string | null;
  website: string | null;
}

const organizationRowSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  website: z.string().nullable(),
  logo_url: z.string().nullable(),
  country: z.string().nullable(),
  city: z.string().nullable(),
  branch: z.string().nullable(),
});

type OrganizationRow = z.infer<typeof organizationRowSchema>;

const EMPTY_FORM = {
  name: "",
  website: "",
  domain: "",
  branch: "",
  country: "",
  city: "",
  postal_code: "",
  address: "",
  phone: "",
};

type FormState = typeof EMPTY_FORM;

export function OrganizationPickerDialog({
  open,
  onOpenChange,
  currentId,
  currentName,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentId: string | null;
  currentName: string | null;
  onSelect: (selection: OrganizationSelection) => void;
}) {
  const { t } = useTranslation();
  const { user, tenantId } = useAuth();
  const qc = useQueryClient();
  const registerUpload = useServerFn(registerMediaUpload);

  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"search" | "create">("search");
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setQuery(currentName ?? "");
    setMode("search");
    setForm(EMPTY_FORM);
    setLogoUrl(null);
    const id = window.setTimeout(() => searchRef.current?.focus(), 60);
    return () => window.clearTimeout(id);
  }, [open, currentName]);

  const trimmed = query.trim();
  const search = useQuery({
    queryKey: ["post-organizations-search", tenantId, trimmed.toLowerCase()],
    enabled: open && !!tenantId,
    staleTime: 30_000,
    queryFn: async (): Promise<OrganizationRow[]> => {
      const { data, error } = await supabase.rpc("search_companies_public", {
        _query: trimmed,
        _limit: 12,
      });
      if (error) throw error;
      // `safeParse` zamiast rzutowania: RPC zwraca kolumny wyliczone w SQL-u,
      // a nie typ, który TS potrafi sprawdzić - niezgodność ma dać pustą listę
      // i wpis w konsoli, nie wyjątek w środku dialogu.
      const parsed = z.array(organizationRowSchema).safeParse(data ?? []);
      if (!parsed.success) {
        console.error("search_companies_public parse error", parsed.error);
        return [];
      }
      return parsed.data;
    },
  });

  const results = search.data ?? [];
  // Zależność to `search.data`, nie `results`: `?? []` tworzy NOWĄ tablicę przy
  // każdym renderze, więc memo z `results` w liście przeliczałoby się zawsze
  // (i eslint słusznie to zgłasza).
  const exactMatch = useMemo(
    () => (search.data ?? []).some((r) => r.name.trim().toLowerCase() === trimmed.toLowerCase()),
    [search.data, trimmed],
  );

  const pick = (row: OrganizationRow) => {
    onSelect({
      id: row.id,
      name: row.name.trim(),
      logoUrl: row.logo_url?.trim() || null,
      website: row.website?.trim() || null,
    });
    onOpenChange(false);
  };

  const handleLogo = async (file: File) => {
    if (!tenantId || !user?.id) return;
    setUploading(true);
    try {
      // Jedyna dopuszczalna ścieżka uploadu (walidacja MIME/rozmiaru -> storage
      // -> rejestr w bibliotece, a przy odrzuconej rejestracji USUNIĘCIE pliku).
      // Składanie tych kroków ręcznie zostawiało odrzucone SVG żywe pod
      // publicznym URL-em - patrz nagłówek lib/media/upload.ts.
      const uploaded = await uploadAndRegisterMedia({
        file,
        tenantId,
        userId: user.id,
        registerMedia: registerUpload,
        allowedMime: IMAGE_MIME,
        subfolder: "organizations",
      });
      setLogoUrl(uploaded.publicUrl);
    } catch (e) {
      toast.error(`${t("adminPostPanes.organization.logoFailed")} ${errText(e)}`);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const submitCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (saving || uploading) return;
    const name = form.name.trim();
    if (!name) {
      toast.error(t("adminPostPanes.organization.nameRequired"));
      return;
    }
    setSaving(true);
    try {
      const { data: newId, error } = await supabase.rpc("create_company_self_service", {
        _name: name,
        _country: form.country.trim() || undefined,
        _branch: form.branch.trim() || undefined,
        _city: form.city.trim() || undefined,
        _address: form.address.trim() || undefined,
        _postal_code: form.postal_code.trim() || undefined,
        _website: form.website.trim() || undefined,
        _phone: form.phone.trim() || undefined,
        _logo_url: logoUrl ?? undefined,
      });
      if (error) throw error;
      if (!newId) throw new Error("empty_response");
      await qc.invalidateQueries({ queryKey: ["post-organizations-search"] });
      // Lista firm w CRM też się zmieniła - bez tego panel /admin/companies
      // pokazywałby stan sprzed dodania, aż do ręcznego odświeżenia.
      await qc.invalidateQueries({ queryKey: ["admin", "crm-companies"] });
      // MIGAWKĘ BUDUJEMY Z DANYCH Z BAZY, NIE Z FORMULARZA.
      // `create_company_self_service` jest IDEMPOTENTNE po (tenant_id, name_norm):
      // gdy firma o tej nazwie już istniała, zwraca JEJ id i nie nadpisuje pól
      // (poza dołożeniem brakującego logo). Zaufanie temu, co redakcja wpisała
      // w formularzu, dałoby wtedy wpis z adresem, którego w CRM nie ma - dwa
      // źródła prawdy o tej samej organizacji. Dociągamy kanoniczny wiersz.
      const canonical = await fetchCanonical(newId, name);
      toast.success(t("adminPostPanes.organization.created"));
      onSelect(
        canonical ?? {
          id: newId,
          name,
          logoUrl,
          website: form.website.trim() || null,
        },
      );
      onOpenChange(false);
    } catch (e) {
      toast.error(`${t("adminPostPanes.organization.createFailed")} ${errText(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const set = (key: keyof FormState) => (e: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }));

  return (
    <Dialog open={open} onOpenChange={(v) => !saving && !uploading && onOpenChange(v)}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="border-b border-border px-5 pb-3 pt-5">
          <DialogTitle className="flex items-center gap-2 text-[15px] font-semibold">
            <Building2 className="h-4 w-4 text-primary" aria-hidden="true" />
            {mode === "create"
              ? t("adminPostPanes.organization.dialogCreateTitle")
              : t("adminPostPanes.organization.dialogPickTitle")}
          </DialogTitle>
          <DialogDescription className="text-[12px] text-muted-foreground">
            {mode === "create"
              ? t("adminPostPanes.organization.dialogCreateDesc")
              : t("adminPostPanes.organization.dialogPickDesc")}
          </DialogDescription>
        </DialogHeader>

        {mode === "search" ? (
          <div className="flex flex-col">
            <div className="border-b border-border px-5 py-3">
              <div className="relative">
                <Search
                  className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  ref={searchRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("adminPostPanes.organization.searchPlaceholder")}
                  className="h-9 rounded-md pl-9 text-[13px]"
                  autoComplete="off"
                />
              </div>
            </div>

            <div className="max-h-72 overflow-y-auto py-1">
              {search.isLoading ? (
                <div className="flex items-center justify-center py-8 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                </div>
              ) : search.isError ? (
                <div className="px-5 py-6 text-center text-[12px] text-destructive">
                  {t("adminPostPanes.organization.searchFailed")}
                </div>
              ) : results.length === 0 ? (
                <div className="px-5 py-6 text-center text-[12px] text-muted-foreground">
                  {trimmed
                    ? t("adminPostPanes.organization.noMatches")
                    : t("adminPostPanes.organization.startTyping")}
                </div>
              ) : (
                <ul className="py-1">
                  {results.map((row) => {
                    const active = row.id === currentId;
                    const meta = [row.city, row.country, row.branch].filter(Boolean).join(" · ");
                    return (
                      <li key={row.id}>
                        <button
                          type="button"
                          onClick={() => pick(row)}
                          className={cn(
                            "flex w-full items-center gap-3 px-5 py-2 text-left transition-colors hover:bg-muted/70",
                            active && "bg-muted/50",
                          )}
                        >
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted text-muted-foreground">
                            {row.logo_url ? (
                              <img
                                src={row.logo_url}
                                alt=""
                                className="h-full w-full object-contain"
                              />
                            ) : (
                              <Building2 className="h-3.5 w-3.5" aria-hidden="true" />
                            )}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] font-medium text-foreground">
                              {row.name}
                            </span>
                            {meta && (
                              <span className="block truncate text-[11px] text-muted-foreground">
                                {meta}
                              </span>
                            )}
                          </span>
                          {active && (
                            <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                          )}
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
                onClick={() => {
                  setForm({ ...EMPTY_FORM, name: trimmed });
                  setMode("create");
                }}
                className="flex items-center gap-2 border-t border-border px-5 py-2.5 text-left text-[13px] font-medium text-primary transition-colors hover:bg-primary/5"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                <span className="min-w-0 truncate">
                  {t("adminPostPanes.organization.createNamed", { name: trimmed })}
                </span>
              </button>
            )}

            <DialogFooter className="flex-row justify-end gap-2 border-t border-border bg-muted/30 px-5 py-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 text-[12px]"
                onClick={() => onOpenChange(false)}
              >
                {t("common.cancel")}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={submitCreate} className="flex flex-col">
            <div className="max-h-[60vh] space-y-3 overflow-y-auto px-5 py-4">
              <Field label={t("adminPostPanes.organization.fields.name")}>
                <Input
                  value={form.name}
                  onChange={set("name")}
                  className="h-9 rounded-md text-[13px]"
                  required
                  autoFocus
                  maxLength={200}
                />
              </Field>

              <div className="space-y-1.5">
                <Label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {t("adminPostPanes.organization.logoLabel")}
                </Label>
                <div className="flex items-center gap-3">
                  <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted">
                    {logoUrl ? (
                      <img
                        src={logoUrl}
                        alt={t("adminPostPanes.organization.logoAlt")}
                        className="h-full w-full object-contain"
                      />
                    ) : (
                      <Building2 className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                    )}
                  </span>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 text-[12px]"
                      disabled={uploading}
                      onClick={() => fileRef.current?.click()}
                    >
                      {uploading ? (
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      ) : (
                        <Upload className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                      )}
                      {uploading
                        ? t("adminPostPanes.organization.logoUploading")
                        : logoUrl
                          ? t("adminPostPanes.organization.logoReplace")
                          : t("adminPostPanes.organization.logoUpload")}
                    </Button>
                    {logoUrl && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 text-[12px] text-muted-foreground hover:text-destructive"
                        onClick={() => setLogoUrl(null)}
                      >
                        <Trash2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                        {t("adminPostPanes.organization.logoRemove")}
                      </Button>
                    )}
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {t("adminPostPanes.organization.logoHint")}
                </p>
                <input
                  ref={fileRef}
                  type="file"
                  accept={IMAGE_ACCEPT_ATTR}
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleLogo(file);
                  }}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label={t("adminPostPanes.organization.fields.website")}>
                  <Input
                    type="url"
                    value={form.website}
                    onChange={set("website")}
                    placeholder="https://"
                    className="h-9 rounded-md text-[13px]"
                    maxLength={300}
                  />
                </Field>
                <Field label={t("adminPostPanes.organization.fields.domain")}>
                  <Input
                    value={form.domain}
                    onChange={set("domain")}
                    placeholder="example.org"
                    className="h-9 rounded-md text-[13px]"
                    maxLength={200}
                  />
                </Field>
                <Field label={t("adminPostPanes.organization.fields.branch")}>
                  <Input
                    value={form.branch}
                    onChange={set("branch")}
                    className="h-9 rounded-md text-[13px]"
                    maxLength={200}
                  />
                </Field>
                <Field label={t("adminPostPanes.organization.fields.country")}>
                  <Input
                    value={form.country}
                    onChange={set("country")}
                    className="h-9 rounded-md text-[13px]"
                    maxLength={120}
                  />
                </Field>
                <Field label={t("adminPostPanes.organization.fields.city")}>
                  <Input
                    value={form.city}
                    onChange={set("city")}
                    className="h-9 rounded-md text-[13px]"
                    maxLength={120}
                  />
                </Field>
                <Field label={t("adminPostPanes.organization.fields.postalCode")}>
                  <Input
                    value={form.postal_code}
                    onChange={set("postal_code")}
                    className="h-9 rounded-md text-[13px]"
                    maxLength={20}
                  />
                </Field>
              </div>
              <Field label={t("adminPostPanes.organization.fields.address")}>
                <Input
                  value={form.address}
                  onChange={set("address")}
                  className="h-9 rounded-md text-[13px]"
                  maxLength={300}
                />
              </Field>
              <Field label={t("adminPostPanes.organization.fields.phone")}>
                <Input
                  type="tel"
                  value={form.phone}
                  onChange={set("phone")}
                  className="h-9 rounded-md text-[13px]"
                  maxLength={60}
                />
              </Field>
            </div>

            <DialogFooter className="flex-row justify-between gap-2 border-t border-border bg-muted/30 px-5 py-3">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 text-[12px]"
                onClick={() => setMode("search")}
                disabled={saving || uploading}
              >
                {t("adminPostPanes.organization.back")}
              </Button>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 text-[12px]"
                  onClick={() => onOpenChange(false)}
                  disabled={saving || uploading}
                >
                  {t("common.cancel")}
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  className="h-8 text-[12px]"
                  disabled={saving || uploading || !form.name.trim()}
                >
                  {saving && (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  )}
                  {t("adminPostPanes.organization.save")}
                </Button>
              </div>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function errText(e: unknown): string {
  return e instanceof Error ? `(${e.message})` : "";
}

/**
 * Kanoniczny wiersz organizacji po zapisie. Zwraca `null`, gdy nie da się go
 * odczytać - wywołujący ma wtedy fallback na dane z formularza, bo przypisanie
 * organizacji nie może się wywrócić z powodu dodatkowego, kosmetycznego odczytu.
 */
async function fetchCanonical(id: string, name: string): Promise<OrganizationSelection | null> {
  const { data, error } = await supabase.rpc("search_companies_public", {
    _query: name,
    _limit: 100,
  });
  if (error) return null;
  const parsed = z.array(organizationRowSchema).safeParse(data ?? []);
  if (!parsed.success) return null;
  const row = parsed.data.find((r) => r.id === id);
  if (!row) return null;
  return {
    id: row.id,
    name: row.name.trim(),
    logoUrl: row.logo_url?.trim() || null,
    website: row.website?.trim() || null,
  };
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}
