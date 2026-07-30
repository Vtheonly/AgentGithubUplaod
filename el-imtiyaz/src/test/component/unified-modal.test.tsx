/**
 * Component tests for UnifiedModal — the single source of truth for all
 * modal-style interactions in the application.
 *
 * Verifies the iteration 3 + 4 contract:
 *   - Dialog and drawer variants render with consistent header/body/footer
 *   - Loading state disables both buttons and shows a spinner
 *   - Inline alert renders at the top of the body
 *   - Close button (X) calls onOpenChange(false)
 *   - Cancel button calls onOpenChange(false)
 *   - Submit button calls onSubmit
 *   - hideFooter suppresses the auto-built footer
 *   - ConfirmModal preset wraps UnifiedModal with destructive variant
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  UnifiedModal,
  ConfirmModal,
} from "../../shared/ui/unified-modal";
import { Plus } from "lucide-react";

describe("UnifiedModal — dialog variant", () => {
  it("renders title and description in the header", () => {
    render(
      <UnifiedModal
        open
        onOpenChange={() => {}}
        title="Test Modal"
        description="Test description"
      >
        <p>Body content</p>
      </UnifiedModal>,
    );
    expect(screen.getByText("Test Modal")).toBeInTheDocument();
    expect(screen.getByText("Test description")).toBeInTheDocument();
    expect(screen.getByText("Body content")).toBeInTheDocument();
  });

  it("renders an icon when provided", () => {
    render(
      <UnifiedModal
        open
        onOpenChange={() => {}}
        title="Test"
        icon={Plus}
      >
        body
      </UnifiedModal>,
    );
    // Radix Dialog renders into a Portal at document.body, so we use
    // document.body rather than the render container to find the icon SVG.
    const svg = document.body.querySelector("svg");
    expect(svg).not.toBeNull();
  });

  it("calls onOpenChange(false) when the close (X) button is clicked", () => {
    const onOpenChange = vi.fn();
    render(
      <UnifiedModal open onOpenChange={onOpenChange} title="Test">
        body
      </UnifiedModal>,
    );
    const closeBtn = screen.getByLabelText("Fermer");
    fireEvent.click(closeBtn);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("calls onOpenChange(false) when the cancel button is clicked", () => {
    const onOpenChange = vi.fn();
    render(
      <UnifiedModal open onOpenChange={onOpenChange} title="Test" submitLabel="OK">
        body
      </UnifiedModal>,
    );
    fireEvent.click(screen.getByText("Annuler"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("calls onSubmit when the submit button is clicked", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <UnifiedModal
        open
        onOpenChange={() => {}}
        title="Test"
        submitLabel="Save"
        onSubmit={onSubmit}
      >
        body
      </UnifiedModal>,
    );
    fireEvent.click(screen.getByText("Save"));
    // onSubmit is async — wait for the next microtask
    await Promise.resolve();
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("disables the submit button when submitDisabled is true", () => {
    render(
      <UnifiedModal
        open
        onOpenChange={() => {}}
        title="Test"
        submitLabel="Save"
        onSubmit={() => {}}
        submitDisabled
      >
        body
      </UnifiedModal>,
    );
    const submitBtn = screen.getByText("Save").closest("button");
    expect(submitBtn).toBeDisabled();
  });

  it("renders an inline alert at the top of the body when alert is provided", () => {
    render(
      <UnifiedModal
        open
        onOpenChange={() => {}}
        title="Test"
        alert={{ tone: "error", title: "Something went wrong", description: "Try again" }}
      >
        <p>Body content</p>
      </UnifiedModal>,
    );
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByText("Try again")).toBeInTheDocument();
  });

  it("hides the footer when hideFooter is true", () => {
    render(
      <UnifiedModal open onOpenChange={() => {}} title="Test" hideFooter>
        body
      </UnifiedModal>,
    );
    // No Annuler button should be present
    expect(screen.queryByText("Annuler")).not.toBeInTheDocument();
  });

  it("hides the cancel button when hideCancel is true", () => {
    render(
      <UnifiedModal
        open
        onOpenChange={() => {}}
        title="Test"
        submitLabel="OK"
        hideCancel
      >
        body
      </UnifiedModal>,
    );
    expect(screen.queryByText("Annuler")).not.toBeInTheDocument();
    expect(screen.getByText("OK")).toBeInTheDocument();
  });

  it("renders a custom footer when footer prop is provided", () => {
    render(
      <UnifiedModal
        open
        onOpenChange={() => {}}
        title="Test"
        footer={<button>Custom Action</button>}
      >
        body
      </UnifiedModal>,
    );
    expect(screen.getByText("Custom Action")).toBeInTheDocument();
    // Auto-built cancel/submit should NOT be present when custom footer is provided
    expect(screen.queryByText("Annuler")).not.toBeInTheDocument();
  });

  it("does not render content when open is false", () => {
    render(
      <UnifiedModal open={false} onOpenChange={() => {}} title="Test">
        body
      </UnifiedModal>,
    );
    expect(screen.queryByText("Test")).not.toBeInTheDocument();
    expect(screen.queryByText("body")).not.toBeInTheDocument();
  });
});

describe("UnifiedModal — drawer variant", () => {
  it("renders title and body in the slide-over", () => {
    render(
      <UnifiedModal
        open
        onOpenChange={() => {}}
        variant="drawer"
        size="lg"
        title="Drawer Test"
        description="Drawer description"
      >
        <p>Drawer body</p>
      </UnifiedModal>,
    );
    expect(screen.getByText("Drawer Test")).toBeInTheDocument();
    expect(screen.getByText("Drawer description")).toBeInTheDocument();
    expect(screen.getByText("Drawer body")).toBeInTheDocument();
  });

  it("calls onOpenChange(false) when the close button is clicked", () => {
    const onOpenChange = vi.fn();
    render(
      <UnifiedModal
        open
        onOpenChange={onOpenChange}
        variant="drawer"
        title="Drawer Test"
      >
        body
      </UnifiedModal>,
    );
    fireEvent.click(screen.getByLabelText("Fermer"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("supports hideFooter in drawer variant", () => {
    render(
      <UnifiedModal
        open
        onOpenChange={() => {}}
        variant="drawer"
        title="Test"
        hideFooter
      >
        body
      </UnifiedModal>,
    );
    expect(screen.queryByText("Annuler")).not.toBeInTheDocument();
  });
});

describe("UnifiedModal — loading state", () => {
  it("shows 'Traitement…' text and disables buttons when submitLoading is true", () => {
    render(
      <UnifiedModal
        open
        onOpenChange={() => {}}
        title="Test"
        submitLabel="Save"
        onSubmit={() => {}}
        submitLoading
      >
        body
      </UnifiedModal>,
    );
    expect(screen.getByText("Traitement…")).toBeInTheDocument();
    // The original "Save" label should be replaced
    expect(screen.queryByText("Save")).not.toBeInTheDocument();
    // Cancel button should be disabled
    expect(screen.getByText("Annuler").closest("button")).toBeDisabled();
  });
});

describe("UnifiedModal — locked behavior", () => {
  it("does NOT call onOpenChange(false) when close button is clicked and locked=true", () => {
    const onOpenChange = vi.fn();
    render(
      <UnifiedModal
        open
        onOpenChange={onOpenChange}
        title="Test"
        locked
      >
        body
      </UnifiedModal>,
    );
    fireEvent.click(screen.getByLabelText("Fermer"));
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});

describe("ConfirmModal preset", () => {
  it("renders the title and confirm label", () => {
    render(
      <ConfirmModal
        open
        onOpenChange={() => {}}
        title="Confirm action?"
        description="This cannot be undone."
        confirmLabel="Confirm"
        onConfirm={() => {}}
      />,
    );
    expect(screen.getByText("Confirm action?")).toBeInTheDocument();
    expect(screen.getByText("This cannot be undone.")).toBeInTheDocument();
    expect(screen.getByText("Confirm")).toBeInTheDocument();
  });

  it("calls onConfirm and closes the modal when the confirm button is clicked", async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    const onOpenChange = vi.fn();
    render(
      <ConfirmModal
        open
        onOpenChange={onOpenChange}
        title="Confirm?"
        confirmLabel="Yes"
        onConfirm={onConfirm}
      />,
    );
    fireEvent.click(screen.getByText("Yes"));
    await Promise.resolve();
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("destructive confirm uses the destructive submit variant", () => {
    const { container } = render(
      <ConfirmModal
        open
        onOpenChange={() => {}}
        title="Delete?"
        confirmLabel="Delete"
        destructive
        onConfirm={() => {}}
      />,
    );
    // The destructive button uses bg-status-danger (via Button variant="destructive")
    const confirmBtn = screen.getByText("Delete").closest("button");
    expect(confirmBtn).toBeInTheDocument();
    // The destructive variant sets a specific class
    expect(confirmBtn?.className).toMatch(/bg-status-danger|destructive/);
  });
});

// (LucideTestIcon removed — we now use a real lucide icon (Plus) for the icon test.)
