/**
 * Switch — shared Radix-based toggle primitive.
 *
 * Replaces the hand-rolled `<button role="switch">` pattern that existed
 * in multiple Settings tabs (configuration-tab.tsx, etc.). Using a single
 * primitive ensures consistent:
 *   - Size + spacing (h-5 w-9, thumb h-4 w-4)
 *   - Keyboard behavior (Radix handles Space/Enter, focus ring)
 *   - Active/inactive color transitions (bg-primary vs bg-muted)
 *   - Disabled state visual + behavior
 *   - RTL handling (Radix handles `dir` attribute correctly)
 *
 * Usage:
 *   <Switch checked={enabled} onCheckedChange={setEnabled} />
 *
 * Or with a label:
 *   <div className="flex items-center justify-between">
 *     <Label htmlFor="notifications">Notifications</Label>
 *     <Switch id="notifications" checked={on} onCheckedChange={setOn} />
 *   </div>
 */
import * as React from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "./cn";

export const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn(
      "peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
      "disabled:cursor-not-allowed disabled:opacity-50",
      "data-[state=checked]:bg-primary data-[state=unchecked]:bg-muted",
      className,
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb
      className={cn(
        "pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform",
        "data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0",
        // RTL: in RTL the translate direction should flip — Radix sets `dir`
        // on the root which Tailwind's RTL plugin keys off of.
        "rtl:data-[state=checked]:-translate-x-4 rtl:data-[state=unchecked]:translate-x-0",
      )}
    />
  </SwitchPrimitive.Root>
));
Switch.displayName = "Switch";
