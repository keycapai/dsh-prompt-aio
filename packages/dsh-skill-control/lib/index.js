/**
 * dsh-skill-control — Skill 目录管理插件（与 dsh-tool-control 同构的 Skill 版本）
 *
 * 管理模型可见的 <available_skills> 目录：
 *   full     完整保留描述（可按 catalogDescriptionMaxLength 截断）
 *   name     只保留 "- `name`"，描述通过 skill_search details:true 读取
 *   hidden   整行移除，但技能仍可用 skill 工具加载
 *   disabled 整行移除，并丢弃对应的 skill-invocation 注入
 *
 * 模式解析优先级：LIVE_OVERRIDES > 实时 volatile 配置 > 持久化配置 > fallbackMode。
 * 绝不修改 skill-catalog 的 source.entries（dsh-tool-skill 依赖它做目录摘要）。
 *
 * @module dsh-skill-control
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import z from "@deepseek-ai/schemastery";

/** Cordis 插件身份。 */
export const name = "skill-control";

/** tools/systemPrompt 用于注册工具与提示段落；skills 是技能清单服务。 */
export const inject = ["tools", "systemPrompt", "skills"];

const MODES = new Set(["full", "name", "hidden", "disabled"]);

/** 运行时默认值，与 Config schema 保持一致。 */
export const DEFAULT_CONFIG = Object.freeze({
	enabled: true,
	skillModes: {},
	fallbackMode: "full",
	catalogDescriptionMaxLength: 500,
	promptNotice: true,
});

/**
 * 插件配置定义（Schemastery）。五个字段都是 volatile：设置卡片可在不重启
 * fiber 的情况下写入，本插件通过 unwrapVolatile/readConfig 读取实时值。
 */
export const Config = z.object({
	enabled: volatileField(z.boolean().default(true)),
	skillModes: volatileField(z.dict(z.string().loose()).default({}).loose()),
	fallbackMode: volatileField(z.union(["full", "name", "hidden", "disabled"]).default("full").loose()),
	catalogDescriptionMaxLength: volatileField(z.number().default(500)),
	promptNotice: volatileField(z.boolean().default(true)),
});

const SETTINGS_ROUTE = "/api/dsh-skill-control/skills";

/**
 * 调用计数：model = 模型调用 `skill` 工具，user = 用户 `/skill` 手势，history = 历史会话扫描。
 * 计数只在进程内保存；历史扫描提供跨会话的持久信号。
 */
const DURABLE_CATALOG_DIGEST = new WeakMap();
let durableCatalogSerial = 0;

const COUNTED_USER_INVOCATIONS = new Set();

const USAGE = {
	model: new Map(),
	user: new Map(),
	history: new Map(),
	historyStats: { sessions: 0, calls: 0, at: 0 },
};

export function skillCallCounts(name) {
	const model = USAGE.model.get(name) ?? 0;
	const user = USAGE.user.get(name) ?? 0;
	const history = USAGE.history.get(name) ?? 0;
	return { model, user, history, modelCalls: model, userCalls: user, historyCalls: history, calls: model + user + history };
}

function skillNameFromToolEvent(event) {
	if (event?.type !== "tool/call" || event.data?.name !== "skill") return undefined;
	let args = event.data.arguments;
	if (typeof args === "string") { try { args = JSON.parse(args); } catch { return undefined; } }
	return typeof args?.name === "string" && args.name.length > 0 ? args.name : undefined;
}

function decorateSkillUsage(rows) {
	return rows.map((row) => ({ ...row, ...skillCallCounts(row.name) }));
}

export function scanHistoricalSkillUsage(sessionsDir) {
	const dir = sessionsDir || path.join(os.homedir(), ".dsh", "sessions");
	const counts = new Map();
	let sessions = 0;
	let calls = 0;
	if (!fs.existsSync(dir)) return { sessions, calls, counts };
	let workspaces;
	try { workspaces = fs.readdirSync(dir); } catch { return { sessions, calls, counts }; }
	for (const workspace of workspaces) {
		const workspaceDir = path.join(dir, workspace);
		try { if (!fs.statSync(workspaceDir).isDirectory()) continue; } catch { continue; }
		let entries;
		try { entries = fs.readdirSync(workspaceDir); } catch { continue; }
		for (const entry of entries) {
			const sessionDir = path.join(workspaceDir, entry);
			const zst = path.join(sessionDir, "session.v4.jsonl.zstd");
			const jsonl = path.join(sessionDir, "session.v4.jsonl");
			let raw;
			let compressed = false;
			try {
				if (fs.existsSync(zst)) { raw = fs.readFileSync(zst); compressed = true; }
				else if (fs.existsSync(jsonl)) raw = fs.readFileSync(jsonl);
				else continue;
			} catch { continue; }
			sessions += 1;
			let content;
			try {
				if (compressed) {
					if (typeof zlib.zstdDecompressSync !== "function") continue;
					content = zlib.zstdDecompressSync(raw).toString("utf8");
				} else content = raw.toString("utf8");
			} catch { continue; }
			for (const line of content.split("\n")) {
				if (!line.includes('"tool/call"')) continue;
				let event;
				try { event = JSON.parse(line); } catch { continue; }
				const skillName = skillNameFromToolEvent(event);
				if (skillName === undefined) continue;
				counts.set(skillName, (counts.get(skillName) ?? 0) + 1);
				calls += 1;
			}
		}
	}
	return { sessions, calls, counts };
}

function refreshHistoricalUsage() {
	try {
		const result = scanHistoricalSkillUsage();
		USAGE.history = result.counts;
		USAGE.historyStats = { sessions: result.sessions, calls: result.calls, at: Date.now() };
	} catch {}
}

/** 进程内覆盖：skill_control set_mode 的立即生效写入点；apply() 时清空。 */
const LIVE_OVERRIDES = {
	skillModes: new Map(),
	fallbackMode: undefined,
	clear() {
		this.skillModes.clear();
		this.fallbackMode = undefined;
	},
};

/** 本进程观测到的 skill-catalog 条目，供设置卡片使用。 */
const OBSERVED_ENTRIES = new Map();

function volatileField(field) {
	return typeof field.volatile === "function" ? field.volatile() : field;
}

/** 解包 cosmokit volatile 包装对象。 */
export function unwrapVolatile(candidate) {
	if (
		candidate !== null &&
		typeof candidate === "object" &&
		typeof candidate.get === "function" &&
		Object.getOwnPropertySymbols(candidate).some(
			(symbol) => symbol.description === "cosmokit.volatile.write",
		)
	) {
		return candidate.get();
	}
	return candidate;
}

function getLiveField(live, key, fallback) {
	if (live === null || live === undefined) return fallback;
	const value = live[key];
	if (value === undefined || value === null) return fallback;
	return typeof value?.get === "function" ? value.get() : value;
}

function normalizeMode(candidate, fallback = DEFAULT_CONFIG.fallbackMode, label = "mode") {
	if (typeof candidate === "string" && MODES.has(candidate)) return candidate;
	if (candidate === undefined || candidate === null || candidate === "") return fallback;
	console.warn(
		"skill-control: ignoring invalid " +
			label +
			" " +
			JSON.stringify(candidate) +
			" (expected one of " +
			[...MODES].map((mode) => JSON.stringify(mode)).join(", ") +
			"); using " +
			JSON.stringify(fallback),
	);
	return fallback;
}

/** 归一化 skillModes 字典：只保留合法模式。 */
export function normalizeSkillModes(value) {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
	const modes = {};
	for (const [skillName, mode] of Object.entries(value)) {
		if (typeof skillName !== "string" || skillName.length === 0) continue;
		if (typeof mode === "string" && MODES.has(mode)) modes[skillName] = mode;
	}
	return modes;
}

function normalizeDescriptionLimit(value, fallback = DEFAULT_CONFIG.catalogDescriptionMaxLength) {
	if (value === null || value === undefined || value === "") return fallback;
	const numeric = typeof value === "number" ? value : Number(value);
	return Number.isInteger(numeric) && numeric >= 0 ? numeric : fallback;
}

/** 当前瞬时配置快照（纯函数）。 */
export function getConfigSnapshot(raw) {
	const value = raw !== null && typeof raw === "object" ? raw : {};
	return {
		enabled: unwrapVolatile(value.enabled) !== false,
		skillModes: normalizeSkillModes(unwrapVolatile(value.skillModes) ?? {}),
		fallbackMode: normalizeMode(
			unwrapVolatile(value.fallbackMode),
			DEFAULT_CONFIG.fallbackMode,
			"fallbackMode",
		),
		catalogDescriptionMaxLength: normalizeDescriptionLimit(
			unwrapVolatile(value.catalogDescriptionMaxLength),
			DEFAULT_CONFIG.catalogDescriptionMaxLength,
		),
		promptNotice: unwrapVolatile(value.promptNotice) !== false,
	};
}

/** 读取当前生效配置：rawConfig → ctx.fiber.config live volatile。 */
export function readConfig(ctx, rawConfig) {
	const snapshot = getConfigSnapshot(rawConfig);
	let live = rawConfig;
	try {
		live = ctx?.fiber?.config || rawConfig;
	} catch {
		live = rawConfig;
	}
	const next = { ...snapshot };
	for (const key of ["enabled", "skillModes", "fallbackMode", "catalogDescriptionMaxLength", "promptNotice"]) {
		const value = getLiveField(live, key, undefined);
		if (value === undefined || value === null) continue;
		if (key === "skillModes") next.skillModes = normalizeSkillModes(value);
		else if (key === "fallbackMode") next.fallbackMode = normalizeMode(value, snapshot.fallbackMode, "fallbackMode");
		else if (key === "catalogDescriptionMaxLength") {
			next.catalogDescriptionMaxLength = normalizeDescriptionLimit(value, snapshot.catalogDescriptionMaxLength);
		} else {
			next[key] = value !== false;
		}
	}
	return next;
}

/** 把配置补丁写进进程内覆盖（下一次装配立即生效）。 */
export function applyLivePatch(patch) {
	if (patch === null || typeof patch !== "object") return;
	if (patch.resetSkillModes === true) LIVE_OVERRIDES.skillModes.clear();
	if (patch.skillModes !== null && typeof patch.skillModes === "object") {
		for (const [skillName, mode] of Object.entries(patch.skillModes)) {
			if (typeof skillName !== "string" || skillName.length === 0) continue;
			if (mode === undefined) LIVE_OVERRIDES.skillModes.delete(skillName);
			else if (typeof mode === "string" && MODES.has(mode)) LIVE_OVERRIDES.skillModes.set(skillName, mode);
		}
	}
	if (patch.fallbackMode !== undefined && typeof patch.fallbackMode === "string" && MODES.has(patch.fallbackMode)) {
		LIVE_OVERRIDES.fallbackMode = patch.fallbackMode;
	}
}

/** 合并配置与进程内覆盖后的完整模式字典（供目录重写使用）。 */
export function effectiveSkillModes(config = {}) {
	const modes = {};
	const configured = config.skillModes !== null && typeof config.skillModes === "object" ? config.skillModes : {};
	for (const [skillName, mode] of Object.entries(configured)) {
		if (typeof mode === "string" && MODES.has(mode)) modes[skillName] = mode;
	}
	for (const [skillName, mode] of LIVE_OVERRIDES.skillModes) modes[skillName] = mode;
	return modes;
}

/** 单个技能当前生效模式：LIVE_OVERRIDES > 配置 skillModes > fallbackMode。 */
export function skillModeOf(name, config = {}) {
	const fallback = normalizeMode(
		LIVE_OVERRIDES.fallbackMode ?? config.fallbackMode,
		DEFAULT_CONFIG.fallbackMode,
		"fallbackMode",
	);
	if (typeof name !== "string" || name.length === 0) return fallback;
	const liveMode = LIVE_OVERRIDES.skillModes.get(name);
	if (liveMode !== undefined) return liveMode;
	const modes = config.skillModes !== null && typeof config.skillModes === "object" ? config.skillModes : {};
	if (Object.prototype.hasOwnProperty.call(modes, name)) {
		return normalizeMode(modes[name], fallback, "skillModes[" + name + "]");
	}
	return fallback;
}

/** 是否被显式固定（设置卡片的 ）。 */
export function isSkillPinned(name, config = {}) {
	if (typeof name !== "string" || name.length === 0) return false;
	if (LIVE_OVERRIDES.skillModes.has(name)) return true;
	// `config` defaults to {} only when the argument is undefined; an explicit
	// null (a row with no config at all) still arrives here and must not throw.
	const source = config !== null && typeof config === "object" ? config : {};
	const modes = source.skillModes !== null && typeof source.skillModes === "object" ? source.skillModes : {};
	return Object.prototype.hasOwnProperty.call(modes, name);
}

const PERSIST_TIMEOUT_MS = 15000;

/** 通过宿主 configEditor 服务落盘（与设置页保存同一条链路）。 */
export async function commitControlConfig(ctx, patch) {
	let entry;
	try {
		const editor = typeof ctx?.get === "function" ? ctx.get("configEditor", false) : undefined;
		if (typeof editor?.edit !== "function") {
			return { ok: false, reason: "this host exposes no configEditor service" };
		}
		const rows = typeof editor.entries === "function" ? editor.entries() : [];
		const own = ctx?.fiber?.entry;
		entry = rows.includes(own) ? own : rows.find((row) => String(row?.options?.name ?? "").includes("skill-control"));
		if (entry === undefined) return { ok: false, reason: "no loader row for skill-control" };
		let failure;
		const edit = editor
			.edit(entry, (current) => {
				const next = { ...(current ?? {}) };
				if (patch?.resetSkillModes === true) next.skillModes = {};
				if (patch?.skillModes !== null && typeof patch?.skillModes === "object") {
					const modes = { ...(next.skillModes ?? {}) };
					for (const [skillName, mode] of Object.entries(patch.skillModes)) {
						if (mode === undefined) delete modes[skillName];
						else if (typeof mode === "string" && MODES.has(mode)) modes[skillName] = mode;
					}
					next.skillModes = modes;
				}
				if (patch?.fallbackMode !== undefined) next.fallbackMode = patch.fallbackMode;
				if (patch?.catalogDescriptionMaxLength !== undefined) next.catalogDescriptionMaxLength = patch.catalogDescriptionMaxLength;
				if (patch?.promptNotice !== undefined) next.promptNotice = patch.promptNotice;
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

/** 写操作结果的一行补充说明。 */
export function persistNote(saved) {
	if (saved?.ok === true) return "已写入 profile 配置，重启后依然保留。";
	return "仅在当前进程生效（" + (saved?.reason ?? "no persistence hook") + "）：下一次请求立刻生效，但重启后会丢失；请用设置页保存到磁盘。";
}

/** 抽取消息文本 block。 */
function messageText(message) {
	if (!Array.isArray(message?.content)) return "";
	return message.content
		.filter((block) => block?.type === "text" && typeof block.text === "string")
		.map((block) => block.text)
		.join("\n");
}

const BACKTICK = String.fromCharCode(96);

function truncateCatalogDescription(value, limit) {
	const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
	if (limit <= 0) return "";
	if (normalized.length <= limit) return normalized;
	return normalized.slice(0, Math.max(0, limit - 3)) + "...";
}

/** 近似 token 计数：非 ASCII 按 1 token，ASCII 按 1/4 token（与 prompt-control 保持一致）。 */
export function estimateTokens(text) {
	if (typeof text !== "string" || text.length === 0) return 0;
	let tokens = 0;
	for (let index = 0; index < text.length; index += 1) {
		tokens += text.charCodeAt(index) > 255 ? 1 : 0.25;
	}
	return Math.ceil(tokens);
}

/** 目录里一行技能条目的文本；limit=0 时只保留名字，null/undefined 表示不截断。 */
function catalogLine(name, description, limit) {
	const plain = "- " + BACKTICK + name + BACKTICK;
	if (typeof description !== "string" || description.length === 0 || limit === 0) return plain;
	const text = limit === null || limit === undefined ? description : truncateCatalogDescription(description, limit);
	return text.length > 0 ? plain + ": " + text : plain;
}

/** 渲染非持久化的系统提示词目录；hidden/disabled 技能完全不出现。 */
function renderSkillCatalogSection(entries, config) {
	const limit = normalizeDescriptionLimit(
		config.catalogDescriptionMaxLength,
		DEFAULT_CONFIG.catalogDescriptionMaxLength,
	);
	const lines = [];
	for (const entry of entries) {
		if (typeof entry?.name !== "string" || entry.name.length === 0) continue;
		const mode = skillModeOf(entry.name, config);
		if (mode === "hidden" || mode === "disabled") continue;
		lines.push(mode === "name"
			? catalogLine(entry.name, "", 0)
			: catalogLine(entry.name, entry.description, limit));
	}
	if (lines.length === 0) return "";
	return [
		"<system-reminder>",
		"A skill is a reusable set of task-specific instructions. The following skills are available in this session:",
		"",
		"<available_skills>",
		...lines,
		"</available_skills>",
		"",
		"If the user names a skill, or the task clearly matches a skill's description, call the skill tool with the exact skill name before taking task actions. Load all applicable skills, then follow their full instructions. This catalog contains summaries only; do not infer or follow a skill's instructions until it has been loaded.",
		"A user may also invoke a skill directly; its <skill_content> block then appears in this conversation. Follow it, and do not call the skill tool again for that skill.",
		"</system-reminder>",
	].join("\n");
}

/**
 * 给技能行附上近似 token 成本：
 *   - nameTokens：只显示名字时每行成本
 *   - fullTokens：完整描述时的每行成本
 *   - currentTokens：按当前模式/描述上限实际进入目录的成本（hidden/disabled 为 0）
 */
export function decorateSkillTokens(rows, config = {}) {
	const limit = normalizeDescriptionLimit(
		config.catalogDescriptionMaxLength,
		DEFAULT_CONFIG.catalogDescriptionMaxLength,
	);
	return rows.map((row) => {
		const nameLine = catalogLine(row.name, "", 0);
		const fullLine = catalogLine(row.name, row.description, null);
		const mode = skillModeOf(row.name, config);
		const currentLine =
			mode === "full"
				? catalogLine(row.name, row.description, limit)
				: mode === "name"
					? nameLine
					: "";
		return {
			...row,
			nameTokens: estimateTokens(nameLine),
			fullTokens: estimateTokens(fullLine),
			currentTokens: estimateTokens(currentLine),
		};
	});
}

/** 支持 { skillA: "name" } 或 { modes, fallbackMode, catalogDescriptionMaxLength } 两种形态。 */
function rewriteOptionsOf(modesOrOptions, maybeOptions) {
	let modes = {};
	let options = {};
	if (modesOrOptions instanceof Map) {
		modes = Object.fromEntries(modesOrOptions);
		options = maybeOptions ?? {};
	} else if (modesOrOptions instanceof Set) {
		modes = Object.fromEntries([...modesOrOptions].map((skillName) => [skillName, "disabled"]));
		options = maybeOptions ?? {};
	} else if (modesOrOptions !== null && typeof modesOrOptions === "object") {
		const optionKeys = ["modes", "skillModes", "fallbackMode", "catalogDescriptionMaxLength"];
		if (optionKeys.some((key) => Object.prototype.hasOwnProperty.call(modesOrOptions, key))) {
			modes = modesOrOptions.modes ?? modesOrOptions.skillModes ?? {};
			options = modesOrOptions;
		} else {
			modes = modesOrOptions;
			options = maybeOptions ?? {};
		}
	} else {
		options = maybeOptions ?? {};
	}
	const limit = options.catalogDescriptionMaxLength;
	return {
		modes: normalizeSkillModes(modes),
		fallbackMode: normalizeMode(options.fallbackMode, "full", "fallbackMode"),
		catalogDescriptionMaxLength: limit === null || limit === undefined ? null : normalizeDescriptionLimit(limit, 0),
	};
}

function modeForRewrite(name, options) {
	if (Object.prototype.hasOwnProperty.call(options.modes, name)) return options.modes[name];
	return options.fallbackMode;
}

/** 只改 skill-catalog 可见文本，不动 source.entries。 */
export function rewriteSkillCatalogMessage(message, modesOrOptions = {}, maybeOptions = {}) {
	const options = rewriteOptionsOf(modesOrOptions, maybeOptions);
	const entries = Array.isArray(message?.source?.entries) ? message.source.entries : [];
	if (entries.length === 0 || !Array.isArray(message.content)) return message;

	let changed = false;
	const content = message.content.map((block) => {
		if (block?.type !== "text" || typeof block.text !== "string") return block;
		let blockChanged = false;
		const lines = [];
		for (const line of block.text.split("\n")) {
			let matched;
			for (const entry of entries) {
				if (typeof entry?.name !== "string") continue;
				const plain = "- " + BACKTICK + entry.name + BACKTICK;
				if (line === plain || line.startsWith(plain + ": ")) {
					matched = entry;
					break;
				}
			}
			if (matched === undefined) {
				lines.push(line);
				continue;
			}
			const mode = modeForRewrite(matched.name, options);
			if (mode === "hidden" || mode === "disabled") {
				blockChanged = true;
				changed = true;
				continue;
			}
			const plain = "- " + BACKTICK + matched.name + BACKTICK;
			let next;
			if (mode === "name") next = plain;
			else if (options.catalogDescriptionMaxLength === null) next = line;
			else {
				const description = truncateCatalogDescription(matched.description, options.catalogDescriptionMaxLength);
				next = description.length > 0 ? plain + ": " + description : plain;
			}
			if (next !== line) {
				blockChanged = true;
				changed = true;
			}
			lines.push(next);
		}
		return blockChanged ? { ...block, text: lines.join("\n") } : block;
	});
	return changed ? { ...message, content } : message;
}

/**
 * 把会话里已经持久化、仍然可见的旧 skill-catalog 节点替换成裁剪后的目录。
 * 只靠改写 decision.messages 无法处理 fork/resume 继承下来的历史 catalog。
 * 返回 true 时调用方应丢弃本轮 decision.messages 里的 skill-catalog 消息。
 */
function ensureDurableCatalog(ctx, rawConfig, agent) {
	const session = agent?.session;
	if (!session || typeof session.append !== "function") return false;
	const events = Array.isArray(session.events) ? session.events : [];
	const visible = new Set(
		Array.isArray(session.surface?.nodes) || session.surface?.nodes instanceof Set
			? Array.from(session.surface.nodes)
			: [],
	);
	const catalogEvents = events.filter((event) =>
		event?.type === "user/message" &&
		event.data?.source?.kind === "skill-catalog" &&
		Array.isArray(event.data.source.entries) &&
		visible.has(event.seq),
	);
	if (catalogEvents.length === 0) return false;
	const seqs = catalogEvents.map((event) => event.seq);
	try {
		for (const seq of seqs) {
			session.append(
				"user/message",
				{
					role: "user",
					id: "skill-control-superseded-" + seq + "-" + durableCatalogSerial++,
					content: [{ type: "text", text: "[Earlier skill catalog superseded by the filtered skill catalog.]" }],
					source: { kind: "skill-control:superseded", form: "catalog" },
				},
				{ surfaceOp: { op: "replace", start: seq, end: seq }, sourceEventSeqs: [seq] },
			);
		}
		return true;
	} catch (error) {
		ctx?.logger?.warn?.("dsh-skill-control: could not shadow durable catalog: " + String(error));
		return false;
	}
}

/** skill-invocation 命中 disabled 时返回 null；数组形态返回过滤后的新数组。 */
export function filterSkillCatalogMessage(message, modesOrOptions = {}) {
	const options = rewriteOptionsOf(modesOrOptions);
	if (Array.isArray(message)) {
		let changed = false;
		const kept = [];
		for (const item of message) {
			const next = filterSkillCatalogMessage(item, modesOrOptions);
			if (next === null) changed = true;
			else kept.push(next);
		}
		return changed ? kept : message;
	}
	const kind = message?.source?.kind;
	const skillName = message?.source?.name;
	if (kind === "skill-invocation" && typeof skillName === "string") {
		return modeForRewrite(skillName, options) === "disabled" ? null : message;
	}
	if (kind !== "skill-catalog") return message;
	const removalModes = {};
	for (const [name, mode] of Object.entries(options.modes)) {
		removalModes[name] = mode === "hidden" || mode === "disabled" ? mode : "full";
	}
	const fallback = options.fallbackMode === "hidden" || options.fallbackMode === "disabled" ? options.fallbackMode : "full";
	return rewriteSkillCatalogMessage(message, {
		modes: removalModes,
		fallbackMode: fallback,
		catalogDescriptionMaxLength: null,
	});
}

/** 记录 skill-catalog entries 供设置卡片展示。 */
export function rememberSkillCatalog(message) {
	const entries = message?.source?.entries;
	if (!Array.isArray(entries)) return;
	for (const entry of entries) {
		if (typeof entry?.name !== "string" || entry.name.length === 0) continue;
		OBSERVED_ENTRIES.set(entry.name, {
			name: entry.name,
			description: typeof entry.description === "string" ? entry.description : "",
		});
	}
}

export function observedSkillEntries() {
	return [...OBSERVED_ENTRIES.values()].map((entry) => ({ ...entry }));
}

/** 合并 skills 服务与观测目录；没有 skills 服务时仅返回观测条目。 */
export async function collectSkillInventory(ctx, config = {}, options = {}) {
	const rows = new Map();
	let service;
	try {
		service = typeof ctx?.get === "function" ? ctx.get("skills", false) : ctx?.skills;
	} catch {
		service = undefined;
	}
	if (service && typeof service.list === "function") {
		try {
			const view = {
				...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
				...(options.scope !== undefined ? { scope: options.scope } : {}),
				...(options.signal !== undefined ? { signal: options.signal } : {}),
			};
			const list = await service.list(view);
			for (const skill of Array.isArray(list) ? list : []) {
				if (!skill || typeof skill.name !== "string" || skill.name.length === 0) continue;
				let bodyTokens;
				if (options.withBodies === true && typeof service.get === "function") {
					try {
						const definition = await service.get(skill.name, view);
						if (typeof definition?.content === "string") bodyTokens = estimateTokens(definition.content);
					} catch {
						bodyTokens = undefined;
					}
				}
				rows.set(skill.name, {
					name: skill.name,
					description: typeof skill.description === "string" ? skill.description : "",
					source:
						typeof skill.provider === "string" && skill.provider.length > 0
							? skill.provider
							: typeof skill.source === "string" && skill.source.length > 0
								? skill.source
								: "skills",
					modelInvocable: (skill.modelInvocable ?? skill.invocation?.modelInvocable) !== false,
					userInvocable: (skill.userInvocable ?? skill.invocation?.userInvocable) !== false,
					observed: OBSERVED_ENTRIES.has(skill.name),
						...(bodyTokens !== undefined ? { bodyTokens } : {}),
				});
			}
		} catch (error) {
			ctx?.logger?.warn?.("dsh-skill-control: failed to list skills: " + String(error));
		}
	}
	for (const entry of OBSERVED_ENTRIES.values()) {
		if (rows.has(entry.name)) continue;
		rows.set(entry.name, {
			name: entry.name,
			description: entry.description,
			source: "catalog",
			modelInvocable: true,
			userInvocable: true,
			observed: true,
		});
	}
	const sorted = [...rows.values()].sort((left, right) => left.name.localeCompare(right.name));
	return decorateSkillUsage(decorateSkillTokens(sorted, config));
}

function summariseDescription(value) {
	const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
	return normalized.length <= 240 ? normalized : normalized.slice(0, 237) + "...";
}

function keywordsOf(query) {
	const seen = new Set();
	for (const token of String(query ?? "").split(/\s+/u)) {
		if (token.length > 0) seen.add(token);
	}
	return [...seen];
}

function scoreMatch(query, name, blob) {
	const lowerName = name.toLowerCase();
	const keywords = keywordsOf(query);
	if (keywords.length > 1) {
		let hits = 0;
		for (const keyword of keywords) {
			if (lowerName.includes(keyword) || blob.includes(keyword)) hits += 1;
		}
		if (hits === 0) return 0;
		const coverage = hits === keywords.length ? 500 : 100 + hits * 50;
		return coverage - Math.min(lowerName.length, 200);
	}
	const keyword = keywords[0] ?? String(query ?? "").trim();
	if (lowerName === keyword) return 1000;
	if (lowerName.includes(keyword)) return 600 - Math.min(lowerName.length, 200);
	if (blob.includes(keyword)) return 200;
	return 0;
}

function renderSkillSearchResult(value) {
	const lines = [
		"**Skill search**: " + JSON.stringify(value.query) + " — " + value.matches + " match(es) (of " + value.total + ")",
	];
	if (value.skills.length === 0) {
		lines.push("No skills matched. Try a different keyword, or call skill_catalog to read the full name index.");
		return lines.join("\n");
	}
	for (const skill of value.skills) {
		lines.push("• `" + skill.name + "` [" + skill.mode + "] (calls=" + (skill.calls ?? 0) + ", ~" + (skill.tokens ?? 0) + " tok) (" + (skill.source || "unknown") + ") — " + (skill.description || "No description provided."));
	}
	return lines.join("\n");
}

function renderSkillCatalogResult(value) {
	const lines = ["**Skill catalog index**", "• full (loaded): " + value.loaded.length];
	if (value.loaded.length > 0) lines.push("  " + value.loaded.map((name) => "`" + name + "`").join(", "));
	lines.push("• name-only (reduced): " + value.reduced.length);
	if (value.reduced.length > 0) lines.push("  " + value.reduced.map((name) => "`" + name + "`").join(", "));
	lines.push("• hidden: " + value.hidden.length);
	if (value.hidden.length > 0) lines.push("  " + value.hidden.map((name) => "`" + name + "`").join(", "));
	lines.push("Hidden and name-only skills remain callable via the `skill` tool; use skill_search { details: true } to read their full descriptions.");
	return lines.join("\n");
}

/** skill_search 工具定义。lookup: { entries(), modeOf(name) } */
export function createSkillSearchTool(lookup) {
	return {
		name: "skill_search",
		description:
			"Find skills by keyword or regular expression and read their full description. The available-skills catalog may hide descriptions (name-only entries) or whole entries (hidden skills); those skills remain fully loadable via the `skill` tool, and this is how you discover them. Pass several space-separated keywords to search broadly: a skill matches when it contains ANY keyword, and the best matches (most keywords, shortest name) come first. Set details:true to read the complete description of each match.",
		parameters: {
			type: "object",
			additionalProperties: false,
			properties: {
				query: {
					type: "string",
					description:
						"Search text, matched case-insensitively against skill names and descriptions. Multiple space-separated words use OR semantics (a skill matches any keyword; more keywords matched ranks higher).",
				},
				regex: { type: "boolean", description: "Treat the query as a regular expression. Defaults to false." },
				details: { type: "boolean", description: "When true, return each matched skill's full description instead of a short summary." },
				limit: { type: "integer", description: "Maximum number of skills to return. Defaults to 12, capped at 100." },
				deferOnly: { type: "boolean", description: "When true, search only skills whose catalog entry is reduced or hidden (not full-visible)." },
			},
			required: ["query"],
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					query: { type: "string" },
					matches: { type: "integer", description: "Number of skills returned." },
					total: { type: "integer", description: "Number of skills that matched before the limit was applied." },
					skills: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								name: { type: "string" },
								description: { type: "string" },
								mode: { type: "string" },
								deferred: { type: "boolean" },
								tokens: { type: "integer", description: "Approximate tokens this skill contributes to the model-visible catalog right now." },
									calls: { type: "integer", description: "Recorded skill invocations (model tool calls, user /skill gestures and scanned history)." },
									source: { type: "string" },
							},
							required: ["name", "description", "mode", "deferred"],
						},
					},
				},
				required: ["query", "matches", "total", "skills"],
			},
			render: (_args, value) => [{ type: "text", text: renderSkillSearchResult(value) }],
		},
		async execute(args, exec) {
			const query = String(args?.query ?? "");
			const limit = Math.min(Math.max(Number.isInteger(args?.limit) ? args.limit : 12, 1), 100);
			const deferOnly = args?.deferOnly === true;
			const details = args?.details === true;
			const all = await lookup.entries({ scope: exec?.agent, cwd: exec?.agent?.session?.header?.cwd });

			let test;
			if (args?.regex === true) {
				let pattern;
				try {
					pattern = new RegExp(query, "iu");
				} catch (error) {
					throw new Error("invalid regex " + JSON.stringify(query) + ": " + error.message);
				}
				test = (name, blob) => pattern.test(name) || pattern.test(blob);
			} else {
				const lowered = query.toLowerCase();
				test = (name, blob) => scoreMatch(lowered, name, blob) > 0;
			}

			const ranked = [];
			for (const skill of all) {
				const mode = lookup.modeOf(skill.name);
				if (mode === "disabled") continue;
				if (deferOnly && mode === "full") continue;
				const blob = (skill.name + " " + (skill.description || "")).toLowerCase();
				if (!test(skill.name, blob)) continue;
				ranked.push({
					...skill,
					mode,
					rank: args?.regex === true ? 1 : scoreMatch(query.toLowerCase(), skill.name, blob),
				});
			}
			ranked.sort((left, right) => right.rank - left.rank || left.name.localeCompare(right.name));
			const skills = ranked.slice(0, limit).map((skill) => ({
				name: skill.name,
				description: details ? skill.description || "" : summariseDescription(skill.description),
				mode: skill.mode,
				deferred: skill.mode !== "full",
				tokens: skill.currentTokens ?? 0,
				calls: skill.calls ?? 0,
				...(skill.source ? { source: skill.source } : {}),
			}));
			return { query, matches: skills.length, total: ranked.length, skills };
		},
		presentCall: (args) => ({
			card: "generic",
			title: "Search skills: " + String(args?.query ?? ""),
			kind: "read",
			rawInput: String(args?.query ?? ""),
		}),
	};
}

/** skill_catalog 工具定义：{ loaded, reduced, hidden } 名称索引。 */
export function createSkillCatalogTool(lookup) {
	return {
		name: "skill_catalog",
		description:
			"Read the complete skill name index, grouped by catalog visibility: loaded (full description), reduced (name-only — description available via skill_search details:true), and hidden (absent from the catalog but still loadable via the skill tool). Disabled skills are excluded entirely.",
		parameters: {
			type: "object",
			additionalProperties: false,
			properties: {
				deferredOnly: { type: "boolean", description: "When true, return only reduced and hidden skills (skip fully loaded ones)." },
			},
			required: [],
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					loaded: { type: "array", items: { type: "string" } },
					reduced: { type: "array", items: { type: "string" } },
					hidden: { type: "array", items: { type: "string" } },
				},
				required: ["loaded", "reduced", "hidden"],
			},
			render: (_args, value) => [{ type: "text", text: renderSkillCatalogResult(value) }],
		},
		async execute(args, exec) {
			const deferredOnly = args?.deferredOnly === true;
			const loaded = [];
			const reduced = [];
			const hidden = [];
			for (const skill of await lookup.entries({ scope: exec?.agent, cwd: exec?.agent?.session?.header?.cwd })) {
				const mode = lookup.modeOf(skill.name);
				if (mode === "full") {
					if (!deferredOnly) loaded.push(skill.name);
				} else if (mode === "name") reduced.push(skill.name);
				else if (mode === "hidden") hidden.push(skill.name);
			}
			return { loaded, reduced, hidden };
		},
		presentCall: () => ({ card: "generic", title: "Skill catalog", kind: "read", rawInput: "" }),
	};
}

/** skill_control 工具：list/get/set_mode/set_fallback/reset/stats。 */
export function createSkillControlTool(lookup) {
	const ACTIONS = ["list", "get", "set_mode", "set_fallback", "reset", "stats"];
	const currentConfig = () => (typeof lookup.config === "function" ? lookup.config() : lookup.config || {});
	return {
		name: "skill_control",
		description:
			"Inspect and control the model-visible skill catalog. List all skills and their modes (full, name, hidden, disabled), inspect one skill, change modes for one or more skills, change the fallback mode, reset manual overrides, and view catalog statistics. Changes take effect on the next request; they are persisted to the profile config when the host exposes configEditor.",
		parameters: {
			type: "object",
			additionalProperties: false,
			properties: {
				action: {
					type: "string",
					enum: ACTIONS,
					description:
						"Action: 'list' (list skills, modes, source & observed), 'get' (detail for one skill), 'set_mode' (change mode for one or more skills), 'set_fallback' (change the default mode), 'reset' (clear per-skill overrides), 'stats' (catalog statistics).",
				},
				skill: { type: "string", description: "Target skill name. Required for 'get'; optional for 'set_mode'/'reset'." },
				skills: { type: "array", items: { type: "string" }, description: "Optional list of skill names for batch 'set_mode' or 'reset'." },
				mode: {
					type: "string",
					enum: ["full", "name", "hidden", "disabled"],
					description:
						"Target mode for 'set_mode' or 'set_fallback': 'full' (keep full description in the catalog), 'name' (keep only the name; read description via skill_search details:true), 'hidden' (remove from the catalog; still loadable via the skill tool), 'disabled' (remove from catalog and block skill invocations).",
				},
				filter: {
					type: "string",
					enum: ["all", "full", "name", "hidden", "disabled", "deferred"],
					description: "Optional filter for 'list': list only skills matching this mode or status.",
				},
			},
			required: ["action"],
		},
		output: {
			schema: { type: "string" },
			render: (_args, value) => [{ type: "text", text: value }],
		},
		async execute(args, exec) {
			const action = args?.action;
			const entries = (extra = {}) => lookup.entries({ scope: exec?.agent, cwd: exec?.agent?.session?.header?.cwd, ...extra });
			const config = currentConfig();

			if (action === "stats") {
				const all = await entries({ withBodies: true });
				const countsByMode = { full: 0, name: 0, hidden: 0, disabled: 0 };
				let observed = 0;
				let currentTokens = 0;
				let fullTokens = 0;
				let bodyTokens = 0;
				let calls = 0;
				let modelCalls = 0;
				let userCalls = 0;
				let historyCalls = 0;
				for (const skill of all) {
					countsByMode[lookup.modeOf(skill.name)] += 1;
					if (skill.observed) observed += 1;
					currentTokens += skill.currentTokens ?? 0;
					fullTokens += skill.fullTokens ?? 0;
					bodyTokens += skill.bodyTokens ?? 0;
					calls += skill.calls ?? 0;
					modelCalls += skill.modelCalls ?? 0;
					userCalls += skill.userCalls ?? 0;
					historyCalls += skill.historyCalls ?? 0;
				}
				return [
					"**Skill Control Statistics**",
					"• Status: " + (config.enabled ? "Active (Enabled)" : "Inactive (Disabled)"),
					"• Fallback Mode: `" + config.fallbackMode + "`",
					"• Tracked Skills: " + all.length + " total (" + observed + " observed in catalog)",
					"  - full: " + countsByMode.full,
					"  - name: " + countsByMode.name + " (name-only; description via skill_search details:true)",
					"  - hidden: " + countsByMode.hidden + " (not listed; loadable via skill tool)",
					"  - disabled: " + countsByMode.disabled + " (blocked)",
					"• Catalog Description Max Length: " + config.catalogDescriptionMaxLength,
					"• Prompt Notice: on (always)",
					"• Catalog cost now: ~" + currentTokens + " tokens (full descriptions would be ~" + fullTokens + " tokens)",
					"• Loaded skill bodies: ~" + bodyTokens + " tokens total (only when explicitly loaded)",
					"• Skill invocations: " + calls + " total (model " + modelCalls + ", user /skill " + userCalls + ", history " + historyCalls + ")",
				].join("\n");
			}

			if (action === "list") {
				const all = await entries();
				const filter = args?.filter || "all";
				const rows = [];
				for (const skill of all) {
					const mode = lookup.modeOf(skill.name);
					if (filter === "deferred" && mode === "full") continue;
					if (filter !== "all" && filter !== "deferred" && mode !== filter) continue;
					rows.push({
						name: skill.name,
						mode,
						pinned: lookup.pinnedOf(skill.name),
						source: skill.source,
						observed: skill.observed,
						tokens: skill.currentTokens ?? 0,
						fullTokens: skill.fullTokens ?? 0,
						calls: skill.calls ?? 0,
						description: summariseDescription(skill.description),
					});
				}
				rows.sort((left, right) => left.name.localeCompare(right.name));
				if (rows.length === 0) return "No skills matched the filter (filter=" + filter + ").";
				const lines = [
					"**Skill Control Inventory** (" + rows.length + " skills, filter=" + filter + "):",
					"Format: `[mode] skill_name (calls=N, ~now/full tok) (source, observed)` - description",
					"",
				];
				for (const row of rows) {
					const pinMark = row.pinned ? " " : "";
					lines.push(
						"• [" + row.mode + "] `" + row.name + "`" + pinMark + " (calls=" + row.calls + ", ~" + row.tokens + "/" + row.fullTokens + " tok) (" + row.source + ", " + (row.observed ? "observed" : "service-only") + ") - " + row.description,
					);
				}
				return lines.join("\n");
			}

			if (action === "get") {
				const skillName = args?.skill;
				if (!skillName) return "Error: 'skill' parameter is required for action 'get'.";
				const all = await entries({ withBodies: true });
				const skill = all.find((entry) => entry.name === skillName);
				if (!skill) return "Skill \"" + skillName + "\" was not found in the skill inventory.";
				const mode = lookup.modeOf(skillName);
				const pinned = lookup.pinnedOf(skillName);
				return [
					"**Skill Detail**: `" + skillName + "`",
					"• Current Mode: **" + mode + "**" + (pinned ? " (Pinned by manual override )" : " (Inherited from fallback)"),
					"• Source: " + skill.source,
					"• Observed in catalog: " + (skill.observed ? "yes" : "no"),
					"• Model Invocable: " + (skill.modelInvocable ? "yes" : "no"),
					"• User Invocable: " + (skill.userInvocable ? "yes" : "no"),
					"• Invocations: " + (skill.calls ?? 0) + " total (model " + (skill.modelCalls ?? 0) + ", user /skill " + (skill.userCalls ?? 0) + ", history " + (skill.historyCalls ?? 0) + ")",
					"• Catalog cost: ~" + (skill.currentTokens ?? 0) + " tokens now, ~" + (skill.fullTokens ?? 0) + " tokens with full description, ~" + (skill.nameTokens ?? 0) + " tokens name-only",
					...(skill.bodyTokens !== undefined ? ["• Loaded body: ~" + skill.bodyTokens + " tokens (only when the skill is loaded)"] : []),
					"• Description: " + (skill.description || "No description provided."),
				].join("\n");
			}

			if (action === "set_mode") {
				const targetSkills =
					Array.isArray(args?.skills) && args.skills.length > 0
						? args.skills.filter((skill) => typeof skill === "string" && skill.length > 0)
						: args?.skill
							? [args.skill]
							: [];
				const targetMode = args?.mode;
				if (targetSkills.length === 0) return "Error: 'skill' or 'skills' parameter is required for action 'set_mode'.";
				if (!targetMode || !MODES.has(targetMode)) return "Error: valid 'mode' is required (" + [...MODES].join(", ") + ").";
				const modes = Object.fromEntries(targetSkills.map((skillName) => [skillName, targetMode]));
				lookup.override({ skillModes: modes });
				const saved = await lookup.persist({ skillModes: modes });
				return [
					"Successfully updated " + targetSkills.length + " skill(s) to mode **" + targetMode + "**: " + targetSkills.map((skillName) => "`" + skillName + "`").join(", ") + ". Changes take effect immediately on the next request.",
					persistNote(saved),
				].join("\n");
			}

			if (action === "set_fallback") {
				const targetMode = args?.mode;
				if (!targetMode || !MODES.has(targetMode)) return "Error: valid 'mode' is required (" + [...MODES].join(", ") + ").";
				lookup.override({ fallbackMode: targetMode });
				const saved = await lookup.persist({ fallbackMode: targetMode });
				return ["Successfully updated fallbackMode to **" + targetMode + "**. Skills without an explicit override will use this mode immediately.", persistNote(saved)].join("\n");
			}

			if (action === "reset") {
				const targetSkills =
					Array.isArray(args?.skills) && args.skills.length > 0
						? args.skills.filter((skill) => typeof skill === "string" && skill.length > 0)
						: args?.skill
							? [args.skill]
							: [];
				if (targetSkills.length === 0) {
					lookup.override({ resetSkillModes: true });
					const saved = await lookup.persist({ resetSkillModes: true });
					return ["Successfully cleared all per-skill overrides. Every skill now follows fallbackMode.", persistNote(saved)].join("\n");
				}
				const cleared = Object.fromEntries(targetSkills.map((skillName) => [skillName, undefined]));
				lookup.override({ skillModes: cleared });
				const saved = await lookup.persist({ skillModes: cleared });
				return [
					"Successfully reset manual overrides for: " + targetSkills.map((skillName) => "`" + skillName + "`").join(", ") + ". They now follow fallbackMode.",
					persistNote(saved),
				].join("\n");
			}

			return "Unknown action: \"" + action + "\". Valid actions: " + ACTIONS.join(", ") + ".";
		},
		presentCall: (args) => ({
			card: "generic",
			title: "Skill Control: " + String(args?.action ?? "") + (args?.skill ? " (" + args.skill + ")" : ""),
			kind: "read",
			rawInput: JSON.stringify(args ?? {}),
		}),
	};
}

function createLookup(ctx, rawConfig) {
	return {
		config: () => readConfig(ctx, rawConfig),
		entries: (options) => collectSkillInventory(ctx, readConfig(ctx, rawConfig), options),
		modeOf: (skillName) => skillModeOf(skillName, readConfig(ctx, rawConfig)),
		pinnedOf: (skillName) => isSkillPinned(skillName, readConfig(ctx, rawConfig)),
		override: (patch) => applyLivePatch(patch),
		persist: (patch) => commitControlConfig(ctx, patch),
	};
}

function registerTool(ctx, tool, label) {
	if (ctx.tools && typeof ctx.tools.register === "function") {
		ctx.effect(() => ctx.tools.register(tool), label);
		return;
	}
	ctx.inject(["tools"], (scoped) => {
		const toolsService = scoped.get("tools");
		if (toolsService && typeof toolsService.register === "function") {
			scoped.effect(() => toolsService.register(tool), label);
		}
	});
}

/** 提示段落正文：仅在确有裁剪时出现。 */
export function skillControlNoticeText(ctx, rawConfig) {
	const config = readConfig(ctx, rawConfig);
	if (!config.enabled) return "";
	const nameOnly = [];
	const hidden = [];
	for (const entry of OBSERVED_ENTRIES.values()) {
		const mode = skillModeOf(entry.name, config);
		if (mode === "name") nameOnly.push(entry.name);
		else if (mode === "hidden") hidden.push(entry.name);
	}
	const fallbackName = config.fallbackMode === "name";
	const fallbackHidden = config.fallbackMode === "hidden";
	if (nameOnly.length === 0 && hidden.length === 0 && !fallbackName && !fallbackHidden) return "";
	const lines = [
		"## Skill catalog is filtered",
		"The available-skills catalog in this session is filtered by the skill control. Do not treat it as a complete list of skills that exist.",
	];
	if (nameOnly.length > 0 || fallbackName) {
		lines.push(
			"- Name-only entries (a catalog line with only the skill name, no description): their descriptions are withheld to save context. Read them with `skill_search { query: \"<name>\", details: true }` before deciding what they do; they remain fully loadable via the `skill` tool.",
		);
		if (nameOnly.length > 0) lines.push("  Name-only skills: " + nameOnly.slice(0, 12).map((name) => "`" + name + "`").join(", ") + (nameOnly.length > 12 ? ", ..." : ""));
	}
	if (hidden.length > 0 || fallbackHidden) {
		lines.push(
			"- Hidden skills are not listed in the catalog at all, but they remain fully loadable via the `skill` tool with their exact name. Discover them with `skill_search` (or `skill_catalog` for the full name index); never conclude a skill does not exist just because it is absent from the catalog.",
		);
	}
	return lines.join("\n");
}

function registerSettingsRoute(ctx, rawConfig) {
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
						const config = readConfig(ctx, rawConfig);
						let body = {};
						try {
							if (request && typeof request.json === "function") body = await request.json();
						} catch {}
						const action = body?.action || "get-skills";
						if (action === "scan-history") {
							refreshHistoricalUsage();
							return Response.json({ ok: true, value: { historyStats: { ...USAGE.historyStats } } });
						}
						if (USAGE.historyStats.at === 0) refreshHistoricalUsage();
						const collectScoped = async (options = {}) => {
							let scope;
							let release;
							try {
								const presets = ctx.get("agentPresets", false);
								if (presets && typeof presets.acquireScope === "function") {
									const presetId = presets.selectedDefault || presets.defaultId || presets.default || "standard";
									const acquired = await presets.acquireScope(presetId);
									scope = acquired.key;
									if (typeof acquired[Symbol.asyncDispose] === "function") release = acquired[Symbol.asyncDispose].bind(acquired);
									else if (typeof acquired[Symbol.dispose] === "function") release = acquired[Symbol.dispose].bind(acquired);
								}
							} catch {
								scope = undefined;
							}
							try {
								return await collectSkillInventory(ctx, config, { ...options, cwd: process.cwd(), scope });
							} finally {
								if (typeof release === "function") await release();
							}
						};
						if (action === "get-skills") {
							const rows = await collectScoped({ withBodies: true });
							const skills = rows.map((skill) => {
								const mode = skillModeOf(skill.name, config);
								return {
									name: skill.name,
									description: skill.description,
									source: skill.source,
									modelInvocable: skill.modelInvocable,
									userInvocable: skill.userInvocable,
									observed: skill.observed,
									mode,
									pinned: isSkillPinned(skill.name, config),
									enabled: mode !== "disabled",
									tokens: skill.currentTokens ?? 0,
									nameTokens: skill.nameTokens ?? 0,
									fullTokens: skill.fullTokens ?? 0,
									calls: skill.calls ?? 0,
									modelCalls: skill.modelCalls ?? 0,
									userCalls: skill.userCalls ?? 0,
									historyCalls: skill.historyCalls ?? 0,
									...(skill.bodyTokens !== undefined ? { bodyTokens: skill.bodyTokens } : {}),
								};
							});
							return Response.json({
								ok: true,
								value: {
									skills,
									fallbackMode: config.fallbackMode,
									catalogDescriptionMaxLength: config.catalogDescriptionMaxLength,
									enabled: config.enabled,
									promptNotice: config.promptNotice,
								historyStats: { ...USAGE.historyStats },
								},
							});
						}
						if (action === "stats") {
							const rows = await collectScoped({ withBodies: true });
							const countsByMode = { full: 0, name: 0, hidden: 0, disabled: 0 };
							let observed = 0;
							let catalogTokens = 0;
							let fullTokens = 0;
							let bodyTokens = 0;
							let calls = 0;
							let modelCalls = 0;
							let userCalls = 0;
							let historyCalls = 0;
							for (const skill of rows) {
								countsByMode[skillModeOf(skill.name, config)] += 1;
								if (skill.observed) observed += 1;
								catalogTokens += skill.currentTokens ?? 0;
								fullTokens += skill.fullTokens ?? 0;
								bodyTokens += skill.bodyTokens ?? 0;
								calls += skill.calls ?? 0;
								modelCalls += skill.modelCalls ?? 0;
								userCalls += skill.userCalls ?? 0;
								historyCalls += skill.historyCalls ?? 0;
							}
							return Response.json({
								ok: true,
								value: {
									total: rows.length,
									observed,
									countsByMode,
								catalogTokens,
								fullTokens,
								bodyTokens,
									calls,
									modelCalls,
									userCalls,
									historyCalls,
									fallbackMode: config.fallbackMode,
									catalogDescriptionMaxLength: config.catalogDescriptionMaxLength,
									enabled: config.enabled,
									promptNotice: config.promptNotice,
								historyStats: { ...USAGE.historyStats },
								},
							});
						}
						return Response.json({ ok: false, error: "unknown action: " + String(action) }, { status: 400 });
					},
				}),
			"skill-control.settings-route",
		);
	});
}

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
			description: field("description") || "Optimize skill catalog visibility configuration.",
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

/** 插件入口。 */
export function apply(ctx, rawConfig) {
	ctx.logger?.info?.("dsh-skill-control: initializing skill control");
	LIVE_OVERRIDES.clear();
	registerBundledSkill(ctx, "skill-control-optimize", "skill-control.optimize-skill");

	const config = readConfig(ctx, rawConfig);
	const lookup = createLookup(ctx, rawConfig);

	if (config.enabled) {
		registerTool(ctx, createSkillControlTool(lookup), "skill-control.control-tool");
		registerTool(ctx, createSkillSearchTool(lookup), "skill-control.search-tool");
		registerTool(ctx, createSkillCatalogTool(lookup), "skill-control.catalog-tool");

		// `disabled` must mean NOT CALLABLE, not merely absent from the catalog.
		// The official `skill` tool body belongs to dsh-tool-skill; a registry guard
		// rejects the call without touching that plugin or the skill registry.
		if (ctx.tools && typeof ctx.tools.guard === "function") {
			ctx.effect(
				() =>
					ctx.tools.guard((execution) => {
						if (execution?.name !== "skill") return undefined;
						const current = readConfig(ctx, rawConfig);
						if (!current.enabled) return undefined;
						const skillName =
							execution.arguments !== null && typeof execution.arguments === "object"
								? execution.arguments.name
								: undefined;
						if (typeof skillName === "string" && skillModeOf(skillName, current) === "disabled") {
							return 'skill "' + skillName + '" is disabled by skill-control';
						}
						return undefined;
					}),
				"skill-control.disable-guard",
			);
		}
	}

	ctx.effect(
		() =>
			ctx.on(
				"agent/pre-step",
				async (payload, next) => {
					const decision = await next();
					if (!decision || decision.kind === "reject" || !Array.isArray(decision.messages)) return decision;
					const current = readConfig(ctx, rawConfig);
					if (current.enabled) ensureDurableCatalog(ctx, rawConfig, payload?.agent);
					let changed = false;
					const messages = [];
					for (const message of decision.messages) {
						const kind = message?.source?.kind;
						if (kind === "skill-catalog") {
							rememberSkillCatalog(message);
							if (current.enabled) {
								changed = true;
								continue;
							}
							messages.push(message);
							continue;
						}
						if (kind === "skill-invocation") {
							const skillName = message?.source?.name;
							if (typeof skillName === "string") {
								const key = message?.id ?? skillName + ":" + String(messageText(message).length);
								if (!COUNTED_USER_INVOCATIONS.has(key)) {
									COUNTED_USER_INVOCATIONS.add(key);
									USAGE.user.set(skillName, (USAGE.user.get(skillName) ?? 0) + 1);
								}
							}
							if (current.enabled && typeof skillName === "string" && skillModeOf(skillName, current) === "disabled") {
								changed = true;
								continue;
							}
						}
						messages.push(message);
					}
					return changed ? { ...decision, messages } : decision;
				},
				{ prepend: true },
			),
		"skill-control.pre-step",
	);

	ctx.effect(
		() =>
			ctx.on("session/event", (_session, event) => {
				const skillName = skillNameFromToolEvent(event);
				if (skillName === undefined) return;
				USAGE.model.set(skillName, (USAGE.model.get(skillName) ?? 0) + 1);
			}),
		"skill-control.call-counting",
	);

	ctx.effect(
		() =>
			ctx.on("system-prompt/assemble", async (initialAssembly, context, next) => {
				const assembly = typeof next === "function" ? await next() : initialAssembly;
				const current = readConfig(ctx, rawConfig);
				if (!current.enabled || !assembly || !Array.isArray(assembly.sections)) return assembly;
				let entries = [];
				try {
					const service = ctx.get("skills", false);
					if (service && typeof service.list === "function") {
						const list = await service.list({
							scope: context?.scope,
							cwd: context?.scope?.session?.header?.cwd,
						});
						entries = (Array.isArray(list) ? list : []).map((skill) => ({
							name: skill.name,
							description: typeof skill.description === "string" ? skill.description : "",
						}));
					}
				} catch {}
				if (entries.length === 0) entries = observedSkillEntries();
				const text = renderSkillCatalogSection(entries, current);
				const sections = assembly.sections.filter((section) => section?.name !== "skill-control:catalog");
				if (text) sections.push({ name: "skill-control:catalog", order: 9997, text });
				return { ...assembly, sections };
			}),
		"skill-control.catalog-section",
	);

	ctx.effect(
		() =>
			ctx.systemPrompt.section({
				name: "skill-control:filtered",
				order: 10000,
				text: () => skillControlNoticeText(ctx, rawConfig),
			}),
		"skill-control.notice",
	);

	registerSettingsRoute(ctx, rawConfig);
}