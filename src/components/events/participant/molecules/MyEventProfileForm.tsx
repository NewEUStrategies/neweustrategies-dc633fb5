// Molekuła: FORMULARZ MOJEGO PROFILU NA WYDARZENIU.
//
// ZAPIS IDZIE PROSTO DO KARTOTEKI WYDARZENIA (`event_people`), nie do profilu
// platformy. To celowe: uczestnik chce inaczej podpisać się na konferencji
// (inna rola, inna firma) niż w redakcyjnym profilu, a organizator drukuje
// identyfikatory właśnie z kartoteki wydarzenia.
//
// PUSTE POLE = WYCZYSZCZENIE. Wysyłamy każdy klucz, który użytkownik widzi na
// ekranie, więc skasowanie treści realnie usuwa dane - bez „duchów" z importu.
import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { FieldBox } from "@/components/ui/field-box";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { uiLang } from "@/lib/i18n/format";
import type { MyEventProfile } from "@/lib/events/myEventProfileApi";
import { useSaveMyEventProfile } from "@/lib/events/useMyEventPanel";

interface Props {
  slug: string;
  profile: MyEventProfile | null;
  loading: boolean;
}

interface FormState {
  first_name: string;
  last_name: string;
  phone: string;
  job_title: string;
  company_text: string;
  social_profile_url: string;
  bio_pl: string;
  bio_en: string;
}

function toForm(profile: MyEventProfile | null): FormState {
  return {
    first_name: profile?.firstName ?? "",
    last_name: profile?.lastName ?? "",
    phone: profile?.phone ?? "",
    job_title: profile?.jobTitle ?? "",
    company_text: profile?.companyText ?? "",
    social_profile_url: profile?.socialProfileUrl ?? "",
    bio_pl: profile?.bioPl ?? "",
    bio_en: profile?.bioEn ?? "",
  };
}

export function MyEventProfileForm({ slug, profile, loading }: Props) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const save = useSaveMyEventProfile(slug);
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

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    save.mutate(form, {
      onSuccess: () => toast.success(t("eventMe.profileSaved")),
      onError: () => toast.error(t("eventMe.profileSaveError")),
    });
  };

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-11 w-full rounded-[6px]" />
        <Skeleton className="h-11 w-full rounded-[6px]" />
        <Skeleton className="h-24 w-full rounded-[6px]" />
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
          label={t("eventMe.fields.phone")}
          value={form.phone}
          onChange={field("phone")}
          inputMode="tel"
          autoComplete="tel"
        />
        <FieldBox
          label={t("eventMe.fields.social")}
          value={form.social_profile_url}
          onChange={field("social_profile_url")}
          inputMode="url"
          placeholder="https://www.linkedin.com/in/..."
        />
      </div>

      <div className="space-y-2">
        <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {lang === "en" ? t("eventMe.fields.bioEn") : t("eventMe.fields.bioPl")}
        </label>
        <Textarea
          rows={4}
          className="rounded-[6px]"
          value={lang === "en" ? form.bio_en : form.bio_pl}
          onChange={field(lang === "en" ? "bio_en" : "bio_pl")}
          placeholder={t("eventMe.fields.bioHint")}
        />
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={save.isPending}>
          {save.isPending ? t("eventMe.saving") : t("eventMe.save")}
        </Button>
        <span className="text-xs text-muted-foreground">{t("eventMe.saveHint")}</span>
      </div>
    </form>
  );
}
