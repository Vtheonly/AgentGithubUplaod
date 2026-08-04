/**
 * cn — class name combiner. Joins clsx + tailwind-merge so later classes
 * override earlier ones (Tailwind-aware). This is the shadcn/ui standard.
 */
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
