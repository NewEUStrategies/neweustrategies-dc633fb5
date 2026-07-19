// Molecule: section background editor (color/image/gradient/video/slideshow).
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type {
  BackgroundSettings,
  BackgroundType,
  BackgroundPosition,
  BackgroundRepeat,
  BackgroundSize,
  BackgroundAttachment,
  GradientType,
} from "@/lib/builder/types";
import { Row, ColorInput, NumberInput } from "../atoms";
import { useTranslation } from "react-i18next";
import "@/lib/i18n-builder";

interface Props {
  value: BackgroundSettings | undefined;
  onChange: (mut: (b: BackgroundSettings) => void) => void;
}

export function BackgroundEditor({ value, onChange }: Props) {
  const { t } = useTranslation();
  const b = value ?? {};
  return (
    <>
      <Row label={t("builder.background.type")}>
        <Select
          value={b.type ?? "none"}
          onValueChange={(v) =>
            onChange((x) => {
              x.type = v as BackgroundType;
            })
          }
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">{t("builder.common.none")}</SelectItem>
            <SelectItem value="classic">{t("builder.background.classic")}</SelectItem>
            <SelectItem value="gradient">{t("builder.background.gradient")}</SelectItem>
            <SelectItem value="video">{t("builder.background.video")}</SelectItem>
            <SelectItem value="slideshow">{t("builder.background.slideshow")}</SelectItem>
          </SelectContent>
        </Select>
      </Row>

      {(b.type === "classic" || b.type === "video" || b.type === "slideshow") && (
        <Row label={t("builder.common.color")}>
          <ColorInput
            value={b.color}
            onChange={(v) =>
              onChange((x) => {
                x.color = v;
              })
            }
          />
        </Row>
      )}

      {b.type === "classic" && (
        <>
          <Row label={t("builder.background.imageUrl")}>
            <Input
              value={b.imageUrl ?? ""}
              onChange={(e) =>
                onChange((x) => {
                  x.imageUrl = e.target.value || undefined;
                })
              }
              placeholder="https://…"
              className="h-8 text-xs"
            />
          </Row>
          <Row label={t("builder.background.position")}>
            <Select
              value={b.position ?? "center center"}
              onValueChange={(v) =>
                onChange((x) => {
                  x.position = v as BackgroundPosition;
                })
              }
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(
                  [
                    "center center",
                    "top center",
                    "top left",
                    "top right",
                    "center left",
                    "center right",
                    "bottom center",
                    "bottom left",
                    "bottom right",
                  ] as const
                ).map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Row>
          <Row label={t("builder.background.repeat")}>
            <Select
              value={b.repeat ?? "no-repeat"}
              onValueChange={(v) =>
                onChange((x) => {
                  x.repeat = v as BackgroundRepeat;
                })
              }
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["no-repeat", "repeat", "repeat-x", "repeat-y"] as const).map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Row>
          <Row label={t("builder.background.size")}>
            <Select
              value={b.size ?? "cover"}
              onValueChange={(v) =>
                onChange((x) => {
                  x.size = v as BackgroundSize;
                })
              }
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["auto", "cover", "contain"] as const).map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Row>
          <Row label={t("builder.background.attachment")}>
            <Select
              value={b.attachment ?? "scroll"}
              onValueChange={(v) =>
                onChange((x) => {
                  x.attachment = v as BackgroundAttachment;
                })
              }
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="scroll">Scroll</SelectItem>
                <SelectItem value="fixed">Fixed (parallax)</SelectItem>
              </SelectContent>
            </Select>
          </Row>
        </>
      )}

      {b.type === "gradient" && (
        <>
          <Row label={t("builder.background.gradientType")}>
            <Select
              value={b.gradientType ?? "linear"}
              onValueChange={(v) =>
                onChange((x) => {
                  x.gradientType = v as GradientType;
                })
              }
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="linear">{t("builder.background.linear")}</SelectItem>
                <SelectItem value="radial">{t("builder.background.radial")}</SelectItem>
              </SelectContent>
            </Select>
          </Row>
          <Row label={t("builder.background.color1")}>
            <ColorInput
              value={b.gradientColor}
              onChange={(v) =>
                onChange((x) => {
                  x.gradientColor = v;
                })
              }
            />
          </Row>
          <Row label={t("builder.background.location1")}>
            <NumberInput
              value={b.gradientLocation}
              onChange={(n) =>
                onChange((x) => {
                  x.gradientLocation = n;
                })
              }
              min={0}
              max={100}
              suffix="%"
            />
          </Row>
          <Row label={t("builder.background.color2")}>
            <ColorInput
              value={b.gradientColor2}
              onChange={(v) =>
                onChange((x) => {
                  x.gradientColor2 = v;
                })
              }
            />
          </Row>
          <Row label={t("builder.background.location2")}>
            <NumberInput
              value={b.gradientLocation2}
              onChange={(n) =>
                onChange((x) => {
                  x.gradientLocation2 = n;
                })
              }
              min={0}
              max={100}
              suffix="%"
            />
          </Row>
          {(b.gradientType ?? "linear") === "linear" && (
            <Row label={t("builder.background.angle")}>
              <NumberInput
                value={b.gradientAngle}
                onChange={(n) =>
                  onChange((x) => {
                    x.gradientAngle = n;
                  })
                }
                min={0}
                max={360}
                suffix="°"
              />
            </Row>
          )}
        </>
      )}

      {b.type === "video" && (
        <Row label={t("builder.background.videoUrl")}>
          <Input
            value={b.videoUrl ?? ""}
            onChange={(e) =>
              onChange((x) => {
                x.videoUrl = e.target.value || undefined;
              })
            }
            className="h-8 text-xs"
          />
        </Row>
      )}

      {b.type === "slideshow" && (
        <Row label={t("builder.background.slideshowImages")}>
          <Textarea
            rows={4}
            value={(b.slideshowImages ?? []).join("\n")}
            onChange={(e) =>
              onChange((x) => {
                x.slideshowImages = e.target.value
                  .split("\n")
                  .map((s) => s.trim())
                  .filter(Boolean);
              })
            }
            className="text-xs font-mono"
          />
        </Row>
      )}
    </>
  );
}
