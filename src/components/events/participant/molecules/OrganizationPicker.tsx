// Molekuła: WYBÓR ORGANIZACJI W PROFILU UCZESTNIKA.
//
// Uczestnik nie ma (i nie ma mieć) dostępu do panelu admina, więc obie ścieżki
// muszą działać z poziomu jego profilu na wydarzeniu:
//  1. wybór z listy - wpisywany tekst zawęża podpowiedzi z kartotek firm,
//  2. dodanie nowej organizacji - popup z logo, adresem, kontaktem i krajem.
//
// Zapisywana jest NAZWA (pole `company_text` kartoteki wydarzenia); logotyp i
// dane brandowe czyta potem `crm_company_brand` po tej właśnie nazwie.
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Building2, Check, ImagePlus, Loader2, Plus, Search, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { FieldBox } from "@/components/ui/field-box";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/hooks/useAuth";
import { registerMediaUpload } from "@/lib/media.functions";
import { IMAGE_ACCEPT_ATTR, IMAGE_MIME, uploadAndRegisterMedia } from "@/lib/media/upload";
import { useCompanySearch, useCreateCompany, type CompanyOption } from "@/lib/crm/companyDirectory";
import { useCompanyBrand } from "@/lib/crm/useCompanyBrand";
import { ensureI18n as ensureCartI18n } from "@/lib/i18n-cart";

ensureCartI18n();

interface Props {
  value: string;
  companyId: string | null;
  onChange: (company: { id: string | null; name: string }) => void;
  label: string;
}

interface NewOrgForm {
  name: string;
  logo_url: string;
  address: string;
  city: string;
  postal_code: string;
  country: string;
  phone: string;
  email: string;
  website: string;
  branch: string;
}

const EMPTY_ORG: NewOrgForm = {
  name: "",
  logo_url: "",
  address: "",
  city: "",
  postal_code: "",
  country: "",
  phone: "",
  email: "",
  website: "",
  branch: "",
};

function subtitle(option: CompanyOption): string {
  return [option.city, option.country, option.branch].filter((part) => part !== null).join(" · ");
}

export function OrganizationPicker({ value, companyId, onChange, label }: Props) {
  const { t } = useTranslation();
  const { user, tenantId } = useAuth();
  const registerUpload = useServerFn(registerMediaUpload);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [org, setOrg] = useState<NewOrgForm>(EMPTY_ORG);

  const search = useCompanySearch(query);
  const create = useCreateCompany();
  const brand = useCompanyBrand(value);

  const options = useMemo(() => search.data ?? [], [search.data]);
  const showList = open && query.trim().length >= 2;

  const pick = (option: CompanyOption) => {
    onChange({ id: option.id, name: option.name });
    setQuery("");
    setOpen(false);
  };

  const handleLogo = async (file: File): Promise<void> => {
    if (tenantId === null || tenantId === undefined || user?.id === undefined) {
      toast.error(t("eventMe.organization.logoFailed"));
      return;
    }
    setUploading(true);
    try {
      const uploaded = await uploadAndRegisterMedia({
        file,
        tenantId,
        userId: user.id,
        registerMedia: registerUpload,
        allowedMime: IMAGE_MIME,
        subfolder: "crm-companies",
      });
      setOrg((prev) => ({ ...prev, logo_url: uploaded.publicUrl }));
    } catch (error) {
      toast.error(`${t("eventMe.organization.logoFailed")} ${(error as Error).message}`.trim());
    } finally {
      setUploading(false);
      if (fileRef.current !== null) fileRef.current.value = "";
    }
  };

  const submitOrg = () => {
    const name = org.name.trim();
    if (name === "") {
      toast.error(t("eventMe.organization.nameRequired"));
      return;
    }
    create.mutate(
      {
        name,
        logo_url: org.logo_url.trim(),
        address: org.address.trim(),
        city: org.city.trim(),
        postal_code: org.postal_code.trim(),
        country: org.country.trim(),
        phone: org.phone.trim(),
        email: org.email.trim(),
        website: org.website.trim(),
        branch: org.branch.trim(),
      },
      {
        onSuccess: (created) => {
          onChange({ id: created?.id ?? null, name: created?.name ?? name });
          setDialogOpen(false);
          setOrg(EMPTY_ORG);
          toast.success(t("eventMe.organization.created"));
        },
        onError: (error) =>
          toast.error(`${t("eventMe.organization.createError")} ${error.message}`.trim()),
      },
    );
  };

  const orgField =
    (key: keyof NewOrgForm) =>
    (event: { target: { value: string } }): void => {
      setOrg((prev) => ({ ...prev, [key]: event.target.value }));
    };

  return (
    <div className="space-y-2">
      <div className="relative">
        <FieldBox
          label={label}
          value={value}
          onChange={(event) => {
            onChange({ id: null, name: event.target.value });
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
          autoComplete="organization"
        />
        {showList && (
          <div
            className="absolute z-30 mt-1 w-full overflow-hidden rounded-[6px] border border-border bg-popover shadow-lg"
            role="listbox"
            aria-label={t("eventMe.organization.listAria")}
          >
            {search.isFetching && (
              <p className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                {t("eventMe.organization.searching")}
              </p>
            )}
            {!search.isFetching && options.length === 0 && (
              <p className="px-3 py-2 text-xs text-muted-foreground">
                {t("eventMe.organization.noResults")}
              </p>
            )}
            {options.map((option) => (
              <Button
                key={option.id}
                type="button"
                role="option"
                aria-selected={option.id === companyId}
                variant="ghost"
                className="flex h-auto w-full items-center justify-start gap-2 rounded-none px-3 py-2 text-left hover:bg-muted/60"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => pick(option)}
              >
                {option.logoUrl !== null ? (
                  <img
                    src={option.logoUrl}
                    alt=""
                    className="h-6 w-6 shrink-0 rounded-[6px] object-contain"
                  />
                ) : (
                  <Building2
                    className="h-4 w-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                )}
                <span className="min-w-0">
                  <span className="block truncate text-sm">{option.name}</span>
                  {subtitle(option) !== "" && (
                    <span className="block truncate text-xs text-muted-foreground">
                      {subtitle(option)}
                    </span>
                  )}
                </span>
                {option.id === companyId && (
                  <Check className="ml-auto h-4 w-4 text-primary" aria-hidden="true" />
                )}
              </Button>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            setOrg({ ...EMPTY_ORG, name: value.trim() });
            setDialogOpen(true);
          }}
        >
          <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
          {t("eventMe.organization.add")}
        </Button>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Search className="h-3.5 w-3.5" aria-hidden="true" />
          {t("eventMe.organization.hint")}
        </span>
        {brand.data?.logoUrl !== null && brand.data?.logoUrl !== undefined && (
          <img
            src={brand.data.logoUrl}
            alt={brand.data.name ?? ""}
            className="h-6 rounded-[6px] object-contain"
          />
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl rounded-[6px]">
          <DialogHeader>
            <DialogTitle>{t("eventMe.organization.dialogTitle")}</DialogTitle>
            <DialogDescription>{t("eventMe.organization.dialogHint")}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex flex-col gap-4 sm:flex-row">
              <div
                className={`relative grid h-24 w-24 shrink-0 place-items-center overflow-hidden rounded-[6px] border border-dashed bg-muted/30 ${
                  dragOver ? "border-primary" : "border-border"
                }`}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragOver(false);
                  const file = event.dataTransfer.files[0];
                  if (file !== undefined) void handleLogo(file);
                }}
              >
                {org.logo_url.trim() !== "" ? (
                  <img
                    src={org.logo_url}
                    alt={t("eventMe.organization.logoAlt")}
                    className="h-full w-full object-contain"
                  />
                ) : (
                  <ImagePlus className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                )}
                {uploading && (
                  <span className="absolute inset-0 grid place-items-center bg-background/70">
                    <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
                  </span>
                )}
              </div>
              <div className="min-w-0 flex-1 space-y-2">
                <input
                  ref={fileRef}
                  type="file"
                  accept={IMAGE_ACCEPT_ATTR}
                  className="sr-only"
                  aria-label={t("eventMe.organization.logoUpload")}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file !== undefined) void handleLogo(file);
                  }}
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={uploading}
                    onClick={() => fileRef.current?.click()}
                  >
                    {t("eventMe.organization.logoUpload")}
                  </Button>
                  {org.logo_url.trim() !== "" && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setOrg((prev) => ({ ...prev, logo_url: "" }))}
                    >
                      <Trash2 className="mr-1.5 h-4 w-4" aria-hidden="true" />
                      {t("eventMe.organization.logoRemove")}
                    </Button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {t("eventMe.organization.logoHint")}
                </p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <FieldBox
                label={t("eventMe.organization.fields.name")}
                value={org.name}
                onChange={orgField("name")}
              />
              <FieldBox
                label={t("eventMe.organization.fields.branch")}
                value={org.branch}
                onChange={orgField("branch")}
              />
              <FieldBox
                label={t("eventMe.organization.fields.address")}
                value={org.address}
                onChange={orgField("address")}
              />
              <FieldBox
                label={t("eventMe.organization.fields.city")}
                value={org.city}
                onChange={orgField("city")}
              />
              <FieldBox
                label={t("eventMe.organization.fields.postalCode")}
                value={org.postal_code}
                onChange={orgField("postal_code")}
              />
              <FieldBox
                label={t("eventMe.organization.fields.country")}
                value={org.country}
                onChange={orgField("country")}
              />
              <FieldBox
                label={t("eventMe.organization.fields.phone")}
                value={org.phone}
                onChange={orgField("phone")}
                inputMode="tel"
              />
              <FieldBox
                label={t("eventMe.organization.fields.email")}
                value={org.email}
                onChange={orgField("email")}
                inputMode="email"
              />
              <FieldBox
                label={t("eventMe.organization.fields.website")}
                value={org.website}
                onChange={orgField("website")}
                inputMode="url"
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setDialogOpen(false)}>
              {t("eventMe.organization.cancel")}
            </Button>
            <Button type="button" disabled={create.isPending} onClick={submitOrg}>
              {create.isPending ? t("eventMe.organization.saving") : t("eventMe.organization.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
