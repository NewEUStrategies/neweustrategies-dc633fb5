// Molekuła: tytuł sekcji sponsorów (PL/EN) w bocznym panelu sekcji.
//
// STAN STARTUJE Z PROPSÓW I NIE JEST Z NIMI SYNCHRONIZOWANY. Rodzic montuje
// molekułę z `key={tier.id}`, więc inna sekcja = nowy formularz z jej tytułami.
// Wcześniej panel przepisywał tytuły efektem zależnym od obiektu wiersza sekcji,
// a ten obiekt jest NOWY po każdym odświeżeniu listy sekcji (zmiana układu,
// zapis przekierowania, usunięcie logotypu) - tekst wpisany, a niezapisany,
// znikał pod ręką organizatora.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import "@/lib/i18n-admin-event-sponsor-board";

export interface SponsorSectionTitles {
  namePl: string;
  nameEn: string;
}

export function SponsorSectionTitleForm({
  initialNamePl,
  initialNameEn,
  isSaving,
  onSave,
}: {
  initialNamePl: string;
  initialNameEn: string;
  isSaving: boolean;
  /** Oba tytuły przycięte; brakujący język dostaje tytuł z drugiego. */
  onSave: (titles: SponsorSectionTitles) => void;
}) {
  const { t } = useTranslation();
  const [namePl, setNamePl] = useState(initialNamePl);
  const [nameEn, setNameEn] = useState(initialNameEn);

  return (
    <form
      className="mt-6 space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const pl = namePl.trim();
        const en = nameEn.trim();
        if (pl === "" && en === "") return;
        onSave({ namePl: pl || en, nameEn: en || pl });
      }}
    >
      <div className="space-y-1">
        <Label htmlFor="drawer-title-pl">{t("sponsorBoard.add.titlePl")}</Label>
        <Input
          id="drawer-title-pl"
          value={namePl}
          maxLength={120}
          onChange={(e) => setNamePl(e.target.value)}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="drawer-title-en">{t("sponsorBoard.add.titleEn")}</Label>
        <Input
          id="drawer-title-en"
          value={nameEn}
          maxLength={120}
          onChange={(e) => setNameEn(e.target.value)}
        />
      </div>
      <Button type="submit" size="sm" disabled={isSaving}>
        {t("sponsorBoard.drawer.save")}
      </Button>
    </form>
  );
}
