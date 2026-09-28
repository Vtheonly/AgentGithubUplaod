/**
 * T-437 (STUDENT-501 / issue #18 §8–§10): the direct student-creation flow's
 * FIRST step — search an EXISTING parent (the canonical
 * `ParentRepository.search`) or create a new one (the classic Step-1 form).
 *
 * The intended workflow (issue #18 §10):
 *   Select/Create Parent → Add Student → Pre-filled Student Form →
 *   Complete Missing/New Information → Create Student
 * — instead of navigating to the parent's profile first and re-entering
 * everything. An existing parent binds by its ACTUAL code (ADR-031 §7):
 * the record is reused, never duplicated.
 */
import { useState } from "react";
import { Search, UserCheck, UserPlus } from "lucide-react";
import { useRepositories } from "../../../app/providers/repository-provider";
import { Button } from "../../../shared/ui/button";
import { Input } from "../../../shared/ui/input";
import { Badge } from "../../../shared/ui/badge";
import { parentDisplayName, type Parent } from "../../../domain/model/parent";
import { Step1 } from "./step1-parent";
import type { Step1Parent } from "./types";

export function ParentPickerStep({
  parent,
  setParent,
  errors,
  selectedParent,
  onSelectParent,
}: {
  parent: Step1Parent;
  setParent: (p: Step1Parent) => void;
  errors: Record<string, string>;
  selectedParent: Parent | null;
  onSelectParent: (p: Parent | null) => void;
}) {
  const repos = useRepositories();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Parent[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [createNew, setCreateNew] = useState(false);

  async function runSearch() {
    const q = query.trim();
    if (q.length < 2) return;
    setSearching(true);
    try {
      const res = await repos.parents.search(q);
      setResults(res.ok ? res.value : []);
      setSearched(true);
    } finally {
      setSearching(false);
    }
  }

  // An existing parent is selected → the identity card (the student form's
  // step 2 follows; nothing to re-enter).
  if (selectedParent && !createNew) {
    return (
      <div className="space-y-3">
        <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">
          <div className="flex items-center justify-between">
            <p className="font-medium text-primary flex items-center gap-2">
              <UserCheck className="h-4 w-4" /> Parent existant sélectionné
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  onSelectParent(null);
                  setCreateNew(false);
                }}
              >
                Changer
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  onSelectParent(null);
                  setCreateNew(true);
                }}
              >
                <UserPlus className="h-3.5 w-3.5" /> Créer un nouveau parent
              </Button>
            </div>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">
              {parentDisplayName(selectedParent)}
            </p>
            <p className="font-mono">{selectedParent.code}</p>
            <p>{selectedParent.phone}</p>
            <p>{selectedParent.email ?? "—"}</p>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Les nouveaux élèves seront rattachés à ce dossier — aucun parent
            dupliqué ne sera créé, et la facturation sera écrite sur cette
            famille.
          </p>
        </div>
      </div>
    );
  }

  // Create-a-new-parent mode → the classic Step-1 identity form.
  if (createNew) {
    return (
      <div className="space-y-3">
        <Step1 parent={parent} setParent={setParent} errors={errors} />
        <Button variant="ghost" size="sm" onClick={() => setCreateNew(false)}>
          ← Retour à la recherche
        </Button>
      </div>
    );
  }

  // The default: search the existing parents.
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Recherchez le parent de l'élève à créer (nom, téléphone ou code PAR-…).
        S'il n'existe pas encore, créez-le — l'élève sera pré-rempli avec ses
        coordonnées.
      </p>
      <div className="flex gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && runSearch()}
          placeholder="Nom, téléphone ou code du parent…"
        />
        <Button variant="outline" onClick={runSearch} disabled={query.trim().length < 2 || searching}>
          <Search className="h-4 w-4" /> {searching ? "Recherche…" : "Rechercher"}
        </Button>
      </div>

      {searched && results.length > 0 && (
        <div className="rounded-md border border-border divide-y divide-border max-h-72 overflow-y-auto">
          {results.slice(0, 25).map((p) => (
            <button
              key={p.id}
              type="button"
              className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-accent/10"
              onClick={() => onSelectParent(p)}
            >
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{parentDisplayName(p)}</p>
                <p className="text-xs text-muted-foreground font-mono">
                  {p.code} · {p.phone}
                </p>
              </div>
              <Badge variant="outline">Sélectionner</Badge>
            </button>
          ))}
        </div>
      )}
      {searched && results.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Aucun parent ne correspond à « {query} ».
        </p>
      )}

      <Button variant="outline" className="w-full" onClick={() => setCreateNew(true)}>
        <UserPlus className="h-4 w-4" /> Créer un nouveau parent
      </Button>
    </div>
  );
}
