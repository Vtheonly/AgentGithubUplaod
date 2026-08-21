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
import kotlinx.serialization.SerialName
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.builtins.ListSerializer
import java.io.File
import java.time.Instant
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.ZoneOffset

/**
 * Cross-Platform Equivalence Test Runner — Android (Kotlin).
 *
 * Reads the SAME canonical JSON scenarios as the desktop runner, runs each
 * through the Android's canonical financial engine (`LedgerEngine`,
 * `WaterfallAllocation`, `DiscountEngine`, `Reconcile`), captures the
 * complete domain result, and writes a normalized JSON result file to
 * `results/android/<scenario_id>.json`.
 *
 * The comparator (`comparison/comparator.ts`) then compares the desktop
 * and Android result sets.
 *
 * All monetary values are in CENTIMES (Long) — the Android engine's
 * native representation. No conversion needed.
 *
 * Usage (run from Android Studio or via gradle):
 *   ./gradlew :app:testDebugUnitTest --tests '*AndroidEquivalenceRunner*'
 *
 * Or as a standalone main():
 *   ./gradlew :app:runEquivalenceRunner --args='--scenarios /path/to/scenarios --output /path/to/results/android'
 */
object AndroidEquivalenceRunner {

    // ───────────────────────────────────────────────────────────────────
    // JSON scenario DTOs — mirror the canonical schema exactly.
    // ───────────────────────────────────────────────────────────────────

    @Serializable
    data class CanonicalLedgerEntry(
        val id: String,
        val parentId: String,
        val studentId: String? = null,
        val category: String,
        val amount: Long,                 // centimes
        val type: String,
        val sourceType: String,
        val sourceId: String,
        val method: String? = null,
        val receiptNumber: String? = null,
        val paymentStatus: String? = null,
        val reversesId: String? = null,
        val description: String,
        val actorId: String,
        val actorName: String,
        val at: String,
        val metadata: JsonObject? = null,
    )

    @Serializable
    data class CanonicalInstallment(
        val id: String,
        val parentId: String,
        val studentId: String? = null,
        val category: String,
        val label: String,
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
        val when: When,
        val then: JsonObject? = null,
    )

    @Serializable
    data class Given(
        val tenantId: String,
        val parent: Parent? = null,
        val students: List<Student> = emptyList(),
        val ledgerEntries: List<CanonicalLedgerEntry> = emptyList(),
        val installments: List<CanonicalInstallment> = emptyList(),
        val payments: List<CanonicalPayment> = emptyList(),
        val academicYearStartYear: Int = 2025,
    )

    @Serializable
    data class Parent(val id: String, val name: String)

    @Serializable
    data class Student(
        val id: String,
        val parentId: String,
        val gradeLevel: String,
        val paymentPlan: String = "tranches",
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
    //
    // The Android engine uses Long centimes throughout, so no precision
    // conversion needed — just structuring.
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

    private fun toDomainInstallment(i: CanonicalInstallment) = WaterfallInstallment(
        id = i.id,
        parentId = i.parentId,
        studentId = i.studentId,
        category = i.category,
        amountDue = i.amountDue,
        amountPaid = i.amountPaid,
        amountPending = i.amountPending,
        dueDate = i.dueDate,
        status = i.status,
        label = i.label,
    )

    // Local installment shape (matches the canonical `WaterfallInstallment`
    // used by the Android `allocatePaymentToInstallments` function).
    data class WaterfallInstallment(
        val id: String,
        val parentId: String,
        val studentId: String?,
        val category: String,
        val amountDue: Long,
        val amountPaid: Long,
        val amountPending: Long,
        val dueDate: String,
        val status: String,
        val label: String,
    )

    // ───────────────────────────────────────────────────────────────────
    // Operation dispatch — runs the scenario's `when` through the Android
    // canonical engine and returns the result.
    // ───────────────────────────────────────────────────────────────────

    fun runOperation(scenario: CanonicalScenario): JsonObject {
        val given = scenario.given
        val when_ = scenario.when
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
                val installments = given.installments.map { toDomainInstallment(it) }
                val paymentAmount = when_.paymentAmount ?: return errorResult("Missing paymentAmount")
                val category = when_.category ?: "tuition"
                val paymentStatus = when_.paymentStatus ?: "paid"
                val paymentId = when_.paymentId ?: "pay-test"

                val result = allocatePaymentToInstallments(
                    installments = installments,
                    paymentAmount = paymentAmount,
                    categoryFilter = category,
                    paymentStatus = if (paymentStatus == "paid") PaymentStatus.PAID else PaymentStatus.PENDING,
                )

                // Apply allocation to installments for post-state reporting.
                val installmentsAfter = installments.map { i ->
                    val alloc = result.allocations.find { it.installmentId == i.id }
                    if (alloc == null) i
                    else i.copy(
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
                val installments = given.installments.map { toDomainInstallment(it) }
                val reversalAmount = when_.reversalAmount ?: return errorResult("Missing reversalAmount")
                val category = when_.category ?: "tuition"
                val originalWasPending = when_.originalWasPending ?: false

                val result = revertPaymentAllocation(
                    installments = installments,
                    reversalAmount = reversalAmount,
                    categoryFilter = category,
                    originalWasPending = originalWasPending,
                )

                val installmentsAfter = installments.map { i ->
                    val rev = result.reverts.find { it.installmentId == i.id }
                    if (rev == null) i
                    else i.copy(
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
                    put("violations", report.violations.map { mapOf("severity" to it.severity.name, "code" to it.code, "message" to it.message) })
                    put("pass", report.passed)
                    put("errorCount", report.errorCount)
                    put("warningCount", report.warningCount)
                    put("violationCodes", report.violations.map { it.code })
                }
            }

            "syncRoundTrip" -> {
                var installments = given.installments.map { toDomainInstallment(it) }
                val entriesAfter = entries.toList()

                for (op in when_.operations) {
                    if (op.type == "allocatePayment") {
                        val result = allocatePaymentToInstallments(
                            installments = installments,
                            paymentAmount = op.paymentAmount ?: continue,
                            categoryFilter = op.category ?: "tuition",
                            paymentStatus = if (op.paymentStatus == "paid") PaymentStatus.PAID else PaymentStatus.PENDING,
                        )
                        installments = installments.map { i ->
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
                            installments = installments,
                            reversalAmount = op.reversalAmount ?: continue,
                            categoryFilter = op.category ?: "tuition",
                            originalWasPending = op.originalWasPending ?: false,
                        )
                        installments = installments.map { i ->
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

                buildJsonObject {
                    putInstallments("installments", installments)
                    put("totalPaid", installments.sumOf { it.amountPaid })
                    put("totalPending", installments.sumOf { it.amountPending })
                    put("totalOutstanding", installments.sumOf { maxOf(0L, it.amountDue - it.amountPaid - it.amountPending) })
                    put("totalCharged", summary.totalCharged)
                    put("totalUnallocatedCredit", summary.totalUnallocatedCredit)
                }
            }

            else -> errorResult("Unknown operation type: ${when_.type}")
        }
    }

    // ───────────────────────────────────────────────────────────────────
    // Main — read scenarios, run each, write results.
    // ───────────────────────────────────────────────────────────────────

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
                val scenario = Json.decodeFromString(CanonicalScenario.serializer(), scenarioText)
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
                    put("operationType", scenario.when.type)
                    put("result", result)
                    put("expected", scenario.then ?: JsonObject(emptyMap()))
                    put("durationMs", durationMs)
                    put("timestamp", Instant.now().toString())
                }
                outputFile.writeText(Json.encodeToString(JsonObject.serializer(), output))

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
            put("results", results.map { (id, status, ms) ->
                buildJsonObject {
                    put("id", id)
                    put("status", status)
                    put("durationMs", ms)
                }
            })
        }
        summaryFile.writeText(Json.encodeToString(JsonObject.serializer(), summary))
    }

    private fun errorResult(message: String): JsonObject = buildJsonObject {
        put("error", message)
    }

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
    private fun kotlinx.serialization.json.JsonObjectBuilder.put(key: String, value: List<String>) =
        put(key, kotlinx.serialization.json.buildJsonArray { value.forEach { add(JsonPrimitive(it)) } })
    private fun kotlinx.serialization.json.JsonObjectBuilder.put(key: String, value: JsonObject) =
        put(key, value)

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
        key: String, installments: List<WaterfallInstallment>,
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

    // ─── CLI entry point (for standalone execution) ────────────────────

    @JvmStatic
    fun main(args: Array<String>) {
        val scenariosDir = File(args.getOrElse(0) { "financial-tests/equivalence/scenarios" })
        val outputDir = File(args.getOrElse(1) { "financial-tests/equivalence/results/android" })
        runAll(scenariosDir, outputDir)
    }
}
