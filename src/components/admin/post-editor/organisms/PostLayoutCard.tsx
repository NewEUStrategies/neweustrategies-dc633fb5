// Organizm: karta layoutu (format + nadpisania) - wspólna dla zakładki
// "Layout" i panelu dokumentu edytora bloków. Cienki adapter formularza na
// molekułę LayoutOverridesCard.
import type {
  LayoutOverrides,
  LayoutPreset,
  PostFormat,
  PostLayoutSettings,
} from "@/lib/postLayouts";
import { LayoutOverridesCard } from "../molecules";
import type { PostEditorFormApi } from "../hooks";

export function PostLayoutCard({
  formApi,
  ov,
  onOverridesChange,
  currentFormat,
  layoutSet,
  globalLayout,
}: {
  formApi: PostEditorFormApi;
  ov: LayoutOverrides;
  onOverridesChange: (patch: Partial<LayoutOverrides>) => void;
  currentFormat: PostFormat;
  layoutSet: LayoutPreset[];
  globalLayout: PostLayoutSettings | undefined;
}) {
  const { form, set } = formApi;
  if (!form) return null;
  return (
    <LayoutOverridesCard
      postFormat={form.post_format}
      onPostFormatChange={(v) => set("post_format", v)}
      ov={ov}
      onOverridesChange={onOverridesChange}
      currentFormat={currentFormat}
      layoutSet={layoutSet}
      globalLayout={globalLayout}
    />
  );
}
