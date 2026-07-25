Here is a detailed, fully comprehensive English report outlining all system specifications, feature requirements, and UI/UX changes requested in the recording:

---

# Detailed Software Specifications & System Requirements Report

## 1. Traceability, Security & Audit Logging
* **User Traceability:** Every user must have an individual account. Every action performed within the application (inputs, exports, modifications, updates, or deletions) must be logged and tied directly to the user who performed it.
* **Contextual Audit Logs:** Each log entry must capture full context, including:
  * Timestamp.
  * User ID and User Role/Authority level.
  * Database state at the time of the action.
  * Session duration/context.
* **Password Change Tracking:** Implement strict security controls around password changes, logging whenever a password change occurs and identifying who initiated it.
* **Audit Log Placement:** Audit logs must be accessible under the **Settings** menu, with dedicated logs generated per user.

---

## 2. Database, Backups & Data Archiving
* **Primary Database:** All system data must reside on **Supabase**.
* **Offsite & Automated Backups:** 
  * Due to risks associated with Supabase free-tier constraints or potential database downtime, backups **must not** be stored within Supabase itself.
  * Full system backups (database, application state, proofs, and media assets) must run automatically every **24 hours**.
* **Encryption & Security:** 
  * Local/external backup files must be encrypted.
  * System media assets (payment proofs, images, documents) contain sensitive data and must be stored securely.
* **Tenant / User Data Isolation:** Multi-tenant security rules must be enforced so users cannot access data belonging to other users.

---

## 3. Navigation & UI Structure (Page Consolidation)
The application navigation structure must be consolidated into the following clear groupings:

1. **Dashboard & Overview Page:**
   * Combines **Dashboard**, **Notifications**, **Reports**, and **Global Statistics**.
2. **Payments & Dues Page:**
   * Combines **Payments**, **Receipts**, and the **Debt Dashboard**.
3. **Students & Parents Page:**
   * Integrates **Parent Management** and **Student Management** into a single unified view.
4. **Classes Page:**
   * Dedicated page for managing classes and clubs.

---

## 4. Parent & Student Management Workflow
* **Parent-First Dependency:** Students cannot be created independently without an associated Parent profile.
* **Batch Student Creation:** 
  * Allow creating a Parent profile and attaching up to **4 children (Students)** in a single batch form workflow.
  * Fields to capture per student during batch creation: Full Name, assigned Class/Club, Payment details, and any Special Classes/Services needed.
* **Bidirectional Concept Linking:**
  * Clicking on a **Parent** shows all linked children, total financial dues across all children, payment history, and services utilized.
  * Clicking on a **Student** shows linked parent details, class enrollment, and academic history.

---

## 5. Payments, Receipts & Financial Tracking
* **Payment Processing:**
  * Supported payment methods: **Cash**, **Check**, **Bank Transfer**.
  * Ability to upload **Proof of Payment** (images/receipt scans).
  * Ability to attach **Notes/Remarks** to a payment (e.g., expired check notes, bank transfer issues).
* **Payment Statuses:**
  * **Paid**
  * **Unpaid**
  * **Pending**
* **Receipt Generation:**
  * Receipts must automatically generate upon payment entry.
  * **Export Options (PDF):**
    1. *Recent Receipt:* Captures only the latest completed payment transaction.
    2. *Full Statement / Account Receipt:* Generates a complete financial history showing all past payments alongside outstanding/unpaid balances.
* **Parent Financial History:** Accessible directly from the Parent profile rather than as a disconnected top-level menu.

---

## 6. Student Academic History
* **Performance Tracking:** Accessible directly from a Student's profile.
* **Details Tracked:** View past test/exam results, activity logs, and progress history per student.

---

## 7. Statistics & Analytics (Dashboard)
Located at the bottom of the main Dashboard page with a detailed view option ("See Details"):
* **Revenue Metrics:** Monthly and annual revenue tracking, income trends, and payment collection rates.
* **Department & Category Breakdown:** Financial breakdowns by department/club (e.g., Speech Therapy / Orthophonie, Psychology, Chess Club, English Club).
* **Demographic Distributions:** Visual charts (bar charts) displaying student distribution across different grade levels and classes (e.g., 20 students in 1st Grade, 10 in 2nd Grade).

---

## 8. Feature Deprecations / Removals
* **Remove Completely:** 
  * Fee Templates.
  * Scholarships.

add this and give me fulll report
Provide the most absolute, detailed, exhaustive, and rigorous explanation possible, written as very long, structured, and polished, with no steps skipped and no assumptions left implicit.


Here is a detailed, fully comprehensive English report outlining all system specifications, feature requirements, and UI/UX changes requested in the recording:

---

# Detailed Software Specifications & System Requirements Report

## 1. Traceability, Security & Audit Logging
* **User Traceability:** Every user must have an individual account. Every action performed within the application (inputs, exports, modifications, updates, or deletions) must be logged and tied directly to the user who performed it.
* **Contextual Audit Logs:** Each log entry must capture full context, including:
  * Timestamp.
  * User ID and User Role/Authority level.
  * Database state at the time of the action.
  * Session duration/context.
* **Password Change Tracking:** Implement strict security controls around password changes, logging whenever a password change occurs and identifying who initiated it.
* **Audit Log Placement:** Audit logs must be accessible under the **Settings** menu, with dedicated logs generated per user.

---

## 2. Database, Backups & Data Archiving
* **Primary Database:** All system data must reside on **Supabase**.
* **Offsite & Automated Backups:** 
  * Due to risks associated with Supabase free-tier constraints or potential database downtime, backups **must not** be stored within Supabase itself.
  * Full system backups (database, application state, proofs, and media assets) must run automatically every **24 hours**.
* **Encryption & Security:** 
  * Local/external backup files must be encrypted.
  * System media assets (payment proofs, images, documents) contain sensitive data and must be stored securely.
* **Tenant / User Data Isolation:** Multi-tenant security rules must be enforced so users cannot access data belonging to other users.

---

## 3. Navigation & UI Structure (Page Consolidation)
The application navigation structure must be consolidated into the following clear groupings:

1. **Dashboard & Overview Page:**
   * Combines **Dashboard**, **Notifications**, **Reports**, and **Global Statistics**.
2. **Payments & Dues Page:**
   * Combines **Payments**, **Receipts**, and the **Debt Dashboard**.
3. **Students & Parents Page:**
   * Integrates **Parent Management** and **Student Management** into a single unified view.
4. **Classes Page:**
   * Dedicated page for managing classes and clubs.

---

## 4. Parent & Student Management Workflow
* **Parent-First Dependency:** Students cannot be created independently without an associated Parent profile.
* **Batch Student Creation:** 
  * Allow creating a Parent profile and attaching up to **4 children (Students)** in a single batch form workflow.
  * Fields to capture per student during batch creation: Full Name, assigned Class/Club, Payment details, and any Special Classes/Services needed.
* **Bidirectional Concept Linking:**
  * Clicking on a **Parent** shows all linked children, total financial dues across all children, payment history, and services utilized.
  * Clicking on a **Student** shows linked parent details, class enrollment, and academic history.

---

## 5. Payments, Receipts & Financial Tracking
* **Payment Processing:**
  * Supported payment methods: **Cash**, **Check**, **Bank Transfer**.
  * Ability to upload **Proof of Payment** (images/receipt scans).
  * Ability to attach **Notes/Remarks** to a payment (e.g., expired check notes, bank transfer issues).
* **Payment Statuses:**
  * **Paid**
  * **Unpaid**
  * **Pending**
* **Receipt Generation:**
  * Receipts must automatically generate upon payment entry.
  * **Export Options (PDF):**
    1. *Recent Receipt:* Captures only the latest completed payment transaction.
    2. *Full Statement / Account Receipt:* Generates a complete financial history showing all past payments alongside outstanding/unpaid balances.
* **Parent Financial History:** Accessible directly from the Parent profile rather than as a disconnected top-level menu.

---

## 6. Student Academic History
* **Performance Tracking:** Accessible directly from a Student's profile.
* **Details Tracked:** View past test/exam results, activity logs, and progress history per student.

---

## 7. Statistics & Analytics (Dashboard)
Located at the bottom of the main Dashboard page with a detailed view option ("See Details"):
* **Revenue Metrics:** Monthly and annual revenue tracking, income trends, and payment collection rates.
* **Department & Category Breakdown:** Financial breakdowns by department/club (e.g., Speech Therapy / Orthophonie, Psychology, Chess Club, English Club).
* **Demographic Distributions:** Visual charts (bar charts) displaying student distribution across different grade levels and classes (e.g., 20 students in 1st Grade, 10 in 2nd Grade).

---

## 8. Feature Deprecations / Removals
* **Remove Completely:** 
  * Fee Templates.
  * Scholarships.


Here is the complete, fully detailed English technical specification report based on the provided audio transcript.

---

# System Requirements & Feature Specification Report

## 1. Financial & Payment Management System

### 1.1 Installment Payment Module (*Paiement par Tranche*)
* **Multi-Service Installment Options:** Enable flexible installment payments across various school services:
  * **Transport Fees:** Option to break down transportation costs into installments.
  * **Internship / Training Fees (*Stages*):** Monthly installment payment plans.
  * **Extracurricular Activities:** Flexible payment plans tailored per activity.
  * **Direct/Upfront Payments:** Standard immediate full-payment option for standard services.
* **Account Balance Adjustments:** Ability to discount or adjust payment requirements per student account based on specific needs or partial exemptions.
* **Payment Logic Clarification:** The billing engine must clearly define installment schedules, due dates, and remaining balances to eliminate ambiguity in customer billing.

---

## 2. Expense & Request Approval Workflow

### 2.1 Expense Tracking
* Comprehensive logging of all outgoing organizational expenditures. Every financial outflow must be recorded in the system.

### 2.2 Two-Tier Expense Approval System
* **Request Phase:** Staff member submits a purchase/expense request with justification.
* **Authorization Phase:** Admin/Financial Officer approves or rejects the request and releases funds.
* **Proof of Purchase (Receipt Upload):** Upon completing the purchase, the requester must upload photographic proof/receipt to close the request cycle.

---

## 3. Personnel & Teacher Management

### 3.1 Staff Directory ("Personnel" Space)
* A dedicated module for all employee profiles, including administrative staff, maintenance, and teachers.
* Role-based access control defining desktop application privileges for each staff category.

### 3.2 Teacher Services & Profiles
* **Subject Assignment:** Mapping teachers to their respective assigned subjects.
* **Teacher Statement/Log (*Relevé*):** System records tracking teacher actions, grades entered, assigned homework, and performance history.

---

## 4. Academic Structure & Core Schooling System ("Scolarité")

### 4.1 System Distinction
* Clear structural separation between **Core Academics (*Scolarité*)** and **Clubs/Extracurriculars**.

### 4.2 Multi-Level Academic Structure
* **Primary School (*Primaire*):** 5-Year Curriculum.
* **Middle School (*CEM*):** 4-Year Curriculum.
* **High School (*Lycée*):** 3-Year Curriculum.

### 4.3 Curriculum Mapping
* Mapping subjects to specific academic years per educational level.
* Student enrollment tracking per academic year and level.

---

## 5. Student Academic Progression & Promotion

### 5.1 Promotion Rules
* **Grade Point Average (GPA) Thresholds:** Automatic evaluation based on passing marks/GPA.
* **Transition Approval:** Students meeting or exceeding the required grade threshold are eligible for promotion to the next academic year.
* **Grade Retention:** Students failing to meet criteria remain in their current year.

### 5.2 Batch Progression Feature
* System feature generating a pre-filtered list of all eligible passing students.
* **Bulk Approval:** One-click batch promotion allowing administrators to advance all qualifying students to the next academic year simultaneously.

---

## 6. Grading System & Homework Module

### 6.1 Administrator Controls & Subject Coefficients
* Administrators hold rights to create teacher profiles and configure subjects.
* **Weighting / Coefficients:** Each subject must support customizable weightings/coefficients for final score calculations.

### 6.2 Assessment Structure
* Grade calculation structure based on:
  * Test 1 (*Devoir 1*)
  * Test 2 (*Devoir 2*)
  * Final Exam (*Examen*)
  *(Note: Exact formula for overall GPA calculation to be configured).*

### 6.3 Homework Assignment System
* Teachers can create and assign homework tasks through the portal.
* Assigned tasks automatically push to the respective student's web dashboard/account.

---

## 7. Web Portal & Student Account Management

### 7.1 Student Web Portal
* Dedicated web interface requiring user authentication (Account Login/Password).
* **Student Dashboard Access:** Students log in to view:
  * Grades and assessment results.
  * Assigned homework and submission deadlines.
  * Payment history and remaining installment balances.

# Comprehensive System Requirements Specification (SRS) & Architecture Report

---

## EXECUTIVE SUMMARY

This document serves as the definitive, exhaustive, and consolidated System Requirements Specification (SRS) for the unified Educational & Operational Management Platform. It integrates all core functional modules, security specifications, data governance protocols, financial engine requirements, academic progression frameworks, user interface (UI/UX) consolidation strategies, and human resource management workflows.

No steps, technical dependencies, or operational flows have been omitted or left implicit. All requirements specified across system consultations are unified here into a single, rigorous technical blueprint.

---
quest Initiation (Requester Role): 
## SECTION 1: SYSTEM ARCHITECTURE, SECURITY, AUDIT TRAIL & DATA ARCHIVING

```
                     +----------------------------------------+
                     |         PRIMARY DATABASE HUB           |
                     |              (Supabase)                |
                     +-------------------+--------------------+
                                         |
                       Sync / Extract    | (Daily Trigger / 24h)
                                         v
                     +----------------------------------------+
                     |       EXTERNAL BACKUP ENGINE           |
                     |      (Local / Offsite Vault)           |
                     +-------------------+--------------------+
                                         |
                                         v
                     +----------------------------------------+
                     |   AES-256 ENCRYPTION & COMPRESSION     |
                     |      (Application & DB Archives)       |
                     +----------------------------------------+
```

### 1.1 Database Architecture & Primary Data Layer
* **Primary Database Infrastructure:** All relational data, application state, and transactional records must reside primarily within **Supabase**.
* **Multi-Tenant Data Isolation:** System-wide Row-Level Security (RLS) policies and explicit tenant isolation mechanisms must be enforced at the database level. Users are strictly prohibited from viewing, modifying, or querying data belonging to other accounts or unauthorized organizational units.

### 1.2 Global 24-Hour Automated Backup Engine & Disaster Recovery
* **Offsite Backup Isolation:** Due to operational constraints, potential API rate limits, or outages associated with the Supabase platform (including its free tier limits), **backups must never be stored inside the primary Supabase instance**.
* **Automated Backup Execution Cycle:** An independent, automated daemon must execute a full system backup every **24 hours**.
* **Backup Scope:** The daily backup payload must be absolute and all-inclusive, capturing:
  1. The complete PostgreSQL database dump (schema, tables, views, procedures).
  2. All state parameters and application metadata.
  3. All secure media assets, including payment proof scans, bank check images, physical contract attachments, and uploaded receipts.
* **Storage Location & Retention:** Backups must be archived to a designated local server or secondary encrypted offsite storage vault. Backups must maintain point-in-time version history allowing seamless rollback in case of catastrophic data loss.

### 1.3 Data Encryption & Media Security
* **Archive Encryption:** All localized and offsite backup files must be fully encrypted at rest using AES-256 standards prior to storage write.
* **Media Asset Vaulting:** Documents containing sensitive personal identity details or financial transaction proofs must be stored in private, signed storage buckets. Direct public URL access to media assets is strictly forbidden; access requires temporary signed tokens validated against active user permissions.

### 1.4 Comprehensive Traceability & Contextual Audit Logging
* **Universal Action Tracking:** The application must enforce absolute user traceability. Every user must operate via a unique, non-shareable user account. Anonymous or untracked state changes are strictly prohibited.
* **Scope of Tracked Events:** The logging sub-system must capture every database write operation (Create, Update, Delete), authentication event, permission alteration, system export, and data access request.
* **Contextual Audit Parameters:** Every single audit log entry must record the following metadata parameters:
  * **Timestamp:** High-precision UTC timestamp (`YYYY-MM-DD HH:MM:SS.sss`).
  * **User Identity:** Unique User ID (`UUID`) and full name.
  * **Role & Authority Level:** Active role and granular permissions assigned at execution time.
  * **Action Type & Payload:** Exact operation performed, including pre-change state and post-change state (JSON delta diff).
  * **Database State Context:** Active database state ID or transaction snapshot ID.
  * **Session Telemetry:** Session duration, IP address, device footprint, and active token ID.
* **Audit Log Placement & Visibility:** The audit logging interface must reside under the **Settings** section of the administration panel. The UI must provide multi-column filtering capabilities allowing administrators to query logs by specific User, Action Type, Date Range, or Context Key.

### 1.5 Security Controls & Password Management
* **Password Change Audit Traversal:** Any credential alteration—including self-service password resets, administrator force-resets, and credential updates—must trigger an immediate, high-priority security audit log event capturing who requested the change, who executed it, and the time of execution.
* **Credential Policy Enforcements:** Enforce strong entropy checks for password creation, rate-limiting on login endpoints, and automatic session revocation upon password modification.

---

## SECTION 2: UI/UX NAVIGATION ARCHITECTURE & PAGE CONSOLIDATION

To streamline administrative workflows and eliminate fragmented user experiences, the core application frontend must be consolidated from isolated pages into **4 unified, primary UI hubs**.

```
+-----------------------------------------------------------------------------------+
|                            APPLICATION NAVIGATION HUBS                            |
+-------------------+-------------------+--------------------+----------------------+
|     HUB 1         |      HUB 2        |       HUB 3        |        HUB 4         |
|  Dashboard &      |  Financial Portal |   Relationship     |  Academic Management |
|  Analytics        |   & Dues          |     Portal         |      & Classes       |
+-------------------+-------------------+--------------------+----------------------+
| • Main Dashboard  | • Payments        | • Unified Parents  | • Scolarité Classes  |
| • Notifications   | • Receipts        |   & Students       | • Extracurricular    |
| • Global Reports  | • Debt Dashboard  | • Batch Parent/    |   Clubs              |
| • Analytics / Stats| • Installments   |   Child Creation   | • Subject Mapping    |
+-------------------+-------------------+--------------------+----------------------+
```

### 2.1 Page 1: Dashboard, Notifications, Reports & Analytics Hub
This hub serves as the operational command center, combining four previously dispersed interfaces:
* **Main Dashboard Workspace:** Displays operational summary cards, active alerts, daily activity feed, and pending task queues.
* **Notification Center:** Real-time stream of system updates, urgent payment alerts, failed backup notifications, and security flags.
* **Reports Module:** Centralized engine to compile, view, and export systemic administrative reports (PDF/Excel).
* **Global Statistics & Analytics Engine:** Positioned directly at the bottom of the dashboard page with an expandable "See Details" view (see Section 10).

### 2.2 Page 2: Financial Portal (Payments, Receipts, Debts & Installments)
This hub consolidates all revenue collection, debt tracking, and transaction verification functions:
* **Payments Management Interface:** Unified ledger for entering, reviewing, and approving incoming payments.
* **Debt Dashboard Integration:** Embedded analytics displaying outstanding family debts, unpaid balances per student, aging invoices, and defaulted accounts.
* **Receipt Engine:** Automatic generation, viewing, and printing of payment receipts and formal account statements.
* **Installment Schedule Viewer:** Real-time visibility into active installment plans (*Paiement par Tranche*).

### 2.3 Page 3: Relationship Portal (Unified Parents & Students Space)
This hub brings Parent and Student profiles together inside a single relational interface:
* **Parent-Child Unified Directory:** Master list of parents linked directly to their dependent children.
* **Batch Parent/Student Creation Workflow:** Integrated registration modal for creating parents and attaching up to 4 children simultaneously (see Section 3).
* **Combined Profile Drawers:** Selecting a parent or student opens an inline master drawer detailing financial accounts, attendance, grades, and linked family members.

### 2.4 Page 4: Academic Management (Classes & Clubs)
This hub manages all formal learning structures:
* **Formal Schooling Classes (*Scolarité*):** Management of standard grade levels across Primary, Middle, and High School structures.
* **Extracurricular Clubs Space:** Management of specialized clubs (e.g., Chess Club, English Club, IT Club).

---

## SECTION 3: PARENT & STUDENT RELATIONSHIP MANAGEMENT (CRM WORKFLOWS)

```
+-----------------------------------------------------------------------------------+
|                        BATCH PARENT/STUDENT CREATION FLOW                         |
+-----------------------------------------------------------------------------------+
| Step 1: Input Parent Master Details (Name, Phone, Email, Identity No., Address)   |
+-----------------------------------------------------------------------------------+
                                         |
                                         v
| Step 2: Dynamically Add Dependent Children (Minimum 1, Maximum 4 Students)        |
|   ├── Child 1: Name, DOB, Academic Level/Class, Assigned Services, Special Needs   |
|   ├── Child 2: Name, DOB, Academic Level/Class, Assigned Services, Special Needs   |
|   ├── Child 3: Name, DOB, Academic Level/Class, Assigned Services, Special Needs   |
|   └── Child 4: Name, DOB, Academic Level/Class, Assigned Services, Special Needs   |
+-----------------------------------------------------------------------------------+
                                         |
                                         v
| Step 3: Configure Billing & Installments per Child                                |
+-----------------------------------------------------------------------------------+
                                         |
                                         v
| Step 4: Atomic Database Write (Parent Record + N Student Records Created)         |
+-----------------------------------------------------------------------------------+
```

### 3.1 Strict Parent-Child Entity Dependency
* **Parent-First Precondition:** In the database schema, a Student record cannot exist as an orphan. A valid Foreign Key (`parent_id`) referencing a verified Parent record is mandatory upon Student creation.
* **Relational Schema Constraints:** Deleting or archiving a Parent account requires systematic cascade handling or reassignment of dependent Student records.

### 3.2 Batch Student Creation Engine (Up to 4 Children)
* **Single Form Execution:** Administrators must be able to create a Parent profile and register up to **4 dependent Children (Students)** within a single, uninterrupted form submission workflow.
* **Form Field Specifications:**
  * **Parent Data Block:** First Name, Last Name, Primary Phone Number, Secondary Phone Number, Email, National Identity Number, Physical Address, Occupation.
  * **Dynamic Student Data Blocks (Repeatable 1 to 4 times):**
    * Student First & Last Name.
    * Date of Birth & Gender.
    * Assigned Academic Level & Class (*Scolarité* grade).
    * Assigned Extracurricular Clubs / Special Programs.
    * Specific Service Enrollment (Transport, Canteen, Psychotherapy, Speech Therapy / Orthophonie).
    * Customized Fee Adjustments / Account Discretionary Discounts (if applicable).
* **Atomic Processing:** The batch creation submission must be wrapped in a database transaction (`BEGIN...COMMIT`). If student creation fails for the 4th child, the entire operation (including Parent record creation) must roll back to maintain database integrity.

### 3.3 Bidirectional Relational Navigation
The UI must allow seamless, single-click navigation across linked entities:
* **From Parent Profile:**
  * View list of all linked children.
  * View total consolidated family financial balance (cumulative sum of all children's dues).
  * View total history of payments made by the parent.
  * View list of all active services used across all children.
* **From Student Profile:**
  * View primary and secondary parent contact cards.
  * View individual student balance vs. family share.
  * View complete academic grade book, attendance history, and teacher notes.

---

## SECTION 4: CORE ACADEMIC STRUCTURE (SCOLARITÉ) vs. EXTRACURRICULAR CLUBS

```
                     +----------------------------------------+
                     |         ACADEMIC DOMAIN SPLIT          |
                     +-------------------+--------------------+
                                         |
             +---------------------------+---------------------------+
             |                                                       |
             v                                                       v
+--------------------------+                               +-------------------+
|  CORE ACADEMICS          |                               |  EXTRACURRICULAR  |
|  (Scolarité)             |                               |  CLUBS            |
+--------------------------+                               +-------------------+
| Grade Levels & Terms     |                               | Chess Club        |
| Official Curricula       |                               | English Club      |
| GPAs & Coefficients      |                               | Sports & Arts     |
| Automatic Progression    |                               | Flexible Billing  |
+--------------------------+                               +-------------------+
```

### 4.1 Structural Domain Separation
The application backend must enforce a strict domain boundary between **Formal Core Academics (*Scolarité*)** and **Extracurricular Clubs**:
* **Core Academics (*Scolarité*):** Governed by state/institutional educational standards, structured progression rules, strict coefficient-based grading, exam schedules, and formal year-end promotion logic.
* **Extracurricular Clubs:** Governed by flexible enrollment, optional participation, fixed or session-based fees, and independent from student academic promotion/retention logic.

### 4.2 Multi-Level Educational Structure (*Scolarité*)
The system must natively support the 3-tier national education framework:
1. **Primary School (*Primaire*):** 5-Year Curriculum Cycle (Grade 1 through Grade 5).
2. **Middle School (*CEM - Collège*):** 4-Year Curriculum Cycle (Year 1 through Year 4).
3. **High School (*Lycée*):** 3-Year Curriculum Cycle (Year 1 through Year 3 / Streams).

### 4.3 Curriculum Mapping & Subject Engine
* **Subject Assignment Matrix:** Administrators must be able to map specific subjects to specific academic years and levels.
* **Subject Attributes:** Each subject record must contain:
  * Subject Name (e.g., Mathematics, Arabic, Physics, Natural Sciences).
  * Academic Level & Target Grade Year.
  * Default Coefficient / Credit Weight.
  * Assigned Primary Teacher ID.

---

## SECTION 5: GRADING, EVALUATION & ACADEMIC PROGRESSION

### 5.1 Grading Mechanics, Coefficients & Evaluation Breakdown
* **Term Assessment Structure:** Every student's term score per subject is calculated using three standardized assessment inputs:
  1. **Test 1 (*Devoir 1*):** Numerical score (out of 20).
  2. **Test 2 (*Devoir 2*):** Numerical score (out of 20).
  3. **Final Exam (*Examen*):** Numerical score (out of 20).
* **Weighted Subject Grade Calculation:**
  $$\text{Subject Average} = \frac{\text{Devoir 1} + \text{Devoir 2} + (\text{Examen} \times 2)}{4}$$
* **Overall Overall GPA (Yearly Average) Calculation:**
  $$\text{Overall GPA} = \frac{\sum (\text{Subject Average} \times \text{Subject Coefficient})}{\sum \text{Subject Coefficients}}$$

### 5.2 Student Academic History & Performance Profile
* **Historical Log:** Each student profile must feature a permanent "Academic History" tab displaying term-by-term performance throughout their entire institutional tenure.
* **Granular Records:** Clicking any past academic year reveals the complete report card, subject breakdown, assessment scores, teacher observations, attendance rate, and promotion outcome.

### 5.3 Automatic Promotion Threshold Logic
* **Passing GPA Threshold:** Administrators configure the minimum passing GPA (e.g., $10.00 / 20.00$).
* **System Evaluation:** At the conclusion of the academic year, the system computes final GPAs across all enrolled students and flags each record with an academic status:
  * `APPROVED_FOR_PROMOTION` (GPA $\ge$ Threshold).
  * `RETAINED_SAME_YEAR` (GPA $<$ Threshold).

### 5.4 One-Click Batch Progression Engine
To eliminate manual year-end administrative overhead, the platform must include an automated student promotion engine:
1. **Pre-Filtered Queue:** The system generates an actionable master list of all students flagged as `APPROVED_FOR_PROMOTION`.
2. **Review & Override:** Administrators can review the list and manually toggle individual exception flags if necessary.
3. **One-Click Execution:** Upon clicking **"Execute Batch Promotion"**, the engine performs an automated database update:
   * Advances all approved students from their current academic year to the next sequential grade year (e.g., Primary Grade 4 $\rightarrow$ Primary Grade 5).
   * Automatically updates class rosters for the upcoming academic year.
   * Archives previous year academic records to the student's permanent historical profile.
   * Flags retaining students to remain enrolled in their current grade year for the new academic calendar.

```
+-----------------------------------------------------------------------------------+
|                            BATCH PROGRESSION ENGINE                               |
+-----------------------------------------------------------------------------------+
| Step 1: Calculate Yearly GPAs for All Enrolled Students                          |
+-----------------------------------------------------------------------------------+
                                         |
                                         v
| Step 2: System Automatically Flags Profiles:                                      |
|   ├── GPA >= 10.00  -->  [APPROVED_FOR_PROMOTION]                                 |
|   └── GPA < 10.00   -->  [RETAINED_SAME_YEAR]                                   |
+-----------------------------------------------------------------------------------+
                                         |
                                         v
| Step 3: Admin Reviews Queue & Applies Manual Overrides (if required)              |
+-----------------------------------------------------------------------------------+
                                         |
                                         v
| Step 4: Execute One-Click Batch Promotion:                                        |
|   ├── Advances approved students to next grade level (e.g., Grade 3 -> Grade 4)  |
|   ├── Archives completed year report cards to permanent student history           |
|   └── Re-enrolls retained students in current grade level for new term            |
+-----------------------------------------------------------------------------------+
```

### 5.5 Homework Assignment & Portal Push Engine
* **Teacher Assignment Interface:** Teachers can create homework assignments specifying Subject, Target Class, Description, Attachment/PDF, and Due Date.
* **Automated Portal Push:** Upon saving a homework assignment, the system automatically pushes the task to the Student Web Portal for all enrolled students in that target class, triggering a dashboard alert.

---

## SECTION 6: FINANCIAL SYSTEM, BILLING, INSTALLMENTS & RECEIPTING

### 6.1 Multi-Mode Payment Processing & Status Lifecycle
* **Supported Payment Methods:**
  * **Cash (*Espèces*):** Direct over-the-counter collection.
  * **Bank Check (*Chèque*):** Captures Check Number, Bank Name, Issue Date, and Expiry/Clearance Date.
  * **Bank Transfer (*Virement*):** Captures Transaction Reference ID and Source Bank.
* **Mandatory Attachment & Verification:**
  * File/photo uploads of checks or transfer receipts are mandatory for non-cash payments.
  * **Notes / Remarks Field:** Must be provided to log specific transaction context (e.g., "Check pending clearance", "Transfer delayed by bank", "Check expired - reissuance requested").
* **Payment Status Lifecycle:**
  * `PAID`: Transaction verified, funds fully cleared.
  * `UNPAID`: Bill issued, payment overdue.
  * `PENDING`: Payment submitted (e.g., check deposited) awaiting bank verification.

```
+-----------------------------------------------------------------------------------+
|                             PAYMENT TRANSACTION FLOW                              |
+-----------------------------------------------------------------------------------+
| Step 1: Select Billing Entity (Parent / Student) & Services Billed                |
+-----------------------------------------------------------------------------------+
                                         |
                                         v
| Step 2: Select Payment Method & Input Details:                                    |
|   ├── CASH: Direct Receipt Entry                                                  |
|   ├── CHECK: Input Check No., Bank Name, Expiry Date + Upload Check Scan          |
|   └── BANK TRANSFER: Input Transaction Ref No. + Upload Transfer Proof Scan      |
+-----------------------------------------------------------------------------------+
                                         |
                                         v
| Step 3: Set Initial Status ([PAID] / [PENDING] / [UNPAID]) + Add Remarks          |
+-----------------------------------------------------------------------------------+
                                         |
                                         v
| Step 4: System Generates Automated PDF Receipt (Recent or Full Statement Option)  |
+-----------------------------------------------------------------------------------+
```

### 6.2 Installment Payment Module (*Paiement par Tranche*)
* **Multi-Service Scope:** Installment billing schedules can be established across distinct service categories:
  * **School Transportation Fees:** Seasonal or term-based payment installments.
  * **Internship / Training Programs (*Stages*):** Scheduled payment blocks tied to program milestones.
  * **Extracurricular Activities:** Multi-part payment plans per club or sport.
  * **Core Tuition Fees:** Standard term/monthly installments.
* **Direct Upfront Payment Option:** System must also support immediate 100% upfront settlement for any service, bypassing installment logic.
* **Installment Schedule Engine:**
  * Calculates precise payment schedule based on total service cost and agreed payment count.
  * Tracks due dates, paid amounts per installment, and remaining unpaid principal.
  * Provides real-time alerts on overdue installment dates.

### 6.3 Discretionary Financial Adjustments & Discounts
* **Account Balance Discounts:** Administrators can apply approved discretionary discounts or account balance adjustments directly to a student's billing record.
* **Audit Enforcement:** Every fee adjustment requires selecting an approval reason code and entering an administrative note, fully audited under the performing admin's identity.

### 6.4 Receipt Generation Engine & PDF Export
Upon recording a transaction, the platform must instantly generate an official, printable PDF document with two distinct formatting options:
1. **Recent Payment Receipt Option:** Generates a concise proof-of-payment capturing *only* the immediate transaction just completed (Amount Paid, Payment Method, Date, Receipt ID, Billed Services).
2. **Full Account Statement / Balance Sheet Option:** Generates a comprehensive financial statement detailing:
   * Complete historical ledger of all payments made since enrollment.
   * Itemized list of all active enrolled services.
   * Total historical billed amount.
   * Cumulative total paid amount.
   * Current net balance due / outstanding debt.

### 6.5 Parent Financial Profiles
* **Direct Profile Access:** Financial balance sheets, payment history, debt logs, and receipt generation capabilities must be embedded directly inside the Parent's primary profile modal. Separated, detached financial screens that lose parent entity context are eliminated.

---

## SECTION 7: EXPENSE REQUEST & TWO-TIER APPROVAL WORKFLOW

To prevent unauthorized corporate outflows and maintain financial accountability, all organizational expenditures must follow a strictly enforced 3-step lifecycle.

```
+-----------------------------------------------------------------------------------+
|                        TWO-TIER EXPENSE APPROVAL LIFECYCLE                        |
+-----------------------------------------------------------------------------------+
| STEP 1: REQUEST INITIATION (Staff Member)                                         |
|   • Fills Expense Title, Category, Amount Requested, Justification & Urgency      |
|   • Expense Status set to: [PENDING_APPROVAL]                                     |
+-----------------------------------------------------------------------------------+
                                         |
                                         v
| STEP 2: AUTHORIZATION & FUND RELEASE (Admin / Financial Officer)                   |
|   • Reviews Request & Justification                                               |
|   • Approves or Rejects Request                                                   |
|   • If Approved: Status set to [APPROVED_FUNDS_RELEASED]                          |
|   • Disburses cash or initiates transfer                                          |
+-----------------------------------------------------------------------------------+
                                         |
                                         v
| STEP 3: PROOF-OF-PURCHASE SETTLEMENT (Staff Member)                              |
|   • Staff completes transaction in the field                                      |
|   • Uploads photograph/scan of physical vendor invoice or receipt                 |
|   • Inputs actual final expenditure amount                                        |
|   • Status updated to: [SETTLED_AND_CLOSED]                                       |
+-----------------------------------------------------------------------------------+
```

### 7.1 Outgoing Expenditure Logging
* Every expenditure (building maintenance, supply purchases, event costs, administrative overhead) must be registered in the central financial accounting module.

### 7.2 Two-Tier Request & Authorization Rules
* **Tier 1: Request Initiation (Requester Role):** Any authorized staff member submits an expense ticket specifying:
  * Expense Title & Description.
  * Category (Maintenance, Office Supplies, Educational Material, Utilities).
  * Requested Funding Amount.
  * Operational Justification.
  * Initial Status: `PENDING_APPROVAL`.
* **Tier 2: Authorization & Disbursement (Approver/Financial Officer Role):**
  * An administrator or financial officer reviews the pending ticket.
  * The Approver executes an `APPROVE` or `REJECT` action.
  * Upon approval, the status changes to `APPROVED_FUNDS_RELEASED`, and the requested capital is authorized for disbursement.

### 7.3 Mandatory Proof-of-Purchase Settlement
* **Closing the Loop:** An expense ticket cannot be closed upon fund release.
* **Receipt Upload Requirement:** Following purchase execution, the requesting staff member must log into the expense ticket, input the actual final spent amount, and upload a clear photo/scan of the physical vendor receipt or invoice.
* **Final Audit Settlement:** Once the proof image is uploaded, the financial officer verifies the receipt against the disbursed amount, and the ticket updates to `SETTLED_AND_CLOSED`.

---

## SECTION 8: HUMAN RESOURCES, PERSONNEL & TEACHER MANAGEMENT

### 8.1 Personnel Directory ("Personnel" Space)
* **Unified Staff Registry:** Centralized module managing all institutional employees, categorized by employment type:
  * Administrative Staff.
  * Teaching Faculty (*Enseignants*).
  * Support & Maintenance Personnel.
  * Medical & Therapy Personnel (Speech Therapists / *Orthophonistes*, Psychologists).
* **Desktop Privilege Management:** Role-Based Access Control (RBAC) assigning exact UI permissions, data editing rights, and administrative capabilities per employee profile.

### 8.2 Teacher Profiles & Activity Ledger (*Relevé*)
* **Subject & Class Mapping:** View and edit all subjects and grade classes assigned to a specific teacher.
* **Teacher Activity Ledger (*Relevé Teacher Log*):** An automated operational activity ledger tracking a teacher's performance and system contributions:
  * Log of all grades/assessment scores entered into the system.
  * Log of all homework assignments issued.
  * Attendance submission records for assigned classes.
  * Historical log of classes taught and hours logged.

---

## SECTION 9: STUDENT WEB PORTAL & CLIENT AUTHENTICATION

```
+-----------------------------------------------------------------------------------+
|                              STUDENT WEB PORTAL HUB                               |
+-----------------------------------------------------------------------------------+
| Authentication: Unique Username / Student ID + Secure Password                    |
+-----------------------------------------------------------------------------------+
                                         |
                                         v
| STUDENT DASHBOARD VIEW                                                            |
|   ├── Academic Performance: Current Term Grades, Test 1, Test 2, Exam Results     |
|   ├── Homework Center: Pending Assignments, Due Dates, PDF Task Attachments       |
|   ├── Financial Overview: Active Services, Paid Charges, Remaining Installments   |
|   └── Timetable & Attendance: Weekly Class Schedule & Attendance Records          |
+-----------------------------------------------------------------------------------+
```

### 9.1 Secure Authentication Framework
* **Individual Student Credentials:** Students access a dedicated web-based portal using an individual login credential set (Username/Student ID and Password).
* **Role-Restricted Scope:** Student portal accounts are locked strictly to read-only views of their own individual data records. Access to backend administration, peer records, or system configuration is prohibited.

### 9.2 Student Self-Service Dashboard Features
Upon logging in, students are presented with an intuitive self-service portal containing:
* **Academic Performance Tab:** Real-time visibility into entered scores for Test 1 (*Devoir 1*), Test 2 (*Devoir 2*), Final Exam (*Examen*), subject averages, overall GPA, and historical report cards.
* **Homework & Task Center:** Feed of active homework assignments pushed by teachers, displaying due dates, instructions, and downloadable exercise PDFs.
* **Financial Account Summary:** Transparency into enrolled services, payments completed by their parents, current payment status, and upcoming installment due dates.
* **Schedule & Timetable:** View of weekly class schedules, exam dates, and personal attendance tracking logs.

---

## SECTION 10: DASHBOARD ANALYTICS, BUSINESS INTELLIGENCE & REPORTING

Positioned at the bottom of the main UI Dashboard (Page 1), the Business Intelligence module provides real-time operational insights accessible via an expandable **"See Details"** modal interface.

```
+-----------------------------------------------------------------------------------+
|                        BUSINESS INTELLIGENCE & ANALYTICS                          |
+-----------------------------------------------------------------------------------+
| 1. REVENUE METRICS ENGINE                                                         |
|    • Gross Monthly / Annual Revenue Trends                                        |
|    • Collection Rates (% Billed vs % Collected)                                   |
|    • Cumulative Outstanding Debt Totals                                           |
+-----------------------------------------------------------------------------------+
                                         |
                                         v
| 2. CATEGORY & DEPARTMENTAL BREAKDOWN                                              |
|    • Core Academics (Scolarité) Income                                            |
|    • Speech Therapy (Orthophonie) & Psychology Income                             |
|    • Extracurricular Clubs Income (Chess, English, Sports)                        |
|    • Auxiliary Services Income (Transport, Canteen)                               |
+-----------------------------------------------------------------------------------+
                                         |
                                         v
| 3. DEMOGRAPHIC & ENROLLMENT VISUALIZATIONS                                        |
|    • Interactive Bar Charts: Student Count per Grade Level / Class                |
|    • Gender & Age Distribution Metrics                                            |
|    • Capacity vs Active Enrollment Metrics per Department                         |
+-----------------------------------------------------------------------------------+
```

### 10.1 High-Level Revenue & Financial Analytics
* **Gross Revenue Tracking:** Real-time metrics charting incoming revenue across custom date ranges (Monthly, Quarterly, Annual).
* **Collection Rate Intelligence:** Comparative visualization comparing total billed receivables against total collected cash flow.
* **Debt Concentration Metrics:** Breakdown of total institutional debt grouped by aging tiers (0-30 days, 31-60 days, 61-90+ days overdue).

### 10.2 Departmental & Specialization Revenue Breakdown
Granular financial tracking isolating income generated by specific operational units:
* Core Academics (*Scolarité* Tuition).
* Speech Therapy (*Orthophonie*) & Psychological Services.
* Extracurricular Clubs (e.g., Chess Club revenue vs. English Club revenue).
* Logistics & Auxiliary Services (Transportation, Canteen).

### 10.3 Demographic & Enrollment Visualizations
* **Grade Level Distribution Charts:** Interactive multi-color bar charts displaying total student enrollment counts per grade level (e.g., 20 students in Primary Grade 1, 15 in Primary Grade 2, 10 in CEM Year 1).
* **Department Capacity Visualizations:** Gauge charts indicating current capacity limits vs. active student enrollments for specialized programs and specialized therapy units.

---

## SECTION 11: SYSTEM DEPRECATIONS & REMOVALS

To eliminate system redundancy, optimize performance, and clean up the database schema, the following legacy elements are **permanently deprecated and must be completely removed** from the application codebase and user interface:

1. **Fee Templates Module:** Completely remove all fee template creation interfaces, database tables, and logic. All pricing structures must be managed directly via dynamic service configurations.
2. **Scholarship System:** Completely remove all scholarship tracking rules, scholarship tables, and interface options. Financial relief or price reductions must be processed strictly via the verified Discretionary Account Adjustment framework outlined in Section 6.3.

---

## SECTION 12: TRACEABILITY MATRIX & VERIFICATION SUMMARY

| Feature Category | Core Requirement | Verification Mechanism |
| :--- | :--- | :--- |
| **System Security** | 24-Hour Offsite Encrypted Backups | Automated script verification, local archive check |
| **Audit Logging** | User-linked contextual action logging | Audit trail inspection under Settings |
| **UI Consolidation** | 4-Hub UI Navigation Structure | Route check & UI layout validation |
| **CRM Workflow** | Parent-First Batch Student Creation (1-4 Kids) | Single-form submission validation |
| **Academic Hierarchy** | 3-Tier *Scolarité* + Clubs Domain Split | Schema separation verification |
| **Progression Engine** | GPA-based 1-Click Batch Promotion | Year-end transition testing |
| **Financial System** | Installments, PDF Receipts, 3 Payment Modes | Transaction lifecycle audit |
| **Expense Workflow** | 2-Tier Request + Receipt Upload Approval | Expense status lifecycle check |
| **HR & Faculty** | Staff Directory + Teacher Log (*Relevé*) | Teacher activity logging test |
| **Student Portal** | Authenticated Self-Service Web Portal | Portal login & data scope validation |
| **Analytics** | Revenue, Departmental & Bar Chart Stats | Dashboard "See Details" modal inspection |
| **Deprecations** | Total Removal of Fee Templates & Scholarships | Codebase & schema purge audit |

# Master System Requirements Specification (SRS) & Enterprise Architecture Report

---

## EXECUTIVE SUMMARY

This master specification document establishes the absolute, definitive, and complete technical blueprint for the enterprise **Educational & Operational Management Platform**. 

This revision incorporates the critical structural paradigm shifts regarding platform delivery, user scope, mobile app architecture, client access restrictions, serverless automated workflow triggers, edge runtime execution, and embedded artificial intelligence integrations.

### Key Structural Paradigms:
1. **Client Access (Parents & Students):** Restricted **EXCLUSIVELY to Web Portal Browsers**. Clients do **not** have a mobile application.
2. **Mobile Application (Staff & Personnel):** Built **EXCLUSIVELY for Android** devices and tailored **ONLY for internal staff, teachers, administrators, and maintenance personnel**. It mirrors Desktop capabilities into an optimized, mobile-first operational tool.
3. **Automated Workflow Engine:** Powered by **Supabase Edge Functions** to guarantee 24/7 background execution independent of active Desktop or Mobile client sessions.
4. **AI Capabilities:** Built on an open architecture leveraging **Grok** and **OpenRouter** APIs with a freemium/Bring-Your-Own-Key (BYOK) model.

---

# SECTION 1: SYSTEM ARCHITECTURE, PLATFORM DIVISION & ACCESSIBILITY MATRIX

```
+---------------------------------------------------------------------------------------+
|                               SYSTEM ACCESS PARADIGM                                  |
+---------------------------------------------------------------------------------------+
|                                CLIENT ECOSYSTEM                                       |
|                  (Parents, Guardians, Enrolled Students)                              |
|                                                                                       |
|                       WEB PORTAL BROWSERS ONLY (Desktop / Mobile)                      |
|                       [ NO CLIENT MOBILE NATIVE APP EXISTS ]                          |
+---------------------------------------------------------------------------------------+
                                           |
                                           | Restrictive Authentication
                                           v
+---------------------------------------------------------------------------------------+
|                                STAFF & INTERNAL FACULTY                               |
|                  (Admins, Teachers, Financial Officers, Staff)                        |
|                                                                                       |
|         +----------------------------------+----------------------------------+       |
|         |        DESKTOP APPLICATION       |      ANDROID MOBILE APP          |       |
|         |  (Full Administrative Control)   |  (Staff Operational Management)  |       |
|         +----------------------------------+----------------------------------+       |
+---------------------------------------------------------------------------------------+
                                           |
                                           v
+---------------------------------------------------------------------------------------+
|                                 CENTRAL BACKEND ENGINE                                |
|         Supabase Database  |  Supabase Auth / JWT  |  Supabase Edge Functions         |
+---------------------------------------------------------------------------------------+
```

### 1.1 Access & Platform Enforcement Matrix

| User Role | Platform Access | Native App Availability | Auth Method | Primary Operational Scope |
| :--- | :--- | :--- | :--- | :--- |
| **Super Admin** | Desktop, Android | Desktop & Android | Supabase Auth / JWT | Complete System Configuration, Security, Audits |
| **Financial Officer** | Desktop, Android | Desktop & Android | Supabase Auth / JWT | Ledger, Approvals, Expense Settlement, Dues |
| **Teacher / Faculty** | Desktop, Android | Desktop & Android | Supabase Auth / JWT | Grade Entry, Homework Push, Attendance, *Relevé* |
| **Support Staff** | Android | Android Only | Supabase Auth / JWT | Maintenance Requests, Field Expense Submissions |
| **Parent / Guardian** | **Web Portal Only** | **NONE (No Client App)** | Gmail/Auth + 6-7 Digit Code | Dues, Multi-Child Academics, Absence Submissions |
| **Student** | **Web Portal Only** | **NONE (No Client App)** | Web Login / Student ID | View Grades, Homework, Timetables, Exam Schedules |

---

# SECTION 2: ANDROID MOBILE APPLICATION FOR STAFF & PERSONNEL

```
+---------------------------------------------------------------------------------------+
|                      ANDROID MOBILE APP ARCHITECTURE (STAFF ONLY)                      |
+---------------------------------------------------------------------------------------+
| [FEATURE 1: QUICK ATTENDANCE MODULE]  --> Real-time classroom absence/lateness logs  |
| [FEATURE 2: EXPENSE CAMERA SCANNER]   --> On-the-go receipt capture & Tier-1 submission |
| [FEATURE 3: MOBILE TEACHER LOG]       --> Homework pushing, grade entry & class logs  |
| [FEATURE 4: FIELD APPROVALS ENGINE]   --> Financial officers approve requests on-the-go |
| [FEATURE 5: EMERGENCY PUSH NOTIFS]    --> Direct alert broadcasts to internal staff   |
+---------------------------------------------------------------------------------------+
| SAFEGUARD: ZERO LOCAL BACKUP STORAGE (Prevents phone storage overload & data leakage) |
+---------------------------------------------------------------------------------------+
```

### 2.1 Target Platform & Audience
* **Platform Exclusivity:** Operating System strictly enforced for **Android OS** smartphones and tablets.
* **Audience:** Internal institutional staff only (Administrators, Financial Officers, Teachers, Caretakers, Support Staff).

### 2.2 Functional Feature Map (Mobile Staff App)
The Android app mirrors core Desktop functionalities into a streamlined, high-efficiency interface optimized for staff performing tasks away from desks:

1. **Mobile Attendance & Absence Logging:**
   * Teachers take classroom attendance in under 30 seconds.
   * Instantly syncs attendance status (`PRESENT`, `ABSENT`, `LATE`, `EXCUSED`) to the central database, triggering portal updates for parents.
2. **On-the-Go Expense Requests & Receipt Camera Scanning:**
   * Staff members submit field expense requests (Tier-1) directly from the mobile app.
   * Integrated camera module allowing staff to photograph physical vendor receipts, auto-compress image files, and attach them directly to an active expense ticket.
3. **Mobile Grade & Homework Entry:**
   * Teachers input assessment scores (*Devoir 1*, *Devoir 2*, *Examen*) directly from mobile devices.
   * Allows capturing homework details, setting deadlines, taking photos of whiteboard assignments, and pushing task alerts to the student web portal.
4. **Field Approval Hub for Financial Officers:**
   * Administrators and financial officers can review pending expense requests, inspect uploaded receipt images, and authorize or reject transactions remotely.
5. **Teacher Activity Ledger (*Relevé*) Sync:**
   * Teachers review their personal assigned schedules, log completed instruction hours, and track administrative tasks completed during their shift.
6. **Push Notification Listener:**
   * Receives real-time push alerts for urgent administrative notices, student health alerts, pending expense authorizations, or convocations.

### 2.3 Explicit Mobile Storage Safeguards
* **Zero Local Backup Storage:** The Android mobile app **is explicitly prohibited from generating, downloading, or storing local database archives or system backups**.
* **Rationale:** Phone storage limitations, data fragmentation risks, and security vulnerabilities associated with mobile local file systems.
* **Architecture:** All mobile actions operate via direct, authenticated REST/gRPC API calls to Supabase. Media assets captured via camera are uploaded directly to private cloud storage buckets without remaining in the device's public photo gallery.

---

# SECTION 3: CLIENT WEB PORTAL (WEB-ONLY CLIENT ACCESS)

```
+---------------------------------------------------------------------------------------+
|                          PARENT WEB ACCOUNT ACTIVATION FLOW                           |
+---------------------------------------------------------------------------------------+
| Step 1: Parent opens Web Portal Browser & Authenticates via Google / Gmail OAuth     |
+---------------------------------------------------------------------------------------+
                                         |
                                         v
| Step 2: System Prompts for Family Link Code                                           |
|         Parent Inputs 6-to-7 Digit Activation Code / Scans QR Code                  |
|         (Code manually generated by Staff upon enrollment)                            |
+---------------------------------------------------------------------------------------+
                                         |
                                         v
| Step 3: Server Validates Code & Binds Parent OAuth ID to Master Family Entity         |
+---------------------------------------------------------------------------------------+
                                         |
                                         v
| Step 4: Parent Profile Access Granted: Single Dashboard controls all linked children  |
+---------------------------------------------------------------------------------------+
```

### 3.1 Account Architecture & Activation Protocol
* **Single Account Multi-Child Model:** A parent with multiple enrolled children accesses all dependents through a single web dashboard without switching accounts.
* **Account Activation Protocol:**
  1. Staff registers the family in the office and generates a unique, system-issued **6-to-7 digit numeric activation code** (or unique QR code).
  2. Parent visits the Web Portal on any desktop or mobile browser and logs in via Google/Gmail OAuth (or standard email/password).
  3. Parent inputs the 6-to-7 digit activation code.
  4. The system validates the token and permanently links the parent's authenticated user account (`auth.uid`) to the master Parent profile and all linked Student records.

### 3.2 Portal Capabilities & Features
1. **Academic Dashboard:**
   * View live grade books, assessment scores (*Devoir 1*, *Devoir 2*, *Examen*), weighted subject averages, and overall cumulative GPAs.
   * Access downloadable PDF term report cards (*Bulletins*).
2. **Exam Timetable & Schedule Engine:**
   * Displays full schedules for upcoming tests and exams, detailing:
     * Exam Title & Subject.
     * Date & Precise Start/End Time.
     * Assigned Examination Room / Hall Number.
     * Invigilator/Teacher in Charge.
3. **Absence Justification Engine:**
   * Parents submit official justifications for student absences.
   * Supports inputting explanatory text notes and attaching proof documents (e.g., medical certificates) via direct file upload or shared cloud storage drive links (Google Drive, OneDrive).
4. **Staff-Client Communication & Convocations:**
   * View official administrative notices, meeting requests, and teacher convocations.
   * Light-weight messaging system allows parents to respond to convocations, attach requested documents, and communicate with administrative staff.
5. **Financial Ledger & Billing Transparency:**
   * Real-time visibility into total enrolled services, historical payments made, current outstanding balance, installment schedules (*Tranches*), and due dates for upcoming payments.

---

# SECTION 4: BACKUP, ARCHIVING & DISASTER RECOVERY ENGINE

```
+---------------------------------------------------------------------------------------+
|                              DATA ARCHIVING INFRASTRUCTURE                            |
+---------------------------------------------------------------------------------------+
|   PRIMARY DATABASE HUB (Supabase Cloud PostgreSQL)                                    |
|   ├── Real-time Operations & Client Web Portal Data                                   |
|   └── RLS Tenant Isolation Safeguards                                                 |
+---------------------------------------------------------------------------------------+
                                         |
                                         | Automated 24-Hour Extraction Cron
                                         v
+---------------------------------------------------------------------------------------+
|   DESKTOP MASTER ENGINE (Local Administrative Client)                                 |
|   ├── Fetches full DB dump & media assets                                             |
|   ├── Applies AES-256 Encryption                                                      |
|   └── Writes versioned archives to Local External Vault / Secondary Storage           |
+---------------------------------------------------------------------------------------+
                                         |
                                         v
+---------------------------------------------------------------------------------------+
|   MOBILE APP RULE: ZERO BACKUP OPERATIONS EXECUTED ON MOBILE ANDROID APPS             |
+---------------------------------------------------------------------------------------+
```

### 4.1 Master Archiving Rules
* **Storage Isolation:** Backups are **strictly prohibited** from residing inside the primary Supabase production instance to prevent storage overflow and protect against instance-level failures.
* **Execution Node:** Backup compilation routines are driven from the **Desktop Client / Central Server Environment**. Mobile clients are excluded from running backup tasks.
* **Frequency:** Automated execution every **24 hours**.

### 4.2 Backup Structure & Encryption Specs
* **Payload Scope:** Complete PostgreSQL database schema and records, application state configs, audit logs, and secure cloud bucket media assets (receipt photos, check scans, justification documents).
* **Encryption standard:** Archives must be compressed and encrypted using **AES-256** prior to physical disk write.
* **Point-In-Time Restoration:** Backup archives must maintain version control metadata allowing complete system rollbacks to any 24-hour snapshot over a rolling 365-day retention window.

---

# SECTION 5: AUTOMATED WORKFLOW & EVENT ENGINE (EDGE FUNCTIONS)

To guarantee continuous execution regardless of whether staff are logged into the Desktop or Mobile interfaces, the platform utilizes serverless **Supabase Edge Functions** for background automation.

```
+---------------------------------------------------------------------------------------+
|                           VISUAL WORKFLOW AUTOMATION ENGINE                           |
+---------------------------------------------------------------------------------------+
|  [TRIGGER NODE]     --> Event occurs (e.g., Payment Overdue, Absence Logged)          |
+---------------------------------------------------------------------------------------+
                                         |
                                         v
|  [CONDITION NODE]   --> Evaluates logic (e.g., Is Debt > $100 AND Days Overdue > 15?) |
+---------------------------------------------------------------------------------------+
                                         |
                                         v
|  [ACTION NODE]      --> Executes effect (e.g., Lock Portal Access, Push Email Alert)  |
+---------------------------------------------------------------------------------------+
                                         |
                                         v
|  SERVERLESS EXECUTION: Runs 24/7 on Supabase Edge Functions (TypeScript / Deno)       |
+---------------------------------------------------------------------------------------+
```

### 5.1 Architecture & Infrastructure
* **Runtime:** Executed on **Supabase Edge Functions** (built on Deno/TypeScript execution nodes) guaranteeing zero reliance on local device uptime.
* **Visual Graph Engine:** Administrators build and modify automation scenarios on Desktop using a node-based visual flowchart tool (Triggers $\rightarrow$ Conditions $\rightarrow$ Actions).

### 5.2 Trigger Types
1. **Automated Event Triggers:**
   * *Time-based:* Daily cron triggers (e.g., check for upcoming installment due dates every morning at 08:00 AM).
   * *State-based:* Database events (e.g., student GPA calculated below passing threshold; payment record updated to `UNPAID`).
2. **Manual Action Triggers (One-Click Operations):**
   * Single-button administrative triggers executed on-demand (e.g., "Broadcast Overdue Payment Reminders", "Execute Batch Year-End Promotion").

### 5.3 Execution Logic Flow & Actions
* **Conditions Evaluator:** Evaluates complex Boolean logic trees (AND/OR gates, numerical comparisons, status checks).
* **Supported Action Outcomes:**
  * Dispatches automated emails, web portal push alerts, or mobile staff notifications.
  * Adjusts student account statuses (e.g., flags account as `FINANCIALLY_RESTRICTED`).
  * Generates administrative tasks or convocations.
  * Writes fully structured events into the System Audit Log.

---

# SECTION 6: AI INTEGRATION ARCHITECTURE (GROK & OPENROUTER)

```
+---------------------------------------------------------------------------------------+
|                            AI INTEGRATION ARCHITECTURE                                |
+---------------------------------------------------------------------------------------+
|  SYSTEM DEFAULT PROVIDERS:  xAI Grok API  |  OpenRouter Multi-Model Gateway           |
+---------------------------------------------------------------------------------------+
                                         |
                                         v
|  FREEMIUM MODEL & API KEY MANAGEMENT:                                                 |
|  ├── Default Tier: System provides baseline access using default API keys            |
|  └── Premium/BYOK Tier: Institution inputs custom xAI / OpenRouter API Keys in Settings|
+---------------------------------------------------------------------------------------+
                                         |
                                         v
|  INTEGRATED AI USE CASES:                                                             |
|  ├── Academic Insights: Auto-generates qualitative student performance summaries     |
|  ├── Administrative Assistant: Drafts formal parent communications & convocations     |
|  └── Financial Intelligence: Detects anomalies in expense requests & budget trends    |
+---------------------------------------------------------------------------------------+
```

### 6.1 Supported Providers & Models
* **Primary AI Engine:** **xAI Grok API** (for high-speed reasoning and structured data extraction).
* **Multi-Model Gateway:** **OpenRouter API** (providing flexible fallback routing to diverse LLM models).

### 6.2 Freemium Model & API Key Management
* **Default Application Keys:** The system ships with embedded default API keys providing baseline, rate-limited AI capabilities out of the box.
* **Bring Your Own Key (BYOK) Configuration:** Institutions can input their own proprietary xAI or OpenRouter API keys in the **Settings** panel to unlock unlimited higher-tier model processing.

### 6.3 Native AI Capabilities
1. **Automated Academic Summary Generation:** Synthesizes a student's numerical grades, attendance rate, and teacher notes into a cohesive, professional narrative summary for end-of-term report cards.
2. **Smart Administrative Drafting:** Assists staff in drafting formal convocations, parent alerts, and policy notices based on bulleted key points.
3. **Expense Anomaly Detection:** Scans submitted vendor receipt descriptions and amounts during Tier-1 expense requests to flag potential duplicates, missing proof documentation, or budgetary overruns.

---

# SECTION 7: DESKTOP WORKSPACE & CONSOLIDATED NAVIGATION HUBS

The Desktop Application serves as the primary administration terminal, structured into **4 Consolidated UI Hubs**:

```
+---------------------------------------------------------------------------------------+
|                              DESKTOP 4-HUB ARCHITECTURE                               |
+-------------------+-------------------+--------------------+--------------------------+
|       HUB 1       |       HUB 2       |       HUB 3        |          HUB 4           |
| Dashboard & Stats | Financial Portal  | Relationships (CRM)| Academic Management      |
+-------------------+-------------------+--------------------+--------------------------+
| • Main Overview   | • Payment Ledger  | • Unified Parents  | • Scolarité Levels       |
| • Notifications   | • Debt Dashboard  |   & Students Directory|  (Primaire/CEM/Lycée)  |
| • Reports Engine  | • Installments    | • Batch 1-to-4 Child| • Extracurricular Clubs |
| • Analytics Modal | • Receipts Engine |   Registration Form| • Subject Mapping        |
+-------------------+-------------------+--------------------+--------------------------+
```

### 7.1 Hub 1: Dashboard, Notifications, Reports & Analytics
* Integrates real-time operational feeds, global system notification logs, report compilation suites, and deep business analytics (see Section 10).

### 7.2 Hub 2: Financial Portal, Installments & Debt Dashboard
* Manages all financial operations: payment entries, installment schedule configurations (*Paiement par Tranche*), receipt exports, and overdue debt management.

### 7.3 Hub 3: Relationship Portal (Parent-Child CRM)
* Unifies Parent and Student profile management into a relational directory featuring the **Batch Parent/Student Creation Form** (Section 3).

### 7.4 Hub 4: Academic Management (*Scolarité* vs. Clubs)
* Controls academic setups, defining grade levels across Primary, Middle, and High School, alongside independent Extracurricular Club rosters.

---

# SECTION 8: ACADEMIC STRUCTURE, EVALUATION & BATCH PROGRESSION

### 8.1 Educational Hierarchy
* **Primary School (*Primaire*):** 5-Year Curriculum (Grade 1 to Grade 5).
* **Middle School (*CEM*):** 4-Year Curriculum (Year 1 to Year 4).
* **High School (*Lycée*):** 3-Year Curriculum (Year 1 to Year 3 / Streams).

### 8.2 Standard Assessment Formula
Every subject evaluation is calculated using standardized assessment inputs:
$$\text{Subject Average} = \frac{\text{Devoir 1} + \text{Devoir 2} + (\text{Examen} \times 2)}{4}$$

Overall cumulative yearly average (GPA) is computed using weighted subject coefficients:
$$\text{Overall GPA} = \frac{\sum (\text{Subject Average} \times \text{Subject Coefficient})}{\sum \text{Subject Coefficients}}$$

### 8.3 One-Click Batch Student Progression Engine
1. **System Evaluation:** Upon completing term entries, the backend evaluates all student GPAs against the administrative passing threshold (e.g., $10.00 / 20.00$).
2. **Automated Queue Generation:** The engine pre-filters qualifying students into an actionable promotion queue.
3. **One-Click Execution:** Clicking **"Execute Batch Promotion"** automatically advances all approved students to their next sequential grade level for the upcoming academic year, updates rosters, and archives completed report cards to historical logs.

---

# SECTION 9: FINANCIAL ENGINE, INSTALLMENTS & TWO-TIER EXPENSE WORKFLOW

### 9.1 Multi-Mode Payments & Payment Status Lifecycle
* **Methods:** Cash (*Espèces*), Bank Check (*Chèque*), Bank Transfer (*Virement*). Non-cash methods require attaching digital proof scans and logging transaction references/notes.
* **Status Lifecycle:** `PAID` (Verified), `UNPAID` (Overdue), `PENDING` (Under Verification).

### 9.2 Installment Module (*Paiement par Tranche*)
* Enables dividing costs into scheduled installments across **Transport Fees**, **Training Programs (*Stages*)**, **Extracurricular Clubs**, and **Core Tuition**.
* Automatically tracks installment deadlines, partial payments, and remaining balances.

### 9.3 PDF Receipt Generation
Instantly produces two official PDF formats:
1. **Recent Payment Receipt:** Captures solely the immediate transaction performed.
2. **Full Account Statement:** Itemizes complete historical payments, enrolled services, cumulative total paid, and current net balance due.

### 9.4 Two-Tier Expense Request & Approval Workflow
1. **Tier 1 (Initiation):** Staff creates an expense request entering title, category, amount, justification, and initial status `PENDING_APPROVAL`.
2. **Tier 2 (Authorization & Settlement):**
   * Financial officer approves or rejects request (`APPROVED_FUNDS_RELEASED`).
   * Staff completes field transaction, uses the Android Mobile App camera to capture the physical vendor receipt, and submits proof.
   * Ticket updates to `SETTLED_AND_CLOSED` following final receipt verification.

```
+---------------------------------------------------------------------------------------+
|                        TWO-TIER EXPENSE APPROVAL LIFECYCLE                            |
+---------------------------------------------------------------------------------------+
|  STEP 1: REQUEST INITIATION (Staff Mobile or Desktop)                                 |
|  • Inputs title, category, amount, justification -> Status: [PENDING_APPROVAL]        |
+---------------------------------------------------------------------------------------+
                                         |
                                         v
|  STEP 2: FINANCIAL AUTHORIZATION (Admin / Financial Officer)                          |
|  • Reviews request -> Approves & releases funds -> Status: [APPROVED_FUNDS_RELEASED]  |
+---------------------------------------------------------------------------------------+
                                         |
                                         v
|  STEP 3: MOBILE RECEIPT PROOF SETTLEMENT (Staff Member)                              |
|  • Staff uses Android App camera to photograph physical receipt                       |
|  • Uploads photo & inputs final amount spent -> Status: [SETTLED_AND_CLOSED]          |
+---------------------------------------------------------------------------------------+
```

---

# SECTION 10: HUMAN RESOURCES & PERSONNEL MANAGEMENT

### 10.1 Personnel Directory ("Personnel" Space)
* Unified registry for administrative, teaching, medical, and support staff.
* Configures role-based desktop and mobile system permissions.

### 10.2 Teacher Activity Ledger (*Relevé*)
* Tracks teacher class assignments, completed instruction hours, assigned homework logs, and grade entry compliance.

---

# SECTION 11: SYSTEM DEPRECATIONS & REMOVALS

The following legacy structures are **permanently deprecated and purged**:
1. **Fee Templates Module:** Completely removed. Billing configurations are driven via dynamic service enrollment logic.
2. **Scholarship System:** Completely removed. Financial relief is managed exclusively through audited Discretionary Account Balance Adjustments.

---

# SECTION 12: SYSTEM VERIFICATION MATRIX

| Functional Module | Platform Scope | Core Execution Mandate |
| :--- | :--- | :--- |
| **Client Web Portal** | **Web Only (No Mobile App)** | Parents & Students access via web browser only. |
| **Staff Mobile App** | **Android Only** | Exclusively for internal personnel operations. |
| **Mobile Backups** | **Android App** | **ZERO local backup generation or storage on mobile.** |
| **Parent Authentication**| **Web Portal** | Gmail OAuth + 6-7 Digit Family Activation Code link. |
| **Automated Workflows** | **Supabase Edge Functions** | Serverless 24/7 background logic execution. |
| **AI Integration** | **xAI Grok & OpenRouter** | Native LLM capabilities with BYOK API key config. |
| **Expense Workflow** | **Desktop & Android App** | 2-Tier approval with mandatory receipt photo upload. |
| **Academic Progression** | **Desktop App** | 1-Click batch promotion engine based on GPAs. |
| **System Backups** | **Desktop / Central Server** | 24-hour automated AES-256 encrypted archive vault. |

# Enterprise Feature Allocation & Android Staff Mobile App Specification Report

---

## EXECUTIVE SUMMARY

Based on the complete source code analysis of the **El-Imtiyaz School System** desktop application (`el-imtiyaz_Variant`), this report provides a comprehensive architectural evaluation and feature partition strategy. 

It maps every entity, repository, service, and workflow from the desktop codebase into two distinct operational environments:
1. **Staff Android Mobile Application:** A streamlined, highly efficient, touch-optimized tool for staff, teachers, financial officers, and administrators on the go.
2. **Desktop Control Terminal:** The workstation application reserved for heavy administrative tasks, visual graph building, database backups, bulk data operations, and complex Excel ingestion.

---

# SECTION 1: CODEBASE FEATURE INVENTORY

The analyzed desktop codebase contains the following operational subsystems:

```
+---------------------------------------------------------------------------------------+
|                               DESKTOP CODEBASE SUBSYSTEMS                             |
+-------------------+-------------------+--------------------+--------------------------+
|  ACADEMIC & CRM   |    FINANCIAL      |   EXCEL ENGINE     |   AUTOMATION & SYSTEM    |
+-------------------+-------------------+--------------------+--------------------------+
| • Student Mgt     | • Payment Ledger  | • Excel Ingestion  | • DAG Workflow Builder   |
| • Parent Mgt      | • Invoices        |   (ExcelJS load)   | • Node Execution Engine  |
| • Class Rosters   | • Debt Dashboard  | • Formula Engine   | • Audit Logging          |
| • Attendance      | • Fee Schedules   |   (Lexer/Parser)   | • System Backups         |
| • Employees/Roles | • Quote Blocks    | • Spreadsheet      | • Email Dispatches       |
| • Academic Years  | • Audit Comments  |   Template Mapping | • Notifications          |
+-------------------+-------------------+--------------------+--------------------------+
```

1. **Student & Parent Relationship Management:** Student enrollment, guardian linking, phone number splitting (`slash-separated`), document uploads, and emergency contacts.
2. **Class & Attendance Registry:** Grade level & section capacity enforcement, daily attendance marking (`PRESENT`, `ABSENT`, `EXCUSED`, `LATE`), and attendance analytics.
3. **Multi-Tier Financial Engine:** Payment recording, automatic invoice allocation, overdue debt tracking, DZD formatting, and receipt generation.
4. **Excel Migration & Spreadsheet Mirroring:** Master ledger (`ETAT 20262027` sheet mirroring), Devis quote blocks, column AM payment audit comments (`amount/day/month/batch`), and cell formula evaluation.
5. **Dynamic Formula Engine:** Custom mini-language expression parser/evaluator (`SUM`, `VLOOKUP`, `INDEX`, `MATCH`, `IF`, `AND`, `OR`), rule testing, and priority execution.
6. **Visual Workflow Automation:** Node-based directed acyclic graph (DAG) workflow editor, node execution engine, trigger/condition/action registry, and execution logs.
7. **Human Resources & RBAC:** Employee directory, role-based permission matrix (`can()` permission checks), and title management.
8. **System Auditing & Notifications:** Append-only audit trail logging before/after JSON diffs, in-app notifications, and Resend API email integration.

---

# SECTION 2: MOBILE VS. DESKTOP FEATURE ALLOCATION RATIONALE

The table below summarizes where every feature from the desktop codebase should live based on device ergonomics, hardware capabilities, and strict operational constraints (e.g., **Zero Mobile Backups**).

| Operational Module | Desktop Availability | Staff Android Mobile | Operational Rationale |
| :--- | :---: | :---: | :--- |
| **Attendance Logging** | Full | **Primary (Optimized)** | Mobile is ideal for in-classroom, real-time student roll calls. |
| **Student & Parent Search** | Full | **Full (Mobile UI)** | Fast field-lookup of student profiles, medical notes, and parent contact cards. |
| **Quick Payment Entry** | Full | **Full (Mobile UI)** | Enables receptionists or field staff to log cash/check payments instantly. |
| **Field Expense Requests** | Full | **Primary (Camera Scan)** | Staff use mobile cameras to photo vendor receipts and submit Tier-1 expense requests. |
| **Expense Approvals** | Full | **Full (Mobile UI)** | Financial officers approve pending expense tickets via mobile push alerts. |
| **Teacher Activity Log (*Relevé*)** | Full | **Full (Mobile UI)** | Teachers log instruction hours, entering grades (*Devoir 1/2*, *Examen*), and homework. |
| **Notifications & Alerts** | Full | **Full (Push Notifs)** | Real-time native Android push notifications for urgent notices and system alerts. |
| **Excel Workbook Ingestion (`.xlsx`)**| **Exclusive** | **DISABLED** | Processing heavy binary files via `ExcelJS` requires desktop file system performance. |
| **Formula Rule Syntax Editor** | **Exclusive** | **DISABLED** | Complex expression editing and AST validation require large monitor real estate. |
| **DAG Workflow Canvas Editor** | **Exclusive** | **DISABLED** | Touchscreen drag-and-drop node graph editing suffers from ergonomic friction. |
| **Local Database Backups (`.db`)** | **Exclusive** | **STRICTLY PROHIBITED** | Mobile devices must never store local database dumps to prevent data leakage. |
| **Bulk Student/Ledger Imports** | **Exclusive** | **DISABLED** | Processing multi-thousand row batch updates requires a desktop workstation. |
| **Complex PDF Generation** | **Exclusive** | **View Only (Server-side)**| PDF rendering is executed server-side; mobile views pre-rendered PDFs. |

---

# SECTION 3: EXHAUSTIVE ANDROID STAFF MOBILE APP SPECIFICATION

The Staff Android Mobile Application is engineered strictly for **internal staff and faculty**. It prioritizes touch target size, offline resilience (cached data sync), fast barcode/QR scanning, and camera integrations.

```
+---------------------------------------------------------------------------------------+
|                         STAFF ANDROID APP MODULE STRUCTURE                            |
+---------------------------------------------------------------------------------------+
|  [TAB 1: HOME/FEED]   --> Quick stats, daily tasks, mobile push notification feed     |
|  [TAB 2: ATTENDANCE]  --> 30-second classroom roll-call & lateness logger             |
|  [TAB 3: PAYMENTS]    --> Fast counter payment entry & receipt photo capture          |
|  [TAB 4: DIRECTORY]   --> Student/Parent cards with 1-tap phone dialer & WhatsApp     |
|  [TAB 5: EXPENSES]    --> Camera receipt capture & field expense approval hub        |
+---------------------------------------------------------------------------------------+
```

### 3.1 Module 1: Classroom Attendance & Absence Logger
* **30-Second Roll Call:** Teachers select an assigned Class/Section and execute rapid student attendance checks using large touch buttons (`PRESENT`, `ABSENT`, `EXCUSED`, `LATE`).
* **Time-Stamped Lateness:** Automatically logs arrival time (`arrivedAt`) when `LATE` is selected.
* **Absence Alert Trigger:** Automatically evaluates if a student has accumulated 3+ absences, flagging the student's card and dispatches a notification to the parent portal.
* **Offline Attendance Sync:** Allows teachers in areas with poor connectivity to record roll calls locally in memory. The app automatically syncs records to Supabase once connected.

### 3.2 Module 2: Mobile Counter Payments & Receipt Attachment
* **Fast Cash Collection Form:** Receptionists enter payment amounts, select student profiles, and assign payment methods (`Cash`, `Check`, `Bank Transfer`).
* **Camera Check Attachment:** For check or transfer payments, the app activates the Android camera, allowing staff to capture a clear image of the physical check or bank receipt, auto-compress it, and attach it to the transaction.
* **Audit Comment Generation:** Automatically formats and appends the Excel column AM tracking string (e.g., `15000/24/07B12`) to the linked student's ledger record.
* **Overpayment Guard:** Displays inline warning badges if an entered amount exceeds the student's outstanding debt balance (`totalCreance`).

### 3.3 Module 3: Field Expense Submission & Approval Hub
* **Tier-1 Expense Request:** Staff members create field expense requests (e.g., emergency plumbing, classroom supplies) by entering the title, category, requested amount, and operational reason.
* **Receipt Camera Capture:** Integrated camera module to photograph physical vendor receipts upon purchase completion.
* **Remote Manager Approval:** Financial officers receive real-time push alerts for pending requests, inspect receipt photos, and execute one-tap `APPROVE` or `REJECT` actions from their smartphones.

### 3.4 Module 4: Student & Parent Directory (CRM on the Go)
* **Unified Family Cards:** Search students by name or code (`STU-2026-XXXX`). Tapping a student card displays linked parent/guardian details, phone numbers, and emergency contact lists.
* **Direct Telephony Integration:** Tapping a parent's phone number triggers the native Android dialer or opens a pre-formatted WhatsApp chat window for immediate communication.
* **Financial Status Indicator:** Color-coded balance pill on student profile cards:
  * Green: Fully settled (`totalCreance <= 0`).
  * Yellow: Small balance (`0 < totalCreance <= 10,000 DZD`).
  * Red: Overdue debt (`totalCreance > 10,000 DZD`).

### 3.5 Module 5: Teacher Activity & Academic Grade Logger (*Relevé*)
* **Grade Entry Interface:** Teachers select their assigned subjects and input raw evaluation marks for **Test 1 (*Devoir 1*)**, **Test 2 (*Devoir 2*)**, and **Final Exam (*Examen*)**.
* **Homework Push Tool:** Teachers draft homework tasks, attach photos of whiteboard exercises or document scans, assign due dates, and push task alerts directly to target classes.
* **Hours Logger:** Teachers log completed instructional hours per class session for administrative payroll auditing.

---

# SECTION 4: EXHAUSTIVE DESKTOP-ONLY FEATURE SPECIFICATION

The Desktop Application serves as the **Master Control Terminal**, retaining all high-computation, bulk-data, and system-configuration capabilities.

```
+---------------------------------------------------------------------------------------+
|                           DESKTOP-ONLY CONTROL TERMINAL                               |
+---------------------------------------------------------------------------------------+
|  [EXCEL INGESTION ENGINE]  --> Native binary parsing of .xlsx sheets via ExcelJS       |
|  [FORMULA RULE ENGINE]     --> AST parser, mini-language editor & rule precedence      |
|  [VISUAL WORKFLOW DAG]     --> Multi-node canvas editor for automation graph workflows |
|  [SYSTEM BACKUP VAULT]     --> Daily AES-256 local/offsite database archiving          |
|  [BULK DATA EXPORTS]       --> Complex multi-sheet Excel & PDF report generation       |
|  [FULL SYSTEM SETTINGS]    --> RBAC matrix configuration, system parameters, & logs    |
+---------------------------------------------------------------------------------------+
```

### 4.1 Module 1: Excel Workbook Ingestion Engine
* **Workbook Analyzer:** Reads raw `.xlsx` files using `ExcelJS`, extracts sheet architecture, detects named ranges, analyzes data-validation rules, and identifies broken references (`#REF!`).
* **Master Ledger Import:** Reads the `ETAT 20262027` master sheet row-by-row, mapping all 38 columns (B through AL) into persistent database entities.
* **Column AM Audit Comment Ingestion:** Scans legacy cell comments in column AM, parses payment streams, extracts date/amount/batch metadata, and generates structured `PaymentAuditComment` records.

### 4.2 Module 2: Sandboxed Formula Engine & Rule Builder
* **AST Lexer & Parser:** Full custom formula evaluation engine supporting mathematical operations, logic branches (`IF`, `IFS`), arrays, and lookup functions (`VLOOKUP`, `INDEX`, `MATCH`).
* **Interactive Formula Tester:** Live preview workspace allowing administrators to test custom formulas against mock database contexts before publishing rules system-wide.
* **Precedence & Watch List Engine:** Configures execution priority (e.g., Priority 10: `devisAnnuel` $\rightarrow$ Priority 20: `totalVersements` $\rightarrow$ Priority 30: `totalCreance`) and field-change triggers.

### 4.3 Module 3: Visual Workflow Builder (DAG Editor)
* **Drag-and-Drop Node Canvas:** Desktop-only interactive canvas for constructing complex automation graphs by connecting **Triggers**, **Conditions**, **Actions**, **Delays**, and **Transforms**.
* **Node Inspector Panel:** Form editor for configuring node properties, JSON schemas, SQL queries, and email templates.
* **Graph Validation & Cycle Detection:** Enforces Directed Acyclic Graph (DAG) integrity using Kahn's algorithm to prevent infinite execution loops.

### 4.4 Module 4: System Backup, Archiving & Disaster Recovery
* **Automated 24-Hour Backup Daemon:** Desktop terminal controls the execution of local SQLite database backups (`el-imtiyaz.db`).
* **AES-256 Archive Vaulting:** Compresses and encrypts full database dumps, media buckets, and audit logs into timestamped backup files.
* **Restoration Engine:** Features a full system restore interface allowing administrators to rollback database states from local archive vaults.

### 4.5 Module 5: Reporting, Analytics & Multi-Sheet Exports
* **Excel Mirror Exporter:** Generates complex, multi-sheet `.xlsx` workbooks replicating the original school workbook formatting, header styles, and frozen header views.
* **Print-Ready PDF Engine:** Renders formatted PDF reports, class rosters, and official financial statements using `pdfmake`.

---

# SECTION 5: PLATFORM PARITY & FEATURE MATRIX

This matrix details feature availability, user roles, and system constraints across both platforms:

```
                                  PLATFORM CAPABILITY MATRIX

    FEATURE / MODULE                   DESKTOP TERMINAL          STAFF ANDROID APP
    ---------------------------------------------------------------------------------
    Classroom Attendance Marking             YES                   YES (Primary Tool)
    Field Expense Request & Camera Scan      YES                   YES (Camera Native)
    Expense Approval & Disbursal             YES                   YES (Quick Action)
    Student/Parent CRM & Profile Cards       YES                   YES (Touch Optimized)
    Grade Entry (Devoir 1/2, Examen)         YES                   YES (Quick Entry)
    Homework Pushing & Class Alerts          YES                   YES (Mobile Draft)
    Receipt PDF Viewing                      YES                   YES (Pre-rendered)
    Real-Time Push Notifications             YES                   YES (Android Native)
    ---------------------------------------------------------------------------------
    Excel Workbook Ingestion (.xlsx)         YES                   DISABLED
    Visual Workflow Node Editor (DAG)        YES                   DISABLED
    Custom Formula Engine Editor             YES                   DISABLED
    Local Database Backups (.db)             YES                   STRICTLY PROHIBITED
    Bulk Excel/CSV Exports                   YES                   DISABLED
    System RBAC Permission Matrix Config     YES                   DISABLED
```

---

# SECTION 6: IMPLEMENTATION ROADMAP FOR MOBILE DEVELOPERS

To implement the Staff Android Mobile App based on the existing desktop backend architecture, developers should adhere to the following guidelines:

1. **Authentication & API Communication:** Replace local SQLite queries with authenticated HTTPS REST/gRPC endpoints connected to Supabase Auth (JWT).
2. **Media Capture Pipeline:** Utilize native Android camera APIs (`CameraX`) to capture vendor receipts and check scans, auto-compress images to WebP format, and upload directly to private Supabase Cloud Buckets.
3. **Offline Sync Storage:** Use an embedded SQLite cache (`Room Database` on Android) solely for temporary offline state management (e.g., storing offline attendance roll calls). Automatically flush pending records to the server upon network reconnection.

# Master Technical Specification & Mobile/Desktop Feature Allocation Report

---

## EXECUTIVE SUMMARY & PARADIGM REVISIONS

This document establishes the updated master technical specification for the enterprise **Educational & Operational Management Platform**. It reflects recent structural paradigm shifts, codebase analysis of the core application, and precise platform feature allocations between the **Desktop Administration Terminal** and the **Staff Android Mobile Application**.

### Critical System Rule Updates & Core Revisions:
1. **Absolute Excel Engine Deprecations:** The embedded Excel engine, cell-matching logic, formula parsing, `Devis` quote sheet reproduction, and column-AM comment text parsers are **100% deprecated and purged**. Excel is strictly relegated to a two-way data bridge: **Importing Students** and **Exporting Data (XLSX/CSV)**. All billing, quotes, formulas, and history now exist strictly as native database structures.
2. **Unlimited Parent-Child Dynamic Linking ($1 \rightarrow N$ Children):** The previous 4-child limitation is removed. A Parent/Guardian profile can be linked to an **unlimited number ($N$) of dependent children**. The batch registration workflow dynamically scales from $1$ to $N$ student blocks in a single atomic database transaction.
3. **Platform Feature Parity Principle:** The Staff Android Mobile App is a full operational reflection of the Desktop Application. All data displays, profile information, financial ledgers, debt metrics, student records, and operational actions available on Desktop **MUST** be accessible on Mobile—formatted into responsive, touch-optimized card layouts—**unless technically impossible or ergonomically impractical** (e.g., local backup storage, raw Excel file parsing, visual node canvas editing).
4. **Client vs. Staff Platform Boundaries:**
   * **Clients (Parents & Students):** Access strictly via **Web Portal Browsers Only** (No native client app).
   * **Personnel & Faculty (Admins, Teachers, Financial Officers, Staff):** Access via **Desktop Terminal** and **Staff Android Mobile App**.
   * **Mobile Backup Safeguard:** **ZERO local backup generation or file storage on Mobile devices**.

---

# SECTION 1: PLATFORM ARCHITECTURE & FEATURE ALLOCATION MATRIX

```
+---------------------------------------------------------------------------------------+
|                               PLATFORM ARCHITECTURE MAP                               |
+---------------------------------------------------------------------------------------+
|                                  SUPABASE BACKEND HUB                                 |
|             PostgreSQL Database  |  Supabase Auth / JWT  |  Edge Functions            |
+---------------------------------------------------------------------------------------+
                                           |
                   +-----------------------+-----------------------+
                   |                                               |
                   v                                               v
+------------------------------------+          +------------------------------------+
|        DESKTOP TERMINAL            |          |       STAFF ANDROID MOBILE         |
|   (Full Control & Configuration)   |          |    (On-the-Go Operations & CRM)    |
+------------------------------------+          +------------------------------------+
| • 100% Data & Management Scope     |          | • 100% Data & Profile Read Parity  |
| • File System Import/Export        |          | • Touch-Optimized Actions          |
| • Visual DAG Workflow Builder      |          | • Camera Receipt / Check Capture   |
| • 24h Encrypted DB Backup Vault    |          | • Native Mobile Push Notifications |
| • System-wide RBAC Administration  |          | • ZERO Local Database Backups      |
+------------------------------------+          +------------------------------------+
```

### 1.1 Complete Feature Allocation Matrix

| Module / Feature | Desktop Terminal | Staff Android Mobile | Operational Rationale & UX Design |
| :--- | :---: | :---: | :--- |
| **User Authentication & RBAC** | **Full** | **Full** | Supabase Auth/JWT. Role-based screen visibility on both platforms. |
| **Parent-Child CRM ($1 \rightarrow N$ Kids)**| **Full** | **Full** | Unrestricted viewing of parents and linked children. Batch registration supported on both. |
| **Student Profiles & Timeline** | **Full** | **Full** | Complete academic, attendance, document list, and payment history display. |
| **Classroom Attendance Roll Call** | **Full** | **Primary** | Mobile optimized for 30-second in-classroom roll calls with one-tap status toggles. |
| **Payment Collection & Entry** | **Full** | **Full** | Fast counter payment processing with auto-allocation against unpaid invoices. |
| **Check / Transfer Proof Capture**| File Upload | **Camera Scan** | Mobile uses native Android Camera API to capture check scans and bank deposit slips. |
| **Installment Engine (*Tranches*)**| **Full** | **Full** | Configures and displays installment schedules across Transport, Tuition, *Stages*, and Clubs. |
| **Debt Dashboard & Debtors List** | **Full** | **Full** | Real-time school debt metrics, student debtor rankings, and overdue invoice lists. |
| **Two-Tier Expense Requests** | **Full** | **Primary** | Staff submit requests; upload physical receipt images via camera; managers approve on the go. |
| **Grade Entry (*Devoir 1/2, Examen*)**| **Full** | **Full** | Teachers log marks directly from smartphones or desktop terminals. Auto-computes subject GPA. |
| **Homework Push Engine** | **Full** | **Full** | Teachers post homework with photos/attachments pushed directly to Student Web Portals. |
| **Teacher Activity Log (*Relevé*)** | **Full** | **Full** | Faculty log instruction hours, view weekly schedules, and verify grade compliance. |
| **Notifications & System Alerts** | In-App Feed | **Push Notifs** | Android Native Firebase Push Notifications for urgent administrative and financial alerts. |
| **Audit Log Viewing** | **Full** | **Full** | Multi-column filterable audit stream showing user actions, timestamps, and JSON diffs. |
| **AI Assistant (Grok/OpenRouter)** | **Full** | **Full** | Auto-generates report card narratives, drafts communications, and checks expense anomalies. |
| **Automated Workflows (List/Status)**| **Full** | **Full** | View active workflows, execution logs, and execute manual one-click workflow triggers. |
| **Visual Workflow Canvas Editor** | **Full** | **DISABLED** | Drag-and-drop node graph (DAG) editing is impractical on touchscreen devices. |
| **Student Excel Import (`.xlsx`)** | **Full** | **DISABLED** | Bulk file parsing via local file pickers is restricted to the desktop environment. |
| **Data Export Engine (XLSX/CSV)** | **Full** | **Share PDF Only**| Direct file system export generation is executed on Desktop; Mobile views/shares PDFs. |
| **System Database Backups (`.db`)** | **Full** | **PROHIBITED** | **Strict Safeguard:** Mobile devices are explicitly prohibited from local backup storage. |

---

# SECTION 2: STAFF ANDROID MOBILE APPLICATION SPECIFICATION

The Staff Android Application provides full operational data parity with the Desktop Terminal. Pages with multi-column tables on Desktop adapt into responsive, vertical card feeds and drawer panels on Mobile.

```
+---------------------------------------------------------------------------------------+
|                         ANDROID MOBILE APP NAVIGATION LAYOUT                          |
+---------------------------------------------------------------------------------------+
|  [TAB 1: DASHBOARD]   --> Financial KPIs, collection rates, debt summaries, AI feed   |
|  [TAB 2: CRM & ROSTER]--> Parent ($N$ kids) & Student directory, fast profile drawer  |
|  [TAB 3: ACADEMICS]   --> 30s Attendance, Grade logger (Devoir/Examen), Homework push |
|  [TAB 4: FINANCIALS]  --> Counter payments, Check scanner, Debt list, Expense hub     |
|  [TAB 5: PERSONNEL]   --> Staff directory, Teacher Relevé hours logger, Audit trail   |
+---------------------------------------------------------------------------------------+
```

### 2.1 Module 1: Mobile Dashboard & Business Intelligence
* **KPI Metrics Cards:** Top-level summary cards displaying Total Enrolled Students, Monthly Collections, Annual Revenue, and Cumulative Outstanding Debt in DZD.
* **Receivables by Class:** Expandable card breakdown showing outstanding balances grouped by grade level and section.
* **Recent Transactions Feed:** Stream of the last 10 processed receipts displaying receipt numbers, dates, payment methods, and settled amounts.
* **AI Quick Actions:** Floating action button to generate administrative drafts, summarize class performance, or scan recent expense entries for anomalies using Grok/OpenRouter APIs.

### 2.2 Module 2: Mobile Relationship Management (Parent-Child CRM)
* **Parent Directory ($1 \rightarrow N$ Kids):** Searchable list of all registered parents. Each parent card displays:
  * Master Parent Name, primary phone number, secondary contact, and physical address.
  * Interactive badge displaying total number of linked children ($N$ Kids).
  * Consolidated family financial balance (sum of dues across all $N$ children).
  * Direct action buttons: **One-Tap Phone Call (`tel:`)**, **Direct WhatsApp Chat**, and **Add Child**.
* **Unlimited Batch Registration Form:**
  * **Step 1:** Enter Parent Master Information.
  * **Step 2:** Dynamically add children ($1, 2, 3, \dots, N$) using an **"Add Another Child"** action button.
  * **Step 3:** Input child details (Name, DOB, Gender, Grade/Class, Services: Transport, Canteen, Therapy, Clubs).
  * **Step 4:** Submit transaction (creates Parent entity and $N$ linked Student records in a single server write).
* **Student Detail Drawer:** Full profile view containing personal info, emergency contacts, linked parent contacts, class enrollment, complete grade book, payment timeline, and uploaded document attachments.

```
+---------------------------------------------------------------------------------------+
|                     DYNAMIC MOBILE BATCH REGISTRATION WORKFLOW                        |
+---------------------------------------------------------------------------------------+
| STEP 1: Enter Parent Master Information (Name, Phone, Address, Identity)              |
+---------------------------------------------------------------------------------------+
                                           |
                                           v
| STEP 2: Dynamically Add Children Blocks (No upper limit):                             |
|   [+ Add Child 1] --> Name, DOB, Grade, Enrolled Services, Discounts                  |
|   [+ Add Child 2] --> Name, DOB, Grade, Enrolled Services, Discounts                  |
|   [+ Add Child N...]  (Repeats dynamically for as many children as needed)            |
+---------------------------------------------------------------------------------------+
                                           |
                                           v
| STEP 3: Configure Fee Installments & Discounts per Child                              |
+---------------------------------------------------------------------------------------+
                                           |
                                           v
| STEP 4: Atomic Server Write --> Parent Record + N Linked Student Records Created      |
+---------------------------------------------------------------------------------------+
```

### 2.3 Module 3: Mobile Academics, Attendance & Grade Logger
* **30-Second Attendance Roll Call:**
  * Select target Class and Section.
  * Fast toggle list showing student avatars with big touch targets for status selection: `PRESENT` (Green), `ABSENT` (Red), `EXCUSED` (Orange), and `LATE` (Blue).
  * Tapping `LATE` opens an inline time selector to log arrival time.
  * Submitting automatically evaluates total absences; if a student hits 3+ absences, an automated alert fires to the parent web portal.
* **Grade Entry Engine (*Devoir 1/2, Examen*):**
  * Teachers choose Subject and Class.
  * Touch-optimized grade table for entering scores (out of 20) for **Test 1**, **Test 2**, and **Final Exam**.
  * Auto-calculates subject weighted averages in real time using the system formula:
    $$\text{Subject Average} = \frac{\text{Devoir 1} + \text{Devoir 2} + (\text{Examen} \times 2)}{4}$$
* **Homework Assignment & Portal Push:**
  * Teachers draft assignments, specify target classes, set due dates, and capture photos of whiteboard exercises or worksheets using the device camera.
  * Instant push dispatch to student web portals with push notification alerts to parents.

### 2.4 Module 4: Mobile Counter Payments, Installments & Expenses
* **Payment Entry & Check Scanner:**
  * Select Student or Parent profile.
  * System auto-populates unpaid invoices ordered by age.
  * Select payment mode: **Cash**, **Check**, or **Bank Transfer**.
  * **Check / Transfer Proof Capture:** Device camera opens automatically for non-cash modes to photograph physical checks or bank receipts. Images auto-compress and upload directly to private cloud buckets.
  * Auto-generates transaction receipt numbers (`RCP-2026-XXXXX`).
* **Debt Dashboard & Overdue Tracking:**
  * Complete view of all families in debt, sorted by total outstanding balance.
  * Displays aging debt metrics (0-30 days, 31-60 days, 61-90+ days overdue).
  * Direct action button to trigger automated overdue payment reminders via Edge Functions.
* **Two-Tier Expense Request & Approval Hub:**
  * **Tier-1 Submission:** Field staff create expense tickets, enter requested amounts and justifications, and photograph vendor receipts using the device camera.
  * **Tier-2 Manager Approval:** Financial officers view pending requests, inspect receipt photos, and execute one-tap `APPROVE` or `REJECT` actions remotely.

### 2.5 Module 5: Personnel, Faculty Log & Audit Stream
* **Staff Registry:** Complete employee directory with job titles, roles, phone numbers, assigned classes, and active/inactive statuses.
* **Teacher Activity Ledger (*Relevé*):**
  * Teachers log instruction hours completed per class session.
  * View personal weekly teaching schedules and administrative compliance metrics.
* **Audit Trail Stream:** Real-time mobile stream of system audit logs, filterable by actor, action type, and date range. Displays JSON before/after state diffs in a collapsible code drawer.

---

# SECTION 3: EXHAUSTIVE DESKTOP TERMINAL SPECIFICATION

The Desktop Application serves as the primary administration terminal, retaining all heavy file-system operations, visual graph building, database disaster recovery, and bulk data processing.

```
+---------------------------------------------------------------------------------------+
|                          DESKTOP TERMINAL CONTROL MODULES                             |
+---------------------------------------------------------------------------------------+
|  [HUB 1: WORKSTATION DASHBOARD]   --> Deep BI analytics, multi-chart data comparison  |
|  [HUB 2: STUDENT EXCEL IMPORT]    --> Bulk registration via .xlsx parsing & mapping   |
|  [HUB 3: DATA EXPORT ENGINE]      --> Multi-sheet Excel & PDF report generation        |
|  [HUB 4: VISUAL WORKFLOW CANVAS]  --> Interactive drag-and-drop DAG node graph builder|
|  [HUB 5: 24H BACKUP ARCHIVE VAULT]--> AES-256 local/offsite database backup engine     |
+---------------------------------------------------------------------------------------+
```

### 3.1 Module 1: Student Import via Excel Bridge
* **Purpose:** Excel is deprecated as an operational engine, but remains as an import data bridge.
* **Import Pipeline:**
  1. Staff selects a local `.xlsx` file using the native OS file picker.
  2. System parses the binary workbook using `ExcelJS`.
  3. Maps spreadsheet column headers to database fields (Student Name, Parent Details, Contact Numbers, DOB, Class Level).
  4. Executes validation checks for required fields, missing parent links, and invalid grade codes.
  5. Bulk-creates Parent and Student records inside an atomic database transaction.

### 3.2 Module 2: System Data Export Engine (XLSX & CSV)
* **Purpose:** Excel is used as a data export format for external reporting.
* **Export Pipeline:**
  * **Revenue Reports:** Exports multi-sheet Excel files containing daily payment collections, breakdown by payment method (Cash vs. Check vs. Transfer), and service revenue breakdown.
  * **Outstanding Debt Reports:** Exports itemized CSV/XLSX workbooks detailing family debts, student codes, class levels, and overdue aging tiers.
  * **Student Roster Exports:** Generates class lists with complete guardian contact information and enrollment statuses.

### 3.3 Module 3: Visual Workflow Builder (DAG Canvas Editor)
* **Interactive Drag-and-Drop Editor:** Desktop-exclusive multi-node visual editor for building background automation scenarios.
* **Node Library:**
  * **Triggers:** Payment Overdue, Student Enrolled, Payment Recorded, Schedule (Cron), Absence Limit Exceeded, Manual Run.
  * **Conditions:** Debt > Threshold, Payment Method Match, Student Status Match.
  * **Actions:** Send Email (Resend API), Apply Account Discount, Create Invoice, Dispatch Push Notification, Log Audit Activity.
  * **Delays & Transforms:** Wait Duration, Database Query, Extract Field.
* **Graph Validation:** Enforces Directed Acyclic Graph (DAG) logic using Kahn's algorithm to prevent circular loops prior to deployment to Supabase Edge Functions.

### 3.4 Module 4: 24-Hour Automated Backup Vault & Disaster Recovery
* **Execution Node:** Driven strictly from the Desktop Master Terminal.
* **Backup Cycle:** Automated cron daemon runs every 24 hours.
* **Archive Scope:** Complete PostgreSQL database dump, application metadata, audit logs, and private media bucket assets (receipt photos, check scans, contracts).
* **Encryption & Storage:** Encrypts archives using **AES-256** standards and writes timestamped files (`backup-YYYY-MM-DD-HHMMSS.db`) to a designated local external server or offsite encrypted vault.
* **System Restore Interface:** Features one-click point-in-time database restoration capabilities.

---

# SECTION 4: CLIENT WEB PORTAL SPECIFICATION (WEB-ONLY)

Clients (Parents and Students) have **NO native mobile application**. They access institutional services strictly through responsive Web Browsers on desktop or mobile devices.

```mermaid
flowchart TD
    AUTH["Parent/Student Browser Auth<br/>(Google OAuth / Gmail)"]
    LINK["Family Link Code Verification<br/>(6-to-7 Digit Code / QR Code)"]
    PORTAL["CLIENT WEB PORTAL DASHBOARD"]

    AUTH --> LINK --> PORTAL

    PORTAL --> ACAD["Academic Hub:<br/>Grade Books, GPAs, Report Card PDFs"]
    PORTAL --> EXAM["Exam Timetable:<br/>Dates, Times, Rooms, Invigilators"]
    PORTAL --> ABS["Absence Justification:<br/>Explanations, Uploads, Drive Links"]
    PORTAL --> COMM["Staff Messages:<br/>Convocations, Notices, Replies"]
    PORTAL --> FIN["Financial Ledger:<br/>Enrolled Services, Paid Dues, Installment Schedules"]
```

### 4.1 Account Binding & Single-Parent Portal
* **Gmail OAuth & Link Code:** Parents log in using Google OAuth. Upon first login, the portal prompts for a **6-to-7 digit family activation code** (or QR code) generated by office staff.
* **Multi-Child Unified Dashboard:** Validating the activation code permanently links the parent account (`auth.uid`) to all $N$ dependent children. The parent manages all children from a single dashboard without switching logins.

### 4.2 Web Portal Features
1. **Academic Performance & Bulletins:** View live grade books (*Devoir 1/2*, *Examen*), subject weighted averages, overall cumulative GPAs, and download official PDF term report cards (*Bulletins*).
2. **Exam Timetable Engine:** Complete schedule for upcoming tests and exams detailing Exam Title, Date, Start/End Time, Assigned Room/Hall Number, and Invigilator.
3. **Absence Justification Engine:** Parents submit medical certificates or explanatory notes for student absences via direct document upload or shared cloud storage links (Google Drive, OneDrive).
4. **Convocations & Staff Communication:** View official administrative meeting requests, notices, and convocations, with built-in reply and attachment capabilities.
5. **Billing & Installment Transparency:** Real-time visibility into total enrolled services, historical payments, remaining installment schedules (*Tranches*), and upcoming due dates.

---

# SECTION 5: ARCHITECTURAL COMPARISON & VERIFICATION MATRIX

```
                             FULL SYSTEM COMPARISON MATRIX

    FEATURE / MODULE          DESKTOP TERMINAL   STAFF ANDROID APP   CLIENT WEB PORTAL
    ----------------------------------------------------------------------------------
    Target Audience           Internal Staff     Internal Staff      Parents & Students
    Native Mobile App         No (Desktop App)   YES (Android Only)  NO (Web Only)
    Data Read Parity          100% Full Access   100% Full Access    Scoped (Own Kids Only)
    Parent-Child CRM          1 -> N Children    1 -> N Children     Single Parent View
    Batch Student Registration 1 -> N Form        1 -> N Form         Disabled
    Classroom Attendance      Supported          Primary Tool        View Only
    Check/Receipt Proof       File Upload        Native Camera Scan  View Only
    Two-Tier Expense Requests Full Lifecycle     Full Lifecycle      Disabled
    Grade Entry & Homework    Full Access        Full Access         View Only (Grades/HW)
    Absence Justifications    Review & Approve   Review & Approve    Submit Justification
    ----------------------------------------------------------------------------------
    Excel File Imports (.xlsx) YES (Bridge Only) DISABLED            DISABLED
    Data Exports (XLSX/CSV)   YES                Share PDF Only      Download Report Cards
    Visual Workflow DAG Builder YES              DISABLED            DISABLED
    Automated Background Rules Edge Functions    Edge Functions      Edge Functions (24/7)
    AES-256 DB Backups        YES (24h Automated) STRICTLY PROHIBITED DISABLED
```

---

# SECTION 6: IMPLEMENTATION ROADMAP FOR DEVELOPMENT TEAMS

### 1. Database Schema Extensions (Supabase / PostgreSQL)
* Ensure `parents` and `students` tables utilize an unrestricted Foreign Key mapping (`students.parent_ids_json` or a junction table `parent_student_links`) supporting $1 \rightarrow N$ children per parent.
* Remove legacy Excel-mirroring tables (`quote_blocks`, `spreadsheet_templates`, `payment_audit_comments`). Ensure payment transactions write directly to structured `payments` and `invoices` tables.

### 2. Android Mobile Application Setup (Kotlin / Flutter)
* Build responsive card-based list components to replace Desktop data grid views.
* Implement native Android `CameraX` API for photographing checks and expense receipts, compressing images to WebP before uploading to Supabase Storage.
* Integrate Firebase Cloud Messaging (FCM) to handle push notifications dispatched by Supabase Edge Functions.
* **Enforce Safeguard:** Exclude all local SQLite storage engines or backup file creation routines from the mobile codebase.

### 3. Desktop Application Refactoring (Electron / React)
* Remove Excel formula evaluation logic. Maintain `exceljs` strictly inside the student import and report export service modules.
* Retain the 24-hour AES-256 backup execution daemon driving local archive generation.
* Maintain the visual DAG workflow builder canvas for administrative automation setup.

# Master System Requirements Specification (SRS) & Enterprise Architecture Report

---

## EXECUTIVE SUMMARY

This document serves as the absolute, definitive, and comprehensive System Requirements Specification (SRS) for the **El-Imtiyaz Educational & Operational Management Platform**. It synthesizes all system requirements, architectural paradigms, operational workflows, financial mechanics, academic progression frameworks, artificial intelligence integrations, and user interface (UI/UX) design specifications into a single technical blueprint.

### Fundamental Paradigm Rules & System Constraints
1. **Client Ecosystem (Web Portal Only):** Parents, guardians, and students access system services **EXCLUSIVELY through Web Browsers**. There is **no native mobile app** for clients.
2. **Staff Ecosystem (Desktop Terminal & Android Mobile App):** Internal personnel (Administrators, Financial Officers, Teachers, Caretakers, Support Staff) operate via a **Desktop Control Terminal** (for deep administrative tasks and configuration) and a **Staff Android Mobile Application** (for touch-optimized, on-the-go field operations).
3. **Absolute Excel Engine Deprecation:** The embedded Excel formula engine, cell-matching logic, `Devis` quote sheet layout, and column-AM comment text parsers are **100% deprecated and purged**. Excel is strictly limited to a two-way data bridge: **Importing Student Roster Files** and **Exporting Data Reports (XLSX/CSV)**.
4. **Unlimited Parent-Child Dynamic Linking ($1 \rightarrow N$ Children):** A Parent/Guardian account supports an **unlimited number ($N$) of dependent children**. The batch registration workflow dynamically expands from $1$ to $N$ child blocks within a single atomic database transaction.
5. **Full Mobile Platform Data Parity:** The Staff Android Application offers 100% data read and operational parity with the Desktop Terminal. Every data profile, grade ledger, debt metric, and student record visible on Desktop is accessible on Mobile via mobile-optimized card feeds and drawers, excluding hardware- or file-system-bound operations (e.g., local backup vaults, raw Excel file parsing, and visual node canvas editing).
6. **Mobile Data Safeguard:** The Staff Android Mobile App is **strictly prohibited from generating, downloading, or storing local database archives or backups**.
7. **Serverless Background Automation:** All workflow rules run 24/7 on **Supabase Edge Functions** (built on Deno/TypeScript), independent of active client desktop or mobile sessions.
8. **Artificial Intelligence Engine (Groq & OpenRouter):** Native AI capabilities leverage the **Groq LPU API** (high-speed inference via free tier) and **OpenRouter API** gateway, supporting Bring-Your-Own-Key (BYOK) settings.

---

# SECTION 1: SYSTEM ARCHITECTURE, PLATFORM DIVISION & ACCESSIBILITY MATRIX

```
+---------------------------------------------------------------------------------------+
|                               PLATFORM ARCHITECTURE MAP                               |
+---------------------------------------------------------------------------------------+
|                                  SUPABASE BACKEND HUB                                 |
|             PostgreSQL Database  |  Supabase Auth / JWT  |  Edge Functions            |
+---------------------------------------------------------------------------------------+
                                           |
            +------------------------------+------------------------------+
            |                              |                              |
            v                              v                              v
+-----------------------+     +-----------------------+     +-----------------------+
|   CLIENT WEB PORTAL   |     |   DESKTOP TERMINAL    |     |  STAFF ANDROID APP    |
| (Parents & Students)  |     | (Admin Command Hub)   |     |  (Field Operations)   |
+-----------------------+     +-----------------------+     +-----------------------+
| • Web Browsers Only   |     | • Full Data Control   |     | • 100% Data Parity    |
| • OAuth + 6-7 Digit   |     | • Visual Workflow Builder|   | • Touch Roll Calls    |
|   Family Link Code    |     | • Excel Import/Export |     | • Camera Receipt Scan |
| • View Grades/PDFs    |     | • 24h Encrypted Backup|     | • Push Notifications  |
| • Submit Justifications|    | • Full System Config  |     | • ZERO Local Backups  |
+-----------------------+     +-----------------------+     +-----------------------+
```

### 1.1 Platform Access & Role Matrix (RBAC)

| User Role | Platform Scope | Mobile App | Auth Method | Primary System Capabilities |
| :--- | :--- | :--- | :--- | :--- |
| **Super Admin** | Desktop, Android App | Native Android | Supabase Auth / JWT | Full system control, RBAC matrix, security, backup vaults, workflows. |
| **Financial Officer** | Desktop, Android App | Native Android | Supabase Auth / JWT | Payment ledger, debt analytics, expense approval, receipt exports. |
| **Teacher / Faculty** | Desktop, Android App | Native Android | Supabase Auth / JWT | Grade entry (*Devoir 1/2, Examen*), 30s attendance, homework push, *Relevé*. |
| **Support Staff** | Android App | Native Android | Supabase Auth / JWT | Field maintenance requests, Tier-1 expense submissions with receipt camera capture. |
| **Parent / Guardian** | **Web Portal Only** | **NONE** | Google OAuth + 6-7 Digit Code | View all linked $N$ children, grades, financial dues, submit absence justifications. |
| **Student** | **Web Portal Only** | **NONE** | Web Login / Student ID | View term report cards, exam schedules, class homework, and timetable. |

---

# SECTION 2: USER INTERFACE (UI) AND USER EXPERIENCE (UX) SPECIFICATIONS

## 2.1 Visual Identity, Design Tokens & Color Palette
The application enforces a cohesive visual identity across both Desktop and Android Mobile platforms. The color palette reflects an academic environment while maintaining high legibility and contrast.

```
+---------------------------------------------------------------------------------------+
|                              EL-IMTIYAZ COLOR PALETTE                                 |
+-------------------+-------------------+--------------------+--------------------------+
|  PRIMARY BLUE     |     DEEP BLUE     |    SLATE GRAY      |      WARM ACCENT          |
|     #349BD4       |      #2B7FB0      |      #3B464C       |        #C8A98C           |
| (RGB 52,155,212)  |  (RGB 43,127,176) |  (RGB 59,70,76)    |   (RGB 200,169,140)      |
+-------------------+-------------------+--------------------+--------------------------+
|  DARK BACKGROUND  |    PANEL BACKING  |   SURFACE / ELEV   |      OFF-WHITE TEXT      |
|     #242526       |      #1E1F20      |      #2A2B2D       |        #EFF2F3           |
+-------------------+-------------------+--------------------+--------------------------+
|  STATUS SUCCESS   |   STATUS WARNING  |   STATUS DANGER    |     CYAN GLOW            |
|     #3FA66E       |      #C8A98C      |      #C0504D       |        #6EC1E4           |
+-------------------+-------------------+--------------------+--------------------------+
```

## 2.2 Desktop UI/UX Architecture
The Desktop application utilizes a **Permanent Sidebar + Tabbed Workspace + Modal Overlay** layout:

```
+---------------------------------------------------------------------------------------+
|                               DESKTOP WORKSPACE LAYOUT                                |
+---------------------------------------------------------------------------------------+
| [BRAND HEADER / TOPBAR: Global Search (Cmd+K) | System Alerts | Quick Backup | Profile] |
+---------------+-----------------------------------------------------------------------+
|               | MAIN WORKSPACE TAB CONTAINER                                          |
| PERMANENT     | +-------------------------------------------------------------------+ |
| NAVIGATION    | | TAB 1: Dashboard | TAB 2: Notifications | TAB 3: Global Reports     | |
| SIDEBAR       | +-------------------------------------------------------------------+ |
|               | |                                                                   | |
| • Hub 1:      | | [ACTIVE TAB CONTENT AREA]                                         | |
|   Overview    | | Real-time data grids, interactive charts, and action toolbars     | |
| • Hub 2:      | |                                                                   | |
|   Financials  | |                                                                   | |
| • Hub 3:      | |                                                                   | |
|   CRM         | |                                                                   | |
| • Hub 4:      | |                                                                   | |
|   Academics   | |                                                                   | |
| • Settings    | |                                                                   | |
+---------------+-----------------------------------------------------------------------+
```

1. **Permanent Navigation Sidebar:** Fixed left-hand navigation column anchored to the viewport. Contains primary navigation buttons corresponding to the **4 Consolidated UI Hubs** plus System Settings.
2. **Multi-Tabbed Workspaces:** Selecting a main hub loads a sub-navigation tab row at the top of the content area. Each tab represents an isolated sub-module (e.g., Financial Hub $\rightarrow$ *Payments Tab | Receipts Tab | Debt Dashboard Tab | Installments Tab*).
3. **Focused Modals & Slide-Over Drawers:** Operations requiring concentrated data entry (such as multi-child batch registration or workflow editing) open as large, dark-backed modal dialogs or right-side drawers over the current view, maintaining user context.

## 2.3 Android Mobile UI/UX Architecture
The Staff Android Application translates Desktop capabilities into an intuitive, touch-first mobile experience following modern Android design standards:

```
+---------------------------------------------------------------------------------------+
|                               MOBILE APP SCREEN LAYOUT                                |
+---------------------------------------------------------------------------------------+
| [TOP APP BAR: Screen Title | Search Icon | Push Alerts Bell | Profile Avatar]         |
+---------------------------------------------------------------------------------------+
|                                                                                       |
|  VERTICAL CARD FEED CONTAINER                                                         |
|  +---------------------------------------------------------------------------------+  |
|  | [CARD 1: Family Entity Card]                                                    |  |
|  | Parent Name, Phone, $N$ Kids Badge, Total Debt Pill                              |  |
|  | Action Buttons: [Call] [WhatsApp] [View Details]                                 |  |
|  +---------------------------------------------------------------------------------+  |
|  | [CARD 2: Family Entity Card]                                                    |  |
|  | ...                                                                             |  |
|  +---------------------------------------------------------------------------------+  |
|                                                                                       |
|  [FLOATING ACTION BUTTON (+): Fast Quick Action Menu (New Payment / Attendance)]     |
+---------------------------------------------------------------------------------------+
| [BOTTOM NAVIGATION BAR: 1. Home | 2. Directory | 3. Attendance | 4. Dues | 5. Staff]  |
+---------------------------------------------------------------------------------------+
```

1. **Bottom Navigation Bar:** 5 primary touch destinations anchored to the bottom of the device screen:
   * **Home / Dashboard:** Operational metrics, collection feeds, AI quick actions.
   * **Directory (CRM):** Parent & Student directory with search bars and single-tap communications.
   * **Attendance:** Fast 30-second classroom roll call interface.
   * **Financials & Dues:** Counter payment logging, camera check scanning, expense requests.
   * **Personnel & Staff:** Staff directory, Teacher *Relevé* hours logger, and system audit logs.
2. **Card-Based List Views:** Replaces wide Desktop data tables with vertical, touch-friendly cards featuring clear visual hierarchy, large touch targets, and color-coded status badges.
3. **Native Device Integration:** Native hardware hooks for camera receipt scanning, one-tap phone dialing (`tel:` protocols), WhatsApp deep-linking, and push notifications.

---

# SECTION 3: PARENT & STUDENT RELATIONSHIP MANAGEMENT (CRM WORKFLOWS)

```
+---------------------------------------------------------------------------------------+
|                      UNLIMITED BATCH REGISTRATION WORKFLOW (1 -> N)                   |
+---------------------------------------------------------------------------------------+
| STEP 1: Enter Parent Master Record (First/Last Name, Phone, Email, Address)          |
+---------------------------------------------------------------------------------------+
                                           |
                                           v
| STEP 2: Dynamically Append Dependent Children Blocks (Unlimited N Count):             |
|   ├── Child Block 1: Full Name, DOB, Gender, Level/Class, Services & Discounts        |
|   ├── Child Block 2: Full Name, DOB, Gender, Level/Class, Services & Discounts        |
|   └── Child Block N: Full Name, DOB, Gender, Level/Class, Services & Discounts        |
+---------------------------------------------------------------------------------------+
                                           |
                                           v
| STEP 3: Configure Multi-Service Billing & Installments per Child                      |
+---------------------------------------------------------------------------------------+
                                           |
                                           v
| STEP 4: Atomic Database Transaction (BEGIN...COMMIT) Writes Parent + N Students      |
+---------------------------------------------------------------------------------------+
```

### 3.1 Parent-First Entity Dependency
* **Schema Requirement:** A Student record cannot exist as an orphan in the database. A valid foreign key (`parent_id`) pointing to a Parent profile is strictly mandatory upon creation.
* **Unlimited $N$-Child Mapping:** A Parent profile can link to an **unlimited number ($N$) of dependent children**. The database utilizes a dynamic junction structure or relational Foreign Key collection (`parent_ids_json` / relational junction) supporting scale without artificial limits.

### 3.2 Dynamic Batch Creation Engine
* Both Desktop and Mobile interfaces support creating a Parent profile and attaching **$1$ to $N$ children** in a single submission:
  * **Parent Data Section:** First Name, Last Name, Primary Phone, Secondary Phone, Email, Physical Address, Occupation, Relationship (`Father`, `Mother`, `Guardian`).
  * **Dynamic Children Section ($N$ Form Cards):** An **"Add Another Child"** action button appends an additional student sub-form capturing:
    * Child Full Name, Date of Birth, Gender.
    * Assigned Academic Grade/Class (*Scolarité*) or Extracurricular Club.
    * Enrolled Special Services (Transport, Canteen, Psychotherapy, Speech Therapy / Orthophonie).
    * Custom Fee Adjustments / Discretionary Discounts.
  * **Atomic Execution:** The submission is executed inside an atomic database transaction (`BEGIN...COMMIT`). If validation fails for any child (e.g., missing Date of Birth for Child 5), the entire transaction rolls back, preventing partial or orphaned records.

### 3.3 Bidirectional Relational Profiles
* **From Parent Profile View:**
  * Displays complete contact details and address.
  * Lists all $N$ linked children with their respective grade levels and assigned classes.
  * Displays consolidated family financial balance (cumulative sum of outstanding dues across all $N$ children).
  * Itemized ledger of all historic payments made by the parent.
  * Direct action controls: One-tap Phone Call, Direct WhatsApp Chat, and Generate Family Statement PDF.
* **From Student Profile View:**
  * Displays personal data, enrollment code, DOB, and medical/special notes.
  * Direct link cards to linked parent/guardian profiles.
  * Complete individual academic grade book, attendance record, and fee timeline.

---

# SECTION 4: ACADEMIC STRUCTURE, DYNAMIC CLUBS & PROMOTION ENGINE

```
                     +----------------------------------------+
                     |         ACADEMIC DOMAIN SPLIT          |
                     +-------------------+--------------------+
                                         |
             +---------------------------+---------------------------+
             |                                                       |
             v                                                       v
+--------------------------+                               +-------------------+
|  CORE ACADEMICS          |                               |  EXTRACURRICULAR  |
|  (Scolarité)             |                               |  CLUBS & SERVICES |
+--------------------------+                               +-------------------+
| Grade Levels & Terms     |                               | Chess Club        |
| Standard Curricula       |                               | English Club      |
| Coefficients & GPAs      |                               | Sports & Arts     |
| Automated Promotion      |                               | Flexible Fees     |
+--------------------------+                               +-------------------+
```

### 4.1 Structural Domain Separation
The system enforces a boundary between **Formal Core Academics (*Scolarité*)** and **Extracurricular Clubs**:
* **Core Academics (*Scolarité*):** Structured multi-year educational levels, coefficient-weighted grading formulas, official report cards, and year-end batch promotion logic.
* **Extracurricular Clubs & Specialized Therapy:** Flexible, optional enrollment, session or flat billing, independent of academic promotion/retention. Includes Chess Club, English Club, Sports, Speech Therapy (*Orthophonie*), and Psychological Support.

### 4.2 Multi-Level Hierarchy & Dynamic Academic Management
* **Core Educational Hierarchy:**
  * **Primary School (*Primaire*):** 5-Year Cycle (Grade 1 through Grade 5).
  * **Middle School (*CEM - Collège*):** 4-Year Cycle (Year 1 through Year 4).
  * **High School (*Lycée*):** 3-Year Cycle (Year 1 through Year 3 / Specialization Streams).
* **Dynamic Year & Club Management:** Administrators can dynamically configure academic structures through the UI:
  * **Add / Archive Academic Years:** Create new academic calendars (e.g., "2026-2027"), configure term structures (Semesters, Trimesters, Quarters), and archive old calendars.
  * **Add / Remove Extracurricular Clubs:** Create new clubs, define capacity limits, assign primary instructors/coaches, set fee structures, or deprecate inactive clubs.

### 4.3 Assessment Formula, Coefficients & Grade Entry
* **Term Assessment Inputs:** Subject evaluations accept three standardized test scores:
  1. **Test 1 (*Devoir 1*):** Score out of 20.
  2. **Test 2 (*Devoir 2*):** Score out of 20.
  3. **Final Exam (*Examen*):** Score out of 20.
* **Weighted Subject Average Calculation:**
  $$\text{Subject Average} = \frac{\text{Devoir 1} + \text{Devoir 2} + (\text{Examen} \times 2)}{4}$$
* **Cumulative Overall GPA Calculation:**
  $$\text{Overall GPA} = \frac{\sum (\text{Subject Average} \times \text{Subject Coefficient})}{\sum \text{Subject Coefficients}}$$
* **Teacher Grade Entry:** Teachers log assessment scores directly via Desktop or Mobile interfaces. Subject averages and GPAs update automatically.

### 4.4 One-Click Batch Student Progression Engine
```
+-----------------------------------------------------------------------------------+
|                            BATCH PROGRESSION ENGINE                               |
+-----------------------------------------------------------------------------------+
| Step 1: Calculate Final Cumulative GPAs for All Enrolled Students                 |
+-----------------------------------------------------------------------------------+
                                         |
                                         v
| Step 2: System Automatically Flags Academic Records:                             |
|   ├── GPA >= 10.00 / 20.00  -->  [APPROVED_FOR_PROMOTION]                        |
|   └── GPA < 10.00 / 20.00   -->  [RETAINED_SAME_YEAR]                            |
+-----------------------------------------------------------------------------------+
                                         |
                                         v
| Step 3: Admin Reviews Queue & Applies Manual Exception Overrides                  |
+-----------------------------------------------------------------------------------+
                                         |
                                         v
| Step 4: One-Click Execution: Advances approved students to next sequential grade |
|         (e.g., Grade 3 -> Grade 4), updates rosters, and archives historical cards|
+-----------------------------------------------------------------------------------+
```

### 4.5 Homework Assignment & Portal Push Engine
* Teachers create homework assignments by specifying Subject, Target Class, Description, Due Date, and attaching task documents or photos of whiteboard notes.
* Upon saving, the system automatically pushes the task to the Student Web Portal for all enrolled class members, firing push alerts to parents.

---

# SECTION 5: FINANCIAL ENGINE, INSTALLMENTS & TWO-TIER EXPENSES

### 5.1 Payment Processing & Status Lifecycle
* **Supported Payment Methods:**
  * **Cash (*Espèces*):** Immediate counter processing.
  * **Bank Check (*Chèque*):** Captures Check Number, Bank Name, Issue Date, and Expiry Date. Uploading a check scan image is required.
  * **Bank Transfer (*Virement*):** Captures Transaction Reference ID and Source Bank. Uploading a transfer receipt image is required.
* **Remarks & Context Field:** Required notes field to document transaction details (e.g., "Check pending bank clearance", "Transfer delayed").
* **Payment Status Lifecycle:** `PAID` (Funds verified), `UNPAID` (Invoice outstanding), `PENDING` (Under verification/clearance).

### 5.2 Multi-Service Installment Engine (*Paiement par Tranche*)
* **Scope:** Supports dividing total service costs into 3 scheduled installment tranches across:
  * **Transportation Fees:** 3-Tranche breakdown based on town destination tier.
  * **Training / Internship Programs (*Stages*):** Scheduled milestone payments.
  * **Extracurricular Clubs:** Flexible tranche schedules per activity.
  * **Core Tuition Fees:** Term/monthly installment plans.
* **Direct Upfront Payment Option:** Supports immediate 100% upfront settlement for any service, bypassing installment logic.
* **Tranche Schedule Engine:** Calculates exact payment milestones, due dates, paid portions, and remaining unpaid balance per tranche.

### 5.3 PDF Receipt Engine & Exports
Generates official, printable PDF receipts with two export options:
1. **Recent Payment Receipt:** Captures strictly the immediate transaction just completed (Amount Paid, Date, Receipt ID, Payment Method, Billed Items).
2. **Full Family Account Statement:** Itemizes complete historical payments made across all linked children, active enrolled services, cumulative billed totals, total paid to date, and current outstanding net balance due.

### 5.4 Two-Tier Expense Request & Approval Workflow
```
+---------------------------------------------------------------------------------------+
|                        TWO-TIER EXPENSE APPROVAL LIFECYCLE                            |
+---------------------------------------------------------------------------------------+
|  STEP 1: REQUEST INITIATION (Staff Mobile or Desktop)                                 |
|  • Staff fills title, category, requested amount, justification                       |
|  • Initial Ticket Status: [PENDING_APPROVAL]                                          |
+---------------------------------------------------------------------------------------+
                                         |
                                         v
|  STEP 2: AUTHORIZATION & FUND DISBURSEMENT (Admin / Financial Officer)                |
|  • Manager reviews ticket details and justification                                    |
|  • Executes APPROVE or REJECT action                                                  |
|  • If Approved: Ticket Status updates to [APPROVED_FUNDS_RELEASED]                     |
+---------------------------------------------------------------------------------------+
                                         |
                                         v
|  STEP 3: MOBILE RECEIPT PROOF SETTLEMENT (Requesting Staff Member)                    |
|  • Staff completes purchase in the field                                              |
|  • Activates Android Camera to photograph vendor receipt/invoice                       |
|  • Uploads photo & inputs final actual expenditure amount                             |
|  • Final Ticket Status updates to [SETTLED_AND_CLOSED]                                |
+---------------------------------------------------------------------------------------+
```

---

# SECTION 6: ATTENDANCE, FACULTY & HUMAN RESOURCES

### 6.1 30-Second Classroom Attendance Roll Call
* **Mobile-Optimized Interface:** Teachers select their target class and execute roll call in under 30 seconds using large status toggle buttons:
  * `PRESENT` (Green)
  * `ABSENT` (Red)
  * `EXCUSED` (Orange)
  * `LATE` (Blue - prompts for arrival time)
* **Automated Absence Thresholds:** Accumulating 3+ absences automatically flags the student profile and dispatches an alert to the parent web portal.

### 6.2 Staff Directory & RBAC
* Centralized registry managing administrative, teaching, support, and medical/therapy staff.
* Configures role-based desktop and mobile UI view permissions via `can()` privilege checks.

### 6.3 Teacher Activity Ledger (*Relevé*)
* Tracks assigned subjects, weekly schedules, recorded instruction hours, grade entry compliance, and issued homework tasks per teacher.

---

# SECTION 7: SERVERLESS AUTOMATION ENGINE & AI INTEGRATION

```
+---------------------------------------------------------------------------------------+
|                     AUTOMATION & AI INTEGRATION ARCHITECTURE                          |
+---------------------------------------------------------------------------------------+
|  WORKFLOW AUTOMATION ENGINE:                                                          |
|  ├── Visual DAG Canvas Builder (Desktop Terminal Exclusive)                           |
|  └── Serverless Execution Runtime: 24/7 Supabase Edge Functions (Deno / TypeScript)  |
+---------------------------------------------------------------------------------------+
                                         |
                                         v
|  AI ENGINE INTEGRATION:                                                               |
|  ├── Primary Engine: Groq LPU API (High-speed model inference / Free Tier)            |
|  ├── Multi-Model Gateway: OpenRouter API                                              |
|  └── Configuration: Bring Your Own Key (BYOK) settings in Administration Panel        |
+---------------------------------------------------------------------------------------+
|  AI CAPABILITIES: Auto Report Summaries | Administrative Drafting | Expense Anomaly Check |
+---------------------------------------------------------------------------------------+
```

### 7.1 Serverless Workflow Automation (Edge Functions)
* **Visual Graph Builder (Desktop Only):** Node-based visual flowchart canvas allowing admins to construct automation scenarios by linking **Triggers**, **Conditions**, **Actions**, **Delays**, and **Transforms**.
* **24/7 Background Execution:** Workflows deploy to **Supabase Edge Functions**, executing continuously in the background independent of active client desktop or mobile app sessions.

### 7.2 Artificial Intelligence Integration (Groq & OpenRouter)
* **Groq LPU Integration:** Uses the **Groq API** (Groq with a "Q", leveraging ultra-fast LPU hardware on their free tier) for high-speed reasoning, data analysis, and text generation.
* **OpenRouter Fallback Gateway:** Integrated with OpenRouter API for multi-model access.
* **Bring Your Own Key (BYOK):** System includes default keys for baseline operation while allowing institutions to input custom Groq or OpenRouter API keys in Settings.
* **Embedded AI Functions:**
  1. *Report Card Narrative Generator:* Synthesizes numerical grades, attendance rates, and teacher observations into qualitative report card narratives.
  2. *Administrative Drafting Assistant:* Drafts formal parent notices, convocations, and announcements based on bulleted key points.
  3. *Expense Anomaly Detector:* Scans Tier-1 expense requests and vendor receipt descriptions to flag duplicate requests, missing documentation, or budget overruns.

---

# SECTION 8: DATA GOVERNANCE, BACKUPS & DEPRECATIONS

```
+---------------------------------------------------------------------------------------+
|                             DATA ARCHIVING INFRASTRUCTURE                             |
+---------------------------------------------------------------------------------------+
|   PRIMARY DATABASE HUB (Supabase Cloud PostgreSQL)                                    |
|   ├── Real-time Operations, Multi-tenant Isolation & RLS                              |
|   └── Client Web Portal Backend Data                                                  |
+---------------------------------------------------------------------------------------+
                                         |
                                         | Automated 24-Hour Extraction Cron
                                         v
+---------------------------------------------------------------------------------------+
|   DESKTOP MASTER ENGINE (Local Administrative Terminal)                               |
|   ├── Fetches full DB dump & cloud media assets                                       |
|   ├── Applies AES-256 Encryption                                                      |
|   └── Writes versioned archives to Local External Vault / Offsite Storage             |
+---------------------------------------------------------------------------------------+
                                         |
                                         v
+---------------------------------------------------------------------------------------+
|   MOBILE APP RULE: ZERO BACKUP OPERATIONS OR LOCAL FILE DUMPS ON MOBILE               |
+---------------------------------------------------------------------------------------+
```

### 8.1 24-Hour Automated Backup Vault (Desktop Driven)
* **Storage Isolation:** Backups are **strictly prohibited** from residing within the production Supabase instance to prevent storage bloat and protect against cloud outages.
* **Execution Node:** Backup compilation routines run automatically every 24 hours driven by the **Desktop Terminal**.
* **Archive Encryption:** Compresses and encrypts full database dumps, audit logs, and media assets (receipt photos, check scans) using **AES-256** prior to disk write. Archives are stored on a local external server or secondary offsite vault with a 365-day rolling retention window.

### 8.2 Mobile Storage Safeguards
* **Zero Local Mobile Backups:** The Staff Android Mobile App **is explicitly forbidden from generating, downloading, or storing local database dumps or backup archives**.
* All mobile operations interact directly with Supabase via authenticated REST/gRPC API calls. Camera images stream directly to private cloud storage buckets without remaining in the mobile device's public media gallery.

### 8.3 Absolute Excel Engine Deprecation
* The embedded Excel formula parser, cell-matching engine, `Devis` quote block reproduction, and column-AM comment parsers are **100% deprecated and purged**.
* **Excel Role:** Strictly restricted to a two-way data bridge:
  1. *Import Students:* Parsing `.xlsx` roster files to bulk-register students and parents on Desktop.
  2. *Export Data:* Generating `.xlsx` or `.csv` files for financial and administrative reports on Desktop.

### 8.4 Legacy Feature Removals
The following legacy structures are **permanently deprecated and purged**:
1. **Fee Templates Module:** Completely removed. Billing is driven via dynamic service enrollment logic.
2. **Scholarship System:** Completely removed. Financial relief is managed exclusively through audited Discretionary Account Balance Adjustments.

---

# SECTION 9: VERIFICATION & ARCHITECTURAL MATRIX

```
                             SYSTEM PARITY & CAPABILITY MATRIX

    MODULE / FEATURE           DESKTOP TERMINAL   STAFF ANDROID APP   CLIENT WEB PORTAL
    ----------------------------------------------------------------------------------
    Target Audience            Internal Staff     Internal Staff      Parents & Students
    Native App Delivery        Electron Desktop   Android Native App  Browser Web Portal
    Data Read Parity           100% Full Scope    100% Full Scope     Scoped (Own Kids Only)
    Parent-Child Linking       1 -> N Children    1 -> N Children     Single Family View
    Batch Student Creation     Dynamic 1->N Form  Dynamic 1->N Form   Disabled
    Classroom Attendance       Supported          Primary Roll Call   View Only
    Check/Receipt Scanner      File Upload        Camera Scan Native  View Only
    Two-Tier Expense Engine    Full Lifecycle     Full Lifecycle      Disabled
    Grade & Homework Push      Full Access        Full Access         View Only
    Absence Justification      Review & Approve   Review & Approve    Submit Justifications
    ----------------------------------------------------------------------------------
    Excel Student Import       Bridge Import Only DISABLED            DISABLED
    Data Report Exports        XLSX / CSV         Share PDF Only      Download Report Cards
    Visual Workflow Builder    DAG Canvas Editor  DISABLED            DISABLED
    Serverless Workflows       Edge Functions     Edge Functions      Edge Functions (24/7)
    AI Engine (Groq / OpenRouter) Full Capabilities Full Capabilities  Disabled
    24h AES-256 DB Backups     YES (Desktop Vault) STRICTLY PROHIBITED DISABLED

# Master System Requirements Specification (SRS) & Enterprise Technical Architecture Report

---

## EXECUTIVE SUMMARY & SYSTEM PARADIGM

This document serves as the absolute, definitive, and all-inclusive technical specification for the **Educational & Operational Management Platform**. It unifies every functional module, database schema rule, financial engine requirement, academic framework, mobile application workflow, UI/UX specification, and system security protocol into a single, cohesive engineering blueprint.

### Core Architectural Paradigms:
1. **Absolute Deprecation of Embedded Excel Engines:** All legacy spreadsheet calculation engines, cell-matching procedures, Devis quote sheet reproductions, formula evaluation mini-languages, and column-AM free-text comment parsers are **100% deprecated and purged**. Excel functions exclusively as an external data bridge for **Student Bulk Imports (`.xlsx`)** and **Data Exports (`.xlsx` / `.csv`)**. All business logic, billing schedules, quote blocks, and payment histories exist as native, structured relational data inside the central database.
2. **Unlimited Parent-Child Dynamic Linking ($1 \rightarrow N$ Children):** A Parent/Guardian profile can be linked to an **unlimited number ($N$) of dependent children**. The registration workflow dynamically scales from $1$ to $N$ student records within a single atomic database transaction.
3. **Platform Feature Parity Mandate:** The Staff Android Mobile App provides complete operational and data viewing parity with the Desktop Terminal. All profile information, academic records, financial ledgers, debt metrics, and administrative data viewable on Desktop **MUST** be accessible on Mobile in responsive, touch-optimized card and drawer layouts—excluding only features that are physically or ergonomically impossible on mobile devices (e.g., local backup disk writes, bulk file imports, and visual DAG node canvas editing).
4. **Platform Delivery & User Boundaries:**
   * **Clients (Parents & Students):** Restricted **EXCLUSIVELY to Web Portal Browsers** (responsive for desktop and mobile browsers). Clients do **not** have a native mobile app.
   * **Staff & Faculty (Admins, Teachers, Financial Officers, Support Staff):** Access via **Desktop Terminal** and **Staff Android Mobile App**.
   * **Mobile Backup Prohibition Safeguard:** The Staff Android Mobile App is **explicitly prohibited from generating, downloading, or storing local database backup files** to prevent phone storage overload and local file system security vulnerabilities.
5. **Serverless Background Automation:** All workflow automation routines execute 24/7 on **Supabase Edge Functions** (Deno/TypeScript runtime), guaranteeing continuous background execution independent of active Desktop or Mobile user sessions.
6. **Artificial Intelligence Engine:** Open architecture integrating **xAI Grok** and **OpenRouter** APIs operating on a Freemium / Bring-Your-Own-Key (BYOK) model.

---

# SECTION 1: SYSTEM ARCHITECTURE & PLATFORM DIVISION

```
+---------------------------------------------------------------------------------------+
|                               GLOBAL SYSTEM TOPOLOGY                                  |
+---------------------------------------------------------------------------------------+
|                               CENTRAL SUPABASE HUB                                    |
|         PostgreSQL Database  |  Supabase Auth / JWT  |  Supabase Edge Functions       |
+---------------------------------------------------------------------------------------+
                                           |
        +----------------------------------+----------------------------------+
        |                                  |                                  |
        v                                  v                                  v
+-----------------------+      +-----------------------+      +-----------------------+
|   DESKTOP TERMINAL    |      | STAFF ANDROID APP     |      |  CLIENT WEB PORTAL    |
| (Full Administrative) |      | (Mobile Operations)   |      |  (Web Browser Only)   |
+-----------------------+      +-----------------------+      +-----------------------+
| • 100% Operational    |      | • 100% Read Parity    |      | • Single Account /    |
|   Scope               |      | • Touch Operations    |      |   Multi-Child View    |
| • File System I/O     |      | • Camera Proof Scan   |      | • Academic Bulletins  |
| • Visual DAG Canvas   |      | • Native Push Notifs  |      | • Exam Timetables     |
| • 24h Encrypted Vault |      | • ZERO Local Backups  |      | • Absence Uploads     |
+-----------------------+      +-----------------------+      +-----------------------+
```

### 1.1 Complete Platform Feature Allocation Matrix

| Module / Feature | Desktop Terminal | Staff Android Mobile | Client Web Portal | Execution Scope & Technical Constraints |
| :--- | :---: | :---: | :---: | :--- |
| **Authentication & RBAC** | **Full** | **Full** | **Web OAuth** | Supabase Auth/JWT with role-based UI filtering. |
| **Parent-Child CRM ($1 \rightarrow N$)**| **Full** | **Full** | View Own | Dynamic $1 \rightarrow N$ batch creation on Desktop & Mobile. |
| **Student Profiles & Timelines**| **Full** | **Full** | View Own | Complete academic history, attendance, and billing logs. |
| **Attendance Roll Call** | **Full** | **Primary Tool** | View Own | Touch-optimized 30s roll calls with auto-absence triggers. |
| **Payment Entry & Collection** | **Full** | **Full** | View Dues | Counter payments with automatic invoice allocation. |
| **Check / Transfer Proof Scan**| File Upload | **Camera Native**| View Scans | Mobile uses Android Camera API to scan checks/slips. |
| **Installment Billing (*Tranches*)**| **Full** | **Full** | View Schedule | Multi-service installment schedules (Tuition, Transport, *Stages*, Clubs). |
| **Debt Dashboard & Rankings** | **Full** | **Full** | View Balance | Real-time school debt metrics, aging tiers, and debtor lists. |
| **Two-Tier Expense Requests** | **Full** | **Primary Tool**| **Disabled** | Staff create requests & scan receipts; managers approve. |
| **Grade Entry (*Devoir/Examen*)**| **Full** | **Full** | View Grades | Teachers input marks; system calculates averages & GPAs. |
| **Homework Push Engine** | **Full** | **Full** | View Tasks | Teachers post assignments with photos/attachments. |
| **Teacher Activity Log (*Relevé*)**| **Full** | **Full** | **Disabled** | Teachers log instruction hours and view assigned schedules. |
| **Notifications & System Alerts**| In-App Feed | **Push Notifs** | In-App Feed | Firebase Cloud Messaging (FCM) on Android devices. |
| **Audit Log Stream** | **Full** | **Full** | **Disabled** | Multi-column filterable audit stream showing JSON diffs. |
| **AI Assistant Integration** | **Full** | **Full** | **Disabled** | Grok/OpenRouter API integration for summaries and drafts. |
| **Automated Workflows (List/Run)**| **Full** | **Full** | **Disabled** | View active workflows, execution logs, and manual triggers. |
| **Visual Workflow DAG Editor** | **Full** | **Disabled** | **Disabled** | Drag-and-drop node graph canvas (Desktop terminal only). |
| **Student Excel Import (`.xlsx`)**| **Full** | **Disabled** | **Disabled** | Heavy binary parsing via `ExcelJS` (Desktop terminal only). |
| **Data Export Engine (XLSX/CSV)**| **Full** | Share PDF | PDF Download | System-wide report export generation (Desktop terminal only). |
| **AES-256 System DB Backups** | **Full** | **PROHIBITED** | **Disabled** | **Strict Rule:** Mobile has ZERO local database backups. |

---

# SECTION 2: USER INTERFACE (UI) & USER EXPERIENCE (UX) ARCHITECTURE

```
+---------------------------------------------------------------------------------------+
|                                 EL-IMTIYAZ COLOR PALETTE                              |
+---------------------------------------------------------------------------------------+
|  PRIMARY BLUE: #349bd4  |  DEEP BLUE: #2b7fb0    |  LIGHT BLUE: #6ec1e4              |
|  DARK BG: #242526       |  PANEL BG: #1e1f20     |  ELEVATED BG: #2a2b2d             |
|  OFF-WHITE: #eff2f3     |  WARM ACCENT: #c8a98c  |  SLATE GRAY: #3b464c              |
|  SUCCESS: #3fa66e       |  WARNING: #c8a98c      |  DANGER: #c0504d                  |
+---------------------------------------------------------------------------------------+
```

### 2.1 Academic Brand Identity & Visual Language
* **Design Philosophy:** Modern, high-contrast, professional, and dark-themed academic design system optimized for long operational hours.
* **Color Tokens & Constants:**
  * **Primary Brand Colors:** Primary Blue (`#349bd4` / `rgb(52, 155, 212)`), Deep Blue (`#2b7fb0` / `rgb(43, 127, 176)`), Light Blue/Cyan Glow (`#6ec1e4`).
  * **Neutral Surfaces:** Dark Background (`#242526`), Panel Background (`#1e1f20`), Elevated Surface (`#2a2b2d`), Slate Gray (`#3b464c`), Off-White Text (`#eff2f3`).
  * **Accents & Indicators:** Warm Gold Accent (`#c8a98c`), Muted Brown (`#836c68`), Success Green (`#3fa66e`), Warning Gold (`#c8a98c`), Danger Red (`#c0504d`).
* **Typography:** Primary font family `Inter` (with Arabic language fallbacks `Noto Sans Arabic`), Monospace font `JetBrains Mono` for IDs, currency amounts, codes, and audit diffs.

```
+---------------------------------------------------------------------------------------+
|                           DESKTOP TERMINAL LAYOUT STRUCTURE                           |
+---------------------------------------------------------------------------------------+
| PERMANENT SIDEBAR |  TOPBAR: Global Search, Quick Actions, System Status, Profile     |
| (4 Consolidated   +-------------------------------------------------------------------+
|  Primary Hubs)    |  TAB NAVIGATION BAR (Contextual tabs within active Hub)           |
|                   +-------------------------------------------------------------------+
|                   |  WORKSPACE CANVAS                                                 |
|                   |  • Primary Data Grids with sort/filter controls                   |
|                   |  • Inline Split-Views (List on left, Detail panel on right)       |
|                   |  • Large Focus Modals for multi-step creation workflows           |
+---------------------------------------------------------------------------------------+
```

### 2.2 Desktop Terminal UI/UX Architecture
* **Permanent Sidebar Navigation:** A permanent, collapsible sidebar containing **4 Consolidated UI Hubs**:
  1. **Hub 1: Dashboard, Notifications, Reports & Analytics Workspace.**
  2. **Hub 2: Financial Portal (Payments, Receipts, Debt Dashboard, & Installments).**
  3. **Hub 3: Relationship Portal (Unified Parents & Students Directory, $1 \rightarrow N$ Batch Creation).**
  4. **Hub 4: Academic Management (*Scolarité* Grade Levels, Extracurricular Clubs, & Class Rosters).**
* **Tabbed Interface Sub-Navigation:** Selecting a main Hub loads a secondary tab bar at the top of the workspace. Each tab is dedicated to an individual feature or operational workflow, retaining scroll positions and filter states.
* **Focus Modals & Split-Views:**
  * Complex multi-step actions (such as the $1 \rightarrow N$ Parent-Student Batch Creation) open in large, centered focus modals on top of the workspace canvas.
  * Master-detail exploration (such as inspecting a Student profile or Parent account) uses an inline **Split-View** layout ($35\%$ master list on the left, $65\%$ detail panel on the right) or full-screen overlay drawers.

```
+---------------------------------------------------------------------------------------+
|                        ANDROID STAFF APP UI/UX ARCHITECTURE                           |
+---------------------------------------------------------------------------------------+
| TOP BAR           | Brand Logo, Search Icon, Real-time Sync Status, FCM Push Feed Icon |
+-------------------+-------------------------------------------------------------------+
| CONTENT AREA      | • Vertical Card Streams with high-contrast status pills           |
|                   | • Touch Targets minimum 48dp x 48dp                               |
|                   | • Bottom Sheet Drawers for fast detail view and quick editing     |
+-------------------+-------------------------------------------------------------------+
| BOTTOM NAV BAR    | [Dashboard] | [CRM Roster] | [Academics] | [Financials] | [Staff] |
+---------------------------------------------------------------------------------------+
```

### 2.3 Staff Android Mobile App UI/UX Architecture
* **Design Framework:** Synthesizes Android **Material 3** guidelines with the desktop visual identity, maintaining exact color token mapping (`#349bd4`, `#242526`, `#eff2f3`).
* **Touch-First Ergonomics:**
  * Minimum touch target size of **48dp x 48dp** for all buttons, status toggles, and form inputs.
  * Bottom Navigation Bar featuring **5 Primary Operational Icons**: **Dashboard**, **CRM/Roster**, **Academics**, **Financials**, and **Staff/Personnel**.
* **Card-Based Data Presentations:** Multi-column desktop tables convert into vertical card feeds on mobile. Each card features:
  * Primary title in bold off-white text (`#eff2f3`).
  * Color-coded status badge pills (`PAID`, `OVERDUE`, `ABSENT`, `PRESENT`).
  * Quick-action buttons (e.g., **One-Tap Dial `tel:`**, **WhatsApp Direct Chat**, **Scan Check Camera Action**).
* **Bottom Sheet Drawers:** Tapping a card slides up a bottom sheet drawer containing full detail records, financial breakdown trees, or student document lists, preserving context behind translucent backdrops.

---

# SECTION 3: SECURITY, AUDIT TRAIL, DATA GOVERNANCE & BACKUPS

### 3.1 Universal Action Traceability & Contextual Audit Logging
* **User Identity Binding:** Anonymous operations are strictly impossible. Every database mutation (Create, Update, Delete), authentication event, document export, and setting change is logged and tied directly to the active User ID (`UUID`).
* **Contextual Audit Schema:** Audit log entries are append-only records containing:
  * `timestamp`: High-precision UTC timestamp (`YYYY-MM-DD HH:MM:SS.sss`).
  * `actor_id` & `actor_name`: Identity of the performing user.
  * `role`: User role and permissions active at execution time.
  * `action`: Action string (e.g., `student.created`, `payment.recorded`, `expense.approved`).
  * `entity_type` & `entity_id`: Target entity details.
  * `before_json` & `after_json`: Complete JSON snapshots recording state deltas.
  * `session_telemetry`: IP address, client device type (Desktop vs. Android Mobile), and session ID.
* **Audit Trail Placement:** Accessible directly within the **Settings** hub on Desktop and the **Personnel Tab** on Mobile, featuring multi-column filtering by user, action type, date range, and target entity.

### 3.2 Password Governance & Security Controls
* **Password Alteration Auditing:** Any credential change (self-service reset, administrative force-reset, or password update) triggers a high-priority security audit event logging the requester ID, executor ID, and timestamp.
* **Session Invalidations:** Modifying a password automatically revokes all active JWT tokens and terminates active sessions across all devices for that user account.

```
+---------------------------------------------------------------------------------------+
|                          24-HOUR AUTOMATED BACKUP ARCHITECTURE                        |
+---------------------------------------------------------------------------------------+
|  PRIMARY DATABASE HUB (Supabase Cloud PostgreSQL)                                     |
|  └── Real-time transaction processing & RLS multi-tenant security                     |
+---------------------------------------------------------------------------------------+
                                           |
                                           | Automated Daily Cron (24 Hours)
                                           v
+---------------------------------------------------------------------------------------+
|  DESKTOP TERMINAL MASTER ENGINE (Local Workstation Environment)                       |
|  ├── Extracts full PostgreSQL dump & media assets                                     |
|  ├── Applies AES-256 Encryption                                                       |
|  └── Writes compressed archive (`backup-YYYY-MM-DD-HHMMSS.db`) to local/offsite vault |
+---------------------------------------------------------------------------------------+
                                           |
                                           v
+---------------------------------------------------------------------------------------+
|  SAFEGUARD ENFORCEMENT: ZERO BACKUP OPERATIONS OR DISK WRITES ON MOBILE ANDROID APPS   |
+---------------------------------------------------------------------------------------+
```

### 3.3 24-Hour Automated AES-256 Backup Vault & Disaster Recovery
* **Offsite Backups Isolation:** To protect against Supabase platform downtime or free-tier constraints, **backups must never reside inside the primary Supabase instance**.
* **Daily Execution Cycle:** An automated daemon running on the Desktop Master Terminal executes a full system backup every **24 hours**.
* **Backup Scope:** The backup payload captures:
  1. Complete PostgreSQL database dump (schema, tables, views, procedures).
  2. System configuration state and workflow schemas.
  3. All secure media bucket assets (scanned checks, payment proof images, vendor receipts, uploaded documents).
* **Encryption & Retention:** Archives are compressed and encrypted at rest using **AES-256** standards before writing to a local external disk or secondary offsite vault. Point-in-time versioning allows full restoration to any 24-hour snapshot over a rolling 365-day retention window.

### 3.4 Strict Mobile Backup Prohibition Safeguard
* **Prohibition Rule:** The Staff Android Mobile App **is strictly prohibited from running backup operations or storing backup dumps on phone storage**.
* **Rationale:** Mobile storage limits, file fragmentation, and security risks associated with mobile local file systems. Mobile apps interact with data strictly through secure API calls to Supabase.

---

# SECTION 4: PARENT-CHILD CRM & DYNAMIC $1 \rightarrow N$ BATCH REGISTRATION

```
+---------------------------------------------------------------------------------------+
|                    DYNAMIC $1 \rightarrow N$ BATCH REGISTRATION WORKFLOW               |
+---------------------------------------------------------------------------------------+
| STEP 1: Enter Parent Master Information (Name, Phone, Email, National ID, Address)    |
+---------------------------------------------------------------------------------------+
                                           |
                                           v
| STEP 2: Dynamically Append Children Records (No upper limit):                         |
|   [+ Add Child 1 Block] --> First/Last Name, DOB, Gender, Grade/Class, Services       |
|   [+ Add Child 2 Block] --> First/Last Name, DOB, Gender, Grade/Class, Services       |
|   [+ Add Child N... Block] (Unlimited additions)                                      |
+---------------------------------------------------------------------------------------+
                                           |
                                           v
| STEP 3: Configure Service Billing, Installment Schedules & Discounts per Child       |
+---------------------------------------------------------------------------------------+
                                           |
                                           v
| STEP 4: Submit Transaction -> Atomic Database Write (Parent + N Student Entities)    |
+---------------------------------------------------------------------------------------+
```

### 4.1 Relational Architecture & Entity Dependencies
* **Parent-First Precondition:** In the relational schema, a Student record cannot exist without an associated guardian. A valid Foreign Key (`parent_id` or `parent_student_links` junction) referencing a verified Parent entity is mandatory upon Student creation.
* **Unlimited $1 \rightarrow N$ Child Cardinality:** A single Parent entity can be linked to an **unlimited number ($N$) of dependent children**. The previous 4-child cap is completely eliminated.

### 4.2 Dynamic Unlimited Batch Student Creation Workflow
* **Single Form Transaction:** Staff can create a Parent profile and register $1 \dots N$ dependent children in a single, continuous workflow on Desktop or Mobile.
* **Form Structure:**
  * **Parent Data Block:** First Name, Last Name, Primary Phone Number, Alternate Phone Number, Email, National Identity Number, Physical Address, Occupation.
  * **Dynamic Children Repeater Blocks ($1 \dots N$ Students):**
    * Student First Name, Middle Name, Last Name.
    * Date of Birth & Gender.
    * Assigned Academic Level & Class (*Scolarité* grade).
    * Enrolled Special Programs & Extracurricular Clubs.
    * Specific Service Enrollments (Transportation, Canteen, Psychotherapy, Speech Therapy / *Orthophonie*).
    * Applied Discretionary Account Adjustments / Balance Discounts.
* **Atomic Transaction Execution:** The batch submission executes inside a database transaction (`BEGIN...COMMIT`). If record creation fails for the $N$-th child, the entire operation (including Parent record creation) rolls back to ensure zero orphaned data.

### 4.3 Cross-Entity Bidirectional Navigation
* **From Parent Profile:** View linked children list ($N$ kids), cumulative family balance (sum of all children's dues), payment history, and used services.
* **From Student Profile:** View primary and secondary parent contact cards, individual student balance, grade books, attendance logs, and teacher observations.

---

# SECTION 5: ACADEMIC STRUCTURE, EVALUATION & BATCH PROGRESSION

```
                     +----------------------------------------+
                     |         ACADEMIC DOMAIN SPLIT          |
                     +-------------------+--------------------+
                                         |
             +---------------------------+---------------------------+
             |                                                       |
             v                                                       v
+--------------------------+                               +-------------------+
|  CORE ACADEMICS          |                               |  EXTRACURRICULAR  |
|  (Scolarité)             |                               |  CLUBS            |
+--------------------------+                               +-------------------+
| • Primary (Primaire - 5y)|                               | • Chess Club      |
| • Middle (CEM - 4y)      |                               | • English Club    |
| • High (Lycée - 3y)      |                               | • Sports & Arts   |
| • Coefficient Grading    |                               | • Flat / Session  |
| • Automatic Promotion    |                               |   Billing         |
+--------------------------+                               +-------------------+
```

### 5.1 Academic Domain Division
* **Core Academics (*Scolarité*):** Governed by institutional educational standards, structured grade progression rules, coefficient-weighted grading, and formal year-end promotion logic.
* **Extracurricular Clubs:** Governed by flexible enrollment, optional participation, fixed or session-based fees, operating independently from academic promotion logic.

### 5.2 Multi-Level Educational Structure (*Scolarité*)
The system supports the 3-tier national education hierarchy:
1. **Primary School (*Primaire*):** 5-Year Curriculum Cycle (Grade 1 through Grade 5).
2. **Middle School (*CEM - Collège*):** 4-Year Curriculum Cycle (Year 1 through Year 4).
3. **High School (*Lycée*):** 3-Year Curriculum Cycle (Year 1 through Year 3 / Streams).

### 5.3 Grading Engine, Coefficients, & Assessment Formulas
* **Term Assessment Inputs:** Standardized term evaluations per subject:
  1. **Test 1 (*Devoir 1*):** Score out of 20.
  2. **Test 2 (*Devoir 2*):** Score out of 20.
  3. **Final Exam (*Examen*):** Score out of 20.
* **Weighted Subject Grade Calculation:**
  $$\text{Subject Average} = \frac{\text{Devoir 1} + \text{Devoir 2} + (\text{Examen} \times 2)}{4}$$
* **Overall Overall GPA (Yearly Average) Calculation:**
  $$\text{Overall GPA} = \frac{\sum (\text{Subject Average} \times \text{Subject Coefficient})}{\sum \text{Subject Coefficients}}$$

### 5.4 One-Click Batch Academic Progression Engine
1. **Automated Evaluation:** At the end of the academic year, the system calculates final GPAs for all enrolled students against the configured passing threshold (e.g., $10.00 / 20.00$).
2. **Queue Generation:** System flags profiles as `APPROVED_FOR_PROMOTION` ($\text{GPA} \ge \text{Threshold}$) or `RETAINED_SAME_YEAR` ($\text{GPA} < \text{Threshold}$).
3. **One-Click Execution:** Administrators review the queue, apply manual overrides if necessary, and click **"Execute Batch Promotion"**. The system advances approved students to the next grade level, updates class rosters, and archives completed report cards to permanent student histories.

### 5.5 Homework Assignment & Portal Push Engine
* **Teacher Assignment Creation:** Teachers create homework tasks specifying Subject, Target Class, Description, Due Date, and optional photo/PDF attachments.
* **Automated Portal Push:** Saving an assignment pushes the task directly to the Student Web Portal for all enrolled students in that class, triggering push notifications to parents.

---

# SECTION 6: FINANCIAL ENGINE, INSTALLMENTS & EXPENSE WORKFLOWS

### 6.1 Payment Processing & Verification Attachments
* **Supported Payment Methods:**
  * **Cash (*Espèces*):** Direct counter collection.
  * **Bank Check (*Chèque*):** Captures Check Number, Bank Name, Issue Date, and Clearance Date.
  * **Bank Transfer (*Virement*):** Captures Transaction Reference ID and Source Bank.
* **Mandatory Attachment for Non-Cash:** File upload (Desktop) or camera scan (Mobile) is mandatory for checks and bank transfers, along with structured notes/remarks (e.g., "Check deposited - pending clearance").
* **Payment Statuses:** `PAID`, `UNPAID`, `PENDING`.

```
+---------------------------------------------------------------------------------------+
|                    INSTALLMENT MODULE (Paiement par Tranche)                          |
+---------------------------------------------------------------------------------------+
| SERVICE CATEGORY      | INSTALLMENT STRUCTURE (*Tranches*)                            |
+-----------------------+---------------------------------------------------------------+
| Transportation Fees   | Multi-part seasonal or term installments (T1, T2, T3)         |
| Training (*Stages*)   | Milestone-based payment schedules                             |
| Extracurricular Clubs | Term-based or activity-based installment blocks               |
| Core Tuition Fees     | Standard annual/term/monthly installment schedules            |
+-----------------------+---------------------------------------------------------------+
| UPFRONT SETTLEMENT    | Option to bypass installments for immediate 100% full payment  |
+---------------------------------------------------------------------------------------+
```

### 6.2 Multi-Service Installment Engine (*Paiement par Tranche*)
* **Service Scope:** Installment billing schedules can be established across distinct categories: **Transportation Fees**, **Training Programs (*Stages*)**, **Extracurricular Clubs**, and **Core Tuition**.
* **Schedule Engine:** Tracks installment due dates, paid amounts per tranche, and remaining unpaid principal. Provides automated alerts on upcoming or overdue installment dates.
* **Direct Upfront Payment:** Supports 100% upfront settlement for any service, bypassing installment schedules.

### 6.3 Discretionary Financial Adjustments & Account Discounts
* **Direct Balance Discounts:** Administrators can apply approved financial adjustments directly to a student's billing record.
* **Audit Requirement:** Every discount requires selecting an approval reason code and logging an administrative note, fully audited under the admin's identity.

### 6.4 Automated PDF Receipt Generation
Upon recording a payment, the system generates official PDF receipts with two formatting options:
1. **Recent Payment Receipt:** Captures *only* the immediate completed transaction (Amount Paid, Payment Method, Date, Receipt ID, Billed Services).
2. **Full Account Statement / Balance Sheet:** Details complete historical payment ledgers, enrolled services, cumulative total paid, and net balance due.

```
+---------------------------------------------------------------------------------------+
|                        TWO-TIER EXPENSE APPROVAL LIFECYCLE                            |
+---------------------------------------------------------------------------------------+
| STEP 1: REQUEST INITIATION (Staff Mobile App / Desktop Terminal)                      |
| • Staff inputs title, category, requested amount, justification -> Status: PENDING    |
+---------------------------------------------------------------------------------------+
                                           |
                                           v
| STEP 2: FINANCIAL AUTHORIZATION (Financial Officer / Admin)                           |
| • Manager reviews request -> Approves & releases funds -> Status: APPROVED_FUNDS      |
+---------------------------------------------------------------------------------------+
                                           |
                                           v
| STEP 3: PROOF-OF-PURCHASE SETTLEMENT (Requesting Staff Member)                       |
| • Staff photographs physical vendor receipt using Android Mobile Camera               |
| • Uploads photo & inputs final spent amount -> Status: SETTLED_AND_CLOSED             |
+---------------------------------------------------------------------------------------+
```

### 6.5 Two-Tier Outgoing Expense & Approval Workflow
1. **Tier 1 (Initiation):** Staff creates an expense ticket entering title, category, requested amount, justification, and initial status `PENDING_APPROVAL`.
2. **Tier 2 (Authorization & Disbursement):** Financial officer reviews and approves request (`APPROVED_FUNDS_RELEASED`), authorizing fund release.
3. **Proof Settlement:** Requesting staff completes the field transaction, uses the Android Mobile App camera to photograph the vendor receipt, enters final spent amount, and updates ticket status to `SETTLED_AND_CLOSED`.

---

# SECTION 7: HUMAN RESOURCES & FACULTY MANAGEMENT

### 7.1 Unified Staff Directory ("Personnel" Space)
* Centralized module managing all employee profiles: Administrative Staff, Teaching Faculty (*Enseignants*), Support/Maintenance Personnel, and Medical/Therapy Personnel (Speech Therapists / *Orthophonistes*, Psychologists).
* Configures Role-Based Access Control (RBAC) privileges across Desktop and Mobile platforms.

### 7.2 Teacher Activity Ledger (*Relevé*)
* Tracks teacher subject assignments, class schedules, completed instruction hours, assigned homework logs, and grade entry compliance.

---

# SECTION 8: CLIENT WEB PORTAL SPECIFICATION (WEB-ONLY CLIENT ACCESS)

Clients (Parents and Students) access system services **EXCLUSIVELY via responsive Web Browsers**.

```
+---------------------------------------------------------------------------------------+
|                           CLIENT WEB PORTAL CAPABILITIES                              |
+---------------------------------------------------------------------------------------+
| • Google / Gmail OAuth Authentication + 6-7 Digit Family Link Code Activation         |
| • Single Dashboard managing all N linked children without switching logins            |
| • Live Academic Grade Books, Subject Averages, GPAs, and PDF Report Cards (Bulletins) |
| • Complete Exam Timetables (Dates, Times, Room Numbers, Invigilators)                 |
| • Absence Justifications (Text explanations, File uploads, Cloud Drive Links)         |
| • Staff Convocations & Official Administrative Notices with Reply Messaging           |
| • Financial Ledger, Enrolled Services, Paid Balances, and Upcoming Installment Dates  |
+---------------------------------------------------------------------------------------+
```

### 8.1 Account Activation Protocol
1. Office staff registers the family and issues a unique **6-to-7 digit numeric activation code** (or QR code).
2. Parent opens Web Portal browser and logs in via Google/Gmail OAuth.
3. Parent inputs the activation code.
4. Server validates code and permanently links parent user ID (`auth.uid`) to the master Parent profile and all linked Student records.

---

# SECTION 9: SERVERLESS WORKFLOW AUTOMATION ENGINE (EDGE FUNCTIONS)

```
+---------------------------------------------------------------------------------------+
|                           BACKGROUND AUTOMATION ENGINE                                |
+---------------------------------------------------------------------------------------+
|  VISUAL DAG CANVAS (Desktop Only)  -->  BUILD & DEPLOY TO EDGE FUNCTIONS              |
+---------------------------------------------------------------------------------------+
                                           |
                                           v
|  SUPABASE EDGE FUNCTIONS (Deno Runtime - 24/7 Execution)                              |
|  ├── [TRIGGER NODE]   --> Time (Cron) or State Event (Payment Overdue, Absence Logged)|
|  ├── [CONDITION NODE] --> Boolean Logic Trees (AND/OR, Debt Thresholds, Status Match) |
|  └── [ACTION NODE]    --> Dispatch Emails, Push Notifs, Lock Access, Audit Log        |
+---------------------------------------------------------------------------------------+
```

### 9.1 Architecture & Infrastructure
* **Runtime:** Executed on **Supabase Edge Functions** (built on Deno/TypeScript execution nodes) guaranteeing zero reliance on local device uptime.
* **Visual Graph Engine:** Built and modified on Desktop using a node-based visual flowchart canvas (Triggers $\rightarrow$ Conditions $\rightarrow$ Actions).

### 9.2 Trigger Types & Actions
* **Automated Event Triggers:** Time-based daily cron jobs (e.g., installment reminders at 08:00 AM) and state-change database events (e.g., absence count $\ge 3$, payment status = `UNPAID`).
* **Manual Action Triggers:** One-click administrative execution triggers (e.g., "Broadcast Payment Reminders", "Execute Year-End Batch Promotion").
* **Executed Actions:** Dispatches automated emails (Resend API), triggers Android push notifications, locks portal accounts, or writes to audit logs.

---

# SECTION 10: ARTIFICIAL INTELLIGENCE INTEGRATION (GROK & OPENROUTER)

### 10.1 AI Engine Providers & BYOK Architecture
* **Primary AI Engine:** **xAI Grok API** (high-speed reasoning & data extraction).
* **Multi-Model Gateway:** **OpenRouter API** (fallback routing to diverse LLM models).
* **Freemium & BYOK Model:** Default tier provides baseline rate-limited access using embedded keys. Institutions can configure custom API keys in **Settings** for unlimited model processing.

### 10.2 Native AI Use Cases
1. **Automated Academic Summary Generation:** Synthesizes numerical grades, attendance records, and teacher notes into narrative report card summaries.
2. **Smart Administrative Drafting:** Assists staff in drafting formal convocations, parent alerts, and policy notices.
3. **Expense Anomaly Detection:** Scans vendor receipt descriptions and amounts during Tier-1 expense submissions to flag potential duplicates or overruns.

---

# SECTION 11: DASHBOARD ANALYTICS & BUSINESS INTELLIGENCE

Located at the bottom of the main Dashboard page with an expandable **"See Details"** modal interface:
* **Revenue Metrics Engine:** Gross monthly/annual revenue trends, collection rate percentages (% billed vs % collected), and cumulative outstanding debt totals.
* **Department & Category Breakdown:** Financial breakdowns isolating income from Core Academics (*Scolarité*), Speech Therapy (*Orthophonie*), Psychology, Extracurricular Clubs (Chess, English, Sports), and Auxiliary Services (Transport, Canteen).
* **Demographic Data Visualizations:** Interactive bar charts displaying student count distribution across grade levels and classes (e.g., 20 students in Grade 1, 15 in Grade 2).

---

# SECTION 12: DATA BRIDGE SPECIFICATION & EXCEL ENGINE DEPRECATION

### 12.1 Absolute Deprecation of Legacy Excel Engine
* All in-app spreadsheet evaluation logic, cell parsers, Devis quote sheets, formula rule engines, and column-AM comment parsers are **completely removed**.
* All financial accounting, billing schedules, and history exist strictly in structured Supabase database tables (`payments`, `invoices`, `parents`, `students`).

### 12.2 Student Bulk Import Pipeline
* **Desktop Terminal Bridge:** Staff selects a local `.xlsx` file using the OS file picker.
* **Parsing Engine:** `ExcelJS` parses raw row data and maps headers to database attributes (Student Name, Parent Contact, DOB, Class Level).
* **Validation & Insertion:** Validates required fields, checks for duplicate codes, and bulk-inserts Parent and Student entities inside an atomic transaction.

### 12.3 System Report Export Engine
* **Desktop Export Engine:** Generates clean multi-sheet `.xlsx` workbooks and itemized `.csv` files for external reporting (Revenue Summaries, Outstanding Debt Lists, Class Rosters).

---

# SECTION 13: SYSTEM DEPRECATIONS & PURGED STRUCTURES

The following legacy structures are **permanently deprecated and purged from the system**:
1. **Embedded Excel Calculation Engine:** Cell formulas, Devis sheets, and column AM text comment parsers are completely removed.
2. **Fee Templates Module:** Purged. Pricing is managed via dynamic service enrollment logic.
3. **Scholarship System:** Purged. Financial relief is managed exclusively through audited Discretionary Account Balance Adjustments.

---

# SECTION 14: SYSTEM VERIFICATION MATRIX

| Functional Module | Desktop Scope | Mobile Android Scope | Client Web Portal | Core Execution Mandate |
| :--- | :--- | :--- | :--- | :--- |
| **Client Web Portal** | **Disabled** | **Disabled** | **Primary (Web Only)**| Browser access for Parents & Students only. |
| **Staff Mobile App** | **Disabled** | **Primary (Android)** | **Disabled** | Touch-optimized tool for internal staff. |
| **Mobile Backups** | **Disabled** | **STRICTLY PROHIBITED**| **Disabled** | **ZERO local backup files stored on Mobile.** |
| **Parent Authentication**| **Admin Entry**| **Admin Entry** | **OAuth + Link Code**| Google OAuth + 6-7 Digit Link Code. |
| **Workflow Engine** | **DAG Canvas** | **View / Run** | **Disabled** | 24/7 execution via Supabase Edge Functions. |
| **AI Capabilities** | **Full** | **Full** | **Disabled** | xAI Grok & OpenRouter APIs with BYOK config. |
| **Expense Workflow** | **Full** | **Camera Scan & Approve**| **Disabled** | 2-Tier approval with mandatory receipt photo. |
| **Academic Progression**| **1-Click Batch**| **Trigger Action** | **View Bulletins** | GPA-based batch student promotion engine. |
| **System Backups** | **24h Vault Engine**| **STRICTLY PROHIBITED**| **Disabled** | Daily automated AES-256 encrypted archives. |
