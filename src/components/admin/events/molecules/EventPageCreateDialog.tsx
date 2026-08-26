// Molekula: zalozenie NOWEJ PODSTRONY wydarzenia.
//
// OKNO MODALNE, NIE SZUFLADA - odwrotnie niz przy edycji pozycji menu. To jest
// akcja jednorazowa i krotka (dwa tytuly plus wybor szablonu), a nie
// porzadkowanie listy: nie ma tu czego porownywac z sasiadem, a okno na srodku
// niesie decyzje „zakladam strone" wyrazniej niz panel doklejony do krawedzi.
//
// TYTULY, IKONA I SZABLON - NIC WIECEJ. Adres, SEO i harmonogram publikacji
// naleza do `/admin/pages` i tam zostaja; tutaj pytamy WYLACZNIE o to, bez czego
// strony nie da sie utworzyc (tytul w obu jezykach - slug liczy baza z tytulu),
// plus ikone, bo pozycja bez ikony wchodzi do menu z domyslna, plus SZABLON.
//
// SZABLON JEST TU, A NIE „POTEM W BUILDERZE". Strona zalozona pusta stawiala
// redaktora przed bialą kanwa i pytaniem „co ta strona ma zawierac"; wybor na
// tym ekranie odpowiada na nie z gory, a lista blokow pod kazda pozycja mowi,
// co dokladnie wjedzie na strone. Ikona pozycji idzie w parze z szablonem, o ile
// redaktor nie wpisal wlasnej.
//
// TYTUL W OBU JEZYKACH JEST WYMAGANY, tak jak w `admin_event_page_create`
// (`invalid_titles`). Blokada po stronie okna istnieje, zeby powod odmowy stal
// przy polu, ktore go wywolalo - a nie w toascie nad calym ekranem.

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AdminFormTextRow } from "@/components/admin/molecules/AdminFormTextRow";
import { DynamicIcon } from "@/lib/icons/DynamicIcon";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  EVENT_PAGE_DEFAULT_ICON,
  EVENT_PAGE_ICON_PATTERN,
  type EventPageCreateInput,
} from "@/lib/events/eventPagesApi";

/** `pages.title_*` jest `text`, ale tytul dluzszy nie miesci sie w okruszkach. */
const MAX_TITLE = 160;

interface EventPageCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventId: string;
  isSaving: boolean;
  onSubmit: (input: EventPageCreateInput) => void;
}

export function EventPageCreateDialog({
  open,
  onOpenChange,
  eventId,
  isSaving,
  onSubmit,
}: EventPageCreateDialogProps) {
  const { t } = useTranslation();
  const [titlePl, setTitlePl] = useState("");
  const [titleEn, setTitleEn] = useState("");
  const [icon, setIcon] = useState("");
  const [touched, setTouched] = useState(false);

  // RESET PRZY OTWARCIU, nie przy zamknieciu: pola wyczyszczone w trakcie
  // animacji zamykania migaja pustka na oczach redaktora.
  useEffect(() => {
    if (!open) return;
    setTitlePl("");
    setTitleEn("");
    setIcon("");
    setTouched(false);
  }, [open]);

  const titlesMissing = titlePl.trim() === "" || titleEn.trim() === "";
  const iconInvalid = icon !== "" && !EVENT_PAGE_ICON_PATTERN.test(icon);
  const iconId = "event-page-create-icon";

  const submit = () => {
    setTouched(true);
    if (titlesMissing || iconInvalid) return;
    onSubmit({
      eventId,
      titlePl: titlePl.trim(),
      titleEn: titleEn.trim(),
      icon: icon === "" ? undefined : icon,
      inMenu: true,
    });
  };

  const titleError = touched && titlesMissing ? t("adminEvents.studio.errors.invalidTitles") : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("adminEvents.studio.pages.create.title")}</DialogTitle>
          <DialogDescription>{t("adminEvents.studio.pages.create.subtitle")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <AdminFormTextRow
            label={t("adminEvents.studio.pages.create.titlePl")}
            value={titlePl}
            onValueChange={setTitlePl}
            maxLength={MAX_TITLE}
            error={titleError}
          />
          <AdminFormTextRow
            label={t("adminEvents.studio.pages.create.titleEn")}
            value={titleEn}
            onValueChange={setTitleEn}
            maxLength={MAX_TITLE}
          />
          <div className="space-y-1.5">
            <Label htmlFor={iconId}>{t("adminEvents.studio.pages.create.icon")}</Label>
            <div className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground"
              >
                <DynamicIcon name={icon === "" ? EVENT_PAGE_DEFAULT_ICON : icon} size={16} />
              </span>
              <Input
                id={iconId}
                value={icon}
                onChange={(event) => setIcon(event.target.value.trim().toLowerCase())}
                placeholder={EVENT_PAGE_DEFAULT_ICON}
                maxLength={48}
                className="font-mono text-[13px]"
                aria-invalid={touched && iconInvalid ? true : undefined}
              />
            </div>
            {touched && iconInvalid ? (
              <p className="text-xs text-destructive" role="alert">
                {t("adminEvents.studio.pages.entry.iconInvalid")}
              </p>
            ) : (
              <p className="text-xs leading-snug text-muted-foreground">
                {t("adminEvents.studio.pages.create.iconHint")}
              </p>
            )}
          </div>
          <p className="text-xs leading-snug text-muted-foreground">
            {t("adminEvents.studio.pages.create.draftHint")}
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            {t("adminEvents.studio.pages.create.cancel")}
          </Button>
          <Button onClick={submit} disabled={isSaving}>
            {t("adminEvents.studio.pages.create.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
