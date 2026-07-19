// Molecule: typography editor for sections (heading/text/link colors + align).
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { useTranslation } from "react-i18next";
import type { TypographySettings, Device, Align } from "@/lib/builder/types";
import { Row, ColorInput } from "../atoms";
import "@/lib/i18n-builder";

interface Props {
  value: TypographySettings | undefined;
  device: Device;
  onChange: (mut: (t: TypographySettings) => void) => void;
}

export function TypographyEditor({ value, device, onChange }: Props) {
  const { t: tr } = useTranslation();
  const t = value ?? {};
  const setResp = (val: Align | undefined) =>
    onChange((x) => {
      x.align = { ...(x.align ?? {}), [device]: val };
    });
  return (
    <>
      <Row label={tr("builder.typography.headingColor")}>
        <ColorInput
          value={t.headingColor}
          onChange={(v) =>
            onChange((x) => {
              x.headingColor = v;
            })
          }
        />
      </Row>
      <Row label={tr("builder.typography.textColor")}>
        <ColorInput
          value={t.textColor}
          onChange={(v) =>
            onChange((x) => {
              x.textColor = v;
            })
          }
        />
      </Row>
      <Row label={tr("builder.typography.linkColor")}>
        <ColorInput
          value={t.linkColor}
          onChange={(v) =>
            onChange((x) => {
              x.linkColor = v;
            })
          }
        />
      </Row>
      <Row label={tr("builder.typography.linkHoverColor")}>
        <ColorInput
          value={t.linkHoverColor}
          onChange={(v) =>
            onChange((x) => {
              x.linkHoverColor = v;
            })
          }
        />
      </Row>
      <Row label={tr("builder.typography.align", { device })}>
        <Select value={t.align?.[device] ?? "left"} onValueChange={(v) => setResp(v as Align)}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="left">{tr("builder.common.left")}</SelectItem>
            <SelectItem value="center">{tr("builder.common.center")}</SelectItem>
            <SelectItem value="right">{tr("builder.common.right")}</SelectItem>
          </SelectContent>
        </Select>
      </Row>
    </>
  );
}
