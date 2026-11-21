// PlatformSelect - wspólny atom listy rozwijanej: natywny <select> jako pole
// (kontrakt formularza) + lista opcji rysowana w layoucie platformy.
//
// Natywny element jest kontraktem, nie detalem: FormData niesie wybraną
// wartość (także pusty łańcuch, bez sentineli), `required` i `disabled`
// działają jak w przeglądarce, <label htmlFor> i etykieta-otoczka wskazują
// dokładnie jedną kontrolkę, a `onChange` dostaje prawdziwe
// ChangeEvent<HTMLSelectElement> (target.value, currentTarget.selectedIndex).
// Opcje (<option>, <optgroup>, fragmenty, mapowane tablice) renderują się
// bez zmian, więc `select.options` działa bez otwierania listy.
//
// Lista: systemowy popup jest wyłączony (mysz, dotyk, klawiatura), a w jego
// miejsce otwiera się listbox w portalu popovera, zbudowany z bieżących
// `select.options`. Wybór zapisuje natywny `selectedIndex` i wysyła
// bąbelkujące `input` + `change`, więc tryb kontrolowany i niekontrolowany
// działa tak samo jak przy wyborze z listy systemowej. Geometria jest wspólna
// dla jasnego i ciemnego motywu.

import * as React from "react";
import { Check } from "@/lib/lucide-shim";
import {
  FieldPopover as Popover,
  FieldPopoverAnchor as PopoverAnchor,
  FieldPopoverContent as PopoverContent,
} from "@/components/ui/platform-popover";
import { cn } from "@/lib/utils";

type PlatformSelectProps = React.ComponentPropsWithoutRef<"select"> & {
  /** Pierwsza, niewybieralna pozycja `value=""` - pomijana, gdy dzieci już ją mają. */
  placeholder?: string;
};

function hasEmptyOption(children: React.ReactNode): boolean {
  return React.Children.toArray(children).some((child) => {
    if (!React.isValidElement(child)) return false;
    if (child.type === "option") {
      const value = (child.props as { value?: unknown }).value;
      return value != null && String(value) === "";
    }
    if (child.type === React.Fragment || child.type === "optgroup") {
      return hasEmptyOption((child.props as { children?: React.ReactNode }).children);
    }
    return false;
  });
}

export type PlatformListItem =
  | { kind: "group"; key: string; label: string }
  | { kind: "option"; key: string; index: number; label: string; disabled: boolean };

/** Pozycje listy z bieżących opcji natywnego pola (ukryte opcje pomijamy). */
export function readSelectItems(select: HTMLSelectElement): PlatformListItem[] {
  const items: PlatformListItem[] = [];
  const pushOption = (option: HTMLOptionElement, groupDisabled: boolean) => {
    if (option.hidden) return;
    items.push({
      kind: "option",
      key: `o${option.index}`,
      index: option.index,
      label: option.label || option.text,
      disabled: option.disabled || groupDisabled,
    });
  };
  Array.from(select.children).forEach((child, position) => {
    if (child instanceof HTMLOptGroupElement) {
      items.push({ kind: "group", key: `g${position}`, label: child.label });
      Array.from(child.children).forEach((nested) => {
        if (nested instanceof HTMLOptionElement) pushOption(nested, child.disabled);
      });
    } else if (child instanceof HTMLOptionElement) {
      pushOption(child, false);
    }
  });
  return items;
}

/** Wybór jak z listy systemowej: natywny indeks + bąbelkujące input/change. */
export function commitSelectIndex(select: HTMLSelectElement, index: number): void {
  if (select.selectedIndex === index) return;
  select.selectedIndex = index;
  select.dispatchEvent(new Event("input", { bubbles: true }));
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

const OPEN_KEYS = new Set([" ", "Enter", "ArrowDown", "ArrowUp", "F4"]);

export const PlatformSelect = React.forwardRef<HTMLSelectElement, PlatformSelectProps>(
  function PlatformSelect(
    {
      className,
      placeholder,
      children,
      onMouseDown,
      onKeyDown,
      onTouchStart,
      onTouchMove,
      onTouchEnd,
      ...props
    },
    forwardedRef,
  ) {
    const showPlaceholder = placeholder !== undefined && !hasEmptyOption(children);
    const selectRef = React.useRef<HTMLSelectElement | null>(null);
    const listRef = React.useRef<HTMLDivElement | null>(null);
    const touchMoved = React.useRef(false);
    const typeahead = React.useRef({ text: "", at: 0 });
    const listId = React.useId();
    const [open, setOpen] = React.useState(false);
    const [items, setItems] = React.useState<PlatformListItem[]>([]);
    const [active, setActive] = React.useState(-1);
    const [selectedIndex, setSelectedIndex] = React.useState(-1);

    const setRef = React.useCallback(
      (node: HTMLSelectElement | null) => {
        selectRef.current = node;
        if (typeof forwardedRef === "function") forwardedRef(node);
        else if (forwardedRef) forwardedRef.current = node;
      },
      [forwardedRef],
    );

    const options = items.filter(
      (item): item is Extract<PlatformListItem, { kind: "option" }> => item.kind === "option",
    );
    const enabled = options.filter((item) => !item.disabled);

    const openList = () => {
      const select = selectRef.current;
      if (!select || select.disabled) return;
      const next = readSelectItems(select);
      setItems(next);
      setSelectedIndex(select.selectedIndex);
      const current = next.find(
        (item) => item.kind === "option" && item.index === select.selectedIndex && !item.disabled,
      );
      const first = next.find((item) => item.kind === "option" && !item.disabled);
      const target = current ?? first;
      setActive(target && target.kind === "option" ? target.index : -1);
      setOpen(true);
    };

    const choose = (index: number) => {
      const select = selectRef.current;
      if (select) commitSelectIndex(select, index);
      setOpen(false);
    };

    const move = (delta: number) => {
      if (!enabled.length) return;
      const position = enabled.findIndex((item) => item.index === active);
      const nextPosition =
        position < 0
          ? delta > 0
            ? 0
            : enabled.length - 1
          : Math.min(enabled.length - 1, Math.max(0, position + delta));
      const target = enabled[nextPosition];
      if (target) setActive(target.index);
    };

    React.useEffect(() => {
      if (!open || active < 0) return;
      const node = document.getElementById(`${listId}-${active}`);
      node?.scrollIntoView?.({ block: "nearest" });
    }, [open, active, listId]);

    const onListKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          move(1);
          return;
        case "ArrowUp":
          event.preventDefault();
          move(-1);
          return;
        case "PageDown":
          event.preventDefault();
          move(8);
          return;
        case "PageUp":
          event.preventDefault();
          move(-8);
          return;
        case "Home":
          event.preventDefault();
          if (enabled[0]) setActive(enabled[0].index);
          return;
        case "End": {
          event.preventDefault();
          const last = enabled[enabled.length - 1];
          if (last) setActive(last.index);
          return;
        }
        case "Enter":
        case " ":
          event.preventDefault();
          if (active >= 0) choose(active);
          return;
        case "Tab":
          setOpen(false);
          return;
        default:
          break;
      }
      if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        const now = Date.now();
        const state = typeahead.current;
        state.text = now - state.at > 700 ? event.key : state.text + event.key;
        state.at = now;
        const needle = state.text.toLocaleLowerCase();
        const match = enabled.find((item) => item.label.toLocaleLowerCase().startsWith(needle));
        if (match) setActive(match.index);
      }
    };

    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverAnchor asChild>
          <select
            ref={setRef}
            data-slot="platform-select"
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-controls={open ? listId : undefined}
            className={cn(
              "platform-field platform-select w-full min-w-0 cursor-pointer appearance-none border border-input bg-background text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive",
              className,
            )}
            onMouseDown={(event) => {
              onMouseDown?.(event);
              if (event.defaultPrevented || event.button !== 0) return;
              // Bez systemowego popupu: tylko fokus i nasza lista.
              event.preventDefault();
              event.currentTarget.focus();
              if (open) setOpen(false);
              else openList();
            }}
            onTouchStart={(event) => {
              onTouchStart?.(event);
              touchMoved.current = false;
            }}
            onTouchMove={(event) => {
              onTouchMove?.(event);
              touchMoved.current = true;
            }}
            onTouchEnd={(event) => {
              onTouchEnd?.(event);
              if (event.defaultPrevented || touchMoved.current) return;
              event.preventDefault();
              event.currentTarget.focus();
              if (open) setOpen(false);
              else openList();
            }}
            onKeyDown={(event) => {
              onKeyDown?.(event);
              if (event.defaultPrevented || !OPEN_KEYS.has(event.key)) return;
              event.preventDefault();
              openList();
            }}
            {...props}
          >
            {showPlaceholder && (
              <option value="" disabled>
                {placeholder}
              </option>
            )}
            {children}
          </select>
        </PopoverAnchor>
        <PopoverContent
          align="start"
          sideOffset={4}
          data-slot="platform-select-content"
          className="w-auto max-w-[calc(100vw-1rem)] rounded-[6px] border-border p-1 shadow-lg"
          style={{ minWidth: "var(--radix-popper-anchor-width)" }}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            listRef.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            selectRef.current?.focus();
          }}
          onInteractOutside={(event) => {
            // Klik w samo pole przełącza listę w onMouseDown - nie zamykamy tu.
            if (selectRef.current?.contains(event.target as Node)) event.preventDefault();
          }}
        >
          <div
            ref={listRef}
            id={listId}
            role="listbox"
            tabIndex={-1}
            aria-label={
              props["aria-label"] ??
              (selectRef.current?.labels?.[0]?.textContent?.trim() || undefined)
            }
            aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
            onKeyDown={onListKeyDown}
            className="max-h-[min(20rem,calc(var(--radix-popper-available-height)-1rem))] overflow-y-auto overscroll-contain outline-none"
          >
            {items.map((item) =>
              item.kind === "group" ? (
                <div
                  key={item.key}
                  role="presentation"
                  className="px-2 pb-1 pt-2 text-xs font-semibold text-muted-foreground"
                >
                  {item.label}
                </div>
              ) : (
                <div
                  key={item.key}
                  id={`${listId}-${item.index}`}
                  role="option"
                  aria-selected={item.index === selectedIndex}
                  aria-disabled={item.disabled || undefined}
                  data-active={item.index === active ? "" : undefined}
                  onPointerMove={() => {
                    if (!item.disabled && active !== item.index) setActive(item.index);
                  }}
                  onClick={() => {
                    if (!item.disabled) choose(item.index);
                  }}
                  className={cn(
                    "relative flex w-full cursor-pointer select-none items-center gap-2 whitespace-nowrap rounded-sm py-1.5 pl-2 pr-8 text-sm text-popover-foreground",
                    "data-[active]:bg-accent data-[active]:text-accent-foreground",
                    item.index === selectedIndex && "font-medium",
                    item.disabled && "cursor-default opacity-50",
                  )}
                >
                  <span className="min-w-0 truncate">{item.label}</span>
                  {item.index === selectedIndex && (
                    <Check
                      aria-hidden="true"
                      className={cn(
                        "absolute right-2 h-4 w-4",
                        item.index === active ? "text-current" : "text-brand-ink",
                      )}
                    />
                  )}
                </div>
              ),
            )}
            {options.length === 0 && (
              <div className="px-2 py-1.5 text-sm text-muted-foreground">-</div>
            )}
          </div>
        </PopoverContent>
      </Popover>
    );
  },
);
PlatformSelect.displayName = "PlatformSelect";
