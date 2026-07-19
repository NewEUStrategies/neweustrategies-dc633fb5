// Organism: Section Layout tab (content width, gap, height, align, html tag).
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type {
  SectionNode,
  SectionLayout,
  ContentWidth,
  ColumnsGap,
  SectionHeight,
  VerticalAlign,
  OverflowMode,
  HtmlTag,
} from "@/lib/builder/types";
import { Row, NumberInput } from "../../atoms";
import { useTranslation } from "react-i18next";
import "@/lib/i18n-builder";

type Mut = (mut: (s: SectionNode) => void) => void;
const ensure = <T extends object>(v: T | undefined): T => v ?? ({} as T);

export function LayoutPane({ section, onChange }: { section: SectionNode; onChange: Mut }) {
  const { t } = useTranslation();
  const lp = (k: string) => t(`builder.layoutPane.${k}`);
  const L = section.layout ?? {};
  const setL = (mut: (l: SectionLayout) => void) =>
    onChange((s) => {
      s.layout = ensure(s.layout);
      mut(s.layout!);
    });

  return (
    <>
      <Row label={lp("contentWidth")}>
        <Select
          value={L.contentWidth ?? "boxed"}
          onValueChange={(v) =>
            setL((l) => {
              l.contentWidth = v as ContentWidth;
            })
          }
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="boxed">{lp("boxed")}</SelectItem>
            <SelectItem value="full">{lp("full")}</SelectItem>
          </SelectContent>
        </Select>
      </Row>

      {(L.contentWidth ?? "boxed") === "boxed" && (
        <Row label={lp("width")} hint={lp("widthHint")}>
          <NumberInput
            value={L.width}
            onChange={(n) =>
              setL((l) => {
                l.width = n;
              })
            }
            min={300}
            max={1920}
            suffix="px"
          />
        </Row>
      )}

      <Row label={lp("columnsGap")}>
        <Select
          value={L.columnsGap ?? "default"}
          onValueChange={(v) =>
            setL((l) => {
              l.columnsGap = v as ColumnsGap;
            })
          }
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="default">{lp("gapDefault")}</SelectItem>
            <SelectItem value="no">{lp("gapNo")}</SelectItem>
            <SelectItem value="narrow">{lp("gapNarrow")}</SelectItem>
            <SelectItem value="extended">{lp("gapExtended")}</SelectItem>
            <SelectItem value="wide">{lp("gapWide")}</SelectItem>
            <SelectItem value="wider">{lp("gapWider")}</SelectItem>
            <SelectItem value="custom">{lp("gapCustom")}</SelectItem>
          </SelectContent>
        </Select>
      </Row>
      {L.columnsGap === "custom" && (
        <Row label={lp("customGap")}>
          <NumberInput
            value={L.columnsGapCustom}
            onChange={(n) =>
              setL((l) => {
                l.columnsGapCustom = n;
              })
            }
            min={0}
            max={200}
            suffix="px"
          />
        </Row>
      )}

      <Row label={lp("height")} hint={lp("heightHint")}>
        <Select
          value={L.height ?? "default"}
          onValueChange={(v) =>
            setL((l) => {
              l.height = v as SectionHeight;
            })
          }
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="default">{lp("hDefault")}</SelectItem>
            <SelectItem value="fit-screen">{lp("hFitScreen")}</SelectItem>
            <SelectItem value="min-height">{lp("hMinHeight")}</SelectItem>
            <SelectItem value="fixed">{lp("hFixed")}</SelectItem>
          </SelectContent>
        </Select>
      </Row>
      {L.height === "fit-screen" && (
        <Row label={lp("heightVh")} hint={lp("heightVhHint")}>
          <NumberInput
            value={L.heightValue ?? 100}
            onChange={(n) =>
              setL((l) => {
                l.heightValue = n;
              })
            }
            min={10}
            max={100}
            suffix="vh"
          />
        </Row>
      )}
      {L.height === "min-height" && (
        <Row label={lp("heightMin")} hint={lp("heightMinHint")}>
          <NumberInput
            value={L.heightValue ?? 400}
            onChange={(n) =>
              setL((l) => {
                l.heightValue = n;
              })
            }
            min={40}
            max={2000}
            suffix="px"
          />
        </Row>
      )}
      {L.height === "fixed" && (
        <Row label={lp("heightPx")} hint={lp("heightPxHint")}>
          <NumberInput
            value={L.heightValue ?? 400}
            onChange={(n) =>
              setL((l) => {
                l.heightValue = n;
              })
            }
            min={40}
            max={4000}
            suffix="px"
          />
        </Row>
      )}

      <Row label={lp("marginTop")} hint={lp("marginTopHint")}>
        <NumberInput
          value={L.marginTop ?? 5}
          onChange={(n) =>
            setL((l) => {
              l.marginTop = n;
            })
          }
          min={0}
          max={400}
          suffix="px"
        />
      </Row>
      <Row label={lp("marginBottom")} hint={lp("marginBottomHint")}>
        <NumberInput
          value={L.marginBottom ?? 5}
          onChange={(n) =>
            setL((l) => {
              l.marginBottom = n;
            })
          }
          min={0}
          max={400}
          suffix="px"
        />
      </Row>

      <Row label={lp("vAlign")}>
        <Select
          value={L.verticalAlign ?? "default"}
          onValueChange={(v) =>
            setL((l) => {
              l.verticalAlign = v as VerticalAlign;
            })
          }
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="default">{lp("vaDefault")}</SelectItem>
            <SelectItem value="top">{t("builder.common.top")}</SelectItem>
            <SelectItem value="middle">{t("builder.common.center")}</SelectItem>
            <SelectItem value="bottom">{t("builder.common.bottom")}</SelectItem>
            <SelectItem value="space-between">{lp("vaBetween")}</SelectItem>
            <SelectItem value="space-around">{lp("vaAround")}</SelectItem>
            <SelectItem value="space-evenly">{lp("vaEvenly")}</SelectItem>
          </SelectContent>
        </Select>
      </Row>

      <Row label={lp("overflow")}>
        <Select
          value={L.overflow ?? "default"}
          onValueChange={(v) =>
            setL((l) => {
              l.overflow = v as OverflowMode;
            })
          }
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="default">{lp("ovDefault")}</SelectItem>
            <SelectItem value="hidden">{lp("ovHidden")}</SelectItem>
          </SelectContent>
        </Select>
      </Row>

      <Row label={lp("stretch")} hint={lp("stretchHint")}>
        <Switch
          checked={!!L.stretch}
          onCheckedChange={(v) =>
            setL((l) => {
              l.stretch = v;
            })
          }
        />
      </Row>

      <Row label={lp("htmlTag")}>
        <Select
          value={L.htmlTag ?? "section"}
          onValueChange={(v) =>
            setL((l) => {
              l.htmlTag = v as HtmlTag;
            })
          }
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(
              ["div", "section", "header", "footer", "main", "article", "aside", "nav"] as const
            ).map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Row>
    </>
  );
}
