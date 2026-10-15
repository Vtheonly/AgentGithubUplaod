/**
 * Smoke tests for the 5 core UI primitives built in Phase 3.
 */
import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { z } from "zod";
import { DataTable } from "../../shared/ui/data-table";
import { AutoFormModal } from "../../shared/ui/auto-form";
import { EntityDetailDrawer } from "../../shared/ui/entity-drawer";
import { Wizard } from "../../shared/ui/wizard";
import { RoleDashboardLayout } from "../../features/personnel/dashboards/role-dashboard-layout";
import { Users, FileText } from "lucide-react";

describe("DataTable primitive", () => {
  interface Person { id: string; name: string; age: number; }
  const data: Person[] = [
    { id: "1", name: "Karim", age: 30 },
    { id: "2", name: "Amina", age: 25 },
    { id: "3", name: "Yacine", age: 35 },
  ];

  it("renders header row + data rows", () => {
    render(
      <DataTable
        data={data}
        columns={[
          { header: "Nom", accessor: "name" },
          { header: "Âge", accessor: "age" },
        ]}
      />,
    );
    expect(screen.getByText("Nom")).toBeInTheDocument();
    expect(screen.getByText("Karim")).toBeInTheDocument();
    expect(screen.getByText("Amina")).toBeInTheDocument();
    expect(screen.getByText("35")).toBeInTheDocument();
  });

  it("renders empty-state message when data is empty", () => {
    render(
      <DataTable data={[]} columns={[{ header: "X", accessor: "name" }]} emptyMessage="Aucune matière." />,
    );
    expect(screen.getByText("Aucune matière.")).toBeInTheDocument();
  });

  it("renders action buttons when provided", () => {
    const onEdit = vi.fn();
    render(
      <DataTable
        data={data.slice(0, 1)}
        columns={[{ header: "Nom", accessor: "name" }]}
        actions={[{ label: "Edit", onClick: onEdit, variant: "ghost" }]}
      />,
    );
    expect(screen.getByText("Edit")).toBeInTheDocument();
  });

  it("filters rows by global search", async () => {
    render(
      <DataTable data={data} columns={[{ header: "Nom", accessor: "name" }]} searchPlaceholder="Rechercher…" />,
    );
    const input = screen.getByPlaceholderText("Rechercher…");
    fireEvent.change(input, { target: { value: "Karim" } });
    await waitFor(() => {
      expect(screen.getByText("Karim")).toBeInTheDocument();
      expect(screen.queryByText("Amina")).not.toBeInTheDocument();
    });
  });

  it("hides the search input when hideSearch is true", () => {
    render(
      <DataTable
        data={data}
        columns={[{ header: "Nom", accessor: "name" }]}
        searchPlaceholder="Rechercher…"
        hideSearch
      />,
    );
    expect(screen.queryByPlaceholderText("Rechercher…")).not.toBeInTheDocument();
    // Data is still rendered
    expect(screen.getByText("Karim")).toBeInTheDocument();
  });
});

describe("AutoFormModal primitive", () => {
  const Schema = z.object({
    name: z.string().min(2, "Nom trop court"),
    age: z.number().int().min(0).max(120),
  });

  it("renders title, fields, and submit/cancel buttons when open", () => {
    render(
      <AutoFormModal
        open onOpenChange={() => {}} title="Nouvel Élève" description="Saisir les informations"
        schema={Schema}
        fields={[
          { name: "name", label: "Nom", type: "text", required: true },
          { name: "age", label: "Âge", type: "number" },
        ]}
        onSubmit={() => {}}
      />,
    );
    expect(screen.getByText("Nouvel Élève")).toBeInTheDocument();
    expect(screen.getByText("Saisir les informations")).toBeInTheDocument();
    expect(screen.getByText("Nom")).toBeInTheDocument();
    expect(screen.getByText("Enregistrer")).toBeInTheDocument();
    expect(screen.getByText("Annuler")).toBeInTheDocument();
  });

  it("renders nothing when closed", () => {
    const { container } = render(
      <AutoFormModal
        open={false} onOpenChange={() => {}} title="Hidden"
        schema={Schema} fields={[{ name: "name", label: "Nom", type: "text" }]} onSubmit={() => {}}
      />,
    );
    expect(container.querySelector("[role='dialog']")).toBeNull();
  });

  it("renders initial values when provided (edit mode)", () => {
    render(
      <AutoFormModal
        open onOpenChange={() => {}} title="Modifier"
        schema={Schema} fields={[{ name: "name", label: "Nom", type: "text" }]}
        initialValues={{ name: "Karim" }} onSubmit={() => {}}
      />,
    );
    expect(screen.getByDisplayValue("Karim")).toBeInTheDocument();
  });

  it("renders a password field with type=password so credentials are masked", () => {
    const PwSchema = z.object({ secret: z.string().min(1, "Requis") });
    render(
      <AutoFormModal
        open onOpenChange={() => {}} title="Mot de passe"
        schema={PwSchema}
        fields={[{ name: "secret", label: "Mot de passe", type: "password", required: true }]}
        initialValues={{ secret: "supersecret" }}
        onSubmit={() => {}}
      />,
    );
    const input = screen.getByDisplayValue("supersecret") as HTMLInputElement;
    expect(input.type).toBe("password");
  });

  // T-548 / UI-355 (Fix A) — the reset contract regression pins. The host
  // mirrors the REAL consumers: `initialValues` is built INLINE at render
  // time (a fresh object reference on every parent render — school-years-tab,
  // manual-debt-modal, subjects, clubs, … all do this), and the re-render
  // trigger stands in for the live repository observable emissions that fire
  // while a modal is open.
  describe("UI-355 / T-548 Fix A — the reset-on-rising-edge contract", () => {
    function ReRenderingHost() {
      const [, force] = useState(0);
      // Fresh object reference on EVERY render — the consumer census shape.
      const initialValues = { name: "2026-2027 (défaut)", age: 20 };
      return (
        <div>
          <button type="button" onClick={() => force((n) => n + 1)}>
            observable-emission
          </button>
          <AutoFormModal
            open onOpenChange={() => {}} title="Année scolaire"
            schema={Schema}
            fields={[{ name: "name", label: "Année", type: "text", required: true }]}
            initialValues={initialValues}
            onSubmit={() => {}}
          />
        </div>
      );
    }

    it("does NOT clobber the user's in-progress selection when the parent re-renders with a fresh initialValues reference mid-open (the school-year reversion bug)", async () => {
      render(<ReRenderingHost />);
      const input = screen.getByDisplayValue("2026-2027 (défaut)");
      // The user manually selects an OLDER school year.
      fireEvent.change(input, { target: { value: "2022-2023" } });
      expect(screen.getByDisplayValue("2022-2023")).toBeInTheDocument();
      // A parent re-render fires mid-edit (repository observable emission /
      // sibling state change) — initialValues is a NEW reference with the
      // same defaults. Under the pre-fix effect this reset the form and
      // silently reverted the selection to the current-default year.
      fireEvent.click(screen.getByText("observable-emission"));
      fireEvent.click(screen.getByText("observable-emission"));
      await waitFor(() => {
        expect(screen.getByDisplayValue("2022-2023")).toBeInTheDocument();
      });
    });

    it("re-seeds from initialValues ONLY on the closed→open transition (a different record's values replace the stale form state; a mid-open seed change does not)", () => {
      function TogglingHost({ open, seed }: { open: boolean; seed: string }) {
        // Inline literal — the fresh-reference-every-render consumer shape.
        const initialValues = { name: seed, age: 20 };
        return (
          <AutoFormModal
            open={open} onOpenChange={() => {}} title="Modifier"
            schema={Schema}
            fields={[{ name: "name", label: "Année", type: "text", required: true }]}
            initialValues={initialValues}
            onSubmit={() => {}}
          />
        );
      }
      const { rerender } = render(<TogglingHost open seed="2022-2023" />);
      expect(screen.getByDisplayValue("2022-2023")).toBeInTheDocument();
      // The user edits mid-open.
      fireEvent.change(screen.getByDisplayValue("2022-2023"), { target: { value: "mid-edit" } });
      // Close → the dialog content unmounts.
      rerender(<TogglingHost open={false} seed="2022-2023" />);
      expect(screen.queryByDisplayValue("mid-edit")).toBeNull();
      // Re-open for a DIFFERENT record (editTarget switched) — the fresh
      // seed MUST replace the stale mid-edit form state.
      rerender(<TogglingHost open seed="2024-2025" />);
      expect(screen.getByDisplayValue("2024-2025")).toBeInTheDocument();
    });
  });
});

describe("EntityDetailDrawer primitive", () => {
  interface Parent { id: string; firstName: string; lastName: string; phone: string; }
  const parent: Parent = { id: "p1", firstName: "Karim", lastName: "Benali", phone: "+213 555 12 34 56" };

  it("renders nothing when entity is null", () => {
    const { container } = render(
      <EntityDetailDrawer
        open onOpenChange={() => {}} entity={null}
        title={(p: Parent | null) => (p ? `${p.firstName} ${p.lastName}` : "")}
      />,
    );
    expect(container.querySelector("[role='dialog']")).toBeNull();
  });

  it("renders header + metadata + tabs + actions when entity is provided", () => {
    render(
      <EntityDetailDrawer
        open onOpenChange={() => {}} entity={parent}
        title={(p) => `${p!.firstName} ${p!.lastName}`}
        subtitle={(p) => p!.id}
        avatar={(p) => ({ initials: p!.firstName[0] + p!.lastName[0] })}
        metadata={(p) => [
          { label: "Téléphone", value: p!.phone },
          { label: "ID", value: p!.id },
        ]}
        tabs={() => [
          { id: "payments", label: "Paiements", content: () => <div>Paiements tab content</div> },
          { id: "students", label: "Élèves", content: () => <div>Élèves tab content</div> },
        ]}
        actions={() => [{ label: "Modifier", onClick: () => {}, variant: "outline" }]}
      />,
    );
    expect(screen.getByText("Karim Benali")).toBeInTheDocument();
    expect(screen.getByText("Téléphone")).toBeInTheDocument();
    expect(screen.getByText("+213 555 12 34 56")).toBeInTheDocument();
    expect(screen.getByText("Paiements")).toBeInTheDocument();
    expect(screen.getByText("Paiements tab content")).toBeInTheDocument();
    expect(screen.getByText("Modifier")).toBeInTheDocument();
  });
});

describe("Wizard primitive", () => {
  it("renders step 1 of N + progress + Next button", () => {
    render(
      <Wizard
        open onOpenChange={() => {}} title="Inscription"
        steps={[
          { id: "parent", label: "Parent", render: () => <div>Parent step</div> },
          { id: "students", label: "Élèves", render: () => <div>Students step</div> },
          { id: "review", label: "Récap", render: () => <div>Review step</div> },
        ]}
        onFinish={() => {}}
      />,
    );
    expect(screen.getByText("Inscription")).toBeInTheDocument();
    expect(screen.getByText(/Étape 1 \/ 3/)).toBeInTheDocument();
    expect(screen.getByText("Parent step")).toBeInTheDocument();
    expect(screen.getByText("Suivant")).toBeInTheDocument();
    expect(screen.queryByText("Terminer")).not.toBeInTheDocument();
  });

  it("shows 'Terminer' on the last step", () => {
    render(
      <Wizard
        open onOpenChange={() => {}} title="Final"
        steps={[{ id: "done", label: "Done", render: () => <div>Done</div>, isFinal: true }]}
        onFinish={() => {}}
      />,
    );
    expect(screen.getByText("Terminer")).toBeInTheDocument();
    expect(screen.queryByText("Suivant")).not.toBeInTheDocument();
  });
});

describe("RoleDashboardLayout primitive", () => {
  // T-478 (the owner's removal mandate): the "Activité récente" feed is GONE
  // from the role dashboards — this pin now guards that it stays gone (the
  // section title must never render, even when a caller passes activity
  // data through the layout's remaining slots).
  it("renders role title, KPIs, and tasks — and NO 'Activité récente' feed section", () => {
    render(
      <RoleDashboardLayout
        role="Manager" actorName="Karim Benali"
        kpis={[
          { label: "Élèves actifs", value: 248, icon: Users, trend: "+12" },
          { label: "Paiements en attente", value: 3, icon: FileText },
        ]}
        tasks={[{ id: "t1", label: "Approve expense #EXP-001", priority: "high", dueIn: "2h" }]}
      >
        <div>Activity card content rendered through children</div>
      </RoleDashboardLayout>,
    );
    expect(screen.getByText("Manager Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Karim Benali")).toBeInTheDocument();
    expect(screen.getByText("Élèves actifs")).toBeInTheDocument();
    expect(screen.getByText("248")).toBeInTheDocument();
    expect(screen.getByText("Approve expense #EXP-001")).toBeInTheDocument();
    expect(screen.getByText("Activity card content rendered through children")).toBeInTheDocument();
    // The removed section never renders.
    expect(screen.queryByText("Activité récente")).not.toBeInTheDocument();
  });
});
