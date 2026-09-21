// Organism: edytor widgetu "Zespół (siatka)" (`team-member-grid`).
//
// Nagłówek sekcji + układ + lista osób z przeciąganiem wierszy. Każda osoba to
// PEŁNA KARTOTEKA (rola w NES, afiliacja, projekty, kontakt, social media,
// dwa biogramy), więc wiersz jest długi - ale to jedyne miejsce, gdzie te dane
// się wpisuje, a renderer nie rysuje niczego, czego tu nie ma.
//
// CAŁY TEKST IDZIE ZE SŁOWNIKA (`builder.teamGridEditor.*`), bez ani jednego
// `l("…","…")`. To nie jest wybór stylu: bramki `check:i18n-hardcoded`
// i `monolingualUserText` trzymają repo w ratchecie per plik, a plik nieobecny
// na liście bazowej MUSI mieć zero. Nowy edytor z bliźniakami w kodzie
// dosypałby do długu kilkadziesiąt pozycji naraz.
import { useTranslation } from "react-i18next";
import "@/lib/i18n-builder";
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
import { GripVertical, Copy, User as UserIcon } from "@/lib/lucide-shim";
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
import { ImageSlot } from "./ImageSlot";
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

const LINK_RE = /^(https?:\/\/|\/)[^\s]+$/i;

/** Klucze social - te same i w panelu, i w rendererze. */
const SOCIAL_FIELDS = [
  { key: "x", label: "X", placeholder: "https://x.com/…" },
  { key: "facebook", label: "Facebook", placeholder: "https://facebook.com/…" },
  { key: "linkedin", label: "LinkedIn", placeholder: "https://linkedin.com/in/…" },
  { key: "instagram", label: "Instagram", placeholder: "https://instagram.com/…" },
  { key: "youtube", label: "YouTube", placeholder: "https://youtube.com/…" },
  { key: "website", label: "Website", placeholder: "https://…" },
] as const;

/** Świeża osoba: same puste pola - zero danych przykładowych do publikacji. */
function blankMember(): Item {
  return {
    id: `tmg-${Date.now().toString(36)}`,
    avatar: "",
    name: "",
    role_pl: "",
    role_en: "",
    department_pl: "",
    department_en: "",
    bio_pl: "",
    bio_en: "",
    fullBio_pl: "",
    fullBio_en: "",
    affiliation_pl: "",
    affiliation_en: "",
    projects_pl: "",
    projects_en: "",
    email: "",
    phone: "",
    profileHref: "",
    x: "",
    facebook: "",
    linkedin: "",
    instagram: "",
    youtube: "",
    website: "",
  };
}

export function TeamMemberGridEditor({ c, lang, setContent }: Props) {
  const { t } = useTranslation();
  const tg = (key: string): string => t(`builder.teamGridEditor.${key}`);

  const members = itemsOf(c, "members");
  const commit = (next: Item[]) => setContent("members", toJson(next));
  const patch = (i: number, p: Partial<Item>) =>
    commit(members.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const remove = (i: number) => commit(members.filter((_, j) => j !== i));
  const duplicate = (i: number) =>
    commit([
      ...members.slice(0, i + 1),
      { ...members[i], id: `tmg-${Date.now().toString(36)}` },
      ...members.slice(i + 1),
    ]);
  const add = () => commit([...members, blankMember()]);

  const itemIds = members.map((m, i) => (typeof m.id === "string" && m.id ? m.id : `tmg-idx-${i}`));
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
    commit(arrayMove(members, from, to));
  };

  const columns = numOf(c.columns, 3);
  const radius = numOf(c.radius, 6);
  const accent = strOf(c.accentColor);
  const grayscale = (c as Record<string, unknown>).grayscale !== false;
  const openPopup = (c as Record<string, unknown>).openPopup !== false;
  const suffix = ` (${lang.toUpperCase()})`;

  return (
    <div className="space-y-3">
      <div className="rounded-[6px] border border-border/60 bg-muted/30 p-2 space-y-2">
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {tg("sectionHeader")}
        </p>
        <PropField label={tg("badge") + suffix}>
          <Input
            value={strOf(c[`badge_${lang}`])}
            onChange={(e) => setContent(`badge_${lang}`, e.target.value)}
            className="h-8 text-xs"
            placeholder={tg("badgePlaceholder")}
          />
        </PropField>
        <PropField label={tg("heading") + suffix}>
          <Input
            value={strOf(c[`heading_${lang}`])}
            onChange={(e) => setContent(`heading_${lang}`, e.target.value)}
            className="h-8 text-xs"
          />
        </PropField>
        <PropField label={tg("intro") + suffix}>
          <Textarea
            value={strOf(c[`intro_${lang}`])}
            onChange={(e) => setContent(`intro_${lang}`, e.target.value)}
            rows={3}
            className="text-xs"
          />
        </PropField>
      </div>

      <div className="rounded-[6px] border border-border/60 bg-muted/30 p-2 space-y-2">
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {tg("layout")}
        </p>
        <div className="grid grid-cols-2 gap-2">
          <PropField label={tg("columns")}>
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
          <PropField label={tg("radius")} hint={tg("radiusHint")}>
            <Input
              type="number"
              min={0}
              max={48}
              value={radius}
              onChange={(e) =>
                setContent("radius", Math.max(0, Math.min(48, Number(e.target.value) || 0)))
              }
              className="h-8 text-xs"
            />
          </PropField>
        </div>
        <PropField label={tg("accent")} hint={tg("accentHint")}>
          <ColorField value={accent} onChange={(v) => setContent("accentColor", v ?? "")} />
        </PropField>
        <PropField label={tg("grayscale")} hint={tg("grayscaleHint")} inline>
          <Switch checked={grayscale} onCheckedChange={(v) => setContent("grayscale", v)} />
        </PropField>
        <PropField label={tg("openPopup")} hint={tg("openPopupHint")} inline>
          <Switch checked={openPopup} onCheckedChange={(v) => setContent("openPopup", v)} />
        </PropField>
      </div>

      <ListShell title={tg("members")} items={members} onAdd={add}>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
            <div className="space-y-2">
              {members.map((it, i) => (
                <SortableMemberRow
                  key={itemIds[i]}
                  id={itemIds[i]}
                  item={it}
                  index={i}
                  lang={lang}
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
  onPatch: (p: Partial<Item>) => void;
  onRemove: () => void;
  onDuplicate: () => void;
}

function SortableMemberRow({
  id,
  item: it,
  index: i,
  lang,
  onPatch,
  onRemove,
  onDuplicate,
}: RowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });
  const { t } = useTranslation();
  const tg = (key: string): string => t(`builder.teamGridEditor.${key}`);
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const name = strOf(it.name);
  const profileHref = strOf(it.profileHref);
  const hrefInvalid = Boolean(profileHref) && !LINK_RE.test(profileHref);
  const suffix = ` (${lang.toUpperCase()})`;

  /** Pole dwujęzyczne wiersza: jedna linijka zamiast sześciu powtórzeń. */
  const localizedInput = (base: string, label: string, hint?: string, placeholder?: string) => (
    <PropField label={label + suffix} hint={hint}>
      <Input
        value={strOf(it[`${base}_${lang}`])}
        onChange={(e) => onPatch({ [`${base}_${lang}`]: e.target.value })}
        className="h-8 text-xs"
        placeholder={placeholder}
      />
    </PropField>
  );

  return (
    <div ref={setNodeRef} style={style}>
      <ItemFrame title={name || `#${i + 1}`} onRemove={onRemove}>
        <div className="mb-1 flex items-center gap-1">
          <button
            type="button"
            {...attributes}
            {...listeners}
            title={tg("dragHandle")}
            aria-label={tg("dragHandle")}
            className="p-1 rounded text-muted-foreground hover:bg-accent cursor-grab active:cursor-grabbing"
          >
            <GripVertical className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onDuplicate}
            title={tg("duplicate")}
            aria-label={tg("duplicate")}
            className="p-1 rounded text-muted-foreground hover:bg-accent"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
        </div>

        <ImageSlot
          label={tg("avatar")}
          icon={<UserIcon className="h-3.5 w-3.5" />}
          value={strOf(it.avatar)}
          onChange={(v) => onPatch({ avatar: v })}
          hint={tg("avatarHint")}
          recommendedSize={{ width: 512, height: 512 }}
        />

        <PropField label={tg("name")} hint={name ? undefined : tg("nameHint")}>
          <Input
            value={name}
            onChange={(e) => onPatch({ name: e.target.value })}
            className="h-8 text-xs"
          />
        </PropField>
        {!name && <p className="text-[10px] text-destructive">{tg("unnamed")}</p>}

        {localizedInput("role", tg("role"))}
        {localizedInput("department", tg("department"), undefined, tg("departmentPlaceholder"))}
        {localizedInput("affiliation", tg("affiliation"), tg("affiliationHint"))}
        {localizedInput("projects", tg("projects"), tg("projectsHint"))}

        <PropField label={tg("bio") + suffix} hint={tg("bioHint")}>
          <Textarea
            value={strOf(it[`bio_${lang}`])}
            onChange={(e) => onPatch({ [`bio_${lang}`]: e.target.value })}
            rows={3}
            className="text-xs"
          />
        </PropField>
        <PropField label={tg("fullBio") + suffix} hint={tg("fullBioHint")}>
          <Textarea
            value={strOf(it[`fullBio_${lang}`])}
            onChange={(e) => onPatch({ [`fullBio_${lang}`]: e.target.value })}
            rows={5}
            className="text-xs font-mono"
          />
        </PropField>

        <div className="rounded-[6px] border border-border/60 bg-muted/20 p-2 space-y-2">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {tg("contact")}
          </p>
          <PropField label={tg("email")}>
            <Input
              value={strOf(it.email)}
              onChange={(e) => onPatch({ email: e.target.value })}
              className="h-8 text-xs"
              placeholder="osoba@neweuropeanstrategies.com"
            />
          </PropField>
          <PropField label={tg("phone")}>
            <Input
              value={strOf(it.phone)}
              onChange={(e) => onPatch({ phone: e.target.value })}
              className="h-8 text-xs"
              placeholder="+48 …"
            />
          </PropField>
          <PropField label={tg("profileHref")}>
            <Input
              value={profileHref}
              onChange={(e) => onPatch({ profileHref: e.target.value })}
              className={
                "h-8 text-xs " +
                (hrefInvalid ? "border-destructive focus-visible:ring-destructive" : "")
              }
              aria-invalid={hrefInvalid ? true : undefined}
              placeholder="/author/…"
            />
            {hrefInvalid && (
              <p className="text-[10px] text-destructive mt-0.5">{tg("invalidUrl")}</p>
            )}
          </PropField>
        </div>

        <div className="rounded-[6px] border border-border/60 bg-muted/20 p-2 space-y-2">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {tg("social")}
          </p>
          {SOCIAL_FIELDS.map((field) => (
            <PropField key={field.key} label={field.label}>
              <Input
                value={strOf(it[field.key])}
                onChange={(e) => onPatch({ [field.key]: e.target.value })}
                className="h-8 text-xs"
                placeholder={field.placeholder}
              />
            </PropField>
          ))}
        </div>
      </ItemFrame>
    </div>
  );
}
