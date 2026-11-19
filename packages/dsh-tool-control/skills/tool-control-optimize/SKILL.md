---
name: tool-control-optimize
description: Analyze and optimize DSH tool surface modes (full, stub, hidden, disabled) via tool_control to minimize per-request tool schema token cost while preserving full tool-calling capability.
---

# Tool Surface Control AI Optimization Guide

You are optimizing the user's **Tool Control (`dsh-tool-control`)** settings to minimize per-request tool JSON Schema token cost while keeping 100% tool-calling capability and zero parameter-guessing errors.

## Step 1: Inspect Current Tool Surface & Usage
Run these read-only commands first:
1. `tool_control { action: "stats" }` — inspect total tracked tools, mode distribution, current vs full schema tokens, and PTC SDK status.
2. `tool_control { action: "list" }` — inspect each tool's source plugin, schema token size, current mode, and historical call count (`×N`).

## Step 2: Apply the Verified Optimal Strategy (Improved T2 — Tiered Full / Stub / Hidden)
Based on empirical benchmarks on `group/never-stuck` (-48.4% prompt tokens, -47.4% total cost, 0 parameter validation errors):

1. **Keep Core Daily Primitives `full`**:
   - Ensure essential core tools stay `full`: `tool_search`, `tool_catalog`, `read`, `write`, `edit`, `bash`, `glob`, `grep`, `ask_user_question`, `todo_write`, `run_code` (and any other tool with very high historical call counts in this workspace).
2. **Set Bulky Low-Frequency MCP Families & Rare System Tools to `hidden`**:
   - Move large MCP tool groups with low/zero usage (especially `mcp__cua-driver-mcp__*`, which alone can consume ~30k tokens) and rare system tools (`^cordis_*`, `replay_trajectory`, `start_recording`, `stop_recording`) to `hidden` via `tool_control { action: "set_mode", tools: [...], mode: "hidden" }`.
   - `hidden` drops wire schema cost to **0 tokens** while keeping every tool registered and callable via `tool_search`.
   - *Exception*: If the user's history shows frequent GUI automation, keep `mcp__cua-driver-mcp__screenshot` and `mcp__cua-driver-mcp__mouse_click` as `full` or `stub`.
3. **Set `fallbackMode` to `stub` (NOT Blanket `hidden`)**:
   - Execute `tool_control { action: "set_fallback", mode: "stub" }`.
   - Keep moderate-frequency cross-plugin tools (`workflow`, `plugin_manager`, `web_search`, `schedule_*`, database/k8s/office tools) at `stub`. Empirical testing showed that hiding ALL non-core plugins degrades multi-tool orchestration (more search hops and step exhaustion), whereas `stub` preserves 100% orchestration pass rate while cutting schema volume by ~60%+.
4. **Mandatory Guardrails**:
   - **NEVER disable `promptNotice`** (`promptNotice: true` is load-bearing; turning it off causes hidden-tool discovery pass rate to collapse to 0%).
   - Recommend `minSchemaBytes: 1500` in config so newly installed verbose plugins do not silently bloat prompts.
   - Only use `disabled` when the user explicitly wants a tool completely blocked from execution.

## Step 3: Verify & Report
- Run `tool_control { action: "stats" }` after applying changes.
- Present a concise before/after summary: original vs optimized schema tokens, % saved, tools moved to `hidden`/`stub`, and any tools kept `full` based on high usage.
