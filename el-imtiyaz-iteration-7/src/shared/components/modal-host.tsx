/**
 * ModalHost — renders the modal stack managed by ModalProvider.
 *
 * Lives at the app root so any page can call useModal().open() to push
 * a modal onto the stack. Modals render in DOM order; the topmost (last)
 * is the one the user is interacting with.
 *
 * Each modal is responsible for its own dialog markup. ModalHost just
 * provides the portal target.
 */
import { createPortal } from "react-dom";
import { useModal } from "../../state/modal-context";

export function ModalHost() {
  const { modals } = useModal();
  if (modals.length === 0) return null;
  return createPortal(
    <div className="z-[90]">
      {modals.map((m) => (
        <div key={m.id}>{m.node}</div>
      ))}
    </div>,
    document.body,
  );
}
