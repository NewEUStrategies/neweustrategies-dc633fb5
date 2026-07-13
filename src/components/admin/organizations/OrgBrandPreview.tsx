// Podgląd brandingu organizacji: 4 kafle (białe/jasne marki/ciemne/akcent) +
// mini nagłówek naśladujący header strony publicznej. Renderujemy odpowiednią
// wersję logo (light/dark) zależnie od jasności tła. Kolory sterowane przez
// CSS custom properties, żeby uniknąć inline any.
import type { CSSProperties } from "react";

type Lang = "pl" | "en";

export interface OrgBrand {
  primary: string;
  accent: string;
  ink: string;
  logoHLight: string | null;
  logoHDark: string | null;
  logoVLight: string | null;
  logoVDark: string | null;
}

type BrandVars = CSSProperties & Record<"--brand-primary" | "--brand-accent" | "--brand-ink", string>;

function brandStyle(brand: OrgBrand): BrandVars {
  return {
    "--brand-primary": brand.primary,
    "--brand-accent": brand.accent,
    "--brand-ink": brand.ink,
  };
}

function LogoTile({
  bg,
  label,
  logo,
  vertical,
}: {
  bg: "white" | "brand" | "dark" | "accent";
  label: string;
  logo: string | null;
  vertical?: boolean;
}) {
  const bgClass =
    bg === "white"
      ? "bg-white"
      : bg === "dark"
        ? "bg-neutral-900"
        : bg === "brand"
          ? "bg-[color:var(--brand-primary)]"
          : "bg-[color:var(--brand-accent)]";
  return (
    <div className="rounded-md border border-border/60 overflow-hidden">
      <div
        className={`flex items-center justify-center ${bgClass} ${vertical ? "h-32" : "h-20"} p-3`}
      >
        {logo ? (
          <img
            src={logo}
            alt={label}
            className={vertical ? "max-h-full max-w-[70%] object-contain" : "max-h-full max-w-full object-contain"}
          />
        ) : (
          <span className={`text-[10px] uppercase tracking-wide ${bg === "white" ? "text-neutral-400" : "text-white/70"}`}>
            {label}
          </span>
        )}
      </div>
      <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  );
}

export function OrgBrandPreview({ brand, name, lang }: { brand: OrgBrand; name: string; lang: Lang }) {
  const L = (pl: string, en: string) => (lang === "pl" ? pl : en);
  const style = brandStyle(brand);

  return (
    <div style={style} className="space-y-4">
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
          {L("Logo poziome", "Horizontal logo")}
        </h3>
        <div className="grid grid-cols-2 gap-2">
          <LogoTile bg="white" label={L("Białe tło", "White bg")} logo={brand.logoHLight} />
          <LogoTile bg="dark" label={L("Ciemne tło", "Dark bg")} logo={brand.logoHDark} />
          <LogoTile bg="brand" label={L("Tło marki", "Brand bg")} logo={brand.logoHDark ?? brand.logoHLight} />
          <LogoTile bg="accent" label={L("Tło akcentu", "Accent bg")} logo={brand.logoHDark ?? brand.logoHLight} />
        </div>
      </div>

      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
          {L("Logo pionowe", "Vertical logo")}
        </h3>
        <div className="grid grid-cols-2 gap-2">
          <LogoTile bg="white" label={L("Białe tło", "White bg")} logo={brand.logoVLight} vertical />
          <LogoTile bg="dark" label={L("Ciemne tło", "Dark bg")} logo={brand.logoVDark} vertical />
        </div>
      </div>

      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
          {L("Podgląd nagłówka", "Header preview")}
        </h3>
        <div className="rounded-lg overflow-hidden border border-border/60">
          <div
            className="flex items-center justify-between px-4 py-3"
            style={{ backgroundColor: brand.primary, color: brand.ink }}
          >
            <div className="flex items-center gap-3">
              {brand.logoHDark ?? brand.logoHLight ? (
                <img src={brand.logoHDark ?? brand.logoHLight ?? ""} alt={name} className="h-6 object-contain" />
              ) : (
                <span className="text-sm font-semibold">{name || L("Nazwa organizacji", "Organization name")}</span>
              )}
            </div>
            <button
              type="button"
              className="rounded-md px-3 py-1 text-xs font-medium"
              style={{ backgroundColor: brand.accent, color: brand.ink }}
            >
              {L("Zostań członkiem", "Become a member")}
            </button>
          </div>
          <div className="bg-background px-4 py-3 text-xs text-muted-foreground">
            {L("Tak zobaczą markę odwiedzający.", "This is how visitors see the brand.")}
          </div>
        </div>
      </div>
    </div>
  );
}
