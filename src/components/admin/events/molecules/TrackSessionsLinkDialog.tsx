// Molekuła: POWIĄZANIE SESJI ZE ŚCIEŻKĄ z poziomu ścieżki.
//
// DLACZEGO Z DRUGIEJ STRONY. Przypięcie sesji do pasma dało się dotąd zrobić
// tylko w oknie pojedynczej sesji - żeby ułożyć ścieżkę z dwunastu punktów,
// organizator otwierał dwanaście okien. Tu widzi cały program naraz i zaznacza
// to, co ma należeć do pasma.
//
// DWA WYWOŁANIA, NIE JEDNO. Baza rozróżnia „przypnij do tej ścieżki" od
// „odepnij" (`track_id = null`), więc zapis wysyła osobno listę dopiętych i
// osobno odpiętych - jedno wywołanie z dwiema intencjami nie istnieje.
//
// PODPOWIADAMY, CO ZABIERAMY CUDZEJ ŚCIEŻCE. Sesja ma dokładnie jedną ścieżkę,
// więc zaznaczenie jej tutaj zdejmuje ją z poprzedniego pasma - wiersz mówi to
// wprost, zanim organizator kliknie zapis.
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { useEventSessions } from "@/lib/events/useEventSessions";
import type { EventSessionRow, EventTrackRow } from "@/lib/events/sessionsApi";

export interface TrackSessionsLinkResult {
  attach: readonly string[];
  detach: readonly string[];
}

interface TrackSessionsLinkDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventId: string;
  track: EventTrackRow | null;
  isSaving: boolean;
  onSubmit: (result: TrackSessionsLinkResult) => void;
}

export function TrackSessionsLinkDialog({
  open,
  onOpenChange,
  eventId,
  track,
  isSaving,
  onSubmit,
}: TrackSessionsLinkDialogProps) {
  const { t, i18n } = useTranslation();
  const isEn = i18n.language.startsWith("en");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<readonly string[]>([]);

  const listQ = useEventSessions({
    eventId,
    q: "",
    trackId: null,
    roomId: null,
    status: "all",
  });
  const rows = useMemo(() => listQ.data ?? [], [listQ.data]);

  const initial = useMemo(
    () => rows.filter((row) => track !== null && row.track_id === track.id).map((row) => row.id),
    [rows, track],
  );

  /** Czy zaznaczenia tego otwarcia pochodzą już z WCZYTANEJ listy sesji. */
  const zasianoRef = useRef(false);

  // Otwarcie okna czyta stan z bazy; późniejsze odświeżenie listy nie kasuje
  // zaznaczeń, które organizator już zrobił.
  useEffect(() => {
    if (!open) {
      zasianoRef.current = false;
      return;
    }
    zasianoRef.current = false;
    setSelected(initial);
    setSearch("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, track?.id]);

  // ZASIEW CZEKA NA PIERWSZĄ ODPOWIEDŹ LISTY, bo to zaznaczenia decydują, co
  // zostanie ODPIĘTE. Okno otwarte, zanim zapytanie odpowie, zasiewało pustkę
  // i już jej nie poprawiało - zapis zdejmował z pasma każdą sesję, której
  // organizator nigdy nie zobaczył. Kolejne odświeżenia listy nie mają prawa
  // ruszyć zaznaczeń, więc pilnuje tego `ref`, a nie następna zależność.
  useEffect(() => {
    if (!open || zasianoRef.current || listQ.data === undefined) return;
    zasianoRef.current = true;
    setSelected(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, track?.id, listQ.data]);

  const titleOf = (row: EventSessionRow): string =>
    isEn ? row.title_en || row.title_pl : row.title_pl || row.title_en;

  const trackNameOf = (row: EventSessionRow): string =>
    isEn ? row.track_name_en || row.track_name_pl : row.track_name_pl || row.track_name_en;

  // KOLUMNY SPOZA WIERSZA SESJI PRZYCHODZĄ JAKO `null`, NIE JAKO PUSTY TEKST.
  // `admin_event_sessions_list` oddaje `track_id` sesji bez pasma wprost z
  // kolumny NULL-owalnej, a nazwę sali z LEFT JOIN-a - a `null !== ""` jest
  // prawdą i `null === ""` fałszem. Bez tego sesja bez pasma dostawała
  // ostrzeżenie „zabieramy ją cudzej ścieżce" (bez nazwy tej ścieżki), a sesja
  // bez sali - sam separator zamiast napisu „bez sali".
  const trackIdOf = (row: EventSessionRow): string => row.track_id ?? "";
  const roomNameOf = (row: EventSessionRow): string => row.room_name ?? "";

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (needle === "") return rows;
    return rows.filter((row) => titleOf(row).toLowerCase().includes(needle));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, search, isEn]);

  const toggle = (id: string, next: boolean) => {
    setSelected((prev) => (next ? [...prev, id] : prev.filter((value) => value !== id)));
  };

  const attach = selected.filter((id) => !initial.includes(id));
  const detach = initial.filter((id) => !selected.includes(id));
  const dirty = attach.length > 0 || detach.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("adminEventAgenda.tracks.link.title")}</DialogTitle>
          <DialogDescription>
            {t("adminEventAgenda.tracks.link.description", {
              track:
                track === null
                  ? ""
                  : isEn
                    ? track.name_en || track.name_pl
                    : track.name_pl || track.name_en,
            })}
          </DialogDescription>
        </DialogHeader>

        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t("adminEventAgenda.sessions.searchPlaceholder")}
          aria-label={t("adminEventAgenda.sessions.searchPlaceholder")}
        />

        <div className="max-h-[22rem] space-y-1 overflow-y-auto pr-1">
          {listQ.isLoading ? (
            <p className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              {t("adminEventAgenda.sessions.loading")}
            </p>
          ) : visible.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">
              {t("adminEventAgenda.sessions.emptyFiltered")}
            </p>
          ) : (
            visible.map((row) => {
              const checked = selected.includes(row.id);
              const rowTrackId = trackIdOf(row);
              const roomName = roomNameOf(row);
              const otherTrack = rowTrackId !== "" && (track === null || rowTrackId !== track.id);
              return (
                <label
                  key={row.id}
                  className="flex cursor-pointer items-start gap-3 rounded-[6px] border border-border/70 p-2 hover:bg-muted/50"
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(next) => toggle(row.id, next === true)}
                    aria-label={titleOf(row)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{titleOf(row)}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {roomName === "" ? t("adminEventAgenda.sessions.noRoom") : roomName} ·{" "}
                      {row.duration_minutes} min
                    </span>
                  </span>
                  {otherTrack ? (
                    <Badge variant="outline" className="shrink-0">
                      {t("adminEventAgenda.tracks.link.movesFrom", { track: trackNameOf(row) })}
                    </Badge>
                  ) : null}
                </label>
              );
            })
          )}
        </div>

        <DialogFooter className="items-center gap-2 sm:justify-between">
          <p className="text-xs text-muted-foreground">
            {t("adminEventAgenda.tracks.link.summary", {
              attach: attach.length,
              detach: detach.length,
            })}
          </p>
          <span className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t("adminEventAgenda.tracks.dialog.cancelAction")}
            </Button>
            <Button
              onClick={() => onSubmit({ attach, detach })}
              disabled={!dirty || isSaving || track === null}
            >
              {isSaving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              ) : null}
              {t("adminEventAgenda.tracks.dialog.saveAction")}
            </Button>
          </span>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
