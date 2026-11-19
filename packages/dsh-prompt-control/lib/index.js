/**
 * dsh-prompt-control — 系统提示词管理插件
 *
 * 功能：
 * 1. 管理不同预设（agent presets: standard, ptc, minimal, cordis 等）的系统提示词
 * 2. 识别提示词段落来源（dsh-system-prompt, dsh-plan-mode, dsh-agent-team, dsh-tool-* 等）
 * 3. 分组分类展示并支持在线启用/停用与文本覆盖编辑
 * 4. 支持在任意位置（指定段落前/后、提示词最前、最后）插入自定义提示词规则
 * 5. 零重启热生效：依托 system-prompt/assemble waterfall 钩子，每次会话请求即时动态重构
 * 6. 提供 HTTP API 与 Web 客户端配置卡片，完美融合 DSH 视觉规范
 *
 * @module dsh-prompt-control
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import z from "@deepseek-ai/schemastery";
import { createHash } from "node:crypto";

export const name = "prompt-control";
export const inject = ["systemPrompt", "tools"];

function volatileField(field) {
	return typeof field.volatile === "function" ? field.volatile() : field;
}

/**
 * 解包 cosmokit volatile 包装对象
 */
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

/** 归一化注入管理配置：旧配置没有该字段时保持“全部放行”。 */
export function normalizeContextInjections(raw) {
	const value = raw !== null && typeof raw === "object" ? raw : {};
	const strings = (candidate) =>
		Array.isArray(candidate) ? candidate.filter((entry) => typeof entry === "string" && entry.length > 0) : [];
	return {
		suppressOptional: value.suppressOptional === true,
		disabledContexts: strings(value.disabledContexts),
		disabledKinds: strings(value.disabledKinds),
	};
}

/**
 * 获取当前瞬时生效的配置快照
 */
export function getConfigSnapshot(raw) {
	const val = raw !== null && typeof raw === "object" ? raw : {};
	return {
		enabled: unwrapVolatile(val.enabled) !== false,
		overrides: unwrapVolatile(val.overrides) || {},
		presetOverrides: unwrapVolatile(val.presetOverrides) || {},
		insertions: Array.isArray(unwrapVolatile(val.insertions)) ? unwrapVolatile(val.insertions) : [],
		sectionOrder: Array.isArray(unwrapVolatile(val.sectionOrder)) ? unwrapVolatile(val.sectionOrder) : [],
		contextInjections: normalizeContextInjections(unwrapVolatile(val.contextInjections)),
	};
}

/**
 * 会话内的进程级覆盖（Agent 工具写入口）。
 *
 * 宿主只有一条持久化链路：`configEditor` 服务。直接改 Loader 行
 * （`ctx.fiber.config`）既不落盘，还会白等一次 fiber 重启；而 `configForms`
 * 是**客户端** service，Host 侧根本不存在 —— 旧实现因此「回一句 ，实际什么
 * 都没发生」。所以：先写这里（下一次装配立刻生效），再走 configEditor 落盘；
 * `apply()` 一旦重新执行，就以落盘配置为准，清空这里。
 */
const LIVE_STATE = {
	enabled: undefined,
	overrides: undefined,
	presetOverrides: undefined,
	insertions: undefined,
	contextInjections: undefined,
	clear() {
		this.enabled = undefined;
		this.overrides = undefined;
		this.presetOverrides = undefined;
		this.insertions = undefined;
		this.contextInjections = undefined;
	},
};

/** 官方原文指纹：检测「插件 / 版本更新后原生提示词变了」用。 */
export function hashPrompt(text) {
	return createHash("sha1").update(String(text ?? "")).digest("hex").slice(0, 12);
}

/**
 * 读取当前生效配置：落盘行 → 会话内覆盖。
 *
 * 工具与卡片都必须用这一份，否则「设置页改了 / 工具刚写完」读到的是激活时的
 * 冻结快照，表现为改不动、数字不动。
 */
export function readConfig(ctx, rawConfig) {
	const snapshot = getConfigSnapshot(rawConfig);
	const live = ctx?.fiber?.config || rawConfig;
	const next = { ...snapshot };
	for (const key of ["enabled", "overrides", "presetOverrides", "insertions", "sectionOrder", "contextInjections"]) {
		const value = getLiveField(live, key, undefined);
		if (value !== undefined && value !== null) {
			next[key] = key === "contextInjections" ? normalizeContextInjections(value) : value;
		}
	}
	if (LIVE_STATE.enabled !== undefined) next.enabled = LIVE_STATE.enabled;
	if (LIVE_STATE.overrides !== undefined) next.overrides = LIVE_STATE.overrides;
	if (LIVE_STATE.presetOverrides !== undefined) next.presetOverrides = LIVE_STATE.presetOverrides;
	if (LIVE_STATE.insertions !== undefined) next.insertions = LIVE_STATE.insertions;
	if (LIVE_STATE.contextInjections !== undefined) next.contextInjections = LIVE_STATE.contextInjections;
	return next;
}

/** 把一份配置补丁写进会话内状态（下一次装配立即生效）。 */
export function applyLivePatch(patch) {
	for (const key of ["enabled", "overrides", "presetOverrides", "insertions", "contextInjections"]) {
		if (patch[key] !== undefined) {
			LIVE_STATE[key] = key === "contextInjections" ? normalizeContextInjections(patch[key]) : patch[key];
		}
	}
}

/** 落盘超时：configEditor 会重写 profile patch 并重启本插件 fiber。 */
const PERSIST_TIMEOUT_MS = 15000;

/**
 * 通过宿主 `configEditor` 服务落盘（与设置页保存同一条链路）。
 *
 * 每一步都做了可选链：测试 harness / 没有 configEditor 的宿主会走到
 * `{ ok: false, reason }`，由调用方如实告诉用户「仅在当前进程生效」。
 */
export async function commitControlConfig(ctx, patch) {
	let entry;
	try {
		const editor = typeof ctx?.get === "function" ? ctx.get("configEditor", false) : undefined;
		if (typeof editor?.edit !== "function") {
			return { ok: false, reason: "this host exposes no configEditor service" };
		}
		const rows = typeof editor.entries === "function" ? editor.entries() : [];
		const own = ctx?.fiber?.entry;
		entry = rows.includes(own)
			? own
			: rows.find((row) => String(row?.options?.name ?? "").includes("prompt-control"));
		if (entry === undefined) return { ok: false, reason: "no loader row for prompt-control" };
		let failure;
		const edit = editor
			.edit(entry, (current) => {
				const next = { ...(current ?? {}) };
				for (const key of ["enabled", "overrides", "presetOverrides", "insertions", "sectionOrder", "contextInjections"]) {
					if (patch[key] !== undefined) next[key] = patch[key];
				}
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
	return `仅在当前进程生效（${saved?.reason ?? "no persistence hook"}）：下一次请求立刻生效，但重启后会丢失；请用设置页保存到磁盘。`;
}

/**
 * 插件配置定义（Schemastery）
 */
export const Config = z.object({
	enabled: volatileField(z.boolean().default(true)),

	/**
	 * 全局段落规则（覆盖与启停）
	 * key 为段落名（如 "harness:identity", "team:policy", "tool:bash" 等）
	 */
	overrides: volatileField(z.dict(z.any()).default({}).loose()),

	/**
	 * 按预设区分的段落规则
	 * 格式: { [presetId]: { [sectionName]: { enabled: boolean, text: string } } }
	 */
	presetOverrides: volatileField(z.dict(z.any()).default({}).loose()),

	/**
	 * 自定义提示词插入列表
	 */
	insertions: volatileField(z.array(z.any()).default([]).loose()),

	/**
	 * 自定义段落顺序（可选）
	 */
	sectionOrder: volatileField(z.array(z.string().loose()).default([]).loose()),

	/**
	 * 运行时上下文 / 消息注入管理
	 * { suppressOptional, disabledContexts: string[], disabledKinds: string[] }
	 */
	contextInjections: volatileField(
		z.object({
			suppressOptional: z.boolean().default(false),
			disabledContexts: z.array(z.string().loose()).default([]).loose(),
			disabledKinds: z.array(z.string().loose()).default([]).loose(),
		})
			.default({})
			.loose(),
	),
});

/**
 * 已知提示词段落元数据与标准原提示词库
 */
export const KNOWN_SECTIONS = {
	"dsh-context:prompt-prefix": {
		name: "上下文提示前缀",
		source: "dsh-context",
		category: "plugins",
		categoryLabel: "插件与扩展",
		description: "上下文注入层前缀",
		defaultOrder: -2000,
		defaultText: "",
	},
	"harness:identity": {
		name: "Harness 核心身份",
		source: "dsh-system-prompt",
		category: "identity",
		categoryLabel: "身份与人设",
		description: "DeepSeek Harness 核心身份声明",
		defaultOrder: -1000,
		defaultText: "You are an AI agent powered by DeepSeek Harness.",
	},
	"deployment:persona-prefix": {
		name: "部署人设前缀",
		source: "dsh-system-prompt",
		category: "identity",
		categoryLabel: "身份与人设",
		description: "部署环境或预设注入的人设前缀（支持 {{model}} 等变量）",
		defaultOrder: 0,
		defaultText: "You are a coding agent powered by the {{model}} model.",
	},
	"dsh-remote": {
		name: "远程交互支持",
		source: "dsh-remote",
		category: "plugins",
		categoryLabel: "插件与扩展",
		description: "远端交互网关声明",
		defaultOrder: 88,
		defaultText: "",
	},
	"free-search:engines": {
		name: "联网检索配置",
		source: "dsh-free-search",
		category: "plugins",
		categoryLabel: "插件与扩展",
		description: "联网搜索引擎配置与抓取说明",
		defaultOrder: 500,
		defaultText: "## Web search (free-search)\nCurrent mode: bing.",
	},
	"plan:policy": {
		name: "规划模式策略 (Plan Mode)",
		source: "dsh-plan-mode",
		category: "policy",
		categoryLabel: "策略与协作",
		description: "Plan 模式下的只读规划与探索规范，限制只读与计划提交流程",
		defaultOrder: 500,
		defaultText: "You are in plan mode. Stay in plan mode until the user approves your plan through exit_plan_mode or switches the session mode.",
	},
	"team:policy": {
		name: "Agent Teams 团队规范",
		source: "dsh-agent-team",
		category: "policy",
		categoryLabel: "策略与协作",
		description: "团队 Lead 与 Teammates 协同原则、任务认领与流转准则",
		defaultOrder: 600,
		defaultText: "Agent Teams is available in this session.",
	},
	"ptc:only": {
		name: "代码调用模式引导 (PTC)",
		source: "dsh-agent-preset",
		category: "tools",
		categoryLabel: "工具与能力",
		description: "PTC 模式下强制通过 run_code 调用工具的指导原则",
		defaultOrder: 800,
		defaultText: "`run_code` is the only tool you can call directly.",
	},
	"tools:ptc-only": {
		name: "PTC 专用工具策略",
		source: "dsh-agent-preset",
		category: "plugins",
		categoryLabel: "插件与扩展",
		description: "PTC 模式下的专用工具限制与调用说明",
		defaultOrder: 800,
		defaultText: "`run_code` is the only tool you can call directly — a tool call naming any other tool fails. Reach every tool the SDK declares below from inside the program.",
	},
	"file:reference": {
		name: "文件引用规范",
		source: "dsh-system-prompt",
		category: "policy",
		categoryLabel: "策略与协作",
		description: "@ 路径标记规范与文件相对/绝对路径解析策略",
		defaultOrder: 900,
		defaultText: "Tokens prefixed with @ are paths the user explicitly referenced.",
	},
	"tool:bash": {
		name: "工具指南 (bash)",
		source: "dsh-tool-bash",
		category: "tools",
		categoryLabel: "工具与能力",
		description: "命令行 bash 执行安全规范、沙箱策略与错误捕获",
		defaultOrder: 1000,
		defaultText: "Check the [exit code: N] marker on every bash result; investigate failures before moving on.",
	},
	"tool:read": {
		name: "工具指南 (read)",
		source: "dsh-tool-fs",
		category: "tools",
		categoryLabel: "工具与能力",
		description: "文件读取规范：严禁 cat，使用 read 工具按行分页读取",
		defaultOrder: 1100,
		defaultText: "Use the read tool — not shell commands like cat — to inspect text files.",
	},
	"tool:write": {
		name: "工具指南 (write)",
		source: "dsh-tool-fs",
		category: "tools",
		categoryLabel: "工具与能力",
		description: "写文件前置检查规范：覆盖前必须先 read 检查",
		defaultOrder: 1200,
		defaultText: "Read an existing file before overwriting it with write.",
	},
	"tool:edit": {
		name: "工具指南 (edit)",
		source: "dsh-tool-fs",
		category: "tools",
		categoryLabel: "工具与能力",
		description: "局部精准编辑规范：优先使用 edit 代替整文件覆盖",
		defaultOrder: 1300,
		defaultText: "Read a file before editing it, unless you just created or edited it in this session.",
	},
	"tool:glob": {
		name: "工具指南 (glob)",
		source: "dsh-tool-fs-search",
		category: "tools",
		categoryLabel: "工具与能力",
		description: "文件查找规范：使用 glob 遍历，代替 shell find",
		defaultOrder: 1400,
		defaultText: "Use the glob tool — not shell find — to discover files by path pattern.",
	},
	"tool:grep": {
		name: "工具指南 (grep)",
		source: "dsh-tool-fs-search",
		category: "tools",
		categoryLabel: "工具与能力",
		description: "代码正则检索规范：使用 grep 工具，避免全仓盲扫",
		defaultOrder: 1500,
		defaultText: "Use the grep tool — not shell grep or rg — to search file contents.",
	},
	"tool:jobs": {
		name: "工具指南 (jobs)",
		source: "dsh-tool-jobs",
		category: "tools",
		categoryLabel: "工具与能力",
		description: "后台长时间任务生命周期管理",
		defaultOrder: 1600,
		defaultText: "Track every background job id you start. You are notified in-session when a job finishes.",
	},
	"tool:pty": {
		name: "工具指南 (pty)",
		source: "dsh-terminal",
		category: "tools",
		categoryLabel: "工具与能力",
		description: "持久化终端会话管理与交互规范",
		defaultOrder: 1700,
		defaultText: "Use a terminal session only when work needs persistent terminal state or interactive stdin.",
	},
	"tool:web_search": {
		name: "工具指南 (web_search)",
		source: "dsh-tool-web",
		category: "tools",
		categoryLabel: "工具与能力",
		description: "互联网实时检索规范",
		defaultOrder: 2000,
		defaultText: "Use web_search to find information on the internet.",
	},
	"tool:web_fetch": {
		name: "工具指南 (web_fetch)",
		source: "dsh-tool-web",
		category: "tools",
		categoryLabel: "工具与能力",
		description: "网页深度内容抓取与提取规范",
		defaultOrder: 2100,
		defaultText: "Use web_fetch to fetch and read web pages.",
	},
	"tool:session-query": {
		name: "工具指南 (session-query)",
		source: "dsh-session-query",
		category: "tools",
		categoryLabel: "工具与能力",
		description: "历史会话与本会话时间线事件回溯",
		defaultOrder: 2300,
		defaultText: "Use session_search to find relevant work from prior sessions, or session_event_search to search earlier events in one session.",
	},
	"tool:goal": {
		name: "工具指南 (goal)",
		source: "dsh-tool-goal",
		category: "tools",
		categoryLabel: "工具与能力",
		description: "长时间自主多轮目标持久化与状态机管理",
		defaultOrder: 2400,
		defaultText: "create_goal may infer goal intent from a direct human request in any language.",
	},
	"tool-result-fork:protocol": {
		name: "分发结果协议",
		source: "dsh-tool-result-fork",
		category: "plugins",
		categoryLabel: "插件与扩展",
		description: "工具结果分支协议",
		defaultOrder: 2500,
		defaultText: "Tool result fork protocol.",
	},
	"tool:workflow": {
		name: "工具指南 (workflow)",
		source: "dsh-tool-workflow",
		category: "tools",
		categoryLabel: "工具与能力",
		description: "自主工作流执行引擎",
		defaultOrder: 2600,
		defaultText: "Run autonomous multi-step workflows toward user goals.",
	},
	"billion-context": {
		name: "上下文原生压缩 (ACP)",
		source: "dsh-billion-context-native",
		category: "plugins",
		categoryLabel: "插件与扩展",
		description: "百亿上下文自适应压缩管理指南",
		defaultOrder: 2650,
		defaultText: "## Context Management & ACP Compression (Native billion-context)",
	},
	"tool:ralph": {
		name: "工具指南 (ralph)",
		source: "dsh-tool-ralph",
		category: "tools",
		categoryLabel: "工具与能力",
		description: "Fresh Agent Ralph 循环执行规范",
		defaultOrder: 2700,
		defaultText: "Use the ralph tool ONLY when the direct human explicitly asks for a Ralph loop or fresh-agent iterative execution.",
	},
	"tool:subagent_fork": {
		name: "工具指南 (subagent)",
		source: "dsh-tool-subagent",
		category: "tools",
		categoryLabel: "工具与能力",
		description: "独立子代理与上下文派生子代理的并行分发规范",
		defaultOrder: 2800,
		defaultText: "Start independent delegations with subagent or subagent_fork together in one assistant message and continue useful work while they run.",
	},
	"mcp-resource-servers": {
		name: "MCP 资源服务声明",
		source: "dsh-mcp",
		category: "plugins",
		categoryLabel: "插件与扩展",
		description: "挂载的外部 MCP 资源服务器清单与读取规范",
		defaultOrder: 3100,
		defaultText: "## MCP resource servers",
	},
	"mcp:magpie-image": {
		name: "MCP 图像服务",
		source: "dsh-mcp",
		category: "tools",
		categoryLabel: "工具与能力",
		description: "Magpie 图像与视频生成 MCP 工具接入",
		defaultOrder: 3100,
		defaultText: "Use list_mcp_resources, list_mcp_resource_templates, or read_mcp_resource with one of these names as the server argument: [\"magpie-image\"].",
	},
	"tools:sdk": {
		name: "PTC 工具 SDK 声明",
		source: "dsh-agent-preset",
		category: "tools",
		categoryLabel: "工具与能力",
		description: "PTC TypeScript SDK 类型定义与 API 接入签名",
		defaultOrder: 5000,
		defaultText: "`run_code` takes two required arguments: `code` and `description`.",
	},
	"deliverable:file-references": {
		name: "交付物呈现规范",
		source: "dsh-system-prompt",
		category: "delivery",
		categoryLabel: "交付与输出",
		description: "交付物呈现与文件绝对/相对引用语法与 present 工具调用准则",
		defaultOrder: 9000,
		defaultText: "Prefer showing the primary results within your final response alongside a brief explanation.",
	},
	"ui:deliverable-file-references": {
		name: "交付物文件引用 UI",
		source: "dsh-tool-present",
		category: "plugins",
		categoryLabel: "插件与扩展",
		description: "交付物链接与卡片渲染规范",
		defaultOrder: 9000,
		defaultText: "Render deliverable file references.",
	},
	"genui:fence": {
		name: "结构化交互围栏 (GenUI)",
		source: "dsh-genui",
		category: "plugins",
		categoryLabel: "插件与扩展",
		description: "通过 dsh-ui 围栏呈现结构化互动界面的语法与组件契约",
		defaultOrder: 9900,
		defaultText: "Render UI inside your reply with a fenced dsh-ui JSON block.",
	},
	"structured:output": {
		name: "结构化交互输出规范",
		source: "dsh-system-prompt",
		category: "delivery",
		categoryLabel: "交付与输出",
		description: "回答内联 UI 围栏呈现规范",
		defaultOrder: 9900,
		defaultText: "Render structured UI inside your reply.",
	},
	"harness:source": {
		name: "Harness 源码路径说明",
		source: "dsh-system-prompt",
		category: "environment",
		categoryLabel: "环境与平台",
		description: "运行上下文实现代码检出路径与当前工作目录区别",
		defaultOrder: 10000,
		defaultText: "The runtime context names the DeepSeek Harness implementation checkout.",
	},
	"tool-control:deferred": {
		name: "工具门控延时声明",
		source: "dsh-tool-control",
		category: "plugins",
		categoryLabel: "插件与扩展",
		description: "为节省上下文预算而实施的工具门控机制说明",
		defaultOrder: 10000,
		defaultText: "This session's tool list is filtered to save context.",
	},
	"app:web-surface": {
		name: "Web 界面交互环境",
		source: "dsh-web-app",
		category: "plugins",
		categoryLabel: "插件与扩展",
		description: "DSH Web GUI 运行上下文环境事实说明",
		defaultOrder: 10100,
		defaultText: "You are interacting with the user through the DeepSeek Harness Web GUI.",
	},
	"web:surface": {
		name: "Web GUI 交互环境规范",
		source: "dsh-system-prompt",
		category: "environment",
		categoryLabel: "环境与平台",
		description: "网页环境上下文与 HMR 说明",
		defaultOrder: 10100,
		defaultText: "When the user refers to \"this page\", \"this GUI\", or \"this app\" without naming another target, they mean this GUI.",
	},
	"tool-control:notice": {
		name: "工具门控提示说明",
		source: "dsh-tool-control",
		category: "plugins",
		categoryLabel: "插件与扩展",
		description: "延时工具搜索引导说明",
		defaultOrder: 10150,
		defaultText: "Search for deferred tools before telling the user a capability is unavailable.",
	},
	"deployment:persona-suffix": {
		name: "部署人设后缀",
		source: "dsh-system-prompt",
		category: "identity",
		categoryLabel: "身份与人设",
		description: "部署环境注入的人设后缀说明",
		defaultOrder: 10200,
		defaultText: "",
	},
	"dsh-context:prompt-suffix": {
		name: "上下文提示后缀",
		source: "dsh-context",
		category: "plugins",
		categoryLabel: "插件与扩展",
		description: "上下文注入层尾部后缀",
		defaultOrder: 11200,
		defaultText: "",
	},
};

/**
 * 各 Agent 预设在代码中实际声明与使用的提示词段落清单
 * 来源：dsh-web-app presets (standard, ptc, minimal, cordis) 以及系统底座注册
 */

/**
 * 根据段落 key 识别所属类别与来源元数据
 */

/**
 * 估算提示词文本的 Token 消耗
 */
export function estimateTokens(text) {
	if (!text || typeof text !== "string") return 0;
	let tokens = 0;
	for (let i = 0; i < text.length; i++) {
		const code = text.charCodeAt(i);
		tokens += code > 255 ? 1 : 0.25;
	}
	return Math.ceil(tokens);
}

export function classifySection(key) {
	if (KNOWN_SECTIONS[key]) {
		return KNOWN_SECTIONS[key];
	}

	let category = "plugins";
	let categoryLabel = "插件与扩展";
	let source = "unknown";
	let description = `段落: ${key}`;
	let defaultOrder = 1000;

	if (key.startsWith("tool:")) {
		category = "tools";
		categoryLabel = "工具与能力";
		source = `dsh-${key.replace("tool:", "tool-")}`;
	} else if (key.startsWith("mcp:")) {
		category = "tools";
		categoryLabel = "工具与能力";
		source = "mcp";
	} else if (key.startsWith("plan:") || key.startsWith("team:") || key.startsWith("file:")) {
		category = "policy";
		categoryLabel = "策略与协作";
		source = key.startsWith("plan:") ? "dsh-plan-mode" : key.startsWith("team:") ? "dsh-agent-team" : "dsh-system-prompt";
	} else if (key.startsWith("harness:") || key.startsWith("deployment:")) {
		category = "identity";
		categoryLabel = "身份与人设";
		source = "dsh-system-prompt";
	} else if (key.startsWith("web:") || key.startsWith("app:")) {
		category = "environment";
		categoryLabel = "环境与平台";
		source = "dsh-web-app";
	} else if (key.startsWith("deliverable:") || key.startsWith("structured:")) {
		category = "delivery";
		categoryLabel = "交付与输出";
		source = "dsh-system-prompt";
	} else if (key.startsWith("custom:")) {
		category = "custom";
		categoryLabel = "自定义段落";
		source = "dsh-prompt-control";
	}

	return {
		name: key,
		source,
		category,
		categoryLabel,
		description,
		defaultOrder,
		defaultText: "",
	};
}

export const PRESET_DEFINED_SECTIONS = {
	minimal: new Set([
		"dsh-context:prompt-prefix",
		"harness:identity",
		"deployment:persona-prefix",
		"dsh-remote",
		"tool:pty",
		"tool:session-query",
		"billion-context",
		"tool:ralph",
		"mcp-resource-servers",
		"mcp:magpie-image",
		"deliverable:file-references",
		"ui:deliverable-file-references",
		"genui:fence",
		"structured:output",
		"harness:source",
		"tool-control:deferred",
		"app:web-surface",
		"web:surface",
		"tool-control:notice",
		"deployment:persona-suffix",
		"dsh-context:prompt-suffix",
	]),
	standard: new Set([
		"dsh-context:prompt-prefix",
		"harness:identity",
		"deployment:persona-prefix",
		"dsh-remote",
		"free-search:engines",
		"plan:policy",
		"team:policy",
		"file:reference",
		"tool:bash",
		"tool:read",
		"tool:write",
		"tool:edit",
		"tool:glob",
		"tool:grep",
		"tool:jobs",
		"tool:pty",
		"tool:web_search",
		"tool:web_fetch",
		"tool:session-query",
		"tool:goal",
		"tool-result-fork:protocol",
		"tool:workflow",
		"billion-context",
		"tool:ralph",
		"tool:subagent_fork",
		"mcp-resource-servers",
		"mcp:magpie-image",
		"deliverable:file-references",
		"ui:deliverable-file-references",
		"genui:fence",
		"structured:output",
		"harness:source",
		"tool-control:deferred",
		"app:web-surface",
		"web:surface",
		"tool-control:notice",
		"deployment:persona-suffix",
		"dsh-context:prompt-suffix",
	]),
	ptc: new Set([
		"dsh-context:prompt-prefix",
		"harness:identity",
		"deployment:persona-prefix",
		"dsh-remote",
		"free-search:engines",
		"plan:policy",
		"team:policy",
		"ptc:only",
		"tools:ptc-only",
		"file:reference",
		"tool:bash",
		"tool:read",
		"tool:write",
		"tool:edit",
		"tool:glob",
		"tool:grep",
		"tool:jobs",
		"tool:pty",
		"tool:web_search",
		"tool:web_fetch",
		"tool:session-query",
		"tool:goal",
		"tool-result-fork:protocol",
		"billion-context",
		"tool:ralph",
		"tool:subagent_fork",
		"mcp-resource-servers",
		"mcp:magpie-image",
		"tools:sdk",
		"deliverable:file-references",
		"ui:deliverable-file-references",
		"genui:fence",
		"structured:output",
		"harness:source",
		"tool-control:deferred",
		"app:web-surface",
		"web:surface",
		"tool-control:notice",
		"deployment:persona-suffix",
		"dsh-context:prompt-suffix",
	]),
	cordis: new Set([
		"dsh-context:prompt-prefix",
		"harness:identity",
		"deployment:persona-prefix",
		"dsh-remote",
		"free-search:engines",
		"plan:policy",
		"team:policy",
		"file:reference",
		"tool:bash",
		"tool:read",
		"tool:write",
		"tool:edit",
		"tool:glob",
		"tool:grep",
		"tool:jobs",
		"tool:pty",
		"tool:web_search",
		"tool:web_fetch",
		"tool:session-query",
		"tool:goal",
		"tool-result-fork:protocol",
		"tool:workflow",
		"billion-context",
		"tool:ralph",
		"tool:subagent_fork",
		"mcp-resource-servers",
		"mcp:magpie-image",
		"deliverable:file-references",
		"ui:deliverable-file-references",
		"genui:fence",
		"structured:output",
		"harness:source",
		"tool-control:deferred",
		"app:web-surface",
		"web:surface",
		"tool-control:notice",
		"deployment:persona-suffix",
		"dsh-context:prompt-suffix",
	]),
};

/**
 * 判断指定段落是否属于某预设
 */
export function isSectionInPreset(key, preset) {
	if (!preset || preset === "all") return true;
	const definedSet = PRESET_DEFINED_SECTIONS[preset];
	if (definedSet && definedSet.has(key)) return true;
	const seen = SEEN_SECTIONS.get(key);
	if (seen && seen.presets && seen.presets.has(preset)) return true;
	return false;
}

/**
 * 实际观测/注册过的段落缓存。
 *
 * 只装「当前真的注册在 systemPrompt 层里的段落」，不再用 KNOWN_SECTIONS 预填充：
 * 预填充会让已停用插件（dsh-remote、dsh-genui、dsh-billion-context-native 等）的
 * 段落永远留在列表里，看起来像还在生效。插件启用后注册段落会自然进入这里；
 * 插件停用后从 layer 里消失，列表随即隐藏。
 */
const SEEN_SECTIONS = new Map();

/**
 * 解析当前 Agent 执行环境对应的 Preset
 */

export function resolvePreset(ctx, context) {
	if (context?.agent) {
		const agent = context.agent;
		const agentPresets = typeof ctx.get === "function" ? ctx.get("agentPresets") : ctx.agentPresets;
		const sessionProjections = typeof ctx.get === "function" ? ctx.get("sessionProjections") : ctx.sessionProjections;
		const preset =
			agentPresets?.composedPreset?.(agent.ctx) ||
			agent.session?.header?.agentPreset ||
			sessionProjections?.stateOf?.(agent.session, "agentPreset");
		if (preset) return preset;
	}
	const agentPresets = typeof ctx.get === "function" ? ctx.get("agentPresets") : ctx.agentPresets;
	return agentPresets?.defaultId || "standard";
}

/**
 * 核心转换逻辑：根据配置与当前预设，重构 sections 列表
 */
export function transformSections(sections, preset, config) {
	if (!Array.isArray(sections) || sections.length === 0) return sections;

	// 1. 过滤已停用段落，应用文本覆盖
	const working = [];
	for (const section of sections) {
		const presetRule = config.presetOverrides?.[preset]?.[section.name];
		const globalRule = config.overrides?.[section.name];
		const effectiveRule = presetRule ?? globalRule;

		// 检查是否停用
		if (effectiveRule && effectiveRule.enabled === false) {
			continue;
		}

		// 检查是否文本覆盖：显式 "" 也算定制（允许把某段整体清空，以前空串
		// 被当成「没定制」，于是「把这段删掉」这个最常见的诉求永远做不到）。
		const hasOverrideText = Boolean(effectiveRule) && typeof effectiveRule.text === "string";

		const text = hasOverrideText ? effectiveRule.text : section.text;

		working.push({
			...section,
			text,
			overridden: hasOverrideText,
		});
	}

	// 2. 应用自定义插入 (insertions)
	const insertions = Array.isArray(config.insertions) ? config.insertions : [];
	const matchingInsertions = insertions.filter((ins) => {
		if (ins.enabled === false) return false;
		if (!ins.preset || ins.preset === "all" || ins.preset === preset) return true;
		return false;
	});

	for (const ins of matchingInsertions) {
		const insSection = {
			name: `custom:${ins.id}`,
			text: ins.text || "",
			custom: true,
			id: ins.id,
			customName: ins.name || "自定义提示词",
		};

		if (ins.position === "start" || ins.targetSection === "<start>") {
			working.unshift(insSection);
		} else if (ins.position === "end" || !ins.targetSection || ins.targetSection === "<end>") {
			working.push(insSection);
		} else if (ins.position === "before") {
			const idx = working.findIndex((s) => s.name === ins.targetSection);
			if (idx >= 0) {
				working.splice(idx, 0, insSection);
			} else {
				working.push(insSection);
			}
		} else if (ins.position === "after") {
			const idx = working.findIndex((s) => s.name === ins.targetSection);
			if (idx >= 0) {
				working.splice(idx + 1, 0, insSection);
			} else {
				working.push(insSection);
			}
		} else {
			working.push(insSection);
		}
	}

	// 3. 应用自定义排序 (如果配置了 sectionOrder)
	if (Array.isArray(config.sectionOrder) && config.sectionOrder.length > 0) {
		const orderMap = new Map();
		config.sectionOrder.forEach((name, idx) => orderMap.set(name, idx));

		const ordered = [];
		const rest = [];
		for (const sec of working) {
			if (orderMap.has(sec.name)) {
				ordered.push(sec);
			} else {
				rest.push(sec);
			}
		}
		ordered.sort((a, b) => orderMap.get(a.name) - orderMap.get(b.name));
		return [...ordered, ...rest];
	}

	return working;
}

/**
 * 模拟插值变量（用于前端预览展示）
 */
export function interpolateVariables(text, variables) {
	if (!text || typeof text !== "string") return "";
	return text.replace(/\{\{([a-z][a-z0-9_]*)\}\}/g, (match, name) => {
		return Object.prototype.hasOwnProperty.call(variables, name) && variables[name] !== undefined
			? String(variables[name])
			: match;
	});
}

/**
 * 模拟渲染指定 preset 下的完整 System Prompt
 */
/**
 * 获取指定预设在代码中实际声明/挂载的提示词段落 Map<name, { name, text, order }>
 * 如果是 'all'，则返回 null（表示全局/全量模式）
 */
export async function getPresetRawSections(ctx, preset) {
	if (!preset || preset === "all") return null;
	const layers = ctx.systemPrompt?.layers;
	if (!layers) return null;
	let scopeKey = undefined;
	let releaseScope = null;
	const agentPresets = typeof ctx.get === "function" ? ctx.get("agentPresets") : ctx.agentPresets;
	if (agentPresets && typeof agentPresets.acquireScope === "function") {
		try {
			const acquired = await agentPresets.acquireScope(preset);
			scopeKey = acquired.key;
			releaseScope = acquired[Symbol.asyncDispose];
		} catch {}
	}
	try {
		const merged = layers.merge(scopeKey, (l) => l.sections);
		if (merged && typeof merged.entries === "function") {
			const map = new Map();
			for (const [name, sec] of merged.entries()) {
				let text = "";
				try {
					text = typeof sec.text === "function" ? sec.text({ scope: scopeKey }) : sec.text;
				} catch {}
				const defText = text || (KNOWN_SECTIONS[name]?.defaultText || "");
				map.set(name, {
					name,
					text: defText,
					defaultText: defText,
					order: sec.order ?? (KNOWN_SECTIONS[name]?.defaultOrder ?? 0),
					presets: new Set([preset]),
				});
				const existing = SEEN_SECTIONS.get(name);
				if (existing) {
					if (text && (!existing.defaultText || existing.defaultText.trim() === "")) {
						existing.defaultText = text;
					}
					existing.presets.add(preset);
				} else {
					SEEN_SECTIONS.set(name, {
						name,
						defaultText: text || (KNOWN_SECTIONS[name]?.defaultText || ""),
						order: sec.order ?? (KNOWN_SECTIONS[name]?.defaultOrder ?? 0),
						presets: new Set([preset]),
						observed: true,
						firstSeenAt: Date.now(),
						lastSeenAt: Date.now(),
					});
				}
			}
			return map;
		}
	} catch {} finally {
		if (releaseScope) {
			try { await releaseScope(); } catch {}
		}
	}
	return null;
}

/**
 * 列出宿主当前组合出的全部预设 id。
 *
 * 只在「全部预设」视图/可用性判断里用：具体预设仍以 getPresetRawSections 为准。
 */
export async function listPresetIds(ctx) {
	const agentPresets = typeof ctx?.get === "function" ? ctx.get("agentPresets", false) : ctx?.agentPresets;
	try {
		if (agentPresets && typeof agentPresets.list === "function") {
			const list = await agentPresets.list();
			const ids = Array.isArray(list)
				? list.map((preset) => preset?.id).filter((id) => typeof id === "string" && id.length > 0 && id !== "all")
				: [];
			if (ids.length > 0) return [...new Set(ids)];
		}
		if (agentPresets?.definitions && typeof agentPresets.definitions.keys === "function") {
			return Array.from(agentPresets.definitions.keys()).filter((id) => typeof id === "string" && id.length > 0 && id !== "all");
		}
	} catch {}
	return Object.keys(PRESET_DEFINED_SECTIONS).filter((id) => id !== "all");
}

/**
 * 收集「当前真的注册在 systemPrompt 层里」的段落。
 *
 * - 具体预设：直接读该预设作用域合并后的 layer，这就是该预设真实可装配的段落。
 * - 全部预设：对每个预设的 layer 取并集；未启用插件不会注册，所以不会出现在并集里。
 *
 * 返回 null 表示宿主没有可读的 layer（测试/极简宿主），调用方才退回观测缓存。
 */
export async function collectLiveSections(ctx, preset) {
	if (preset && preset !== "all") return getPresetRawSections(ctx, preset);

	const presetIds = await listPresetIds(ctx);
	if (presetIds.length === 0) return null;

	const union = new Map();
	for (const presetId of presetIds) {
		const map = await getPresetRawSections(ctx, presetId);
		if (!map) continue;
		for (const [name, section] of map) {
			const existing = union.get(name);
			if (!existing) {
				union.set(name, {
					...section,
					presets: new Set(section.presets ? Array.from(section.presets) : [presetId]),
				});
				continue;
			}
			if ((!existing.text || existing.text.length === 0) && section.text) existing.text = section.text;
			if ((!existing.defaultText || existing.defaultText.length === 0) && section.defaultText) {
				existing.defaultText = section.defaultText;
			}
			for (const id of section.presets || [presetId]) existing.presets.add(id);
		}
	}

	return union.size > 0 ? union : null;
}

/**
 * 读取指定预设作用域里真实注册的运行时上下文（systemPrompt.context）。
 *
 * 这些不是提示词 section，而是会作为 user-role 快照进入历史的内容；
 * 与 getPresetRawSections 一样，'all' 由 collectLiveContexts 负责取并集。
 */
export async function getPresetRawContexts(ctx, preset) {
	if (!preset || preset === "all") return null;
	const layers = ctx.systemPrompt?.layers;
	if (!layers) return null;
	let scopeKey = undefined;
	let releaseScope = null;
	const agentPresets = typeof ctx.get === "function" ? ctx.get("agentPresets") : ctx.agentPresets;
	if (agentPresets && typeof agentPresets.acquireScope === "function") {
		try {
			const acquired = await agentPresets.acquireScope(preset);
			scopeKey = acquired.key;
			releaseScope = acquired[Symbol.asyncDispose];
		} catch {}
	}
	try {
		const merged = layers.merge(scopeKey, (layer) => layer.contexts);
		if (merged && typeof merged.entries === "function") {
			const map = new Map();
			for (const [name, entry] of merged.entries()) {
				let text = "";
				try {
					text = typeof entry.text === "function" ? entry.text({ scope: scopeKey }) : entry.text;
				} catch {}
				map.set(name, {
					name,
					text: text || "",
					order: entry.order ?? 0,
					required: entry.required === true,
					presets: new Set([preset]),
				});
			}
			return map;
		}
	} catch {} finally {
		if (releaseScope) {
			try { await releaseScope(); } catch {}
		}
	}
	return null;
}

/** 全部预设的运行时上下文并集；返回 null 表示宿主没有可读的 layer。 */
export async function collectLiveContexts(ctx, preset) {
	if (preset && preset !== "all") return getPresetRawContexts(ctx, preset);

	const presetIds = await listPresetIds(ctx);
	if (presetIds.length === 0) return null;

	const union = new Map();
	for (const presetId of presetIds) {
		const map = await getPresetRawContexts(ctx, presetId);
		if (!map) continue;
		for (const [name, context] of map) {
			const existing = union.get(name);
			if (!existing) {
				union.set(name, {
					...context,
					presets: new Set(context.presets ? Array.from(context.presets) : [presetId]),
				});
				continue;
			}
			if ((!existing.text || existing.text.length === 0) && context.text) existing.text = context.text;
			for (const id of context.presets || [presetId]) existing.presets.add(id);
		}
	}
	return union.size > 0 ? union : null;
}

/** 已知运行时上下文的来源标签，仅用于设置页展示。 */
export const CONTEXT_SOURCE_LABELS = Object.freeze({
	"working-directory:current": "dsh-working-directory",
	"subagent:identity": "dsh-tool-subagent-control",
	"subagent:delegation": "dsh-tool-subagent",
	"sandbox:policy": "dsh-sandbox-policy",
	"approval:policy": "dsh-user-approval",
	"harness:source": "dsh-harness-dev-context",
	"web:surface": "dsh-harness-dev-context",
});

/** 可由提示词管理开关的消息注入源。 */
export const INJECTION_KIND_META = Object.freeze({
	"time-context": {
		label: "时钟 / 时区",
		description: "每个 eligible step 注入的时间、浏览器时区与经过时长快照。",
	},
	"skill-catalog": {
		label: "技能目录",
		description: "会话开始或技能目录变化时注入的 available_skills 清单；逐技能启用/停用请前往「设置 → Skill 管理」。",
	},
	"oswyn-compaction": {
		label: "OSWYN 双轨备忘",
		description: "OSWYN 的回复摘要 / 压缩备忘；若它走自己的投影管线，最稳仍是改 oswyn 配置。",
	},
});

/** 本进程观测到的注入统计（不落盘；dsh-context 才是持久事件源）。 */
const INJECTION_STATS = new Map();
const COUNTED_INJECTION_MESSAGES = new WeakSet();

function messageText(message) {
	if (!Array.isArray(message?.content)) return "";
	return message.content
		.filter((block) => block?.type === "text" && typeof block.text === "string")
		.map((block) => block.text)
		.join("\n");
}

function rememberInjection(message) {
	const kind = message?.source?.kind;
	if (typeof kind !== "string" || kind === "user" || kind === "runtime-context") return;
	if (message && typeof message === "object") {
		if (COUNTED_INJECTION_MESSAGES.has(message)) return;
		COUNTED_INJECTION_MESSAGES.add(message);
	}
	const text = messageText(message);
	const record = INJECTION_STATS.get(kind) || {
		kind,
		count: 0,
		lastAt: null,
		tokens: 0,
		sample: "",
	};
	record.count += 1;
	record.lastAt = Date.now();
	if (text && text.length > record.sample.length) {
		record.sample = text.slice(0, 1200);
		record.tokens = estimateTokens(text);
	}
	INJECTION_STATS.set(kind, record);
}

/**
 * Build the shared agent/pre-step injection filter handler.
 * It records observed injections, then removes disabled source kinds.
 */
function createInjectionFilterHandler(ctx, rawConfig) {
	return async (_payload, next) => {
		const decision = await next();
		if (!decision || decision.kind !== "enter" || !Array.isArray(decision.messages)) {
			return decision;
		}

		const config = readConfig(ctx, rawConfig);
		if (!config.enabled) return decision;

		const policy = config.contextInjections || {};
		const disabledKinds = new Set(policy.disabledKinds || []);

		// Observe all injected messages before filtering, so the UI can show
		// that time-context was seen even when the control suppresses it.
		for (const message of decision.messages) rememberInjection(message);

		const messages =
			disabledKinds.size === 0
				? decision.messages
				: decision.messages.filter((message) => {
						const kind = message?.source?.kind;
						if (typeof kind !== "string" || kind === "user") return true;
						return !disabledKinds.has(kind);
					});
		const changed = messages.length !== decision.messages.length;
		return changed ? { ...decision, messages } : decision;
	};
}

/**
 * 段落当前是否由「已启用插件」注册。
 *
 * 这是隐藏未启用插件的判据：插件没启用 -> 不会往 systemPrompt layer 注册段落
 * -> collectLiveSections 里没有它 -> 提示词管理列表/搜索/详情都不再出现。
 * 插件启用后注册恢复，段落自然回到列表。
 */
export async function isSectionAvailable(ctx, key) {
	const live = await collectLiveSections(ctx, "all");
	if (live) return live.has(key);
	return SEEN_SECTIONS.has(key);
}

/** 未启用插件段落的统一提示：告诉用户先启用插件，而不是假装它还能编辑。 */
export function unavailableSectionMessage(key) {
	const meta = classifySection(key);
	const source = meta?.source && meta.source !== "unknown" ? "（来源插件: " + meta.source + "）" : "";
	return [
		"段落 " + key + source + " 所属插件当前未启用或尚未注册，已从提示词管理中隐藏。",
		"请先在「设置 → 插件」启用对应插件；启用后该段落会自动出现，再回到这里配置。",
	].join("\n");
}

export async function simulatePromptAssembly(ctx, preset, config) {
	// 读取当前系统注册的所有变量
	const variables = {
		model: "antigravity/gemini-3.8-flash",
		provider: "deepseek",
		cwd: "/Users/reno/Documents/deepseek-harness/default-workspace",
	};

	try {
		const varsEntries = ctx.systemPrompt?.layers?.global?.variables?.entries();
		if (varsEntries) {
			for (const [name, provider] of varsEntries) {
				try {
					const val = typeof provider === "function" ? provider({}) : provider;
					if (val !== undefined && val !== null) {
						variables[name] = String(val);
					}
				} catch {}
			}
		}
	} catch {}

	const allSections = [];
	const presetSections = await collectLiveSections(ctx, preset);
	if (presetSections) {
		for (const sec of presetSections.values()) {
			allSections.push(sec);
		}
	} else {
		for (const [key, item] of SEEN_SECTIONS.entries()) {
			if (preset === "all" || item.presets.has("all") || item.presets.has(preset)) {
				const fallbackText = KNOWN_SECTIONS[key]?.defaultText || `[${key} 默认内容]`;
				allSections.push({
					name: key,
					text: item.defaultText || fallbackText,
					order: item.order ?? (KNOWN_SECTIONS[key]?.defaultOrder ?? 0),
				});
			}
		}
	}

	allSections.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name));

	const transformed = transformSections(allSections, preset, config);
	const rendered = transformed
		.map((s) => interpolateVariables(s.text, variables))
		.filter((t) => t && t.length > 0)
		.join("\n\n");

	return {
		preset,
		rendered,
		variables,
		sections: transformed.map((s) => ({
			name: s.name,
			title: s.customName || classifySection(s.name).name,
			text: s.text,
			interpolatedText: interpolateVariables(s.text, variables),
			overridden: Boolean(s.overridden),
			custom: Boolean(s.custom),
			tokenEstimate: estimateTokens(s.text),
		})),
	};
}

const SETTINGS_ROUTE = "/api/dsh-prompt-control/data";

/**
 * 常见提示词变量列表
 */

/**
 * 提示词分类定义表
 */
export const CATEGORY_DEFINITIONS = [
	{ id: "identity", label: "身份与人设", icon: "user", desc: "智能体核心身份与部署人设声明" },
	{ id: "policy", label: "策略与协作", icon: "scroll", desc: "执行规划、协作策略与文件引用规范" },
	{ id: "tools", label: "工具与能力", icon: "wrench", desc: "代码执行、文件读写、搜索与终端等核心能力指南" },
	{ id: "delivery", label: "交付与输出", icon: "package", desc: "交付物呈现、文件引用与结构化输出格式规范" },
	{ id: "environment", label: "环境与平台", icon: "globe", desc: "运行环境、源码检出路径与 Web GUI 交互事实" },
	{ id: "plugins", label: "插件与扩展", icon: "puzzle", desc: "插件扩展、上下文管理 (ACP) 与工具门控机制" },
];

export const AVAILABLE_VARIABLES = [
	{ name: "model", label: "当前模型", desc: "当前使用的模型标识，例如 antigravity/gemini-3.8-flash、deepseek-chat", placeholder: "{{model}}" },
	{ name: "provider", label: "模型服务商", desc: "模型所属服务商名称，例如 deepseek、magpie、openai", placeholder: "{{provider}}" },
	{ name: "cwd", label: "工作区目录", desc: "当前会话的根工作目录路径", placeholder: "{{cwd}}" },
];

/**
 * Cordis Plugin 生命周期挂载
 */

/**
 * 辅助函数：更新并持久化配置
 */

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

/**
 * 兼容旧签名：把 updater 作用在一份配置快照上，先实时生效、再尽力落盘。
 *
 * @param ctx - 插件上下文。
 * @param rawConfig - 激活时下发的配置行。
 * @param updater - 旧式 updater（以 `getLiveField`/`setLiveField` 操作传入对象）。
 */
export function updateControlConfig(ctx, rawConfig, updater) {
	const draft = { ...readConfig(ctx, rawConfig) };
	updater(draft);
	applyLivePatch(draft);
	void commitControlConfig(ctx, draft);
}

/**
 * 工具说明段落的前缀：这些段落讲的是「某个工具怎么用 / 工具策略」，
 * 归 tool-control 控制（full / stub / hidden / disabled 决定它怎么进提示词），
 * prompt-control 不列出、不改写，避免两边同时主张同一段文本。
 */
const TOOL_OWNED_PREFIXES = ["tool:", "tools:", "tool-control:", "mcp:", "mcp-"];

/**
 * 这段是不是「工具说明」（归 tool-control 管）。
 *
 * 判定：显式前缀（tool:* / tools:* / mcp:* / tool-control:*）或归类为「工具与能力」
 * 或来源包是 dsh-tool-*。其余段落（身份、策略、协作、环境、交付…）照旧由本插件管理。
 */
export function isToolOwnedSection(key) {
	const name = String(key || "");
	if (TOOL_OWNED_PREFIXES.some((prefix) => name === prefix.replace(/:$/, "") || name.startsWith(prefix))) {
		return true;
	}
	const meta = classifySection(name);
	return meta.category === "tools" || String(meta.source || "").startsWith("dsh-tool-");
}
/**
 * 调用方所在预设（拿不到就退回宿主默认）。preview / analyze / drift 用它做默认值，
 * 免得「你在跑 ptc，它却在预览 standard」。
 */
export function presetOfCaller(ctx, exec) {
	try {
		return resolvePreset(ctx, { agent: exec?.agent }) || "standard";
	} catch {
		return "standard";
	}
}

/**
 * 类别筛选：同时接受内部代码（tools / policy / identity …）与中文标签，
 * 以及旧文档里的别名（core / rules / teams / workspace / office / other）。
 */
export function categoryMatches(meta, wanted) {
	const value = String(wanted || "").trim();
	if (!value) return true;
	const aliases = { core: "identity", rules: "policy", teams: "policy", workspace: "environment", office: "delivery", other: "plugins" };
	const code = aliases[value] || value;
	return meta.category === code || meta.categoryLabel === value || String(meta.categoryLabel || "").includes(value);
}

/**
 * 定制文本 vs 官方原文：clean（一致）/ drift（原文变了）/ unknown（没有基线）。
 */
export function driftState(rule, nativeText) {
	if (!rule || typeof rule.text !== "string") return "clean";
	if (!rule.baseline || typeof rule.baseline.hash !== "string") return "unknown";
	if (typeof nativeText !== "string") return "unknown";
	return hashPrompt(nativeText) === rule.baseline.hash ? "clean" : "drift";
}
/**
 * 创建智能体专用的提示词检索、控制与优化工具 (prompt_control)
 */
export function createAgentTool(ctx, rawConfig) {
	const ACTIONS = [
		"list",
		"search",
		"get",
		"preview",
		"set_status",
		"set_text",
		"reset",
		"insert",
		"delete_insert",
		"analyze",
		"drift",
		"accept_native",
		"rebaseline",
		"debug-scopes",
	];

	return {
		name: "prompt_control",
		description:
			"Inspect, search, control, modify, and optimize DeepSeek Harness system prompts and custom prompt injections. Supports listing prompt sections with token costs, searching prompt contents, toggling sections on/off per preset or globally, overriding section text, inserting custom prompt rules at any position, previewing full assembled system prompts, and analyzing prompt token distribution and redundancy.",
		parameters: {
			type: "object",
			additionalProperties: false,
			properties: {
				action: {
					type: "string",
					enum: ACTIONS,
					description:
						"Action: 'list' (sections, tokens, drift marks), 'search' (keywords in prompts), 'get' (one section detail), 'preview' (simulate assembled prompt), 'set_status' (enable/disable), 'set_text' (override text, records the official baseline), 'reset' (drop the override), 'insert' (custom rule), 'delete_insert' (remove custom rule), 'analyze' (token distribution + suggestions), 'drift' (list customizations whose official text changed after an update), 'accept_native' (adopt the new official text), 'rebaseline' (keep your text, re-record the baseline), 'debug-scopes' (preset scope diagnostics).",
				},
				section: {
					type: "string",
					description: "Target section key (e.g. 'harness:identity', 'team:policy', 'tool:bash', 'workspace:rules', etc.). Required for get, set_status, set_text, reset.",
				},
				preset: {
					type: "string",
					description: "Target agent preset ('all' for global, 'standard', 'ptc', 'minimal'). Defaults to 'all' for list/set_status/set_text/reset, and to the CALLER's active preset for preview/analyze/drift.",
				},
				query: {
					type: "string",
					description: "Search keyword for 'search' action.",
				},
				enabled: {
					type: "boolean",
					description: "New enabled status for 'set_status' action (true or false).",
				},
				text: {
					type: "string",
					description: "Prompt markdown content for 'set_text' or 'insert'. Supports {{model}}, {{provider}}, {{cwd}} variables.",
				},
				name: {
					type: "string",
					description: "Descriptive name for custom prompt in 'insert'.",
				},
				position: {
					type: "string",
					enum: ["start", "end", "before", "after"],
					description: "Insertion position for 'insert': 'start', 'end', 'before', or 'after'.",
				},
				targetSection: {
					type: "string",
					description: "Target anchor section key when position is 'before' or 'after'.",
				},
				id: {
					type: "string",
					description: "Insertion ID to delete for 'delete_insert'.",
				},
				category: {
					type: "string",
					description: "Optional category filter for 'list'. Accepts internal codes (identity, policy, tools, delivery, environment, plugins), their Chinese labels, and the legacy aliases (core, rules, teams, workspace, office, other).",
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
			// 实时配置：落盘行 + 会话内覆盖（不再是激活时的冻结快照）。
			const config = readConfig(ctx, rawConfig);
			// 调用方所在预设：preview / analyze / drift 默认就看你正在跑的那个。
			const callerPreset = presetOfCaller(ctx, exec);
			const targetPreset =
				args?.preset ||
				(["preview", "analyze", "drift"].includes(action) ? callerPreset : "all");
			/** 当前生效的实时段落 Map；preset=all 时是所有预设真实注册项的并集。 */
			const nativeMap = async (preset) => collectLiveSections(ctx, preset);
			/** 先实时生效，再尽力落盘。 */
			const commit = async (patch) => {
				applyLivePatch(patch);
				return commitControlConfig(ctx, patch);
			};
			/** 生成一份「写入某段落规则」的配置补丁（null = 删除该规则）。 */
			const patchRule = (preset, key, next) => {
				const base = readConfig(ctx, rawConfig);
				if (preset === "all") {
					const nextOverrides = { ...(base.overrides || {}) };
					if (next === null) delete nextOverrides[key];
					else nextOverrides[key] = next;
					return { overrides: nextOverrides };
				}
				const nextPreset = { ...(base.presetOverrides || {}) };
				const one = { ...(nextPreset[preset] || {}) };
				if (next === null) delete one[key];
				else one[key] = next;
				nextPreset[preset] = one;
				return { presetOverrides: nextPreset };
			};

			switch (action) {
				case "debug-scopes": {
					const agentPresets = typeof ctx.get === "function" ? ctx.get("agentPresets") : ctx.agentPresets;
					const defs = agentPresets ? Array.from(agentPresets.definitions.keys()) : [];
					const res = {};
					for (const p of defs) {
						let scopeKey = null;
						let err = null;
						let count = 0;
						let sections = [];
						try {
							const acq = await agentPresets.acquireScope(p);
							scopeKey = acq.key;
							const merged = ctx.systemPrompt?.layers.merge(scopeKey, (l) => l.sections);
							if (merged) {
								count = merged.size;
								sections = Array.from(merged.keys());
							}
							if (acq[Symbol.asyncDispose]) await acq[Symbol.asyncDispose]();
						} catch (e) {
							err = e.message;
						}
						res[p] = { scopeKey, count, err, sections };
					}
					return JSON.stringify(res, null, 2);
				}
				case "list": {
					// 段落池：当前预设的实时注册项（真正的原提示词在这里）优先，
					// 观测缓存只做补全 —— 以前只读缓存，正文常常是空的，token 总数因此低报一个数量级。
					const liveMap = await nativeMap(targetPreset);
					const pool = [];
					if (liveMap) {
						// 只列真实注册在 systemPrompt 层的段落：未启用插件不会注册，
						// 于是自动从列表消失；启用后注册恢复，再出现。
						for (const sec of liveMap.values()) {
							pool.push({
								key: sec.name,
								nativeText: sec.text,
								order: sec.order ?? (KNOWN_SECTIONS[sec.name]?.defaultOrder ?? 0),
								presets: sec.presets ? Array.from(sec.presets) : [targetPreset],
							});
						}
					} else {
						for (const [key, item] of SEEN_SECTIONS.entries()) {
							if (targetPreset !== "all" && !isSectionInPreset(key, targetPreset)) continue;
							pool.push({
								key,
								nativeText: item.defaultText || KNOWN_SECTIONS[key]?.defaultText || "",
								order: item.order ?? (KNOWN_SECTIONS[key]?.defaultOrder ?? 0),
								presets: item.presets ? Array.from(item.presets) : [targetPreset],
							});
						}
					}

					// 工具说明归 tool-control：不列出、也不让它看起来像本插件的管辖范围。
					const toolOwned = pool.filter((entry) => isToolOwnedSection(entry.key));
					const managedPool = pool.filter((entry) => !isToolOwnedSection(entry.key));

					const rows = [];
					for (const entry of managedPool) {
						const key = entry.key;
						const meta = classifySection(key);
						if (!categoryMatches(meta, args?.category)) continue;

						const presetRule = targetPreset !== "all" ? config.presetOverrides?.[targetPreset]?.[key] : undefined;
						const globalRule = config.overrides?.[key];
						const effectiveRule = presetRule ?? globalRule;

						const isEnabled = effectiveRule?.enabled ?? true;
						const hasTextOverride = Boolean(effectiveRule) && typeof effectiveRule.text === "string";
						const nativeText = entry.nativeText;
						const text = hasTextOverride ? effectiveRule.text : nativeText;
						const drift = hasTextOverride ? driftState(effectiveRule, nativeText) : "clean";

						let customState = "原生默认";
						if (presetRule) {
							customState = `预设专属 (${targetPreset})`;
						} else if (globalRule) {
							customState = "全局定制";
						}
						if (drift === "drift") customState += " (原文已更新)";

						rows.push({
							key,
							name: meta.name || key,
							category: meta.categoryLabel,
							order: entry.order,
							tokens: estimateTokens(text),
							enabled: isEnabled,
							customState,
							drifted: drift === "drift",
							presets: entry.presets.join(", "),
						});
					}

					rows.sort((a, b) => a.order - b.order || a.key.localeCompare(b.key));

					const totalTokens = rows.filter((r) => r.enabled).reduce((sum, r) => sum + r.tokens, 0);
					const enabledCount = rows.filter((r) => r.enabled).length;

					const drifted = rows.filter((r) => r.drifted === true);
					const lines = [
						`### 系统提示词段落清单 (预设: ${targetPreset})`,
						`当前注册 **${rows.length}** 个段落（未启用插件的段落已隐藏），生效中 **${enabledCount}** 个，当前预估 Tokens 消耗: **~${totalTokens} tok**。\n`,
						...(drifted.length > 0
							? [
									`> **${drifted.length} 处定制与官方原文不一致**（版本更新后原生提示词变了）。用 \`prompt_control { action: 'drift' }\` 查看，再决定「保留定制」还是「改用新原文」。\n`,
								]
							: []),
						`| # | 段落标识 (Key) | 段落名称 | 类别 | Order | 预估 Tokens | 状态 | 定制状态 | 包含预设 |`,
						`|---|---|---|---|---|---|---|---|---|`,
					];

					rows.forEach((r, idx) => {
						lines.push(
							`| ${idx + 1} | \`${r.key}\` | ${r.name} | ${r.category} | ${r.order} | ~${r.tokens} tok | ${r.enabled ? "启用" : "停用"} | ${r.customState} | ${r.presets} |`,
						);
					});

					const insertions = (config.insertions || []).filter(
						(i) => targetPreset === "all" || i.preset === "all" || i.preset === targetPreset,
					);
					if (insertions.length > 0) {
						lines.push("\n#### 自定义提示词插入规则 (Insertions):");
						insertions.forEach((ins) => {
							const pos = ins.position === "start" ? "置于最前" : ins.position === "end" ? "置于最后" : `${ins.position} \`${ins.targetSection}\``;
							lines.push(
								`- **[${ins.id}]** \`${ins.name}\` (${pos}) — ${ins.enabled !== false ? "启用" : "停用"} | 预估 ~${estimateTokens(ins.text || "")} tok | 预设: ${ins.preset}`,
							);
						});
					}

					if (toolOwned.length > 0) {
						lines.push(
							`\n> 另有 **${toolOwned.length}** 段工具说明（tool:* / tools:* / mcp:* / tool-control:*）由 **tool-control** 控制，本插件不列出、不改写；要调整它们请用 \`tool_control\`。`,
						);
					}
					const staleToolRules = [
						...new Set([
							...Object.keys(config.overrides || {}),
							...Object.values(config.presetOverrides || {}).flatMap((rules) => Object.keys(rules || {})),
						]),
					].filter((key) => isToolOwnedSection(key));
					if (staleToolRules.length > 0) {
						lines.push(
							`> 配置里还留着 **${staleToolRules.length}** 条针对工具说明的旧定制（${staleToolRules.join(", ")}）：它们已不再生效（归 tool-control 管），可用 \`prompt_control { action: "reset", section: "<key>" }\` 清理。`,
						);
					}

					return lines.join("\n");
				}

				case "search": {
					const q = (args?.query || "").trim().toLowerCase();
					if (!q) return "请提供搜索关键词（query 参数），例如：`prompt_control { action: 'search', query: 'run_code' }`。";

					const liveMap = await nativeMap(targetPreset);
					const pool = new Map();
					if (liveMap) {
						for (const sec of liveMap.values()) pool.set(sec.name, sec.text);
					} else {
						for (const [key, item] of SEEN_SECTIONS.entries()) {
							if (targetPreset !== "all" && !isSectionInPreset(key, targetPreset)) continue;
							pool.set(key, item.defaultText || KNOWN_SECTIONS[key]?.defaultText || "");
						}
					}

					const matches = [];
					for (const [key, liveText] of pool.entries()) {
						if (isToolOwnedSection(key)) continue;
						const meta = classifySection(key);
						const presetRule = targetPreset !== "all" ? config.presetOverrides?.[targetPreset]?.[key] : undefined;
						const globalRule = config.overrides?.[key];
						const effectiveRule = presetRule ?? globalRule;
						const currentText = (typeof effectiveRule?.text === "string" ? effectiveRule.text : undefined) ?? liveText;
						const defaultText = liveText;

						const matchInKey = key.toLowerCase().includes(q);
						const matchInName = (meta.name || "").toLowerCase().includes(q);
						const matchInDesc = (meta.description || "").toLowerCase().includes(q);
						const matchInCurrent = currentText.toLowerCase().includes(q);
						const matchInDefault = defaultText.toLowerCase().includes(q);

						if (matchInKey || matchInName || matchInDesc || matchInCurrent || matchInDefault) {
							let snippet = "";
							const textToExtract = matchInCurrent ? currentText : defaultText;
							const idx = textToExtract.toLowerCase().indexOf(q);
							if (idx >= 0) {
								const start = Math.max(0, idx - 60);
								const end = Math.min(textToExtract.length, idx + q.length + 60);
								snippet = (start > 0 ? "..." : "") + textToExtract.slice(start, end).replace(/\n/g, " ") + (end < textToExtract.length ? "..." : "");
							} else {
								snippet = meta.description || meta.name;
							}

							matches.push({
								key,
								name: meta.name || key,
								category: meta.categoryLabel,
								order: liveMap?.get(key)?.order ?? (meta.defaultOrder ?? 0),
								tokens: estimateTokens(currentText),
								snippet,
								overridden: Boolean(effectiveRule?.text),
							});
						}
					}

					if (matches.length === 0) {
						return `未找到包含关键词 "${args.query}" 的提示词段落。可通过 \`list\` 操作查看全部段落。`;
					}

					const lines = [
						`### 搜索结果: "${args.query}" (匹配到 ${matches.length} 个段落)`,
					];
					matches.forEach((m, i) => {
						lines.push(
							`\n${i + 1}. **\`${m.key}\`** — ${m.name} [${m.category}] (Order: ${m.order}, ~${m.tokens} tok, ${m.overridden ? "已定制" : "默认"})`,
						);
						lines.push(`   > *匹配片段*: ${m.snippet}`);
					});

					return lines.join("\n");
				}

				case "get": {
					if (!args?.section) return "请指定要查看的段落标识（section 参数），例如：`harness:identity`。";
					const key = args.section;
					if (isToolOwnedSection(key)) {
						return `段落 \`${key}\` 是工具说明，归 **tool-control** 控制（由 \`tool_control\` 的 full / stub / hidden / disabled 决定它怎么进提示词）。prompt-control 只管其余段落。`;
					}
					const liveMap = await nativeMap(targetPreset);
					if (!liveMap?.has(key) && !(await isSectionAvailable(ctx, key))) {
						return unavailableSectionMessage(key);
					}

					const item = SEEN_SECTIONS.get(key) || { name: key, defaultText: KNOWN_SECTIONS[key]?.defaultText || "", order: KNOWN_SECTIONS[key]?.defaultOrder ?? 0, presets: new Set(["all"]) };
					const meta = classifySection(key);

					const presetRule = targetPreset !== "all" ? config.presetOverrides?.[targetPreset]?.[key] : undefined;
					const globalRule = config.overrides?.[key];
					const effectiveRule = presetRule ?? globalRule;

					const lived = liveMap?.get(key);
					const defaultText = lived?.text ?? item.defaultText ?? KNOWN_SECTIONS[key]?.defaultText ?? "";
					const hasOverride = Boolean(effectiveRule) && typeof effectiveRule.text === "string";
					const currentText = hasOverride ? effectiveRule.text : defaultText;
					const isEnabled = effectiveRule?.enabled ?? true;
					const drift = hasOverride ? driftState(effectiveRule, defaultText) : "clean";

					return [
						`### 段落详情: \`${key}\` (${meta.name || key})`,
						`- **来源插件**: \`${meta.source}\``,
						`- **功能分类**: ${meta.categoryLabel || "其他"}`,
						`- **执行顺序 (Order)**: ${item.order ?? (meta.defaultOrder ?? 0)}`,
						`- **当前预设**: \`${targetPreset}\``,
						`- **装配状态**: ${isEnabled ? "启用中" : "已停用"}`,
						`- **定制状态**: ${presetRule ? `预设专属定制 (${targetPreset})` : globalRule ? "全局定制" : "原生默认"}${drift === "drift" ? " 官方原文已更新" : ""}`,
						`- **字符数 / Tokens**: ${currentText.length} 字符 · ~${estimateTokens(currentText)} tokens`,
						`- **段落描述**: ${meta.description || "无"}`,
						...(drift === "drift"
							? [
									`- **官方原文已更新**: 定制时记录的是 ${effectiveRule?.baseline?.length ?? "?"} 字符（${effectiveRule?.baseline?.at ?? "时间未知"}，预设 \`${effectiveRule?.baseline?.preset ?? targetPreset}\`），当前原文 ${defaultText.length} 字符。可执行 \`prompt_control { action: "rebaseline", section: "${key}", preset: "${targetPreset}" }\` 保留你的定制，或 \`{ action: "accept_native" }\` 改用新原文。`,
								]
							: []),
						``,
						`#### 当前生效提示词内容:`,
						"```markdown",
						currentText || "(内容为空)",
						"```",
						hasOverride && defaultText ? [
							`\n#### DSH 官方原生默认提示词:`,
							"```markdown",
							defaultText,
							"```",
						].join("\n") : "",
					].filter(Boolean).join("\n");
				}

				case "preview": {
					const preview = await simulatePromptAssembly(ctx, targetPreset, config);
					const lines = [
						`### 完整系统提示词装配预览 (预设: ${targetPreset})`,
						`- **包含段落总数**: ${preview.sections.length} 个`,
						`- **总字符数**: ${preview.rendered.length} 字符`,
						`- **预估 Tokens**: ~${Math.ceil(preview.rendered.length / 3)} tokens`,
						`- **已插值实时变量**: ${Object.keys(preview.variables).map((k) => `\`${k}\`=${preview.variables[k]}`).join(", ")}`,
						``,
						`#### 段落执行时间线:`,
					];

					preview.sections.forEach((s, idx) => {
						const tag = s.custom ? "[自定义插入]" : s.overridden ? "[已定制]" : "[原生]";
						lines.push(`${idx + 1}. \`${s.name}\` (${s.title}) ${tag} — ~${s.tokenEstimate} tok`);
					});

					lines.push(`\n#### 最终组装系统提示词全文:`);
					lines.push("```markdown\n" + preview.rendered + "\n```");

					return lines.join("\n");
				}

				case "set_status": {
					if (!args?.section) return "请指定 section 参数。";
					if (typeof args?.enabled !== "boolean") return "请指定 enabled 参数 (true 或 false)。";
					const key = args.section;
					const nextEnabled = args.enabled;
					if (isToolOwnedSection(key)) {
						return `段落 \`${key}\` 是工具说明，归 **tool-control** 控制，prompt-control 不改写它。请用 \`tool_control { action: "set_mode", tool: "...", mode: "hidden" }\` 之类的操作。`;
					}
					const liveMap = await nativeMap(targetPreset);
					if (!liveMap?.has(key) && !(await isSectionAvailable(ctx, key))) {
						return unavailableSectionMessage(key);
					}

					const currentRule =
						(targetPreset !== "all" ? config.presetOverrides?.[targetPreset]?.[key] : undefined) ??
						config.overrides?.[key] ??
						{};
					const saved = await commit(patchRule(targetPreset, key, { ...currentRule, enabled: nextEnabled }));

					return [
						`成功：段落 \`${key}\` 在预设 [${targetPreset}] 中的状态已变更为: **${nextEnabled ? "启用 (Enabled)" : "停用 (Disabled)"}**。`,
						persistNote(saved),
					].join("\n");
				}

				case "set_text": {
					if (!args?.section) return "请指定 section 参数。";
					if (typeof args?.text !== "string") return "请提供 text 参数 (提示词正文内容)。";
					const key = args.section;
					const newText = args.text;
					if (isToolOwnedSection(key)) {
						return `段落 \`${key}\` 是工具说明，归 **tool-control** 控制，prompt-control 不改写它。工具说明随工具状态走，请用 \`tool_control\` 调整。`;
					}
					const liveMap = await nativeMap(targetPreset);
					if (!liveMap?.has(key) && !(await isSectionAvailable(ctx, key))) {
						return unavailableSectionMessage(key);
					}

					// 记录「写这一刻的官方原文」当基线：以后版本更新改了这段原文，
					// drift 检查才能告诉用户「原文变了，要不要保留你的定制」。
					const baselinePreset = targetPreset === "all" ? callerPreset : targetPreset;
					const nativeText = (await nativeMap(baselinePreset))?.get(key)?.text;
					const currentRule =
						(targetPreset !== "all" ? config.presetOverrides?.[targetPreset]?.[key] : undefined) ??
						config.overrides?.[key] ??
						{};
					const nextRule = { ...currentRule, text: newText };
					if (typeof nativeText === "string") {
						nextRule.baseline = {
							hash: hashPrompt(nativeText),
							length: nativeText.length,
							preset: baselinePreset,
							at: new Date().toISOString(),
						};
					}
					const saved = await commit(patchRule(targetPreset, key, nextRule));
					const tok = estimateTokens(newText);

					return [
						`成功：段落 \`${key}\` 在预设 [${targetPreset}] 中的提示词内容已更新（${newText.length} 字符，预估 ~${tok} tokens）。`,
						typeof nativeText === "string"
							? `- 已记录官方原文基线（预设 \`${baselinePreset}\`，${nativeText.length} 字符）：以后版本更新改动了这段原文，会提示你选择「保留定制」还是「改用新原文」。`
							: `- 取不到预设 \`${baselinePreset}\` 下的官方原文，本次未记录基线（无法检测原文变化）。`,
						`提示：可在提示词中继续使用 \`{{model}}\`、\`{{provider}}\`、\`{{cwd}}\` 等动态插值变量。`,
						persistNote(saved),
					].join("\n");
				}

				case "reset": {
					if (!args?.section) return "请指定 section 参数。";
					const key = args.section;

					const saved = await commit(patchRule(targetPreset, key, null));

					return [
						`成功：段落 \`${key}\` 在预设 [${targetPreset}] 中的定制规则已清空，已完全还原为 DSH 官方原生默认提示词。`,
						persistNote(saved),
					].join("\n");
				}

				case "insert": {
					if (!args?.text) return "请提供 text 参数 (要插入的提示词内容)。";
					const newId = "ins_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 6);
					const item = {
						id: newId,
						name: args.name || "自定义提示词",
						position: args.position || "after",
						targetSection: args.targetSection || "<end>",
						text: args.text,
						preset: targetPreset,
						enabled: true,
					};

					const saved = await commit({ insertions: [...(config.insertions || []), item] });

					const posDesc = item.position === "start" ? "置于提示词最前" : item.position === "end" ? "置于提示词最后" : `${item.position} \`${item.targetSection}\``;
					return [
						`成功插入自定义提示词规则！\n- **规则 ID**: \`${newId}\`\n- **名称**: ${item.name}\n- **生效预设**: ${item.preset}\n- **插入位置**: ${posDesc}\n- **预估 Tokens**: ~${estimateTokens(item.text)} tok`,
						persistNote(saved),
					].join("\n");
				}

				case "delete_insert": {
					if (!args?.id) return "请指定要删除的插入项 ID（id 参数）。可先通过 \`list\` 查看现有插入项 ID。";
					const targetId = args.id;

					const beforeList = config.insertions || [];
					const filtered = beforeList.filter((i) => i.id !== targetId);
					if (filtered.length === beforeList.length) {
						return `未找到 ID 为 \`${targetId}\` 的插入项。可通过 \`list\` 查看现有规则。`;
					}
					const saved = await commit({ insertions: filtered });
					return [`成功删除自定义提示词插入项: \`${targetId}\`。`, persistNote(saved)].join("\n");
				}

				case "analyze": {
				
					const preview = await simulatePromptAssembly(ctx, targetPreset, config);
					// 工具说明不算进 Top5 / 类别分布：它们由 tool-control 控制，prompt-control 不掺和。
					const allSections = preview.sections || [];
					const toolSections = allSections.filter((s) => isToolOwnedSection(s.name));
					const sections = allSections.filter((s) => !isToolOwnedSection(s.name));
					const totalTokens = Math.ceil((preview.rendered || "").length / 3);

					const sortedByTokens = [...sections].sort((a, b) => b.tokenEstimate - a.tokenEstimate);
					const top5 = sortedByTokens.slice(0, 5);

					const catStats = {};
					sections.forEach((s) => {
						const meta = classifySection(s.name);
						const cat = meta.categoryLabel || "其他";
						catStats[cat] = (catStats[cat] || 0) + s.tokenEstimate;
					});

					const warnings = [];
					const suggestions = [];

					const officeSecs = sections.filter((s) => s.name.startsWith("univer:") || s.name.startsWith("office:"));
					if (officeSecs.length > 0) {
						const officeTokens = officeSecs.reduce((sum, s) => sum + s.tokenEstimate, 0);
						suggestions.push(
							`**Office / Univer 模块瘦身**: 当前包含 ${officeSecs.length} 个 Office 相关段落（约 ~${officeTokens} tok）。若当前会话专注于软件编码或排错，可使用 \`prompt_control { action: 'set_status', section: '${officeSecs[0].name}', enabled: false }\` 临时停用非必要段落，立减大量 Token 消耗。`,
						);
					}

					if (targetPreset === "standard") {
						suggestions.push(
							`**预设切换建议**: 当前处于 \`standard\` 模式（装配约 ~${totalTokens} tok）。若是纯代码调用任务，切换到 \`ptc\` 预设可避免冗余说明；针对极度关注上下文预算的任务，可切换至 \`minimal\` 预设，提示词开销可直降 60% 以上！`,
						);
					}

					top5.filter((s) => s.tokenEstimate > 1200).forEach((s) => {
						warnings.push(`**超长段落告警**: \`${s.name}\` 预估消耗 ~${s.tokenEstimate} tokens（占总提示词的 ${Math.round((s.tokenEstimate / totalTokens) * 100)}%）。建议检查是否有可精简的重复说明。`);
					});

					return [
						`### 系统提示词架构与 Token 深度分析报告 (${targetPreset} 预设)`,
						`#### 1. 核心指标概览:`,
						`- **装配段落总数**: ${sections.length} 个`,
						`- **系统提示词总长度**: ${preview.rendered.length} 字符`,
						`- **提示词总 Tokens**: **~${totalTokens} tokens**`,
						toolSections.length > 0
							? `- 其中工具说明 ${toolSections.length} 段（~${toolSections.reduce((sum, s) => sum + s.tokenEstimate, 0)} tok）由 **tool-control** 控制，不计入下面的 Top5 / 类别分布。`
							: "",
						``,
						`#### 2. 消耗最高的 Top 5 段落 (Token 大户):`,
						`| 排名 | 段落标识 (Key) | 段落名称 | 预估 Tokens | 占总提示词比重 |`,
						`|---|---|---|---|---|`,
						...top5.map((s, idx) => `| ${idx + 1} | \`${s.name}\` | ${s.title} | ~${s.tokenEstimate} tok | ${(s.tokenEstimate / totalTokens * 100).toFixed(1)}% |`),
						``,
						`#### 3. 各功能类别 Token 分布:`,
						...Object.keys(catStats).map((cat) => `- **${cat}**: ~${catStats[cat]} tok (${(catStats[cat] / totalTokens * 100).toFixed(1)}%)`),
						``,
						warnings.length > 0 ? `#### 4. 冗余与高消耗检测:\n` + warnings.join("\n") + "\n" : "",
						`#### 5. 智能优化建议:`,
						...(suggestions.length > 0 ? suggestions : ["- 当前提示词配置均衡，未发现明显冗余冲突。"]),
					].filter(Boolean).join("\n");
				}

				case "drift": {
					// 版本更新后的「原文漂移」检查：只要某段定制记录了基线，就要复核官方原文是否变过。
					const rows = [];
					const maps = new Map();
					const liveSections = await collectLiveSections(ctx, "all");
					const isAvailable = (key) => (liveSections ? liveSections.has(key) : SEEN_SECTIONS.has(key));
					const mapOf = async (presetId) => {
						if (!presetId || presetId === "all") return null;
						if (!maps.has(presetId)) maps.set(presetId, await getPresetRawSections(ctx, presetId));
						return maps.get(presetId);
					};
					const inspect = async (presetId, key, rule) => {
						if (!rule || typeof rule.text !== "string") return;
						if (isToolOwnedSection(key)) return;
						// 插件未启用/段落未注册时，旧定制不参与 drift 检查；启用后会重新出现。
						if (!isAvailable(key)) return;
						const baseline = rule.baseline || {};
						const map = await mapOf(baseline.preset && baseline.preset !== "all" ? baseline.preset : presetId);
						const current = map?.get(key)?.text;
						rows.push({
							preset: presetId,
							key,
							state: driftState(rule, current),
							baselineAt: baseline.at ?? null,
							baselineLength: typeof baseline.length === "number" ? baseline.length : null,
							currentLength: typeof current === "string" ? current.length : null,
						});
					};
					for (const [key, rule] of Object.entries(config.overrides || {})) await inspect("all", key, rule);
					for (const [presetId, rules] of Object.entries(config.presetOverrides || {})) {
						for (const [key, rule] of Object.entries(rules || {})) await inspect(presetId, key, rule);
					}

					const heading = "### 提示词定制 vs 官方原文";
					if (rows.length === 0) {
						return [
							heading,
							"当前没有任何文本定制（overrides / presetOverrides 里都没有 text），所有段落都在用官方原文 —— 无需处理。",
							"提示：set_text 会自动记录当时的官方原文基线；此后版本更新改动了这段原文，list 会标 ，这里也会列出来。",
						].join("\n");
					}

					const drifted = rows.filter((row) => row.state === "drift");
					const lines = [
						heading,
						`带基线的定制 **${rows.length}** 条，其中 **${drifted.length}** 条与当前官方原文不一致。`,
					];
					for (const row of rows) {
						const where = row.preset === "all" ? "全局" : `预设 ${row.preset}`;
						const mark = row.state === "drift" ? "原文已更新" : row.state === "unknown" ? "无基线" : "一致";
						lines.push(
							`- ${mark} 【${row.key}】(${where}) — 基线 ${row.baselineLength ?? "?"} 字符 / 现原文 ${row.currentLength ?? "?"} 字符，记录于 ${row.baselineAt ?? "未知"}`,
						);
					}
					if (drifted.length > 0) {
						lines.push(
							"",
							"#### 怎么选（对每一条漂移的定制）",
							"- **保留我的定制**：prompt_control { action: 'rebaseline', section: '<key>', preset: '<preset>' } —— 文本不动，只把基线更新到当前原文，之后不再提示。",
							"- **改用新原文**：prompt_control { action: 'accept_native', section: '<key>', preset: '<preset>' } —— 删掉该段定制，回到官方新文本。",
						);
					}
					return lines.join("\n");
				}

				case "accept_native": {
					if (!args?.section) return "请指定 section 参数。";
					const key = args.section;
					const rule =
						(targetPreset !== "all" ? config.presetOverrides?.[targetPreset]?.[key] : undefined) ??
						config.overrides?.[key];
					if (!rule || typeof rule.text !== "string") {
						return `段落 ${key} 在预设 [${targetPreset}] 下没有文本定制，已经是官方原文。`;
					}
					const nextRule = { ...rule };
					delete nextRule.text;
					delete nextRule.baseline;
					const saved = await commit(patchRule(targetPreset, key, Object.keys(nextRule).length > 0 ? nextRule : null));
					return [
						`已改用官方新原文：段落 ${key} 在预设 [${targetPreset}] 下的文本定制已移除。`,
						persistNote(saved),
					].join("\n");
				}

				case "rebaseline": {
					if (!args?.section) return "请指定 section 参数。";
					const key = args.section;
					const rule =
						(targetPreset !== "all" ? config.presetOverrides?.[targetPreset]?.[key] : undefined) ??
						config.overrides?.[key];
					if (!rule || typeof rule.text !== "string") {
						return `段落 ${key} 在预设 [${targetPreset}] 下没有文本定制，无需记录基线。`;
					}
					const baselinePreset = targetPreset === "all" ? callerPreset : targetPreset;
					const nativeText = (await nativeMap(baselinePreset))?.get(key)?.text;
					if (typeof nativeText !== "string") {
						return `取不到预设 ${baselinePreset} 下段落 ${key} 的官方原文，无法记录基线。`;
					}
					const saved = await commit(
						patchRule(targetPreset, key, {
							...rule,
							baseline: {
								hash: hashPrompt(nativeText),
								length: nativeText.length,
								preset: baselinePreset,
								at: new Date().toISOString(),
							},
						}),
					);
					return [
						`已按当前官方原文重新记录基线（预设 ${baselinePreset}，${nativeText.length} 字符）：你的定制文本保持不变。`,
						persistNote(saved),
					].join("\n");
				}
				default:
					return `未知操作: "${action}"。有效操作包括: ${ACTIONS.join(", ")}。`;
			}
		},
	};
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
			description: field("description") || "Optimize system prompt configuration.",
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
	ctx.logger?.info?.("dsh-prompt-control: initializing system prompt manager");
	LIVE_STATE.clear();
	INJECTION_STATS.clear();
	registerBundledSkill(ctx, "prompt-control-optimize", "prompt-control.optimize-skill");

	// 注册 Agent 交互工具 (prompt_control)
	const agentTool = createAgentTool(ctx, rawConfig, updateControlConfig);
	if (ctx.tools && typeof ctx.tools.register === "function") {
		ctx.effect(() => ctx.tools.register(agentTool), "prompt-control.agent-tool");
	} else {
		ctx.inject(["tools"], (scoped) => {
			const toolsService = scoped.get("tools");
			if (toolsService && typeof toolsService.register === "function") {
				scoped.effect(() => toolsService.register(agentTool), "prompt-control.agent-tool");
			}
		});
	}

	// 1. 监听系统提示词组装流水线 (system-prompt/assemble)
	ctx.effect(
		() =>
			ctx.on("system-prompt/assemble", async (initialAssembly, context, next) => {
				const assembly = typeof next === "function" ? await next() : initialAssembly;
				if (!assembly || !Array.isArray(assembly.sections)) return assembly;

				const currentPreset = resolvePreset(ctx, context);

				// 实时记录观测到的原始 sections
				for (const section of assembly.sections) {
					const existing = SEEN_SECTIONS.get(section.name);
					if (existing) {
						if (!existing.defaultText && section.text) {
							existing.defaultText = section.text;
						}
						existing.presets.add(currentPreset);
						existing.lastSeenAt = Date.now();
					} else {
						SEEN_SECTIONS.set(section.name, {
							name: section.name,
							defaultText: section.text || (KNOWN_SECTIONS[section.name]?.defaultText || ""),
							order: section.order ?? (KNOWN_SECTIONS[section.name]?.defaultOrder ?? 0),
							presets: new Set([currentPreset]),
							observed: true,
							firstSeenAt: Date.now(),
							lastSeenAt: Date.now(),
						});
					}
				}

				const config = readConfig(ctx, rawConfig);
				if (!config.enabled) return assembly;

				const transformedSections = transformSections(assembly.sections, currentPreset, config);

				// 逐项关闭运行时上下文：这一步的 assembly.contexts 就是本轮
				// 即将写进模型历史的那份快照。required 需要在过滤时保住，
				// 不同 DSH 版本的 suppressRuntimeContext() 对 required 的
				// 保留行为并不一致，所以这里直接按注册信息过滤。
				const injectionPolicy = config.contextInjections || {};
				const disabledContexts = new Set(injectionPolicy.disabledContexts || []);
				let requiredContexts = null;
				if (injectionPolicy.suppressOptional || disabledContexts.size > 0) {
					try {
						const registered = ctx.systemPrompt?.layers?.merge(context?.scope, (layer) => layer.contexts);
						requiredContexts = new Set();
						if (registered) {
							for (const [name, entry] of registered) {
								if (entry.required === true) requiredContexts.add(name);
							}
						}
					} catch {}
				}
				const contexts = Array.isArray(assembly.contexts)
					? assembly.contexts.filter((entry) => {
							if (requiredContexts?.has(entry.name)) return true;
							if (injectionPolicy.suppressOptional && requiredContexts !== null) return false;
							return !disabledContexts.has(entry.name);
						})
					: assembly.contexts;

				return {
					...assembly,
					sections: transformedSections,
					contexts,
				};
			}),
		"prompt-control.assemble",
	);

	// 2. 过滤 agent/pre-step 注入的 user 消息（time-context 等）。
	// Cordis waterfall 从外层向内层执行；prepend 用 unshift，后注册的在最外层。
	// 官方 time-context 同样使用 { prepend: true } 且可能晚于本插件加载。
	// 这里用全局 internal/listener + queueMicrotask 仅在有其他插件 prepend 注册
	// agent/pre-step 时将本过滤器重新置顶：无需改宿主/打补丁，也不在每次
	// internal/dispatch 中同步销毁并重建 effect。
	const injectionFilterHandler = createInjectionFilterHandler(ctx, rawConfig);
	ctx.effect(() => {
		let disposed = false;
		let installing = false;
		let filterDispose;
		const installFilter = () => {
			if (disposed || installing) return;
			installing = true;
			try {
				filterDispose?.();
				filterDispose = ctx.on("agent/pre-step", injectionFilterHandler, { prepend: true });
			} catch {} finally {
				installing = false;
			}
		};
		installFilter();
		const watcher = ctx.on(
			"internal/listener",
			(eventName, _listener, options) => {
				if (disposed || installing || eventName !== "agent/pre-step" || !options?.prepend) return;
				queueMicrotask(installFilter);
			},
			{ global: true },
		);
		return () => {
			disposed = true;
			watcher();
			filterDispose?.();
			filterDispose = undefined;
		};
	}, "prompt-control.injection-filter");

	// 3. 注册 HTTP 接口，向前端 settings 面板与管理界面提供实时数据
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
							if (request && typeof request.json === "function") {
								body = await request.json();
							}
						} catch {}

						const action = body?.action || "get-overview";

						// 读取系统中所有注册的 Presets
						let availablePresets = [
							{ id: "all", name: "全部预设 (全局)", description: "对所有预设生效" },
							{ id: "standard", name: "Standard", description: "标准预设模式" },
							{ id: "ptc", name: "PTC", description: "代码调用执行模式" },
							{ id: "minimal", name: "Minimal", description: "精简基础模式" },
						];

						try {
							const agentPresets = typeof ctx.get === "function" ? ctx.get("agentPresets") : ctx.agentPresets;
							if (agentPresets && typeof agentPresets.list === "function") {
								const list = await agentPresets.list();
								if (Array.isArray(list) && list.length > 0) {
									const defaultId = agentPresets.defaultId || "standard";
									availablePresets = [
										{ id: "all", name: "全部预设 (全局)", description: "对所有预设生效" },
										...list.map((p) => ({
											id: p.id,
											name: p.name || p.id,
											description: p.description || "",
											isDefault: p.id === defaultId,
										})),
									];
								}
							}
						} catch (err) {
							ctx.logger?.warn?.(`dsh-prompt-control: failed to list presets: ${String(err)}`);
						}

						// 动作：预览渲染结果
						if (action === "preview-prompt") {
							const targetPreset = body?.preset || "standard";
							const preview = await simulatePromptAssembly(ctx, targetPreset, config);
							return new Response(
								JSON.stringify({ ok: true, value: preview }),
								{ headers: { "content-type": "application/json" } },
							);
						}

						// 动作：获取全量概览数据（默认聚焦于系统默认预设，通常为 ptc）
						const defaultPreset = (typeof ctx.get === "function" ? ctx.get("agentPresets") : ctx.agentPresets)?.defaultId || "ptc";
						const activePreset = body?.preset || defaultPreset;
						const sectionRows = [];
						// 卡片同样只看真实注册在 systemPrompt 层里的段落：未启用插件不会注册，
						// 所以不会出现在卡片里；启用插件后注册恢复，下次刷新自动出现。
						const routeLive = await collectLiveSections(ctx, activePreset);
						const sourceSections = routeLive
							? Array.from(routeLive.values()).map((section) => [section.name, section])
							: Array.from(SEEN_SECTIONS.entries()).filter(
									([key]) => activePreset === "all" || isSectionInPreset(key, activePreset),
								);
						// 工具说明由 tool-control 负责，卡片里不展示（只报个数）。
						let toolOwnedCount = 0;

						for (const [key, section] of sourceSections) {
							if (isToolOwnedSection(key)) {
								toolOwnedCount += 1;
								continue;
							}

							const item = SEEN_SECTIONS.get(key) || {
								name: key,
								defaultText: section.text || KNOWN_SECTIONS[key]?.defaultText || "",
								order: section.order ?? (KNOWN_SECTIONS[key]?.defaultOrder ?? 0),
								presets: section.presets || new Set(["all"]),
							};
							const meta = classifySection(key);
							const presetRule =
								activePreset !== "all"
									? config.presetOverrides?.[activePreset]?.[key]
									: undefined;
							const isPresetOverride = Boolean(presetRule);
							const globalRule = config.overrides?.[key];
							const isInheritedFromGlobal = activePreset !== "all" && !isPresetOverride && Boolean(globalRule);
							const effectiveRule = presetRule ?? globalRule;

							const isEnabled = effectiveRule?.enabled ?? true;
							const hasTextOverride = Boolean(effectiveRule) && typeof effectiveRule.text === "string";

							const defaultText = section.text ?? item.defaultText ?? KNOWN_SECTIONS[key]?.defaultText ?? "";
							const currentText = hasTextOverride ? effectiveRule.text : defaultText;

							const secPresets = section.presets
								? Array.from(section.presets)
								: item.presets
									? Array.from(item.presets)
									: ["all"];
							if (activePreset !== "all" && !secPresets.includes(activePreset)) {
								secPresets.push(activePreset);
							}

							sectionRows.push({
								key,
								name: meta.name || key,
								source: meta.source,
								category: meta.category,
								categoryLabel: meta.categoryLabel,
								description: meta.description,
								defaultText,
								currentText,
								enabled: isEnabled,
								overridden: Boolean(hasTextOverride),
								inPreset: true,
								isPresetOverride,
								isInheritedFromGlobal,
								charCount: currentText ? currentText.length : (defaultText ? defaultText.length : 0),
								tokenEstimate: estimateTokens(currentText || defaultText),
								presets: secPresets,
								order: section.order ?? item.order ?? (meta.defaultOrder ?? 0),
							});
						}

						// 严格按真实装配执行顺序排序：order 升序，key 字典序升序
						sectionRows.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.key.localeCompare(b.key));

						// 因所属插件未启用而隐藏的已知段落数：只报个数，不列 key，避免看起来还能编辑。
						const globalLive = activePreset === "all" ? routeLive : await collectLiveSections(ctx, "all");
						let hiddenSectionCount = 0;
						if (globalLive) {
							for (const key of Object.keys(KNOWN_SECTIONS)) {
								if (!isToolOwnedSection(key) && !globalLive.has(key)) hiddenSectionCount += 1;
							}
						}

						// 运行时上下文（systemPrompt.context）的真实注册项。
						const liveContexts = await collectLiveContexts(ctx, activePreset);
						const injectionPolicy = config.contextInjections || {};
						const disabledContexts = new Set(injectionPolicy.disabledContexts || []);
						const contextRows = [];
						if (liveContexts) {
							for (const context of liveContexts.values()) {
								const required = context.required === true;
								const enabled =
									required ||
									(!injectionPolicy.suppressOptional && !disabledContexts.has(context.name));
								contextRows.push({
									name: context.name,
									source: CONTEXT_SOURCE_LABELS[context.name] || "dsh-system-prompt",
									order: context.order ?? 0,
									required,
									enabled,
									text: context.text || "",
									tokens: estimateTokens(context.text || ""),
									presets: context.presets ? Array.from(context.presets) : [activePreset],
								});
							}
						}
						contextRows.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));

						// agent/pre-step 注入源：已知项始终展示（即使本进程还没观测到），
						// 其他观测到的 kind 追加在后面。
						const disabledKinds = new Set(injectionPolicy.disabledKinds || []);
						const injectionKinds = [
							...Object.keys(INJECTION_KIND_META),
							...INJECTION_STATS.keys(),
						].filter((kind, index, all) => all.indexOf(kind) === index && kind !== "runtime-context" && kind !== "user");
						const messageInjections = injectionKinds.map((kind) => {
							const meta = INJECTION_KIND_META[kind] || {
								label: kind,
								description: "观测到的其他 user 消息注入源。",
							};
							const stat = INJECTION_STATS.get(kind);
							return {
								kind,
								label: meta.label,
								description: meta.description,
								enabled: !disabledKinds.has(kind),
								count: stat?.count ?? 0,
								lastAt: stat?.lastAt ?? null,
								tokens: stat?.tokens ?? 0,
								sample: stat?.sample ?? "",
							};
						});

						// 版本更新后的「原文漂移」清单：卡片据此提示「保留定制 / 改用新原文」。
						const drift = [];
						const nativeMaps = new Map();
						const nativeOf = async (presetId) => {
							if (!presetId || presetId === "all") return null;
							if (!nativeMaps.has(presetId)) nativeMaps.set(presetId, await getPresetRawSections(ctx, presetId));
							return nativeMaps.get(presetId);
						};
						const inspectRule = async (presetId, key, rule) => {
							if (!rule || typeof rule.text !== "string") return;
							if (isToolOwnedSection(key)) return;
							if (globalLive && !globalLive.has(key)) return;
							const baseline = rule.baseline || {};
							const map = await nativeOf(baseline.preset && baseline.preset !== "all" ? baseline.preset : presetId);
							const current = map?.get(key)?.text;
							if (driftState(rule, current) !== "drift") return;
							drift.push({
								preset: presetId,
								key,
								baselineAt: baseline.at ?? null,
								baselineLength: typeof baseline.length === "number" ? baseline.length : null,
								currentLength: typeof current === "string" ? current.length : null,
							});
						};
						for (const [key, rule] of Object.entries(config.overrides || {})) await inspectRule("all", key, rule);
						for (const [presetId, rules] of Object.entries(config.presetOverrides || {})) {
							for (const [key, rule] of Object.entries(rules || {})) await inspectRule(presetId, key, rule);
						}

						return new Response(
							JSON.stringify({
								ok: true,
								value: {
									defaultPreset,
									presets: availablePresets,
									activePreset,
									categories: CATEGORY_DEFINITIONS,
									sections: sectionRows,
									contexts: contextRows,
									messageInjections,
									contextInjections: injectionPolicy,
									insertions: config.insertions || [],
									drift,
									toolOwnedCount,
									hiddenSectionCount,
									enabled: config.enabled,
									sectionOrder: config.sectionOrder || [],
									availableVariables: AVAILABLE_VARIABLES,
								},
							}),
							{ headers: { "content-type": "application/json" } },
						);
					},
				}),
			"prompt-control.settings-route",
		);
	});
}
