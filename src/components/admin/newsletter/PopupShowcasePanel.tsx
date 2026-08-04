// Panel administracyjny wariantu popupu "showcase" (galeria + formularz).
// Zarządza: układem popupu, 4 kaflami galerii (upload + biblioteka mediów),
// podpisami PL/EN, marką PL/EN, hasłem PL/EN i tempem rotacji.
// Rekomendowane wymiary kafli są opisane przy każdym slocie.
// Sekcja ma własny podgląd na żywo (PL/EN), żeby efekt zmian był widoczny
// bez przewijania do sekcji "Podgląd na żywo".
import { useState } from "react";
import { Eye, Image as ImageIcon, LayoutGrid } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ImageSlot } from "@/components/admin/builder/ui/organisms/widget-properties/ImageSlot";
import { PopupPreview } from "@/components/admin/newsletter/PopupPreview";
import type {
  NewsletterSettings,
  NewsletterShowcaseImage,
} from "@/hooks/useNewsletterSettings";

const SLOT_HINTS = [
  "Kafel główny - rekomendowane 1200 x 1200 px (1:1), JPG/WEBP, do 400 KB.",
  "Kafel mały - rekomendowane 600 x 600 px (1:1), JPG/WEBP, do 200 KB.",
  "Kafel mały - rekomendowane 600 x 600 px (1:1), JPG/WEBP, do 200 KB.",
  "Kafel szeroki - rekomendowane 1200 x 600 px (2:1), JPG/WEBP, do 300 KB.",
];

const LAYOUTS: { value: NewsletterSettings["popup_layout"]; title: string; desc: string }[] = [
  { value: "stacked", title: "Stacked", desc: "Okładka u góry, formularz pod nią." },
  { value: "split", title: "Split", desc: "Grafika po lewej, formularz po prawej." },
  { value: "showcase", title: "Showcase", desc: "Mozaika 4 zdjęć + formularz." },
];

function emptySlot(): NewsletterShowcaseImage {
  return { url: "", caption_pl: "", caption_en: "" };
}

function normalize(images: NewsletterShowcaseImage[]): NewsletterShowcaseImage[] {
  const out = [...images];
  while (out.length < 4) out.push(emptySlot());
  return out.slice(0, 4);
}

interface Props {
  value: NewsletterSettings;
  onChange: (patch: Partial<NewsletterSettings>) => void;
}

export function PopupShowcasePanel({ value, onChange }: Props) {
  const slots = normalize(value.popup_showcase_images ?? []);
  const [lang, setLang] = useState<"pl" | "en">("pl");

  const patchSlot = (index: number, patch: Partial<NewsletterShowcaseImage>) => {
    const next = slots.map((slot, i) => (i === index ? { ...slot, ...patch } : slot));
    onChange({ popup_showcase_images: next });
  };

  return (
    <section className="bg-card border border-border rounded-xl p-5 space-y-5">
      <div className="flex items-center gap-2">
        <LayoutGrid className="w-4 h-4 text-muted-foreground" />
        <h3 className="font-display text-lg">Popup - układ i galeria</h3>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {LAYOUTS.map((l) => {
          const active = value.popup_layout === l.value;
          return (
            <button
              key={l.value}
              type="button"
              onClick={() => onChange({ popup_layout: l.value })}
              className={
                "text-left p-3 rounded-md border transition-all " +
                (active
                  ? "border-primary bg-primary/5 ring-2 ring-primary/20"
                  : "border-border hover:border-primary/40 hover:bg-muted/40")
              }
            >
              <div className="text-sm font-medium">{l.title}</div>
              <p className="text-[11px] text-muted-foreground mt-0.5">{l.desc}</p>
            </button>
          );
        })}
      </div>

      {value.popup_layout === "showcase" && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label>Marka / etykieta (PL)</Label>
              <Input
                value={value.popup_showcase_brand_pl}
                onChange={(e) => onChange({ popup_showcase_brand_pl: e.target.value })}
                placeholder="Newsletter"
              />
            </div>
            <div>
              <Label>Marka / etykieta (EN)</Label>
              <Input
                value={value.popup_showcase_brand_en}
                onChange={(e) => onChange({ popup_showcase_brand_en: e.target.value })}
                placeholder="Newsletter"
              />
            </div>
            <div>
              <Label>Hasło (PL)</Label>
              <Input
                value={value.popup_showcase_tagline_pl}
                onChange={(e) => onChange({ popup_showcase_tagline_pl: e.target.value })}
              />
            </div>
            <div>
              <Label>Hasło (EN)</Label>
              <Input
                value={value.popup_showcase_tagline_en}
                onChange={(e) => onChange({ popup_showcase_tagline_en: e.target.value })}
              />
            </div>
            <div>
              <Label>Rotacja kafli (ms)</Label>
              <Input
                type="number"
                min={800}
                max={30000}
                step={100}
                value={value.popup_showcase_rotate_ms}
                onChange={(e) =>
                  onChange({
                    popup_showcase_rotate_ms: Math.min(
                      30000,
                      Math.max(800, Number(e.target.value) || 2600),
                    ),
                  })
                }
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                Zakres 800-30000 ms. Rotacja startuje przy min. 2 zdjęciach.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {slots.map((slot, index) => (
              <div key={index} className="rounded-md border border-border p-3 space-y-3">
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Kafel {index + 1}
                </div>
                <ImageSlot
                  label="Obraz"
                  icon={<ImageIcon className="w-4 h-4" />}
                  value={slot.url}
                  onChange={(url) => patchSlot(index, { url })}
                  hint={SLOT_HINTS[index]}
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div>
                    <Label>Podpis (PL)</Label>
                    <Input
                      value={slot.caption_pl}
                      onChange={(e) => patchSlot(index, { caption_pl: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label>Podpis (EN)</Label>
                    <Input
                      value={slot.caption_en}
                      onChange={(e) => patchSlot(index, { caption_en: e.target.value })}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-3 pt-1">
        <div className="flex items-center gap-2">
          <Eye className="w-4 h-4 text-muted-foreground" />
          <h4 className="text-sm font-semibold">Podgląd popupu</h4>
          <div className="ml-auto flex items-center gap-1">
            {(["pl", "en"] as const).map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => setLang(code)}
                aria-pressed={lang === code}
                className={
                  "px-2.5 py-1 text-xs rounded-md transition-colors " +
                  (lang === code
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:text-foreground")
                }
              >
                {code.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
        <div className="rounded-md border border-border overflow-hidden bg-gradient-to-br from-muted/40 to-muted/10">
          <PopupPreview settings={value} lang={lang} />
        </div>
      </div>
    </section>
  );
}
