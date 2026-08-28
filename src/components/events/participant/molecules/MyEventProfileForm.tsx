// Molekuła: FORMULARZ MOJEGO PROFILU NA WYDARZENIU.
//
// ZAPIS IDZIE PROSTO DO KARTOTEKI WYDARZENIA (`event_people`), nie do profilu
// platformy. To celowe: uczestnik chce inaczej podpisać się na konferencji
// (inna rola, inna firma) niż w redakcyjnym profilu, a organizator drukuje
// identyfikatory właśnie z kartoteki wydarzenia. Przycisk „Uzupełnij z konta"
// przenosi dane z profilu platformy, gdy uczestnik nie chce pisać dwa razy.
//
// PUSTE POLE = WYCZYSZCZENIE. Wysyłamy każdy klucz, który użytkownik widzi na
// ekranie, więc skasowanie treści realnie usuwa dane - bez „duchów" z importu.
//
// KONTAKT JEST DOMYŚLNIE PRYWATNY. E-mail i telefon trafiają do katalogu
// uczestników wyłącznie po włączeniu przełącznika widoczności - milczenie
// znaczy „nie pokazuj".
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ImagePlus, Loader2, RefreshCw, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { FieldBox } from "@/components/ui/field-box";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { registerMediaUpload } from "@/lib/media.functions";
import { IMAGE_ACCEPT_ATTR, IMAGE_MIME, uploadAndRegisterMedia } from "@/lib/media/upload";
import { uiLang } from "@/lib/i18n/format";
import {
  SOCIAL_KEYS,
  type MyAccountSnapshot,
  type MyEventProfile,
  type SocialKey,
  type SocialLinks,
} from "@/lib/events/myEventProfileApi";
import {
  useSaveMyEventProfile,
  useSyncMyEventProfileFromAccount,
} from "@/lib/events/useMyEventPanel";

interface Props {
  slug: string;
  profile: MyEventProfile | null;
  account: MyAccountSnapshot | null;
  loading: boolean;
}

interface FormState {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  email_visible: boolean;
  phone_visible: boolean;
  job_title: string;
  company_text: string;
  industry: string;
  specialization: string;
  seeking_pl: string;
  seeking_en: string;
  offering_pl: string;
  offering_en: string;
  photo_url: string;
  bio_pl: string;
  bio_en: string;
  social_links: SocialLinks;
}

const SOCIAL_PLACEHOLDER: Record<SocialKey, string> = {
  linkedin: "https://www.linkedin.com/in/...",
  x: "https://x.com/...",
  facebook: "https://www.facebook.com/...",
  instagram: "https://www.instagram.com/...",
  youtube: "https://www.youtube.com/@...",
  website: "https://...",
};

function toForm(profile: MyEventProfile | null): FormState {
  return {
    first_name: profile?.firstName ?? "",
    last_name: profile?.lastName ?? "",
    email: profile?.email ?? "",
    phone: profile?.phone ?? "",
    email_visible: profile?.emailVisible ?? false,
    phone_visible: profile?.phoneVisible ?? false,
    job_title: profile?.jobTitle ?? "",
    company_text: profile?.companyText ?? "",
    industry: profile?.industry ?? "",
    specialization: profile?.specialization ?? "",
    seeking_pl: profile?.seekingPl ?? "",
    seeking_en: profile?.seekingEn ?? "",
    offering_pl: profile?.offeringPl ?? "",
    offering_en: profile?.offeringEn ?? "",
    photo_url: profile?.photoUrl ?? "",
    bio_pl: profile?.bioPl ?? "",
    bio_en: profile?.bioEn ?? "",
    social_links: { ...(profile?.socialLinks ?? {}) },
  };
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[6px] border border-border bg-card p-4 sm:p-5 space-y-4">
      <header className="space-y-1">
        <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
        {hint !== undefined && <p className="text-xs text-muted-foreground">{hint}</p>}
      </header>
      {children}
    </section>
  );
}

export function MyEventProfileForm({ slug, profile, account, loading }: Props) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const en = lang === "en";
  const save = useSaveMyEventProfile(slug);
  const sync = useSyncMyEventProfileFromAccount(slug);
  const { user, tenantId } = useAuth();
  const registerUpload = useServerFn(registerMediaUpload);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [form, setForm] = useState<FormState>(() => toForm(profile));

  // Serwer jest źródłem prawdy: gdy dane dojadą (albo odświeżą się po zapisie),
  // formularz przejmuje ich wersję. `personId` w zależności zamiast obiektu -
  // nie chcemy nadpisywać wpisywanego tekstu przy każdym refetchu tej samej treści.
  useEffect(() => {
    setForm(toForm(profile));
  }, [profile?.personId, profile]);

  const field = (key: keyof FormState) => (event: { target: { value: string } }) => {
    setForm((prev) => ({ ...prev, [key]: event.target.value }));
  };

  const toggle = (key: "email_visible" | "phone_visible") => (checked: boolean) => {
    setForm((prev) => ({ ...prev, [key]: checked }));
  };

  const socialField = (key: SocialKey) => (event: { target: { value: string } }) => {
    setForm((prev) => ({
      ...prev,
      social_links: { ...prev.social_links, [key]: event.target.value },
    }));
  };

  const handleFile = async (file: File): Promise<void> => {
    if (tenantId === null || tenantId === undefined || user?.id === undefined) {
      toast.error(t("eventMe.photo.failed"));
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
        subfolder: "event-people",
      });
      setForm((prev) => ({ ...prev, photo_url: uploaded.publicUrl }));
    } catch (error) {
      toast.error(`${t("eventMe.photo.failed")} ${(error as Error).message}`.trim());
    } finally {
      setUploading(false);
      if (fileRef.current !== null) fileRef.current.value = "";
    }
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // Puste linki znikają - baza trzyma wyłącznie adresy, które da się kliknąć.
    const links: SocialLinks = {};
    for (const key of SOCIAL_KEYS) {
      const value = (form.social_links[key] ?? "").trim();
      if (value !== "") links[key] = value;
    }
    save.mutate(
      { ...form, social_links: links },
      {
        onSuccess: () => toast.success(t("eventMe.profileSaved")),
        onError: (error) => toast.error(`${t("eventMe.profileSaveError")} ${error.message}`.trim()),
      },
    );
  };

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24 w-full rounded-[6px]" />
        <Skeleton className="h-40 w-full rounded-[6px]" />
        <Skeleton className="h-40 w-full rounded-[6px]" />
      </div>
    );
  }

  if (profile === null) {
    return (
      <p className="rounded-[6px] border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
        {t("eventMe.noPerson")}
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" aria-label={t("eventMe.profileFormAria")}>
      <Section title={t("eventMe.sections.identity")} hint={t("eventMe.sections.identityHint")}>
        <div className="flex flex-col gap-4 sm:flex-row">
          <div
            className={`relative flex h-28 w-28 shrink-0 items-center justify-center overflow-hidden rounded-[6px] border border-dashed bg-muted/30 ${
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
              if (file !== undefined) void handleFile(file);
            }}
          >
            {form.photo_url.trim() !== "" ? (
              <img
                src={form.photo_url}
                alt={t("eventMe.photo.alt")}
                className="h-full w-full object-cover"
              />
            ) : (
              <ImagePlus className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
            )}
            {uploading && (
              <span className="absolute inset-0 grid place-items-center bg-background/70">
                <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
              </span>
            )}
          </div>

          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                accept={IMAGE_ACCEPT_ATTR}
                className="sr-only"
                aria-label={t("eventMe.photo.upload")}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file !== undefined) void handleFile(file);
                }}
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={uploading}
                onClick={() => fileRef.current?.click()}
              >
                {t("eventMe.photo.upload")}
              </Button>
              {form.photo_url.trim() !== "" && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setForm((prev) => ({ ...prev, photo_url: "" }))}
                >
                  <Trash2 className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  {t("eventMe.photo.remove")}
                </Button>
              )}
              {account !== null && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={sync.isPending}
                  onClick={() =>
                    sync.mutate(undefined, {
                      onSuccess: () => toast.success(t("eventMe.syncDone")),
                      onError: () => toast.error(t("eventMe.syncError")),
                    })
                  }
                >
                  <RefreshCw className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  {sync.isPending ? t("eventMe.syncing") : t("eventMe.syncFromAccount")}
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{t("eventMe.photo.hint")}</p>
            <FieldBox
              label={t("eventMe.fields.photoUrl")}
              value={form.photo_url}
              onChange={field("photo_url")}
              inputMode="url"
            />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <FieldBox
            label={t("eventMe.fields.firstName")}
            value={form.first_name}
            onChange={field("first_name")}
            autoComplete="given-name"
          />
          <FieldBox
            label={t("eventMe.fields.lastName")}
            value={form.last_name}
            onChange={field("last_name")}
            autoComplete="family-name"
          />
          <FieldBox
            label={t("eventMe.fields.jobTitle")}
            value={form.job_title}
            onChange={field("job_title")}
            autoComplete="organization-title"
          />
          <FieldBox
            label={t("eventMe.fields.company")}
            value={form.company_text}
            onChange={field("company_text")}
            autoComplete="organization"
          />
          <FieldBox
            label={t("eventMe.fields.industry")}
            value={form.industry}
            onChange={field("industry")}
          />
          <FieldBox
            label={t("eventMe.fields.specialization")}
            value={form.specialization}
            onChange={field("specialization")}
          />
        </div>
      </Section>

      <Section title={t("eventMe.sections.contact")} hint={t("eventMe.sections.contactHint")}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <FieldBox
              label={t("eventMe.fields.email")}
              value={form.email}
              onChange={field("email")}
              inputMode="email"
              autoComplete="email"
            />
            <label className="flex items-center justify-between gap-3 rounded-[6px] border border-border px-3 py-2">
              <span className="text-xs text-muted-foreground">
                {t("eventMe.fields.emailVisible")}
              </span>
              <Switch
                checked={form.email_visible}
                onCheckedChange={toggle("email_visible")}
                aria-label={t("eventMe.fields.emailVisible")}
              />
            </label>
          </div>
          <div className="space-y-2">
            <FieldBox
              label={t("eventMe.fields.phone")}
              value={form.phone}
              onChange={field("phone")}
              inputMode="tel"
              autoComplete="tel"
            />
            <label className="flex items-center justify-between gap-3 rounded-[6px] border border-border px-3 py-2">
              <span className="text-xs text-muted-foreground">
                {t("eventMe.fields.phoneVisible")}
              </span>
              <Switch
                checked={form.phone_visible}
                onCheckedChange={toggle("phone_visible")}
                aria-label={t("eventMe.fields.phoneVisible")}
              />
            </label>
          </div>
        </div>
      </Section>

      <Section title={t("eventMe.sections.social")} hint={t("eventMe.sections.socialHint")}>
        <div className="grid gap-3 sm:grid-cols-2">
          {SOCIAL_KEYS.map((key) => (
            <FieldBox
              key={key}
              label={t(`eventMe.social.${key}`)}
              value={form.social_links[key] ?? ""}
              onChange={socialField(key)}
              inputMode="url"
              placeholder={SOCIAL_PLACEHOLDER[key]}
            />
          ))}
        </div>
      </Section>

      <Section title={t("eventMe.sections.about")} hint={t("eventMe.sections.aboutHint")}>
        <div className="space-y-2">
          <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {en ? t("eventMe.fields.bioEn") : t("eventMe.fields.bioPl")}
          </label>
          <Textarea
            rows={4}
            className="rounded-[6px]"
            value={en ? form.bio_en : form.bio_pl}
            onChange={field(en ? "bio_en" : "bio_pl")}
            placeholder={t("eventMe.fields.bioHint")}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("eventMe.fields.seeking")}
            </label>
            <Textarea
              rows={3}
              className="rounded-[6px]"
              value={en ? form.seeking_en : form.seeking_pl}
              onChange={field(en ? "seeking_en" : "seeking_pl")}
              placeholder={t("eventMe.fields.seekingHint")}
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("eventMe.fields.offering")}
            </label>
            <Textarea
              rows={3}
              className="rounded-[6px]"
              value={en ? form.offering_en : form.offering_pl}
              onChange={field(en ? "offering_en" : "offering_pl")}
              placeholder={t("eventMe.fields.offeringHint")}
            />
          </div>
        </div>
      </Section>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" disabled={save.isPending}>
          {save.isPending ? t("eventMe.saving") : t("eventMe.save")}
        </Button>
        <span className="text-xs text-muted-foreground">{t("eventMe.saveHint")}</span>
      </div>
    </form>
  );
}
