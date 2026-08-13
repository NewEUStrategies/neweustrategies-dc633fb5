// Organism: "Speakers" widget editor. Nagłówek i18n + siatka prelegentów
// z polami (zdjęcie, imię, rola/kategoria PL/EN, statystyki, opis, link).
// Kategorie do filtra są automatycznie odczytywane z pola `category_${lang}`
// każdego speakera - nie trzymamy osobnej listy, żeby edycja była jednym
// źródłem prawdy. Zawiera walidację (URL zdjęcia, ocena 0-5), przełączniki
// wyszukiwarki/sortowania/paginacji oraz eksport/import JSON.
import { toJson } from "@/lib/builder/types";
import type { WidgetNode, Json } from "@/lib/builder/types";
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
import { PropField, ItemFrame, ColorField } from "../../atoms";
import { ListShell } from "./ListShell";
import { EventPicker } from "./EventPicker";
import { itemsOf, type Item } from "./shared";

interface Props {
  c: WidgetNode["content"];
  lang: "pl" | "en";
  setContent: (k: string, v: Json) => void;
}

const strOf = (v: unknown): string => (typeof v === "string" ? v : "");
const numOf = (v: unknown, fb = 0): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fb;
};

const URL_RE = /^(https?:\/\/|\/)[^\s]+$/i;
const IMAGE_URL_RE = /^(https?:\/\/|\/)[^\s]+(\.(jpe?g|png|webp|avif|gif|svg))(\?.*)?$/i;

/** Localised validators - the message goes straight into the field's error slot. */
type Translate = (pl: string, en: string) => string;

function validatePhoto(v: string, l: Translate): string | null {
  if (!v) return null;
  if (!URL_RE.test(v))
    return l("Nieprawidłowy URL (http(s)://… lub /…)", "Invalid URL (http(s)://… or /…)");
  if (!IMAGE_URL_RE.test(v))
    return l(
      "URL nie wygląda na obraz (jpg/png/webp/avif/gif/svg)",
      "The URL does not look like an image (jpg/png/webp/avif/gif/svg)",
    );
  return null;
}
function validateHref(v: string, l: Translate): string | null {
  if (!v) return null;
  if (!URL_RE.test(v))
    return l(
      "Link musi zaczynać się od / lub http(s)://",
      "The link must start with / or http(s)://",
    );
  return null;
}
function validateRating(v: number, l: Translate): string | null {
  if (v < 0 || v > 5)
    return l("Ocena musi mieścić się w zakresie 0-5", "The rating must be between 0 and 5");
  return null;
}
function validateNonNeg(v: number, l: Translate): string | null {
  if (v < 0) return l("Wartość nie może być ujemna", "The value cannot be negative");
  return null;
}

export function SpeakersEditor({ c, lang, setContent }: Props) {
  const speakers = itemsOf(c, "speakers");
  const commit = (next: Item[]) => setContent("speakers", toJson(next));
  const patch = (i: number, p: Partial<Item>) =>
    commit(speakers.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const remove = (i: number) => commit(speakers.filter((_, j) => j !== i));
  const duplicate = (i: number) =>
    commit([
      ...speakers.slice(0, i + 1),
      { ...speakers[i], id: `sp-${Date.now().toString(36)}` },
      ...speakers.slice(i + 1),
    ]);

  const itemIds = speakers.map((s, i) => (typeof s.id === "string" && s.id ? s.id : `sp-idx-${i}`));
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
    commit(arrayMove(speakers, from, to));
  };
  const add = () =>
    commit([
      ...speakers,
      {
        id: `sp-${Date.now().toString(36)}`,
        photo: "",
        name: "",
        role_pl: "",
        role_en: "",
        category_pl: "",
        category_en: "",
        gigs: 0,
        rating: 0,
        reviews: 0,
        description_pl: "",
        description_en: "",
        href: "",
      },
    ]);

  const columns = numOf(c.columns, 3);
  const accent = strOf(c.accentColor);
  const enableSearch = (c as Record<string, unknown>).enableSearch !== false;
  const enableSort = (c as Record<string, unknown>).enableSort !== false;
  const pageSize = numOf((c as Record<string, unknown>).pageSize, 0);
  const sourceRaw = strOf(c.source);
  const source: "manual" | "directory" | "event" =
    sourceRaw === "directory" || sourceRaw === "event" ? sourceRaw : "manual";
  const openProfile = (c as Record<string, unknown>).openProfile !== false;

  const l = (pl: string, en: string) => (lang === "pl" ? pl : en);

  // Podpowiedzi kategorii (datalist) z już wpisanych wartości - pomagają
  // utrzymać spójne nazwy, od których zależą filtry w widoku publicznym.
  const categorySuggestions = {
    pl: [...new Set(speakers.map((s) => strOf(s.category_pl).trim()).filter(Boolean))],
    en: [...new Set(speakers.map((s) => strOf(s.category_en).trim()).filter(Boolean))],
  };


  return (
    <div className="space-y-3">
      <PropField label={l("Nagłówek", "Heading") + ` (${lang.toUpperCase()})`}>
        <Input
          value={strOf(c[`heading_${lang}`])}
          onChange={(e) => setContent(`heading_${lang}`, e.target.value)}
          className="h-8 text-xs"
          placeholder={l("Prelegenci", "Speakers")}
        />
      </PropField>

      <div className="grid grid-cols-2 gap-2">
        <PropField label={l("Liczba kolumn", "Columns")}>
          <Select value={String(columns)} onValueChange={(v) => setContent("columns", Number(v))}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="2">2</SelectItem>
              <SelectItem value="3">3</SelectItem>
              <SelectItem value="4">4</SelectItem>
            </SelectContent>
          </Select>
        </PropField>
        <PropField label={l("Kolor akcentu", "Accent color")}>
          <ColorField value={accent} onChange={(v) => setContent("accentColor", v ?? "")} />
        </PropField>
      </div>

      <div className="rounded-[6px] border border-border/60 bg-muted/30 p-2 space-y-2">
        <PropField
          label={l("Źródło danych", "Data source")}
          hint={l(
            "Profile prelegentów są powiązane z CRM i profilem eksperta.",
            "Speaker profiles are linked to the CRM and the expert profile.",
          )}
        >
          <Select value={source} onValueChange={(v) => setContent("source", v)}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="manual">{l("Ręczna lista", "Manual list")}</SelectItem>
              <SelectItem value="directory">
                {l("Profile prelegentów (CRM)", "Speaker profiles (CRM)")}
              </SelectItem>
              <SelectItem value="event">{l("Prelegenci wydarzenia", "Event speakers")}</SelectItem>
            </SelectContent>
          </Select>
        </PropField>
        {source === "event" && (
          <PropField label={l("Wydarzenie", "Event")}>
            <EventPicker
              value={strOf(c.eventId)}
              onChange={(id) => setContent("eventId", id)}
              lang={lang}
            />
          </PropField>
        )}
        {source === "directory" && (
          <PropField label={l("Limit profili", "Profile limit")}>
            <Input
              type="number"
              min={1}
              max={200}
              value={numOf((c as Record<string, unknown>).limit, 24)}
              onChange={(e) =>
                setContent("limit", Math.max(1, Math.min(200, Number(e.target.value) || 24)))
              }
              className="h-8 text-xs"
            />
          </PropField>
        )}
        {source !== "manual" && (
          <PropField
            label={l("Dialog profilu prelegenta", "Speaker profile dialog")}
            hint={l(
              "Klik na karcie otwiera profil prelegenta z listą wystąpień.",
              "Clicking a card opens the speaker profile with engagements.",
            )}
            inline
          >
            <Switch checked={openProfile} onCheckedChange={(v) => setContent("openProfile", v)} />
          </PropField>
        )}
      </div>

      <div className="rounded-[6px] border border-border/60 bg-muted/30 p-2 space-y-2">
        <PropField
          label={l("Wyszukiwarka", "Search box")}
          hint={l("Filtruje po imieniu, roli, opisie", "Filters by name, role, description")}
          inline
        >
          <Switch checked={enableSearch} onCheckedChange={(v) => setContent("enableSearch", v)} />
        </PropField>
        <PropField
          label={l("Sortowanie", "Sorting")}
          hint={l("Ocena / wystąpienia / opinie", "Rating / gigs / reviews")}
          inline
        >
          <Switch checked={enableSort} onCheckedChange={(v) => setContent("enableSort", v)} />
        </PropField>
        <PropField
          label={l("Paginacja (0 = wyłączona)", "Page size (0 = disabled)")}
          hint={l(
            "Liczba prelegentów na stronę + przycisk Pokaż więcej",
            "Speakers per page + Load more",
          )}
        >
          <Input
            type="number"
            min={0}
            step={1}
            value={pageSize}
            onChange={(e) => setContent("pageSize", Math.max(0, Number(e.target.value) || 0))}
            className="h-8 text-xs"
          />
        </PropField>
        {pageSize > 0 && (
          <PropField
            label={l("Tryb doładowywania", "Load-more mode")}
            hint={l(
              "Przycisk = ręczne kliknięcie. Scroll = auto-doładowanie przy przewijaniu.",
              "Button = manual click. Scroll = auto-load on scroll.",
            )}
          >
            <Select
              value={strOf((c as Record<string, unknown>).pageMode) || "button"}
              onValueChange={(v) => setContent("pageMode", v)}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="button">
                  {l("Przycisk Pokaż więcej", "Load more button")}
                </SelectItem>
                <SelectItem value="scroll">
                  {l("Wczytaj przy scrollu", "Load on scroll")}
                </SelectItem>
              </SelectContent>
            </Select>
          </PropField>
        )}
      </div>

      {source !== "manual" ? (
        <p className="text-[10px] leading-snug text-muted-foreground/70">
          {l(
            "Lista poniżej jest używana tylko w trybie ręcznym. W trybach CRM karty pochodzą z publicznych profili prelegentów.",
            "The list below is used only in manual mode. In CRM modes cards come from public speaker profiles.",
          )}
        </p>
      ) : (
        <ListShell
          title={l("Prelegenci", "Speakers")}
          items={speakers as unknown as Item[]}
          onAdd={add}
        >
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
              <div className="space-y-2">
                {speakers.map((it, i) => (
                  <SortableSpeakerRow
                    key={itemIds[i]}
                    id={itemIds[i]}
                    item={it}
                    index={i}
                    lang={lang}
                    categorySuggestions={categorySuggestions}
                    onPatch={(p) => patch(i, p)}
                    onRemove={() => remove(i)}
                    onDuplicate={() => duplicate(i)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </ListShell>
      )}
    </div>
  );
}

interface RowProps {
  id: string;
  item: Item;
  index: number;
  lang: "pl" | "en";
  categorySuggestions: { pl: string[]; en: string[] };
  onPatch: (p: Partial<Item>) => void;
  onRemove: () => void;
  onDuplicate: () => void;
}

function SortableSpeakerRow({
  id,
  item: it,
  index: i,
  lang,
  categorySuggestions,
  onPatch,
  onRemove,
  onDuplicate,
}: RowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });
  const l = (pl: string, en: string) => (lang === "pl" ? pl : en);
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const photo = strOf(it.photo);
  const href = strOf(it.href);
  const rating = numOf(it.rating);
  const gigs = numOf(it.gigs);
  const reviews = numOf(it.reviews);
  const photoErr = validatePhoto(photo, l);
  const hrefErr = validateHref(href, l);
  const ratingErr = validateRating(rating, l);
  const gigsErr = validateNonNeg(gigs, l);
  const reviewsErr = validateNonNeg(reviews, l);

  return (
    <div ref={setNodeRef} style={style}>
      <ItemFrame title={strOf(it.name) || `#${i + 1}`} onRemove={onRemove}>
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
            title={l("Duplikuj prelegenta", "Duplicate speaker")}
            aria-label={l("Duplikuj prelegenta", "Duplicate speaker")}
            className="p-1 rounded text-muted-foreground hover:bg-accent"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
          {photo && !photoErr && (
            <img
              src={photo}
              alt=""
              className="ml-auto h-8 w-8 rounded-[6px] object-cover border border-border/60"
            />
          )}
        </div>

        <PropField label={l("Zdjęcie (URL)", "Photo (URL)")}>
          <Input
            value={photo}
            onChange={(e) => onPatch({ photo: e.target.value })}
            placeholder="https://…"
            className={
              "h-8 text-xs " + (photoErr ? "border-destructive focus-visible:ring-destructive" : "")
            }
            aria-invalid={photoErr ? true : undefined}
          />
          {photoErr && <p className="text-[10px] text-destructive mt-0.5">{photoErr}</p>}
        </PropField>
        <PropField label={l("Imię i nazwisko", "Full name")}>
          <Input
            value={strOf(it.name)}
            onChange={(e) => onPatch({ name: e.target.value })}
            className="h-8 text-xs"
          />
        </PropField>

        <div className="grid grid-cols-2 gap-2">
          <PropField label={`${l("Rola", "Role")} PL`}>
            <Input
              value={strOf(it.role_pl)}
              onChange={(e) => onPatch({ role_pl: e.target.value })}
              className="h-8 text-xs"
            />
          </PropField>
          <PropField label={`${l("Rola", "Role")} EN`}>
            <Input
              value={strOf(it.role_en)}
              onChange={(e) => onPatch({ role_en: e.target.value })}
              className="h-8 text-xs"
            />
          </PropField>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <PropField label={`${l("Kategoria", "Category")} PL`}>
            <Input
              value={strOf(it.category_pl)}
              onChange={(e) => onPatch({ category_pl: e.target.value })}
              className="h-8 text-xs"
              list={`speakers-cats-pl-${id}`}
            />
            <datalist id={`speakers-cats-pl-${id}`}>
              {categorySuggestions.pl.map((cat) => (
                <option key={cat} value={cat} />
              ))}
            </datalist>
          </PropField>
          <PropField label={`${l("Kategoria", "Category")} EN`}>
            <Input
              value={strOf(it.category_en)}
              onChange={(e) => onPatch({ category_en: e.target.value })}
              className="h-8 text-xs"
              list={`speakers-cats-en-${id}`}
            />
            <datalist id={`speakers-cats-en-${id}`}>
              {categorySuggestions.en.map((cat) => (
                <option key={cat} value={cat} />
              ))}
            </datalist>
          </PropField>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <PropField label={l("Wystąpienia", "Gigs")}>
            <Input
              type="number"
              min={0}
              value={gigs}
              onChange={(e) => onPatch({ gigs: Number(e.target.value) || 0 })}
              className={"h-8 text-xs " + (gigsErr ? "border-destructive" : "")}
            />
            {gigsErr && <p className="text-[10px] text-destructive mt-0.5">{gigsErr}</p>}
          </PropField>
          <PropField label={l("Ocena (0-5)", "Rating (0-5)")}>
            <Input
              type="number"
              min={0}
              max={5}
              step={0.1}
              value={rating}
              onChange={(e) => onPatch({ rating: Number(e.target.value) || 0 })}
              className={"h-8 text-xs " + (ratingErr ? "border-destructive" : "")}
            />
            {ratingErr && <p className="text-[10px] text-destructive mt-0.5">{ratingErr}</p>}
          </PropField>
          <PropField label={l("Opinie", "Reviews")}>
            <Input
              type="number"
              min={0}
              value={reviews}
              onChange={(e) => onPatch({ reviews: Number(e.target.value) || 0 })}
              className={"h-8 text-xs " + (reviewsErr ? "border-destructive" : "")}
            />
            {reviewsErr && <p className="text-[10px] text-destructive mt-0.5">{reviewsErr}</p>}
          </PropField>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <PropField label={`${l("Opis", "Description")} PL`}>
            <Textarea
              rows={2}
              value={strOf(it.description_pl)}
              onChange={(e) => onPatch({ description_pl: e.target.value })}
              className="text-xs"
            />
          </PropField>
          <PropField label={`${l("Opis", "Description")} EN`}>
            <Textarea
              rows={2}
              value={strOf(it.description_en)}
              onChange={(e) => onPatch({ description_en: e.target.value })}
              className="text-xs"
            />
          </PropField>
        </div>

        <PropField
          label={l("Link (opcjonalny)", "Link (optional)")}
          hint={l("np. /author/imie-nazwisko", "e.g. /author/first-last")}
        >
          <Input
            value={href}
            onChange={(e) => onPatch({ href: e.target.value })}
            placeholder="/author/…"
            className={"h-8 text-xs " + (hrefErr ? "border-destructive" : "")}
            aria-invalid={hrefErr ? true : undefined}
          />
          {hrefErr && <p className="text-[10px] text-destructive mt-0.5">{hrefErr}</p>}
        </PropField>
      </ItemFrame>
    </div>
  );
}
