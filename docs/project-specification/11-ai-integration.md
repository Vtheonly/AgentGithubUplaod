# 11 — AI Integration

How the platform uses LLMs: Groq as the primary engine, OpenRouter as the fallback gateway, BYOK (Bring Your Own Key) configuration, and three native use cases (report card narratives, administrative drafting, expense anomaly detection).

---

## Architecture

```
App (Desktop or Mobile)
    │
    ├── Default Keys (rate-limited baseline, server-side)
    │       OR
    ├── BYOK Keys (institution-supplied, encrypted in Supabase secrets)
    │
    ▼
Groq LPU API (primary)
    │
    └── on rate-limit / model-variety need ──► OpenRouter API (fallback)
```

- **Default keys** ship embedded but rate-limited. They provide a baseline so the platform works out of the box.
- **BYOK keys** override the defaults when an institution supplies its own Groq and/or OpenRouter API keys.
- All AI calls route through Supabase Edge Functions — keys never reach the client.

---

## Groq LPU API (Primary Engine)

- **Hardware:** LPU (Language Processing Unit) — ultra-fast LLM inference.
- **Free tier:** usable, rate-limited.
- **Speed:** sub-second responses on common prompts.
- **Default endpoint:** `https://api.groq.com/openai/v1`

> **Critical rule:** Default API keys must live server-side in Supabase secrets and be proxied via Edge Functions. Never hard-code API keys in client-side code. The browser bundle is public; anyone can extract hardcoded strings.

---

## OpenRouter Gateway (Fallback)

OpenRouter is a multi-model API gateway that routes requests to Anthropic, OpenAI, Mistral, and other providers.

### When to use OpenRouter

- Groq returns `429` (rate limit exceeded).
- A specific use case needs a different model (e.g. long-context tasks that exceed Groq's context window).
- BYOK config has OpenRouter credits but not Groq credits.

> **Critical rule:** Never send the same prompt to both Groq and OpenRouter in parallel. This doubles cost and rate-limit pressure. OpenRouter is fallback only — try Groq first, fall back to OpenRouter only on failure.

---

## BYOK (Bring Your Own Key)

Administrators can supply their own Groq and/or OpenRouter API keys. Once configured, all subsequent AI calls use the institution's keys instead of the platform defaults.

### Configuration flow

1. Admin → Settings → AI Configuration.
2. Admin pastes Groq and/or OpenRouter API keys.
3. Keys are stored **encrypted** in Supabase secrets (server-side only).
4. All subsequent AI calls use the institution's keys.

> **Critical rule:** Never store BYOK keys in plaintext in the database or expose them to the browser/mobile client. Supabase secrets are server-side only. The client never sees the key — it only sees the proxied response from the Edge Function.

---

## PII Masking

> **Critical rule:** Mask PII (Personally Identifiable Information) before sending prompts to AI APIs. Check the institution's data-sharing policy. Student names, parent phone numbers, and financial amounts may need to be tokenized or generalized before being included in an AI prompt.

---

## Native Use Case 1 — Report Card Narrative Generator

Synthesizes a student's numerical grades + attendance rate + teacher notes into a cohesive professional narrative summary for end-of-term report cards (bulletins).

### Flow

1. Collect student data (grades, attendance, notes).
2. Build AI prompt from template.
3. Send to Groq LPU API.
4. Receive draft narrative.
5. Teacher reviews and edits the draft.
6. Final report card is published.

> **Critical rule:** The AI draft is **never** sent to parents without teacher review. Always route through a human review step; never auto-publish. AI can produce plausible-sounding but factually wrong content — a teacher must verify accuracy before the narrative reaches a parent.

---

## Native Use Case 2 — Administrative Drafting Assistant

Turns bulleted key points into polished formal drafts: convocations, parent alerts, policy notices.

### Example transformations

| Input (bullet points) | Output (formal draft) |
| :--- | :--- |
| "Parent meeting; Tuesday 3pm; discuss attendance" | Full convocation letter with date, time, agenda, and RSVP instructions |
| "Fee overdue; 15,000 DZD; deadline Friday" | Formal payment reminder with amount, deadline, and consequences |
| "New policy; phones banned in class; effective Monday" | Policy notice with rationale, scope, and enforcement |

> **Critical rule:** Never send AI-drafted communications without a human review pass. The AI can produce text that sounds authoritative but contains factual errors (wrong dates, wrong amounts, wrong names). A human must verify every fact before sending.

---

## Native Use Case 3 — Expense Anomaly Detector

Scans Tier-1 expense requests and vendor receipt descriptions (see note 08 — Expense Workflow). Flags:

- **Duplicate requests** — same vendor + same amount from different staff within ~24 hours.
- **Missing documentation** — no receipt attached or low-quality image.
- **Budget overruns** — request exceeds ~3× the category's monthly average.
- **Vendor anomalies** — new vendor with no prior payment history.

> **Critical rule:** Flags are signals for human review, **never** automatic rejections. A human financial officer always makes the final call.
