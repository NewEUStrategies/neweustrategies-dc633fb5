// Molekula: edytor jednej GRUPY UCZESTNIKOW - SZUFLADA z prawej krawedzi, z zakladkami.
//
// SZUFLADA, NIE OKNO MODALNE. Edytor grupy stoi OBOK listy grup, po ktorej
// redaktor sie porusza: poprawia widocznosc jednej grupy, patrzy, jak wypada na
// tle pozostalych, poprawia nastepna. Okno modalne zaslanialo wlasnie te liste -
// po zamknieciu trzeba bylo od nowa szukac wiersza, od ktorego sie wyszlo, a
// porownanie dwoch grup wymagalo zapamietania wartosci z glowy. Szuflada zostawia
// liste widoczna po lewej, wiec kontekst pracy nie znika na czas edycji.
//
// NAZWA KOMPONENTU ZOSTAJE `EventGroupDialog`. Zmiana ksztaltu okna nie jest
// zmiana API - komponent nadal dostaje `open`/`onOpenChange`/`onSubmit` i nadal
// jest wolany z `EventGroupsPanel` oraz z ekranu „Grupy i uprawnienia" studia.
// Przemianowanie pliku kosztowaloby dwa niezwiazane z ta zmiana commity w innych
// modulach i nie dodaloby ani jednej informacji.
//
// POLA W JEDNEJ KOLUMNIE. Szuflada ma ~520 px, a nie ~768 px jak dialog. Dwie
// kolumny w tej szerokosci daja pola na osiem znakow, w ktorych „#FA9346" nie
// miesci sie w calosci. Etykieta nad polem, opis pod polem, jedna kolumna.
//
// ZAKLADKI TO OGOLNE I CZLONKOWIE - I TYLKO TYLE. Wzorzec Swapcarda ma jeszcze
// „Exhibitor profile" i „Lead generation". Modul wystawcow jest u nas SWIADOMIE
// poza zakresem: decyzja zamawiajacego z `docs/PROJEKT_MODUL_EVENT_BUILDER_2026-08-23.md`
// §0.4 mowi, ze partnerzy i sponsorzy ida z CRM firm, bez self-service profilu
// wystawcy, `Items` i pakietow. Atrapa zakladki bez zrodla danych obiecywalaby
// redaktorowi ekran, ktorego nie ma - element bez rzeczywistego zrodla nie
// wchodzi na ekran.
//
// ZAKLADKA „CZLONKOWIE" POKAZUJE LICZNIKI, NIE PANEL PRZYPISYWANIA.
// `GroupMembersPanel` przyjmuje wylacznie `eventId` i SAM wybiera grupe wlasna
// droplista. Zamontowany w szufladzie otwartej nad konkretna grupa dawalby dwa
// wybory tej samej rzeczy - droplista w srodku mogla wskazywac inna grupe niz
// naglowek szuflady, a wtedy „Dodaj do grupy" dodaje do grupy, ktorej redaktor
// nie edytuje. Zamiast tego pokazujemy liczniki z wiersza grupy (te same, co na
// liscie) i kierujemy do zakladki „Czlonkostwa dodatkowe" na ekranie grup i zgod.
//
// KLUCZ ZAMROZONY PO ZAPISIE - RPC zapisu nie czyta klucza przy edycji, wiec
// edytowalne pole obiecywaloby zmiane, ktora nigdy sie nie stanie.
//
// WLACZNIK I ZASIEG SA DWOMA POLAMI, bo baza ma na to dwa warunki: przelacznik
// „widzi liste" jest wlacznikiem, a `attendee_visibility` zasiegiem. Zlanie ich
// w jedno pole odbieraloby organizatorowi mozliwosc pokazania listy w wezszym
// zakresie niz wszyscy zapisani.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AdminFormSection } from "@/components/admin/molecules/AdminFormSection";
import { AdminFormTextRow } from "@/components/admin/molecules/AdminFormTextRow";
import { AdminFormEnumRow } from "@/components/admin/molecules/AdminFormEnumRow";
import { AdminFormSwitchRow } from "@/components/admin/molecules/AdminFormSwitchRow";
import { uiLang } from "@/lib/i18n/format";
import {
  TERMS_MAX_DESCRIPTION,
  TERMS_MAX_NAME,
  emptyGroupDraft,
  groupDraftFromRow,
  groupDraftToInput,
  validateGroupDraft,
  type GroupDraft,
} from "@/lib/events/termsGroupsDraft";
import {
  GROUP_VISIBILITIES,
  type EventGroupRow,
  type GroupInput,
  type GroupVisibility,
} from "@/lib/events/termsGroupsApi";

/** Zakladki szuflady. Wartosci sa techniczne - nie ida do slownika. */
const TAB_GENERAL = "general";
const TAB_MEMBERS = "members";

// PODKRESLENIE, NIE KAFELEK. Wspoldzielony `TabsList` rysuje pigulki na tle
// `bg-muted` - w szufladzie o stalej szerokosci pigulki konkuruja o uwage z
// polami formularza. Pasek zakladek ma byc granica sekcji, wiec zdejmujemy tlo
// i zaokraglenie, a stan aktywny niesie dolna krawedz.
//
// KRESKA STOI NA OTOCZCE, NIE NA LISCIE. `TabsList` ma `tabs-scroller`, czyli
// `overflow-x: auto` - ujemny margines na SAMYM przycisku wystawalby poza to
// pudelko i dolny piksel podkreslenia zostalby przyciety. Hairline rysuje wiec
// otoczka, a lista wjezdza na nia o piksel: podkreslenie aktywnej zakladki
// przykrywa kreske w calosci, a przy nieaktywnych kreska zostaje widoczna.
const TABS_BAR_CLASS = "shrink-0 border-b border-border px-6";
const TABS_LIST_CLASS =
  "-mb-px h-auto w-full justify-start gap-6 rounded-none bg-transparent p-0 sm:justify-start";
const TABS_TRIGGER_CLASS =
  "h-auto w-auto rounded-none border-b-2 border-transparent px-0 py-3 data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:ring-0";
const TABS_CONTENT_CLASS = "mt-0 min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-5";

interface EventGroupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventId: string;
  /** `null` = nowa grupa. */
  group: EventGroupRow | null;
  nextSortOrder: number;
  isSaving: boolean;
  onSubmit: (input: GroupInput) => void;
}

export function EventGroupDialog({
  open,
  onOpenChange,
  eventId,
  group,
  nextSortOrder,
  isSaving,
  onSubmit,
}: EventGroupDialogProps) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const [draft, setDraft] = useState<GroupDraft>(() => emptyGroupDraft(nextSortOrder));
  const [touched, setTouched] = useState(false);
  const [tab, setTab] = useState<string>(TAB_GENERAL);

  // RESET TYLKO PRZY OTWARCIU. Zakladka wraca na „Ogolne" razem ze szkicem, bo
  // szuflada otwarta nad inna grupa jest nowa praca, a nie ciagiem poprzedniej.
  // Przelaczenie zakladki NIE dotyka tego stanu - szkic przezywa przejscie tam
  // i z powrotem, wiec redaktor nie traci wpisanych wartosci przez zerkniecie
  // na liczniki czlonkow.
  useEffect(() => {
    if (!open) return;
    setDraft(group === null ? emptyGroupDraft(nextSortOrder) : groupDraftFromRow(group));
    setTouched(false);
    setTab(TAB_GENERAL);
  }, [open, group, nextSortOrder]);

  const errors = validateGroupDraft(draft);
  const errorFor = (field: keyof GroupDraft): string | null => {
    if (!touched) return null;
    const found = errors.find((error) => error.field === field);
    return found === undefined ? null : t(found.messageKey);
  };

  const set = <K extends keyof GroupDraft>(key: K, value: GroupDraft[K]) =>
    setDraft((previous) => ({ ...previous, [key]: value }));

  const submit = () => {
    setTouched(true);
    if (errors.length > 0) return;
    onSubmit(groupDraftToInput(draft, eventId));
  };

  const isNew = draft.id === null;

  // NAGLOWEK NIESIE NAZWE ZAPISANA, NIE SZKIC. Tytul wiazany z `aria` nie moze
  // znikac w trakcie pisania - a szkic bywa pusty miedzy skasowaniem starej
  // nazwy a wpisaniem nowej.
  const savedName =
    group === null
      ? ""
      : lang === "en"
        ? group.name_en || group.name_pl
        : group.name_pl || group.name_en;
  const headerTitle =
    group === null
      ? t("adminEventTerms.groups.dialog.createTitle")
      : savedName || t("adminEventTerms.groups.dialog.editTitle");

  // Liczniki czytamy z wiersza listy - te same trzy, ktore stoja przy grupie w
  // `EventGroupsPanel`. Osobne zapytanie w szufladzie pokazywaloby inne liczby
  // niz wiersz, z ktorego redaktor wlasnie kliknal olowek.
  const memberStats =
    group === null
      ? []
      : [
          { label: t("adminEventTerms.labels.members"), value: group.primary_members_count },
          { label: t("adminEventTerms.labels.extraMembers"), value: group.extra_members_count },
          { label: t("adminEventTerms.labels.tickets"), value: group.tickets_count },
        ];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {/* `SheetContent` sam rysuje „x" w prawym gornym rogu (z etykieta dla
          czytnika ekranu). Drugi przycisk zamkniecia w naglowku dawalby dwa
          elementy o tej samej roli tuz obok siebie. */}
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-[520px]">
        <SheetHeader className="shrink-0 space-y-1 border-b border-border px-6 py-4 pr-14">
          <SheetTitle className="truncate">{headerTitle}</SheetTitle>
          <SheetDescription>{t("adminEventTerms.groups.subtitle")}</SheetDescription>
        </SheetHeader>

        <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
          <div className={TABS_BAR_CLASS}>
            <TabsList
              className={TABS_LIST_CLASS}
              aria-label={t("adminEventTerms.groups.dialog.tabsLabel")}
            >
              <TabsTrigger value={TAB_GENERAL} className={TABS_TRIGGER_CLASS}>
                {t("adminEventTerms.groups.dialog.tabGeneral")}
              </TabsTrigger>
              <TabsTrigger value={TAB_MEMBERS} className={TABS_TRIGGER_CLASS}>
                {t("adminEventTerms.groups.dialog.tabMembers")}
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value={TAB_GENERAL} className={TABS_CONTENT_CLASS}>
            <AdminFormSection title={t("adminEventTerms.groups.title")} columns={1}>
              <AdminFormTextRow
                label={t("adminEventTerms.groups.dialog.key")}
                hint={t("adminEventTerms.groups.dialog.keyHint")}
                value={draft.key}
                onValueChange={(value) => set("key", value)}
                disabled={!isNew}
                monospace
                maxLength={49}
                error={errorFor("key")}
              />
              <AdminFormTextRow
                label={t("adminEventTerms.groups.dialog.namePl")}
                value={draft.namePl}
                onValueChange={(value) => set("namePl", value)}
                maxLength={TERMS_MAX_NAME}
                error={errorFor("namePl")}
              />
              <AdminFormTextRow
                label={t("adminEventTerms.groups.dialog.nameEn")}
                value={draft.nameEn}
                onValueChange={(value) => set("nameEn", value)}
                maxLength={TERMS_MAX_NAME}
              />
              <AdminFormTextRow
                label={t("adminEventTerms.groups.dialog.descriptionPl")}
                value={draft.descriptionPl}
                onValueChange={(value) => set("descriptionPl", value)}
                maxLength={TERMS_MAX_DESCRIPTION}
                rows={3}
              />
              <AdminFormTextRow
                label={t("adminEventTerms.groups.dialog.descriptionEn")}
                value={draft.descriptionEn}
                onValueChange={(value) => set("descriptionEn", value)}
                maxLength={TERMS_MAX_DESCRIPTION}
                rows={3}
              />
              <AdminFormTextRow
                label={t("adminEventTerms.groups.dialog.color")}
                value={draft.color}
                onValueChange={(value) => set("color", value)}
                placeholder="#FA9346"
                monospace
                maxLength={7}
                error={errorFor("color")}
              />
              <AdminFormTextRow
                label={t("adminEventTerms.groups.dialog.minTierRank")}
                value={draft.minTierRank}
                onValueChange={(value) => set("minTierRank", value)}
                inputMode="numeric"
                error={errorFor("minTierRank")}
              />
              <AdminFormTextRow
                label={t("adminEventTerms.groups.dialog.sortOrder")}
                value={draft.sortOrder}
                onValueChange={(value) => set("sortOrder", value)}
                inputMode="numeric"
              />
            </AdminFormSection>

            <AdminFormSection title={t("adminEventTerms.labels.permissions")} columns={1}>
              <AdminFormSwitchRow
                label={t("adminEventTerms.groups.dialog.canSeeAttendees")}
                checked={draft.canSeeAttendees}
                onCheckedChange={(value) => set("canSeeAttendees", value)}
              />
              <AdminFormEnumRow<GroupVisibility>
                label={t("adminEventTerms.groups.dialog.visibility")}
                hint={t("adminEventTerms.groups.dialog.visibilityHint")}
                value={draft.attendeeVisibility}
                options={GROUP_VISIBILITIES}
                labelFor={(option) => t(`adminEventTerms.visibilities.${option}`)}
                onValueChange={(value) => set("attendeeVisibility", value)}
                disabled={!draft.canSeeAttendees}
              />
              <AdminFormSwitchRow
                label={t("adminEventTerms.groups.dialog.canMeet")}
                checked={draft.canMeet}
                onCheckedChange={(value) => set("canMeet", value)}
              />
              <AdminFormSwitchRow
                label={t("adminEventTerms.groups.dialog.canChat")}
                checked={draft.canChat}
                onCheckedChange={(value) => set("canChat", value)}
              />
              <AdminFormSwitchRow
                label={t("adminEventTerms.groups.dialog.canLeadRetrieval")}
                checked={draft.canLeadRetrieval}
                onCheckedChange={(value) => set("canLeadRetrieval", value)}
              />
              <AdminFormSwitchRow
                label={t("adminEventTerms.groups.dialog.canSeeRecording")}
                checked={draft.canSeeRecording}
                onCheckedChange={(value) => set("canSeeRecording", value)}
              />
              <AdminFormSwitchRow
                label={t("adminEventTerms.groups.dialog.isDefault")}
                hint={t("adminEventTerms.groups.dialog.isDefaultHint")}
                checked={draft.isDefault}
                onCheckedChange={(value) => set("isDefault", value)}
              />
            </AdminFormSection>
          </TabsContent>

          <TabsContent value={TAB_MEMBERS} className={TABS_CONTENT_CLASS}>
            {group === null ? (
              // GRUPA BEZ IDENTYFIKATORA NIE MA CZLONKOW. Puste liczniki albo
              // wyszarzony panel udawalyby, ze jest co pokazac.
              <p className="text-sm text-muted-foreground">
                {t("adminEventTerms.groups.dialog.membersAfterSaveHint")}
              </p>
            ) : (
              <>
                <dl className="space-y-2">
                  {memberStats.map((stat) => (
                    <div
                      key={stat.label}
                      className="flex items-baseline justify-between gap-3 rounded-md border border-border/60 px-3 py-2"
                    >
                      <dt className="text-sm text-muted-foreground">{stat.label}</dt>
                      <dd className="text-sm font-medium tabular-nums">{String(stat.value)}</dd>
                    </div>
                  ))}
                </dl>
                <p className="text-sm leading-snug text-muted-foreground">
                  {t("adminEventTerms.groups.dialog.membersManageHint")}
                </p>
              </>
            )}
          </TabsContent>
        </Tabs>

        {/* AKCJE PRZY DOLNEJ KRAWEDZI, POZA OBSZAREM PRZEWIJANIA. Przycisk
            zapisu schowany pod dlugim formularzem znajduje sie dopiero po
            przewinieciu - a szuflada jest wysoka na caly ekran. */}
        <div className="flex shrink-0 justify-end gap-2 border-t border-border bg-background px-6 py-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            {t("adminEventTerms.groups.dialog.cancelAction")}
          </Button>
          <Button onClick={submit} disabled={isSaving}>
            {t("adminEventTerms.groups.dialog.saveAction")}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
