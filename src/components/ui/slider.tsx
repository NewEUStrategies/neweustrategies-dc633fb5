import * as React from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";

import { cn } from "@/lib/utils";

/**
 * `thumbProps` - atrybuty przekazywane na UCHWYT suwaka.
 *
 * Radix stawia `role="slider"` na uchwycie, a nie na korzeniu, więc
 * `aria-label` / `aria-labelledby` podany na korzeniu jest atrybutem, którego
 * czytnik ekranu nigdy nie czyta - użytkownik słyszy „suwak, 4" bez nazwy
 * kontrolki. Nazwa musi trafić tam, gdzie stoi rola, i tylko tą drogą da się ją
 * tam podać.
 */
type SliderThumbProps = React.ComponentPropsWithoutRef<typeof SliderPrimitive.Thumb>;

const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root> & {
    thumbProps?: SliderThumbProps;
  }
>(({ className, thumbProps, ...props }, ref) => (
  <SliderPrimitive.Root
    ref={ref}
    className={cn("relative flex w-full touch-none select-none items-center", className)}
    {...props}
  >
    <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-primary/20">
      <SliderPrimitive.Range className="absolute h-full bg-primary" />
    </SliderPrimitive.Track>
    <SliderPrimitive.Thumb
      {...thumbProps}
      className={cn(
        "block h-4 w-4 rounded-full border border-primary/50 bg-background shadow transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
        thumbProps?.className,
      )}
    />
  </SliderPrimitive.Root>
));
Slider.displayName = SliderPrimitive.Root.displayName;

export { Slider };
