import { Label } from "@/components/ui/label";
import { AdminColorPicker } from "@/components/admin/blocks/AdminColorPicker";

interface PanelColorFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

/**
 * Atom: pole koloru panelu (podpis + wspólny selektor administracyjny).
 *
 * CO SCALIŁ. Trzy kopie pary `<Label>` + `<AdminColorPicker>`: mapa siedmiu
 * kolorów ToC, lokalny `ColorRow` panelu sekcji „dowiesz się" i czwarta kopia
 * dla koloru podświetlenia. Każda inaczej radziła sobie z `undefined` z
 * selektora - jedna zamieniała na pusty łańcuch, druga podstawiała akcent,
 * trzecia przekazywała `undefined` dalej do stanu. Atom domyka to w jednym
 * miejscu: brak wartości to pusty łańcuch, czyli „dziedzicz".
 */
export function PanelColorField({ label, value, onChange, className }: PanelColorFieldProps) {
  return (
    <div className={className ?? "space-y-1 min-w-0"}>
      <Label className="text-[10px] text-muted-foreground">{label}</Label>
      <AdminColorPicker
        value={value}
        onChange={(next: string | undefined) => onChange(next ?? "")}
        ariaLabel={label}
      />
    </div>
  );
}
