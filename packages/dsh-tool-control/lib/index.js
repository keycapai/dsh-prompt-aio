/**
 * dsh-tool-control — keep the model's tool surface small, and let it search.
 *
 * ## The problem
 *
 * Every registered tool contributes its full name, description and JSON Schema
 * to every request. Measured on this machine before the plugin existed:
 *
 *     102 tools · ~156 KB of schema · ~39k input tokens per request
 *      58 of those were `mcp__cua-driver-mcp__*` — 77% of all schema bytes
 *
 * The model pays that on every single request, whether or not the turn has
 * anything to do with the GUI.
 *
 * ## The mechanism this builds on
 *
 * DSH already has the right primitive: a tool definition may carry
 * `deferLoading: true`. `dsh-system-prompt` forwards it, and
 * `dsh-llm-deepseek` translates it to the Messages API's `defer_loading: true`
 * — the model then sees the tool's NAME but not its description or schema, and
 * the API makes the full declaration available on demand.
 *
 * The gap: nothing lets an operator apply that flag to tools a plugin did not
 * author itself. `dsh-mcp-client` builds its definitions with no `deferLoading`
 * field at all, so all 58 Cua tools arrive permanently expanded. This plugin
 * closes that gap without patching either package.
 *
 * ## How
 *
 * It hooks the `system-prompt/assemble` waterfall. `dsh-system-prompt` runs
 * that waterfall over the finished assembly on every request, and the assembly
 * carries the exact `{name, description, parameters}` list the model is about
 * to receive. The plugin reshapes the matching entries there:
 *
 *   - EXECUTION IS UNTOUCHED, by construction. The registry keeps each
 *     provider's original definition, so a call dispatches to the real body
 *     with the real validation; only what the model READS changes.
 *   - THE HOOK IS INSTALLED WITH `ctx.effect`, so disabling the plugin stops
 *     the reduction and every tool returns to full declaration.
 *   - `passthrough` names are never touched, so anything you need permanently
 *     visible stays that way.
 *
 * ## Why assembly time, and not registration time
 *
 * An earlier revision wrapped `ctx.tools.register` and reduced each definition
 * as it arrived. That approach cannot work in general, and the failure is
 * silent:
 *
 *   - a tool registered BEFORE this plugin activated never passes through the
 *     wrapper, so it kept its full schema;
 *   - such a tool CANNOT be retro-fitted, because the registry rejects a
 *     duplicate name (`tool "x" is already registered`) — there is no way to
 *     re-register it under a reduced definition without stealing the owning
 *     plugin's disposer.
 *
 * Reducing the assembled wire list instead makes coverage independent of
 * activation order: whatever reaches the model is shaped, whenever it was
 * registered. It also makes a settings-page mode change take effect on the
 * next request, with no re-registration and no restart.
 *
 * ## The search tool
 *
 * Deferring alone would leave the model guessing at argument shapes. So the
 * plugin also registers two small always-visible tools:
 *
 *   - `tool_search` — find tools by keyword or regex; `details: true` returns
 *     the full JSON Schema for one tool. Several space-separated keywords may
 *     be given in ONE call: a tool matches when it contains ANY of them, and
 *     tools matching more of them rank higher. Requiring every keyword made a
 *     single mistyped term return an empty set, which the model then reported
 *     as "no such capability".
 *   - `tool_catalog` — the complete name index, cheap enough to call freely.
 *
 * Together they replace ~39k tokens of always-resident schema with a few
 * hundred, while keeping every tool reachable.
 *
 * ## The prompt notice
 *
 * A reduced surface is unreadable by construction — the model cannot tell a
 * filtered list from a complete one — so it must be TOLD that its tool list
 * omits specifications, or it answers "I have no such tool" for a capability
 * that is one search away.
 *
 * The notice covers both reduced states, and both are CALLABLE:
 *
 *   - stub / name — name plus a one-line summary; the argument schema comes
 *     from `tool_search { details: true }`.
 *   - hidden — omitted from the list entirely. The tool is still registered and
 *     callable, so the notice must (a) say unnamed tools exist, (b) say they
 *     are callable, and (c) name `tool_search` as the discovery step. Without
 *     (a) and (c) the model treats the shorter list as the complete catalog.
 *
 * Keeping the tool registered is what makes a `tool_search` hit actually
 * callable; the notice only has to explain how to read it.
 *
 * @module dsh-tool-control
 */

/**
 * Cordis plugin identity. The loader records this name against the running
 * entry so `plugin_manager` can address it.
 */
export const name = "tool-control";

/**
 * `tools` is the registry this plugin wraps. `systemPrompt` is injected only so
 * the deferred-tool notice can be appended to the prompt; activation waits for
 * both, so a missing one fails loudly instead of silently skipping the wrap.
 */
export const inject = ["tools", "systemPrompt"];

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import z from "@deepseek-ai/schemastery";

/**
 * Runtime defaults. Authoritative for every field the schemastery `Config`
 * schema below defaults as well — the two are kept in sync by construction
 * (the schema defaults read from this object), so a config-less loader row
 * and an omitted field behave identically.
 *
 * @type {Readonly<Record<string, unknown>>}
 */
export const DEFAULT_CONFIG = Object.freeze({
	enabled: true,
	/**
	 * How a matched tool's prompt surface is reduced. One of:
	 *
	 *   "full"   — no reduction; the tool is registered exactly as the provider
	 *              gave it. Equivalent to disabling the plugin for that tool.
	 *   "name"   — API-level defer only: keep the full definition but tag it
	 *              `deferLoading: true`. Smallest wire cost (~name only), but
	 *              requires a provider that implements the flag (DeepSeek
	 *              Messages API). Other adapters reject or strip it, which
	 *              silently restores full schemas.
	 *   "stub"   — provider-independent default: keep the name and a one-line
	 *              description, collapse `parameters` to a pointer that tells
	 *              the model to read them via `tool_search { details: true }`.
	 *              Execution and validation still run the ORIGINAL definition.
	 *   "hidden" — maximum saving with NO loss of capability: the tool is
	 *              omitted from the model's tool list entirely (not even its
	 *              name is sent). It stays REGISTERED and fully callable —
	 *              dispatch reads the registry, not the prompt — so the model
	 *              discovers it through `tool_search` / `tool_catalog` and
	 *              reads its purpose and arguments on demand. Use it for large
	 *              tool families the model does not need introduced up front.
	 *              (It is NOT a disable switch: to disable a tool, do not
	 *              register it.)
	 *
	 * Per-rule override: any rule source may instead be an object
	 * `{ match, mode }` (match = name for deferNames, prefix string for
	 * deferMcpPrefixes, regex source string for deferPatterns); a rule-level
	 * mode wins over the global `mode`.
	 */
	mode: "stub",
	// Every rule carries its own mode: there is no global default to inherit.
	deferMcpPrefixes: [{ match: "mcp__", mode: "stub" }],
	deferNames: [
		"workflow",
		"plugin_manager",
		"subagent",
		"subagent_fork",
		"spawn_teammate",
		"list_agents",
		"send_message",
		"interrupt_agent",
		"wait_agent",
		"team_task_create",
		"team_task_list",
		"team_task_get",
		"team_task_update",
		"replay_trajectory",
		"start_recording",
		"stop_recording",
	].map((match) => ({ match, mode: "stub" })),
	deferPatterns: [{ match: "^cordis_", mode: "stub" }],
	// Never deferred: the search pair itself, and anything whose absence would
	// make the session unable to recover or to answer the user.
	passthrough: [
		"tool_search",
		"tool_catalog",
		"read",
		"write",
		"edit",
		"bash",
		"glob",
		"grep",
		"ask_user_question",
		"todo_write",
		"run_code",
	],
	minSchemaBytes: 0,
	/**
	 * Per-tool overrides written by the settings card's three-state picker.
	 * Empty by default: the rule arrays below decide everything until the user
	 * pins individual tools.
	 */
	toolModes: {},
	/**
	 * Explicit source attributions, keyed by exact tool name: the settings card
	 * groups tools by "source plugin", and auto-detection can only see what the
	 * loaded packages declare. This map lets an operator pin a row that the
	 * heuristic missed (for example after moving a tool into a wrapper plugin).
	 * Empty by default.
	 */
	sourceOverrides: {},
	/**
	 * Manual prompt order, as an ordered array of tool names. Empty by default:
	 * without it the harness sorts tool schemas by name. Listed tools come first
	 * in exactly this order, and anything unlisted follows — so a short list of
	 * "the handful that matter" is enough to pin the top of the prompt without
	 * having to enumerate every tool.
	 *
	 * The card writes this; it is not a filter, so it cannot make a tool
	 * visible that the mode rules hid.
	 */
	toolOrder: [],
	/**
	 * Mode for a tool that matches NO rule. Defaults to "full" so an untouched
	 * installation never silently hides a plugin's tools; the settings card
	 * exposes it as the "everything else" choice once the user wants blanket
	 * coverage (the reason other plugins' tools passed through unfiltered).
	 */
	fallbackMode: "full",
	/**
	 * Inject a system-prompt section describing the reduced surface. For
	 * summarised tools it names them and points at `tool_search` for their
	 * arguments; for `hidden` tools — whose names are absent from the list — it
	 * states that unnamed tools exist, that they are fully callable, and that
	 * `tool_search` is the DISCOVERY step. Emitted only when at least one tool
	 * is reduced, so the section costs no context when nothing is controlled.
	 */
	promptNotice: true,
});

/** The closed set of reduction modes and their wire semantics. */
const MODES = new Set(["full", "name", "stub", "hidden", "disabled"]);

/**
 * Host HTTP route serving the settings card's live tool inventory. Prefixed
 * like every other plugin route so it cannot collide with a harness endpoint.
 */
const SETTINGS_ROUTE = "/api/dsh-tool-control/tools";

/**
 * Per-tool usage counters, deliberately module-scoped.
 *
 * `apply()` re-runs whenever the settings page is saved (the settings service
 * restarts the fiber with the new config), so counters held in that closure
 * were wiped on every edit and the "×N calls" badge appeared never to update.
 * Keeping them outside `apply` makes them survive a reconfiguration and still
 * reset on a Host restart — the scope these numbers actually describe.
 *
 * There is exactly one `apply` per Host process, so a single module-level store
 * is unambiguous; the `owner` field guards against a stale process-level copy
 * if the module were ever evaluated twice.
 */
const USAGE = {
	/** Live call counts observed in this Host process. */
	liveCounts: new Map(),
	/** Historical call counts scanned from ~/.dsh/sessions. */
	historyCounts: new Map(),
	/** Monotonic tick, so "recently used" breaks ties without timestamps. */
	ticks: 0,
	/** name -> tick of its most recent call. */
	lastCallAt: new Map(),
	/** Historical scan metadata, or null when not yet scanned. */
	historyStats: null,
	/** Total calls for a tool: live session calls plus scanned history. */
	totalCalls(name) {
		return (this.liveCounts.get(name) || 0) + (this.historyCounts.get(name) || 0);
	},
};

/**
 * In-process overrides written by the `tool_control` agent tool.
 *
 * `set_mode` and `set_fallback` used to write straight into the live config
 * accessor. That could never work: the accessor is the Loader row, the host
 * persists a row only through its `configEditor` service, and mutating the row
 * in place merely asks the Loader for a restart, which re-reads the row from
 * the profile patch and discards the write. The mode was therefore invisible
 * to the next request while still costing a fiber restart — and that restart
 * emptied the catalog, so the plugin looked broken.
 *
 * Overrides live here instead, at module scope, so the very next assembly
 * honours them. `apply()` clears them whenever it runs: by then the persisted
 * row (or a settings-card save) is authoritative again.
 */
const LIVE_OVERRIDES = {
	toolModes: new Map(),
	fallbackMode: undefined,
	/**
	 * Explicit source attributions (tool name -> plugin name) from the row's
	 * `sourceOverrides`. Kept here rather than passed down because
	 * `resolveToolSource` is module-level: it is called from the register hook,
	 * the assembly waterfall and the settings route, none of which share a scope.
	 */
	sources: new Map(),
	clear() {
		this.toolModes.clear();
		this.fallbackMode = undefined;
		this.sources.clear();
	},
};

/**
 * PTC presentation accounting, reported by `tool_control stats`.
 *
 * The `tools:sdk` prompt section is the whole tool surface in PTC mode, and it
 * is rendered as `render(registry.sdkSchemas(scope))`. Wrapping that method on
 * the service object a plugin holds is NOT enough in every Host: when the
 * renderer runs on a different registry instance it keeps producing full
 * schemas, and the prompt stays at ~20k tokens while every hidden/stubbed tool
 * is declared in full. These counters are what makes that failure visible
 * instead of silent — zero calls means the wrapper is not on the render path.
 */
const SDK_GATE = {
	installedOn: [],
	bootstrapped: [],
	calls: 0,
	seenCount: 0,
	emittedCount: 0,
};

/**
 * First-party tool providing package names, used to attribute standard harness
 * tools to their owning packages in the settings tool inventory.
 */
const FIRST_PARTY_SOURCES = Object.freeze({
	read: "dsh-tool-fs",
	write: "dsh-tool-fs",
	edit: "dsh-tool-fs",
	read_image: "dsh-tool-fs",
	glob: "dsh-tool-fs-search",
	grep: "dsh-tool-fs-search",
	str_replace_editor: "dsh-tool-str-replace-editor",
	bash: "dsh-tool-bash",
	pwsh: "dsh-tool-pwsh",
	web_search: "dsh-tool-web",
	web_fetch: "dsh-tool-web",
	job_output: "dsh-tool-jobs",
	job_list: "dsh-tool-jobs",
	job_kill: "dsh-tool-jobs",
	ask_user_question: "dsh-tool-ask-user",
	plan: "dsh-plan-mode",
	exit_plan_mode: "dsh-plan-mode",
	skill: "dsh-tool-skill",
	todo_write: "dsh-tool-todo",
	subagent: "dsh-tool-subagent",
	subagent_fork: "dsh-tool-subagent",
	send_message: "dsh-tool-subagent-control",
	interrupt_agent: "dsh-tool-subagent-control",
	list_agents: "dsh-tool-subagent-control",
	workflow: "dsh-tool-workflow",
	run_code: "dsh-tools",
	tool_search: "tool-control",
	tool_catalog: "tool-control",
	create_goal: "dsh-tool-goal",
	get_goal: "dsh-tool-goal",
	update_goal: "dsh-tool-goal",
});

/**
 * Extract the MCP server name from an `mcp__<server>__<tool>` name.
 */
function mcpServerOf(name) {
	if (!name.startsWith("mcp__")) return undefined;
	const cut = name.lastIndexOf("__");
	if (cut < 5) return undefined;
	const server = name.slice(5, cut);
	return server.length > 0 ? `mcp:${server}` : undefined;
}

/**
 * Sentinel for "no plugin could be identified".
 *
 * The CLIENT localizes this (sourceBuiltin), so the server must never bake a
 * language in. A hardcoded "内置" used to leak Chinese into the English UI and
 * made a missing attribution indistinguishable from a real one.
 */
const BUILTIN_SOURCE = "builtin";

/**
 * Fiber names that carry no ownership information.
 *
 * A tool registered outside any plugin fiber resolves to the root context, and
 * the registry itself is not a plugin either. Treating those as a source is
 * what produced rows attributed to "root"/"tools" instead of their real owner.
 */
const GENERIC_OWNERS = new Set([
	"root",
	"tools",
	"loader",
	"cordis",
	"dsh",
	"core",
	"app",
	"agent",
	"system",
]);

/**
 * Normalize an owner label to a plugin name, or undefined when it says nothing.
 *
 * @deepseek-ai/dsh-tool-web and dsh-tool-web name the same plugin, and the
 * settings page should not care which spelling the fiber happened to carry.
 *
 * @param value - a fiber name, a context name, or anything else.
 * @returns the plugin name, or undefined when the value is not informative.
 */
function normalizeSourceLabel(value) {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	if (trimmed.length === 0 || GENERIC_OWNERS.has(trimmed)) return undefined;
	const scoped = /^@[^/]+\/(.+)$/.exec(trimmed);
	return scoped !== null ? scoped[1] : trimmed;
}

/**
 * Ownership index: tool name -> the installed plugin package that registers it.
 *
 * WHY THIS EXISTS. ToolsService.register() stores { definition, when } and
 * nothing else: the core registry keeps NO provenance. The only way to learn an
 * owner is to read this.ctx.fiber.name inside the register hook, and that hook
 * can only see registrations that happen AFTER this plugin activates.
 *
 * A bundle patch row can only APPEND to the entry list, so a provider mounted by
 * an earlier bundle (the free-search plugin, for instance) registers its tools
 * before this plugin exists. Those tools reach the settings page through
 * adopt(), which has no owner to report, and every one of them used to be
 * labelled built-in even though a plugin provides it.
 *
 * So for adopted tools the package tree is the source of truth: a plugin has to
 * name its tool in code (a `name:` literal inside its register call), and that
 * literal is what the index collects. A name claimed by exactly one package is
 * attributed to it; a name claimed by several stays unresolved rather than
 * guessing. sourceOverrides is the explicit escape hatch on top.
 */
const OWNERSHIP = {
	builtAt: 0,
	ttlMs: 60_000,
	byTool: new Map(),
};

/** This plugin's own package root: its comments must not claim other tools. */
const OWN_PACKAGE_DIR = (() => {
	try {
		return fs.realpathSync(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
	} catch {
		return undefined;
	}
})();

/** Every directory that may hold a DSH plugin package. */
function pluginPackageDirs() {
	const home = os.homedir();
	const roots = [path.join(home, ".dsh", "plugins")];
	try {
		const profiles = path.join(home, ".dsh", "profiles");
		for (const name of fs.readdirSync(profiles)) {
			roots.push(path.join(profiles, name, "node_modules"));
		}
	} catch {}

	const dirs = [];
	for (const root of roots) {
		let entries;
		try {
			entries = fs.readdirSync(root, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			if (entry.name.startsWith(".")) continue;
			const full = path.join(root, entry.name);
			if (!entry.name.startsWith("@")) {
				if (entry.isDirectory() || entry.isSymbolicLink()) dirs.push(full);
				continue;
			}
			let scoped;
			try {
				scoped = fs.readdirSync(full, { withFileTypes: true });
			} catch {
				continue;
			}
			for (const child of scoped) {
				if (child.isDirectory() || child.isSymbolicLink()) dirs.push(path.join(full, child.name));
			}
		}
	}
	return dirs;
}

/**
 * Read one package's built JavaScript, or undefined when it is not a DSH plugin.
 *
 * The dsh manifest field (or a dsh-* package name) is what separates a harness
 * plugin from an ordinary dependency: scanning every dependency would cost far
 * more than it buys.
 *
 * @param dir - absolute package directory.
 * @returns { name, text } for a DSH plugin, otherwise undefined.
 */
function pluginPackageText(dir) {
	// Never let this plugin attribute a tool to itself: its own documentation
	// quotes other plugins' registration literals.
	if (OWN_PACKAGE_DIR !== undefined) {
		try {
			if (fs.realpathSync(dir) === OWN_PACKAGE_DIR) return undefined;
		} catch {}
	}
	let manifest;
	try {
		manifest = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
	} catch {
		return undefined;
	}
	const name = typeof manifest?.name === "string" ? manifest.name : undefined;
	if (name === undefined) return undefined;
	if (manifest.dsh === undefined && !/(^|\/)dsh-/.test(name)) return undefined;

	const files = [];
	const collect = (sub) => {
		let entries;
		try {
			entries = fs.readdirSync(path.join(dir, sub), { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const rel = path.join(sub, entry.name);
			if (entry.isDirectory()) collect(rel);
			else if (/\.(js|mjs|cjs|ts|tsx)$/.test(entry.name)) files.push(rel);
		}
	};
	collect("lib");
	if (files.length === 0) collect("src");
	if (files.length === 0) collect("dist");

	let text = "";
	for (const rel of files) {
		try {
			text += fs.readFileSync(path.join(dir, rel), "utf8");
		} catch {}
		if (text.length > 8_000_000) break;
	}
	return { name: normalizeSourceLabel(name) ?? name, text };
}

/** Tool names are declared as name: "<literal>" next to their definition. */
const TOOL_NAME_LITERAL = /\bname\s*:\s*["']([A-Za-z][A-Za-z0-9_.-]{1,63})["']/g;

/** Rebuild the tool -> plugin index from the installed plugin packages. */
function rebuildOwnershipIndex() {
	const byTool = new Map();
	for (const dir of pluginPackageDirs()) {
		const pkg = pluginPackageText(dir);
		if (pkg === undefined) continue;
		TOOL_NAME_LITERAL.lastIndex = 0;
		const claimed = new Set();
		let match;
		while ((match = TOOL_NAME_LITERAL.exec(pkg.text)) !== null) {
			const toolName = match[1];
			if (claimed.has(toolName)) continue;
			claimed.add(toolName);
			const known = byTool.get(toolName);
			if (known === undefined) byTool.set(toolName, pkg.name);
			// Two packages naming the same tool is not a tie to break by
			// guessing: mark it unresolved and let the operator pin it.
			else if (known !== pkg.name) byTool.set(toolName, null);
		}
	}
	OWNERSHIP.byTool = byTool;
	OWNERSHIP.builtAt = Date.now();
	return byTool;
}

/**
 * Resolve a tool to the installed plugin whose code declares it.
 *
 * @param toolName - the registered tool name.
 * @returns the owning package name, or undefined when unknown or ambiguous.
 */
function sourceOfInstalledPlugin(toolName) {
	if (Date.now() - OWNERSHIP.builtAt > OWNERSHIP.ttlMs) rebuildOwnershipIndex();
	const owner = OWNERSHIP.byTool.get(toolName);
	return typeof owner === "string" ? owner : undefined;
}

/**
 * Resolve the human-readable source plugin name for a tool.
 *
 * Precedence, highest first:
 *   1. mcp:<server> - an MCP tool names its own server.
 *   2. sourceOverrides[name] - an explicit operator choice, so a wrong
 *      attribution can always be corrected without patching this plugin.
 *   3. the caller's fiber name captured by the register hook.
 *   4. the first-party package table.
 *   5. the installed-plugin index (the adopted-tool path).
 *   6. the builtin sentinel, localized by the client.
 *
 * @param name - tool name.
 * @param owner - optional caller fiber name captured during registration.
 * @returns source label such as "mcp:cua-driver-mcp", "dsh-tool-fs", or "builtin".
 */
function resolveToolSource(name, owner) {
	const mcp = mcpServerOf(name);
	if (mcp !== undefined) return mcp;
	const override = LIVE_OVERRIDES.sources.get(name);
	if (override !== undefined) return override;
	const normalized = normalizeSourceLabel(owner);
	if (normalized !== undefined) return normalized;
	if (FIRST_PARTY_SOURCES[name]) return FIRST_PARTY_SOURCES[name];
	if (name.startsWith("cordis_")) return "cordis";
	const installed = sourceOfInstalledPlugin(name);
	if (installed !== undefined) return installed;
	return BUILTIN_SOURCE;
}

/**
 * Reorder tool schemas so manually listed tools come first, in the listed
 * order, with everything else following in its original (name-sorted) order.
 *
 * The harness sorts tools by name BEFORE the `system-prompt/assemble`
 * waterfall, and the waterfall's return value is used verbatim — so this is
 * the last chance to impose an order, and doing it here is why the settings
 * card's manual order takes effect without patching `dsh-system-prompt`.
 *
 * Names in `order` that no longer exist are skipped rather than appended: a
 * stale entry must not inject a phantom tool into the prompt.
 *
 * @param tools - the schemas to order.
 * @param order - tool names in the desired order, most important first.
 * @returns a new array, or the input untouched when `order` is empty.
 */
function applyManualOrder(tools, order) {
	if (!Array.isArray(order) || order.length === 0) return tools;
	const rank = new Map();
	for (const [index, name] of order.entries()) rank.set(name, index);
	if (rank.size === 0) return tools;

	const listed = [];
	const rest = [];
	for (const tool of tools) {
		if (rank.has(tool.name)) listed.push(tool);
		else rest.push(tool);
	}
	if (listed.length === 0) return tools;
	listed.sort((a, b) => rank.get(a.name) - rank.get(b.name));
	return [...listed, ...rest];
}

/**
 * Extract a tool allowlist from a preset's plugin composition.
 *
 * A preset's `read()` returns its `plugins` as dumped YAML text. Finding a
 * mask means parsing that text, which the Host must not do twice: the registry
 * already parsed it once to build the preset. So this performs a narrow,
 * line-oriented scan for a `tools:` row carrying `allow:` entries, which is
 * the one shape that restricts the visible tool set.
 *
 * Returns `null` when the preset declares no mask at all (it therefore exposes
 * every tool), and an array when it names an allowlist. A `deny`-only preset
 * cannot be expressed as an allowlist, so it also degrades to `null` rather
 * than silently claiming the preset has no tools.
 *
 * @param content - the dumped YAML text, or anything else.
 * @returns an array of tool names, or null when unrestricted/unknown.
 */
function toolAllowlistOf(content) {
	if (typeof content !== "string" || content.length === 0) return null;
	const lines = content.split("\n");
	for (let index = 0; index < lines.length; index += 1) {
		if (!/^\s*-?\s*allow:\s*$/.test(lines[index]) && !/^\s*allow:\s*\[/.test(lines[index])) continue;
		// Inline form: `allow: [read, write]`.
		const inline = /^\s*allow:\s*\[(.*)\]\s*$/.exec(lines[index]);
		if (inline !== null) {
			const names = inline[1]
				.split(",")
				.map((entry) => entry.trim().replace(/^["']|["']$/g, ""))
				.filter((entry) => entry.length > 0);
			return names.length > 0 ? names : null;
		}
		// Block form: `allow:` followed by `- name` entries.
		const indent = /^(\s*)/.exec(lines[index])?.[1].length ?? 0;
		const names = [];
		for (let next = index + 1; next < lines.length; next += 1) {
			const line = lines[next];
			if (line.trim().length === 0) continue;
			const lineIndent = /^(\s*)/.exec(line)?.[1].length ?? 0;
			if (lineIndent <= indent) break;
			const item = /^\s*-\s*(.+?)\s*$/.exec(line);
			if (item !== null) names.push(item[1].replace(/^["']|["']$/g, ""));
		}
		return names.length > 0 ? names : null;
	}
	return null;
}

/**
 * Test whether a plugin package is loaded and not explicitly disabled in the
 * dumped YAML plugin tree of an agent preset.
 */
function isPluginEnabledInYaml(content, pkgName) {
	if (typeof content !== "string" || !content) return false;
	const blocks = content.split(/(?:^|\n)\s*-\s+/);
	for (const block of blocks) {
		if (block.includes(`@deepseek-ai/${pkgName}`) || block.includes(pkgName)) {
			if (/disabled:\s*true/.test(block)) return false;
			return true;
		}
	}
	return false;
}

/**
 * Determine whether a tool is active inside a given agent preset.
 *
 * DSH presets do not typically specify an explicit `allow: [...]` tool mask.
 * Instead, they compose Cordis plugins:
 *   - "minimal": only loads a persistent shell (bash/pwsh) and persona; tools
 *     like read, write, edit, web_search, subagent, workflow are NOT mounted.
 *   - "ptc": runs tools via TypeScript/Python SDK in `run_code`; workflow is
 *     disabled.
 *   - "standard" / "cordis": mount full tool suites.
 *
 * If a preset provides an explicit `allow: [...]` list, that list is
 * authoritative. Otherwise, tool presence is derived from the plugin tree.
 */
export function isToolInPreset(toolName, presetId, content) {
	if (typeof content !== "string" || !content) return true;

	const explicitAllow = toolAllowlistOf(content);
	if (explicitAllow !== null) {
		return explicitAllow.includes(toolName);
	}

	if (toolName === "run_code") {
		return presetId === "ptc" || content.includes("dsh-ptc");
	}
	if (toolName === "bash") {
		return (
			isPluginEnabledInYaml(content, "dsh-tool-bash") ||
			isPluginEnabledInYaml(content, "dsh-tool-bash-persistent") ||
			isPluginEnabledInYaml(content, "dsh-terminal-bash")
		);
	}
	if (toolName === "pwsh") {
		return (
			isPluginEnabledInYaml(content, "dsh-tool-pwsh") ||
			isPluginEnabledInYaml(content, "dsh-tool-pwsh-persistent")
		);
	}

	const sourcePkg = FIRST_PARTY_SOURCES[toolName];
	if (sourcePkg !== undefined) {
		return isPluginEnabledInYaml(content, sourcePkg);
	}

	// In minimal preset, only tools explicitly mounted by minimal are present.
	if (presetId === "minimal") {
		return false;
	}

	return true;
}

/**
 * Scan all historical session event logs in ~/.dsh/sessions to collect
 * tool invocation counts across previous sessions.
 *
 * Session logs are stored in ~/.dsh/sessions/<workspace>/session-<id>/
 * as either zstd-compressed (`session.v4.jsonl.zstd`) or plain JSONL files.
 * Uses Node's built-in `node:zlib` for zstd decompression.
 *
 * @param {string} [sessionsDir] - optional override for test harnesses.
 * @returns {{ totalCalls: number, totalSessions: number, counts: Map<string, number> }}
 */
export function scanHistoricalUsage(sessionsDir) {
	const dir = sessionsDir || path.join(os.homedir(), ".dsh", "sessions");
	const counts = new Map();
	let totalSessions = 0;
	let totalCalls = 0;

	if (!fs.existsSync(dir)) return { totalCalls: 0, totalSessions: 0, counts };

	let workspaces;
	try {
		workspaces = fs.readdirSync(dir);
	} catch {
		return { totalCalls: 0, totalSessions: 0, counts };
	}

	for (const ws of workspaces) {
		const wsDir = path.join(dir, ws);
		let sessions;
		try {
			if (!fs.statSync(wsDir).isDirectory()) continue;
			sessions = fs.readdirSync(wsDir);
		} catch {
			continue;
		}

		for (const s of sessions) {
			const sDir = path.join(wsDir, s);
			const zf = path.join(sDir, "session.v4.jsonl.zstd");
			const jf = path.join(sDir, "session.v4.jsonl");
			let buf;
			let isZstd = false;

			try {
				if (fs.existsSync(zf)) {
					buf = fs.readFileSync(zf);
					isZstd = true;
				} else if (fs.existsSync(jf)) {
					buf = fs.readFileSync(jf);
				} else {
					continue;
				}
			} catch {
				continue;
			}

			totalSessions += 1;
			try {
				let content;
				if (isZstd && typeof zlib.zstdDecompressSync === "function") {
					content = zlib.zstdDecompressSync(buf).toString("utf8");
				} else if (!isZstd) {
					content = buf.toString("utf8");
				} else {
					continue;
				}

				for (const line of content.split("\n")) {
					if (!line.includes('"tool/call"') && !line.includes('"tool/ptc-dispatch-start"')) continue;
					try {
						const ev = JSON.parse(line);
						if (
							(ev?.type === "tool/call" || ev?.type === "tool/ptc-dispatch-start") &&
							typeof ev.data?.name === "string"
						) {
							const name = ev.data.name;
							counts.set(name, (counts.get(name) || 0) + 1);
							totalCalls += 1;
						}
					} catch {}
				}
			} catch {}
		}
	}

	return { totalCalls, totalSessions, counts };
}

/**
 * Schemastery entry config. Cordis validates the loader row through this
 * before `apply`, and — the reason it exists in this exact dialect — the
 * Plugins settings page derives its live form from the SAME schema: fields
 * marked `.volatile()` are served and editable there, so the mode switch,
 * the enable toggle, and the passthrough list are user-editable in the GUI
 * without any client code (the dsh-context pattern).
 *
 * Only the `.volatile()` fields may be changed from the settings page; the
 * rule arrays stay loader-row-owned because regex syntax is not a toggle.
 * Volatile edits commit without remounting, so the new mode takes effect on
 * the next host start (tool registration is a boot-time act).
 */
function volatileField(field) {
	return typeof field.volatile === "function" ? field.volatile() : field;
}

export const Config = z.object({
	enabled: volatileField(z.boolean().default(true)),
	mode: volatileField(z.union([...MODES]).default("stub").loose()),
	// Loose: a stale or malformed persisted list degrades to the default
	// instead of failing the whole entry.
	passthrough: volatileField(
		z.array(z.string().loose()).default([...DEFAULT_CONFIG.passthrough]).loose(),
	),
	/**
	 * Per-tool overrides, keyed by exact tool name, editable from the plugin's
	 * settings card. This is the field the three-state picker writes: each
	 * entry pins one tool to one mode ("full" = keep it resident, "stub" =
	 * name + one-line summary, "name" = API-level defer, "hidden" = omit from
	 * the wire entirely).
	 *
	 * It is checked BEFORE the rule arrays, so an explicit user choice always
	 * beats a wildcard rule — otherwise choosing "keep this MCP tool visible"
	 * would be silently overridden by `deferMcpPrefixes: ["mcp__"]`.
	 *
	 * Left loose on purpose: an entry for a tool that no longer exists must not
	 * fail validation (plugins come and go), and an unknown mode string is
	 * rejected at apply time with a warning rather than taking the whole
	 * settings page down.
	 */
	toolModes: volatileField(z.dict(z.string().loose()).default({}).loose()),
	/**
	 * Explicit source attributions, keyed by exact tool name (value = plugin
	 * package name shown on the settings card). Loose for the same reason as
	 * toolModes: a stale entry for a removed tool must not fail validation.
	 */
	sourceOverrides: volatileField(z.dict(z.string().loose()).default({}).loose()),
	/** Manual prompt order: listed tools first, everything else after. */
	toolOrder: volatileField(
		z.array(z.string().loose()).default([...DEFAULT_CONFIG.toolOrder]).loose(),
	),
	/** Mode applied to tools that match NO rule at all. 0-rule catch-all. */
	fallbackMode: volatileField(z.union([...MODES]).default("full").loose()),
	promptNotice: z.boolean().default(true),
	minSchemaBytes: z.number().default(0),
	// Rule arrays: operator-authored, loader-row-owned, not settings-page
	// fields. Element shape (a bare string OR a `{ match, mode? }` override) is
	// enforced at apply time by `normalizeRule` — schemastery's `union` with an
	// object member nulls object entries here, so the schema deliberately
	// passes elements through and the runtime does the strict validation.
	deferMcpPrefixes: z.array(z.any()).default([...DEFAULT_CONFIG.deferMcpPrefixes]),
	deferNames: z.array(z.any()).default([...DEFAULT_CONFIG.deferNames]),
	deferPatterns: z.array(z.any()).default([...DEFAULT_CONFIG.deferPatterns]),
});

/** Validate one mode value, falling back to the default with a warning. */
function resolveMode(candidate, fallback, label) {
	if (candidate === undefined) return fallback;
	if (typeof candidate === "string" && MODES.has(candidate)) return candidate;
	console.warn(
		`tool-control: ignoring invalid mode ${JSON.stringify(candidate)} for ${label} ` +
			`(expected one of ${[...MODES].map((m) => JSON.stringify(m)).join(", ")}); using ${JSON.stringify(fallback)}`,
	);
	return fallback;
}

/**
 * Normalize one rule source into `{ match, mode }`.
 *
 * Every rule now carries its OWN mode, and that is a deliberate API change: the
 * global `mode` field was removed because the settings page read as if one
 * choice governed everything while each rule quietly had its own idea, so
 * changing it appeared to do nothing. A bare string therefore has no mode to
 * carry and is rejected with a loud warning rather than silently inheriting a
 * default.
 *
 * @param source - a `{ match, mode }` object.
 * @param label - which rule array this came from, for diagnostics.
 * @returns the normalized rule, or undefined for an unusable entry.
 */
function normalizeRule(source, label) {
	if (
		source !== null &&
		typeof source === "object" &&
		typeof source.match === "string" &&
		source.match.length > 0 &&
		typeof source.mode === "string" &&
		MODES.has(source.mode)
	) {
		return { match: source.match, mode: source.mode };
	}
	console.warn(
		`tool-control: ignoring ${label} entry ${JSON.stringify(source)} ` +
			`(expected { match, mode }, mode one of ${[...MODES].map((m) => JSON.stringify(m)).join(", ")})`,
	);
	return undefined;
}

/** Clamp and type-check one incoming config into the shape the plugin uses. */
/**
 * Unwrap one volatile config reference to its current value. Schemastery
 * fields declared `.volatile()` arrive in the validated config as
 * `{ get(), [cosmokit.volatile.write]: setter }` handles — the Plugins
 * settings page writes through the symbol, this side reads through `get()`.
 * Anything else (a plain value from a direct/test construction) passes
 * through unchanged.
 */
function unwrapVolatile(candidate) {
	return candidate !== null &&
		typeof candidate === "object" &&
		typeof candidate.get === "function" &&
		Object.getOwnPropertySymbols(candidate).some(
			(symbol) => symbol.description === "cosmokit.volatile.write",
		)
		? candidate.get()
		: candidate;
}

function resolveConfig(raw) {
	const value = raw !== null && typeof raw === "object" ? raw : {};
	const strArray = (candidate, fallback) =>
		Array.isArray(candidate)
			? candidate.filter((item) => typeof item === "string" && item.length > 0)
			: fallback;
	const bool = (candidate, fallback) =>
		typeof candidate === "boolean" ? candidate : fallback;
	const num = (candidate, fallback) =>
		typeof candidate === "number" && Number.isFinite(candidate) && candidate >= 0
			? candidate
			: fallback;

	const globalMode = resolveMode(unwrapVolatile(value.mode), DEFAULT_CONFIG.mode, "config.mode");

	/** Normalize one rule-array entry; a bare string is no longer accepted. */
	const rulesOf = (candidate, label) => {
		if (!Array.isArray(candidate)) return [];
		const out = [];
		for (const source of candidate) {
			const rule = normalizeRule(source, label);
			if (rule !== undefined) out.push(rule);
		}
		return out;
	};

	let patterns;
	if (Array.isArray(value.deferPatterns)) {
		patterns = [];
		for (const rule of rulesOf(value.deferPatterns, "deferPatterns")) {
			try {
				patterns.push({ regex: new RegExp(rule.match, "u"), mode: rule.mode });
			} catch (error) {
				// A bad regex is operator error worth surfacing, but it must not
				// take the whole tool registry down with it.
				console.warn(
					`tool-control: ignoring invalid deferPatterns entry ${JSON.stringify(rule.match)}: ${error.message}`,
				);
			}
		}
	} else {
		patterns = DEFAULT_CONFIG.deferPatterns.map((s) => ({
			regex: new RegExp(s.match, "u"),
			mode: s.mode,
		}));
	}

	return {
		enabled: bool(unwrapVolatile(value.enabled), DEFAULT_CONFIG.enabled),
		// Kept only as the mode used by the byte-size catch-all below, which has
		// no rule of its own to carry one. Not surfaced on the settings page.
		mode: globalMode,
		deferMcpPrefixes: Array.isArray(value.deferMcpPrefixes)
			? rulesOf(value.deferMcpPrefixes, "deferMcpPrefixes").map((rule) => ({
					prefix: rule.match,
					mode: rule.mode,
				}))
			: DEFAULT_CONFIG.deferMcpPrefixes.map((rule) => ({ prefix: rule.match, mode: rule.mode })),
		deferNames: new Map(
			(Array.isArray(value.deferNames)
				? rulesOf(value.deferNames, "deferNames")
				: DEFAULT_CONFIG.deferNames
			).map((rule) => [rule.match, rule.mode]),
		),
		deferPatterns: patterns,
		passthrough: new Set(strArray(unwrapVolatile(value.passthrough), DEFAULT_CONFIG.passthrough)),
		// Per-tool overrides: keep only entries whose mode validates, so one
		// stale/garbage entry cannot take the whole surface down.
		toolModes: toolModesOf(unwrapVolatile(value.toolModes)),
		// Explicit source attributions: trimmed strings only, so a malformed
		// entry degrades to "not overridden" rather than a blank source chip.
		sourceOverrides: sourceOverridesOf(unwrapVolatile(value.sourceOverrides)),
		// Ordered, de-duplicated: a repeated name would otherwise let one tool
		// occupy two positions in the prompt order.
		toolOrder: [
			...new Set(
				strArray(unwrapVolatile(value.toolOrder), DEFAULT_CONFIG.toolOrder).filter(
					(name) => name.length > 0,
				),
			),
		],
		fallbackMode: resolveMode(
			unwrapVolatile(value.fallbackMode),
			DEFAULT_CONFIG.fallbackMode,
			"config.fallbackMode",
		),
		minSchemaBytes: num(value.minSchemaBytes, DEFAULT_CONFIG.minSchemaBytes),
		promptNotice: bool(value.promptNotice, DEFAULT_CONFIG.promptNotice),
	};
}

/**
 * Normalize the per-tool override map. Entries are `name -> mode`; a name is
 * kept only when non-empty and a mode only when it is one of the known four.
 * Invalid entries are dropped with a warning rather than thrown, because this
 * map is written by a settings form and read on every request — a typo must
 * degrade to "that one tool uses the rules" and never break the tool surface.
 *
 * @param candidate - the raw persisted value.
 * @returns a Map of tool name to validated mode.
 */
function toolModesOf(candidate) {
	const result = new Map();
	if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) {
		return result;
	}
	for (const [name, mode] of Object.entries(candidate)) {
		if (typeof name !== "string" || name.length === 0) continue;
		if (typeof mode === "string" && MODES.has(mode)) {
			result.set(name, mode);
			continue;
		}
		console.warn(
			`tool-control: ignoring invalid toolModes entry ${JSON.stringify(name)}: ` +
				`${JSON.stringify(mode)} (expected one of ${[...MODES].map((m) => JSON.stringify(m)).join(", ")})`,
		);
	}
	return result;
}

/**
 * Normalize the sourceOverrides map from the row config.
 *
 * Only non-empty string values survive: a blank override would render an empty
 * source chip, which is worse than the auto-detected label it replaced.
 *
 * @param candidate - the raw config field.
 * @returns a Map of tool name -> plugin name.
 */
function sourceOverridesOf(candidate) {
	const result = new Map();
	if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) {
		return result;
	}
	for (const [toolName, source] of Object.entries(candidate)) {
		if (typeof toolName !== "string" || toolName.length === 0) continue;
		if (typeof source !== "string") continue;
		const trimmed = source.trim();
		if (trimmed.length === 0) continue;
		result.set(toolName, trimmed);
	}
	return result;
}

/** Lossless byte length of a definition's model-facing schema, or 0 on any failure. */
function schemaBytes(definition) {
	try {
		return JSON.stringify({
			name: definition.name,
			description: definition.description,
			parameters: definition.parameters,
		}).length;
	} catch {
		return 0;
	}
}

/**
 * Project a full tool definition down to the `{name, description, parameters}`
 * triple the prompt assembly carries. Used only for cost accounting, so the
 * measured size matches what the waterfall actually shapes.
 */
function summariseSchema(definition) {
	return {
		name: definition?.name,
		description: definition?.description,
		parameters: definition?.parameters,
	};
}

/** Lowercase text a search query is matched against for one tool. */
function searchBlob(name, definition) {
	return `${name} ${definition?.description ?? ""}`.toLowerCase();
}

/** Escape a string for literal use inside a RegExp. */
function escapeRegExp(text) {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Split a query into its keywords. Space (or any run of whitespace) separates
 * terms; duplicates collapse so a repeated word cannot inflate the hit count
 * that drives ranking. Returns an empty array for a blank query.
 */
function keywordsOf(query) {
	const seen = new Set();
	for (const token of query.split(/\s+/u)) {
		if (token.length > 0) seen.add(token);
	}
	return [...seen];
}

/**
 * Rank one tool against a query. Higher is better; 0 means "did not match".
 *
 * Single keyword: exact name, then a name substring, then a description-only
 * hit — the reading order a human would use.
 *
 * Multiple keywords: OR semantics. A tool matches when it contains AT LEAST
 * ONE keyword; requiring all of them made a single mistyped term return an
 * empty result and told the model the capability did not exist. Coverage still
 * drives the ranking, so a tool matching every keyword outranks one matching
 * just one, and a full-coverage exact-name hit still tops the list.
 *
 * A query that collapses to ONE distinct keyword (`"read"`, or a repeated
 * `"click click click"`) takes the single-keyword path deliberately: the
 * de-duplication happens first, so repetition cannot promote a tool into the
 * coverage scale and out-rank a genuine exact-name hit.
 */
function scoreMatch(query, name, blob) {
	const lowerName = name.toLowerCase();
	const keywords = keywordsOf(query);

	if (keywords.length > 1) {
		let hits = 0;
		for (const keyword of keywords) {
			if (lowerName.includes(keyword) || blob.includes(keyword)) hits += 1;
		}
		if (hits === 0) return 0;
		// Full coverage outranks partial; among equals prefer the shorter
		// (more specific) name.
		const coverage = hits === keywords.length ? 500 : 100 + hits * 50;
		return coverage - Math.min(lowerName.length, 200);
	}

	// Single distinct keyword (including a query whose repeats collapsed, and
	// one already lowercased by the caller). Match on the collapsed keyword,
	// never the raw string: `"click click click"` must rank exactly like
	// `"click"`, and stray whitespace must not defeat a substring hit.
	const keyword = keywords[0] ?? query.trim();
	if (lowerName === keyword) return 1000;
	if (lowerName.includes(keyword)) {
		// Prefer the shortest name that still contains the query: `read` beats
		// `read_mcp_resource` for the query "read".
		return 600 - Math.min(lowerName.length, 200);
	}
	if (blob.includes(keyword)) return 200;
	return 0;
}

function pointerParameters(toolName) {
	return {
		type: "object",
		properties: {},
		additionalProperties: true,
		description:
			"Arguments not shown to save context. Call tool_search { query: \"" +
			toolName +
			"\", details: true } to read this tool's full parameter schema before calling it.",
	};
}

function reduceSchema(mode, schema) {
	const { deferLoading: _stripped, ...rest } = schema;
	switch (mode) {
		case "name":
			return { ...rest, deferLoading: true };
		case "stub":
			return {
				...rest,
				description:
					(schema.description ?? "").replace(/\s+/gu, " ").trim().split(/(?<=\.)\s/u)[0]
						?.slice(0, 200) ?? "",
				parameters: pointerParameters(schema.name),
			};
		case "hidden":
		case "disabled":
			return undefined;
		default:
			return schema;
	}
}

function getLiveField(live, key, fallback) {
	const raw = live?.[key];
	if (raw && typeof raw.get === "function") {
		return raw.get() ?? fallback;
	}
	return raw ?? fallback;
}

function setLiveField(live, key, val) {
	const target = live?.[key];
	if (target && typeof target.set === "function") {
		target.set(val);
	} else if (live) {
		live[key] = val;
	}
}

export function updateControlConfig(ctx, rawConfig, updater) {
	const live = ctx.fiber?.config || rawConfig;
	if (!live) return;
	updater(live);
	try {
		const configForms = typeof ctx.get === "function" ? ctx.get("configForms") : ctx.configForms;
		const form = configForms?.get?.("tool-control-row");
		if (form && typeof form.set === "function") {
			const snap = {
				enabled: getLiveField(live, "enabled", DEFAULT_CONFIG.enabled),
				toolModes: getLiveField(live, "toolModes", {}),
				fallbackMode: getLiveField(live, "fallbackMode", DEFAULT_CONFIG.fallbackMode),
				passthrough: getLiveField(live, "passthrough", DEFAULT_CONFIG.passthrough),
				toolOrder: getLiveField(live, "toolOrder", DEFAULT_CONFIG.toolOrder),
			};
			for (const key of ["enabled", "toolModes", "fallbackMode", "passthrough", "toolOrder"]) {
				form.set(key, snap[key]).catch(() => {});
			}
		}
	} catch {}
}

/** How long a settings write may take before the tool call stops waiting. */
const PERSIST_TIMEOUT_MS = 15000;

/**
 * Persist a tool-control config patch through the host `configEditor` service.
 *
 * That is the only write path that reaches the profile patch: the editor
 * validates the next row, rewrites `cordis.patch.yml`, reconciles the Loader
 * and restarts this fiber — the same chain a settings-card save uses. Every
 * step is optional-chained, because a test harness (or a profile without the
 * Editor) has no Loader row; the caller then reports the fallback honestly
 * instead of claiming the write succeeded.
 *
 * @param ctx - the plugin context, for `get("configEditor")` and its row.
 * @param change - `{ toolModes?, fallbackMode? }`; an `undefined` mode removes
 *   that tool's explicit override.
 * @returns `{ ok: true }` once the row is persisted, else `{ ok: false, reason }`.
 */
async function persistControlConfig(ctx, change) {
	let editor;
	let entry;
	try {
		editor = typeof ctx?.get === "function" ? ctx.get("configEditor", false) : undefined;
		// The editor owns the row list, so let it pick: `fiber.entry` is the
		// precise answer when it is still current, and the name match is the
		// fallback for a host that does not expose it on the fiber.
		const rows = typeof editor?.entries === "function" ? editor.entries() : [];
		const own = ctx?.fiber?.entry;
		entry = rows.includes(own)
			? own
			: rows.find((row) => String(row?.options?.name ?? "").includes("tool-control"));
		if (entry === undefined || typeof editor?.edit !== "function") {
			return { ok: false, reason: "this host exposes no configEditor row for the plugin" };
		}
		let failure;
		const edit = editor
			.edit(entry, (current) => {
				const next = { ...(current ?? {}) };
				if (change.toolModes !== undefined) {
					const modes = { ...(next.toolModes ?? {}) };
					for (const [toolName, mode] of Object.entries(change.toolModes)) {
						if (mode === undefined) delete modes[toolName];
						else modes[toolName] = mode;
					}
					next.toolModes = modes;
				}
				if (change.fallbackMode !== undefined) next.fallbackMode = change.fallbackMode;
				return next;
			})
			.catch((error) => {
				failure = error;
				return "failed";
			});
		const outcome = await Promise.race([
			edit,
			new Promise((resolve) => setTimeout(() => resolve("timeout"), PERSIST_TIMEOUT_MS)),
		]);
		if (outcome === "failed") return { ok: false, reason: failure?.message ?? String(failure) };
		if (outcome === "timeout") return { ok: false, reason: "the config editor timed out" };
		return { ok: true };
	} catch (error) {
		return { ok: false, reason: error?.message ?? String(error) };
	}
}

/** One-line report of where a mode change ended up. */
function persistenceNote(saved) {
	if (saved?.ok === true) return "💾 Written to the profile config — it survives a restart.";
	return `⚠️ In-process only (${saved?.reason ?? "no persistence hook"}) — the next request honours it, but it is gone after a restart; use the settings card to write it to disk.`;
}

/**
 * Build the `tool_control` agent-facing tool definition.
 *
 * Allows the AI model/agent to inspect tool reduction states, query token savings,
 * and dynamically adjust visibility (full / hidden / stub / name / disabled) for any tool.
 */
export function createControlTool(lookup) {
	const ACTIONS = ["list", "get", "set_mode", "set_fallback", "reset", "stats"];
	return {
		name: "tool_control",
		description:
			"Inspect, configure, and control model-visible tool presentation and gating. Allows the agent to list all tools and their reduction modes (full, hidden, stub, name, disabled), inspect tool definitions and usage counts, dynamically change tool modes (e.g. promote a hidden tool to full, hide verbose tools to save context, or disable unused tools), adjust the fallback mode for unmatched tools, and inspect token savings statistics.",
		parameters: {
			type: "object",
			additionalProperties: false,
			properties: {
				action: {
					type: "string",
					enum: ACTIONS,
					description:
						"Action: 'list' (list tools, modes, bytes & presets), 'get' (view detailed configuration and status for one tool), 'set_mode' (change reduction mode for one or more tools), 'set_fallback' (change default fallback mode for unmatched tools), 'reset' (clear per-tool override for a tool), 'stats' (view prompt context savings statistics).",
				},
				tool: {
					type: "string",
					description: "Target tool name. Required for 'get', 'set_mode', 'reset'.",
				},
				tools: {
					type: "array",
					items: { type: "string" },
					description: "Optional list of tool names for batch 'set_mode' or batch 'reset'.",
				},
				mode: {
					type: "string",
					enum: ["full", "hidden", "stub", "name", "disabled"],
					description:
						"Target reduction mode for 'set_mode' or 'set_fallback': 'full' (complete schema resident in prompt), 'hidden' (omitted from wire to save context, discoverable via tool_search, fully callable), 'stub' (one-line description + collapsed args), 'name' (name kept, API-level defer), 'disabled' (unregistered, completely uncallable).",
				},
				filter: {
					type: "string",
					enum: ["all", "full", "hidden", "stub", "name", "disabled", "deferred"],
					description: "Optional filter for 'list': list only tools matching this mode or status.",
				},
				source: {
					type: "string",
					description: "Optional source filter for 'list' (e.g. 'mcp', 'core', 'plugins').",
				},
			},
			required: ["action"],
		},
		output: {
			schema: { type: "string" },
			render: (_args, value) => [{ type: "text", text: value }],
		},
		async execute(args) {
			const action = args?.action;
			const approxTokens = (b) => Math.round(b / 3.8);

			if (action === "stats") {
				const all = lookup.entries();
				let fullBytes = 0;
				let promptBytes = 0;
				let reducedCount = 0;
				const countsByMode = { full: 0, hidden: 0, stub: 0, name: 0, disabled: 0 };

				for (const entry of all) {
					const mode = lookup.modeOf(entry.name, entry.definition);
					countsByMode[mode] = (countsByMode[mode] ?? 0) + 1;
					const orig = entry.originalBytes ?? 0;
					fullBytes += orig;
					if (mode === "full") {
						promptBytes += orig;
					} else if (mode === "name") {
						promptBytes += orig;
					} else if (mode === "stub") {
						reducedCount += 1;
						const shaped = reduceSchema("stub", summariseSchema(entry.definition));
						promptBytes += schemaBytes(shaped);
					} else if (mode === "hidden" || mode === "disabled") {
						reducedCount += 1;
					}
				}

				if (lookup.config.enabled && reducedCount > 0) {
					promptBytes += 1500;
				}

				const fullTokens = approxTokens(fullBytes);
				const promptTokens = approxTokens(promptBytes);
				const savedTokens = Math.max(0, fullTokens - promptTokens);
				const savedPct = fullTokens > 0 ? Math.round((savedTokens / fullTokens) * 100) : 0;

				return [
					"📊 **Tool Control Context & Token Savings Statistics**",
					`• Status: ${lookup.config.enabled ? "Active (Enabled)" : "Inactive (Disabled)"}`,
					`• Fallback Mode: \`${lookup.config.fallbackMode}\``,
					`• Tracked Tools: ${all.length} total`,
					`  - full: ${countsByMode.full}`,
					`  - hidden: ${countsByMode.hidden} (omitted from wire, fully callable)`,
					`  - stub: ${countsByMode.stub} (collapsed args + summary)`,
					`  - name: ${countsByMode.name} (API deferLoading)`,
					`  - disabled: ${countsByMode.disabled} (unregistered)`,
					`• Context Overhead: ~${promptTokens} tokens (~${(promptBytes / 1024).toFixed(1)} KB)`,
					`• Full Surface: ~${fullTokens} tokens (~${(fullBytes / 1024).toFixed(1)} KB)`,
					`• Savings: ~${savedTokens} tokens (${savedPct}% reduction)`,
					`• PTC SDK control: ${SDK_GATE.installedOn.length > 0 ? `wrapped (${SDK_GATE.installedOn.join(" + ")})` : "NOT wrapped"}; renderer calls: ${SDK_GATE.calls}; schemas in/out: ${SDK_GATE.seenCount}/${SDK_GATE.emittedCount}`,
					`• Surface probe: ${typeof lookup.probe === "function" ? lookup.probe() : "n/a"}`,
				].join("\n");
			}

			if (action === "list") {
				const all = lookup.entries();
				const filter = args.filter || "all";
				const sourceQuery = args.source?.toLowerCase();

				const rows = [];
				for (const entry of all) {
					const mode = lookup.modeOf(entry.name, entry.definition);
					if (filter === "deferred" && mode === "full") continue;
					if (filter !== "all" && filter !== "deferred" && mode !== filter) continue;

					const src = entry.source || resolveToolSource(entry.name);
					if (sourceQuery && !src.toLowerCase().includes(sourceQuery)) continue;

					const pinned = lookup.pinnedOf?.(entry.name) ?? false;
					const origTok = approxTokens(entry.originalBytes ?? 0);
					const calls = USAGE.totalCalls(entry.name);
					rows.push({
						name: entry.name,
						mode,
						pinned,
						tokens: origTok,
						source: src,
						calls,
						desc: summarise(entry.definition?.description),
					});
				}

				rows.sort((a, b) => b.calls - a.calls || a.name.localeCompare(b.name));

				if (rows.length === 0) {
					return `No tools matched the filter (filter=${filter}${sourceQuery ? `, source=${sourceQuery}` : ""}).`;
				}

				const lines = [
					`🛠️ **Tool Control Inventory** (${rows.length} tools, filter=${filter}):`,
					"Format: `[mode] tool_name (source, ~tokens, calls)` - description",
					"",
				];
				for (const r of rows) {
					const pinMark = r.pinned ? " 📌" : "";
					lines.push(`• [${r.mode}] \`${r.name}\`${pinMark} (${r.source}, ~${r.tokens} tok, ×${r.calls}) - ${r.desc}`);
				}
				return lines.join("\n");
			}

			if (action === "get") {
				const toolName = args.tool;
				if (!toolName) {
					return "❌ Error: 'tool' parameter is required for action 'get'.";
				}
				const all = lookup.entries();
				const entry = all.find((e) => e.name === toolName);
				if (!entry) {
					return `❌ Tool "${toolName}" was not found in the registered tool surface.`;
				}
				const mode = lookup.modeOf(toolName, entry.definition);
				const pinned = lookup.pinnedOf?.(toolName) ?? false;
				const bytes = entry.originalBytes ?? 0;
				const tokens = approxTokens(bytes);
				const calls = USAGE.totalCalls(toolName);
				const lastCall = USAGE.lastCallAt.get(toolName);
				const lastCallText = lastCall ? new Date(lastCall).toLocaleString() : "Never";

				return [
					`🔧 **Tool Detail**: \`${toolName}\``,
					`• Current Mode: **${mode}**${pinned ? " (Pinned by manual override 📌)" : " (Inherited from rules/fallback)"}`,
					`• Source: ${entry.source || resolveToolSource(toolName)}`,
					`• Original Size: ${bytes} bytes (~${tokens} tokens)`,
					`• Total Call Count: ×${calls} (Last called: ${lastCallText})`,
					`• Description: ${entry.definition?.description || "No description provided."}`,
					`• Parameter Schema:`,
					"```json",
					JSON.stringify(entry.definition?.parameters ?? {}, null, 2),
					"```",
				].join("\n");
			}

			if (action === "set_mode") {
				const targetTools = Array.isArray(args.tools) && args.tools.length > 0
					? args.tools
					: (args.tool ? [args.tool] : []);
				const targetMode = args.mode;

				if (targetTools.length === 0) {
					return "❌ Error: 'tool' or 'tools' parameter is required for action 'set_mode'.";
				}
				if (!targetMode || !MODES.has(targetMode)) {
					return `❌ Error: valid 'mode' is required (${[...MODES].join(", ")}).`;
				}

				const modes = Object.fromEntries(targetTools.map((toolName) => [toolName, targetMode]));
				// In-process first: the next request must honour the new mode even
				// when this host cannot persist the row.
				lookup.override?.({ toolModes: modes });
				const saved = typeof lookup.persist === "function"
					? await lookup.persist({ toolModes: modes })
					: { ok: false, reason: "no persistence hook" };

				return [
					`✅ Successfully updated ${targetTools.length} tool(s) to mode **${targetMode}**: ${targetTools.map((t) => `\`${t}\``).join(", ")}. Changes take effect immediately on the next request.`,
					persistenceNote(saved),
				].join("\n");
			}

			if (action === "set_fallback") {
				const targetMode = args.mode;
				if (!targetMode || !MODES.has(targetMode)) {
					return `❌ Error: valid 'mode' is required (${[...MODES].join(", ")}).`;
				}

				lookup.override?.({ fallbackMode: targetMode });
				const saved = typeof lookup.persist === "function"
					? await lookup.persist({ fallbackMode: targetMode })
					: { ok: false, reason: "no persistence hook" };

				return [
					`✅ Successfully updated fallbackMode to **${targetMode}**. Unmatched tools will default to this mode immediately.`,
					persistenceNote(saved),
				].join("\n");
			}

			if (action === "reset") {
				const targetTools = Array.isArray(args.tools) && args.tools.length > 0
					? args.tools
					: (args.tool ? [args.tool] : []);

				if (targetTools.length === 0) {
					return "❌ Error: 'tool' or 'tools' parameter is required for action 'reset'.";
				}

				const cleared = Object.fromEntries(targetTools.map((toolName) => [toolName, undefined]));
				lookup.override?.({ toolModes: cleared });
				const saved = typeof lookup.persist === "function"
					? await lookup.persist({ toolModes: cleared })
					: { ok: false, reason: "no persistence hook" };

				return [
					`✅ Successfully reset manual overrides for: ${targetTools.map((t) => `\`${t}\``).join(", ")}. They now follow wildcard rules and fallbackMode.`,
					persistenceNote(saved),
				].join("\n");
			}

			return `❌ Unknown action: "${action}". Valid actions: ${ACTIONS.join(", ")}.`;
		},
		presentCall: (args) => ({
			card: "generic",
			title: `Tool Control: ${args.action}${args.tool ? ` (${args.tool})` : ""}`,
			kind: "read",
			rawInput: JSON.stringify(args),
		}),
	};
}

/**
 * Build the `tool_search` definition. Reads live registry state through the
 * closures below, so it always reflects tools registered after activation.
 */
function createSearchTool(lookup) {
	// Wire-compliant JSON Schema: `parameters` MUST be `{"type":"object",...}`.
	// Strict upstreams (e.g. the workbuddy/Tencent route behind
	// workbuddy/deepseek-v4.1-flash, error 11129 "invalid function call
	// parameters") reject the ENTIRE request when any one tool's `parameters`
	// is present but not an object schema — and a bare schemastery-style
	// property map `{ name: propSchema }` is exactly that non-compliant shape.
	// `required` lives at the object level, never inside a property.
	const parameters = {
		type: "object",
		properties: {
			query: {
				type: "string",
				description:
					"Search text. Matched case-insensitively against tool names and descriptions. Separate words with spaces to search several keywords at once: a tool matches when it contains ANY of them, and tools matching MORE of them rank higher, so unrelated terms still surface the closest capabilities. Set `regex` to true to treat the whole string as one regular expression instead.",
			},
			regex: {
				type: "boolean",
				description: "Treat `query` as a regular expression. Defaults to false.",
			},
			details: {
				type: "boolean",
				description:
					"When true, return the full JSON Schema of the matched tools so they can be called. When false (default), return only names and one-line summaries.",
			},
			limit: {
				type: "integer",
				description: "Maximum number of tools to return. Defaults to 12, capped at 100.",
			},
			deferOnly: {
				type: "boolean",
				description:
					"When true, search only the deferred (currently undeclared) tools. Useful to check whether a capability exists without pulling in the always-visible set.",
			},
		},
		required: ["query"],
	};

	return {
		name: "tool_search",
		description:
			"Find tools by keyword and read their full specification. Not every tool you can call is listed in your tool list: tools whose schemas are deferred, and tools withheld by configuration, are discoverable here. Deferred tools remain fully callable — call tool_search first to learn a tool's exact name and arguments, then call it normally. Pass several space-separated keywords to search broadly: a tool matches when it contains any keyword, and the best matches (most keywords, shortest name) come first. Also use it to rediscover a tool whose name you have forgotten.",
		parameters,
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					query: { type: "string" },
					matches: {
						type: "integer",
						description: "Number of tools returned.",
					},
					total: {
						type: "integer",
						description: "Number of tools that matched before `limit` was applied.",
					},
					tools: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								name: { type: "string" },
								description: { type: "string" },
								deferred: { type: "boolean" },
								schema: { type: "object" },
							},
							required: ["name", "description", "deferred"],
						},
					},
				},
				required: ["query", "matches", "total", "tools"],
			},
			render: (_args, value) => [{ type: "text", text: renderSearchResult(value) }],
		},
		execute(args, exec) {
			const scope = exec.agent;
			const all = lookup.entries(scope);
			const limit = Math.min(Math.max(Number.isInteger(args.limit) ? args.limit : 12, 1), 100);
			const deferOnly = args.deferOnly === true;
			const details = args.details === true;

			let test;
			if (args.regex === true) {
				let pattern;
				try {
					pattern = new RegExp(args.query, "iu");
				} catch (error) {
					throw new Error(`invalid regex ${JSON.stringify(args.query)}: ${error.message}`);
				}
				// A RegExp instance is not callable in strict mode, so wrap it.
				test = (name, blob) => pattern.test(name) || pattern.test(blob);
			} else {
				const query = args.query.toLowerCase();
				test = (name, blob) => scoreMatch(query, name, blob) > 0;
			}

			const ranked = [];
			for (const entry of all) {
				// The mode is resolved here, from live config, rather than read
				// off the record: reduction happens per assembly, so a cached
				// flag would go stale the moment the operator switches modes.
				const mode = lookup.modeOf(entry.name, entry.definition);
				// A disabled tool is not merely unreduced — it is out of service,
				// so advertising it here would hand the model a name that cannot
				// be called. `hidden` deliberately DOES appear: that is how the
				// model discovers it.
				if (mode === "disabled") continue;
				if (deferOnly && mode === "full") continue;
				const blob = searchBlob(entry.name, entry.definition);
				if (!test(entry.name, blob)) continue;
				ranked.push({
					...entry,
					mode,
					rank: args.regex === true ? 1 : scoreMatch(args.query.toLowerCase(), entry.name, blob),
				});
			}
			ranked.sort((a, b) => b.rank - a.rank || a.name.localeCompare(b.name));

			const tools = ranked.slice(0, limit).map((entry) => ({
				name: entry.name,
				description: summarise(entry.definition?.description),
				// "deferred" means the model does not currently see this tool's
				// full specification. Every such tool remains CALLABLE — the
				// field reports prompt visibility, not availability.
				deferred: entry.mode !== "full",
				...(details
					? { schema: { parameters: entry.definition?.parameters ?? {} } }
					: {}),
			}));

			return Promise.resolve({ query: args.query, matches: tools.length, total: ranked.length, tools });
		},
		presentCall: (args) => ({
			card: "generic",
			title: `Search tools: ${args.query}`,
			kind: "read",
			rawInput: args.query,
		}),
	};
}

/** Build the `tool_catalog` definition: the cheap full name index. */
function createCatalogTool(lookup) {
	return {
		name: "tool_catalog",
		description:
			"List every tool you can call, grouped by whether its full schema is currently loaded. Use this to confirm that a capability exists at all; use `tool_search` with `details: true` to read the specification of one you intend to call.",
		// Wire-compliant JSON Schema — see createSearchTool for why the
		// `type: "object"` wrapper is mandatory, not cosmetic.
		parameters: {
			type: "object",
			properties: {
				deferredOnly: {
					type: "boolean",
					description: "When true, list only the deferred (schema not loaded) tools.",
				},
			},
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					loaded: {
						type: "array",
						items: { type: "string" },
						description: "Tools whose full schema the model currently sees.",
					},
					reduced: {
						type: "array",
						items: { type: "string" },
						description:
							"Callable tools shown with a one-line description only (stub or API-defer). Read their arguments via tool_search details:true.",
					},
					hidden: {
						type: "array",
						items: { type: "string" },
						description:
							"Callable tools listed by NAME ONLY, with no description or arguments shown (hidden mode). They work normally; read what each does and its arguments via tool_search details:true.",
					},
				},
				required: ["loaded", "reduced", "hidden"],
			},
			render: (_args, value) => [{ type: "text", text: renderCatalog(value) }],
		},
		execute(args) {
			const deferOnly = args.deferredOnly === true;
			const all = lookup.entries(undefined);
			const loaded = [];
			const reduced = [];
			const hidden = [];
			// All three buckets are CALLABLE; they differ only in how much of
			// the specification is currently shown to the model. Modes come from
			// live config so the catalog tracks a settings-page change too.
			for (const entry of all) {
				const mode = lookup.modeOf(entry.name, entry.definition);
				// Disabled tools are absent from the catalog entirely: listing
				// them would suggest a capability the model cannot use.
				if (mode === "disabled") continue;
				if (mode === "hidden") hidden.push(entry.name);
				else if (mode === "stub" || mode === "name") reduced.push(entry.name);
				else if (!deferOnly) loaded.push(entry.name);
			}
			loaded.sort();
			reduced.sort();
			hidden.sort();
			if (deferOnly) return Promise.resolve({ loaded: [], reduced, hidden });
			return Promise.resolve({ loaded, reduced, hidden });
		},
		presentCall: () => ({ card: "generic", title: "List tools", kind: "read" }),
	};
}

/** First sentence of a description, bounded — enough to decide whether to look closer. */
function summarise(description) {
	if (typeof description !== "string") return "";
	const flat = description.replace(/\s+/gu, " ").trim();
	const stop = flat.search(/\.\s|\.$/u);
	const head = stop === -1 ? flat : flat.slice(0, stop + 1);
	return head.length > 240 ? `${head.slice(0, 237)}...` : head;
}

/** Model-facing text for one `tool_search` result. */
function renderSearchResult(value) {
	if (value.tools.length === 0) {
		const note =
			value.total === 0
				? "No tool matched."
				: `No tool shown (${value.total} matched but all were filtered out).`;
		return `${note} Call tool_catalog to list every available tool name.`;
	}
	const lines = [
		`${value.matches} of ${value.total} matching tool${value.total === 1 ? "" : "s"}` +
			` for ${JSON.stringify(value.query)}:`,
	];
	for (const tool of value.tools) {
		const mark = tool.deferred ? "[deferred] " : "";
		lines.push(`- ${mark}${tool.name}: ${tool.description}`);
		if (tool.schema !== undefined) {
			lines.push(`  arguments: ${JSON.stringify(tool.schema.parameters)}`);
		}
	}
	if (value.tools.some((tool) => tool.schema === undefined)) {
		lines.push(
			"Call tool_search again with details:true to read the arguments of any tool above.",
		);
	}
	return lines.join("\n");
}

/** Model-facing text for one `tool_catalog` result. */
function renderCatalog(value) {
	const parts = [];
	if (value.loaded.length > 0) {
		parts.push(`Full schema loaded (${value.loaded.length}): ${value.loaded.join(", ")}`);
	}
	if (value.reduced.length > 0) {
		parts.push(
			`Callable with collapsed schema — read arguments via tool_search details:true (${value.reduced.length}): ` +
				value.reduced.join(", "),
		);
	}
	if (value.hidden.length > 0) {
		parts.push(
			`Callable, name only — no description or arguments shown; read both via ` +
				`tool_search details:true (${value.hidden.length}): ${value.hidden.join(", ")}`,
		);
	}
	if (parts.length === 0) return "No tools are available.";
	return parts.join("\n\n");
}

/**
 * The plugin body.
 *
 * @param ctx - Cordis context; `ctx.tools` and `ctx.systemPrompt` are injected.
 * @param rawConfig - the loader-supplied config row for this entry.
 */
function loadBundledSkill(skillName) {
	try {
		const baseDir = path.dirname(fileURLToPath(import.meta.url));
		const skillDir = path.resolve(baseDir, "..", "skills", skillName);
		const raw = fs.readFileSync(path.join(skillDir, "SKILL.md"), "utf8");
		const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
		const frontmatter = match ? match[1] : "";
		const content = (match ? match[2] : raw).trim();
		const field = (key) => {
			const line = new RegExp("^" + key + ":\\s*(.+)$", "m").exec(frontmatter);
			return line ? line[1].trim().replace(/^["']|["']$/g, "") : "";
		};
		return {
			name: field("name") || skillName,
			description: field("description") || "Optimize tool surface gating configuration.",
			content,
			source: "bundled",
			resourceBase: { kind: "directory", path: skillDir },
		};
	} catch {
		return null;
	}
}

function registerBundledSkill(ctx, skillName, label) {
	const definition = loadBundledSkill(skillName);
	if (!definition) return;
	let directSkills;
	try {
		directSkills = typeof ctx?.get === "function" ? ctx.get("skills", false) : ctx?.skills;
	} catch {
		directSkills = ctx?.skills;
	}
	if (directSkills && typeof directSkills.register === "function") {
		ctx.effect(() => directSkills.register(definition), label);
		return;
	}
	if (typeof ctx?.inject === "function") {
		ctx.inject(["skills"], (scoped) => {
			const service = typeof scoped?.get === "function" ? scoped.get("skills", false) : scoped?.skills;
			if (service && typeof service.register === "function") {
				scoped.effect(() => service.register(definition), label);
			}
		});
	}
}

export function apply(ctx, rawConfig) {
	registerBundledSkill(ctx, "tool-control-optimize", "tool-control.optimize-skill");
	// Cordis has already validated the row through `Config` (Standard Schema
	// face) before apply, so `rawConfig` carries every default filled in —
	// including the current values of the `.volatile()` fields the Plugins
	// settings page edits. The hand-rolled `resolveConfig` stays as a
	// belt-and-braces normalizer for direct (non-loader) construction in tests.
	//
	// The config for THIS activation. A settings-page edit does not mutate this
	// binding: the settings service persists the new value and restarts the
	// plugin fiber, so `apply()` runs again from the top with the new row. Each
	// activation therefore reads its config exactly once, here — which is why
	// a mode switch needs no restart and no in-place reload handling.
	const config = resolveConfig(rawConfig);
	// A fresh activation means the persisted row is authoritative again: an
	// override left over from the previous generation cannot be trusted.
	LIVE_OVERRIDES.clear();
	for (const [toolName, source] of config.sourceOverrides) {
		LIVE_OVERRIDES.sources.set(toolName, source);
	}
	// Warm the ownership index OFF the request path. The first settings read
	// would otherwise pay the package scan (a few hundred ms) inside the HTTP
	// handler, and the scan only has to happen once per TTL.
	try {
		setTimeout(() => {
			try {
				rebuildOwnershipIndex();
			} catch {}
		}, 1500).unref?.();
	} catch {}
	const tools = ctx.tools;

	// name -> { name, definition, live, originalBytes }. Read by both search
	// tools, so it is shared state rather than a per-tool closure.
	const seen = new Map();

	// Usage counters live at MODULE scope (see USAGE below), not in this
	// closure. That is load-bearing: saving anything on the settings page
	// restarts this plugin fiber, so `apply()` runs again from scratch and a
	// closure-scoped counter was zeroed on every edit — which made the "×N"
	// badge look broken. Module scope survives the restart and still resets
	// when the Host process restarts, which is the scope these numbers mean.

	// If the plugin was activated with enabled:false, we still keep the
	// settings route alive and register seen tools so the Web GUI settings card
	// remains functional, can display tools and switch states, and can be re-enabled.
	// But reduction, prompt notices, and tool wrapping are suspended.
	if (!config.enabled) {
		ctx.logger?.info?.("tool-control: disabled by config; tool schemas unchanged");
	}

	/**
	 * Resolve the reduction mode for one tool.
	 *
	 * Precedence, highest first:
	 *   1. `toolModes[name]` — an explicit per-tool choice made in the settings
	 *      card. It must beat the rules, or picking "keep resident" for an MCP
	 *      tool would be silently undone by `deferMcpPrefixes: ["mcp__"]`.
	 *   2. `passthrough` — the operator's always-resident list.
	 *   3. `deferNames` → `deferMcpPrefixes` → `deferPatterns` → size threshold;
	 *      first match wins.
	 *   4. `fallbackMode` — the catch-all for a tool that matched nothing. This
	 *      is what covers tools contributed by plugins this installation has
	 *      never seen; it defaults to "full" so nothing is hidden by surprise.
	 *
	 * Takes a NAME plus an optional schema rather than a full definition,
	 * because it is called from three places with different shapes in hand: the
	 * registration hook (full definition), the assembly waterfall (the detached
	 * schema the prompt carries), and the settings route (name only).
	 *
	 * @param toolName - the tool's registered name.
	 * @param definition - the tool's schema/definition, when the size threshold
	 *   matters. Omitted by callers that only need name-based rules.
	 */
	const modeFor = (toolName, definition) => {
		// run_code is the execution transport for PTC mode; it must never be
		// reduced or hidden under any circumstances.
		if (toolName === "run_code") return "full";
		// Chat-side overrides beat the persisted row. This is what lets a
		// `tool_control set_mode` take effect on the very NEXT request: the row on
		// disk only changes after a fiber restart, which the caller cannot wait for.
		const override = LIVE_OVERRIDES.toolModes.get(toolName);
		if (override !== undefined && MODES.has(override)) return override;

		// Read live config dynamically if available
		const liveSource = ctx.fiber?.config || rawConfig;
		const liveToolModes = getLiveField(liveSource, "toolModes", undefined);
		let pinned;
		if (liveToolModes && typeof liveToolModes === "object" && !Array.isArray(liveToolModes)) {
			pinned = liveToolModes[toolName];
			if (pinned !== undefined && !MODES.has(pinned)) pinned = undefined;
		}
		if (pinned === undefined) {
			pinned = config.toolModes.get(toolName);
		}
		if (pinned !== undefined) return pinned;

		if (config.passthrough.has(toolName)) return "full";
		if (config.deferNames.has(toolName)) return config.deferNames.get(toolName);
		for (const { prefix, mode } of config.deferMcpPrefixes) {
			if (toolName.startsWith(prefix)) return mode;
		}
		for (const { regex, mode } of config.deferPatterns) {
			if (regex.test(toolName)) return mode;
		}
		if (
			config.minSchemaBytes > 0 &&
			definition !== undefined &&
			schemaBytes(definition) >= config.minSchemaBytes
		) {
			return config.mode;
		}

		if (LIVE_OVERRIDES.fallbackMode !== undefined) return LIVE_OVERRIDES.fallbackMode;
		const liveFallback = getLiveField(liveSource, "fallbackMode", undefined);
		if (liveFallback && MODES.has(liveFallback)) {
			return liveFallback;
		}
		return config.fallbackMode;
	};

	/** Whether an explicit choice — persisted row or chat override — covers a tool. */
	const isPinned = (toolName) =>
		LIVE_OVERRIDES.toolModes.has(toolName) || config.toolModes.has(toolName);

	/**
	 * Apply an in-process override produced by the `tool_control` agent tool.
	 *
	 * A mode of `undefined` means "drop the override" (that is what `reset`
	 * does), which is distinct from "leave it alone"; a persisted map never
	 * carries `undefined` values.
	 */
	const applyOverride = (change = {}) => {
		for (const [toolName, mode] of Object.entries(change.toolModes ?? {})) {
			if (mode === undefined) LIVE_OVERRIDES.toolModes.delete(toolName);
			else LIVE_OVERRIDES.toolModes.set(toolName, mode);
		}
		if (change.fallbackMode !== undefined) LIVE_OVERRIDES.fallbackMode = change.fallbackMode;
	};

	const originalRegister = tools.register;

	/**
	 * The collapsed `parameters` a reduced tool shows instead of its real
	 * argument schema.
	 *
	 * `type: "object"` plus an explicit (empty) `properties` map is the one shape
	 * every validator accepts, and it is mandatory rather than cosmetic: strict
	 * upstreams reject any `parameters` that is not an object schema, and one bad
	 * tool poisons the whole request. `additionalProperties: true` keeps runtime
	 * argument validation permissive — the model reads the real schema through
	 * `tool_search` before calling.
	 *
	 * @param toolName - the tool this pointer belongs to.
	 * @returns the wire-compliant placeholder schema.
	 */
	const pointerParameters = (toolName) => ({
		type: "object",
		properties: {},
		additionalProperties: true,
		description:
			"Arguments not shown to save context. Call tool_search { query: \"" +
			toolName +
			"\", details: true } to read this tool's full parameter schema before calling it.",
	});

	/**
	 * Build the `seen` record: the catalog entry `tool_search` / `tool_catalog`
	 * read, and the source of truth for the ORIGINAL definition.
	 *
	 * This no longer tracks a "reduced shape", because reduction is applied at
	 * assembly time by the waterfall rather than at registration time — the
	 * registry only ever holds the provider's own definition. What a record
	 * needs is therefore just the original, plus the disposer that lets the
	 * catalog forget the tool when its owner removes it.
	 *
	 * @param toolName - the registered name.
	 * @param definition - the provider's original definition.
	 * @param source - source plugin name or MCP server identifier.
	 */
	const recordOf = (toolName, definition, source, scope) => ({
		name: toolName,
		// The ORIGINAL definition. `tool_search details:true` must read back the
		// real parameter schema, and the waterfall shapes its prompt surface —
		// reading a collapsed surface here would make both jobs impossible.
		definition,
		// Identified source plugin or MCP server, displayed in settings.
		source: source || resolveToolSource(toolName),
		// Scope the definition was seen in (undefined = global). Adoption keeps
		// this so a later tools/change can verify the owner is still enabled.
		scope,
		// True only for records adopted from the wire rather than captured by
		// the register hook; those have no disposer of their own to remove them.
		adopted: false,
		// The disposer of the live registration, so the catalog can be trimmed
		// when the owning plugin withdraws the tool.
		live: undefined,
		// Cost accounting: the full size the model WOULD pay without the control.
		// The reduced size depends on the mode, which is resolved per assembly.
		originalBytes: schemaBytes(definition),
	});

	/**
	 * The model-facing schema for one mode, computed from a DETACHED schema —
	 * the `{name, description, parameters}` shape the prompt assembly carries.
	 *
	 * This is the authoritative reduction, applied by the `system-prompt/assemble`
	 * waterfall to whatever the model is about to be sent. It deliberately does
	 * NOT touch the registry, which is what makes it order-independent: a tool
	 * registered by a provider before this plugin activated is reduced exactly
	 * like one registered after, because the reduction happens at assembly time
	 * rather than at registration time.
	 *
	 * Execution is untouched by construction: the registry still holds the
	 * provider's original definition, so a call dispatches to the real body and
	 * the real validation. Only what the model READS changes — and that holds
	 * even for `hidden`, which removes the entry from the wire entirely.
	 *
	 * @param mode - resolved reduction mode.
	 * @param schema - the detached schema from the assembly.
	 * @returns the schema to send, `undefined` to omit the tool from the wire
	 *   (`hidden`), or the input unchanged (`full`).
	 */
	const reduceSchema = (mode, schema) => {
		const { deferLoading: _stripped, ...rest } = schema;
		switch (mode) {
			// API-level defer: keep everything, tag the flag. Only the DeepSeek
			// Messages adapter honours it; other adapters strip it, silently
			// restoring the full schema — the operator's trade-off to make.
			case "name":
				return { ...rest, deferLoading: true };
			// One-line description, no arguments. The pointer tells the model
			// exactly how to read them back.
			case "stub":
				return {
					...rest,
					description:
						(schema.description ?? "").replace(/\s+/gu, " ").trim().split(/(?<=\.)\s/u)[0]
							?.slice(0, 200) ?? "",
					parameters: pointerParameters(schema.name),
				};
			// Omitting the entry from the wire is what actually saves the space:
			// not even the name is paid for. The tool stays REGISTERED and fully
			// callable — dispatch reads the registry, not this list — so the
			// model can still find it through `tool_search` and call it.
			case "hidden":
			// `disabled` is omitted from the wire for the same reason, and is
			// additionally unregistered and excluded from the catalog wherever
			// the control can still influence the tool (see `patchedRegister`).
			case "disabled":
				return undefined;
			default:
				return schema;
		}
	};

	/**
	 * The registration hook.
	 *
	 * The reduction ITSELF does not happen here — the `system-prompt/assemble`
	 * waterfall owns that, and is what makes the plugin order-independent. This
	 * hook exists only to keep `seen` (the catalog that `tool_search` /
	 * `tool_catalog` read) complete and to capture each provider's ORIGINAL
	 * definition, which is what `tool_search { details: true }` hands back and
	 * what the waterfall shapes from.
	 *
	 * The definition is registered UNCHANGED. The registry must keep the real
	 * body and the real validation so a call dispatches normally.
	 */
	const patchedRegister = function register(definition, options) {
		const toolName = definition?.name;
		// Pass the registration options through untouched. The second argument
		// carries the activation condition (when) the registry stores next to the
		// definition; dropping it made a conditional tool appear active always.
		if (typeof toolName !== "string") return originalRegister.call(this, definition, options);

		const owner = this.ctx?.fiber?.name || this.ctx?.name;
		const source = resolveToolSource(toolName, owner);
		const record = recordOf(toolName, definition, source);
		seen.set(toolName, record);

		// `disabled` means NOT REGISTERED AT ALL: the model cannot see it, cannot
		// call it, and `tool_search` does not report it. That is strictly
		// stronger than `hidden`, which only removes it from the prompt.
		//
		// It is applied here as well as in the assembly waterfall because the two
		// mechanisms cover different tools: this covers everything registered
		// AFTER the control (the common case), while the waterfall covers tools that
		// registered before it and therefore cannot be un-registered.
		if (modeFor(toolName, definition) === "disabled") {
			record.disabled = true;
			ctx.logger?.info?.(`tool-control: not registering "${toolName}" (disabled by configuration)`);
			// A no-op disposer: the caller's cleanup must still succeed.
			return () => {
				if (seen.get(toolName) === record) seen.delete(toolName);
			};
		}

		record.live = originalRegister.call(this, definition, options);

		// The caller's disposer must drop the registration AND forget the
		// record, so the catalog cannot advertise a tool its owner removed.
		return () => {
			record.live?.();
			if (seen.get(toolName) === record) seen.delete(toolName);
		};
	};

	// One effect owns the whole install: the register hook, the assembly
	// waterfall, and both search tools. Disabling the plugin therefore restores
	// `register`, stops the reduction, and unregisters the pair in a single
	// teardown, with no ordering hazard.
	const disposers = [];
	let installed = false;
	/** Tear the hook, the waterfall and the search pair down. Idempotent. */
	const uninstall = () => {
		if (!installed) return;
		installed = false;
		tools.register = originalRegister;
		for (const dispose of disposers.reverse()) dispose();
		disposers.length = 0;
	};
	ctx.effect(() => {
		tools.register = patchedRegister;
		installed = true;
		if (config.enabled) {
			disposers.push(
				tools.register(
					createSearchTool({
						entries: () => [...seen.values()],
						modeOf: (name, definition) => modeFor(name, definition),
					}),
				),
			);
			disposers.push(
				tools.register(
					createCatalogTool({
						entries: () => [...seen.values()],
						modeOf: (name, definition) => modeFor(name, definition),
					}),
				),
			);
			disposers.push(
				tools.register(
					createControlTool({
						config,
						entries: () => [...seen.values()],
						modeOf: (name, definition) => modeFor(name, definition),
						pinnedOf: (name) => isPinned(name),
						override: (change) => applyOverride(change),
						persist: (change) => persistControlConfig(ctx, change),
						probe: () => surfaceProbe(),
					}),
				),
			);
		}
		return uninstall;
	}, "tool-control.install");

	// ---------------------------------------------------------------------
	// The reduction seam: `system-prompt/assemble`.
	//
	// This is the reason the plugin no longer cares about activation order.
	// `dsh-system-prompt` runs a waterfall over the finished assembly on EVERY
	// request, and that assembly carries the exact `{name, description,
	// parameters}` list the model is about to be sent. Transforming it there
	// reaches every tool on the surface, including ones registered synchronously
	// by a provider that activated first — the case a register-wrapper can never
	// cover, because the registry rejects a duplicate name
	// ("tool "x" is already registered"), so a missed tool cannot be
	// retro-fitted and cannot be re-registered under a reduced definition.
	//
	// Reducing here also makes a settings-page mode change take effect
	// immediately: the next assembly resolves the mode afresh from the live
	// config, with no re-registration and no restart.
	// ---------------------------------------------------------------------
	ctx.effect(
		() =>
			ctx.on("system-prompt/assemble", async (initialAssembly, context, next) => {
				const assembly = typeof next === "function" ? await next() : initialAssembly;
				// The finished assembly carries the whole surface, so it is also the
				// most complete catalog feed the plugin ever gets: adopting here is
				// what keeps `tool_search` whole across a fiber restart.
				const adoptionScope = context?.scope;
				// A PTC executor contributed after this plugin activated is only
				// reachable here; wrapping is idempotent, so this is the retry point.
				ensureSdkRenderer();
				if (!config.enabled) return assembly;
				if (!Array.isArray(assembly?.tools) || assembly.tools.length === 0) return assembly;
				let changed = false;
				const reduced = [];
				for (const schema of assembly.tools) {
					adopt(schema, adoptionScope);
					const mode = modeFor(schema.name, schema);
					if (mode === "full") {
						reduced.push(schema);
						continue;
					}
					const shaped = reduceSchema(mode, schema);
					// `hidden` yields undefined: the entry is dropped from the
					// wire outright. Omitting it here does NOT unregister the
					// tool — dispatch resolves through the registry, so a
					// `tool_search` hit stays callable.
					if (shaped === undefined) {
						changed = true;
						continue;
					}
					if (shaped !== schema) changed = true;
					reduced.push(shaped);
				}
				// Ordering is independent of reduction: a session with every
				// tool at "full" still honours a manual prompt order, so the
				// early return below must only skip the WORK, not the order.
				const ordered = applyManualOrder(reduced, config.toolOrder);
				if (!changed && ordered === reduced) return assembly;
				// The harness sorts tools by name BEFORE this waterfall and uses
				// the result verbatim, so imposing the order here is what makes
				// the card's manual order reach the model.
				return { ...assembly, tools: ordered };
			}),
		"tool-control.reduce",
	);

	// ---------------------------------------------------------------------
	// PTC mode presentation support.
	//
	// In PTC mode the native schemas are omitted from `assembly.tools`, so the
	// whole tool surface is the generated `tools:sdk` prompt section — that text,
	// not the wire list, is what the control has to shrink.
	//
	// Which method renders it depends on the Host build:
	//
	//   - older 0.1.x: `render(tools.sdkSchemas(scope))` on the registry;
	//   - newer 0.2.x: the PTC executor's `renderSdk(definitions)`, fed from
	//     `tools.definitions(scope, toolSet)` inside the section closure.
	//
	// Neither is reachable by patching only the object this plugin holds —
	// measured 2026-11-11: `tools:sdk` stayed at 86 370 characters with all 18
	// hidden tools still declared in full. So wrap the PROTOTYPE as well (one
	// class, every instance) and count the calls: `tool_control stats` then reports
	// whether the control is on the render path instead of leaving it to guesswork.
	//
	// `renderSdk` is the only safe seam of the two: `tools.definitions()` also
	// feeds the `run_code` bindings, so gating THAT would drop `hidden` tools from
	// the program surface — they must stay callable, only their prompt text goes.
	// ---------------------------------------------------------------------
	const sdkWraps = [];
	/** One definition reduced for the wire; `undefined` means "omit it". */
	const shapeDefinition = (definition) => {
		if (definition?.name === "run_code") return definition;
		const mode = modeFor(definition?.name, definition);
		if (mode === "hidden" || mode === "disabled") return undefined;
		if (mode === "stub") {
			return {
				...definition,
				description: summarise(definition.description),
				parameters: pointerParameters(definition.name),
			};
		}
		return definition;
	};
	const wrapSdkRenderer = (holder, key, label) => {
		if (holder === undefined || holder === null) return false;
		const original = holder[key];
		if (typeof original !== "function" || original.__toolControl === true) return false;
		const wrapped = function sdkControl(...args) {
			if (!config.enabled) return original.apply(this, args);

			// Seam 1: PtcExecutor.renderSdk(tools) where args[0] is an array of definitions.
			// renderSdk returns a formatted string, so we must shape args[0] BEFORE calling original.
			if (key === "renderSdk" || (Array.isArray(args[0]) && args[0].length >= 0)) {
				const toolsArg = args[0];
				if (Array.isArray(toolsArg)) {
					SDK_GATE.calls += 1;
					SDK_GATE.seenCount += toolsArg.length;
					const shaped = [];
					for (const item of toolsArg) {
						adopt(item, undefined, false);
						const definition = shapeDefinition(item);
						if (definition !== undefined) shaped.push(definition);
					}
					SDK_GATE.emittedCount += shaped.length;
					return original.apply(this, [shaped, ...args.slice(1)]);
				}
			}

			// Seam 2: older tools.sdkSchemas(scope) where original returns an array of definitions.
			const result = original.apply(this, args);
			if (!Array.isArray(result)) return result;
			SDK_GATE.calls += 1;
			SDK_GATE.seenCount += result.length;
			const shaped = [];
			for (const item of result) {
				adopt(item, undefined, false);
				const definition = shapeDefinition(item);
				if (definition !== undefined) shaped.push(definition);
			}
			SDK_GATE.emittedCount += shaped.length;
			return shaped;
		};
		wrapped.__toolControl = true;
		holder[key] = wrapped;
		sdkWraps.push({ holder, key, original });
		SDK_GATE.installedOn.push(label);
		return true;
	};
	/** Every executor record the registry holds: the root one and the scoped ones. */
	const executorRecords = () => {
		const records = [];
		try {
			if (tools.root !== undefined) records.push(tools.root);
		} catch {}
		try {
			const scoped = tools.scoped;
			if (scoped !== undefined && typeof scoped.values === "function") records.push(...scoped.values());
		} catch {}
		return records;
	};

	/** Wrap one executor instance and its class, whichever the renderer calls. */
	const wrapExecutor = (executor) => {
		if (executor === undefined || executor === null) return;
		try {
			const proto = Object.getPrototypeOf(executor);
			if (proto !== undefined && proto !== null) wrapSdkRenderer(proto, "renderSdk", "renderSdk(prototype)");
		} catch {}
		wrapSdkRenderer(executor, "renderSdk", "renderSdk(instance)");
	};

	/**
	 * Catch an executor that is registered AFTER this plugin activated.
	 *
	 * `setExecutor` is the single entry point for a PTC executor, and the
	 * registering plugin may well activate later than this one, so the hook has
	 * to stay installed rather than being a one-shot scan.
	 */
	const patchSetExecutor = () => {
		const holders = [tools];
		try {
			const proto = Object.getPrototypeOf(tools);
			if (proto !== null && proto !== Object.prototype) holders.push(proto);
		} catch {}
		for (const holder of holders) {
			const original = holder.setExecutor;
			if (typeof original !== "function" || original.__toolControl === true) continue;
			const wrapped = function setExecutor(executor) {
				wrapExecutor(executor);
				return original.apply(this, arguments);
			};
			wrapped.__toolControl = true;
			holder.setExecutor = wrapped;
			sdkWraps.push({ holder, key: "setExecutor", original });
			SDK_GATE.bootstrapped.push(holder === tools ? "setExecutor(instance)" : "setExecutor(prototype)");
		}
	};

	/**
	 * Get the control onto the PTC SDK render path, whichever seam this Host has.
	 *
	 * Three attempts, because the executor can be contributed by a plugin that
	 * activates later and registered per scope rather than globally:
	 *
	 *   1. `selectExecutor()` — the root selection, when this Host exposes one;
	 *   2. every record already in the registry (`root` + `scoped`), which is the
	 *      only way to reach a preset-scoped executor;
	 *   3. a `setExecutor` hook for the ones that appear later.
	 *
	 * All of it is best-effort: no PTC deployment means no executor, and the control
	 * simply has nothing to wrap.
	 */
	const ensureSdkRenderer = () => {
		if (typeof tools.selectExecutor === "function") {
			try {
				wrapExecutor(tools.selectExecutor(undefined));
			} catch {}
			try {
				wrapExecutor(tools.selectExecutor("ptc"));
			} catch {}
		}
		for (const record of executorRecords()) wrapExecutor(record?.executor);
		patchSetExecutor();

		// Directly resolve and wrap PtcExecutor.prototype from the host's ptc executor package
		try {
			const { createRequire } = process.getBuiltinModule?.("module") ?? {};
			if (createRequire) {
				for (const candidate of [process.argv[1], process.argv[2], process.cwd()]) {
					if (!candidate) continue;
					try {
						const req = createRequire(candidate);
						const ptcMod = req("@deepseek-ai/dsh-tool-executor-ptc");
						if (ptcMod?.PtcExecutor?.prototype) {
							wrapExecutor(ptcMod.PtcExecutor.prototype);
							break;
						}
					} catch {}
				}
			}
		} catch {}
	};

	/** One-line description of what this Host exposes, for `tool_control stats`. */
	const surfaceProbe = () => {
		const parts = [];
		const typeOf = (key) => {
			try {
				return typeof tools[key];
			} catch {
				return "throw";
			}
		};
		for (const key of ["register", "schemas", "definitions", "selectExecutor", "setExecutor", "sdkSchemas"]) {
			parts.push(`${key}=${typeOf(key)}`);
		}
		const executors = executorRecords().filter((record) => record?.executor !== undefined);
		parts.push(`executors=${executors.length}`);
		const first = executors[0]?.executor;
		if (first !== undefined) {
			parts.push(`renderSdk=${typeof first.renderSdk}`);
			parts.push(`renderSdkWrapped=${first.renderSdk?.__toolControl === true}`);
		}
		return parts.join(" ");
	};

	ctx.effect(() => {
		try {
			ensureSdkRenderer();
			wrapSdkRenderer(tools, "sdkSchemas", "sdkSchemas(instance)");
			const proto = Object.getPrototypeOf(tools);
			if (proto !== null && proto !== Object.prototype) {
				wrapSdkRenderer(proto, "sdkSchemas", "sdkSchemas(prototype)");
			}
		} catch (error) {
			ctx.logger?.warn?.(`tool-control: could not wrap the SDK renderer: ${error?.message ?? error}`);
		}
		return () => {
			for (const { holder, key, original } of sdkWraps.reverse()) {
				if (holder[key]?.__toolControl === true) holder[key] = original;
			}
			sdkWraps.length = 0;
			SDK_GATE.installedOn.length = 0;
		};
	}, "tool-control.ptc-sdk");

	/**
	 * Adopt one live definition into the catalog if it is not there yet.
	 *
	 * `tools.schemas(undefined)` only enumerates the GLOBAL layer, so a fiber
	 * restart (every settings save performs one) used to leave the catalog with
	 * just the unscoped tools — 25 of 66 here — after which `tool_search` could
	 * no longer find `read`, `bash`, or anything else an agent scope registered.
	 * The assembly waterfall and the PTC SDK projection both carry the complete
	 * surface on every request, so they are the reliable feeds.
	 *
	 * @param schema - a model-facing schema seen on the wire.
	 * @param scope - the scope that produced it; `tools.get` prefers the
	 *   provider definition over the projection whenever one is visible.
	 */
	const adopt = (schema, scope, verifiable = true) => {
		const toolName = schema?.name;
		if (typeof toolName !== "string" || seen.has(toolName)) return;
		let definition = schema;
		try {
			definition = tools.get(toolName, scope) ?? schema;
		} catch {}
		const record = recordOf(toolName, definition, resolveToolSource(toolName), scope);
		// Adopted records have no register-hook disposer behind them. Mark them
		// so sweep() can drop one after its owner stops exposing it.
		record.adopted = true;
		// The PTC SDK projection carries scoped tools without their ScopeKey, so
		// the registry cannot be asked for them later. Keep such rows rather than
		// deleting every scoped tool on the next tools/change.
		record.verifiable = verifiable;
		seen.set(toolName, record);
	};

	// ---------------------------------------------------------------------
	// Keep the catalog in step with the live surface.
	//
	// The register hook above sees everything registered after this plugin
	// activated — including MCP tools, which `dsh-mcp-client` publishes on a
	// promise chain after its connect + `tools/list` round trip. Tools that
	// were ALREADY registered when this plugin activated never pass through
	// that hook, so they are adopted here instead.
	//
	// Adoption is only for the CATALOG (what `tool_search` can find and what
	// `tool_search { details: true }` can describe). Reduction does not depend
	// on it: the assemble waterfall reaches every tool on the surface whether
	// or not a record exists. That separation is precisely why activation order
	// no longer matters.
	// ---------------------------------------------------------------------

	/**
	 * Drop adopted records whose owner no longer exposes the tool.
	 *
	 * Records captured by the register hook carry their own disposer and remove
	 * themselves. Records adopted from the wire (because they existed before
	 * this plugin activated) have no such disposer: when that plugin is
	 * disabled or unloaded, the tool disappears from the registry but stays in
	 * `seen` — the card keeps listing it, and `tool_search` keeps advertising
	 * it, exactly like a section from a disabled plugin in prompt-control.
	 *
	 * Ask the registry for the definition in the scope it was adopted from.
	 * Keeping the record on an exception is deliberate: a transient lookup
	 * failure must not erase a valid catalog row.
	 */
	const reconcile = () => {
		for (const [toolName, record] of seen) {
			if (record.adopted !== true || record.verifiable === false) continue;
			let live = false;
			try {
				live = tools.get(toolName, record.scope) !== undefined;
			} catch {
				live = true;
			}
			if (!live && seen.get(toolName) === record) seen.delete(toolName);
		}
	};

	/**
	 * Adopt one live definition the register hook never saw. Called once at
	 * activation and again on every `tools/change`, so an MCP reconnect — which
	 * swaps its whole generation — cannot leave the catalog stale. Reconcile
	 * afterwards so a plugin that went away is dropped, not merely left behind.
	 */
	const sweep = () => {
		try {
			for (const schema of tools.schemas(undefined) ?? []) adopt(schema, undefined);
		} catch (error) {
			ctx.logger?.warn?.(
				`tool-control: could not enumerate the tool surface: ${error?.message ?? error}`,
			);
		}
		reconcile();
	};

	sweep();

	ctx.effect(
		() =>
			ctx.on("tools/change", () => {
				sweep();
			}),
		"tool-control.change-tracking",
	);

	// ---------------------------------------------------------------------
	// Per-tool call counting.
	//
	// The settings card sorts by real usage by default: the tools a deployment
	// actually calls are the ones worth keeping resident, and that is not
	// something a static heuristic can know. `dsh-agent-loop` appends a
	// `tool/call` session event for every model-issued call, so subscribing to
	// `session/event` counts them without wrapping tool execution (which would
	// double-count PTC nested dispatch).
	//
	// Counts are in-memory: they describe "this run", which is the honest
	// scope. They reset when the Host restarts, and the card labels them as
	// such rather than implying lifetime totals.
	// ---------------------------------------------------------------------
	ctx.effect(
		() =>
			ctx.on("session/event", (_session, event) => {
				// `tool/call` is the model's own request to run a tool; the
				// matching `tool/result` is not counted, or every call would
				// count twice.
				if (event?.type !== "tool/call") return;
				const name = event?.data?.name;
				if (typeof name !== "string" || name.length === 0) return;
				USAGE.liveCounts.set(name, (USAGE.liveCounts.get(name) ?? 0) + 1);
				USAGE.ticks += 1;
				USAGE.lastCallAt.set(name, USAGE.ticks);
			}),
		"tool-control.call-counting",
	);

	/**
	 * Read the agent presets and their compositions.
	 *
	 * A preset is a named plugin composition. When inspecting presets:
	 *   - "minimal" mounts only shell tools (bash/pwsh), not fs/web/subagent.
	 *   - "ptc" runs tools via TypeScript/Python SDK in run_code; workflow is disabled.
	 *   - "standard" / "cordis" mount standard tools.
	 *
	 * The registry is optional: a deployment without it simply gets no preset
	 * data, and the card omits those chips.
	 *
	 * @returns a promise of `{ id, name, allow, content }[]`.
	 */
	const readPresets = async () => {
		// `get(name, false)` is the non-strict lookup: the preset registry is
		// optional, and reading `ctx.agentPresets` directly would THROW on a
		// deployment that does not provide it (Cordis requires `inject` for
		// property access). A missing registry simply yields no preset chips.
		const service = ctx.get("agentPresets", false);
		if (service === undefined || typeof service.list !== "function") return [];
		let rows;
		try {
			rows = await service.list();
		} catch {
			return [];
		}
		if (!Array.isArray(rows)) return [];
		const result = [];
		for (const row of rows) {
			if (row === null || typeof row !== "object") continue;
			const id = typeof row.id === "string" ? row.id : undefined;
			if (id === undefined) continue;
			let allow = null;
			let content = "";
			try {
				const detail = typeof service.readDocument === "function"
					? await service.readDocument(id)
					: (typeof service.read === "function" ? await service.read(id) : undefined);
				content = typeof detail?.content === "string" ? detail.content : "";
				allow = toolAllowlistOf(content);
			} catch {
				allow = null;
				content = "";
			}
			result.push({
				id,
				name: typeof row.name === "string" ? row.name : id,
				allow,
				content,
			});
		}
		return result;
	};

	// ---------------------------------------------------------------------
	// The settings card's data source.
	//
	// The card needs the LIVE tool list — names, sizes, resolved modes — which
	// `configForms` cannot supply: that service carries schema-backed config
	// fields only. So the Host serves it over an HTTP route, the same way
	// `dsh-context` feeds its panels.
	//
	// Serving it per request (rather than caching a snapshot) is what makes a
	// NEWLY INSTALLED plugin appear in the picker without a restart: the list
	// is read from the registry at the moment the card asks.
	// ---------------------------------------------------------------------
	ctx.inject(["connection"], (scoped) => {
		const connection = scoped.get("connection");
		const register = connection?.fetch?.register;
		if (typeof register !== "function") return;

		scoped.effect(
			() =>
				register.bind(connection.fetch)({
					path: SETTINGS_ROUTE,
					methods: ["POST"],
					requestBody: "buffered",
					fetch: async (request) => {
						let body = {};
						try {
							if (request && typeof request.json === "function") {
								body = await request.json();
							}
						} catch {}

						if (body?.action === "scan-history") {
							const hist = scanHistoricalUsage();
							USAGE.historyCounts = hist.counts;
							USAGE.historyStats = {
								totalSessions: hist.totalSessions,
								totalCalls: hist.totalCalls,
							};
						}

						// The card is read on demand, so also reconcile immediately
						// instead of waiting for a tools/change notification.
						reconcile();
						const presets = await readPresets();
						// Manual prompt order, from the per-tool order map. A tool
						// with no entry sorts after every ordered tool.
						const orderIndex = new Map();
						for (const [position, toolName] of config.toolOrder.entries()) {
							orderIndex.set(toolName, position);
						}
						const rows = [];
						for (const entry of seen.values()) {
							const toolName = entry.name;
							// Which presets expose this tool.
							const usedIn = [];
							for (const preset of presets) {
								if (isToolInPreset(toolName, preset.id, preset.content)) {
									usedIn.push(preset.name);
								}
							}
							rows.push({
								name: toolName,
								// Resolved against the CURRENT config, so the card
								// shows what the next request will actually send.
								mode: modeFor(toolName, entry.definition),
								// What this tool costs when resident, so the card
								// can show what hiding it saves.
								bytes: entry.originalBytes ?? 0,
								description: summarise(entry.definition?.description),
								// Whether an explicit override exists, so the card
								// can distinguish a pinned choice from a rule match.
								pinned: isPinned(toolName),
								source: entry.source || resolveToolSource(toolName),
								// Usage signals for the default sort: live + history.
								calls: USAGE.totalCalls(toolName),
								lastCall: USAGE.lastCallAt.get(toolName) ?? 0,
								// Presets whose tool set includes this tool.
								presets: usedIn,
								// Manual position in the prompt, or null.
								order: orderIndex.has(toolName) ? orderIndex.get(toolName) : null,
							});
						}
						// Default ordering mirrors the card's default sort, so a
						// fresh load already reads most-used-first.
						rows.sort(
							(a, b) =>
								b.calls - a.calls ||
								b.lastCall - a.lastCall ||
								a.name.localeCompare(b.name),
						);
						let promptBytes = 0;
						let fullBytes = 0;
						let reducedCount = 0;
						for (const entry of seen.values()) {
							const toolName = entry.name;
							const mode = modeFor(toolName, entry.definition);
							const orig = entry.originalBytes ?? 0;
							fullBytes += orig;
							if (mode === "full") {
								promptBytes += orig;
							} else if (mode === "name") {
								promptBytes += orig; // name mode sends full schema with deferLoading
							} else if (mode === "stub") {
								reducedCount += 1;
								const shaped = reduceSchema("stub", summariseSchema(entry.definition));
								promptBytes += schemaBytes(shaped);
							} else if (mode === "hidden" || mode === "disabled") {
								reducedCount += 1;
								// omitted from prompt
							}
						}
						// Search pair added when enabled and at least one tool reduced
						if (config.enabled && reducedCount > 0) {
							// search pair schema approx size (~1.5KB / ~400 tokens)
							promptBytes += 1500;
						}
						const approxTokens = (b) => Math.round(b / 3.8);
						const promptTokens = approxTokens(promptBytes);
						const fullTokens = approxTokens(fullBytes);
						const savedTokens = Math.max(0, fullTokens - promptTokens);
						const savedPercent = fullTokens > 0 ? Math.round((savedTokens / fullTokens) * 100) : 0;
						const contextStats = {
							fullBytes,
							promptBytes,
							fullTokens,
							promptTokens,
							savedTokens,
							savedPercent,
						};

						return Response.json(
							{
								ok: true,
								value: {
									tools: rows,
									fallbackMode: config.fallbackMode,
									globalMode: config.mode,
									passthrough: [...config.passthrough],
									toolOrder: [...config.toolOrder],
									historyStats: USAGE.historyStats,
									contextStats,
									// Every preset name, so the card can label an
									// unrestricted preset once instead of per row.
									presets: presets.map((preset) => ({
										id: preset.id,
										name: preset.name,
										restricted:
											preset.allow !== null ||
											preset.id === "minimal" ||
											preset.id === "ptc",
									})),
								},
							},
							{ headers: { "cache-control": "no-store" } },
						);
					},
				}),
			"tool-control: settings route",
		);
	});

	// Tell the model that its tool list is filtered and how to reach the rest.
	// Without this the reduced surface reads as a complete catalog, and the
	// model answers "I have no such tool" for a capability that is one search
	// away.
	//
	// Every reduced tool is CALLABLE — that is the whole point of the design.
	// The two states differ only in how much reaches the model up front:
	//
	//   stub / name ("summarised") — name + one-line summary on the wire; the
	//                                argument schema must be searched.
	//   hidden ("omitted")         — NOT on the wire at all. The name is not
	//                                shown either, so `tool_search` /
	//                                `tool_catalog` are the ONLY way to learn
	//                                the tool exists — which makes this
	//                                paragraph load-bearing rather than a hint.
	//
	// Neither is a revocation, so the notice never tells the model a tool is
	// unavailable. For `hidden` it must ALSO not pretend the list is complete:
	// the model cannot see a name to look up, so it has to be told that a
	// search is the discovery step.
	//
	// The text is recomputed per assembly, so it tracks the live surface (and
	// the live mode) instead of freezing at activation time.
	if (config.promptNotice && config.enabled) {
		ctx.effect(
			() =>
				ctx.systemPrompt.section({
					name: "tool-control:deferred",
					order: 10_000,
					text: () => {
						// Modes are resolved HERE, per assembly, from the live
						// config — `seen` holds the original definitions (the
						// reduction happens in the assemble waterfall), so the
						// record cannot cache the mode without going stale on a
						// settings-page change.
						const summarised = [];
						const omitted = [];
						for (const entry of seen.values()) {
							const mode = modeFor(entry.name, entry.definition);
							if (mode === "stub" || mode === "name") summarised.push(entry.name);
							else if (mode === "hidden") omitted.push(entry.name);
						}
						if (summarised.length === 0 && omitted.length === 0) return "";

						const list = (names) =>
							`${names.slice(0, 6).join(", ")}${names.length > 6 ? ", ..." : ""}`;
						const lines = [];

						if (summarised.length > 0) {
							lines.push(
								"This session's tool list is filtered to save context: " +
									`${summarised.length} tool(s) show only a one-line summary (for example: ` +
									`${list(summarised)}). They are fully callable: read the exact arguments ` +
									"with `tool_search { query: \"<name>\", details: true }` and then call them " +
									"by name as usual. Guessing the arguments is the main cause of failure here.",
							);
						}

						if (omitted.length > 0) {
							lines.push(
								`${omitted.length} further tool(s) are NOT in your tool list at all — their ` +
									"names are hidden too, to save context. This is NOT a disable list: every " +
									"one of them is registered and fully callable. Because you cannot see their " +
									"names, `tool_search` is how you DISCOVER them: describe what you want to " +
									"do (e.g. `tool_search { query: \"screenshot click\" }`, or `tool_catalog` " +
									"for the complete name index), then call `tool_search` with the tool's name " +
									"and `details: true` to read its exact arguments, then call it normally. " +
									"Before telling the user a capability is unavailable, search for it first.",
							);
						}

						// Multi-keyword guidance lives in the prompt too: the
						// model searches far better when it knows that extra
						// words broaden rather than restrict.
						lines.push(
							"Search tips: `tool_search` accepts several space-separated keywords in one " +
								"call (any keyword may match, best coverage first), so try `query: \"click " +
								"screenshot\"` rather than one word at a time; add `details: true` to get " +
								"callable argument schemas, and `deferOnly: true` to search only the tools " +
								"whose specifications are not currently shown to you.",
						);

						return lines.join(" ");
					},
				}),
			"tool-control.notice",
		);
	}

	// Report what actually happened, once startup traffic has settled. A timed
	// report is used rather than an immediate log because the MCP tool
	// generation arrives asynchronously: an immediate count would understate
	// coverage and look like a failure.
	ctx.effect(() => {
		const timer = setTimeout(() => {
			const entries = [...seen.values()];
			const approx = (n) => Math.round(n / 4);
			// Sizes are measured by actually shaping each schema under the live
			// config, so the figure reflects what this session will really send
			// rather than a cached snapshot. A `hidden` entry contributes 0:
			// it is dropped from the wire entirely.
			let promptBytes = 0;
			let fullBytes = 0;
			let omitted = 0;
			for (const entry of entries) {
				const mode = modeFor(entry.name, entry.definition);
				fullBytes += entry.originalBytes ?? 0;
				if (mode === "full") {
					promptBytes += entry.originalBytes ?? 0;
					continue;
				}
				const shaped = reduceSchema(mode, summariseSchema(entry.definition));
				if (shaped === undefined) {
					omitted += 1;
					continue;
				}
				promptBytes += schemaBytes(shaped);
			}
			ctx.logger?.info?.(
				`tool-control: ${entries.length} tool(s) tracked` +
					`${omitted > 0 ? `, ${omitted} omitted from the wire (still callable)` : ""}; ` +
					`prompt surface ~${approx(promptBytes)} tokens (was ~${approx(fullBytes)} full). ` +
					"Reduction is applied at assembly time, so it covers tools registered before " +
					"this plugin activated, and a mode change on the settings page takes effect " +
					"on the next request without a restart.",
			);
		}, 5_000);
		timer.unref?.();
		return () => clearTimeout(timer);
	}, "tool-control.report");
}
