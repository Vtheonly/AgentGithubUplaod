import type { ReactNode } from "react";

export interface EntityDrawerMetaItem {
  readonly label: string;
  readonly value: ReactNode;
}

export interface EntityDrawerTab<T> {
  readonly id: string;
  readonly label: string;
  readonly content: (entity: T) => ReactNode;
  readonly badge?: (entity: T) => number | string | null;
}

export interface EntityDrawerAction<T> {
  readonly label: string;
  readonly onClick: (entity: T) => void;
  readonly variant?: "default" | "outline" | "ghost" | "destructive";
  readonly icon?: ReactNode;
  readonly disabled?: (entity: T) => boolean;
}

export interface EntityDetailDrawerProps<T> {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly entity: T | null;
  readonly title?: (entity: T) => string;
  readonly subtitle?: (entity: T) => string;
  readonly avatar?: (entity: T) => { initials: string; url?: string | null } | null;
  readonly metadata?: (entity: T) => readonly EntityDrawerMetaItem[];
  readonly tabs?: (entity: T) => readonly EntityDrawerTab<T>[];
  readonly actions?: (entity: T) => readonly EntityDrawerAction<T>[];
  readonly widthClass?: string;
  readonly headerAccent?: string;
}
