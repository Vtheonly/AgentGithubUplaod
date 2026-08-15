/**
 * Smoke tests for the 5 core UI primitives built in Phase 3.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { z } from "zod";
import { DataTable } from "../../shared/ui/data-table";
import { AutoFormModal } from "../../shared/ui/auto-form";
import { EntityDetailDrawer } from "../../shared/ui/entity-drawer";
import { Wizard } from "../../shared/ui/wizard";
import { RoleDashboardLayout } from "../../features/personnel/dashboards/role-dashboard-layout";
import { Users, FileText, Bell } from "lucide-react";

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
  it("renders role title, KPIs, tasks, and feed", () => {
    render(
      <RoleDashboardLayout
        role="Manager" actorName="Karim Benali"
        kpis={[
          { label: "Élèves actifs", value: 248, icon: Users, trend: "+12" },
          { label: "Paiements en attente", value: 3, icon: FileText },
        ]}
        tasks={[{ id: "t1", label: "Approve expense #EXP-001", priority: "high", dueIn: "2h" }]}
        feed={[{ id: "f1", label: "Payment received", timestamp: "2m ago", icon: Bell }]}
      />,
    );
    expect(screen.getByText("Manager Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Karim Benali")).toBeInTheDocument();
    expect(screen.getByText("Élèves actifs")).toBeInTheDocument();
    expect(screen.getByText("248")).toBeInTheDocument();
    expect(screen.getByText("Approve expense #EXP-001")).toBeInTheDocument();
    expect(screen.getByText("Payment received")).toBeInTheDocument();
  });
});
