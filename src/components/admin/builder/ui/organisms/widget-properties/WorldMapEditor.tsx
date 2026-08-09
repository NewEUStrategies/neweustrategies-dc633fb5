// Organism: edytor widgetu „Mapa świata".
//
// Trzy rzeczy, których nie da się wyrazić schematem deklaratywnym i dlatego
// mają własny edytor:
//   1. LISTA POŁĄCZEŃ - para punktów na łuk, z sortowaniem przeciąganiem,
//      duplikowaniem i walidacją współrzędnych (poza zakresem -> czerwone pole,
//      renderer i tak takie połączenie pominie, więc autor musi to widzieć);
//   2. WYBÓR KRAJU jako sposób wpisania współrzędnych - autor prawie nigdy nie
//      zna lat/lng, za to zawsze wie „skąd" jest punkt. Picker WPISUJE centroid
//      kraju w pola lat/lng i nie zapisuje żadnego własnego klucza, więc panel
//      i renderer nadal rozmawiają wyłącznie o współrzędnych;
//   3. PODPIĘCIE PROFILU PLATFORMY - w trybie „Eksperci" koniec łuku wskazuje
//      publiczny profil; etykieta i odsyłacz pochodzą wtedy z żywego profilu,
//      a wpisany tekst zostaje wyłącznie jako zapas (np. gdy profil zniknie).
//
// Kolory (linia, kropki lądu, znaczniki, tło) siedzą tu, a nie w schemacie,
// żeby autor miał je obok podglądu listy - reszta ustawień skalarnych zostaje
// w `WIDGET_SCHEMAS["world-map"]` i panel dorysowuje ją pod tym edytorem.
import { useMemo, useState } from "react";
import { toJson, type Json, type WidgetNode } from "@/lib/builder/types";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { GripVertical, Copy } from "@/lib/lucide-shim";
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { COUNTRY_CENTROIDS } from "@/lib/maps/countryCentroids";
import { coerceLat, coerceLng } from "@/lib/maps/worldMapGeo";
import { PropField, ItemFrame, ColorField } from "../../atoms";
import { ListShell } from "./ListShell";
import { ProfilePicker } from "./ProfilePicker";
import { itemsOf, type Item } from "./shared";

interface Props {
  c: WidgetNode["content"];
  lang: "pl" | "en";
  setContent: (k: string, v: Json) => void;
}

/**
 * Klucze treści, które ten edytor obsługuje sam. Panel dorysowuje pod nim
 * WYŁĄCZNIE pola schematu spoza tego zbioru (patrz `unhandledSchemaFields`),
 * więc żadne ustawienie nie pojawi się w dwóch miejscach naraz.
 */
export const WORLD_MAP_EDITOR_HANDLED_KEYS: ReadonlySet<string> = new Set<string>([
  "source",
  "connections",
  "lineColor",
  "dotColor",
  "pointColor",
  "bgColor",
]);

const strOf = (v: unknown): string => (typeof v === "string" ? v : "");
const numOf = (v: unknown, fb = 0): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fb;
};

type Translate = (pl: string, en: string) => string;

/** Nowe połączenie dziedziczy początek po ostatnim - typowy układ „centrala -> świat". */
function newConnection(previous: Item | undefined): Item {
  const id = `wm-${Date.now().toString(36)}`;
  return {
    id,
    startLabel_pl: strOf(previous?.startLabel_pl),
    startLabel_en: strOf(previous?.startLabel_en),
    startLat: numOf(previous?.startLat, 50.85),
    startLng: numOf(previous?.startLng, 4.35),
    startUserId: "",
    endLabel_pl: "",
    endLabel_en: "",
    endLat: 0,
    endLng: 0,
    endUserId: "",
    href: "",
  };
}

export function WorldMapEditor({ c, lang, setContent }: Props) {
  const l: Translate = (pl, en) => (lang === "pl" ? pl : en);
  const connections = itemsOf(c, "connections");
  const source = strOf(c.source) === "experts" ? "experts" : "manual";

  const commit = (next: Item[]) => setContent("connections", toJson(next));
  const patch = (i: number, p: Partial<Item>) =>
    commit(connections.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const remove = (i: number) => commit(connections.filter((_, j) => j !== i));
  const duplicate = (i: number) =>
    commit([
      ...connections.slice(0, i + 1),
      { ...connections[i], id: `wm-${Date.now().toString(36)}` },
      ...connections.slice(i + 1),
    ]);
  const add = () => commit([...connections, newConnection(connections[connections.length - 1])]);

  const itemIds = connections.map((x, i) =>
    typeof x.id === "string" && x.id ? x.id : `wm-idx-${i}`,
  );
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = itemIds.indexOf(String(active.id));
    const to = itemIds.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    commit(arrayMove(connections, from, to));
  };

  return (
    <div className="space-y-3">
      <div className="rounded-[6px] border border-border/60 bg-muted/30 p-2 space-y-2">
        <PropField
          label={l("Źródło etykiet", "Label source")}
          hint={l(
            "Eksperci: koniec łuku podpięty pod profil pokazuje żywe imię i nazwisko oraz prowadzi do publicznego profilu na platformie.",
            "Experts: an endpoint bound to a profile shows the live full name and links to the public profile on the platform.",
          )}
        >
          <Select value={source} onValueChange={(v) => setContent("source", v)}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="manual">{l("Wpisane ręcznie", "Typed manually")}</SelectItem>
              <SelectItem value="experts">
                {l("Eksperci / profile platformy", "Experts / platform profiles")}
              </SelectItem>
            </SelectContent>
          </Select>
        </PropField>
        <p className="text-[10px] leading-snug text-muted-foreground/70">
          {l(
            "Współrzędne zawsze pochodzą z panelu - platforma nie publikuje lokalizacji osób. Wybierz kraj, a pola szerokości i długości wypełnią się same.",
            "Coordinates always come from this panel - the platform does not publish people's locations. Pick a country and the latitude / longitude fields fill in automatically.",
          )}
        </p>
      </div>

      <div className="rounded-[6px] border border-border/60 bg-muted/30 p-2 space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <PropField label={l("Kolor łuków", "Arc color")}>
            <ColorField
              value={strOf(c.lineColor)}
              onChange={(v) => setContent("lineColor", v ?? "")}
              inheritedValue="var(--brand)"
            />
          </PropField>
          <PropField label={l("Kolor znaczników", "Marker color")}>
            <ColorField
              value={strOf(c.pointColor)}
              onChange={(v) => setContent("pointColor", v ?? "")}
              inheritedValue="var(--brand)"
            />
          </PropField>
          <PropField label={l("Kolor kropek lądu", "Land dot color")}>
            <ColorField
              value={strOf(c.dotColor)}
              onChange={(v) => setContent("dotColor", v ?? "")}
            />
          </PropField>
          <PropField label={l("Tło mapy", "Map background")}>
            <ColorField value={strOf(c.bgColor)} onChange={(v) => setContent("bgColor", v ?? "")} />
          </PropField>
        </div>
        <p className="text-[10px] leading-snug text-muted-foreground/70">
          {l(
            "Puste pole = kolor z motywu (marka / tekst), więc mapa sama nadąża za zmianą kolorystyki serwisu i trybem ciemnym.",
            "An empty field = the theme color (brand / text), so the map follows a site palette change and dark mode on its own.",
          )}
        </p>
      </div>

      <ListShell
        title={l("Połączenia", "Connections")}
        items={connections as unknown as Item[]}
        onAdd={add}
      >
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
            <div className="space-y-2">
              {connections.map((it, i) => (
                <SortableConnectionRow
                  key={itemIds[i]}
                  id={itemIds[i]}
                  item={it}
                  index={i}
                  lang={lang}
                  source={source}
                  onPatch={(p) => patch(i, p)}
                  onRemove={() => remove(i)}
                  onDuplicate={() => duplicate(i)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </ListShell>
    </div>
  );
}

interface RowProps {
  id: string;
  item: Item;
  index: number;
  lang: "pl" | "en";
  source: "manual" | "experts";
  onPatch: (p: Partial<Item>) => void;
  onRemove: () => void;
  onDuplicate: () => void;
}

function SortableConnectionRow({
  id,
  item: it,
  index: i,
  lang,
  source,
  onPatch,
  onRemove,
  onDuplicate,
}: RowProps) {
  const l: Translate = (pl, en) => (lang === "pl" ? pl : en);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  // Tytuł ramki: „skąd → dokąd" po etykietach języka panelu, a gdy autor jeszcze
  // nic nie wpisał - numer pozycji, żeby lista dała się w ogóle nawigować.
  const startTitle = strOf(it[`startLabel_${lang}`]) || strOf(it.startLabel_pl);
  const endTitle = strOf(it[`endLabel_${lang}`]) || strOf(it.endLabel_pl);
  const frameTitle =
    startTitle || endTitle
      ? `${startTitle || l("Początek", "Start")} → ${endTitle || l("Koniec", "End")}`
      : `#${i + 1}`;

  return (
    <div ref={setNodeRef} style={style}>
      <ItemFrame title={frameTitle} onRemove={onRemove}>
        <div className="mb-1 flex items-center gap-1">
          <button
            type="button"
            {...attributes}
            {...listeners}
            title={l("Przeciągnij aby zmienić kolejność", "Drag to reorder")}
            aria-label={l("Przeciągnij aby zmienić kolejność", "Drag to reorder")}
            className="p-1 rounded text-muted-foreground hover:bg-accent cursor-grab active:cursor-grabbing"
          >
            <GripVertical className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onDuplicate}
            title={l("Duplikuj połączenie", "Duplicate connection")}
            aria-label={l("Duplikuj połączenie", "Duplicate connection")}
            className="p-1 rounded text-muted-foreground hover:bg-accent"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
        </div>

        <EndpointFields
          rowId={`${id}-start`}
          lang={lang}
          source={source}
          heading={l("Początek łuku", "Arc start")}
          labelPl={strOf(it.startLabel_pl)}
          labelEn={strOf(it.startLabel_en)}
          lat={numOf(it.startLat)}
          lng={numOf(it.startLng)}
          userId={strOf(it.startUserId)}
          onLabel={(l2, v) => onPatch({ [`startLabel_${l2}`]: v })}
          onLat={(v) => onPatch({ startLat: v })}
          onLng={(v) => onPatch({ startLng: v })}
          onUserId={(v) => onPatch({ startUserId: v })}
        />

        <EndpointFields
          rowId={`${id}-end`}
          lang={lang}
          source={source}
          heading={l("Koniec łuku", "Arc end")}
          labelPl={strOf(it.endLabel_pl)}
          labelEn={strOf(it.endLabel_en)}
          lat={numOf(it.endLat)}
          lng={numOf(it.endLng)}
          userId={strOf(it.endUserId)}
          onLabel={(l2, v) => onPatch({ [`endLabel_${l2}`]: v })}
          onLat={(v) => onPatch({ endLat: v })}
          onLng={(v) => onPatch({ endLng: v })}
          onUserId={(v) => onPatch({ endUserId: v })}
        />

        <PropField
          label={l("Link (opcjonalny)", "Link (optional)")}
          hint={l(
            "Używany, gdy punkt nie jest podpięty pod profil platformy.",
            "Used when the point is not bound to a platform profile.",
          )}
        >
          <Input
            value={strOf(it.href)}
            onChange={(e) => onPatch({ href: e.target.value })}
            placeholder="/…"
            className="h-8 text-xs"
          />
        </PropField>
      </ItemFrame>
    </div>
  );
}

interface EndpointProps {
  rowId: string;
  lang: "pl" | "en";
  source: "manual" | "experts";
  heading: string;
  labelPl: string;
  labelEn: string;
  lat: number;
  lng: number;
  userId: string;
  onLabel: (lang: "pl" | "en", value: string) => void;
  onLat: (v: number) => void;
  onLng: (v: number) => void;
  onUserId: (v: string) => void;
}

function EndpointFields({
  rowId,
  lang,
  source,
  heading,
  labelPl,
  labelEn,
  lat,
  lng,
  userId,
  onLabel,
  onLat,
  onLng,
  onUserId,
}: EndpointProps) {
  const l: Translate = (pl, en) => (lang === "pl" ? pl : en);
  const [country, setCountry] = useState("");
  const latErr = coerceLat(lat) === null;
  const lngErr = coerceLng(lng) === null;

  // Lista krajów posortowana alfabetycznie w języku panelu; nazwy angielskie
  // pochodzą z tego samego zasobu geo, z którego liczone są centroidy.
  const countries = useMemo(
    () => [...COUNTRY_CENTROIDS].sort((a, b) => a.en.localeCompare(b.en)),
    [],
  );

  const pickCountry = (id: string) => {
    setCountry(id);
    const hit = COUNTRY_CENTROIDS.find((x) => x.id === id);
    if (!hit) return;
    onLat(hit.lat);
    onLng(hit.lng);
  };

  return (
    <div className="rounded-[6px] border border-border/60 bg-muted/20 p-2 space-y-2">
      <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {heading}
      </p>

      {source === "experts" && (
        <PropField
          label={l("Profil na platformie", "Platform profile")}
          hint={l(
            "Podpięty profil nadpisuje etykietę i link punktu.",
            "A bound profile overrides the point's label and link.",
          )}
        >
          <ProfilePicker
            value={userId}
            onPick={(hit) => onUserId(hit.id)}
            onClear={() => onUserId("")}
            lang={lang}
          />
        </PropField>
      )}

      <div className="grid grid-cols-2 gap-2">
        <PropField label={`${l("Etykieta", "Label")} PL`}>
          <Input
            value={labelPl}
            onChange={(e) => onLabel("pl", e.target.value)}
            className="h-8 text-xs"
          />
        </PropField>
        <PropField label={`${l("Etykieta", "Label")} EN`}>
          <Input
            value={labelEn}
            onChange={(e) => onLabel("en", e.target.value)}
            className="h-8 text-xs"
          />
        </PropField>
      </div>

      <PropField
        label={l("Kraj (wypełnia współrzędne)", "Country (fills the coordinates)")}
        hint={l(
          "Skrót do środka kraju - potem można doprecyzować lat/lng ręcznie.",
          "A shortcut to the country's centre - latitude / longitude can still be fine-tuned by hand.",
        )}
      >
        <Select value={country} onValueChange={pickCountry}>
          <SelectTrigger className="h-8 text-xs" id={`${rowId}-country`}>
            <SelectValue placeholder={l("Wybierz kraj…", "Pick a country…")} />
          </SelectTrigger>
          <SelectContent>
            {countries.map((x) => (
              <SelectItem key={x.id} value={x.id}>
                {x.en} ({x.id})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </PropField>

      <div className="grid grid-cols-2 gap-2">
        <PropField label={l("Szerokość (lat)", "Latitude")}>
          <Input
            type="number"
            step={0.01}
            min={-90}
            max={90}
            value={lat}
            onChange={(e) => onLat(Number(e.target.value) || 0)}
            className={"h-8 text-xs " + (latErr ? "border-destructive" : "")}
            aria-invalid={latErr ? true : undefined}
          />
          {latErr && (
            <p className="text-[10px] text-destructive mt-0.5">
              {l("Zakres -90…90", "Range -90…90")}
            </p>
          )}
        </PropField>
        <PropField label={l("Długość (lng)", "Longitude")}>
          <Input
            type="number"
            step={0.01}
            min={-180}
            max={180}
            value={lng}
            onChange={(e) => onLng(Number(e.target.value) || 0)}
            className={"h-8 text-xs " + (lngErr ? "border-destructive" : "")}
            aria-invalid={lngErr ? true : undefined}
          />
          {lngErr && (
            <p className="text-[10px] text-destructive mt-0.5">
              {l("Zakres -180…180", "Range -180…180")}
            </p>
          )}
        </PropField>
      </div>
    </div>
  );
}
