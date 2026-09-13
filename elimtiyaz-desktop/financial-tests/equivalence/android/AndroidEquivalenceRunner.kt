package com.example.equivalence

import com.example.core.*
import com.example.core.LedgerEntry
import com.example.core.LedgerEntryType
import com.example.core.LedgerSourceType
import com.example.core.PaymentCategory
import com.example.core.PaymentMethod
import com.example.core.PaymentStatus
import com.example.core.PaymentPlan
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import java.io.File
import java.time.Instant

/**
 * Cross-Platform Equivalence Test Runner — Android (Kotlin).
 *
 * Reads the SAME canonical JSON scenarios as the desktop and backend runners,
 * runs each through the Android's canonical financial + academic engine
 * (`LedgerEngine`, `WaterfallAllocation`, `DiscountEngine`, `Reconcile`,
 * `Pricing`), captures the complete domain result, and writes a normalized
 * JSON result file to `results/android/<scenario_id>.json`.
 *
 * The comparator (`comparison/triple_comparator.ts`) then compares the three
 * result sets.
 *
 * All monetary values are in CENTIMES (Long) — the Android engine's native
 * representation.
 *
 * TIER 4 FIX — this runner previously defined its own local
 * `WaterfallInstallment` (String-typed `category`) and passed a String
 * `categoryFilter` into the core engine, whose real signatures are typed
 * `(List<WaterfallInstallment>, Long, PaymentCategory?, PaymentStatus)`.
 * It did not compile against the current core (and `val when` / `List<...>`]
 * typos meant it had never compiled at all). It now maps canonical scenarios
 * onto the REAL core types.
 */
object AndroidEquivalenceRunner {

    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
    }

    // ───────────────────────────────────────────────────────────────────
    // JSON scenario DTOs — mirror the canonical schema exactly.
    // ───────────────────────────────────────────────────────────────────

    @Serializable
    data class CanonicalLedgerEntry(
        val id: String,
        val parentId: String,
        val studentId: String? = null,
        val category: String = "tuition",
        val amount: Long,
        val type: String,
        val sourceType: String = "bulk_import",
        val sourceId: String = "run-1",
        val method: String? = null,
        val receiptNumber: String? = null,
        val paymentStatus: String? = null,
        val reversesId: String? = null,
        val description: String = "",
        val actorId: String = "system",
        val actorName: String = "System",
        val at: String = "",
        val metadata: JsonObject? = null,
    )

    @Serializable
    data class CanonicalInstallment(
        val id: String,
        val parentId: String,
        val studentId: String? = null,
        val category: String = "tuition",
        val label: String = "",
        // T-341 (STATS-400): the canonical wave number — the executive
        // statistics group by it (never by label parsing).
        val trancheNumber: Int = 1,
        val amountDue: Long,
        val amountPaid: Long = 0,
        val amountPending: Long = 0,
        val dueDate: String,
        val paidDate: String? = null,
        val status: String,
    )

    @Serializable
    data class CanonicalPayment(
        val id: String,
        val parentId: String,
        val studentId: String? = null,
        val amount: Long,
        val method: String,
        val status: String,
        val category: String,
        val receiptNumber: String,
        val installmentId: String? = null,
        val collectedBy: String,
        val collectedAt: String,
    )

    @Serializable
    data class CanonicalScenario(
        val id: String,
        val description: String,
        val category: String,
        val tags: List<String> = emptyList(),
        val given: Given,
        val `when`: When,
        val then: JsonObject? = null,
    )

    @Serializable
    data class Given(
        val tenantId: String,
        val parent: Parent? = null,
        // T-341 (STATS-400): the executive corpus carries the FULL family
        // roster (the concentration derivation needs every parent's name).
        val parents: List<Parent> = emptyList(),
        val students: List<Student> = emptyList(),
        val ledgerEntries: List<CanonicalLedgerEntry> = emptyList(),
        val installments: List<CanonicalInstallment> = emptyList(),
        val payments: List<CanonicalPayment> = emptyList(),
        val academicYearStartYear: Int = 2025,
        // Academic / CRM extension fields.
        val assessment: CanonicalAssessment? = null,
        val assessments: List<CanonicalAssessment> = emptyList(),
        // PARITY-003/T-292: the classes rows for the demographics derivation.
        val classes: List<CanonicalClass> = emptyList(),
        // T-345 (MATIERE-500/ADR-018): the subject_configuration category.
        val recipe: CanonicalRecipe? = null,
        val subject: CanonicalSubject? = null,
        val configurations: List<CanonicalSubjectConfiguration> = emptyList(),
        val context: CanonicalResolveContext? = null,
    )

    @Serializable
    data class Parent(val id: String, val name: String)

    @Serializable
    data class Student(
        val id: String,
        val parentId: String,
        val gradeLevel: String,
        val paymentPlan: String = "tranches",
        // PARITY-003/T-292: the demographics projection fields.
        val gender: String = "",
        val birthDate: String? = null,
        val classId: String? = null,
        // T-341 (STATS-400): the transport town + the enrollment status —
        // the transport-yield + dynamics/radar derivations consume them.
        val transportTier: String? = null,
        val status: String = "active",
    )

    /** PARITY-003/T-292: the demographics classes row (grade_code is the
     * scenario JSON key — kotlinx serialization maps it via JsonNames). */
    @Serializable
    data class CanonicalClass(
        val id: String,
        val name: String,
        @kotlinx.serialization.SerialName("grade_code") val gradeCode: String? = null,
        val capacity: Int? = null,
        // T-341 (STATS-400): the section-imbalance inputs (enrolled counts
        // ARE the data — the capacity ceiling is DEAD per the kill list).
        val level: String = "primaire",
        val section: String = "A",
        val isActive: Boolean = true,
        val enrolledCount: Int = 0,
    )

    @Serializable
    data class When(
        val type: String,
        val accountId: String? = null,
        val parentId: String? = null,
        val paymentAmount: Long? = null,
        val category: String? = null,
        val paymentStatus: String? = null,
        val paymentId: String? = null,
        val reversalAmount: Long? = null,
        val originalWasPending: Boolean? = null,
        val discountParams: DiscountParams? = null,
        val includePayments: Boolean = false,
        val includeInstallments: Boolean = false,
        val includeParentSummaries: Boolean = false,
        val operations: List<Operation> = emptyList(),
        // ── Academic / CRM extensions ──
        val assessment: CanonicalAssessment? = null,
        val assessments: List<CanonicalAssessment> = emptyList(),
        // T-345 (MATIERE-500/ADR-018): the subject_configuration category —
        // the scenario-local overrides for the resolver + recipe ops.
        val recipe: CanonicalRecipe? = null,
        val subject: CanonicalSubject? = null,
        val configurations: List<CanonicalSubjectConfiguration> = emptyList(),
        val context: CanonicalResolveContext? = null,
        val gradeLevel: String? = null,
        val identity: CanonicalIdentity? = null,
        val year: Int? = null,
        val hashInput: String? = null,
        val studentStatus: String? = null,
        // PARITY-002/T-285: the pinned reference instant for the analytics op.
        val now: String? = null,
        // PARITY-003/T-292: the visual-parity op inputs (weekly rhythm +
        // heatmap window; the YoY current/previous monthly series).
        val range: CanonicalRange? = null,
        val currentRevenue: List<CanonicalRevenuePoint> = emptyList(),
        val previousRevenue: List<CanonicalRevenuePoint> = emptyList(),
        // T-341 (STATS-400): the executive-statistics op inputs — the
        // concentration top-N + the raw triple-risk vectors.
        val topN: Int = 10,
        val riskProfiles: List<CanonicalRiskProfile> = emptyList(),
    )

    /** T-341 (STATS-400): the corpus triple-risk vector (debtAmount in DZD —
     * the desktop op compares it against 25 000 directly). */
    @Serializable
    data class CanonicalRiskProfile(
        val gpa: Double? = null,
        val unexcusedAbsences: Int = 0,
        val attendanceRate: Double = 1.0,
        val debtAmount: Long = 0L,
    )

    @Serializable
    data class CanonicalRange(val from: String, val to: String)

    @Serializable
    data class CanonicalRevenuePoint(
        val label: String,
        @kotlinx.serialization.SerialName("amountDzd") val amountDzd: Long,
    )

    @Serializable
    data class CanonicalAssessment(
        val devoir1: Double? = null,
        val devoir2: Double? = null,
        val examen: Double? = null,
        // T-345 (MATIERE-500/ADR-018): the contrôle-continu mark.
        val cc: Double? = null,
        val subjectAverage: Double? = null,
        val coefficient: Double = 1.0,
        val isExtracurricular: Boolean = false,
    )

    @Serializable
    data class CanonicalRecipe(
        val devoir1: Double = 1.0,
        val devoir2: Double = 1.0,
        val examen: Double = 2.0,
        val cc: Double = 0.0,
    )

    @Serializable
    data class CanonicalSubject(
        val id: String = "",
        val code: String? = null,
        val coefficient: Double? = null,
        val passingGrade: Double? = null,
        val isExtracurricular: Boolean? = null,
    )

    @Serializable
    data class CanonicalSubjectConfiguration(
        val subjectId: String,
        val academicYearId: String,
        val academicLevelId: String,
        val direction: String = "general",
        val coefficient: Double,
        val subjectCode: String? = null,
        val passingGrade: Double? = null,
        val isExtracurricular: Boolean? = null,
        val gradingRecipe: CanonicalRecipe? = null,
        val isActive: Boolean = true,
    )

    @Serializable
    data class CanonicalResolveContext(
        val academicLevelId: String? = null,
        val academicYearId: String? = null,
        val direction: String? = null,
        val snapshot: CanonicalSnapshot? = null,
    )

    @Serializable
    data class CanonicalSnapshot(
        val coefficient: Double? = null,
        val coefficientDevoir1: Double? = null,
        val coefficientDevoir2: Double? = null,
        val coefficientExamen: Double? = null,
        val coefficientCc: Double? = null,
    )

    @Serializable
    data class CanonicalIdentity(
        val phone: String? = null,
        val displayName: String? = null,
        val firstName: String? = null,
        val lastName: String? = null,
    )

    @Serializable
    data class DiscountParams(
        val grossTuition: Long,
        val previousGradeLevel: String? = null,
        val currentGradeLevel: String,
        val childIndex: Int,
        val paymentPlan: String,
        val paymentDate: String,
        val academicYearStartYear: Int,
        val academicYearStart: String,
        val enrollmentDate: String,
        val previousRank: Int? = null,
        val siblingPerChildAmount: Long? = null,
    )

    @Serializable
    data class Operation(
        val type: String,
        val paymentAmount: Long? = null,
        val category: String? = null,
        val paymentStatus: String? = null,
        val paymentId: String? = null,
        val reversalAmount: Long? = null,
        val originalWasPending: Boolean? = null,
    )

    // ───────────────────────────────────────────────────────────────────
    // Conversions — canonical JSON (centimes) ↔ Android domain (centimes).
    // ───────────────────────────────────────────────────────────────────

    private fun toDomainEntry(e: CanonicalLedgerEntry): LedgerEntry = LedgerEntry(
        id = e.id,
        tenantId = "t1",
        accountId = deriveAccountId(e.parentId, PaymentCategory.fromCode(e.category), e.studentId),
        parentId = e.parentId,
        studentId = e.studentId,
        category = PaymentCategory.fromCode(e.category),
        amount = e.amount,
        type = LedgerEntryType.fromCode(e.type),
        sourceType = LedgerSourceType.fromCode(e.sourceType),
        sourceId = e.sourceId,
        method = e.method?.let { PaymentMethod.fromCode(it) },
        receiptNumber = e.receiptNumber,
        paymentStatus = e.paymentStatus?.let { PaymentStatus.fromCode(it) },
        reversesId = e.reversesId,
        description = e.description,
        actorId = e.actorId,
        actorName = e.actorName,
        at = e.at,
        metadata = e.metadata?.toDomainMap() ?: emptyMap(),
    )

    /** Map a canonical scenario installment onto the REAL core engine type. */
    private fun toCoreInstallment(i: CanonicalInstallment) = com.example.core.WaterfallInstallment(
        id = i.id,
        category = PaymentCategory.fromCode(i.category),
        amountDue = i.amountDue,
        amountPaid = i.amountPaid,
        amountPending = i.amountPending,
        dueDate = i.dueDate,
        status = i.status,
    )

    /**
     * Post-state display record carrying amountDue so the derived
     * `totalOutstanding` aggregate can be recomputed.
     */
    private data class InstallmentState(
        val id: String,
        val amountDue: Long,
        val amountPaid: Long,
        val amountPending: Long,
        val status: String,
    )

    private fun com.example.core.WaterfallInstallment.toState() =
        InstallmentState(id = id, amountDue = amountDue, amountPaid = amountPaid, amountPending = amountPending, status = status)

    // ───────────────────────────────────────────────────────────────────
    // Operation dispatch.
    // ───────────────────────────────────────────────────────────────────

    fun runOperation(scenario: CanonicalScenario): JsonObject {
        val given = scenario.given
        val when_ = scenario.`when`
        val entries = given.ledgerEntries.map { toDomainEntry(it) }

        return when (when_.type) {
            "computeAccountBalance" -> {
                val accountId = when_.accountId ?: return errorResult("Missing accountId")
                val bal = LedgerEngine.computeAccountBalance(entries, accountId)
                buildJsonObject {
                    put("balance", bal.balance)
                    put("totalCharged", bal.totalCharged)
                    put("totalPaid", bal.totalPaid)
                    put("totalAdjusted", bal.totalAdjusted)
                    put("unallocatedCredit", bal.unallocatedCredit)
                }
            }

            "computeParentSummary" -> {
                val parentId = when_.parentId ?: given.parent?.id ?: "par-001"
                val parentName = given.parent?.name ?: "Test Parent"
                // NOTE: symmetric with the desktop runner (no overdue map).
                val summary = LedgerEngine.computeParentSummary(entries, parentId, parentName)
                buildJsonObject {
                    put("totalOutstanding", summary.totalOutstanding)
                    put("totalPaid", summary.totalPaid)
                    put("totalCharged", summary.totalCharged)
                    put("totalOverdue", summary.totalOverdue)
                    put("totalCleared", summary.totalCleared)
                    put("totalPending", summary.totalPending)
                    put("totalUnallocatedCredit", summary.totalUnallocatedCredit)
                    putAccounts("accounts", summary.accounts)
                }
            }

            "allocatePayment" -> {
                // CANONICAL RULE — zero/negative payment amounts are invalid
                // operations (SQL RPC raises; Android collect() validates;
                // desktop mock validates). Report the error like the backend.
                when_.paymentAmount?.let { if (it <= 0L) return errorResult("Payment amount must be > 0 (got $it)") }
                val coreInstallments = given.installments.map { toCoreInstallment(it) }
                val paymentAmount = when_.paymentAmount ?: return errorResult("Missing paymentAmount")
                val category = when_.category ?: "tuition"
                val paymentStatus = when_.paymentStatus ?: "paid"

                val result = allocatePaymentToInstallments(
                    installments = coreInstallments,
                    paymentAmount = paymentAmount,
                    categoryFilter = PaymentCategory.fromCode(category),
                    paymentStatus = if (paymentStatus == "paid") PaymentStatus.PAID else PaymentStatus.PENDING,
                )

                val installmentsAfter = coreInstallments.map { i ->
                    val alloc = result.allocations.find { it.installmentId == i.id }
                    if (alloc == null) i.toState()
                    else InstallmentState(
                        id = i.id,
                        amountDue = i.amountDue,
                        amountPaid = alloc.newAmountPaid,
                        amountPending = alloc.newAmountPending,
                        status = alloc.newStatus,
                    )
                }

                buildJsonObject {
                    putAllocations("allocations", result.allocations)
                    put("unallocatedAmount", result.unallocatedAmount)
                    put("totalAllocated", result.totalAllocated)
                    put("paymentAmount", result.paymentAmount)
                    putInstallments("installments", installmentsAfter)
                    put("totalPaid", installmentsAfter.sumOf { it.amountPaid })
                    put("totalPending", installmentsAfter.sumOf { it.amountPending })
                    put("totalOutstanding", installmentsAfter.sumOf { maxOf(0L, it.amountDue - it.amountPaid - it.amountPending) })
                    put("totalUnallocatedCredit", if (result.unallocatedAmount > 0) -result.unallocatedAmount else 0L)
                }
            }

            "revertPaymentAllocation" -> {
                val coreInstallments = given.installments.map { toCoreInstallment(it) }
                val reversalAmount = when_.reversalAmount ?: return errorResult("Missing reversalAmount")
                val category = when_.category ?: "tuition"
                val originalWasPending = when_.originalWasPending ?: false

                val result = revertPaymentAllocation(
                    installments = coreInstallments,
                    reversalAmount = reversalAmount,
                    categoryFilter = PaymentCategory.fromCode(category),
                    originalWasPending = originalWasPending,
                )

                val installmentsAfter = coreInstallments.map { i ->
                    val rev = result.reverts.find { it.installmentId == i.id }
                    if (rev == null) i.toState()
                    else InstallmentState(
                        id = i.id,
                        amountDue = i.amountDue,
                        amountPaid = rev.newAmountPaid,
                        amountPending = rev.newAmountPending,
                        status = rev.newStatus,
                    )
                }

                buildJsonObject {
                    putReverts("reverts", result.reverts)
                    put("totalReverted", result.totalReverted)
                    put("unrevertedAmount", result.unrevertedAmount)
                    put("reversalAmount", result.reversalAmount)
                    putInstallments("installments", installmentsAfter)
                    put("totalPaid", installmentsAfter.sumOf { it.amountPaid })
                    put("totalPending", installmentsAfter.sumOf { it.amountPending })
                    put("totalOutstanding", installmentsAfter.sumOf { maxOf(0L, it.amountDue - it.amountPaid - it.amountPending) })
                }
            }

            "evaluateAllSystemDiscounts" -> {
                val p = when_.discountParams ?: return errorResult("Missing discountParams")
                val evals = evaluateAllSystemDiscounts(
                    EvaluateAllDiscountsParams(
                        grossTuition = p.grossTuition,
                        previousGradeLevel = p.previousGradeLevel,
                        currentGradeLevel = p.currentGradeLevel,
                        childIndex = p.childIndex,
                        paymentPlan = PaymentPlan.fromCode(p.paymentPlan),
                        paymentDate = p.paymentDate,
                        academicYearStartYear = p.academicYearStartYear,
                        academicYearStart = p.academicYearStart,
                        enrollmentDate = p.enrollmentDate,
                        previousRank = p.previousRank,
                        siblingPerChildAmount = p.siblingPerChildAmount ?: SIBLING_PER_CHILD_AMOUNT,
                    ),
                )
                buildJsonObject {
                    put("discountsApplied", evals.filter { it.applied }.map { it.code })
                    put("totalDiscount", sumDiscounts(evals))
                    putEvaluations("evaluations", evals)
                }
            }

            "reconcileLedger" -> {
                val includePayments = when_.includePayments
                val includeInstallments = when_.includeInstallments
                val includeParentSummaries = when_.includeParentSummaries

                val paymentInputs = if (includePayments) {
                    given.payments.map { Reconcile.PaymentCrossCheck(it.id, it.amount, PaymentStatus.fromCodeOrDefault(it.status)) }
                } else null
                val installmentInputs = if (includeInstallments) {
                    given.installments.map {
                        Reconcile.InstallmentCrossCheck(
                            id = it.id,
                            parentId = it.parentId,
                            studentId = it.studentId,
                            category = it.category,
                            amountDue = it.amountDue,
                            amountPaid = it.amountPaid,
                            label = it.label,
                            status = it.status,
                        )
                    }
                } else null
                val parentSummaries = if (includeParentSummaries && given.parent != null) {
                    val summary = LedgerEngine.computeParentSummary(entries, given.parent.id, given.parent.name)
                    listOf(
                        Reconcile.ParentSummaryCrossCheck(
                            parentId = given.parent.id,
                            parentName = given.parent.name,
                            totalOutstanding = summary.totalOutstanding,
                            accounts = summary.accounts.map {
                                Reconcile.ParentAccountCrossCheck(
                                    accountId = it.accountId,
                                    category = it.category.code,
                                    studentId = it.studentId,
                                    balance = it.balance,
                                    unallocatedCredit = it.unallocatedCredit,
                                )
                            },
                        ),
                    )
                } else null
                val payToInst = if (includeInstallments && given.payments.isNotEmpty()) {
                    given.payments.filter { it.installmentId != null }.associate { it.id to it.installmentId!! }
                } else null

                val inputs = Reconcile.CrossCheckInputs(
                    payments = paymentInputs,
                    installments = installmentInputs,
                    parentSummaries = parentSummaries,
                    paymentToInstallmentId = payToInst,
                )
                val report = Reconcile.reconcileLedger(entries, inputs)
                buildJsonObject {
                    put("violations", kotlinx.serialization.json.buildJsonArray {
                        for (v in report.violations) {
                            add(buildJsonObject {
                                // Canonical wire format: lowercase (matches desktop).
                                put("severity", v.severity.name.lowercase())
                                put("code", v.code)
                                put("message", v.message)
                                put("details", kotlinx.serialization.json.buildJsonObject {
                                    for ((k, value) in v.details) {
                                        when (value) {
                                            null -> put(k, kotlinx.serialization.json.JsonNull)
                                            is String -> put(k, value)
                                            is Number -> put(k, value.toDouble())
                                            is Boolean -> put(k, value)
                                            else -> put(k, value.toString())
                                        }
                                    }
                                })
                            })
                        }
                    })
                    put("pass", report.passed)
                    put("errorCount", report.errorCount)
                    put("warningCount", report.warningCount)
                    put("violationCodes", report.violations.map { it.code })
                }
            }

            "syncRoundTrip" -> {
                var coreInstallments = given.installments.map { toCoreInstallment(it) }
                val entriesAfter = entries.toList()

                for (op in when_.operations) {
                    if (op.type == "allocatePayment") {
                        val result = allocatePaymentToInstallments(
                            installments = coreInstallments,
                            paymentAmount = op.paymentAmount ?: continue,
                            categoryFilter = PaymentCategory.fromCode(op.category ?: "tuition"),
                            paymentStatus = if (op.paymentStatus == "paid") PaymentStatus.PAID else PaymentStatus.PENDING,
                        )
                        coreInstallments = coreInstallments.map { i ->
                            val alloc = result.allocations.find { it.installmentId == i.id }
                            if (alloc == null) i
                            else i.copy(
                                amountPaid = alloc.newAmountPaid,
                                amountPending = alloc.newAmountPending,
                                status = alloc.newStatus,
                            )
                        }
                    } else if (op.type == "revertPaymentAllocation") {
                        val result = revertPaymentAllocation(
                            installments = coreInstallments,
                            reversalAmount = op.reversalAmount ?: continue,
                            categoryFilter = PaymentCategory.fromCode(op.category ?: "tuition"),
                            originalWasPending = op.originalWasPending ?: false,
                        )
                        coreInstallments = coreInstallments.map { i ->
                            val rev = result.reverts.find { it.installmentId == i.id }
                            if (rev == null) i
                            else i.copy(
                                amountPaid = rev.newAmountPaid,
                                amountPending = rev.newAmountPending,
                                status = rev.newStatus,
                            )
                        }
                    }
                }

                val parentId = given.parent?.id ?: "par-001"
                val parentName = given.parent?.name ?: "Test Parent"
                val summary = LedgerEngine.computeParentSummary(entriesAfter, parentId, parentName)
                val states = coreInstallments.map { it.toState() }

                buildJsonObject {
                    putInstallments("installments", states)
                    put("totalPaid", states.sumOf { it.amountPaid })
                    put("totalPending", states.sumOf { it.amountPending })
                    put("totalOutstanding", states.sumOf { maxOf(0L, it.amountDue - it.amountPaid - it.amountPending) })
                    put("totalCharged", summary.totalCharged)
                    put("totalUnallocatedCredit", summary.totalUnallocatedCredit)
                }
            }

            // ── Academic / CRM canonical operations ──

            "computeSubjectAverage" -> {
                val a = when_.assessment ?: given.assessment ?: return errorResult("Missing assessment")
                val avg = com.example.core.computeSubjectAverage(a.devoir1, a.devoir2, a.examen)
                buildJsonObject {
                    put("subjectAverage", avg)
                    put("averageIsNotNull", avg != null)
                }
            }

            // T-345 (MATIERE-500/ADR-018): the subject_configuration category —
            // the recipe engine + the ONE resolution rule, mirrored from the
            // desktop canonical module (the corpus pins the equivalence).
            "computeSubjectAverageFromRecipe" -> {
                val a = when_.assessment ?: given.assessment ?: return errorResult("Missing assessment")
                val r = when_.recipe ?: given.recipe
                val avg = com.example.core.computeSubjectAverageFromRecipe(
                    a.devoir1, a.devoir2, a.examen, a.cc,
                    com.example.core.GradingRecipe(
                        devoir1 = r?.devoir1 ?: 1.0,
                        devoir2 = r?.devoir2 ?: 1.0,
                        examen = r?.examen ?: 2.0,
                        cc = r?.cc ?: 0.0,
                    ),
                )
                buildJsonObject {
                    put("subjectAverage", avg)
                    put("averageIsNotNull", avg != null)
                }
            }

            "resolveSubjectConfiguration" -> {
                val subject = (when_.subject ?: given.subject) ?: return errorResult("Missing subject")
                val configurations = when_.configurations.ifEmpty { given.configurations }
                val ctx = when_.context ?: given.context
                val resolved = com.example.core.resolveSubjectConfiguration(
                    subject = com.example.core.LegacySubjectLayer(
                        id = subject.id.ifEmpty { null },
                        code = subject.code,
                        coefficient = subject.coefficient,
                        passingGrade = subject.passingGrade,
                        isExtracurricular = subject.isExtracurricular,
                    ),
                    configurations = configurations.map { c ->
                        com.example.core.SubjectConfiguration(
                            subjectId = c.subjectId,
                            academicYearId = c.academicYearId,
                            academicLevelId = c.academicLevelId,
                            direction = c.direction,
                            coefficient = c.coefficient,
                            subjectCode = c.subjectCode,
                            passingGrade = c.passingGrade,
                            isExtracurricular = c.isExtracurricular,
                            gradingRecipe = c.gradingRecipe?.let { r ->
                                com.example.core.GradingRecipe(r.devoir1, r.devoir2, r.examen, r.cc)
                            },
                            isActive = c.isActive,
                        )
                    },
                    academicLevelId = ctx?.academicLevelId,
                    academicYearId = ctx?.academicYearId,
                    direction = ctx?.direction ?: "general",
                    snapshot = ctx?.snapshot?.let { snap ->
                        com.example.core.SubjectContextSnapshot(
                            snap.coefficient, snap.coefficientDevoir1, snap.coefficientDevoir2,
                            snap.coefficientExamen, snap.coefficientCc,
                        )
                    },
                )
                buildJsonObject {
                    put("coefficient", resolved.coefficient)
                    put("subjectCode", resolved.subjectCode)
                    put("passingGrade", resolved.passingGrade)
                    put("isExtracurricular", resolved.isExtracurricular)
                    put("source", resolved.source)
                    put("recipe", buildJsonObject {
                        put("devoir1", resolved.gradingRecipe.devoir1)
                        put("devoir2", resolved.gradingRecipe.devoir2)
                        put("examen", resolved.gradingRecipe.examen)
                        put("cc", resolved.gradingRecipe.cc)
                    })
                }
            }

            "computeOverallGpa" -> {
                val list = (if (when_.assessments.isNotEmpty()) when_.assessments else given.assessments).map { a ->
                    com.example.domain.model.Assessment(
                        id = "asm-${a.hashCode()}", tenantId = "t1", studentId = "stu-001",
                        subjectId = "sub-001", classId = "cls-001", term = "T1",
                        academicYear = "2025-2026",
                        devoir1 = a.devoir1, devoir2 = a.devoir2, examen = a.examen,
                        subjectAverage = a.subjectAverage, coefficient = a.coefficient,
                        isExtracurricular = a.isExtracurricular,
                        enteredBy = "u1", enteredAt = "2026-01-01T00:00:00Z",
                    )
                }
                val gpa = com.example.core.computeOverallGpa(list)
                buildJsonObject {
                    put("gpa", gpa)
                    put("gpaIsNotNull", gpa != null)
                }
            }

            "getNextGradeProgression" -> {
                val grade = when_.gradeLevel ?: return errorResult("Missing gradeLevel")
                val prog = com.example.core.getNextGradeProgression(grade)
                buildJsonObject {
                    put("nextGradeCode", prog.nextGradeCode ?: "")
                    put("nextLevel", prog.nextLevel ?: "")
                    put("nextGradeYear", prog.nextGradeYear ?: -1)
                    put("nextCycle", prog.nextCycle ?: "")
                    put("isGraduation", prog.isGraduation)
                }
            }

            "deterministicParentCode" -> {
                val identity = when_.identity ?: return errorResult("Missing identity")
                val year = when_.year ?: 2026
                val code = com.example.core.deterministicParentCode(
                    year = year,
                    input = com.example.core.ParentCodeInput(
                        phone = identity.phone,
                        displayName = identity.displayName,
                        firstName = identity.firstName,
                        lastName = identity.lastName,
                    ),
                )
                buildJsonObject {
                    put("parentCode", code)
                }
            }

            "stableHash" -> {
                val input = when_.hashInput ?: return errorResult("Missing hashInput")
                buildJsonObject {
                    put("hash", com.example.core.stableHash(input))
                }
            }

            // ── PARITY-002 / T-285: the analytics-statistics derivation op —
            // the ANDROID MIRROR of the desktop runner's deriveAnalyticsStats.
            // Runs core/StatisticsEngine (the analytics-derivations mirror)
            // over the same scenario rows with the same PINNED now; the
            // comparator then proves desktop ≡ android centime-exact.
            "deriveAnalyticsStats" -> {
                val nowMs = parseNowMs(when_.now ?: "2026-09-10T00:00:00Z")
                val slice = given.payments
                    .filter { it.status == "paid" }
                    .map { com.example.core.StatsPayment(it.id, it.amount, it.method, it.status, it.category, it.collectedAt) }

                val stats = com.example.core.derivePaymentStats(slice)
                // T-341 (STATS-400): the amount HISTOGRAM computation REMOVED
                // with the vanity statistic (owner kill list — the desktop
                // runner did the same; the corpus then-blocks were regenerated).
                val categoryMix = com.example.core.deriveCategoryMix(slice)
                val methodMix = com.example.core.deriveMethodMix(slice)

                // Top debtors — per-parent Σ INV-4 remaining over unpaid
                // installments (mirrors the desktop seedSummary semantics).
                val remainingByParent = LinkedHashMap<String, Long>()
                for (i in given.installments) {
                    val rem = com.example.core.installmentRemaining(
                        com.example.core.StatsInstallment(i.id, i.parentId, i.amountDue, i.amountPaid, i.amountPending, i.dueDate, i.status),
                    )
                    if (rem <= 0L) continue
                    remainingByParent[i.parentId] = (remainingByParent[i.parentId] ?: 0L) + rem
                }
                val parentName = given.parent?.name ?: "Test Parent"
                val topDebtors = remainingByParent.entries
                    .map { (pid, amount) -> com.example.core.ParetoDebtor("${parentName} ${pid}", amount) }
                    .sortedByDescending { it.outstandingAmount }
                val pareto = com.example.core.derivePareto(topDebtors)

                // The aging census (deriveDebtAging — the canonical
                // per-installment INV-4 path with distinct parents per bucket).
                val statsInstallments = given.installments.map {
                    com.example.core.StatsInstallment(it.id, it.parentId, it.amountDue, it.amountPaid, it.amountPending, it.dueDate, it.status)
                }
                val census = com.example.core.deriveDebtAging(statsInstallments, nowMs)
                val funnel = com.example.core.deriveRecoveryFunnel(census)
                val agingComposition = com.example.core.deriveAgingComposition(census)
                val collectionRate = com.example.core.collectionRatePct(
                    stats.total,
                    statsInstallments.sumOf { com.example.core.installmentRemaining(it) },
                )

                buildJsonObject {
                    put("stats", buildJsonObject {
                        put("count", stats.count)
                        put("total", stats.total)
                        put("mean", stats.mean)
                        put("median", stats.median)
                        put("stdDev", stats.stdDev)
                        put("min", stats.min)
                        put("max", stats.max)
                        if (stats.bestMonth != null) {
                            put("bestMonth", buildJsonObject {
                                put("label", stats.bestMonth.label)
                                put("amount", stats.bestMonth.amount)
                            })
                        } else {
                            put("bestMonth", kotlinx.serialization.json.JsonNull)
                        }
                    })
                    // T-341 (STATS-400): the "histogram" output REMOVED with the
                    // vanity statistic (owner kill list — desktop runner parity).
                    put("categoryMix", kotlinx.serialization.json.buildJsonArray {
                        categoryMix.forEach { m ->
                            add(buildJsonObject {
                                put("key", m.key)
                                put("label", m.label)
                                put("amount", m.amount)
                                put("count", m.count)
                                put("percent", m.percent)
                            })
                        }
                    })
                    put("methodMix", kotlinx.serialization.json.buildJsonArray {
                        methodMix.forEach { m ->
                            add(buildJsonObject {
                                put("key", m.key)
                                put("label", m.label)
                                put("amount", m.amount)
                                put("count", m.count)
                                put("percent", m.percent)
                            })
                        }
                    })
                    put("pareto", kotlinx.serialization.json.buildJsonArray {
                        pareto.forEach { d ->
                            add(buildJsonObject {
                                put("name", d.name)
                                put("amount", d.amount)
                                put("cumPercent", d.cumPercent)
                            })
                        }
                    })
                    put("agingCensus", kotlinx.serialization.json.buildJsonArray {
                        census.forEach { b ->
                            add(buildJsonObject {
                                put("bucket", b.bucket)
                                put("amount", b.amount)
                                put("debtorCount", b.debtorCount)
                            })
                        }
                    })
                    put("agingComposition", kotlinx.serialization.json.buildJsonArray {
                        agingComposition.forEach { s ->
                            add(buildJsonObject {
                                put("bucket", s.bucket)
                                put("amount", s.amount)
                                put("debtorCount", s.debtorCount)
                                put("share", s.share)
                            })
                        }
                    })
                    put("funnel", kotlinx.serialization.json.buildJsonArray {
                        funnel.forEach { st ->
                            add(buildJsonObject {
                                put("name", st.name)
                                put("count", st.count)
                                put("sharePct", st.sharePct)
                            })
                        }
                    })
                    put("collectionRatePct", collectionRate)
                }
            }

            // ── PARITY-003 / T-292: the visual-parity derivation op — the
            // ANDROID MIRROR of the desktop runner's deriveAnalyticsVisuals.
            // Runs core/StatisticsEngine (the 13-chart derivations) over the
            // same scenario rows; the comparator then proves desktop ≡
            // android centime-exact on every value.
            "deriveAnalyticsVisuals" -> {
                val range = when_.range?.let { com.example.core.StatsDateRange(it.from, it.to) }

                // (a) Weekly rhythm — the FULL payments stream (the
                // counter-activity convention: only "refunded" excluded).
                val allRows = given.payments.map {
                    com.example.core.StatsPayment(it.id, it.amount, it.method, it.status, it.category, it.collectedAt)
                }
                val weeklyRhythm = com.example.core.deriveWeeklyRhythm(allRows, range)

                // T-341 (STATS-400): (b) the collection HEATMAP computation
                // REMOVED with the vanity statistic (owner kill list — the
                // desktop runner did the same; the corpus then-blocks were
                // regenerated without it).

                // (c) YoY — the scenario's current/previous monthly series
                // (DZD → centimes at the boundary).
                val current = when_.currentRevenue.map { com.example.core.RevenuePointInput(it.label, it.amountDzd * 100) }
                val previous = when_.previousRevenue.map { com.example.core.RevenuePointInput(it.label, it.amountDzd * 100) }
                val yoy = com.example.core.deriveYearOverYear(current, previous)

                // (d) Tranche waves — over the installments.
                val trancheRows = given.installments.map {
                    com.example.core.StatsTrancheRow(it.label, it.amountDue, it.amountPaid, it.amountPending)
                }
                val trancheWaves = com.example.core.deriveTrancheWaves(trancheRows)

                // (e) Demographics — students + classes, pinned year.
                val currentYear = java.time.Instant.parse(when_.now ?: "2026-09-10T00:00:00Z")
                    .atZone(java.time.ZoneOffset.UTC).year
                val demographics = com.example.core.deriveDemographics(
                    students = given.students.map { com.example.core.StatsStudentRow(it.gender, it.birthDate, it.classId) },
                    classes = given.classes.map { com.example.core.StatsClassRow(it.id, it.name, it.gradeCode, it.capacity) },
                    currentYear = currentYear,
                )

                buildJsonObject {
                    put("weeklyRhythm", kotlinx.serialization.json.buildJsonArray {
                        weeklyRhythm.forEach { r ->
                            add(buildJsonObject {
                                put("day", r.day)
                                put("cash", r.cash)
                                put("check", r.check)
                                put("transfer", r.transfer)
                            })
                        }
                    })
                    // T-341 (STATS-400): the "heatmap" output REMOVED with the
                    // vanity statistic (owner kill list — desktop runner parity).
                    put("yoy", buildJsonObject {
                        put("points", kotlinx.serialization.json.buildJsonArray {
                            yoy.points.forEach { p ->
                                add(buildJsonObject {
                                    put("label", p.label)
                                    put("current", p.current)
                                    put("previous", p.previous)
                                    if (p.deltaPercent != null) put("deltaPercent", p.deltaPercent) else put("deltaPercent", kotlinx.serialization.json.JsonNull)
                                })
                            }
                        })
                        put("totalCurrent", yoy.totalCurrent)
                        put("totalPrevious", yoy.totalPrevious)
                        if (yoy.deltaPercent != null) put("deltaPercent", yoy.deltaPercent) else put("deltaPercent", kotlinx.serialization.json.JsonNull)
                    })
                    put("trancheWaves", kotlinx.serialization.json.buildJsonArray {
                        trancheWaves.forEach { w ->
                            add(buildJsonObject {
                                put("index", w.index)
                                put("label", w.label)
                                put("hint", w.hint)
                                put("due", w.due)
                                put("paid", w.paid)
                                put("pending", w.pending)
                                put("pct", w.pct)
                                put("isNextTarget", w.isNextTarget)
                            })
                        }
                    })
                    put("demographics", buildJsonObject {
                        put("grade", demographicsJsonArray(demographics.grade))
                        put("gender", demographicsJsonArray(demographics.gender))
                        put("age", demographicsJsonArray(demographics.age))
                        // T-341 (STATS-400): the "capacity" slice REMOVED with
                        // the fake-ceiling gauges (owner kill list — desktop
                        // runner parity; the regenerated corpus has no key).
                    })
                }
            }

            // T-341 (STATS-400) — ANDROID MIRROR of the desktop runner's
            // deriveExecutiveStats: runs core/ExecutiveStatistics.kt (the
            // ADR-002 verbatim mirror of the desktop T-338 canonical engine)
            // over the same scenario rows with the same PINNED now; the
            // comparator then proves desktop ≡ android centime-exact on
            // every value — the owner's ONE-calculation-source mandate.
            "deriveExecutiveStats" -> {
                val nowMs = parseNowMs(when_.now ?: "2026-09-10T00:00:00Z")
                val topN = when_.topN

                val execInstallments = given.installments.map {
                    com.example.core.ExecInstallment(
                        id = it.id, parentId = it.parentId, category = it.category,
                        trancheNumber = it.trancheNumber,
                        amountDue = it.amountDue, amountPaid = it.amountPaid,
                        amountPending = it.amountPending, dueDate = it.dueDate,
                        status = it.status,
                    )
                }
                val execLedger = given.ledgerEntries.map { e ->
                    com.example.core.ExecLedgerEntry(
                        id = e.id, parentId = e.parentId, category = e.category,
                        amount = e.amount, type = e.type, description = e.description,
                        metadata = e.metadata?.toDomainMap() ?: emptyMap(),
                    )
                }
                val execStudents = given.students.map {
                    com.example.core.ExecStudent(
                        id = it.id, parentId = it.parentId, status = it.status,
                        transportTier = it.transportTier,
                    )
                }
                val parentNames = (if (given.parents.isNotEmpty()) given.parents else given.parent?.let { listOf(it) } ?: emptyList())
                    .map { it.id to it.name }
                val execClasses = given.classes.map {
                    com.example.core.ExecClass(
                        id = it.id, name = it.name,
                        gradeCode = it.gradeCode ?: "1ap",
                        isActive = it.isActive, enrolledCount = it.enrolledCount,
                    )
                }
                val execPayments = given.payments.map {
                    com.example.core.ExecPayment(
                        id = it.id, amount = it.amount, status = it.status,
                        category = it.category, studentId = it.studentId,
                    )
                }

                // (1) Tranche waves + (2) erosion + (3) triage.
                val waves = com.example.core.deriveExecTrancheWaves(execInstallments, nowMs)
                val erosion = com.example.core.deriveExecDiscountErosion(execLedger)
                val triage = com.example.core.deriveExecDebtTriage(execInstallments, nowMs)
                // (4) Family concentration + (5) transport + (6) services + (7) dynamics.
                val concentration = com.example.core.deriveExecFamilyConcentration(
                    execInstallments, parentNames, execStudents, topN = topN, nowEpochMs = nowMs,
                )
                val transport = com.example.core.deriveExecTransportYield(execStudents, execInstallments)
                val services = com.example.core.deriveExecServiceYield(execPayments)
                val dynamics = com.example.core.deriveExecEnrollmentDynamics(execStudents, execClasses)
                // (8) Triple-risk summary — the corpus carries the raw risk
                // vectors; the op reduces them with the SAME canonical
                // categorization thresholds the engine uses (the desktop op
                // inlines the identical rule; debtAmount is DZD → centimes).
                val riskCategories = when_.riskProfiles.map { r ->
                    com.example.core.execRiskCategoryOf(
                        gpa = r.gpa,
                        unexcusedAbsences = r.unexcusedAbsences,
                        attendanceRate = r.attendanceRate,
                        debtAmountCentimes = r.debtAmount * 100,
                    )
                }
                val riskSummary = com.example.core.deriveExecTripleRiskSummary(riskCategories)

                buildJsonObject {
                    put("waves", kotlinx.serialization.json.buildJsonArray {
                        waves.forEach { w ->
                            add(buildJsonObject {
                                put("key", w.key)
                                put("category", w.category)
                                put("wave", w.wave)
                                put("installmentCount", w.installmentCount)
                                put("paidCount", w.paidCount)
                                put("familyCount", w.familyCount)
                                put("debtorFamilyCount", w.debtorFamilyCount)
                                put("dueTotal", w.dueTotal)
                                put("paidTotal", w.paidTotal)
                                put("remainingTotal", w.remainingTotal)
                                put("collectedPct", w.collectedPct)
                                put("clearedPct", w.clearedPct)
                                if (w.dueDate != null) put("dueDate", w.dueDate) else put("dueDate", kotlinx.serialization.json.JsonNull)
                                put("phase", w.phase.name.lowercase())
                            })
                        }
                    })
                    put("erosion", buildJsonObject {
                        put("remiseCount", erosion.remiseCount)
                        put("remiseTotal", erosion.remiseTotal)
                        put("cancelCount", erosion.cancelCount)
                        put("cancelTotal", erosion.cancelTotal)
                        put("netRemiseTotal", erosion.netRemiseTotal)
                        put("grossCharges", erosion.grossCharges)
                        put("stickerTotal", erosion.stickerTotal)
                        put("erosionPct", erosion.erosionPct)
                        put("averageRemise", erosion.averageRemise)
                        put("maxRemise", erosion.maxRemise)
                        put("minRemise", erosion.minRemise)
                        put("remiseFamilyCount", erosion.remiseFamilyCount)
                    })
                    put("triage", buildJsonObject {
                        put("buckets", kotlinx.serialization.json.buildJsonArray {
                            triage.buckets.forEach { b ->
                                add(buildJsonObject {
                                    put("bucket", b.bucket.name.lowercase())
                                    put("amount", b.amount)
                                    put("installmentCount", b.installmentCount)
                                    put("familyCount", b.familyCount)
                                    put("share", b.share)
                                })
                            }
                        })
                        put("totalOutstanding", triage.totalOutstanding)
                        put("callList", kotlinx.serialization.json.buildJsonArray {
                            triage.callList.forEach { c ->
                                add(buildJsonObject {
                                    put("parentId", c.parentId)
                                    put("outstanding", c.outstanding)
                                    put("worstDaysOverdue", c.worstDaysOverdue)
                                })
                            }
                        })
                    })
                    put("concentration", buildJsonObject {
                        put("totalOutstanding", concentration.totalOutstanding)
                        put("debtorFamilyCount", concentration.debtorFamilyCount)
                        put("topFamilies", kotlinx.serialization.json.buildJsonArray {
                            concentration.topFamilies.forEach { f ->
                                add(buildJsonObject {
                                    put("parentId", f.parentId)
                                    put("parentName", f.parentName)
                                    put("outstanding", f.outstanding)
                                    put("childCount", f.childCount)
                                    put("shareOfTotalDebt", f.shareOfTotalDebt)
                                    put("worstDaysOverdue", f.worstDaysOverdue)
                                })
                            }
                        })
                        put("topTotal", concentration.topTotal)
                        put("topConcentrationPct", concentration.topConcentrationPct)
                    })
                    put("transport", buildJsonObject {
                        put("riders", transport.riders)
                        put("nonRiders", transport.nonRiders)
                        put("unresolvedRawValues", kotlinx.serialization.json.buildJsonArray {
                            transport.unresolvedRawValues.forEach { add(kotlinx.serialization.json.JsonPrimitive(it)) }
                        })
                        put("routes", kotlinx.serialization.json.buildJsonArray {
                            transport.routes.forEach { r ->
                                add(buildJsonObject {
                                    put("destination", r.destination)
                                    put("riders", r.riders)
                                    put("dueTotal", r.dueTotal)
                                    put("paidTotal", r.paidTotal)
                                    put("remainingTotal", r.remainingTotal)
                                    put("collectedPct", r.collectedPct)
                                })
                            }
                        })
                        put("dueTotal", transport.dueTotal)
                        put("paidTotal", transport.paidTotal)
                        put("remainingTotal", transport.remainingTotal)
                        put("collectedPct", transport.collectedPct)
                    })
                    put("services", kotlinx.serialization.json.buildJsonArray {
                        services.forEach { s ->
                            add(buildJsonObject {
                                put("category", s.category)
                                put("label", s.label)
                                put("paymentCount", s.paymentCount)
                                put("revenue", s.revenue)
                                put("studentCount", s.studentCount)
                            })
                        }
                    })
                    put("dynamics", buildJsonObject {
                        put("totalStudents", dynamics.totalStudents)
                        put("totalFamilies", dynamics.totalFamilies)
                        if (dynamics.siblingIndex != null) put("siblingIndex", dynamics.siblingIndex) else put("siblingIndex", kotlinx.serialization.json.JsonNull)
                        put("multiChildFamilyCount", dynamics.multiChildFamilyCount)
                        put("multiChildFamilyPct", dynamics.multiChildFamilyPct)
                        put("familySizes", kotlinx.serialization.json.buildJsonArray {
                            dynamics.familySizes.forEach { f ->
                                add(buildJsonObject {
                                    put("label", f.label)
                                    put("familyCount", f.familyCount)
                                    put("studentCount", f.studentCount)
                                })
                            }
                        })
                        put("imbalances", kotlinx.serialization.json.buildJsonArray {
                            dynamics.imbalances.forEach { i ->
                                add(buildJsonObject {
                                    put("gradeLabel", i.gradeLabel)
                                    put("sectionCount", i.sectionCount)
                                    put("sections", kotlinx.serialization.json.buildJsonArray {
                                        i.sections.forEach { s ->
                                            add(buildJsonObject {
                                                put("classId", s.classId)
                                                put("className", s.className)
                                                put("enrolled", s.enrolled)
                                            })
                                        }
                                    })
                                    put("minEnrolled", i.minEnrolled)
                                    put("maxEnrolled", i.maxEnrolled)
                                    put("averageEnrolled", i.averageEnrolled)
                                    put("spread", i.spread)
                                    put("imbalanced", i.imbalanced)
                                })
                            }
                        })
                    })
                    put("riskSummary", buildJsonObject {
                        put("tripleCriticalCount", riskSummary.tripleCriticalCount)
                        put("academicAlertCount", riskSummary.academicAlertCount)
                        put("attendanceAlertCount", riskSummary.attendanceAlertCount)
                        put("financialTensionCount", riskSummary.financialTensionCount)
                        put("healthyCount", riskSummary.healthyCount)
                        put("tripleCriticalPct", riskSummary.tripleCriticalPct)
                    })
                }
            }

            else -> errorResult("Unknown operation type: ${when_.type}")
        }
    }

    // ───────────────────────────────────────────────────────────────────
    // Main — read scenarios, run each, write results.
    // ───────────────────────────────────────────────────────────────────

    /**
     * PARITY-003/T-292 — parse one scenario JSON and run its operation,
     * returning the raw result object (for CrossPlatformEquivalenceTest's
     * field-by-field desktop-vs-android assertion). Exposed for tests only.
     */
    fun runScenarioForTest(scenarioJsonText: String): JsonObject? = try {
        val scenario = json.decodeFromString(CanonicalScenario.serializer(), scenarioJsonText)
        runOperation(scenario)
    } catch (e: Exception) {
        buildJsonObject { put("error", e.message ?: e.toString()) }
    }

    fun runAll(scenariosDir: File, outputDir: File) {
        if (!outputDir.exists()) outputDir.mkdirs()

        val scenarioFiles = scenariosDir.listFiles { f -> f.extension == "json" } ?: emptyArray()
        var passed = 0
        var errored = 0
        val results = mutableListOf<Triple<String, String, Long>>()

        println("Android Equivalence Runner — ${scenarioFiles.size} scenarios")
        println("=".repeat(60))

        for (file in scenarioFiles.sortedBy { it.name }) {
            val start = System.currentTimeMillis()
            try {
                val scenarioText = file.readText()
                val scenario = json.decodeFromString(CanonicalScenario.serializer(), scenarioText)
                val result = runOperation(scenario)
                val durationMs = System.currentTimeMillis() - start

                val outputFile = File(outputDir, "${scenario.id}.json")
                val output = buildJsonObject {
                    put("scenarioId", scenario.id)
                    put("engine", "android")
                    put("engineVersion", "1.0.0")
                    put("category", scenario.category)
                    put("tags", scenario.tags)
                    put("description", scenario.description)
                    put("operationType", scenario.`when`.type)
                    put("result", result)
                    put("expected", scenario.then ?: JsonObject(emptyMap()))
                    put("durationMs", durationMs)
                    put("timestamp", Instant.now().toString())
                }
                outputFile.writeText(json.encodeToString(JsonObject.serializer(), output))

                if (result["error"] != null) {
                    errored++
                    results.add(Triple(scenario.id, "error", durationMs))
                    println("  ✗ ${scenario.id} — error: ${result["error"]?.jsonPrimitive?.contentOrNull}")
                } else {
                    passed++
                    results.add(Triple(scenario.id, "pass", durationMs))
                    println("  ✓ ${scenario.id} ($durationMs ms)")
                }
            } catch (e: Exception) {
                val durationMs = System.currentTimeMillis() - start
                errored++
                results.add(Triple(file.nameWithoutExtension, "error", durationMs))
                println("  ✗ ${file.name} — exception: ${e.message}")
            }
        }

        println()
        println("Android runner: $passed passed, $errored errored (of ${scenarioFiles.size} total)")
        println("Results written to: ${outputDir.absolutePath}")

        val summaryFile = File(outputDir, "_summary.json")
        val summary = buildJsonObject {
            put("engine", "android")
            put("engineVersion", "1.0.0")
            put("ranAt", Instant.now().toString())
            put("scenarioCount", scenarioFiles.size)
            put("passed", passed)
            put("errored", errored)
            put("results", kotlinx.serialization.json.buildJsonArray {
                for ((id, status, ms) in results) {
                    add(buildJsonObject {
                        put("id", id)
                        put("status", status)
                        put("durationMs", ms)
                    })
                }
            })
        }
        summaryFile.writeText(json.encodeToString(JsonObject.serializer(), summary))
    }

    private fun errorResult(message: String): JsonObject = buildJsonObject {
        put("error", message)
    }

    /** Parse the pinned scenario `now` instant to epoch-ms (0 on parse failure). */
    private fun parseNowMs(iso: String): Long =
        runCatching { java.time.Instant.parse(iso).toEpochMilli() }.getOrDefault(0L)

    // ─── JSON builder helpers ───────────────────────────────────────────

    private fun buildJsonObject(block: kotlinx.serialization.json.JsonObjectBuilder.() -> Unit): JsonObject =
        kotlinx.serialization.json.buildJsonObject(block)

    private fun kotlinx.serialization.json.JsonObjectBuilder.put(key: String, value: Long) =
        put(key, JsonPrimitive(value))
    private fun kotlinx.serialization.json.JsonObjectBuilder.put(key: String, value: Int) =
        put(key, JsonPrimitive(value))
    private fun kotlinx.serialization.json.JsonObjectBuilder.put(key: String, value: Boolean) =
        put(key, JsonPrimitive(value))
    private fun kotlinx.serialization.json.JsonObjectBuilder.put(key: String, value: String) =
        put(key, JsonPrimitive(value))
    private fun kotlinx.serialization.json.JsonObjectBuilder.put(key: String, value: Double?) =
        if (value == null) put(key, kotlinx.serialization.json.JsonNull)
        else put(key, JsonPrimitive(value))
    private fun kotlinx.serialization.json.JsonObjectBuilder.put(key: String, value: List<String>) =
        put(key, kotlinx.serialization.json.buildJsonArray { value.forEach { add(JsonPrimitive(it)) } })

    private fun kotlinx.serialization.json.JsonObjectBuilder.putAccounts(
        key: String, accounts: List<com.example.core.AccountBalance>,
    ) {
        put(key, kotlinx.serialization.json.buildJsonArray {
            for (acc in accounts) {
                add(buildJsonObject {
                    put("accountId", acc.accountId)
                    put("category", acc.category.code)
                    put("studentId", acc.studentId ?: "")
                    put("balance", acc.balance)
                    put("unallocatedCredit", acc.unallocatedCredit)
                    put("totalCharged", acc.totalCharged)
                    put("totalPaid", acc.totalPaid)
                    put("totalAdjusted", acc.totalAdjusted)
                })
            }
        })
    }

    private fun kotlinx.serialization.json.JsonObjectBuilder.putInstallments(
        key: String, installments: List<InstallmentState>,
    ) {
        put(key, kotlinx.serialization.json.buildJsonArray {
            for (i in installments) {
                add(buildJsonObject {
                    put("id", i.id)
                    put("amountPaid", i.amountPaid)
                    put("amountPending", i.amountPending)
                    put("status", i.status)
                })
            }
        })
    }

    private fun kotlinx.serialization.json.JsonObjectBuilder.putAllocations(
        key: String, allocations: List<com.example.core.InstallmentAllocation>,
    ) {
        put(key, kotlinx.serialization.json.buildJsonArray {
            for (a in allocations) {
                add(buildJsonObject {
                    put("installmentId", a.installmentId)
                    put("allocatedAmount", a.allocatedAmount)
                    put("newAmountPaid", a.newAmountPaid)
                    put("newAmountPending", a.newAmountPending)
                    put("newStatus", a.newStatus)
                    put("fullySatisfied", a.fullySatisfied)
                    put("cleared", a.cleared)
                })
            }
        })
    }

    private fun kotlinx.serialization.json.JsonObjectBuilder.putReverts(
        key: String, reverts: List<com.example.core.RevertAllocation>,
    ) {
        put(key, kotlinx.serialization.json.buildJsonArray {
            for (r in reverts) {
                add(buildJsonObject {
                    put("installmentId", r.installmentId)
                    put("revertedAmount", r.revertedAmount)
                    put("newAmountPaid", r.newAmountPaid)
                    put("newAmountPending", r.newAmountPending)
                    put("newStatus", r.newStatus)
                    put("reopened", r.reopened)
                })
            }
        })
    }

    private fun kotlinx.serialization.json.JsonObjectBuilder.putEvaluations(
        key: String, evals: List<DiscountEvaluation>,
    ) {
        put(key, kotlinx.serialization.json.buildJsonArray {
            for (e in evals) {
                add(buildJsonObject {
                    put("code", e.code)
                    put("label", e.label)
                    put("amount", e.amount)
                    put("applied", e.applied)
                    put("reason", e.reason)
                })
            }
        })
    }

    private fun JsonObject.toDomainMap(): Map<String, Any?> =
        this.entries.associate { (k, v) ->
            k to when (v) {
                is JsonPrimitive -> v.contentOrNull?.let { c ->
                    c.toLongOrNull() ?: c.toBooleanStrictOrNull() ?: c
                }
                is JsonObject -> v.toDomainMap()
                else -> null
            }
        }

    /** PARITY-003/T-292 helper — DemographicSlice list → JSON array. */
    private fun demographicsJsonArray(
        slices: List<com.example.core.DemographicSlice>,
    ): kotlinx.serialization.json.JsonArray = kotlinx.serialization.json.buildJsonArray {
        slices.forEach { s ->
            add(buildJsonObject {
                put("label", s.label)
                put("count", s.count)
                put("percent", s.percent)
            })
        }
    }

    // ─── CLI entry point ────────────────────────────────────────────────

    @JvmStatic
    fun main(args: Array<String>) {
        val scenariosDir = File(args.getOrElse(0) { "financial-tests/equivalence/scenarios" })
        val outputDir = File(args.getOrElse(1) { "financial-tests/equivalence/results/android" })
        runAll(scenariosDir, outputDir)
    }
}
