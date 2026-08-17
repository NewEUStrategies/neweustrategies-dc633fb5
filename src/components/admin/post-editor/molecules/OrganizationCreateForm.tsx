// Molekuła: formularz zakładania organizacji w CRM (z logo), używany w trybie
// „create" dialogu wyboru organizacji.
//
// PO CO OSOBNY PLIK. Dialog trzymał obie tryby razem i urósł do 591 linii -
// prawie trzy razy tyle, ile największa istniejąca molekuła w tym pakiecie
// (PostAuthorsCard, 206) i więcej niż każdy organizm. Rozmiar nie był tu kwestią
// gustu: formularz ma własny stan (dziewięć pól + upload + zapis), więc siedząc
// w dialogu mieszał swoje `useState` ze stanem listy wyników i nie dawał się
// przetestować bez otwierania całego dialogu. Podział przywraca warstwy
// atomic design: dialog komponuje, formularz odpowiada za jedno zadanie.
//
// ZAPIS IDZIE RPC-em `create_company_self_service` (SECURITY DEFINER, zawężony
// do najemcy), a nie `createCrmCompany` - uzasadnienie w nagłówku
// OrganizationPickerDialog.
import { useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Building2, Loader2, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { registerMediaUpload } from "@/lib/media.functions";
import { IMAGE_ACCEPT_ATTR, IMAGE_MIME, uploadAndRegisterMedia } from "@/lib/media/upload";
import { FieldRow } from "../atoms";
import {
  ORGANIZATION_SEARCH_KEY,
  organizationRowSchema,
  type OrganizationSelection,
} from "./organizationDirectory";
import "@/lib/i18n-admin-post-panes";

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

export function OrganizationCreateForm({
  initialName,
  onBack,
  onCancel,
  onCreated,
}: {
  initialName: string;
  onBack: () => void;
  onCancel: () => void;
  onCreated: (selection: OrganizationSelection) => void;
}) {
  const { t } = useTranslation();
  const { user, tenantId } = useAuth();
  const qc = useQueryClient();
  const registerUpload = useServerFn(registerMediaUpload);

  const [form, setForm] = useState<FormState>({ ...EMPTY_FORM, name: initialName });
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const set = (key: keyof FormState) => (e: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }));

  const handleLogo = async (file: File): Promise<void> => {
    if (!tenantId || !user?.id) return;
    setUploading(true);
    try {
      // Jedyna dopuszczalna ścieżka uploadu: walidacja MIME/rozmiaru -> storage
      // -> rejestr w bibliotece, a przy ODRZUCONEJ rejestracji OBOWIĄZKOWE
      // usunięcie obiektu. Składanie tych kroków ręcznie zostawiało odrzucone
      // SVG żywe pod publicznym URL-em (stored XSS) - patrz nagłówek
      // lib/media/upload.ts. `tenantId` trafia w prefiks ścieżki, więc pliki
      // jednego najemcy nie mieszają się z plikami innego.
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

  const submit = async (e: FormEvent): Promise<void> => {
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
      await qc.invalidateQueries({ queryKey: ORGANIZATION_SEARCH_KEY });
      // Lista firm w CRM też się zmieniła - bez tego /admin/companies pokazywałby
      // stan sprzed dodania, aż do ręcznego odświeżenia.
      await qc.invalidateQueries({ queryKey: ["admin", "crm-companies"] });
      // MIGAWKĘ BUDUJEMY Z DANYCH Z BAZY, NIE Z FORMULARZA.
      // RPC jest IDEMPOTENTNE po (tenant_id, name_norm): gdy firma o tej nazwie
      // już istniała, zwraca JEJ id i nie nadpisuje pól (poza dołożeniem
      // brakującego logo). Zaufanie temu, co redakcja wpisała, dałoby wtedy wpis
      // z adresem, którego w CRM nie ma - dwa źródła prawdy o jednej organizacji.
      const canonical = await fetchCanonical(newId, name);
      toast.success(t("adminPostPanes.organization.created"));
      onCreated(
        canonical ?? {
          id: newId,
          name,
          logoUrl,
          website: form.website.trim() || null,
        },
      );
    } catch (e) {
      toast.error(`${t("adminPostPanes.organization.createFailed")} ${errText(e)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col">
      <div className="max-h-[60vh] space-y-3 overflow-y-auto px-5 py-4">
        <FieldRow label={t("adminPostPanes.organization.fields.name")} htmlFor="org-name">
          <Input
            id="org-name"
            value={form.name}
            onChange={set("name")}
            className="h-9 rounded-md text-[13px]"
            required
            autoFocus
            maxLength={200}
          />
        </FieldRow>

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
          {/* `accept` to JAWNA lista MIME z lib/media/upload, nie `image/*` -
              serwer i bucket egzekwują tę samą allowlistę, a SVG jest z niej
              świadomie wykluczone (publiczny bucket serwuje bajty wprost). */}
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
          <FieldRow label={t("adminPostPanes.organization.fields.website")} htmlFor="org-website">
            <Input
              id="org-website"
              type="url"
              value={form.website}
              onChange={set("website")}
              placeholder="https://"
              className="h-9 rounded-md text-[13px]"
              maxLength={300}
            />
          </FieldRow>
          <FieldRow label={t("adminPostPanes.organization.fields.domain")} htmlFor="org-domain">
            <Input
              id="org-domain"
              value={form.domain}
              onChange={set("domain")}
              placeholder="example.org"
              className="h-9 rounded-md text-[13px]"
              maxLength={200}
            />
          </FieldRow>
          <FieldRow label={t("adminPostPanes.organization.fields.branch")} htmlFor="org-branch">
            <Input
              id="org-branch"
              value={form.branch}
              onChange={set("branch")}
              className="h-9 rounded-md text-[13px]"
              maxLength={200}
            />
          </FieldRow>
          <FieldRow label={t("adminPostPanes.organization.fields.country")} htmlFor="org-country">
            <Input
              id="org-country"
              value={form.country}
              onChange={set("country")}
              className="h-9 rounded-md text-[13px]"
              maxLength={120}
            />
          </FieldRow>
          <FieldRow label={t("adminPostPanes.organization.fields.city")} htmlFor="org-city">
            <Input
              id="org-city"
              value={form.city}
              onChange={set("city")}
              className="h-9 rounded-md text-[13px]"
              maxLength={120}
            />
          </FieldRow>
          <FieldRow label={t("adminPostPanes.organization.fields.postalCode")} htmlFor="org-postal">
            <Input
              id="org-postal"
              value={form.postal_code}
              onChange={set("postal_code")}
              className="h-9 rounded-md text-[13px]"
              maxLength={20}
            />
          </FieldRow>
        </div>
        <FieldRow label={t("adminPostPanes.organization.fields.address")} htmlFor="org-address">
          <Input
            id="org-address"
            value={form.address}
            onChange={set("address")}
            className="h-9 rounded-md text-[13px]"
            maxLength={300}
          />
        </FieldRow>
        <FieldRow label={t("adminPostPanes.organization.fields.phone")} htmlFor="org-phone">
          <Input
            id="org-phone"
            type="tel"
            value={form.phone}
            onChange={set("phone")}
            className="h-9 rounded-md text-[13px]"
            maxLength={60}
          />
        </FieldRow>
      </div>

      <DialogFooter className="flex-row justify-between gap-2 border-t border-border bg-muted/30 px-5 py-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 text-[12px]"
          onClick={onBack}
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
            onClick={onCancel}
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
            {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
            {t("adminPostPanes.organization.save")}
          </Button>
        </div>
      </DialogFooter>
    </form>
  );
}

function errText(e: unknown): string {
  // `unknown` jest tu POPRAWNYM typem, nie ucieczką: `catch` w TypeScripcie
  // oddaje dowolną rzuconą wartość, a jedyną alternatywą byłoby `any`, które
  // zdejmuje kontrolę typów. Zawężamy strażnikiem `instanceof`.
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
