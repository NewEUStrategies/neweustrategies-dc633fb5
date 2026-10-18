// Admin edytory dla Phase 4 batch 12 (data + social proof):
// team-grid, logo-grid, feature-grid, alert-banner, divider-text.

import type { Block, Json } from "@/lib/blocks/types";
import { Plus, Trash2 } from "lucide-react";
import { useBlocksI18n } from "@/lib/blocks/i18n";
import "@/lib/i18n-admin-blocks";
import { AdminSelect } from "../AdminSelect";
import { toJsonArray } from "@/lib/content-model/json";
import { asRecord, readDecimal, readText } from "./dataVizShared";

interface Props {
  block: Block;
  onChange: (next: Block) => void;
}

function Shell({ label, children }: { label: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border p-3 space-y-2 bg-muted/20">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      {children}
    </div>
  );
}

const inputCls = "w-full text-xs bg-background border border-border rounded px-2 py-2 h-9";
const selectCls = inputCls;

// KOERCJA TREŚCI. Pola tekstowe idą przez `readText`, a nie `String()`:
// obiekt (np. treść per język po migracji) wchodził do pola jako literalne
// „[object Object]", a pierwsza edycja utrwalała ten napis w dokumencie.
//
// Liczba kolumn musi być JEDNĄ Z OPCJI listy. Natywny `<select>` z wartością
// spoza opcji pokazuje pierwszą z nich (React zaznacza wtedy pierwszą
// dostępną), więc „trzy" albo 7 wyglądały w panelu jak „2 kolumny", podczas
// gdy strona rysuje domyślne 3 (`num(..., 3)` i `COLS_CLS[n] ?? COLS_CLS[3]`).
// Wartość spoza opcji wraca więc do domyślnej - tej samej, co w renderze.
function readColumns(raw: Json | undefined, options: readonly number[], fallback: number): number {
  const n = readDecimal(raw);
  return n !== null && options.includes(n) ? n : fallback;
}

const TEAM_COLUMNS = [2, 3, 4] as const;
const LOGO_COLUMNS = [3, 4, 5, 6] as const;
const FEATURE_COLUMNS = [2, 3, 4] as const;
const DIVIDER_ALIGNS = ["left", "center", "right"] as const;

// ===== Team Grid =====

interface TeamMember {
  name: string;
  role: string;
  bio: string;
  avatar: string;
  href: string;
  social: string;
}

export function TeamGridBlock({ block, onChange }: Props) {
  const i18n = useBlocksI18n();
  const rawItems = Array.isArray(block.data.items) ? (block.data.items as Json[]) : [];
  const items: TeamMember[] = rawItems.map((i) => {
    const o = asRecord(i);
    return {
      name: readText(o.name),
      role: readText(o.role),
      bio: readText(o.bio),
      avatar: readText(o.avatar),
      href: readText(o.href),
      social: readText(o.social),
    };
  });
  const update = (next: TeamMember[]) => {
    onChange({ ...block, data: { ...block.data, items: toJsonArray(next) } });
  };
  const columns = readColumns(block.data.columns, TEAM_COLUMNS, 3);
  const shape = String(block.data.shape ?? "circle");

  return (
    <Shell label={i18n.editor("dataSocialBlocks", "teamLabel")}>
      <input
        className={inputCls}
        placeholder={i18n.editor("dataSocialBlocks", "sectionTitle")}
        value={readText(block.data.title)}
        onChange={(e) => onChange({ ...block, data: { ...block.data, title: e.target.value } })}
      />
      <div className="grid grid-cols-2 gap-2">
        <AdminSelect
          className={selectCls}
          value={columns}
          onChange={(e) =>
            onChange({ ...block, data: { ...block.data, columns: Number(e.target.value) } })
          }
        >
          <option value={2}>{i18n.editor("dataSocialBlocks", "cols2")}</option>
          <option value={3}>{i18n.editor("dataSocialBlocks", "cols3")}</option>
          <option value={4}>{i18n.editor("dataSocialBlocks", "cols4")}</option>
        </AdminSelect>
        <AdminSelect
          className={selectCls}
          value={shape}
          onChange={(e) => onChange({ ...block, data: { ...block.data, shape: e.target.value } })}
        >
          <option value="circle">{i18n.editor("dataSocialBlocks", "avatarsCircle")}</option>
          <option value="square">{i18n.editor("dataSocialBlocks", "avatarsSquare")}</option>
        </AdminSelect>
      </div>
      <div className="space-y-2">
        {items.map((it, idx) => (
          <div key={idx} className="rounded border border-border p-2 space-y-1.5">
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <input
                className={inputCls}
                placeholder={i18n.editor("dataSocialBlocks", "name")}
                value={it.name}
                onChange={(e) => {
                  const next = [...items];
                  next[idx] = { ...it, name: e.target.value };
                  update(next);
                }}
              />
              <button
                type="button"
                onClick={() => update(items.filter((_, i) => i !== idx))}
                className="px-2 py-1 rounded border border-border text-muted-foreground hover:text-destructive"
                aria-label={i18n.editor("dataSocialBlocks", "removePerson")}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input
                className={inputCls}
                placeholder={i18n.editor("dataSocialBlocks", "role")}
                value={it.role}
                onChange={(e) => {
                  const next = [...items];
                  next[idx] = { ...it, role: e.target.value };
                  update(next);
                }}
              />
              <input
                className={inputCls}
                placeholder={i18n.editor("dataSocialBlocks", "profileUrl")}
                value={it.href}
                onChange={(e) => {
                  const next = [...items];
                  next[idx] = { ...it, href: e.target.value };
                  update(next);
                }}
              />
            </div>
            <input
              className={inputCls}
              placeholder={i18n.editor("dataSocialBlocks", "avatarUrl")}
              value={it.avatar}
              onChange={(e) => {
                const next = [...items];
                next[idx] = { ...it, avatar: e.target.value };
                update(next);
              }}
            />
            <textarea
              className="w-full text-xs bg-background border border-border rounded px-2 py-1.5 min-h-[48px]"
              placeholder={i18n.editor("dataSocialBlocks", "bio")}
              value={it.bio}
              onChange={(e) => {
                const next = [...items];
                next[idx] = { ...it, bio: e.target.value };
                update(next);
              }}
            />
            <input
              className={inputCls}
              placeholder={i18n.editor("dataSocialBlocks", "socialUrl")}
              value={it.social}
              onChange={(e) => {
                const next = [...items];
                next[idx] = { ...it, social: e.target.value };
                update(next);
              }}
            />
          </div>
        ))}
        <button
          type="button"
          onClick={() =>
            update([...items, { name: "", role: "", bio: "", avatar: "", href: "", social: "" }])
          }
          className="inline-flex items-center gap-1.5 text-xs px-2 py-1.5 rounded border border-border hover:border-foreground/50"
        >
          <Plus className="w-3.5 h-3.5" /> {i18n.editor("dataSocialBlocks", "addPerson")}
        </button>
      </div>
    </Shell>
  );
}

// ===== Logo Grid =====

interface LogoItem {
  url: string;
  alt: string;
  href: string;
}

export function LogoGridBlock({ block, onChange }: Props) {
  const i18n = useBlocksI18n();
  const rawItems = Array.isArray(block.data.items) ? (block.data.items as Json[]) : [];
  const items: LogoItem[] = rawItems.map((i) => {
    const o = asRecord(i);
    return { url: readText(o.url), alt: readText(o.alt), href: readText(o.href) };
  });
  const update = (next: LogoItem[]) => {
    onChange({ ...block, data: { ...block.data, items: toJsonArray(next) } });
  };

  return (
    <Shell label={i18n.editor("dataSocialBlocks", "logoLabel")}>
      <input
        className={inputCls}
        placeholder={i18n.editor("dataSocialBlocks", "sectionTitle")}
        value={readText(block.data.title)}
        onChange={(e) => onChange({ ...block, data: { ...block.data, title: e.target.value } })}
      />
      <div className="grid grid-cols-3 gap-2">
        <AdminSelect
          className={selectCls}
          value={readColumns(block.data.columns, LOGO_COLUMNS, 5)}
          onChange={(e) =>
            onChange({ ...block, data: { ...block.data, columns: Number(e.target.value) } })
          }
        >
          <option value={3}>{i18n.editor("dataSocialBlocks", "cols3short")}</option>
          <option value={4}>{i18n.editor("dataSocialBlocks", "cols4short")}</option>
          <option value={5}>{i18n.editor("dataSocialBlocks", "cols5short")}</option>
          <option value={6}>{i18n.editor("dataSocialBlocks", "cols6short")}</option>
        </AdminSelect>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={block.data.grayscale !== false}
            onChange={(e) =>
              onChange({ ...block, data: { ...block.data, grayscale: e.target.checked } })
            }
          />
          {i18n.editor("dataSocialBlocks", "grayscale")}
        </label>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={block.data.bordered === true}
            onChange={(e) =>
              onChange({ ...block, data: { ...block.data, bordered: e.target.checked } })
            }
          />
          {i18n.editor("dataSocialBlocks", "bordered")}
        </label>
      </div>
      <div className="space-y-2">
        {items.map((it, idx) => (
          <div key={idx} className="rounded border border-border p-2 space-y-1.5">
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <input
                className={inputCls}
                placeholder={i18n.editor("dataSocialBlocks", "logoUrl")}
                value={it.url}
                onChange={(e) => {
                  const next = [...items];
                  next[idx] = { ...it, url: e.target.value };
                  update(next);
                }}
              />
              <button
                type="button"
                onClick={() => update(items.filter((_, i) => i !== idx))}
                className="px-2 py-1 rounded border border-border text-muted-foreground hover:text-destructive"
                aria-label={i18n.editor("dataSocialBlocks", "removeLogo")}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input
                className={inputCls}
                placeholder={i18n.editor("dataSocialBlocks", "alt")}
                value={it.alt}
                onChange={(e) => {
                  const next = [...items];
                  next[idx] = { ...it, alt: e.target.value };
                  update(next);
                }}
              />
              <input
                className={inputCls}
                placeholder={i18n.field("href")}
                value={it.href}
                onChange={(e) => {
                  const next = [...items];
                  next[idx] = { ...it, href: e.target.value };
                  update(next);
                }}
              />
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={() => update([...items, { url: "", alt: "", href: "" }])}
          className="inline-flex items-center gap-1.5 text-xs px-2 py-1.5 rounded border border-border hover:border-foreground/50"
        >
          <Plus className="w-3.5 h-3.5" /> {i18n.editor("dataSocialBlocks", "addLogo")}
        </button>
      </div>
    </Shell>
  );
}

// ===== Feature Grid =====

/** Ikony, które zna render publiczny (`FEATURE_ICON_MAP`); nieznana rysuje się jako gwiazdka. */
const FEATURE_ICONS = [
  "star",
  "zap",
  "shield",
  "rocket",
  "heart",
  "check",
  "trophy",
  "target",
  "globe",
  "lightbulb",
  "sparkles",
  "gauge",
] as const;

interface FeatureItem {
  icon: string;
  title: string;
  description: string;
  href: string;
}

export function FeatureGridBlock({ block, onChange }: Props) {
  const i18n = useBlocksI18n();
  const rawItems = Array.isArray(block.data.items) ? (block.data.items as Json[]) : [];
  const items: FeatureItem[] = rawItems.map((i) => {
    const o = asRecord(i);
    return {
      icon: readText(o.icon) || "star",
      title: readText(o.title),
      description: readText(o.description),
      href: readText(o.href),
    };
  });
  const update = (next: FeatureItem[]) => {
    onChange({ ...block, data: { ...block.data, items: toJsonArray(next) } });
  };
  return (
    <Shell label={i18n.editor("dataSocialBlocks", "featureLabel")}>
      <input
        className={inputCls}
        placeholder={i18n.editor("dataSocialBlocks", "sectionTitle")}
        value={readText(block.data.title)}
        onChange={(e) => onChange({ ...block, data: { ...block.data, title: e.target.value } })}
      />
      <textarea
        className="w-full text-xs bg-background border border-border rounded px-2 py-1.5 min-h-[48px]"
        placeholder={i18n.editor("dataSocialBlocks", "subtitle")}
        value={readText(block.data.subtitle)}
        onChange={(e) => onChange({ ...block, data: { ...block.data, subtitle: e.target.value } })}
      />
      <div className="grid grid-cols-2 gap-2">
        <AdminSelect
          className={selectCls}
          value={readColumns(block.data.columns, FEATURE_COLUMNS, 3)}
          onChange={(e) =>
            onChange({ ...block, data: { ...block.data, columns: Number(e.target.value) } })
          }
        >
          <option value={2}>{i18n.editor("dataSocialBlocks", "cols2")}</option>
          <option value={3}>{i18n.editor("dataSocialBlocks", "cols3")}</option>
          <option value={4}>{i18n.editor("dataSocialBlocks", "cols4")}</option>
        </AdminSelect>
        <AdminSelect
          className={selectCls}
          value={String(block.data.style ?? "card")}
          onChange={(e) => onChange({ ...block, data: { ...block.data, style: e.target.value } })}
        >
          <option value="card">{i18n.editor("dataSocialBlocks", "styleCard")}</option>
          <option value="minimal">{i18n.editor("dataSocialBlocks", "styleMinimal")}</option>
          <option value="bordered">{i18n.editor("dataSocialBlocks", "styleBordered")}</option>
        </AdminSelect>
      </div>
      <div className="space-y-2">
        {items.map((it, idx) => (
          <div key={idx} className="rounded border border-border p-2 space-y-1.5">
            <div className="grid grid-cols-[auto_1fr_auto] gap-2 items-center">
              <AdminSelect
                className="text-xs bg-background border border-border rounded px-2 py-2 h-9"
                value={it.icon}
                onChange={(e) => {
                  const next = [...items];
                  next[idx] = { ...it, icon: e.target.value };
                  update(next);
                }}
              >
                {FEATURE_ICONS.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </AdminSelect>
              <input
                className={inputCls}
                placeholder={i18n.editor("dataSocialBlocks", "featureTitle")}
                value={it.title}
                onChange={(e) => {
                  const next = [...items];
                  next[idx] = { ...it, title: e.target.value };
                  update(next);
                }}
              />
              <button
                type="button"
                onClick={() => update(items.filter((_, i) => i !== idx))}
                className="px-2 py-1 rounded border border-border text-muted-foreground hover:text-destructive"
                aria-label={i18n.editor("dataSocialBlocks", "removeFeature")}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
            <textarea
              className="w-full text-xs bg-background border border-border rounded px-2 py-1.5 min-h-[48px]"
              placeholder={i18n.editor("dataSocialBlocks", "featureDesc")}
              value={it.description}
              onChange={(e) => {
                const next = [...items];
                next[idx] = { ...it, description: e.target.value };
                update(next);
              }}
            />
            <input
              className={inputCls}
              placeholder={i18n.field("href")}
              value={it.href}
              onChange={(e) => {
                const next = [...items];
                next[idx] = { ...it, href: e.target.value };
                update(next);
              }}
            />
          </div>
        ))}
        <button
          type="button"
          onClick={() => update([...items, { icon: "star", title: "", description: "", href: "" }])}
          className="inline-flex items-center gap-1.5 text-xs px-2 py-1.5 rounded border border-border hover:border-foreground/50"
        >
          <Plus className="w-3.5 h-3.5" /> {i18n.editor("dataSocialBlocks", "addFeature")}
        </button>
      </div>
    </Shell>
  );
}

// ===== Alert Banner =====

export function AlertBannerBlock({ block, onChange }: Props) {
  const i18n = useBlocksI18n();
  const d = block.data;
  return (
    <Shell label={i18n.editor("dataSocialBlocks", "alertLabel")}>
      <AdminSelect
        className={selectCls}
        value={String(d.variant ?? "info")}
        onChange={(e) => onChange({ ...block, data: { ...d, variant: e.target.value } })}
      >
        <option value="info">{i18n.editor("dataSocialBlocks", "variantInfo")}</option>
        <option value="success">{i18n.editor("dataSocialBlocks", "variantSuccess")}</option>
        <option value="warning">{i18n.editor("dataSocialBlocks", "variantWarning")}</option>
        <option value="danger">{i18n.editor("dataSocialBlocks", "variantDanger")}</option>
        <option value="neutral">{i18n.editor("dataSocialBlocks", "variantNeutral")}</option>
      </AdminSelect>
      <input
        className={inputCls}
        placeholder={i18n.editor("dataSocialBlocks", "title")}
        value={readText(d.title)}
        onChange={(e) => onChange({ ...block, data: { ...d, title: e.target.value } })}
      />
      <textarea
        className="w-full text-xs bg-background border border-border rounded px-2 py-1.5 min-h-[56px]"
        placeholder={i18n.editor("dataSocialBlocks", "message")}
        value={readText(d.message)}
        onChange={(e) => onChange({ ...block, data: { ...d, message: e.target.value } })}
      />
      <div className="grid grid-cols-2 gap-2">
        <input
          className={inputCls}
          placeholder={i18n.editor("dataSocialBlocks", "ctaLabel")}
          value={readText(d.ctaLabel)}
          onChange={(e) => onChange({ ...block, data: { ...d, ctaLabel: e.target.value } })}
        />
        <input
          className={inputCls}
          placeholder={i18n.field("ctaUrl")}
          value={readText(d.ctaHref)}
          onChange={(e) => onChange({ ...block, data: { ...d, ctaHref: e.target.value } })}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={d.dismissible === true}
            onChange={(e) => onChange({ ...block, data: { ...d, dismissible: e.target.checked } })}
          />
          {i18n.editor("dataSocialBlocks", "dismissible")}
        </label>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={d.showIcon !== false}
            onChange={(e) => onChange({ ...block, data: { ...d, showIcon: e.target.checked } })}
          />
          {i18n.editor("dataSocialBlocks", "showIcon")}
        </label>
      </div>
    </Shell>
  );
}

// ===== Divider with text =====

export function DividerTextBlock({ block, onChange }: Props) {
  const i18n = useBlocksI18n();
  const d = block.data;
  // Domyślne wyrównanie to ŚRODEK, a nie pierwsza opcja listy („po lewej") -
  // wartość spoza listy pokazywałaby inne wyrównanie niż to, które rysuje strona.
  const alignRaw = readText(d.align);
  const align = (DIVIDER_ALIGNS as readonly string[]).includes(alignRaw) ? alignRaw : "center";
  return (
    <Shell label={i18n.editor("dataSocialBlocks", "dividerLabel")}>
      <input
        className={inputCls}
        placeholder={i18n.editor("dataSocialBlocks", "dividerText")}
        value={readText(d.text)}
        onChange={(e) => onChange({ ...block, data: { ...d, text: e.target.value } })}
      />
      <div className="grid grid-cols-2 gap-2">
        <AdminSelect
          className={selectCls}
          value={align}
          onChange={(e) => onChange({ ...block, data: { ...d, align: e.target.value } })}
        >
          <option value="left">{i18n.editor("dataSocialBlocks", "alignLeft")}</option>
          <option value="center">{i18n.editor("dataSocialBlocks", "alignCenter")}</option>
          <option value="right">{i18n.editor("dataSocialBlocks", "alignRight")}</option>
        </AdminSelect>
        <AdminSelect
          className={selectCls}
          value={String(d.lineStyle ?? "solid")}
          onChange={(e) => onChange({ ...block, data: { ...d, lineStyle: e.target.value } })}
        >
          <option value="solid">{i18n.editor("dataSocialBlocks", "lineSolid")}</option>
          <option value="dashed">{i18n.editor("dataSocialBlocks", "lineDashed")}</option>
          <option value="dotted">{i18n.editor("dataSocialBlocks", "lineDotted")}</option>
        </AdminSelect>
      </div>
    </Shell>
  );
}
