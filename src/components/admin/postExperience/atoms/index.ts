// Punkt wejścia atomów paneli „doświadczenia czytelnika".
//
// DLACZEGO BARYŁKA, A NIE SIEDEM OSOBNYCH IMPORTÓW. Vite wydziela współdzielony
// moduł aplikacji do WŁASNEGO chunku, gdy importuje go więcej niż jedno wejście.
// Siedem atomów importowanych z osobnych plików dało więc siedem mikro-chunków,
// a każdy z nich niesie narzut opakowania modułu większy niż jego własny kod:
// zmierzone +2,4 KB gzip przy ~1 KB rzeczywistej treści. Jeden punkt wejścia to
// jeden chunk.
//
// Ryzyko baryłek (osłabione otrząsanie drzewa) jest tu zerowe: wszystkie atomy
// są używane przez panele, a panele są wyłącznie administracyjne - nie wchodzą
// na ścieżkę czytelnika.
export { PanelColorField } from "./PanelColorField";
export { PanelNumberField } from "./PanelNumberField";
export { PanelRangeField } from "./PanelRangeField";
export { PanelSectionHeading, type PanelHeadingTone } from "./PanelSectionHeading";
export { PanelSelectField, type PanelSelectOption } from "./PanelSelectField";
export { PanelTextField } from "./PanelTextField";
export {
  SelectableOptionCard,
  OPTION_CARD_CLASS,
  OPTION_CARD_IDLE,
  OPTION_CARD_SELECTED,
  type OptionCardVariant,
} from "./SelectableOptionCard";
