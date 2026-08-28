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
import {
  Activity,
  Camera,
  Loader2,
  Mail,
  Plus,
  RefreshCw,
  Share2,
  Trash2,
  UserRound,
  X,
} from "lucide-react";

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
  ProfileHeroFrame,
  ProfileIdentityBlock,
  ProfileIdentityLine,
  ProfileNameRow,
  ProfileSectionCard,
} from "@/components/profile/shell/ProfileShell";
import { useCompanyBrand } from "@/lib/crm/useCompanyBrand";
import { OrganizationPicker } from "./OrganizationPicker";
import { MAX_INTENT_BULLETS, parseIntentBullets } from "./IntentBulletList";
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
  company_id: string;
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
    company_id: profile?.companyId ?? "",
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

// Sekcja formularza = KARTA SEKCJI PROFILU PUBLICZNEGO. Ten sam nagłówek
// (11px, uppercase, ikona w kolorze primary) co na `/profile`, żeby tryb edycji
// na wydarzeniu i strona publiczna wyglądały jak jeden produkt.
function Section({
  icon,
  title,
  hint,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <ProfileSectionCard icon={icon} title={title}>
      {hint !== undefined && <p className="-mt-1 mb-3 text-xs text-muted-foreground">{hint}</p>}
      <div className="space-y-3">{children}</div>
    </ProfileSectionCard>
  );
}

// „Czego szukam / Co oferuję" trzymamy w bazie jako tekst z nowymi liniami,
// a uczestnik edytuje je jak listę punktów - maksymalnie 5, każda linia to
// jeden punkt widoczny potem jako bullet w katalogu uczestników.
const MAX_BULLETS = MAX_INTENT_BULLETS;

const parseBullets = parseIntentBullets;

function BulletListInput({
  value,
  onChange,
  placeholder,
  addLabel,
  limitLabel,
  ariaLabel,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  addLabel: string;
  limitLabel: string;
  ariaLabel: string;
}) {
  const items = parseBullets(value);
  const commit = (next: string[]) => onChange(next.join("\n"));
  // DRAFT NOWEGO PUNKTU: parseBullets odfiltrowuje puste linie, więc dopisanie
  // "" do wartości ginęło przy re-renderze i „Dodaj punkt" wyglądał na martwy.
  // Nowy punkt żyje w lokalnym drafcie, a trafia do wartości dopiero po
  // wpisaniu pierwszego znaku.
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <div className="space-y-1.5" aria-label={ariaLabel}>
      {items.map((item, index) => (
        <div key={index} className="flex items-center gap-1.5">
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/60"
            aria-hidden="true"
          />
          <input
            type="text"
            value={item}
            placeholder={placeholder}
            aria-label={`${ariaLabel} ${index + 1}`}
            className="h-8 min-w-0 flex-1 rounded-[6px] border border-border bg-background px-2.5 text-sm outline-none focus:border-primary"
            onChange={(event) =>
              commit(items.map((current, i) => (i === index ? event.target.value : current)))
            }
          />
          <button
            type="button"
            onClick={() => commit(items.filter((_, i) => i !== index))}
            aria-label={`${ariaLabel} ${index + 1} - usuń`}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-[6px] text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      ))}
      {items.length < MAX_BULLETS ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          onClick={() => commit([...items, ""])}
        >
          <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
          {addLabel}
        </Button>
      ) : (
        <p className="text-[11px] text-muted-foreground">{limitLabel}</p>
      )}
    </div>
  );
}

export function MyEventProfileForm({ slug, profile, account, loading }: Props) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  // JEZYK TRESCI (PL/EN) jest niezalezny od jezyka interfejsu - uzytkownik
  // uzupelnia obie wersje wpisu przelacznikiem nad formularzem.
  const [contentLang, setContentLang] = useState<"pl" | "en">(lang === "en" ? "en" : "pl");
  const en = contentLang === "en";

  const save = useSaveMyEventProfile(slug);
  const sync = useSyncMyEventProfileFromAccount(slug);
  const { user, tenantId } = useAuth();
  const registerUpload = useServerFn(registerMediaUpload);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [form, setForm] = useState<FormState>(() => toForm(profile));
  // ZAPIS WSTECZ DO KONTA JEST DECYZJA UZYTKOWNIKA, nie efektem ubocznym:
  // kartoteka wydarzenia bywa celowo inna niz wizytowka platformy.
  const accountOnly = profile === null && account !== null;
  const editableProfile: MyEventProfile | null =
    profile ??
    (account === null
      ? null
      : {
          personId: "account",
          firstName: account.firstName,
          lastName: account.lastName,
          email: account.email,
          phone: account.phone,
          emailVisible: false,
          phoneVisible: false,
          jobTitle: account.jobTitle,
          companyId: account.companyId,
          companyText: account.companyText,
          industry: null,
          specialization: account.specialization,
          seekingPl: account.seekingPl,
          seekingEn: account.seekingEn,
          offeringPl: account.offeringPl,
          offeringEn: account.offeringEn,
          socialProfileUrl: null,
          socialLinks: account.socialLinks,
          photoUrl: account.photoUrl,
          bioPl: account.bioPl,
          bioEn: account.bioEn,
        });
  const [pushAccount, setPushAccount] = useState(accountOnly);

  // Serwer jest źródłem prawdy: gdy dane dojadą (albo odświeżą się po zapisie),
  // formularz przejmuje ich wersję. `personId` w zależności zamiast obiektu -
  // nie chcemy nadpisywać wpisywanego tekstu przy każdym refetchu tej samej treści.
  useEffect(() => {
    setForm(toForm(editableProfile));
    if (profile === null && account !== null) setPushAccount(true);
  }, [editableProfile?.personId, profile, account]);

  // Linia tożsamości w trybie edycji korzysta z tego samego brandu CRM co
  // profil publiczny - dzięki temu nagłówek wygląda identycznie w obu miejscach.
  const brand = useCompanyBrand(form.company_text.trim() === "" ? null : form.company_text);

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
      { ...form, social_links: links, push_account: pushAccount },
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

  if (editableProfile === null) {
    return (
      <p className="rounded-[6px] border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
        {t("eventMe.noPerson")}
      </p>
    );
  }

  const heroName = [form.first_name, form.last_name].filter((part) => part.trim() !== "").join(" ");

  return (
    <form onSubmit={onSubmit} className="space-y-4" aria-label={t("eventMe.profileFormAria")}>
      {/* HERO - ten sam układ co profil publiczny: okładka + nachodzący awatar.
          Upuszczenie pliku na awatar podmienia zdjęcie (bez pola z adresem URL). */}
      <div
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
        <ProfileHeroFrame
          avatarUrl={form.photo_url.trim() === "" ? null : form.photo_url}
          fullName={heroName === "" ? t("eventMe.publicPreview.noName") : heroName}
          emptyCoverHint={t("eventMe.photo.hint")}
          avatarOverlay={
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              aria-label={t("eventMe.photo.upload")}
              className={`absolute inset-0 inline-flex flex-col items-center justify-center gap-1 rounded-[7px] bg-black/55 text-white backdrop-blur-[2px] transition-opacity ${
                uploading || dragOver ? "opacity-100" : "opacity-0 hover:opacity-100"
              }`}
            >
              {uploading ? (
                <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
              ) : (
                <Camera className="h-5 w-5" aria-hidden="true" />
              )}
              <span className="text-[10px] font-medium uppercase tracking-wide">
                {t("eventMe.photo.upload")}
              </span>
            </button>
          }
        />
      </div>

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

      {/* TOZSAMOSC - dokladnie ten sam uklad co na profilu publicznym:
          imie i nazwisko + linia „organizacja • stanowisko" z logotypem. */}
      <ProfileIdentityBlock>
        <ProfileNameRow name={heroName === "" ? t("eventMe.publicPreview.noName") : heroName} />
        <ProfileIdentityLine
          companyLogoUrl={brand.data?.logoUrl ?? null}
          companyName={form.company_text.trim() === "" ? null : form.company_text}
          companyHref={brand.data?.website ?? null}
          jobTitle={form.job_title.trim() === "" ? null : form.job_title}
        />
      </ProfileIdentityBlock>

      {/* PRZELACZNIK JEZYKA TRESCI - dotyczy calego formularza (opis, czego szukam,
          co oferuje). Nie zmienia jezyka interfejsu, tylko edytowana wersje wpisu.
          Sticky, zeby byl widoczny takze przy dlugim opisie. */}
      <div className="sticky top-2 z-10 mt-3 flex items-center justify-center gap-2 rounded-[6px] border border-border bg-background/95 px-3 py-2 backdrop-blur sm:justify-start">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {t("eventMe.contentLang.label")}
        </span>
        <div
          role="group"
          aria-label={t("eventMe.contentLang.label")}
          className="inline-flex overflow-hidden rounded-[6px] border border-border"
        >
          {(["pl", "en"] as const).map((code) => (
            <button
              key={code}
              type="button"
              aria-pressed={contentLang === code}
              onClick={() => setContentLang(code)}
              className={`px-3 py-1 text-xs font-semibold uppercase tracking-wide transition-colors ${
                contentLang === code
                  ? "bg-primary text-primary-foreground"
                  : "bg-transparent text-muted-foreground hover:bg-muted"
              }`}
            >
              {code}
            </button>
          ))}
        </div>
      </div>


      <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">

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

      <Section
        icon={<UserRound className="h-3.5 w-3.5" />}
        title={t("eventMe.sections.identity")}
        hint={t("eventMe.sections.identityHint")}
      >
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
          <OrganizationPicker
            label={t("eventMe.fields.company")}
            companyId={form.company_id || null}
            value={form.company_text}
            onChange={(company) =>
              setForm((prev) => ({
                ...prev,
                company_id: company.id ?? "",
                company_text: company.name,
              }))
            }
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

      <Section
        icon={<Mail className="h-3.5 w-3.5" />}
        title={t("eventMe.sections.contact")}
        hint={t("eventMe.sections.contactHint")}
      >
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

      <Section
        icon={<Share2 className="h-3.5 w-3.5" />}
        title={t("eventMe.sections.social")}
        hint={t("eventMe.sections.socialHint")}
      >
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

      <Section
        icon={<Activity className="h-3.5 w-3.5" />}
        title={t("eventMe.sections.about")}
        hint={t("eventMe.sections.aboutHint")}
      >
        <div className="space-y-1.5">
          <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {en ? t("eventMe.fields.bioEn") : t("eventMe.fields.bioPl")}
          </label>
          <Textarea
            rows={12}
            /* `data-multiline` wymusza wyjątek od globalnej reguły
               `.admin-compact textarea` (30 px !important), która ścinała pole
               do jednej linii w studiu i panelu; inline min-height pilnuje
               wysokości poza adminem. */
            data-multiline="true"
            style={{ minHeight: "320px" }}
            className="rounded-[6px] leading-relaxed"
            value={en ? form.bio_en : form.bio_pl}
            onChange={field(en ? "bio_en" : "bio_pl")}
            placeholder={t("eventMe.fields.bioHint")}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("eventMe.fields.seeking")}
            </label>
            <BulletListInput
              value={en ? form.seeking_en : form.seeking_pl}
              onChange={(next) =>
                setForm((prev) => ({ ...prev, [en ? "seeking_en" : "seeking_pl"]: next }))
              }
              placeholder={t("eventMe.fields.bulletPlaceholder")}
              addLabel={t("eventMe.fields.addBullet")}
              limitLabel={t("eventMe.fields.bulletLimit")}
              ariaLabel={t("eventMe.fields.seeking")}
            />
            <p className="text-[11px] text-muted-foreground">{t("eventMe.fields.seekingHint")}</p>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("eventMe.fields.offering")}
            </label>
            <BulletListInput
              value={en ? form.offering_en : form.offering_pl}
              onChange={(next) =>
                setForm((prev) => ({ ...prev, [en ? "offering_en" : "offering_pl"]: next }))
              }
              placeholder={t("eventMe.fields.bulletPlaceholder")}
              addLabel={t("eventMe.fields.addBullet")}
              limitLabel={t("eventMe.fields.bulletLimit")}
              ariaLabel={t("eventMe.fields.offering")}
            />
            <p className="text-[11px] text-muted-foreground">{t("eventMe.fields.offeringHint")}</p>
          </div>
        </div>
      </Section>

      <div className="flex items-start gap-3 rounded-[6px] border border-border bg-card p-4">
        <Switch
          id="event-profile-push-account"
          checked={pushAccount}
          disabled={accountOnly}
          onCheckedChange={setPushAccount}
        />
        <label htmlFor="event-profile-push-account" className="min-w-0 space-y-1">
          <span className="block text-sm font-semibold">{t("eventMe.pushAccount")}</span>
          <span className="block text-xs text-muted-foreground">
            {t("eventMe.pushAccountHint")}
          </span>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" disabled={save.isPending}>
          {save.isPending ? t("eventMe.saving") : t("eventMe.save")}
        </Button>
        <span className="text-xs text-muted-foreground">{t("eventMe.saveHint")}</span>
      </div>
    </form>
  );
}
