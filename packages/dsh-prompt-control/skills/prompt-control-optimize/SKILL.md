---
name: prompt-control-optimize
description: Analyze and optimize DSH system prompt sections, runtime contexts, and message injections via prompt_control to minimize token cost without degrading reasoning, safety, or time-awareness capabilities.
---

# System Prompt Control AI Optimization Guide

You are optimizing the user's **System Prompt Control (`dsh-prompt-control`)** settings to minimize recurring input token cost while preserving 100% of reasoning, safety, and time-awareness capabilities.

## Step 1: Inspect Current State
Run these read-only commands first to see the real token breakdown and any drifted overrides:
1. `prompt_control { action: "analyze" }` — identify the Top 5 token-heavy sections and category distribution for the active preset.
2. `prompt_control { action: "list" }` — inspect enabled/disabled status and custom overrides.
3. `prompt_control { action: "drift" }` — detect any custom overrides whose native upstream text has changed.

## Step 2: Apply the Verified Optimal Strategy (P2 — Compact Core + Keep Safety & Time)
Based on empirical benchmarks on `group/never-stuck` (-86.8% prompt tokens, 100% pass rate across coding, distributed architecture, approval-boundary, and timezone tasks):

1. **Preserve Core & Safety (NEVER break these)**:
   - Keep core identity and essential coding/quality standards enabled (you may propose concise `set_text` rewrites for overly repetitive verbose paragraphs while preserving every behavioral constraint).
   - Keep `sandbox:policy` and `approval:policy` runtime contexts enabled; never enable `suppressOptional: true` globally.
   - Keep `time-context` enabled (blocking it causes relative date/timezone queries to fail completely). If the user wants lower `time-context` cost, recommend raising `refreshIntervalMs` (e.g. `600000`–`1800000` ms) in the agent preset rather than blocking it.
2. **Trim Irrelevant Bloat**:
   - Disable non-essential metadata runtime context `harness:source` (via Settings → 提示词管理 → 运行时注入, or `contextInjections.disabledContexts: ["harness:source"]`).
   - Identify domain-irrelevant verbose sections (for example, Office/Univer formatting guides when the user only does software engineering, or verbose multi-agent/team boilerplate when working solo) and propose disabling them via `prompt_control { action: "set_status", section: "<key>", enabled: false }`.
3. **Resolve Upstream Drift**:
   - If `drift` reports outdated overrides, show the user which sections drifted and ask whether to keep their customization (`rebaseline`) or adopt the new native text (`accept_native`).
4. **Protect KV-Cache Stability**:
   - Keep static sections at the front and dynamic content at the end.
   - Avoid toggling overrides mid-session; apply all changes in one batch so subsequent turns retain high prefix-cache hit rates.

## Step 3: Execute & Report
- Apply safe, clearly beneficial changes directly (or confirm with the user before disabling domain sections that might still be used).
- Run `prompt_control { action: "analyze" }` again and present a concise before/after table showing estimated tokens saved, sections modified, and any preset-level tips.
