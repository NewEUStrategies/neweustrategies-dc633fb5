// Renderuje ikonę z biblioteki admin/icons (kind='brand') po nazwie.
// Fallback: dostarczony element Lucide, jeśli w bibliotece nie ma wpisu.
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { listIcons, resolveIconUrl, type IconRow } from "@/lib/iconLibrary";

interface BrandIconProps {
  name: string;
  fallback: React.ReactNode;
  className?: string;
  alt?: string;
}

function useColorMode(): "light" | "dark" {
  const [mode, setMode] = useState<"light" | "dark">(() => {
    if (typeof document === "undefined") return "light";
    return document.documentElement.classList.contains("dark") ? "dark" : "light";
  });
  useEffect(() => {
    if (typeof document === "undefined") return;
    const el = document.documentElement;
    const obs = new MutationObserver(() => {
      setMode(el.classList.contains("dark") ? "dark" : "light");
    });
    obs.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);
  return mode;
}

export function BrandIcon({ name, fallback, className, alt }: BrandIconProps) {
  const mode = useColorMode();
  const { data: rows } = useQuery<IconRow[]>({
    queryKey: ["icon-library", "brand"],
    queryFn: () => listIcons("brand"),
    staleTime: 5 * 60 * 1000,
  });

  const target = name.toLowerCase();
  const row = rows?.find((r) => r.name.toLowerCase() === target);
  if (!row) return <>{fallback}</>;
  const url = resolveIconUrl(row, mode);
  if (!url) return <>{fallback}</>;
  return (
    <img
      src={url}
      alt={alt ?? row.label ?? row.name}
      className={className ?? "w-4 h-4 object-contain"}
      loading="lazy"
      decoding="async"
    />
  );
}
