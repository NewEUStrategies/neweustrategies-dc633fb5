// Inline picker struktury dla PUSTEGO kontenera/taba - renderuje się wyłącznie
// w kanwie buildera (EmptyContainerPickerContext jest dostarczany tylko tam).
// Wydzielony do osobnego, leniwego chunka, bo to jedyne miejsce, przez które
// publiczny BuilderRenderer (chrome każdej strony) ciągnął słowniki edytora
// (@/lib/i18n-builder, ~80 KB) i StructurePicker do bundla wejściowego.
// Side-effectowy import rejestruje bundle PRZED renderem tego modułu, więc
// t("builder.chrome.*") ma klucze od pierwszego malowania.
import "@/lib/i18n-builder";
import { useTranslation } from "react-i18next";
import { StructurePicker } from "@/components/admin/builder/ui/organisms/StructurePicker";

interface EmptyContainerPickerBoxProps {
  tabsEnabled: boolean;
  onPick: (spans: number[]) => void;
}

export default function EmptyContainerPickerBox({
  tabsEnabled,
  onPick,
}: EmptyContainerPickerBoxProps) {
  const { t } = useTranslation();
  return (
    <div
      data-empty-container-picker
      className="rounded border border-dashed border-brand/40 bg-brand/5 p-4"
      style={{ gridColumn: "1 / -1" }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2 text-center">
        {tabsEnabled
          ? t("builder.chrome.pickTabStructure")
          : t("builder.chrome.pickContainerStructure")}
      </div>
      <StructurePicker cols={7} compact onPick={onPick} />
    </div>
  );
}
