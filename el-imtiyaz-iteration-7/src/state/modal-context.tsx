/**
 * Modal manager — primary interaction layer for create/edit operations.
 *
 * Per the spec: modals must be reusable, consistent in design, form-driven,
 * and validated before submission. This provider gives every page a
 * declarative way to open/close modals without each page implementing its
 * own state machine.
 *
 * Usage:
 *   const { open, close } = useModal();
 *   open(<MyFormModal onClose={close} />);
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

interface ModalEntry {
  readonly id: string;
  readonly node: ReactNode;
}

interface ModalContextValue {
  modals: readonly ModalEntry[];
  open(node: ReactNode): string;
  close(id: string): void;
  closeAll(): void;
}

const ModalContext = createContext<ModalContextValue | null>(null);

export function ModalProvider({ children }: { children: ReactNode }) {
  const [modals, setModals] = useState<ModalEntry[]>([]);

  const open = useCallback((node: ReactNode): string => {
    const id = `mdl-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setModals((curr) => [...curr, { id, node }]);
    return id;
  }, []);

  const close = useCallback((id: string) => {
    setModals((curr) => curr.filter((m) => m.id !== id));
  }, []);

  const closeAll = useCallback(() => setModals([]), []);

  const value = useMemo<ModalContextValue>(
    () => ({ modals, open, close, closeAll }),
    [modals, open, close, closeAll],
  );

  return <ModalContext.Provider value={value}>{children}</ModalContext.Provider>;
}

export function useModal(): ModalContextValue {
  const ctx = useContext(ModalContext);
  if (!ctx) throw new Error("useModal must be used inside <ModalProvider>");
  return ctx;
}
