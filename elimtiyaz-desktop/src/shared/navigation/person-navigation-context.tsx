// ============================================================================
// FILE: elimtiyaz-desktop/src/shared/navigation/person-navigation-context.tsx
// ============================================================================
/**
 * Global Person Navigation System (Students & Parents).
 *
 * Provides a unified, cross-application navigation layer so that clicking a
 * student or parent anywhere (Statistiques, Finances, Pédagogie, CRM, Personnel)
 * opens their detailed profile drawer instantly or navigates across modules
 * without re-searching.
 */

import React, { createContext, useContext, useState, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { ParentDetailDrawer } from "../../features/crm/parent-detail-drawer";
import { StudentDetailDrawer } from "../../features/crm/student-detail-drawer";
import type { Parent } from "../../domain/model/parent";

export type StudentSectionTarget = "crm" | "finances" | "pedagogy" | "notes";
export type ParentSectionTarget = "crm" | "finances" | "debt";

export interface PersonNavigationContextValue {
  /** Open a student's drawer directly from anywhere in the application */
  openStudent: (studentId: string) => void;
  /** Open a parent's drawer directly from anywhere in the application */
  openParent: (parentId: string) => void;
  /** Close student drawer */
  closeStudent: () => void;
  /** Close parent drawer */
  closeParent: () => void;
  /** Currently active student in drawer (if any) */
  activeStudentId: string | null;
  /** Currently active parent in drawer (if any) */
  activeParentId: string | null;

  /** Navigate across modules to a specific student view */
  navigateToStudent: (studentId: string, section?: StudentSectionTarget) => void;
  /** Navigate across modules to a specific parent view */
  navigateToParent: (parentId: string, section?: ParentSectionTarget) => void;
}

const PersonNavigationContext = createContext<PersonNavigationContextValue | null>(null);

export function PersonNavigationProvider({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const [activeStudentId, setActiveStudentId] = useState<string | null>(null);
  const [activeParentId, setActiveParentId] = useState<string | null>(null);

  const openStudent = useCallback((studentId: string) => {
    setActiveParentId(null);
    setActiveStudentId(studentId);
  }, []);

  const openParent = useCallback((parentId: string) => {
    setActiveStudentId(null);
    setActiveParentId(parentId);
  }, []);

  const closeStudent = useCallback(() => {
    setActiveStudentId(null);
  }, []);

  const closeParent = useCallback(() => {
    setActiveParentId(null);
  }, []);

  const navigateToStudent = useCallback(
    (studentId: string, section: StudentSectionTarget = "crm") => {
      setActiveStudentId(null);
      setActiveParentId(null);
      switch (section) {
        case "crm":
          navigate(`/crm?studentId=${studentId}`);
          break;
        case "finances":
          navigate(`/financials?studentId=${studentId}`);
          break;
        case "pedagogy":
          navigate(`/academics?studentId=${studentId}`);
          break;
        case "notes":
          navigate(`/academics?studentId=${studentId}&tab=grades`);
          break;
      }
    },
    [navigate],
  );

  const navigateToParent = useCallback(
    (parentId: string, section: ParentSectionTarget = "crm") => {
      setActiveStudentId(null);
      setActiveParentId(null);
      switch (section) {
        case "crm":
          navigate(`/crm?parentId=${parentId}`);
          break;
        case "finances":
          navigate(`/financials?familyId=${parentId}`);
          break;
        case "debt":
          navigate(`/financials?tab=debt-aging&parentId=${parentId}`);
          break;
      }
    },
    [navigate],
  );

  const value = useMemo<PersonNavigationContextValue>(
    () => ({
      openStudent,
      openParent,
      closeStudent,
      closeParent,
      activeStudentId,
      activeParentId,
      navigateToStudent,
      navigateToParent,
    }),
    [
      openStudent,
      openParent,
      closeStudent,
      closeParent,
      activeStudentId,
      activeParentId,
      navigateToStudent,
      navigateToParent,
    ],
  );

  return (
    <PersonNavigationContext.Provider value={value}>
      {children}

      {/* Global Master Drawers accessible from any screen */}
      <ParentDetailDrawer
        parentId={activeParentId}
        open={activeParentId !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) setActiveParentId(null);
        }}
        onOpenStudent={(studentId) => {
          openStudent(studentId);
        }}
        onAddChild={(parent: Parent) => {
          setActiveParentId(null);
          navigate(`/crm?action=add-child&parentId=${parent.id}`);
        }}
      />

      <StudentDetailDrawer
        studentId={activeStudentId}
        open={activeStudentId !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) setActiveStudentId(null);
        }}
        onOpenParent={(parentId) => {
          openParent(parentId);
        }}
      />
    </PersonNavigationContext.Provider>
  );
}

export function usePersonNavigation(): PersonNavigationContextValue {
  const ctx = useContext(PersonNavigationContext);
  if (!ctx) {
    throw new Error("usePersonNavigation must be used within <PersonNavigationProvider>");
  }
  return ctx;
}