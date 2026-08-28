// Organizm: GENERATOR IDENTYFIKATORÓW (wybór osób -> wydruk).
//
// WYDANIE ROTUJE KOD QR. `admin_event_badge_batch` nadpisuje hash kodu w
// zapisie, więc poprzedni wydruk tej osoby przestaje wpuszczać. To celowe
// (zgubiony identyfikator ma przestać działać), ale znaczy też, że partii nie
// wolno generować „w tle" przy renderze - dopiero po kliknięciu operatora.
//
// KOD JAWNY ŻYJE TYLKO W PAMIĘCI TEJ STRONY. Baza trzyma sam hash; jawny token
// wraca raz, trafia do obrazka QR i do okna druku, i nigdzie go nie zapisujemy
// (żadnego cache React Query, żadnego localStorage).
//
// DRUK IDZIE W OSOBNYM OKNIE. Aplikacja ma globalny arkusz `@media print`
// przystosowany do artykułów - wydruk identyfikatora przez ten arkusz wychodzi
// w złym rozmiarze. Dokument z `buildBadgePrintDocument` jest samowystarczalny.
//
// REJESTR WYDRUKÓW ZAPISUJEMY PO FAKCIE. `admin_event_badge_print_record` woła
// się per osoba, żeby panel „Wydruki" pokazał wersję szablonu i kto drukował;
// błąd zapisu rejestru nie może cofnąć już wydanego kodu, więc go tylko zgłaszamy.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import QRCode from "qrcode";
import { Printer, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { FormSelect } from "@/components/atoms/FormSelect";
import { AdminCatalogListState } from "@/components/admin/molecules/AdminCatalogListState";
import { adminOnsiteErrorMessage } from "@/lib/events/adminOnsiteErrors";
import {
  useBadgeTemplates,
  useCheckinSearch,
  useIssueBadgeBatch,
  useRecordBadgePrint,
} from "@/lib/events/useEventOnsite";
import { badgeLocalized, badgeSizeMm, BADGE_FALLBACK_MM } from "@/lib/events/badgeSheet";
import { buildBadgePrintDocument, type BadgePrintCard } from "@/lib/events/badgePrintDocument";
import { uiLang } from "@/lib/i18n/format";

const NO_TEMPLATE = "__none__";

export function OnsiteBadgePrintPanel({
  eventId,
  eventTitle,
}: {
  eventId: string;
  eventTitle: string;
}) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [templateId, setTemplateId] = useState(NO_TEMPLATE);

  const searchQ = useCheckinSearch(eventId, query);
  const templatesQ = useBadgeTemplates(eventId);
  const issue = useIssueBadgeBatch(eventId);
  const recordPrint = useRecordBadgePrint(eventId);

  const templates = templatesQ.data ?? [];
  const rows = searchQ.data ?? [];
  const selectedIds = useMemo(
    () => Object.keys(selected).filter((id) => selected[id] === true),
    [selected],
  );

  const template = templates.find((row) => row.id === templateId) ?? null;
  const size =
    template === null
      ? BADGE_FALLBACK_MM
      : badgeSizeMm({
          paperFormat: template.paper_format,
          orientation: template.orientation,
          widthMm: template.width_mm,
          heightMm: template.height_mm,
        });

  const templateOptions = useMemo(
    () => [
      { value: NO_TEMPLATE, label: t("adminEventOnsite.print.templateMissing") },
      ...templates.map((row) => ({
        value: row.id,
        label: `${row.name} (${row.paper_format.toUpperCase()})`,
      })),
    ],
    [templates, t],
  );

  const reprintRisk = rows.some(
    (row) => selected[row.person_id] === true && row.badge_printed === true,
  );

  const toggle = (personId: string, next: boolean) => {
    setSelected((current) => ({ ...current, [personId]: next }));
  };

  const run = async () => {
    if (selectedIds.length === 0) return;
    // Okno otwieramy PRZED `await` - przeglądarka wiąże `window.open` z
    // gestem użytkownika i po asynchronicznej przerwie blokuje wywołanie.
    const printWindow = window.open("", "_blank", "width=900,height=700");
    if (printWindow === null) {
      toast.error(t("adminEventOnsite.print.popupBlocked"));
      return;
    }

    try {
      const batch = await issue.mutateAsync({
        eventId,
        personIds: selectedIds,
        templateId: templateId === NO_TEMPLATE ? undefined : templateId,
      });

      const cards: BadgePrintCard[] = await Promise.all(
        batch.badges.map(async (card) => ({
          card,
          qrDataUrl:
            card.qrCode === null
              ? null
              : await QRCode.toDataURL(card.qrCode, { margin: 0, width: 512 }),
          ticketLabel: badgeLocalized(card.ticketNamePl, card.ticketNameEn, lang),
          groupLabel: badgeLocalized(card.groupNamePl, card.groupNameEn, lang),
        })),
      );

      printWindow.document.write(
        buildBadgePrintDocument(cards, {
          widthMm: size.widthMm,
          heightMm: size.heightMm,
          showQr: template === null ? true : template.show_qr,
          qrSizeMm: template === null ? 24 : template.qr_size_mm,
          backgroundColor: template === null ? null : template.background_color,
          eventTitle,
          documentTitle: t("adminEventOnsite.print.documentTitle"),
          noCodeLabel: t("adminEventOnsite.print.noCode"),
        }),
      );
      printWindow.document.close();
      printWindow.focus();
      printWindow.print();

      for (const card of batch.badges) {
        try {
          await recordPrint.mutateAsync({
            eventId,
            personId: card.personId,
            templateId: templateId === NO_TEMPLATE ? undefined : templateId,
            reason: "initial",
          });
        } catch (error) {
          toast.error(adminOnsiteErrorMessage(error));
        }
      }

      toast.success(t("adminEventOnsite.print.done", { count: batch.badges.length }));
      setSelected({});
    } catch (error) {
      printWindow.close();
      toast.error(adminOnsiteErrorMessage(error));
    }
  };

  return (
    <section className="space-y-4">
      <header className="space-y-1">
        <h2 className="font-display text-lg">{t("adminEventOnsite.print.title")}</h2>
        <p className="max-w-2xl text-sm text-muted-foreground">
          {t("adminEventOnsite.print.subtitle")}
        </p>
      </header>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="badge-print-search">{t("adminEventOnsite.print.searchLabel")}</Label>
          <div className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              id="badge-print-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("adminEventOnsite.print.searchPlaceholder")}
              className="rounded-md pl-9"
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="badge-print-template">{t("adminEventOnsite.print.templateLabel")}</Label>
          <FormSelect
            id="badge-print-template"
            value={templateId}
            options={templateOptions}
            onValueChange={setTemplateId}
            aria-label={t("adminEventOnsite.print.templateLabel")}
          />
        </div>
      </div>

      {query.trim().length < 2 ? (
        <p className="text-sm text-muted-foreground">{t("adminEventOnsite.print.searchHint")}</p>
      ) : (
        <AdminCatalogListState
          isLoading={searchQ.isLoading}
          loadingLabel={t("adminEventOnsite.print.searchLoading")}
          errorMessage={
            searchQ.error === null || searchQ.error === undefined
              ? null
              : adminOnsiteErrorMessage(searchQ.error)
          }
          isEmpty={rows.length === 0}
          emptyLabel={t("adminEventOnsite.print.searchEmpty")}
        >
          <div className="overflow-hidden rounded-md border border-border/70">
            <ul className="divide-y divide-border/70">
              {rows.map((row) => {
                const group = badgeLocalized(row.group_name_pl, row.group_name_en, lang);
                return (
                  <li key={row.person_id} className="flex items-center gap-3 p-3">
                    <Checkbox
                      checked={selected[row.person_id] === true}
                      onCheckedChange={(next) => toggle(row.person_id, next === true)}
                      aria-label={`${row.first_name} ${row.last_name}`}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {`${row.first_name} ${row.last_name}`.trim()}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {[row.job_title, row.company].filter((part) => part !== null).join(" · ")}
                      </p>
                    </div>
                    {group === null ? null : (
                      <Badge variant="outline" className="rounded-md">
                        {group}
                      </Badge>
                    )}
                    {row.badge_printed === true ? (
                      <Badge variant="secondary" className="rounded-md">
                        {t("adminEventOnsite.print.alreadyPrinted")}
                      </Badge>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        </AdminCatalogListState>
      )}

      {reprintRisk ? (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          {t("adminEventOnsite.print.reprintWarning")}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-muted-foreground">
          {t("adminEventOnsite.print.selected", { count: selectedIds.length })}
        </p>
        <Button
          type="button"
          variant="outline"
          className="rounded-md"
          disabled={rows.length === 0}
          onClick={() =>
            setSelected((current) => {
              const next = { ...current };
              for (const row of rows) next[row.person_id] = true;
              return next;
            })
          }
        >
          {t("adminEventOnsite.print.selectAll")}
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="rounded-md"
          disabled={selectedIds.length === 0}
          onClick={() => setSelected({})}
        >
          {t("adminEventOnsite.print.clear")}
        </Button>
        <Button
          type="button"
          className="rounded-md"
          disabled={selectedIds.length === 0 || issue.isPending}
          onClick={() => void run()}
        >
          <Printer aria-hidden="true" className="mr-2 size-4" />
          {issue.isPending
            ? t("adminEventOnsite.print.generating")
            : t("adminEventOnsite.print.generate")}
        </Button>
      </div>
    </section>
  );
}
