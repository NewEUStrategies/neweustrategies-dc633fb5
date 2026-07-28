// Organism: edytor widgetu "event-schedule". Struktura: dni -> sesje ->
// (prelegenci | sponsorzy). Prelegent sesji moze byc wpisany recznie
// (imie/rola/zdjecie) lub podpiety pod profil platformy (ProfilePicker ->
// userId; widok pobiera wtedy dane zywe z RPC get_public_speakers, a wpis
// reczny sluzy za fallback SSR/offline). Edycja pracuje na znormalizowanym
// modelu (parseScheduleDays) i zapisuje calosc przez toJson - odpornosc na
// smieci w tresci legacy.
import { toJson } from "@/lib/builder/types";
import type { WidgetNode, Json } from "@/lib/builder/types";
import {
  parseScheduleDays,
  type ScheduleDay,
  type ScheduleSession,
  type ScheduleSpeakerRef,
  type ScheduleSponsor,
} from "@/lib/events/schedule";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChevronDown, ChevronUp } from "@/lib/lucide-shim";
import { PropField, ItemFrame, ColorField } from "../../atoms";
import { ListShell } from "./ListShell";
import { ProfilePicker } from "./ProfilePicker";
import type { Item } from "./shared";

interface Props {
  c: WidgetNode["content"];
  lang: "pl" | "en";
  setContent: (k: string, v: Json) => void;
}

const strOf = (v: unknown): string => (typeof v === "string" ? v : "");
const newLocalId = (prefix: string): string =>
  `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function moveAt<T>(list: T[], index: number, dir: -1 | 1): T[] {
  const target = index + dir;
  if (target < 0 || target >= list.length) return list;
  const next = list.slice();
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

function MoveButtons({
  index,
  count,
  onMove,
  labelUp,
  labelDown,
}: {
  index: number;
  count: number;
  onMove: (dir: -1 | 1) => void;
  labelUp: string;
  labelDown: string;
}) {
  return (
    <span className="inline-flex gap-0.5">
      <button
        type="button"
        onClick={() => onMove(-1)}
        disabled={index === 0}
        aria-label={labelUp}
        className="rounded p-0.5 text-muted-foreground hover:bg-accent disabled:opacity-30"
      >
        <ChevronUp className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={() => onMove(1)}
        disabled={index === count - 1}
        aria-label={labelDown}
        className="rounded p-0.5 text-muted-foreground hover:bg-accent disabled:opacity-30"
      >
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
    </span>
  );
}

function SpeakerRow({
  speaker,
  index,
  count,
  lang,
  onPatch,
  onMove,
  onRemove,
}: {
  speaker: ScheduleSpeakerRef;
  index: number;
  count: number;
  lang: "pl" | "en";
  onPatch: (patch: Partial<ScheduleSpeakerRef>) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}) {
  const l = (pl: string, en: string) => (lang === "pl" ? pl : en);
  return (
    <div className="space-y-1.5 rounded-[6px] border border-border/60 bg-muted/20 p-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {speaker.name || l("Prelegent", "Speaker") + ` #${index + 1}`}
        </span>
        <span className="flex items-center gap-1">
          <MoveButtons
            index={index}
            count={count}
            onMove={onMove}
            labelUp={l("Przesuń wyżej", "Move up")}
            labelDown={l("Przesuń niżej", "Move down")}
          />
          <button
            type="button"
            onClick={onRemove}
            className="text-[10px] text-muted-foreground hover:text-destructive"
          >
            {l("Usuń", "Remove")}
          </button>
        </span>
      </div>
      <PropField
        label={l("Profil platformy", "Platform profile")}
        hint={l(
          "Podpięty profil = żywe dane (profil prelegenta/eksperta, dialog po kliknięciu).",
          "Linked profile = live data (speaker/expert profile, dialog on click).",
        )}
      >
        <ProfilePicker
          value={speaker.userId}
          lang={lang}
          onPick={(hit) =>
            onPatch({
              userId: hit.id,
              name: speaker.name || hit.display_name || "",
              photo: speaker.photo || hit.avatar_url || "",
            })
          }
          onClear={() => onPatch({ userId: "" })}
        />
      </PropField>
      <PropField label={l("Imię i nazwisko", "Full name")}>
        <Input
          value={speaker.name}
          onChange={(e) => onPatch({ name: e.target.value })}
          className="h-8 text-xs"
        />
      </PropField>
      <div className="grid grid-cols-2 gap-2">
        <PropField label={`${l("Rola", "Role")} PL`}>
          <Input
            value={speaker.role_pl}
            onChange={(e) => onPatch({ role_pl: e.target.value })}
            className="h-8 text-xs"
          />
        </PropField>
        <PropField label={`${l("Rola", "Role")} EN`}>
          <Input
            value={speaker.role_en}
            onChange={(e) => onPatch({ role_en: e.target.value })}
            className="h-8 text-xs"
          />
        </PropField>
      </div>
      <PropField label={l("Zdjęcie (URL)", "Photo (URL)")}>
        <Input
          value={speaker.photo}
          onChange={(e) => onPatch({ photo: e.target.value })}
          placeholder="https://…"
          className="h-8 text-xs"
        />
      </PropField>
    </div>
  );
}

function SponsorRow({
  sponsor,
  index,
  lang,
  onPatch,
  onRemove,
}: {
  sponsor: ScheduleSponsor;
  index: number;
  lang: "pl" | "en";
  onPatch: (patch: Partial<ScheduleSponsor>) => void;
  onRemove: () => void;
}) {
  const l = (pl: string, en: string) => (lang === "pl" ? pl : en);
  return (
    <div className="space-y-1.5 rounded-[6px] border border-border/60 bg-muted/20 p-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {sponsor.name || l("Sponsor", "Sponsor") + ` #${index + 1}`}
        </span>
        <button
          type="button"
          onClick={onRemove}
          className="text-[10px] text-muted-foreground hover:text-destructive"
        >
          {l("Usuń", "Remove")}
        </button>
      </div>
      <PropField label={l("Nazwa", "Name")}>
        <Input
          value={sponsor.name}
          onChange={(e) => onPatch({ name: e.target.value })}
          className="h-8 text-xs"
        />
      </PropField>
      <div className="grid grid-cols-2 gap-2">
        <PropField label={l("Logo (URL)", "Logo (URL)")}>
          <Input
            value={sponsor.logo}
            onChange={(e) => onPatch({ logo: e.target.value })}
            placeholder="https://…"
            className="h-8 text-xs"
          />
        </PropField>
        <PropField label={l("Link", "Link")}>
          <Input
            value={sponsor.url}
            onChange={(e) => onPatch({ url: e.target.value })}
            placeholder="https://…"
            className="h-8 text-xs"
          />
        </PropField>
      </div>
    </div>
  );
}

function SessionEditor({
  session,
  index,
  count,
  lang,
  onPatch,
  onMove,
  onRemove,
}: {
  session: ScheduleSession;
  index: number;
  count: number;
  lang: "pl" | "en";
  onPatch: (patch: Partial<ScheduleSession>) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}) {
  const l = (pl: string, en: string) => (lang === "pl" ? pl : en);
  const title = (lang === "pl" ? session.title_pl : session.title_en) || session.title_pl;

  const patchSpeaker = (i: number, patch: Partial<ScheduleSpeakerRef>) =>
    onPatch({
      speakers: session.speakers.map((s, j) => (j === i ? { ...s, ...patch } : s)),
    });
  const patchSponsor = (i: number, patch: Partial<ScheduleSponsor>) =>
    onPatch({
      sponsors: session.sponsors.map((s, j) => (j === i ? { ...s, ...patch } : s)),
    });

  return (
    <ItemFrame title={title || `${l("Sesja", "Session")} #${index + 1}`} onRemove={onRemove}>
      <div className="mb-1 flex items-center justify-between">
        <MoveButtons
          index={index}
          count={count}
          onMove={onMove}
          labelUp={l("Przesuń wyżej", "Move up")}
          labelDown={l("Przesuń niżej", "Move down")}
        />
        <Select
          value={session.kind}
          onValueChange={(v) => onPatch({ kind: v === "break" ? "break" : "session" })}
        >
          <SelectTrigger className="h-7 w-[130px] text-[11px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="session">{l("Sesja", "Session")}</SelectItem>
            <SelectItem value="break">{l("Przerwa", "Break")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <PropField label={l("Od", "From")}>
          <Input
            type="time"
            value={session.timeStart}
            onChange={(e) => onPatch({ timeStart: e.target.value })}
            className="h-8 text-xs"
          />
        </PropField>
        <PropField label={l("Do", "To")}>
          <Input
            type="time"
            value={session.timeEnd}
            onChange={(e) => onPatch({ timeEnd: e.target.value })}
            className="h-8 text-xs"
          />
        </PropField>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <PropField label={`${l("Tytuł", "Title")} PL`}>
          <Input
            value={session.title_pl}
            onChange={(e) => onPatch({ title_pl: e.target.value })}
            className="h-8 text-xs"
          />
        </PropField>
        <PropField label={`${l("Tytuł", "Title")} EN`}>
          <Input
            value={session.title_en}
            onChange={(e) => onPatch({ title_en: e.target.value })}
            className="h-8 text-xs"
          />
        </PropField>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <PropField label={`${l("Opis", "Description")} PL`}>
          <Textarea
            rows={2}
            value={session.description_pl}
            onChange={(e) => onPatch({ description_pl: e.target.value })}
            className="text-xs"
          />
        </PropField>
        <PropField label={`${l("Opis", "Description")} EN`}>
          <Textarea
            rows={2}
            value={session.description_en}
            onChange={(e) => onPatch({ description_en: e.target.value })}
            className="text-xs"
          />
        </PropField>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <PropField label={l("Sala / miejsce", "Room / place")}>
          <Input
            value={session.room}
            onChange={(e) => onPatch({ room: e.target.value })}
            className="h-8 text-xs"
          />
        </PropField>
        <PropField label={l("Link sesji", "Session link")}>
          <Input
            value={session.href}
            onChange={(e) => onPatch({ href: e.target.value })}
            placeholder="/… lub https://…"
            className="h-8 text-xs"
          />
        </PropField>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {l("Prelegenci", "Speakers")}
          </span>
          <button
            type="button"
            onClick={() =>
              onPatch({
                speakers: [
                  ...session.speakers,
                  {
                    id: newLocalId("sp"),
                    userId: "",
                    name: "",
                    role_pl: "",
                    role_en: "",
                    photo: "",
                  },
                ],
              })
            }
            className="text-[11px] text-brand hover:underline"
          >
            + {l("Dodaj", "Add")}
          </button>
        </div>
        {session.speakers.map((speaker, i) => (
          <SpeakerRow
            key={speaker.id}
            speaker={speaker}
            index={i}
            count={session.speakers.length}
            lang={lang}
            onPatch={(p) => patchSpeaker(i, p)}
            onMove={(dir) => onPatch({ speakers: moveAt(session.speakers, i, dir) })}
            onRemove={() => onPatch({ speakers: session.speakers.filter((_, j) => j !== i) })}
          />
        ))}
      </div>

      {session.kind === "break" && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              {l("Sponsorzy przerwy", "Break sponsors")}
            </span>
            <button
              type="button"
              onClick={() =>
                onPatch({
                  sponsors: [
                    ...session.sponsors,
                    { id: newLocalId("spn"), name: "", logo: "", url: "" },
                  ],
                })
              }
              className="text-[11px] text-brand hover:underline"
            >
              + {l("Dodaj", "Add")}
            </button>
          </div>
          {session.sponsors.map((sponsor, i) => (
            <SponsorRow
              key={sponsor.id}
              sponsor={sponsor}
              index={i}
              lang={lang}
              onPatch={(p) => patchSponsor(i, p)}
              onRemove={() => onPatch({ sponsors: session.sponsors.filter((_, j) => j !== i) })}
            />
          ))}
        </div>
      )}
    </ItemFrame>
  );
}

export function EventScheduleEditor({ c, lang, setContent }: Props) {
  const l = (pl: string, en: string) => (lang === "pl" ? pl : en);
  const days = parseScheduleDays(c);
  const commit = (next: ScheduleDay[]) => setContent("days", toJson(next));

  const patchDay = (i: number, patch: Partial<ScheduleDay>) =>
    commit(days.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  const removeDay = (i: number) => commit(days.filter((_, j) => j !== i));
  const addDay = () =>
    commit([
      ...days,
      {
        id: newLocalId("day"),
        label_pl: `Dzień ${days.length + 1}`,
        label_en: `Day ${days.length + 1}`,
        date: "",
        sessions: [],
      },
    ]);
  const addSession = (dayIndex: number) => {
    const day = days[dayIndex];
    patchDay(dayIndex, {
      sessions: [
        ...day.sessions,
        {
          id: newLocalId("ses"),
          timeStart: "",
          timeEnd: "",
          kind: "session",
          title_pl: "",
          title_en: "",
          description_pl: "",
          description_en: "",
          room: "",
          href: "",
          speakers: [],
          sponsors: [],
        },
      ],
    });
  };

  const columns = strOf(c.columns) || String(typeof c.columns === "number" ? c.columns : 2);

  return (
    <div className="space-y-3">
      <PropField label={l("Nagłówek", "Heading") + ` (${lang.toUpperCase()})`}>
        <Input
          value={strOf(c[`heading_${lang}`])}
          onChange={(e) => setContent(`heading_${lang}`, e.target.value)}
          className="h-8 text-xs"
          placeholder={l("Agenda", "Schedule")}
        />
      </PropField>
      <PropField label={l("Wstęp", "Intro") + ` (${lang.toUpperCase()})`}>
        <Textarea
          rows={2}
          value={strOf(c[`intro_${lang}`])}
          onChange={(e) => setContent(`intro_${lang}`, e.target.value)}
          className="text-xs"
        />
      </PropField>

      <div className="grid grid-cols-2 gap-2">
        <PropField label={l("Kolumny sesji", "Session columns")}>
          <Select value={columns} onValueChange={(v) => setContent("columns", Number(v))}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">1</SelectItem>
              <SelectItem value="2">2</SelectItem>
            </SelectContent>
          </Select>
        </PropField>
        <PropField label={l("Kolor akcentu", "Accent color")}>
          <ColorField
            value={strOf(c.accentColor)}
            onChange={(v) => setContent("accentColor", v ?? "")}
          />
        </PropField>
      </div>

      <div className="rounded-[6px] border border-border/60 bg-muted/30 p-2 space-y-2">
        <PropField label={l("Zakładki dni", "Day tabs")} inline>
          <Switch
            checked={c.showDayTabs !== false}
            onCheckedChange={(v) => setContent("showDayTabs", v)}
          />
        </PropField>
        <PropField
          label={l("Dialog profilu prelegenta", "Speaker profile dialog")}
          hint={l(
            "Klik na prelegencie z profilem otwiera profil prelegenta.",
            "Clicking a linked speaker opens the speaker profile.",
          )}
          inline
        >
          <Switch
            checked={c.openProfile !== false}
            onCheckedChange={(v) => setContent("openProfile", v)}
          />
        </PropField>
      </div>

      <ListShell title={l("Dni", "Days")} items={days as unknown as Item[]} onAdd={addDay}>
        <div className="space-y-2">
          {days.map((day, i) => (
            <ItemFrame
              key={day.id}
              title={
                (lang === "pl" ? day.label_pl : day.label_en) ||
                day.label_pl ||
                `${l("Dzień", "Day")} #${i + 1}`
              }
              onRemove={() => removeDay(i)}
            >
              <div className="mb-1">
                <MoveButtons
                  index={i}
                  count={days.length}
                  onMove={(dir) => commit(moveAt(days, i, dir))}
                  labelUp={l("Przesuń wyżej", "Move up")}
                  labelDown={l("Przesuń niżej", "Move down")}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <PropField label={`${l("Etykieta", "Label")} PL`}>
                  <Input
                    value={day.label_pl}
                    onChange={(e) => patchDay(i, { label_pl: e.target.value })}
                    className="h-8 text-xs"
                  />
                </PropField>
                <PropField label={`${l("Etykieta", "Label")} EN`}>
                  <Input
                    value={day.label_en}
                    onChange={(e) => patchDay(i, { label_en: e.target.value })}
                    className="h-8 text-xs"
                  />
                </PropField>
              </div>
              <PropField label={l("Data", "Date")}>
                <Input
                  type="date"
                  value={day.date}
                  onChange={(e) => patchDay(i, { date: e.target.value })}
                  className="h-8 text-xs"
                />
              </PropField>

              <div className="flex items-center justify-between pt-1">
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  {l("Sesje", "Sessions")} ({day.sessions.length})
                </span>
                <button
                  type="button"
                  onClick={() => addSession(i)}
                  className="text-[11px] text-brand hover:underline"
                >
                  + {l("Dodaj sesję", "Add session")}
                </button>
              </div>
              <div className="space-y-2">
                {day.sessions.map((session, j) => (
                  <SessionEditor
                    key={session.id}
                    session={session}
                    index={j}
                    count={day.sessions.length}
                    lang={lang}
                    onPatch={(p) =>
                      patchDay(i, {
                        sessions: day.sessions.map((s, k) => (k === j ? { ...s, ...p } : s)),
                      })
                    }
                    onMove={(dir) => patchDay(i, { sessions: moveAt(day.sessions, j, dir) })}
                    onRemove={() =>
                      patchDay(i, { sessions: day.sessions.filter((_, k) => k !== j) })
                    }
                  />
                ))}
              </div>
            </ItemFrame>
          ))}
        </div>
      </ListShell>
    </div>
  );
}
