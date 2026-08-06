// Cookie banner - logo (tryb jasny/ciemny) i dodatkowe odnośniki prawne.
import { CoverImagePicker } from "@/components/admin/CoverImagePicker";
import { Field, Text, NumberInput } from "@/components/admin/settings/fields";
import type { CookieBannerLink, CookieBannerLogo } from "@/lib/cookieBanner/config";

interface Props {
  logo: CookieBannerLogo;
  links: CookieBannerLink[];
  onLogoChange: (logo: CookieBannerLogo) => void;
  onLinksChange: (links: CookieBannerLink[]) => void;
}

const newLink = (): CookieBannerLink => ({
  id: `lnk_${Math.random().toString(36).slice(2, 9)}`,
  url: "",
  label_pl: "",
  label_en: "",
});

export function CookieBannerBrandingSection({ logo, links, onLogoChange, onLinksChange }: Props) {
  const setLink = (id: string, patch: Partial<CookieBannerLink>) =>
    onLinksChange(links.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  return (
    <>
      <section className="mb-6">
        <h3 className="text-sm font-semibold mb-2">Logo banera</h3>
        <p className="text-xs text-muted-foreground mb-3">
          Puste pole = sygnet marki z ustawień motywu. Wariant ciemny jest używany, gdy strona
          działa w trybie ciemnym (brak wariantu ciemnego = użyty jasny).
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <CoverImagePicker
            label="Logo - tryb jasny"
            value={logo.light}
            onChange={(v) => onLogoChange({ ...logo, light: v })}
          />
          <CoverImagePicker
            label="Logo - tryb ciemny"
            value={logo.dark}
            onChange={(v) => onLogoChange({ ...logo, dark: v })}
          />
        </div>
        <Field label="Rozmiar kafla (px)" hint="Zakres 24-72 px.">
          <NumberInput
            value={logo.size}
            min={24}
            max={72}
            onChange={(e) => onLogoChange({ ...logo, size: Number(e.currentTarget.value) || 36 })}
          />
        </Field>
      </section>

      <section className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold">Odnośniki w banerze</h3>
          <button
            type="button"
            onClick={() => onLinksChange([...links, newLink()])}
            className="h-8 px-3 rounded-md border border-border text-xs hover:bg-muted transition-colors"
          >
            Dodaj odnośnik
          </button>
        </div>
        {links.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Brak dodatkowych odnośników. Polityka Prywatności i Zasady przetwarzania danych są
            pokazywane zawsze.
          </p>
        ) : (
          <ul className="space-y-3">
            {links.map((l) => (
              <li key={l.id} className="border border-border rounded-lg p-3">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <Text
                    value={l.label_pl}
                    placeholder="Etykieta PL"
                    onChange={(e) => setLink(l.id, { label_pl: e.target.value })}
                  />
                  <Text
                    value={l.label_en}
                    placeholder="Label EN"
                    onChange={(e) => setLink(l.id, { label_en: e.target.value })}
                  />
                  <Text
                    value={l.url}
                    placeholder="/cookies"
                    onChange={(e) => setLink(l.id, { url: e.target.value })}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => onLinksChange(links.filter((x) => x.id !== l.id))}
                  className="mt-2 text-xs text-destructive underline underline-offset-2"
                >
                  Usuń
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
