/** Maximum serialized UTF-8 bytes accepted for one complete page-read result. */
const BROWSER_PAGE_RESULT_MAX_BYTES = 96 * 1024;
/** Named keys accepted without a shortcut modifier. */
const NAMED_PRESS_KEYS = [
	"Enter",
	"Escape",
	"Tab",
	"Space",
	"ArrowUp",
	"ArrowDown",
	"ArrowLeft",
	"ArrowRight",
	"Home",
	"End",
	"PageUp",
	"PageDown",
	"Backspace",
	"Delete"
];
/** Letter keys accepted only with Control, Alt, or Meta. */
const LETTER_PRESS_KEYS = [
	"a",
	"b",
	"c",
	"d",
	"e",
	"f",
	"g",
	"h",
	"i",
	"j",
	"k",
	"l",
	"m",
	"n",
	"o",
	"p",
	"q",
	"r",
	"s",
	"t",
	"u",
	"v",
	"w",
	"x",
	"y",
	"z"
];
/** Digit keys accepted only with Control, Alt, or Meta. */
const DIGIT_PRESS_KEYS = [
	"0",
	"1",
	"2",
	"3",
	"4",
	"5",
	"6",
	"7",
	"8",
	"9"
];
/** Complete bounded keyboard allowlist. */
const PRESS_KEY_VALUES = [
	...NAMED_PRESS_KEYS,
	...LETTER_PRESS_KEYS,
	...DIGIT_PRESS_KEYS
];
const SCROLL_MOVEMENTS = new Set([
	"line-up",
	"line-down",
	"line-left",
	"line-right",
	"page-up",
	"page-down",
	"page-left",
	"page-right",
	"top",
	"bottom",
	"left-edge",
	"right-edge"
]);
const PRESS_KEYS = new Set(PRESS_KEY_VALUES);
const NAMED_PRESS_KEY_SET = new Set(NAMED_PRESS_KEYS);
const BRIDGE_ERROR_CODES = new Set([
	"BROWSER_INVALID_REQUEST",
	"BROWSER_TAB_NOT_FOUND",
	"BROWSER_PAGE_ACCESS_DENIED",
	"BROWSER_PAGE_STALE",
	"BROWSER_ELEMENT_NOT_FOUND",
	"BROWSER_ELEMENT_DISABLED",
	"BROWSER_ELEMENT_NOT_EDITABLE",
	"BROWSER_OPTION_NOT_FOUND",
	"BROWSER_SCROLL_TARGET_INVALID",
	"BROWSER_KEY_UNSUPPORTED",
	"BROWSER_WAIT_TIMEOUT",
	"BROWSER_CAPABILITY_UNAVAILABLE",
	"BROWSER_API_FAILED"
]);
/** Return whether an untrusted bridge value is a plain record. */
function isRecord$1(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** Return whether one press operation carries a page-shortcut modifier. */
function hasShortcutModifier(modifiers) {
	return modifiers.ctrl === true || modifiers.alt === true || modifiers.meta === true;
}
/**
* Return whether one key is allowed for the current modifier set.
* Named keys work alone. Letter and digit keys are page shortcuts and require Control, Alt, or Meta.
*/
function isAllowedPressKey(key, modifiers) {
	if (typeof key !== "string" || !PRESS_KEYS.has(key)) return false;
	return NAMED_PRESS_KEY_SET.has(key) || hasShortcutModifier(modifiers);
}
/** Return whether an untrusted value can identify a Chromium tab. */
function isSafeTabId(value) {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
/** Return whether an untrusted value is a current document or page identity. */
function isPageId(value) {
	return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
/** Return whether an untrusted value is one bounded page element reference. */
function isPageRef(value) {
	return typeof value === "string" && /^e[1-9]\d{0,3}$/.test(value);
}
/** Return whether an untrusted value is a finite non-negative number. */
function isNonNegativeNumber(value) {
	return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
/** Match the shared protocol envelope and an expected message direction. */
function hasEnvelope(value, direction) {
	return value.channel === "dsh-browser-extension" && value.version === 7 && value.direction === direction;
}
/** Validate a normalized tab received across the isolated-world bridge. */
function isBridgeTab(value) {
	if (!isRecord$1(value)) return false;
	return isSafeTabId(value.id) && isSafeTabId(value.windowId) && typeof value.active === "boolean" && (value.url === void 0 || typeof value.url === "string") && (value.title === void 0 || typeof value.title === "string");
}
/** Return the serialized UTF-8 size of an untrusted JSON-compatible value. */
function jsonByteLength(value) {
	try {
		return new TextEncoder().encode(JSON.stringify(value)).byteLength;
	} catch {
		return Number.POSITIVE_INFINITY;
	}
}
/** Validate one native select option. */
function isBridgePageOption(value) {
	return isRecord$1(value) && typeof value.value === "string" && value.value.length <= 1e3 && typeof value.label === "string" && value.label.length <= 160 && typeof value.selected === "boolean" && typeof value.disabled === "boolean";
}
/** Validate current viewport metrics. */
function isBridgePageViewport(value) {
	return isRecord$1(value) && isNonNegativeNumber(value.width) && isNonNegativeNumber(value.height) && isNonNegativeNumber(value.scrollX) && isNonNegativeNumber(value.scrollY) && isNonNegativeNumber(value.documentWidth) && isNonNegativeNumber(value.documentHeight);
}
/** Validate one bounded current form value. */
function isBridgePageField(value) {
	return isRecord$1(value) && isPageRef(value.ref) && typeof value.label === "string" && value.label.length <= 160 && typeof value.type === "string" && value.type.length <= 64 && typeof value.value === "string" && value.value.length <= 3e4 && (value.checked === void 0 || typeof value.checked === "boolean") && typeof value.disabled === "boolean" && typeof value.readOnly === "boolean" && typeof value.required === "boolean" && typeof value.inViewport === "boolean" && typeof value.focused === "boolean" && (value.context === void 0 || typeof value.context === "string" && value.context.length <= 200) && (value.options === void 0 || Array.isArray(value.options) && value.options.length <= 40 && value.options.every(isBridgePageOption));
}
/** Validate one optional element placement. */
function isBridgePageRect(value) {
	return isRecord$1(value) && Number.isFinite(value.x) && Number.isFinite(value.y) && isNonNegativeNumber(value.width) && isNonNegativeNumber(value.height);
}
/** Validate one bounded clickable element summary. */
function isBridgePageAction(value) {
	return isRecord$1(value) && isPageRef(value.ref) && typeof value.role === "string" && value.role.length > 0 && value.role.length <= 32 && typeof value.label === "string" && value.label.length <= 160 && (value.rect === void 0 || isBridgePageRect(value.rect)) && (value.accent === void 0 || typeof value.accent === "boolean") && typeof value.disabled === "boolean" && typeof value.inViewport === "boolean" && typeof value.focused === "boolean" && (value.context === void 0 || typeof value.context === "string" && value.context.length <= 200) && (value.href === void 0 || typeof value.href === "string" && value.href.length <= 2e3) && (value.checked === void 0 || typeof value.checked === "boolean") && (value.selected === void 0 || typeof value.selected === "boolean") && (value.expanded === void 0 || typeof value.expanded === "boolean") && (value.pressed === void 0 || typeof value.pressed === "boolean");
}
/** Validate one actually scrollable container summary. */
function isBridgePageScrollTarget(value) {
	return isRecord$1(value) && isPageRef(value.ref) && typeof value.label === "string" && value.label.length <= 160 && (value.axis === "vertical" || value.axis === "horizontal" || value.axis === "both") && isNonNegativeNumber(value.top) && isNonNegativeNumber(value.left) && isNonNegativeNumber(value.maxTop) && isNonNegativeNumber(value.maxLeft);
}
/**
* Validate content returned directly by the active-page script.
* @param value - untrusted content-script result.
* @returns whether the value is one bounded page snapshot.
*/
function isBridgePageContent(value) {
	return isRecord$1(value) && isPageId(value.pageId) && isPageId(value.documentId) && typeof value.revision === "number" && Number.isSafeInteger(value.revision) && value.revision >= 0 && isBridgePageViewport(value.viewport) && typeof value.text === "string" && value.text.length <= 3e4 && Array.isArray(value.fields) && value.fields.length <= 80 && value.fields.every(isBridgePageField) && Array.isArray(value.actions) && value.actions.length <= 120 && value.actions.every(isBridgePageAction) && Array.isArray(value.scrollTargets) && value.scrollTargets.length <= 40 && value.scrollTargets.every(isBridgePageScrollTarget) && typeof value.truncated === "boolean";
}
/** Validate one bounded network observation. */
function isBridgeNetworkEntry(value) {
	return isRecord$1(value) && typeof value.at === "number" && Number.isSafeInteger(value.at) && value.at >= 0 && (value.source === "fetch" || value.source === "xhr") && typeof value.method === "string" && value.method.length > 0 && value.method.length <= 16 && typeof value.url === "string" && value.url.length <= 500 && (value.status === void 0 || typeof value.status === "number" && Number.isSafeInteger(value.status) && value.status >= 0 && value.status <= 999) && (value.ok === void 0 || typeof value.ok === "boolean") && (value.durationMs === void 0 || typeof value.durationMs === "number" && Number.isSafeInteger(value.durationMs) && value.durationMs >= 0) && (value.error === void 0 || typeof value.error === "string" && value.error.length <= 500);
}
/** Validate one bounded console observation. */
function isBridgeConsoleEntry(value) {
	return isRecord$1(value) && typeof value.at === "number" && Number.isSafeInteger(value.at) && value.at >= 0 && (value.level === "log" || value.level === "info" || value.level === "warn" || value.level === "error" || value.level === "debug") && typeof value.text === "string" && value.text.length <= 500;
}
/**
* Validate inspect content returned directly by the active-page script.
* @param value - untrusted content-script result.
* @returns whether the value is one bounded inspect snapshot.
*/
function isBridgePageInspectContent(value) {
	return isRecord$1(value) && typeof value.hooked === "boolean" && (value.hookedAt === void 0 || typeof value.hookedAt === "number" && Number.isSafeInteger(value.hookedAt) && value.hookedAt >= 0) && Array.isArray(value.network) && value.network.length <= 40 && value.network.every(isBridgeNetworkEntry) && Array.isArray(value.console) && value.console.length <= 40 && value.console.every(isBridgeConsoleEntry) && typeof value.omittedNetwork === "number" && Number.isSafeInteger(value.omittedNetwork) && value.omittedNetwork >= 0 && typeof value.omittedConsole === "number" && Number.isSafeInteger(value.omittedConsole) && value.omittedConsole >= 0;
}
/**
* Validate one complete bounded page-inspect result.
* @param value - untrusted extension result.
* @returns whether the value is one complete bounded inspect result.
*/
function isBridgePageInspect(value) {
	return isRecord$1(value) && isBridgeTab(value.tab) && isBridgePageInspectContent(value) && jsonByteLength(value) <= 49152;
}
/**
* Validate one page action confirmation received from the content script.
* @param value - untrusted content-script result.
* @returns whether the value is one bounded action receipt.
*/
function isBridgePageActionReceipt(value) {
	return isRecord$1(value) && isPageId(value.pageId) && isPageRef(value.ref) && (value.action === "clicked" || value.action === "filled" || value.action === "selected" || value.action === "focused" || value.action === "pressed") && (value.value === void 0 || typeof value.value === "string" && value.value.length <= 1e3) && (value.key === void 0 || typeof value.key === "string" && PRESS_KEYS.has(value.key));
}
/**
* Validate one scroll confirmation received from the content script.
* @param value - untrusted content-script result.
* @returns whether the value is one bounded scroll receipt.
*/
function isBridgeScrollReceipt(value) {
	return isRecord$1(value) && isPageId(value.pageId) && (value.ref === void 0 || isPageRef(value.ref)) && typeof value.movement === "string" && SCROLL_MOVEMENTS.has(value.movement) && isNonNegativeNumber(value.top) && isNonNegativeNumber(value.left) && isNonNegativeNumber(value.maxTop) && isNonNegativeNumber(value.maxLeft) && typeof value.moved === "boolean" && typeof value.atBoundary === "boolean";
}
/**
* Validate one complete bounded current-page result.
* @param value - untrusted extension result.
* @returns whether the value is one complete bounded current-page result.
*/
function isBridgePage(value) {
	return isRecord$1(value) && isBridgeTab(value.tab) && isBridgePageContent(value) && jsonByteLength(value) <= 98304;
}
/** Validate one wait condition received across the bridge. */
function isBridgeWaitCondition(value) {
	if (!isRecord$1(value)) return false;
	if (value.kind === "change") return isPageId(value.documentId) && typeof value.afterRevision === "number" && Number.isSafeInteger(value.afterRevision) && value.afterRevision >= 0;
	if (value.kind === "text") return typeof value.text === "string" && value.text.length > 0 && value.text.length <= 1e3 && (value.state === "present" || value.state === "absent");
	if (value.kind === "url") return typeof value.value === "string" && value.value.length > 0 && value.value.length <= 2e3 && (value.match === "exact" || value.match === "prefix" || value.match === "contains");
	return value.kind === "ready";
}
/**
* Validate one browser operation received from an isolated-world message.
* @param value - untrusted message field.
* @returns whether the field is a supported operation.
*/
function isBridgeOperation(value) {
	if (!isRecord$1(value)) return false;
	switch (value.kind) {
		case "open-tab": return typeof value.url === "string" && typeof value.active === "boolean";
		case "list-tabs": return true;
		case "read-page": return value.tabId === void 0 || isSafeTabId(value.tabId);
		case "inspect-page": return (value.tabId === void 0 || isSafeTabId(value.tabId)) && (value.mode === "start" || value.mode === "snapshot" || value.mode === "stop");
		case "click-page-element":
		case "focus-page-element": return isPageId(value.pageId) && isPageRef(value.ref);
		case "fill-page-element": return isPageId(value.pageId) && isPageRef(value.ref) && typeof value.value === "string" && value.value.length <= 1e4 && typeof value.submit === "boolean";
		case "select-page-option": return isPageId(value.pageId) && isPageRef(value.ref) && typeof value.value === "string" && value.value.length <= 1e3;
		case "scroll-page": return isPageId(value.pageId) && (value.ref === void 0 || isPageRef(value.ref)) && typeof value.movement === "string" && SCROLL_MOVEMENTS.has(value.movement);
		case "press-page-key": return isPageId(value.pageId) && isPageRef(value.ref) && isRecord$1(value.modifiers) && (value.modifiers.ctrl === void 0 || typeof value.modifiers.ctrl === "boolean") && (value.modifiers.alt === void 0 || typeof value.modifiers.alt === "boolean") && (value.modifiers.shift === void 0 || typeof value.modifiers.shift === "boolean") && (value.modifiers.meta === void 0 || typeof value.modifiers.meta === "boolean") && isAllowedPressKey(value.key, {
			ctrl: value.modifiers.ctrl === true,
			alt: value.modifiers.alt === true,
			meta: value.modifiers.meta === true
		}) && typeof value.repeat === "number" && Number.isSafeInteger(value.repeat) && value.repeat >= 1 && value.repeat <= 20;
		case "wait-page": return (isPageId(value.pageId) || isSafeTabId(value.tabId)) && (value.pageId === void 0 || isPageId(value.pageId)) && (value.tabId === void 0 || isSafeTabId(value.tabId)) && isBridgeWaitCondition(value.condition) && typeof value.timeoutMs === "number" && Number.isSafeInteger(value.timeoutMs) && value.timeoutMs >= 100 && value.timeoutMs <= 3e4 && typeof value.stableMs === "number" && Number.isSafeInteger(value.stableMs) && value.stableMs >= 0 && value.stableMs <= 2e3;
		case "activate-tab":
		case "close-tab": return isSafeTabId(value.tabId);
		default: return false;
	}
}
/**
* Validate an extension failure exposed to the Web Client.
* @param value - untrusted Service Worker failure.
* @returns whether the failure has one supported stable code.
*/
function isBridgeError(value) {
	if (!isRecord$1(value) || typeof value.message !== "string") return false;
	return typeof value.code === "string" && BRIDGE_ERROR_CODES.has(value.code);
}
/**
* Validate a Web Client operation request.
* @param value - untrusted page-bridge message.
* @returns whether the value is a supported operation request.
*/
function isBridgeRequest(value) {
	return isRecord$1(value) && hasEnvelope(value, "request") && typeof value.requestId === "string" && value.requestId.length > 0 && isBridgeOperation(value.operation);
}
//#endregion
//#region lib/types/extension/companion-protocol.js
/** Closed messages shared by the MV3 side panel and Windows companion adapter. */
/** Registered Chrome Native Messaging host name. */
const BROWSER_COMPANION_HOST_NAME = "com.deepseek.dsh_browser_companion";
/** Narrow an unknown value to a plain record. */
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** Require an exact closed field set at the extension/native process boundary. */
function hasExactKeys(value, keys) {
	const actual = Object.keys(value).sort();
	const expected = [...keys].sort();
	return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
/**
* Validate a side-panel startup request before sender authorization.
* @param value - untrusted Chromium runtime message.
* @returns whether the value carries the exact startup request fields.
*/
function isEnsureLocalHarnessRequest(value) {
	return isRecord(value) && hasExactKeys(value, ["kind", "origin"]) && value.kind === "ensure-local-harness" && typeof value.origin === "string";
}
/**
* Validate one Native Messaging response.
* @param value - untrusted JSON returned by the registered native host.
* @param expectedOrigin - origin requested by the side panel.
* @returns normalized closed response.
* @throws when the native host returns malformed or mismatched data.
*/
function parseEnsureWebResponse(value, expectedOrigin) {
	if (!isRecord(value) || typeof value.ok !== "boolean") throw new Error("本机伴随程序返回了无效响应。");
	if (value.ok) {
		if (!hasExactKeys(value, [
			"ok",
			"state",
			"origin"
		]) || value.state !== "running" && value.state !== "started" || value.origin !== expectedOrigin) throw new Error("本机伴随程序返回了不匹配的启动结果。");
		return {
			ok: true,
			state: value.state,
			origin: value.origin
		};
	}
	if (!hasExactKeys(value, ["ok", "error"]) || typeof value.error !== "string" || value.error === "") throw new Error("本机伴随程序返回了无效错误。");
	return {
		ok: false,
		error: value.error
	};
}
//#endregion
//#region lib/types/extension/local-origin.js
/** Loopback Harness origin validation shared by side-panel and Service Worker boundaries. */
/**
* Validate one user- or message-supplied Harness origin.
* @param rawOrigin - candidate loopback HTTP origin.
* @returns canonical origin without a trailing slash.
*/
function normalizeHarnessOrigin(rawOrigin) {
	let url;
	try {
		url = new URL(rawOrigin.trim());
	} catch {
		throw new Error("Harness 地址必须是有效 URL");
	}
	if (url.protocol !== "http:") throw new Error("Harness 地址必须使用明文 HTTP");
	if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") throw new Error("Harness 地址主机必须是 127.0.0.1 或 localhost");
	if (url.username !== "" || url.password !== "") throw new Error("Harness 地址不得包含用户名或密码");
	if (url.pathname !== "/" || url.search !== "" || url.hash !== "") throw new Error("Harness 地址只能包含 origin");
	return url.origin;
}
//#endregion
//#region lib/types/extension/page-content-runtime.js
/** Message kind sent from the Service Worker to the page content script. */
const DSH_READ_PAGE_KIND = "dsh-read-page";
/** Message kind sent from the Service Worker for one document-bound page action. */
const DSH_ACT_PAGE_KIND = "dsh-act-page";
/** Message kind sent from the Service Worker for one in-tab wait. */
const DSH_WAIT_PAGE_KIND = "dsh-wait-page";
/** Message kind sent from the Service Worker for one Network/Console inspect. */
const DSH_INSPECT_PAGE_KIND = "dsh-inspect-page";
//#endregion
//#region lib/types/extension/runtime.js
/** Chromium API adapter for validated browser-extension bridge operations. */
/** Error produced by extension-side validation of an untrusted page request. */
var InvalidBridgeRequestError = class extends Error {};
/** Error produced when Chromium has not granted page-script access to the active tab. */
var PageAccessDeniedError = class extends Error {};
/** Error already classified by the in-page actor. */
var ClassifiedBridgeError = class extends Error {
	/** Stable error code preserved for the Web Client. */
	code;
	/** Create one classified bridge failure. */
	constructor(code, message) {
		super(message);
		this.code = code;
	}
};
/** Map extension validation and Chromium failures to stable bridge errors. */
function bridgeError(error) {
	const message = error instanceof Error ? error.message : String(error);
	let code = "BROWSER_API_FAILED";
	if (error instanceof ClassifiedBridgeError) code = error.code;
	else if (error instanceof InvalidBridgeRequestError) code = "BROWSER_INVALID_REQUEST";
	else if (error instanceof PageAccessDeniedError) code = "BROWSER_PAGE_ACCESS_DENIED";
	else if (/No tab with id/i.test(message)) code = "BROWSER_TAB_NOT_FOUND";
	return {
		code,
		message
	};
}
/** Convert a Chromium tab to the JSON representation used across the bridge. */
function normalizeTab(tab) {
	if (tab.id === void 0 || !Number.isSafeInteger(tab.id) || tab.id < 0 || !Number.isSafeInteger(tab.windowId) || tab.windowId < 0) throw new Error("browser extension: browser returned a tab without valid ids");
	const url = tab.pendingUrl ?? tab.url;
	return {
		id: tab.id,
		windowId: tab.windowId,
		active: tab.active,
		...url === void 0 ? {} : { url },
		...tab.title === void 0 ? {} : { title: tab.title }
	};
}
/** Validate and normalize a page-supplied absolute HTTP(S) URL. */
function resolveHttpUrl(rawUrl) {
	let url;
	try {
		url = new URL(rawUrl);
	} catch {
		throw new InvalidBridgeRequestError("browser extension: URL must be absolute");
	}
	if (url.protocol !== "http:" && url.protocol !== "https:" || url.username !== "" || url.password !== "") throw new InvalidBridgeRequestError("browser extension: only credential-free HTTP(S) URLs are allowed");
	return url.href;
}
/** Return the serialized UTF-8 byte count of one complete page result. */
function pageByteLength(page) {
	return new TextEncoder().encode(JSON.stringify(page)).byteLength;
}
/** Return the longest Unicode-safe prefix that keeps the complete page within its byte limit. */
function fitPageText(page, text) {
	const characters = Array.from(text);
	let low = 0;
	let high = characters.length;
	while (low < high) {
		const middle = Math.ceil((low + high) / 2);
		page.text = characters.slice(0, middle).join("");
		if (pageByteLength(page) <= 98304) low = middle;
		else high = middle - 1;
	}
	return characters.slice(0, low).join("");
}
/** Add active-tab metadata and enforce the complete serialized page-result limit. */
function boundedPage(tab, content) {
	const page = {
		tab,
		pageId: content.pageId,
		documentId: content.documentId,
		revision: content.revision,
		viewport: content.viewport,
		text: "",
		fields: [...content.fields],
		actions: [...content.actions],
		scrollTargets: [...content.scrollTargets],
		truncated: content.truncated
	};
	const textReserveBytes = Math.min(48 * 1024, BROWSER_PAGE_RESULT_MAX_BYTES);
	while ((page.fields.length > 0 || page.actions.length > 0 || page.scrollTargets.length > 0) && pageByteLength(page) > 98304 - textReserveBytes) {
		if (page.scrollTargets.length > 0) page.scrollTargets.pop();
		else if (page.actions.length > page.fields.length) page.actions.pop();
		else page.fields.pop();
		page.truncated = true;
	}
	if (pageByteLength(page) > 98304) throw new Error("browser extension: active-tab metadata exceeds the page result limit");
	page.text = content.text;
	if (pageByteLength(page) > 98304) {
		page.text = fitPageText(page, content.text);
		page.truncated = true;
	}
	if (!isBridgePage(page)) throw new Error("browser extension: page script returned an invalid result");
	return page;
}
/** Return the serialized UTF-8 byte count of one complete inspect result. */
function inspectByteLength(inspect) {
	return new TextEncoder().encode(JSON.stringify(inspect)).byteLength;
}
/** Trim inspect buffers until the complete result fits the inspect byte budget. */
function boundedInspect(tab, content) {
	const inspect = {
		tab,
		hooked: content.hooked,
		...content.hookedAt === void 0 ? {} : { hookedAt: content.hookedAt },
		network: [...content.network],
		console: [...content.console],
		omittedNetwork: content.omittedNetwork,
		omittedConsole: content.omittedConsole
	};
	while ((inspect.network.length > 0 || inspect.console.length > 0) && inspectByteLength(inspect) > 49152) if (inspect.network.length > 0) {
		inspect.network.shift();
		inspect.omittedNetwork += 1;
	} else {
		inspect.console.shift();
		inspect.omittedConsole += 1;
	}
	if (!isBridgePageInspect(inspect)) throw new Error("browser extension: inspect result exceeds the inspect result limit");
	return inspect;
}
/** Return whether Chromium's script failure reports missing authority for the target page. */
function isPageAccessFailure(error) {
	const message = error instanceof Error ? error.message : String(error);
	return /cannot access|cannot be scripted|extensions gallery|missing host permission|permission to access|did not return before timeout/i.test(message);
}
/** Return whether the tab has no page-reader content script listening yet. */
function isMissingPageReader(error) {
	const message = error instanceof Error ? error.message : String(error);
	return /receiving end does not exist|could not establish connection/i.test(message);
}
/** Return whether the in-tab reader answered with extracted page content. */
function isPageReaderSuccess(value) {
	return typeof value === "object" && value !== null && "ok" in value && value.ok === true && "content" in value;
}
/** Return whether the in-tab reader answered with a concrete failure. */
function isPageReaderFailure(value) {
	return typeof value === "object" && value !== null && "ok" in value && value.ok === false && "error" in value && isBridgeError(value.error);
}
/** Return whether the in-tab actor answered with a valid action or scroll confirmation. */
function isPageActorSuccess(value) {
	return typeof value === "object" && value !== null && "ok" in value && value.ok === true && "receipt" in value && (isBridgePageActionReceipt(value.receipt) || isBridgeScrollReceipt(value.receipt));
}
/**
* Bound one Chromium API promise so a stuck page script cannot outlive the Host request timeout.
* @param promise - the Chromium operation.
* @param timeoutMs - maximum wait.
* @param message - error raised when the timer fires first.
*/
function withTimeout(promise, timeoutMs, message) {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			reject(new Error(message));
		}, timeoutMs);
		promise.then((value) => {
			clearTimeout(timer);
			resolve(value);
		}, (error) => {
			clearTimeout(timer);
			reject(error instanceof Error ? error : new Error(String(error)));
		});
	});
}
/** Maximum time to wait for one in-tab read before failing the bridge call. */
const PAGE_READ_TIMEOUT_MS = 5e3;
/** Maximum time to wait for on-demand injection of the page reader. */
const PAGE_INJECT_TIMEOUT_MS = 5e3;
/** Reader bundle injected into tabs that loaded before this extension generation. */
const PAGE_READER_FILE = "page-content.js";
/** Dormant MAIN-world probe controller injected only for inspect operations. */
const PAGE_PROBE_FILE = "page-probe.js";
/** Tab shown in the side-panel header; read-page prefers this over the Service Worker's window guess. */
let focusedTabId;
/** Recent page snapshots mapped back to the tab that produced their document-bound refs. */
const pageTabIds = /* @__PURE__ */ new Map();
/** Bound retained snapshot routing state so long-lived Service Workers do not grow without limit. */
const PAGE_TAB_ID_MAX = 256;
/** Remember which tab owns one newly returned page snapshot. */
function rememberPageTab(pageId, tabId) {
	pageTabIds.delete(pageId);
	pageTabIds.set(pageId, tabId);
	while (pageTabIds.size > PAGE_TAB_ID_MAX) {
		const oldest = pageTabIds.keys().next().value;
		if (oldest === void 0) return;
		pageTabIds.delete(oldest);
	}
}
/**
* Remember the tab currently displayed in the side-panel chrome.
* @param tabId - browser-assigned tab identity, or undefined to clear.
*/
function rememberFocusedTab(tabId) {
	focusedTabId = tabId;
}
/** Return whether a side-panel message is selecting the tab that page reads should target. */
function isFocusTabRequest(message) {
	return typeof message === "object" && message !== null && "kind" in message && message.kind === "focus-tab" && "tabId" in message && typeof message.tabId === "number" && Number.isSafeInteger(message.tabId) && message.tabId >= 0;
}
/** Resolve the tab the user is looking at, matching the side-panel header when possible. */
async function resolveReadTab(tabs, tabId) {
	if (tabId !== void 0) return await tabs.get(tabId);
	if (focusedTabId !== void 0) try {
		return await tabs.get(focusedTabId);
	} catch {
		focusedTabId = void 0;
	}
	const activeTab = (await tabs.query({
		active: true,
		lastFocusedWindow: true
	}))[0];
	if (activeTab === void 0) throw new Error("No tab with id: active tab was not found");
	return activeTab;
}
/** Ask the in-tab reader for one bounded DOM snapshot or action result. */
function askPageScript(tabs, tabId, message, timeoutMs = PAGE_READ_TIMEOUT_MS) {
	return withTimeout(tabs.sendMessage(tabId, message), timeoutMs, "browser extension: page reader did not answer before timeout");
}
/** Inject the current page-content generation into one existing tab. */
function injectPageReader(scripting, tabId) {
	return withTimeout(scripting.executeScript({
		target: { tabId },
		files: [PAGE_READER_FILE]
	}), PAGE_INJECT_TIMEOUT_MS, "browser extension: page reader injection did not return before timeout");
}
/** Inject the idempotent MAIN-world probe controller for one inspect operation. */
async function injectPageProbe(scripting, tabId) {
	try {
		await withTimeout(scripting.executeScript({
			target: { tabId },
			files: [PAGE_PROBE_FILE],
			world: "MAIN"
		}), PAGE_INJECT_TIMEOUT_MS, "browser extension: page probe injection did not return before timeout");
	} catch {}
}
/** Return whether one page-script answer is a current read response or classified failure. */
function isCurrentReadResponse(value) {
	return isPageReaderFailure(value) || isPageReaderSuccess(value) && isBridgePageContent(value.content);
}
/** Return whether one page-script answer is a current action response or classified failure. */
function isCurrentActionResponse(value) {
	return isPageReaderFailure(value) || isPageActorSuccess(value);
}
/** Return whether one page-script answer is a current inspect response or classified failure. */
function isCurrentInspectResponse(value) {
	return isPageReaderFailure(value) || isPageReaderSuccess(value) && isBridgePageInspectContent(value.content);
}
/**
* Read one tab, injecting the reader when the tab predates this extension generation.
* Manifest content scripts only enter tabs opened afterwards, so tabs the user already
* had open would otherwise require a manual refresh before any read could succeed.
* @param tabs - tabs API implementation.
* @param scripting - scripting API used for the one-shot reader injection.
* @param tabId - tab resolved from the side-panel header.
* @param message - read or action request sent to the page content script.
* @param accepts - validator for the expected current protocol response.
* @returns the reader's raw answer.
*/
async function requestPageScript(tabs, scripting, tabId, message, accepts, timeoutMs = PAGE_READ_TIMEOUT_MS) {
	let response;
	try {
		response = await askPageScript(tabs, tabId, message, timeoutMs);
	} catch (error) {
		if (!isMissingPageReader(error)) throw error;
		await injectPageReader(scripting, tabId);
		return await askPageScript(tabs, tabId, message, timeoutMs);
	}
	if (accepts(response)) return response;
	await injectPageReader(scripting, tabId);
	return await askPageScript(tabs, tabId, message, timeoutMs);
}
/** Read one resolved tab through its page content script. */
async function readTabPage(tabs, scripting, tab) {
	const normalized = normalizeTab(tab);
	let response;
	try {
		response = await requestPageScript(tabs, scripting, normalized.id, { kind: DSH_READ_PAGE_KIND }, isCurrentReadResponse);
	} catch (error) {
		if (!isPageAccessFailure(error) && !isMissingPageReader(error)) throw error;
		throw new PageAccessDeniedError("browser extension: this page cannot be read by extensions; open a normal http(s) page, then retry");
	}
	if (isPageReaderFailure(response)) throw new ClassifiedBridgeError(response.error.code, response.error.message);
	if (!isPageReaderSuccess(response) || !isBridgePageContent(response.content)) throw new Error("browser extension: page script returned an invalid result");
	const page = boundedPage(normalized, response.content);
	rememberPageTab(page.pageId, normalized.id);
	return page;
}
/** Read the requested tab, or the tab shown in the side panel. */
async function readActivePage(tabs, scripting, tabId) {
	return readTabPage(tabs, scripting, await resolveReadTab(tabs, tabId));
}
/** Inspect Network/Console observations from one resolved tab. */
async function inspectTabPage(tabs, scripting, tab, mode) {
	const normalized = normalizeTab(tab);
	await injectPageProbe(scripting, normalized.id);
	let response;
	try {
		response = await requestPageScript(tabs, scripting, normalized.id, {
			kind: DSH_INSPECT_PAGE_KIND,
			mode
		}, isCurrentInspectResponse);
	} catch (error) {
		if (!isPageAccessFailure(error) && !isMissingPageReader(error)) throw error;
		throw new PageAccessDeniedError("browser extension: this page cannot be inspected by extensions; open a normal http(s) page, then retry");
	}
	if (isPageReaderFailure(response)) throw new ClassifiedBridgeError(response.error.code, response.error.message);
	if (!isPageReaderSuccess(response) || !isBridgePageInspectContent(response.content)) throw new Error("browser extension: page script returned an invalid inspect result");
	return boundedInspect(normalized, response.content);
}
/** Inspect the requested tab, or the tab shown in the side panel. */
async function inspectActivePage(tabs, scripting, tabId, mode) {
	return inspectTabPage(tabs, scripting, await resolveReadTab(tabs, tabId), mode);
}
/** Execute one document-bound action in the tab shown by the side panel. */
async function actOnActivePage(tabs, scripting, operation) {
	const tab = normalizeTab(await resolveReadTab(tabs, pageTabIds.get(operation.pageId)));
	let response;
	try {
		response = await requestPageScript(tabs, scripting, tab.id, {
			kind: DSH_ACT_PAGE_KIND,
			operation
		}, isCurrentActionResponse);
	} catch (error) {
		if (!isPageAccessFailure(error) && !isMissingPageReader(error)) throw error;
		throw new PageAccessDeniedError("browser extension: this page cannot be operated by extensions; open a normal http(s) page, then retry");
	}
	if (isPageReaderFailure(response)) throw new ClassifiedBridgeError(response.error.code, response.error.message);
	if (!isPageActorSuccess(response)) throw new Error("browser extension: page script returned an invalid action result");
	rememberPageTab(operation.pageId, tab.id);
	return response.receipt;
}
/** Wait for one page condition, re-injecting after navigation destroys the page script. */
async function waitForTabPage(tabs, scripting, tabId, operation) {
	const deadline = Date.now() + operation.timeoutMs;
	let lastError;
	while (Date.now() <= deadline) {
		const remaining = Math.max(100, deadline - Date.now());
		const waitOperation = {
			...operation,
			timeoutMs: remaining
		};
		try {
			const tab = await tabs.get(tabId);
			const response = await requestPageScript(tabs, scripting, tabId, {
				kind: DSH_WAIT_PAGE_KIND,
				operation: waitOperation
			}, isCurrentReadResponse, remaining + 500);
			if (isPageReaderFailure(response)) throw new ClassifiedBridgeError(response.error.code, response.error.message);
			if (!isPageReaderSuccess(response) || !isBridgePageContent(response.content)) throw new Error("browser extension: page script returned an invalid result");
			const page = boundedPage(normalizeTab(tab), response.content);
			rememberPageTab(page.pageId, tabId);
			return page;
		} catch (error) {
			lastError = error;
			if (error instanceof ClassifiedBridgeError && error.code === "BROWSER_WAIT_TIMEOUT") throw error;
			if (!isMissingPageReader(error) && !isPageAccessFailure(error)) throw error;
			try {
				await injectPageReader(scripting, tabId);
			} catch (injectError) {
				lastError = injectError;
			}
			await new Promise((resolve) => {
				setTimeout(resolve, 50);
			});
		}
	}
	if (lastError instanceof ClassifiedBridgeError) throw lastError;
	throw new ClassifiedBridgeError("BROWSER_WAIT_TIMEOUT", lastError instanceof Error ? lastError.message : "browser extension: wait timed out");
}
/**
* Execute one validated operation against Chromium's tabs API.
* @param tabs - tabs API implementation.
* @param scripting - scripting API used for on-demand page content injection.
* @param operation - validated operation from the DSH Web Client.
* @returns normalized JSON result.
*/
async function executeBridgeOperation(tabs, scripting, operation) {
	switch (operation.kind) {
		case "open-tab": return {
			kind: "open-tab",
			tab: normalizeTab(await tabs.create({
				url: resolveHttpUrl(operation.url),
				active: operation.active
			}))
		};
		case "list-tabs": {
			const tabsInWindow = await tabs.query({ lastFocusedWindow: true });
			const normalized = [];
			for (const tab of tabsInWindow) try {
				normalized.push(normalizeTab(tab));
			} catch {}
			return {
				kind: "list-tabs",
				tabs: normalized
			};
		}
		case "read-page": return {
			kind: "read-page",
			page: await readActivePage(tabs, scripting, operation.tabId)
		};
		case "inspect-page": return {
			kind: "inspect-page",
			inspect: await inspectActivePage(tabs, scripting, operation.tabId, operation.mode)
		};
		case "click-page-element":
		case "fill-page-element":
		case "select-page-option":
		case "focus-page-element":
		case "press-page-key": {
			const receipt = await actOnActivePage(tabs, scripting, operation);
			if (!isBridgePageActionReceipt(receipt)) throw new Error("browser extension: page script returned an invalid action result");
			return {
				kind: operation.kind,
				receipt
			};
		}
		case "scroll-page": {
			const receipt = await actOnActivePage(tabs, scripting, operation);
			if (!isBridgeScrollReceipt(receipt)) throw new Error("browser extension: page script returned an invalid scroll result");
			return {
				kind: "scroll-page",
				receipt
			};
		}
		case "wait-page": {
			const mappedTabId = operation.pageId === void 0 ? void 0 : pageTabIds.get(operation.pageId);
			if (mappedTabId !== void 0 && operation.tabId !== void 0 && mappedTabId !== operation.tabId) throw new ClassifiedBridgeError("BROWSER_PAGE_STALE", "browser extension: page snapshot belongs to another tab; read the page again");
			return {
				kind: "wait-page",
				page: await waitForTabPage(tabs, scripting, normalizeTab(await resolveReadTab(tabs, mappedTabId ?? operation.tabId)).id, {
					condition: operation.condition,
					timeoutMs: operation.timeoutMs,
					stableMs: operation.stableMs
				})
			};
		}
		case "activate-tab": {
			const tab = await tabs.update(operation.tabId, { active: true });
			if (tab === void 0) throw new Error("browser extension: browser did not return the activated tab");
			return {
				kind: "activate-tab",
				tab: normalizeTab(tab)
			};
		}
		case "close-tab":
			await tabs.remove(operation.tabId);
			return {
				kind: "close-tab",
				tabId: operation.tabId,
				closed: true
			};
	}
}
/** Restrict background requests to content scripts injected into loopback pages. */
function isLoopbackSender(sender) {
	const rawUrl = sender.url ?? sender.tab?.url ?? sender.origin;
	if (rawUrl === void 0) return false;
	try {
		const url = new URL(rawUrl);
		return url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
	} catch {
		return false;
	}
}
/** Restrict native process startup to this extension's own side-panel document. */
function isSidePanelSender(runtime, sender) {
	return sender.id === runtime.id && sender.url === runtime.getURL("sidepanel.html");
}
/** Convert Chrome Native Messaging failures to a concrete side-panel diagnostic. */
function nativeMessagingFailure(error) {
	const message = error instanceof Error ? error.message : String(error);
	if (/not found|not registered|specified native messaging host/i.test(message)) return {
		ok: false,
		error: "本机伴随程序尚未安装或注册，请在项目根目录运行浏览器伴随程序安装命令。"
	};
	return {
		ok: false,
		error: `本机伴随程序启动失败：${message}`
	};
}
/** Validate and forward one authorized side-panel startup request. */
async function ensureLocalHarness(runtime, rawOrigin) {
	let origin;
	try {
		origin = normalizeHarnessOrigin(rawOrigin);
	} catch (error) {
		return {
			ok: false,
			error: error instanceof Error ? error.message : String(error)
		};
	}
	try {
		const request = {
			kind: "ensure-web",
			origin
		};
		return parseEnsureWebResponse(await runtime.sendNativeMessage(BROWSER_COMPANION_HOST_NAME, request), origin);
	} catch (error) {
		return nativeMessagingFailure(error);
	}
}
/**
* Install the MV3 background message listener.
* @param runtime - Chromium runtime API.
* @param tabs - Chromium tabs API.
* @param scripting - scripting API used for on-demand page content injection.
* @param sidePanel - side-panel API used to bind the extension action.
* @returns listener disposer for tests and explicit teardown.
*/
function installBackground(runtime, tabs, scripting, sidePanel) {
	sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((error) => {
		console.error("browser extension: failed to enable action-click side panel", error);
	});
	/** Validate and asynchronously answer one Chromium runtime message. */
	const listener = (message, sender, sendResponse) => {
		if (isFocusTabRequest(message)) {
			if (!isSidePanelSender(runtime, sender)) return false;
			rememberFocusedTab(message.tabId);
			sendResponse({ ok: true });
			return false;
		}
		if (isEnsureLocalHarnessRequest(message)) {
			if (!isSidePanelSender(runtime, sender)) return false;
			ensureLocalHarness(runtime, message.origin).then((response) => {
				sendResponse(response);
			});
			return true;
		}
		if (!isBridgeRequest(message) || sender.id !== runtime.id) return false;
		if (!isLoopbackSender(sender) && !isSidePanelSender(runtime, sender)) return false;
		executeBridgeOperation(tabs, scripting, message.operation).then((value) => {
			sendResponse({
				ok: true,
				value
			});
		}, (error) => {
			sendResponse({
				ok: false,
				error: bridgeError(error)
			});
		});
		return true;
	};
	runtime.onMessage.addListener(listener);
	return () => {
		runtime.onMessage.removeListener(listener);
	};
}
//#endregion
//#region lib/types/extension/background.js
/** MV3 Service Worker entry for DSH browser tab operations. */
installBackground(chrome.runtime, chrome.tabs, chrome.scripting, chrome.sidePanel);
//#endregion
