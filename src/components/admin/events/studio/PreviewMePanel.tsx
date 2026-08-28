// Podglad studia: PRYWATNA ZAKLADKA UCZESTNIKA („Moj profil").
//
// PIERWSZENSTWO MA WLASNA KARTOTEKA REDAKTORA. Podglad pyta `event_my_event_profile`
// o TOZSAMOSC ZALOGOWANEGO (to jedyna tozsamosc, ktora RPC w ogole oddaje);
// gdy redaktor ma juz kartoteke na tym wydarzeniu - widzi swoje dane, gdy nie
// ma - jego profil platformy (`account`), a dopiero przy braku obu wchodzi
// rysunek przykladowy. Dzieki temu superadmin edytujacy szkic widzi SIEBIE,
// a nie „Anne Kowalska".
//
// DLACZEGO NIE CALY `EventMePanel`. Panel uczestnika czyta
// tozsamosc wolajacego (`event_my_event_profile`, `event_my_agenda`,
// zaproszenia 1-1) - w szkicu niezapisanego wydarzenia nie ma ani jednego
// wiersza, a redaktor nie ma prawa ogladac cudzych danych. Podglad pokazuje
// wiec ORGANIZATOROWI dokladnie te powierzchnie, ktore dostanie uczestnik:
// przelaczalne zakladki, liste pol, ktorymi uczestnik zarzadza, oraz karte
// „tak widza Cie inni" renderowana TYM SAMYM komponentem co produkcja.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Eye, EyeOff } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { MyEventPublicPreview } from "@/components/events/participant/molecules/MyEventPublicPreview";
import { useAuth } from "@/hooks/useAuth";
import { useMyEventProfile } from "@/lib/events/useMyEventPanel";
import type { MyAccountSnapshot, MyEventProfile } from "@/lib/events/myEventProfileApi";

const CARD = "rounded-[6px] border border-border bg-card p-4";

type TabKey = "profile" | "schedule" | "contacts" | "networking" | "registration";

/** Przykladowa kartoteka - wylacznie do rysunku w studiu, nigdy nie zapisywana. */
function demoProfile(en: boolean): MyEventProfile {
  return {
    personId: "preview",
    firstName: "Anna",
    lastName: "Kowalska",
    email: "anna.kowalska@example.org",
    phone: "+48 600 000 000",
    emailVisible: true,
    phoneVisible: false,
    jobTitle: en ? "Policy Director" : "Dyrektorka ds. polityk publicznych",
    companyText: "New European Strategies",
    industry: en ? "Public affairs" : "Public affairs",
    specialization: en ? "EU energy policy" : "Polityka energetyczna UE",
    seekingPl: "Partnerów do projektu o bezpieczeństwie energetycznym CEE.",
    seekingEn: "Partners for a CEE energy security project.",
    offeringPl: "Dane, analizy i kontakty w instytucjach UE.",
    offeringEn: "Data, analysis and contacts across EU institutions.",
    socialProfileUrl: null,
    socialLinks: {
      linkedin: "https://www.linkedin.com/in/example",
      website: "https://neweuropeanstrategies.com",
    },
    photoUrl: null,
    bioPl: "Zajmuję się polityką energetyczną i bezpieczeństwem regionu CEE.",
    bioEn: "I work on energy policy and CEE regional security.",
  };
}

/** Profil platformy w ksztalcie kartoteki - widok, nie zapis. */
function profileFromAccount(account: MyAccountSnapshot): MyEventProfile {
  return {
    personId: "account",
    firstName: account.firstName,
    lastName: account.lastName,
    email: account.email,
    phone: account.phone,
    // KONTAKT DOMYSLNIE PRYWATNY - zgody zyja w kartotece wydarzenia, a tej
    // jeszcze nie ma; podglad nie moze sugerowac zgody, ktorej nikt nie wydal.
    emailVisible: false,
    phoneVisible: false,
    jobTitle: account.jobTitle,
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
  };
}

export function PreviewMePanel({ slug }: { slug: string }) {
  const { t, i18n } = useTranslation();
  const en = i18n.language.startsWith("en");
  const { session } = useAuth();
  const [tab, setTab] = useState<TabKey>("profile");
  const [publicView, setPublicView] = useState(false);
  // Zapytanie idzie tylko wtedy, gdy szkic ma juz adres publiczny - RPC bramkuje
  // pusty slug wyjatkiem, a podglad nie ma prawa wywrocic sie na szkicu bez adresu.
  const panel = useMyEventProfile(slug, Boolean(session) && slug.trim() !== "");
  const real = panel.data?.profile ?? null;
  const account = panel.data?.account ?? null;
  const profile = useMemo(
    () => real ?? (account !== null ? profileFromAccount(account) : demoProfile(en)),
    [real, account, en],
  );
  const source: "person" | "account" | "demo" =
    real !== null ? "person" : account !== null ? "account" : "demo";

  const tabs: { key: TabKey; label: string; hint: string }[] = [
    { key: "profile", label: t("eventMe.tabs.profile"), hint: t("eventMe.profileHint") },
    { key: "schedule", label: t("eventMe.tabs.schedule"), hint: t("eventMe.agendaEmpty") },
    { key: "contacts", label: t("eventMe.tabs.contacts"), hint: t("eventMe.contactsEmpty") },
    { key: "networking", label: t("eventMe.tabs.networking"), hint: t("eventMe.networkingHint") },
    {
      key: "registration",
      label: t("eventMe.tabs.registration"),
      hint: t("eventMe.registrationHint"),
    },
  ];

  const active = tabs.find((item) => item.key === tab) ?? tabs[0];

  // Lista pol, ktorymi uczestnik realnie zarzadza w formularzu produkcyjnym.
  const fields: { label: string; value: string | null; visibility?: boolean }[] = [
    { label: t("eventMe.fields.firstName"), value: profile.firstName },
    { label: t("eventMe.fields.lastName"), value: profile.lastName },
    { label: t("eventMe.fields.jobTitle"), value: profile.jobTitle },
    { label: t("eventMe.fields.company"), value: profile.companyText },
    { label: t("eventMe.fields.industry"), value: profile.industry },
    { label: t("eventMe.fields.specialization"), value: profile.specialization },
    { label: t("eventMe.fields.email"), value: profile.email, visibility: profile.emailVisible },
    { label: t("eventMe.fields.phone"), value: profile.phone, visibility: profile.phoneVisible },
    {
      label: t("eventMe.fields.seeking"),
      value: en ? profile.seekingEn : profile.seekingPl,
    },
    {
      label: t("eventMe.fields.offering"),
      value: en ? profile.offeringEn : profile.offeringPl,
    },
    {
      label: t("eventMe.sections.social"),
      value: Object.values(profile.socialLinks).filter(Boolean).join(" · "),
    },
    { label: t("eventMe.fields.bioPl"), value: en ? profile.bioEn : profile.bioPl },
  ];

  return (
    <section className="space-y-4">
      <header className="space-y-1">
        <p className="text-base font-bold">{t("eventMe.title")}</p>
        <p className="text-sm text-muted-foreground">{t("eventMe.lead")}</p>
      </header>

      <ul role="tablist" className="flex flex-wrap gap-2">
        {tabs.map((item) => (
          <li key={item.key}>
            <button
              type="button"
              role="tab"
              aria-selected={item.key === tab}
              onClick={() => setTab(item.key)}
              className={cn(
                "inline-flex items-center rounded-[6px] border px-3 py-1.5 text-sm transition-colors",
                item.key === tab
                  ? "border-transparent bg-foreground text-background"
                  : "border-border text-muted-foreground hover:border-foreground/40",
              )}
            >
              {item.label}
            </button>
          </li>
        ))}
      </ul>

      <div className={CARD}>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          {source === "demo"
            ? t("eventMe.previewSource.demo")
            : source === "account"
              ? t("eventMe.previewSource.account")
              : t("eventMe.previewSource.person")}
        </p>
        <p className="mt-1 text-sm font-semibold">{active.label}</p>
        <p className="mt-1 text-sm text-muted-foreground">{active.hint}</p>
      </div>

      {tab === "profile" && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="rounded-[6px]"
              onClick={() => setPublicView((value) => !value)}
            >
              {publicView ? (
                <EyeOff className="mr-2 h-4 w-4" aria-hidden="true" />
              ) : (
                <Eye className="mr-2 h-4 w-4" aria-hidden="true" />
              )}
              {publicView ? t("eventMe.publicPreview.close") : t("eventMe.publicPreview.open")}
            </Button>
          </div>

          {publicView ? (
            <>
              <p className="text-xs text-muted-foreground">{t("eventMe.publicPreview.hint")}</p>
              <MyEventPublicPreview profile={profile} />
            </>
          ) : (
            <ul className="space-y-2">
              {fields.map((field) => (
                <li
                  key={field.label}
                  className="flex items-start justify-between gap-3 rounded-[6px] border border-border bg-card px-4 py-3"
                >
                  <span className="min-w-0">
                    <span className="block text-xs uppercase tracking-wide text-muted-foreground">
                      {field.label}
                    </span>
                    <span className="block text-sm">
                      {field.value === null || field.value === ""
                        ? t("eventMe.publicPreview.empty")
                        : field.value}
                    </span>
                  </span>
                  {field.visibility !== undefined && (
                    <span
                      className={cn(
                        "shrink-0 rounded-[6px] border px-2 py-0.5 text-xs",
                        field.visibility
                          ? "border-primary/40 bg-primary/10 text-primary"
                          : "border-border text-muted-foreground",
                      )}
                    >
                      {field.visibility
                        ? t("eventMe.fields.emailVisible")
                        : t("eventMe.publicPreview.contactHidden")}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}

          <p className="text-xs text-muted-foreground">{t("eventMe.saveHint")}</p>
        </div>
      )}
    </section>
  );
}
