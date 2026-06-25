import { Moon, Sun } from "@/lib/lucide-shim";
import { useTheme } from "@/components/ThemeProvider";

export function ThemeToggle({ className = "" }: { className?: string }) {
  const { theme, toggle } = useTheme();
  return (
    <button
      onClick={toggle}
      aria-label="Przełącz motyw"
      type="button"
      className={`p-0 rounded-[2px] hover:bg-muted transition ${className}`}
    >
      {theme === "dark" ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
    </button>
  );
}
