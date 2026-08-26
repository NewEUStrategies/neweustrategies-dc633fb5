// Molekula: edytor JEDNEJ POZYCJI MENU wydarzenia - szuflada z prawej krawedzi.
//
// SZUFLADA, NIE OKNO MODALNE - z tego samego powodu, co w `EventGroupDialog`.
// Redaktor porzadkuje menu wierszami: poprawia ikone jednej pozycji, patrzy, jak
// wypada na tle pozostalych, poprawia nastepna. Okno modalne zaslanialoby liste,
// po ktorej sie porusza, a przy ikonach i kolorach porownanie z sasiadem jest
// cala trescia pracy.
//
// POZYCJA MENU TO NIE STRONA. Ta szuflada nie dotyka tytulu, tresci ani adresu
// strony - to nalezy do `/admin/pages`. Zapisuje WYLACZNIE mapowanie: etykiete
// w menu, ikone, kolor, obecnosc w menu i widocznosc per grupa. Dlatego pola
// tytulu tu nie ma, a etykieta ma podpowiedz „puste = tytul strony": inaczej
// redaktor przepisywalby tytul recznie i tracil jego zmiany.
//
// POLA W JEDNEJ KOLUMNIE. Szuflada ma ~520 px; dwie kolumny w tej szerokosci
// daja pole na osiem znakow, w ktorym „#FA9346" sie nie miesci.
//
// PUSTY WYBOR GRUP ZNACZY „WSZYSCY", TAKZE GOSCIE - i to jest jedyna rzecz na
// tym ekranie, ktorej nie da sie odgadnac z samej kontrolki, wiec stoi
// w podpowiedzi nad lista, a nie w dokumentacji.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { AdminFormSection } from "@/components/admin/molecules/AdminFormSection";
import { AdminFormSwitchRow } from "@/components/admin/molecules/AdminFormSwitchRow";
import { AdminFormTextRow } from "@/components/admin/molecules/AdminFormTextRow";
import { DynamicIcon } from "@/lib/icons/DynamicIcon";
import { pickLocalized } from "@/lib/i18n/pickLocalized";
import { uiLang } from "@/lib/i18n/format";
import {
  EVENT_PAGE_COLOR_PATTERN,
  EVENT_PAGE_DEFAULT_ICON,
  EVENT_PAGE_ICON_PATTERN,
  eventPageLabel,
  type AttachedEventPageRow,
  type EventPageInput,
} from "@/lib/events/eventPagesApi";
import type { EventGroupRow } from "@/lib/events/termsGroupsApi";

/** `menu_label_*` w bazie jest `text`, ale w menu mieszcza sie dwa slowa. */
const MAX_MENU_LABEL = 60;

interface EventPageEntrySheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pozycja PRZYPIETA - szuflada nie zaklada mapowania, tylko je zmienia. */
  entry: AttachedEventPageRow | null;
  groups: readonly EventGroupRow[];
  isSaving: boolean;
  onSubmit: (input: EventPageInput) => void;
}

interface EntryDraft {
  menuLabelPl: string;
  menuLabelEn: string;
  icon: string;
  color: string;
  inMenu: boolean;
  groupIds: readonly string[];
}

function draftFrom(entry: AttachedEventPageRow): EntryDraft {
  return {
    menuLabelPl: entry.menu_label_pl ?? "",
    menuLabelEn: entry.menu_label_en ?? "",
    icon: entry.icon ?? "",
    color: entry.color ?? "",
    inMenu: entry.in_menu,
    groupIds: entry.visible_to_groups,
  };
}

export function EventPageEntrySheet({
  open,
  onOpenChange,
  entry,
  groups,
  isSaving,
  onSubmit,
}: EventPageEntrySheetProps) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const [draft, setDraft] = useState<EntryDraft | null>(null);
  const [touched, setTouched] = useState(false);

  // RESET TYLKO PRZY OTWARCIU: szuflada otwarta nad inna pozycja jest nowa
  // praca, a nie ciagiem poprzedniej.
  useEffect(() => {
    if (!open || entry === null) return;
    setDraft(draftFrom(entry));
    setTouched(false);
  }, [open, entry]);

  const set = <K extends keyof EntryDraft>(key: K, value: EntryDraft[K]) =>
    setDraft((previous) => (previous === null ? previous : { ...previous, [key]: value }));

  const iconError =
    draft !== null && draft.icon !== "" && !EVENT_PAGE_ICON_PATTERN.test(draft.icon)
      ? t("adminEvents.studio.pages.entry.iconInvalid")
      : null;
  const colorError =
    draft !== null && draft.color !== "" && !EVENT_PAGE_COLOR_PATTERN.test(draft.color)
      ? t("adminEvents.studio.pages.entry.colorInvalid")
      : null;

  const submit = () => {
    setTouched(true);
    if (entry === null || draft === null) return;
    if (iconError !== null || colorError !== null) return;
    onSubmit({
      id: entry.id,
      menuLabelPl: draft.menuLabelPl,
      menuLabelEn: draft.menuLabelEn,
      icon: draft.icon === "" ? null : draft.icon,
      color: draft.color === "" ? null : draft.color.toUpperCase(),
      inMenu: draft.inMenu,
      sortOrder: entry.sort_order,
      visibleToGroups: draft.groupIds,
    });
  };

  // NAGLOWEK NIESIE ETYKIETE ZAPISANA, NIE SZKIC: tytul wiazany z `aria` nie
  // moze znikac miedzy skasowaniem starej etykiety a wpisaniem nowej.
  const headerTitle =
    entry === null ? t("adminEvents.studio.pages.entry.title") : eventPageLabel(entry, lang);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-[520px]">
        <SheetHeader className="shrink-0 space-y-1 border-b border-border px-6 py-4 pr-14">
          <SheetTitle className="truncate">{headerTitle}</SheetTitle>
          <SheetDescription>{t("adminEvents.studio.pages.entry.subtitle")}</SheetDescription>
        </SheetHeader>

        {draft === null ? null : (
          <>
            <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-5">
              <AdminFormSection
                title={t("adminEvents.studio.pages.entry.labelSection")}
                hint={t("adminEvents.studio.pages.entry.labelHint")}
                columns={1}
              >
                <AdminFormTextRow
                  label={t("adminEvents.studio.pages.entry.menuLabelPl")}
                  value={draft.menuLabelPl}
                  onValueChange={(value) => set("menuLabelPl", value)}
                  maxLength={MAX_MENU_LABEL}
                />
                <AdminFormTextRow
                  label={t("adminEvents.studio.pages.entry.menuLabelEn")}
                  value={draft.menuLabelEn}
                  onValueChange={(value) => set("menuLabelEn", value)}
                  maxLength={MAX_MENU_LABEL}
                />
              </AdminFormSection>

              <AdminFormSection
                title={t("adminEvents.studio.pages.entry.appearanceSection")}
                columns={1}
              >
                <IconField
                  value={draft.icon}
                  error={touched ? iconError : null}
                  onChange={(value) => set("icon", value)}
                />
                <ColorField
                  value={draft.color}
                  error={touched ? colorError : null}
                  onChange={(value) => set("color", value)}
                />
              </AdminFormSection>

              <AdminFormSection
                title={t("adminEvents.studio.pages.entry.visibilitySection")}
                columns={1}
              >
                <AdminFormSwitchRow
                  label={t("adminEvents.studio.pages.entry.inMenu")}
                  hint={t("adminEvents.studio.pages.entry.inMenuHint")}
                  checked={draft.inMenu}
                  onCheckedChange={(value) => set("inMenu", value)}
                />
                <GroupChecklist
                  groups={groups}
                  selected={draft.groupIds}
                  lang={lang}
                  onToggle={(groupId, checked) =>
                    set(
                      "groupIds",
                      checked
                        ? [...draft.groupIds, groupId]
                        : draft.groupIds.filter((id) => id !== groupId),
                    )
                  }
                />
              </AdminFormSection>
            </div>

            {/* AKCJE PRZY DOLNEJ KRAWEDZI, POZA OBSZAREM PRZEWIJANIA - przycisk
                zapisu schowany pod formularzem znajduje sie dopiero po
                przewinieciu, a szuflada jest wysoka na caly ekran. */}
            <div className="flex shrink-0 justify-end gap-2 border-t border-border bg-background px-6 py-4">
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
                {t("adminEvents.studio.pages.entry.cancel")}
              </Button>
              <Button onClick={submit} disabled={isSaving}>
                {t("adminEvents.studio.pages.entry.save")}
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

/**
 * Nazwa ikony z PODGLADEM obok pola.
 *
 * PODGLAD JEST WALIDACJA, KTOREJ BAZA NIE ZROBI. `event_pages_icon_check`
 * przepusci kazde kebab-case slowo, wiec „calendar-days" i „calednar-days" sa
 * dla niej rownie poprawne - a roznica widac dopiero na stronie publicznej.
 * Ikona rysowana przy polu pokazuje literowke od razu: nieznana nazwa daje znak
 * zapytania.
 */
function IconField({
  value,
  error,
  onChange,
}: {
  value: string;
  error: string | null;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  const id = "event-page-entry-icon";
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{t("adminEvents.studio.pages.entry.icon")}</Label>
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground"
        >
          <DynamicIcon name={value === "" ? EVENT_PAGE_DEFAULT_ICON : value} size={16} />
        </span>
        <Input
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value.trim().toLowerCase())}
          placeholder={EVENT_PAGE_DEFAULT_ICON}
          maxLength={48}
          className="font-mono text-[13px]"
          aria-invalid={error === null ? undefined : true}
          aria-describedby={error === null ? `${id}-hint` : `${id}-err`}
        />
      </div>
      {error === null ? (
        <p id={`${id}-hint`} className="text-xs leading-snug text-muted-foreground">
          {t("adminEvents.studio.pages.entry.iconHint")}
        </p>
      ) : (
        <p id={`${id}-err`} className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Kolor pozycji: pole heksadecymalne plus probnik systemowy.
 *
 * DWA WEJSCIA NA JEDNA WARTOSC, tak jak w brandingu wydarzenia: probnik jest
 * szybszy, ale kolor z identyfikacji wizualnej przychodzi jako napis „#0B1120"
 * i wybieranie go pipeta jest zgadywaniem.
 *
 * PUSTE POLE NIE ZNACZY BIALY, znaczy „kolor z brandingu wydarzenia" - dlatego
 * probnik pokazuje wtedy barwe neutralna, ale sam z siebie jej NIE zapisuje.
 */
function ColorField({
  value,
  error,
  onChange,
}: {
  value: string;
  error: string | null;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  const id = "event-page-entry-color";
  const swatch = EVENT_PAGE_COLOR_PATTERN.test(value) ? value : "#FFFFFF";
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{t("adminEvents.studio.pages.entry.color")}</Label>
      <div className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5">
        <span className="text-[13px] text-muted-foreground">#</span>
        <input
          id={id}
          value={value.replace(/^#/, "")}
          placeholder={t("adminEvents.studio.pages.entry.colorPlaceholder")}
          onChange={(event) => {
            const raw = event.target.value.trim().replace(/^#/, "");
            onChange(raw === "" ? "" : `#${raw.toUpperCase()}`);
          }}
          maxLength={6}
          className="min-w-0 flex-1 bg-transparent font-mono text-[13px] uppercase outline-none"
          aria-invalid={error === null ? undefined : true}
        />
        <input
          type="color"
          value={swatch}
          aria-label={t("adminEvents.studio.pages.entry.colorPicker")}
          onChange={(event) => onChange(event.target.value.toUpperCase())}
          className="h-6 w-6 shrink-0 cursor-pointer rounded border border-border bg-transparent p-0"
        />
      </div>
      {error === null ? (
        <p className="text-xs leading-snug text-muted-foreground">
          {t("adminEvents.studio.pages.entry.colorHint")}
        </p>
      ) : (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Widocznosc pozycji: lista grup wydarzenia z polami wyboru.
 *
 * LISTA, NIE DROPLISTA WIELOKROTNA. Grup w wydarzeniu jest kilka, a decyzja
 * „kto to widzi" musi byc czytelna bez rozwijania - zwinieta droplista
 * pokazywalaby „3 wybrane" i chowala, KTORE trzy.
 */
function GroupChecklist({
  groups,
  selected,
  lang,
  onToggle,
}: {
  groups: readonly EventGroupRow[];
  selected: readonly string[];
  lang: "pl" | "en";
  onToggle: (groupId: string, checked: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      <p className="text-xs leading-snug text-muted-foreground">
        {t("adminEvents.studio.pages.entry.visibilityHint")}
      </p>
      {groups.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
          {t("adminEvents.studio.pages.entry.visibilityNoGroups")}
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {groups.map((group) => {
            const id = `event-page-entry-group-${group.id}`;
            return (
              <li key={group.id} className="flex items-center gap-2.5 px-3 py-2">
                <Checkbox
                  id={id}
                  checked={selected.includes(group.id)}
                  onCheckedChange={(checked) => onToggle(group.id, checked === true)}
                />
                <Label htmlFor={id} className="min-w-0 flex-1 truncate text-[13px] font-normal">
                  {pickLocalized(group, "name", lang)}
                </Label>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
