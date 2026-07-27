# Warianty widgetów - pełne wdrożenie + kolory

Zauważyłem, że w wielu widgetach (heading, button, divider, cta, section-heading, badge, marquee) opcja „Wariant → gradient" (i inne kolorystyczne warianty) korzysta z hardkodowanych kolorów brand/destructive - nie ma możliwości zmiany kolorów przez edytora. Chcę to naprawić kompleksowo, ale zakres jest szeroki - proszę o potwierdzenie kierunku, zanim wdrożę.

## Widgety objęte zmianą

| Widget | Warianty do dopracowania | Kolory do dodania |
|---|---|---|
| heading | gradient, highlight, outlined, underline | `gradientFrom`, `gradientTo`, `gradientAngle`, `highlightColor`, `outlineColor` |
| button | primary, outline, ghost, gradient, soft, link | `bgColor`, `bgHoverColor`, `textColor`, `borderColor`, `gradientFrom`, `gradientTo` |
| divider | line, dashed, dotted, double, gradient, wave, icon | `color`, `gradientFrom`, `gradientTo`, `iconColor` |
| section-heading | default, gradient, bar, card, split | `accentColor`, `gradientFrom`, `gradientTo`, `barColor` |
| cta | default, gradient, split, bar, card | `bgFrom`, `bgTo`, `textColor`, `ctaBg`, `ctaText` |
| badge (dark-featured-card) | solid-red/brand/dark, outline, ghost, gradient | już ma `badgeBg`/`badgeText` - dodaję `gradientFrom`/`gradientTo` |
| marquee | badge, squiggle, gradient | `bgColor`, `textColor`, `gradientFrom/To` |
| newsletter, testimonial, team-member, join-us | warianty layoutu | `accentColor`, `bgColor`, `textColor` (opcjonalnie) |

## Sposób wdrożenia

1. **Rozszerzenie schematów** (`src/lib/builder/schemas.ts`)
   - Dodaję pola typu `color` z `visibleWhen: (c) => c.variant === "gradient"` (i analogicznie dla pozostałych wariantów kolorystycznych)
   - Sensowne wartości domyślne = obecne kolory brand, więc istniejące wpisy nie zmienią wyglądu
2. **Wspólny wzorzec UI** - używam istniejącego `AdminColorPicker`/`ColorField` (ten sam co w SectionLabelEditor), więc layout, popover i „reset do motywu" są spójne w całej aplikacji
3. **Renderer** (`WidgetView.tsx` + `SimpleWidgets.tsx`) - inline style `background: linear-gradient(angle, from, to)` gdy podano kolory, inaczej fallback do dotychczasowej klasy `bg-gradient-brand`
4. **Warianty, które dotąd wyglądały tak samo** (np. divider „double" = „line" w niektórych motywach) - poprawiam CSS, żeby faktycznie się różniły
5. **Testy** - rozszerzam istniejący `widgetBehavior.test.tsx` o assercje, że każdy wariant renderuje unikatowe DOM/style oraz że przekazany kolor trafia do inline style

## Do potwierdzenia

- **Zakres:** wdrażam dla wszystkich 8 widgetów wymienionych wyżej, czy chcesz zawęzić do konkretnego (np. tylko heading + button + divider)?
- **Kolory:** dwustopniowe pickery (from/to) dla gradientów - OK? Czy wolisz jeden picker + auto-generowany drugi kolor (jaśniejszy/ciemniejszy odcień)?
- **Dark mode:** czy każdy nowy kolor ma mieć osobną wartość dla light/dark (`Themed<string>`), tak jak w typografii, czy jeden wspólny?

Napisz „ok, zaczynaj" (albo doprecyzuj zakres) - wtedy wdrażam całościowo w jednej turze.
