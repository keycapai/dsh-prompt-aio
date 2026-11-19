---
name: skill-control-optimize
description: Analyze and optimize DSH skill catalog visibility modes via skill_control to minimize token cost without losing skill discovery accuracy or triggering defensive search overhead.
---

# Skill Catalog Control AI Optimization Guide

You are optimizing the user's **Skill Control (`dsh-skill-control`)** settings to minimize `<available_skills>` catalog token cost while keeping 100% skill discovery accuracy.

## Step 1: Inspect Current State & Usage
Run these read-only commands first:
1. `skill_control { action: "stats" }` — check current catalog tokens vs full catalog tokens, fallback mode, description length limit, and prompt notice status.
2. `skill_control { action: "list" }` — inspect every skill's current mode, token cost (`now/full`), and historical call count (`calls`).

## Step 2: Apply the Verified Optimal Strategy (S2 — High-Frequency Full + Name-Only Fallback)
Based on empirical benchmarks on `group/never-stuck` (100% pass rate, -28.5% prompt tokens, lowest total cost):

1. **Set `fallbackMode` to `name` (NOT `hidden`)**:
   - Execute `skill_control { action: "set_fallback", mode: "name" }`.
   - **Critical empirical rule**: Do NOT set blanket `fallbackMode: "hidden"`. Hiding all skill names while `promptNotice: true` is active causes models to issue defensive `skill_search` calls even on unrelated tasks, increasing output tokens and raising total cost by ~30%. Keeping skill names visible (`- \`skill-name\``) lets the model immediately recognize matching skills (often with 0 search calls) and immediately rule out non-matching tasks.
2. **Pin Top 2–3 Most-Used Skills to `full`**:
   - Sort skills by `calls` (excluding one-off optimization skills like `*-control-optimize`).
   - Keep the top 2–3 frequently invoked skills in `full` mode via `skill_control { action: "set_mode", skills: ["..."], mode: "full" }`.
   - Keep on-demand utility skills (including `prompt-control-optimize`, `skill-control-optimize`, `tool-control-optimize`) at `name` so they cost ~5 tokens each until needed.
3. **Cap Description Length & Keep Prompt Notice**:
   - Recommend setting `catalogDescriptionMaxLength: 120` (in Settings → Skill 管理) if it is still `500`, so `full` skills stay compact.
   - **Always keep `promptNotice: true`** — disabling it drops implicit skill discovery accuracy to ~50%.
4. **Hide/Disable Only When Explicitly Unwanted**:
   - Only set skills to `hidden` or `disabled` if they are never used (`calls === 0`) AND noisy/irrelevant to the user's workflow (confirm with the user before disabling any skill).

## Step 3: Verify & Report
- Run `skill_control { action: "stats" }` after applying changes.
- Present a concise before/after summary of catalog token savings, pinned `full` skills, and fallback mode.
