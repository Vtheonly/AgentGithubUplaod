/**
 * CRM hub — Hub 2.
 *
 * Tabs: Parents / Élèves / Inscription groupée.
 * The Parents tab opens a slide-over drawer on row click and supports
 * batch registration via the toolbar button.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Plus, Filter, Search, Download, Phone, MessageCircle, Mail, Eye } from "lucide-react";
import { useRepositories } from "../../infrastructure/repository-provider";
import type { Parent } from "../../domain/model/parent";
import type { Student } from "../../domain/model/student";
import { LEVEL_LABELS_FR, STUDENT_STATUS_LABELS_FR } from "../../domain/model/student";
import { useObservable } from "../../shared/hooks/use-observable";
import { PageHeader } from "../../shared/components/page-header";
import { Card, CardContent } from "../../shared/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../../shared/ui/tabs";
import { Button } from "../../shared/ui/button";
import { Input } from "../../shared/ui/input";
import { Avatar, AvatarFallback } from "../../shared/ui/avatar";
import { StatusChip } from "../../shared/components/status-chip";
import { AsyncContent, EmptyState } from "../../shared/components/state-views";
import { ComingSoonCard } from "../../shared/components/coming-soon-card";
import { BatchRegistrationModal } from "./batch-registration-modal";
import { ParentDetailDrawer } from "./parent-detail-drawer";

export function CrmPage() {
  const { t } = useTranslation();
  const [batchOpen, setBatchOpen] = useState(false);
  const [drawerParentId, setDrawerParentId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  function openParent(parentId: string) {
    setDrawerParentId(parentId);
    setDrawerOpen(true);
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title={t("nav.crm")}
        description="Gestion des parents et des élèves — inscription groupée 1→N, navigation bidirectionnelle"
        actions={
          <>
            <Button variant="outline" size="sm"><Download className="h-4 w-4" /> {t("common.export")}</Button>
            <Button size="sm" onClick={() => setBatchOpen(true)}>
              <Plus className="h-4 w-4" /> Nouvelle inscription
            </Button>
          </>
        }
      />
      <Tabs defaultValue="parents" className="flex-1 flex flex-col px-6 pb-6 min-h-0">
        <TabsList>
          <TabsTrigger value="parents">Parents</TabsTrigger>
          <TabsTrigger value="students">Élèves</TabsTrigger>
          <TabsTrigger value="batch">Inscription groupée</TabsTrigger>
        </TabsList>
        <TabsContent value="parents" className="flex-1 overflow-y-auto mt-4">
          <ParentsTab onOpenParent={openParent} />
        </TabsContent>
        <TabsContent value="students" className="flex-1 overflow-y-auto mt-4">
          <StudentsTab />
        </TabsContent>
        <TabsContent value="batch" className="flex-1 overflow-y-auto mt-4">
          <ComingSoonCard
            title="Inscription groupée (Parent + N élèves)"
            description="Cliquez sur 'Nouvelle inscription' en haut à droite pour démarrer l'assistant 4 étapes. Transaction atomique BEGIN…COMMIT."
          />
        </TabsContent>
      </Tabs>

      <BatchRegistrationModal
        open={batchOpen}
        onOpenChange={setBatchOpen}
        onSubmitted={(parentId) => openParent(parentId)}
      />
      <ParentDetailDrawer
        parentId={drawerParentId}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        onAddChild={(pid) => {
          setDrawerOpen(false);
          setBatchOpen(true);
          // Note: in a future iteration we could pre-fill the parent step.
          void pid;
        }}
      />
    </div>
  );
}

function ParentsTab({ onOpenParent }: { onOpenParent: (id: string) => void }) {
  const repos = useRepositories();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const highlightId = searchParams.get("parentId");
  const parents = useObservable(() => repos.parents.observe(), []);
  const [query, setQuery] = useState("");

  const filtered = query.trim()
    ? parents.filter((p) =>
        `${p.firstName} ${p.lastName} ${p.phone} ${p.code}`.toLowerCase().includes(query.toLowerCase()),
      )
    : parents;

  return (
    <Card>
      <CardContent className="p-0">
        {/* Toolbar */}
        <div className="flex items-center gap-2 border-b border-border p-3">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Rechercher par nom, téléphone, code…"
              className="pl-9"
            />
          </div>
          <Button variant="outline" size="sm"><Filter className="h-4 w-4" /> Niveau</Button>
          <Button variant="outline" size="sm"><Download className="h-4 w-4" /></Button>
        </div>

        <AsyncContent
          isLoading={false}
          error={null}
          items={filtered}
          emptyTitle="Aucun parent"
          emptyDescription="Commencez par inscrire un premier parent."
        >
          {(items) => (
            <ul className="divide-y divide-border">
              {items.map((p) => {
                const isHighlighted = p.id === highlightId;
                return (
                  <li
                    key={p.id}
                    className={`flex items-center gap-3 p-3 cursor-pointer transition-colors hover:bg-accent/5 ${isHighlighted ? "bg-primary/10" : ""}`}
                    onClick={() => onOpenParent(p.id)}
                  >
                    <Avatar className="h-10 w-10">
                      <AvatarFallback>
                        {p.firstName[0]}
                        {p.lastName[0]}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-foreground truncate">
                          {p.firstName} {p.lastName}
                        </p>
                        <span className="font-mono text-xs text-muted-foreground">{p.code}</span>
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{p.phone}</p>
                    </div>
                    <div className="hidden md:flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{p.address ?? "—"}</span>
                    </div>
                    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      <Button variant="ghost" size="icon" title="Appeler" onClick={() => window.open(`tel:${p.phone}`)}>
                        <Phone className="h-4 w-4" />
                      </Button>
                      {p.whatsapp ? (
                        <Button variant="ghost" size="icon" title="WhatsApp" onClick={() => window.open(`https://wa.me/${(p.whatsapp ?? "").replace(/[\s+]/g, "")}`)}>
                          <MessageCircle className="h-4 w-4" />
                        </Button>
                      ) : null}
                      {p.email ? (
                        <Button variant="ghost" size="icon" title="E-mail" onClick={() => window.open(`mailto:${p.email}`)}>
                          <Mail className="h-4 w-4" />
                        </Button>
                      ) : null}
                      <Button variant="ghost" size="icon" title="Consulter" onClick={() => onOpenParent(p.id)}>
                        <Eye className="h-4 w-4" />
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </AsyncContent>
      </CardContent>
    </Card>
  );
}

function StudentsTab() {
  const repos = useRepositories();
  const students = useObservable(() => repos.students.observe(), []);
  return (
    <Card>
      <CardContent className="p-0">
        <div className="flex items-center gap-2 border-b border-border p-3">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Rechercher un élève…" className="pl-9" />
          </div>
          <Button variant="outline" size="sm"><Filter className="h-4 w-4" /> Niveau</Button>
          <Button variant="outline" size="sm"><Download className="h-4 w-4" /></Button>
        </div>
        {students.length === 0 ? (
          <EmptyState title="Aucun élève" />
        ) : (
          <ul className="divide-y divide-border">
            {students.map((s) => (
              <li key={s.id} className="flex items-center gap-3 p-3 hover:bg-accent/5">
                <Avatar className="h-9 w-9">
                  <AvatarFallback>
                    {s.firstName[0]}{s.lastName[0]}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-foreground truncate">
                      {s.firstName} {s.lastName}
                    </p>
                    <span className="font-mono text-xs text-muted-foreground">{s.code}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {LEVEL_LABELS_FR[s.level]} — Année {s.gradeYear}
                  </p>
                </div>
                <StatusChip
                  label={STUDENT_STATUS_LABELS_FR[s.status]}
                  tone={s.status === "active" ? "success" : "neutral"}
                />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
