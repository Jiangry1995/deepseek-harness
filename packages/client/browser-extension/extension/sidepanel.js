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
//#region lib/types/protocol.js
/** Page-to-content-script protocol owned by the browser-extension provider package. */
/** Protocol channel shared by the Web Client, content script, and Service Worker. */
const BROWSER_EXTENSION_CHANNEL = "dsh-browser-extension";
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
const PRESS_KEYS = new Set([
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
]);
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
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
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
	return value.channel === "dsh-browser-extension" && value.version === 5 && value.direction === direction;
}
/** Validate a normalized tab received across the isolated-world bridge. */
function isBridgeTab(value) {
	if (!isRecord(value)) return false;
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
	return isRecord(value) && typeof value.value === "string" && value.value.length <= 1e3 && typeof value.label === "string" && value.label.length <= 160 && typeof value.selected === "boolean" && typeof value.disabled === "boolean";
}
/** Validate current viewport metrics. */
function isBridgePageViewport(value) {
	return isRecord(value) && isNonNegativeNumber(value.width) && isNonNegativeNumber(value.height) && isNonNegativeNumber(value.scrollX) && isNonNegativeNumber(value.scrollY) && isNonNegativeNumber(value.documentWidth) && isNonNegativeNumber(value.documentHeight);
}
/** Validate one bounded current form value. */
function isBridgePageField(value) {
	return isRecord(value) && isPageRef(value.ref) && typeof value.label === "string" && value.label.length <= 160 && typeof value.type === "string" && value.type.length <= 64 && typeof value.value === "string" && value.value.length <= 3e4 && (value.checked === void 0 || typeof value.checked === "boolean") && typeof value.disabled === "boolean" && typeof value.readOnly === "boolean" && typeof value.required === "boolean" && typeof value.inViewport === "boolean" && typeof value.focused === "boolean" && (value.context === void 0 || typeof value.context === "string" && value.context.length <= 200) && (value.options === void 0 || Array.isArray(value.options) && value.options.length <= 40 && value.options.every(isBridgePageOption));
}
/** Validate one bounded clickable element summary. */
function isBridgePageAction(value) {
	return isRecord(value) && isPageRef(value.ref) && typeof value.role === "string" && value.role.length > 0 && value.role.length <= 32 && typeof value.label === "string" && value.label.length <= 160 && typeof value.disabled === "boolean" && typeof value.inViewport === "boolean" && typeof value.focused === "boolean" && (value.context === void 0 || typeof value.context === "string" && value.context.length <= 200) && (value.href === void 0 || typeof value.href === "string" && value.href.length <= 2e3) && (value.checked === void 0 || typeof value.checked === "boolean") && (value.selected === void 0 || typeof value.selected === "boolean") && (value.expanded === void 0 || typeof value.expanded === "boolean") && (value.pressed === void 0 || typeof value.pressed === "boolean");
}
/** Validate one actually scrollable container summary. */
function isBridgePageScrollTarget(value) {
	return isRecord(value) && isPageRef(value.ref) && typeof value.label === "string" && value.label.length <= 160 && (value.axis === "vertical" || value.axis === "horizontal" || value.axis === "both") && isNonNegativeNumber(value.top) && isNonNegativeNumber(value.left) && isNonNegativeNumber(value.maxTop) && isNonNegativeNumber(value.maxLeft);
}
/**
* Validate content returned directly by the active-page script.
* @param value - untrusted content-script result.
* @returns whether the value is one bounded page snapshot.
*/
function isBridgePageContent(value) {
	return isRecord(value) && isPageId(value.pageId) && isPageId(value.documentId) && typeof value.revision === "number" && Number.isSafeInteger(value.revision) && value.revision >= 0 && isBridgePageViewport(value.viewport) && typeof value.text === "string" && value.text.length <= 3e4 && Array.isArray(value.fields) && value.fields.length <= 80 && value.fields.every(isBridgePageField) && Array.isArray(value.actions) && value.actions.length <= 120 && value.actions.every(isBridgePageAction) && Array.isArray(value.scrollTargets) && value.scrollTargets.length <= 40 && value.scrollTargets.every(isBridgePageScrollTarget) && typeof value.truncated === "boolean";
}
/**
* Validate one page action confirmation received from the content script.
* @param value - untrusted content-script result.
* @returns whether the value is one bounded action receipt.
*/
function isBridgePageActionReceipt(value) {
	return isRecord(value) && isPageId(value.pageId) && isPageRef(value.ref) && (value.action === "clicked" || value.action === "filled" || value.action === "selected" || value.action === "focused" || value.action === "pressed") && (value.value === void 0 || typeof value.value === "string" && value.value.length <= 1e3) && (value.key === void 0 || typeof value.key === "string" && PRESS_KEYS.has(value.key));
}
/**
* Validate one scroll confirmation received from the content script.
* @param value - untrusted content-script result.
* @returns whether the value is one bounded scroll receipt.
*/
function isBridgeScrollReceipt(value) {
	return isRecord(value) && isPageId(value.pageId) && (value.ref === void 0 || isPageRef(value.ref)) && typeof value.movement === "string" && SCROLL_MOVEMENTS.has(value.movement) && isNonNegativeNumber(value.top) && isNonNegativeNumber(value.left) && isNonNegativeNumber(value.maxTop) && isNonNegativeNumber(value.maxLeft) && typeof value.moved === "boolean" && typeof value.atBoundary === "boolean";
}
/**
* Validate one complete bounded current-page result.
* @param value - untrusted extension result.
* @returns whether the value is one complete bounded current-page result.
*/
function isBridgePage(value) {
	return isRecord(value) && isBridgeTab(value.tab) && isBridgePageContent(value) && jsonByteLength(value) <= 98304;
}
/** Validate one wait condition received across the bridge. */
function isBridgeWaitCondition(value) {
	if (!isRecord(value)) return false;
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
	if (!isRecord(value)) return false;
	switch (value.kind) {
		case "open-tab": return typeof value.url === "string" && typeof value.active === "boolean";
		case "list-tabs": return true;
		case "read-page": return value.tabId === void 0 || isSafeTabId(value.tabId);
		case "click-page-element":
		case "focus-page-element": return isPageId(value.pageId) && isPageRef(value.ref);
		case "fill-page-element": return isPageId(value.pageId) && isPageRef(value.ref) && typeof value.value === "string" && value.value.length <= 1e4 && typeof value.submit === "boolean";
		case "select-page-option": return isPageId(value.pageId) && isPageRef(value.ref) && typeof value.value === "string" && value.value.length <= 1e3;
		case "scroll-page": return isPageId(value.pageId) && (value.ref === void 0 || isPageRef(value.ref)) && typeof value.movement === "string" && SCROLL_MOVEMENTS.has(value.movement);
		case "press-page-key": return isPageId(value.pageId) && isPageRef(value.ref) && typeof value.key === "string" && PRESS_KEYS.has(value.key) && isRecord(value.modifiers) && (value.modifiers.ctrl === void 0 || typeof value.modifiers.ctrl === "boolean") && (value.modifiers.alt === void 0 || typeof value.modifiers.alt === "boolean") && (value.modifiers.shift === void 0 || typeof value.modifiers.shift === "boolean") && (value.modifiers.meta === void 0 || typeof value.modifiers.meta === "boolean") && typeof value.repeat === "number" && Number.isSafeInteger(value.repeat) && value.repeat >= 1 && value.repeat <= 20;
		case "wait-page": return (isPageId(value.pageId) || isSafeTabId(value.tabId)) && (value.pageId === void 0 || isPageId(value.pageId)) && (value.tabId === void 0 || isSafeTabId(value.tabId)) && isBridgeWaitCondition(value.condition) && typeof value.timeoutMs === "number" && Number.isSafeInteger(value.timeoutMs) && value.timeoutMs >= 100 && value.timeoutMs <= 3e4 && typeof value.stableMs === "number" && Number.isSafeInteger(value.stableMs) && value.stableMs >= 0 && value.stableMs <= 2e3;
		case "activate-tab":
		case "close-tab": return isSafeTabId(value.tabId);
		default: return false;
	}
}
/** Validate an operation-specific result received from the Service Worker. */
function isBridgeOperationResult(value) {
	if (!isRecord(value)) return false;
	switch (value.kind) {
		case "open-tab": return isBridgeTab(value.tab);
		case "list-tabs": return Array.isArray(value.tabs) && value.tabs.every(isBridgeTab);
		case "read-page":
		case "wait-page": return isBridgePage(value.page);
		case "click-page-element":
		case "fill-page-element":
		case "select-page-option":
		case "focus-page-element":
		case "press-page-key": return isBridgePageActionReceipt(value.receipt) && value.receipt.action === receiptActionFor(value.kind);
		case "scroll-page": return isBridgeScrollReceipt(value.receipt);
		case "activate-tab": return isBridgeTab(value.tab);
		case "close-tab": return isSafeTabId(value.tabId) && value.closed === true;
		default: return false;
	}
}
/** Return the receipt action required for one page-action result kind. */
function receiptActionFor(kind) {
	if (kind === "click-page-element") return "clicked";
	if (kind === "fill-page-element") return "filled";
	if (kind === "select-page-option") return "selected";
	if (kind === "focus-page-element") return "focused";
	return "pressed";
}
/**
* Validate an extension failure exposed to the Web Client.
* @param value - untrusted Service Worker failure.
* @returns whether the failure has one supported stable code.
*/
function isBridgeError(value) {
	if (!isRecord(value) || typeof value.message !== "string") return false;
	return typeof value.code === "string" && BRIDGE_ERROR_CODES.has(value.code);
}
/**
* Validate a Web Client probe.
* @param value - untrusted page-bridge message.
* @returns whether the value is a supported probe envelope.
*/
function isBridgeProbe(value) {
	return isRecord(value) && hasEnvelope(value, "probe");
}
/**
* Validate a Web Client operation request.
* @param value - untrusted page-bridge message.
* @returns whether the value is a supported operation request.
*/
function isBridgeRequest(value) {
	return isRecord(value) && hasEnvelope(value, "request") && typeof value.requestId === "string" && value.requestId.length > 0 && isBridgeOperation(value.operation);
}
/**
* Validate a content-script operation response.
* @param value - untrusted page-bridge message.
* @returns whether the value is a supported operation response.
*/
function isBridgeResponse(value) {
	if (!isRecord(value) || !hasEnvelope(value, "response") || typeof value.requestId !== "string" || value.requestId.length === 0 || !isRecord(value.response) || typeof value.response.ok !== "boolean") return false;
	return value.response.ok ? isBridgeOperationResult(value.response.value) : isBridgeError(value.response.error);
}
//#endregion
//#region lib/types/extension/sidepanel-runtime.js
/** Browser side-panel connection controller for the loopback Harness Web UI. */
/** Default local Harness Web origin used before the user stores an override. */
const DEFAULT_HARNESS_ORIGIN = "http://127.0.0.1:3080";
/** Storage key for the user-selected local Harness origin. */
const HARNESS_ORIGIN_STORAGE_KEY = "harnessOrigin";
/**
* How often the side-panel shell pokes the Harness iframe to renew its Host lease.
* The iframe's own timers are throttled when the user focuses the page tab;
* this parent document stays runnable while the panel is open.
*/
const LEASE_WAKEUP_INTERVAL_MS = 1e4;
/** Maximum time to wait for the loopback server probe. */
const PANEL_PROBE_TIMEOUT_MS = 3e3;
/** Maximum time to wait for the embedded Web UI document. */
const PANEL_FRAME_TIMEOUT_MS = 1e4;
/**
* Return a host-permission pattern for pages that are not already covered by loopback access.
* @param rawUrl - tab URL or pending URL.
* @returns `https://host:port/*` when the user must grant access, otherwise undefined.
*/
function siteAccessOrigin(rawUrl) {
	if (rawUrl === void 0 || rawUrl === "") return void 0;
	try {
		const url = new URL(rawUrl);
		if (url.protocol !== "http:" && url.protocol !== "https:" || url.username !== "" || url.password !== "") return;
		if (url.hostname === "127.0.0.1" || url.hostname === "localhost") return void 0;
		return `${url.origin}/*`;
	} catch {
		return;
	}
}
/**
* Choose a compact label for the window's active tab.
* @param tab - Chromium tab metadata.
* @returns page title, falling back to hostname when the title is empty.
*/
function formatActiveTabTitle(tab) {
	const title = tab.title?.trim();
	if (title) return title;
	const rawUrl = tab.pendingUrl ?? tab.url;
	if (rawUrl === void 0 || rawUrl === "") return "未命名页签";
	try {
		return new URL(rawUrl).hostname || rawUrl;
	} catch {
		return rawUrl;
	}
}
/**
* Return a displayable favicon URL from Chromium tab metadata.
* @param tab - Chromium tab metadata.
* @returns an http(s) or data URL, or undefined when the value is missing or unsafe.
*/
function resolveTabFaviconUrl(tab) {
	const raw = tab.favIconUrl?.trim();
	if (raw === void 0 || raw === "") return void 0;
	try {
		const url = new URL(raw);
		if (url.protocol === "http:" || url.protocol === "https:" || url.protocol === "data:") return raw;
	} catch {
		return;
	}
}
/** Build the Web UI URL that marks this rendering as a browser side panel. */
function buildPanelUrl(origin) {
	const url = new URL("/", origin);
	url.searchParams.set("dsh-surface", "side-panel");
	return url.href;
}
/** Convert one failed connection attempt to a concise visible message. */
function connectionErrorMessage(error) {
	if (error instanceof DOMException && error.name === "AbortError") return "连接本地 Harness 超时，请确认服务已经启动。";
	if (error instanceof TypeError) return "无法连接本地 Harness，请确认服务已经启动且地址正确。";
	return error instanceof Error ? error.message : String(error);
}
/** Whether a failed probe means no HTTP server answered and permits native startup. */
function canAttemptNativeStartup(error) {
	return error instanceof TypeError || error instanceof DOMException && error.name === "AbortError";
}
/** Owns side-panel controls, loopback probing, and iframe presentation. */
var SidePanelController = class {
	elements;
	storage;
	fetcher;
	ensureHarness;
	tabs;
	permissions;
	reportFocusedTab;
	forwardBridge;
	origin = DEFAULT_HARNESS_ORIGIN;
	state = "connecting";
	stateBeforeSettings = "offline";
	probe;
	frameTimer;
	leaseWakeupTimer;
	probeGeneration = 0;
	awaitingFrame = false;
	started = false;
	disposed = false;
	activeTabId;
	/** Monotonic token preventing slower tab lookups from overwriting a newer activation. */
	activeTabGeneration = 0;
	/** Favicon URL currently requested for the visible tab strip. */
	expectedFaviconUrl;
	/** Whether the expected favicon has already loaded successfully. */
	faviconReady = false;
	accessOrigin;
	/**
	* Create a controller over the static extension page.
	* @param elements - required static document elements.
	* @param storage - extension-local settings storage.
	* @param fetcher - cross-origin fetch implementation granted by the manifest.
	* @param ensureHarness - extension request that starts the installed Windows companion.
	* @param tabs - optional tab APIs that keep the current-tab strip in sync.
	* @param permissions - optional host-permission APIs for non-loopback page reading.
	* @param reportFocusedTab - tells the Service Worker which tab the header is showing.
	* @param forwardBridge - optional runtime messaging used to relay iframe Host operations.
	*/
	constructor(elements, storage, fetcher, ensureHarness, tabs, permissions, reportFocusedTab, forwardBridge) {
		this.elements = elements;
		this.storage = storage;
		this.fetcher = fetcher;
		this.ensureHarness = ensureHarness;
		this.tabs = tabs;
		this.permissions = permissions;
		this.reportFocusedTab = reportFocusedTab;
		this.forwardBridge = forwardBridge;
	}
	/**
	* Load saved configuration, install controls, and connect to Harness.
	* @returns settlement after storage loading and the initial server probe.
	*/
	async start() {
		if (this.started) return;
		this.started = true;
		this.installControls();
		let stored;
		try {
			stored = await this.storage.get(HARNESS_ORIGIN_STORAGE_KEY);
		} catch (error) {
			this.elements.offlineDetail.textContent = `无法读取扩展设置：${connectionErrorMessage(error)}`;
			this.setState("offline");
			return;
		}
		if (this.disposed) return;
		const candidate = stored[HARNESS_ORIGIN_STORAGE_KEY];
		if (candidate !== void 0) {
			if (typeof candidate !== "string") {
				this.showSettings("已保存的 Harness 地址必须是文本。");
				return;
			}
			try {
				this.origin = normalizeHarnessOrigin(candidate);
			} catch (error) {
				this.elements.originInput.value = candidate;
				this.showSettings(connectionErrorMessage(error));
				return;
			}
		}
		this.elements.originInput.value = this.origin;
		this.watchActiveTab();
		await this.connect();
	}
	/** Remove controls and cancel in-flight work. */
	dispose() {
		if (this.disposed) return;
		this.disposed = true;
		this.probeGeneration += 1;
		this.probe?.abort();
		this.probe = void 0;
		this.clearFrameTimer();
		this.stopLeaseWakeup();
		this.removeControls();
	}
	/** Attach the static page controls owned by this controller. */
	installControls() {
		this.elements.frame.addEventListener("load", this.onFrameLoad);
		this.elements.settingsButton.addEventListener("click", this.onOpenSettings);
		this.elements.retryButton.addEventListener("click", this.onRetry);
		this.elements.cancelButton.addEventListener("click", this.onCancelSettings);
		this.elements.settingsForm.addEventListener("submit", this.onSaveSettings);
		this.elements.grantAccessButton?.addEventListener("click", this.onGrantAccess);
		this.elements.activeTabIcon?.addEventListener("load", this.onFaviconLoad);
		this.elements.activeTabIcon?.addEventListener("error", this.onFaviconError);
		window.addEventListener("message", this.onIframeMessage);
	}
	/** Detach every static page control installed by {@link installControls}. */
	removeControls() {
		this.elements.frame.removeEventListener("load", this.onFrameLoad);
		this.elements.settingsButton.removeEventListener("click", this.onOpenSettings);
		this.elements.retryButton.removeEventListener("click", this.onRetry);
		this.elements.cancelButton.removeEventListener("click", this.onCancelSettings);
		this.elements.settingsForm.removeEventListener("submit", this.onSaveSettings);
		this.elements.grantAccessButton?.removeEventListener("click", this.onGrantAccess);
		this.elements.activeTabIcon?.removeEventListener("load", this.onFaviconLoad);
		this.elements.activeTabIcon?.removeEventListener("error", this.onFaviconError);
		window.removeEventListener("message", this.onIframeMessage);
		this.tabs?.onActivated.removeListener(this.onTabActivated);
		this.tabs?.onUpdated.removeListener(this.onTabUpdated);
	}
	/** Probe the selected origin, then navigate the hidden app frame. */
	async connect(allowNativeStartup = true) {
		this.probe?.abort();
		this.clearFrameTimer();
		const generation = ++this.probeGeneration;
		const controller = new AbortController();
		this.probe = controller;
		this.awaitingFrame = false;
		this.elements.offlineDetail.textContent = "";
		this.setState("connecting");
		const timer = window.setTimeout(() => {
			controller.abort();
		}, PANEL_PROBE_TIMEOUT_MS);
		try {
			const response = await this.fetcher(`${this.origin}/`, {
				cache: "no-store",
				credentials: "omit",
				signal: controller.signal
			});
			if (this.disposed || generation !== this.probeGeneration) return;
			if (!response.ok) throw new Error(`Harness 服务返回 HTTP ${String(response.status)}`);
			this.awaitingFrame = true;
			this.elements.frame.src = buildPanelUrl(this.origin);
			this.frameTimer = window.setTimeout(this.onFrameTimeout, PANEL_FRAME_TIMEOUT_MS);
		} catch (error) {
			if (this.disposed || generation !== this.probeGeneration) return;
			if (allowNativeStartup && canAttemptNativeStartup(error)) {
				this.setState("starting");
				try {
					await this.ensureHarness(this.origin);
				} catch (startupError) {
					if (this.disposed || generation !== this.probeGeneration) return;
					this.elements.offlineDetail.textContent = `${connectionErrorMessage(error)} ${connectionErrorMessage(startupError)}`;
					this.setState("offline");
					return;
				}
				if (this.disposed || generation !== this.probeGeneration) return;
				await this.connect(false);
				return;
			}
			this.elements.offlineDetail.textContent = connectionErrorMessage(error);
			this.setState("offline");
		} finally {
			window.clearTimeout(timer);
			if (generation === this.probeGeneration) this.probe = void 0;
		}
	}
	/** Open the address editor while retaining the current presentation for cancel. */
	showSettings(error = "") {
		if (this.state === "connecting" || this.state === "starting") {
			this.probeGeneration += 1;
			this.probe?.abort();
			this.probe = void 0;
			this.clearFrameTimer();
			this.awaitingFrame = false;
			this.stateBeforeSettings = "offline";
		} else if (this.state !== "settings") this.stateBeforeSettings = this.state;
		this.elements.originInput.value ||= this.origin;
		this.elements.settingsError.textContent = error;
		this.setState("settings");
		this.elements.originInput.focus();
		this.elements.originInput.select();
	}
	/** Validate, persist, and connect to the edited address. */
	async saveSettings() {
		let origin;
		try {
			origin = normalizeHarnessOrigin(this.elements.originInput.value);
		} catch (error) {
			this.elements.settingsError.textContent = connectionErrorMessage(error);
			return;
		}
		this.elements.settingsError.textContent = "";
		try {
			await this.storage.set({ [HARNESS_ORIGIN_STORAGE_KEY]: origin });
		} catch (error) {
			this.elements.settingsError.textContent = `无法保存扩展设置：${connectionErrorMessage(error)}`;
			return;
		}
		if (this.disposed) return;
		this.origin = origin;
		this.elements.originInput.value = origin;
		await this.connect();
	}
	/** Project one controller state into the static side-panel document. */
	setState(state) {
		this.state = state;
		this.elements.root.dataset.state = state;
		this.elements.status.textContent = state === "connecting" ? "正在加载 Harness" : state === "starting" ? "正在启动本地服务" : state === "connected" ? "已连接" : state === "offline" ? "未连接" : "连接设置";
		this.elements.frame.hidden = state !== "connected";
		this.elements.loading.hidden = state !== "connecting" && state !== "starting";
		this.elements.offline.hidden = state !== "offline";
		this.elements.settings.hidden = state !== "settings";
		if (this.elements.loadingTitle !== void 0) this.elements.loadingTitle.textContent = state === "starting" ? "正在启动 Harness" : "正在连接 Harness";
		if (this.elements.loadingDetail !== void 0) this.elements.loadingDetail.textContent = state === "starting" ? "本机伴随程序正在启动托盘和 Web 服务，准备好后会自动打开。" : "侧边助手会在本地服务准备好后自动打开。";
		if (state === "connected") this.startLeaseWakeup();
		else this.stopLeaseWakeup();
	}
	/** Clear the pending embedded-document deadline when present. */
	clearFrameTimer() {
		if (this.frameTimer === void 0) return;
		window.clearTimeout(this.frameTimer);
		this.frameTimer = void 0;
	}
	/**
	* Post one protocol envelope into the embedded Harness iframe.
	* @param message - versioned side-panel or bridge envelope.
	*/
	postToIframe(message) {
		const frameWindow = this.elements.frame.contentWindow;
		if (this.state !== "connected" || frameWindow === null) return;
		frameWindow.postMessage(message, this.origin);
	}
	/**
	* Announce that this extension page can answer the current page-bridge protocol.
	* The iframe's content script may be missing; the parent document is the reliable relay.
	*/
	postReadyToIframe() {
		this.postToIframe({
			channel: BROWSER_EXTENSION_CHANNEL,
			version: 5,
			direction: "ready"
		});
	}
	/**
	* Echo one Service Worker response into the embedded Harness page.
	* @param requestId - Host request identity echoed by the iframe.
	* @param response - success or failure payload from the Service Worker.
	*/
	postBridgeResponse(requestId, response) {
		this.postToIframe({
			channel: BROWSER_EXTENSION_CHANNEL,
			version: 5,
			direction: "response",
			requestId,
			response
		});
	}
	/**
	* Relay probes and Host operations from the embedded Web UI.
	* Same-window content scripts in this iframe are not sufficient: Chromium may omit
	* tab/url on that sender, so this extension page forwards the envelope itself.
	* @param event - untrusted window message.
	*/
	onIframeMessage = (event) => {
		if (this.disposed || this.state !== "connected") return;
		if (event.source !== this.elements.frame.contentWindow) return;
		if (event.origin !== this.origin) return;
		if (isBridgeProbe(event.data)) {
			this.postReadyToIframe();
			return;
		}
		if (!isBridgeRequest(event.data) || this.forwardBridge === void 0) return;
		const request = event.data;
		this.forwardBridge(request).then((response) => {
			const candidate = {
				channel: BROWSER_EXTENSION_CHANNEL,
				version: 5,
				direction: "response",
				requestId: request.requestId,
				response
			};
			if (isBridgeResponse(candidate)) this.postBridgeResponse(request.requestId, candidate.response);
			else this.postBridgeResponse(request.requestId, {
				ok: false,
				error: {
					code: "BROWSER_INVALID_REQUEST",
					message: "browser extension: invalid Service Worker response"
				}
			});
		}, (error) => {
			this.postBridgeResponse(request.requestId, {
				ok: false,
				error: {
					code: "BROWSER_API_FAILED",
					message: error instanceof Error ? error.message : String(error)
				}
			});
		});
	};
	/**
	* Ask the embedded Harness page to renew its Host lease.
	* postMessage wakes a throttled iframe even when its own setTimeout no longer fires.
	*/
	pokeIframeLease = () => {
		this.postReadyToIframe();
		this.postToIframe({
			channel: BROWSER_EXTENSION_CHANNEL,
			version: 5,
			direction: "lease-wakeup"
		});
	};
	/** Start the parent-frame wakeup loop while the Harness UI is showing. */
	startLeaseWakeup() {
		this.stopLeaseWakeup();
		this.pokeIframeLease();
		this.leaseWakeupTimer = window.setInterval(this.pokeIframeLease, LEASE_WAKEUP_INTERVAL_MS);
	}
	/** Stop the parent-frame wakeup loop. */
	stopLeaseWakeup() {
		if (this.leaseWakeupTimer === void 0) return;
		window.clearInterval(this.leaseWakeupTimer);
		this.leaseWakeupTimer = void 0;
	}
	/** Reveal the already-probed Web UI after its document finishes loading. */
	onFrameLoad = () => {
		if (!this.awaitingFrame || this.state !== "connecting") return;
		this.awaitingFrame = false;
		this.clearFrameTimer();
		this.setState("connected");
	};
	/** Surface an embedded Web UI that never produced a load event. */
	onFrameTimeout = () => {
		this.frameTimer = void 0;
		if (!this.awaitingFrame || this.state !== "connecting") return;
		this.awaitingFrame = false;
		this.elements.offlineDetail.textContent = "Harness 页面加载超时，请检查浏览器扩展权限后重试。";
		this.setState("offline");
	};
	/** Subscribe to the current window's active tab so the plugin chrome follows tab switches. */
	watchActiveTab() {
		const tabs = this.tabs;
		const strip = this.elements.activeTab;
		const title = this.elements.activeTabTitle;
		if (tabs === void 0 || strip === void 0 || title === void 0) return;
		tabs.onActivated.addListener(this.onTabActivated);
		tabs.onUpdated.addListener(this.onTabUpdated);
		this.refreshActiveTab();
	}
	/** Query the window's active tab and project it into the plugin chrome. */
	async refreshActiveTab() {
		if (this.tabs === void 0 || this.disposed) return;
		const generation = ++this.activeTabGeneration;
		let tab;
		try {
			tab = (await this.tabs.query({
				active: true,
				currentWindow: true
			}))[0];
		} catch {
			if (generation === this.activeTabGeneration) this.hideActiveTab();
			return;
		}
		if (this.disposed || generation !== this.activeTabGeneration) return;
		await this.renderActiveTab(tab, generation);
	}
	/**
	* Load one tab after Chromium reports a new active tab id.
	* @param tabId - browser-assigned tab identity.
	*/
	async revealTabById(tabId, generation) {
		if (this.tabs === void 0 || this.disposed) return;
		let tab;
		try {
			tab = await this.tabs.get(tabId);
		} catch {
			return;
		}
		if (this.disposed || generation !== this.activeTabGeneration) return;
		await this.renderActiveTab(tab, generation);
	}
	/**
	* Render the current tab title, favicon, and whether page reading still needs a host grant.
	* @param tab - active tab metadata, if Chromium returned one.
	*/
	async renderActiveTab(tab, generation) {
		const strip = this.elements.activeTab;
		const title = this.elements.activeTabTitle;
		const grant = this.elements.grantAccessButton;
		if (strip === void 0 || title === void 0 || generation !== this.activeTabGeneration) return;
		if (tab === void 0) {
			this.hideActiveTab();
			return;
		}
		this.activeTabId = tab.id;
		this.accessOrigin = siteAccessOrigin(tab.pendingUrl ?? tab.url);
		const tabTitle = formatActiveTabTitle(tab);
		title.textContent = tabTitle;
		title.title = tabTitle;
		strip.title = tabTitle;
		this.applyFavicon(resolveTabFaviconUrl(tab));
		strip.hidden = false;
		if (tab.id !== void 0) this.reportFocusedTab?.(tab.id);
		if (grant === void 0) return;
		grant.hidden = true;
		if (this.accessOrigin === void 0 || this.permissions === void 0) return;
		let granted = false;
		try {
			granted = await this.permissions.contains({ origins: [this.accessOrigin] });
		} catch {
			granted = false;
		}
		if (this.disposed || generation !== this.activeTabGeneration || this.accessOrigin === void 0) return;
		grant.hidden = granted;
	}
	/**
	* Show the tab favicon, or the default glyph when Chromium did not supply a usable URL.
	* @param url - sanitized favicon URL, if any.
	*/
	applyFavicon(url) {
		const img = this.elements.activeTabIcon;
		this.expectedFaviconUrl = url;
		this.faviconReady = false;
		if (img === void 0) {
			this.showFaviconFallback();
			return;
		}
		if (url === void 0) {
			img.removeAttribute("src");
			this.showFaviconFallback();
			return;
		}
		if (img.getAttribute("src") === url && img.complete && img.naturalWidth > 0) {
			this.faviconReady = true;
			this.showFaviconImage();
			return;
		}
		this.showFaviconFallback();
		img.src = url;
	}
	/** Reveal the loaded favicon and hide the default glyph. */
	showFaviconImage() {
		const img = this.elements.activeTabIcon;
		const fallback = this.elements.activeTabIconFallback;
		if (img !== void 0) img.hidden = false;
		if (fallback !== void 0) fallback.hidden = true;
	}
	/** Hide the favicon image and keep the default glyph visible. */
	showFaviconFallback() {
		const img = this.elements.activeTabIcon;
		const fallback = this.elements.activeTabIconFallback;
		if (img !== void 0) img.hidden = true;
		if (fallback !== void 0) fallback.hidden = false;
	}
	/** Hide the current-tab strip when no usable tab is available. */
	hideActiveTab() {
		this.activeTabId = void 0;
		this.accessOrigin = void 0;
		this.expectedFaviconUrl = void 0;
		this.faviconReady = false;
		if (this.elements.activeTabIcon !== void 0) this.elements.activeTabIcon.removeAttribute("src");
		this.showFaviconFallback();
		if (this.elements.activeTab !== void 0) this.elements.activeTab.hidden = true;
		if (this.elements.grantAccessButton !== void 0) this.elements.grantAccessButton.hidden = true;
	}
	/** Follow Chromium's active-tab change into the plugin chrome. */
	onTabActivated = (info) => {
		const generation = ++this.activeTabGeneration;
		this.revealTabById(info.tabId, generation);
	};
	/** Refresh the strip when the already-active tab's title, URL, or favicon changes. */
	onTabUpdated = (tabId, _changeInfo, tab) => {
		if (tabId !== this.activeTabId) return;
		const generation = ++this.activeTabGeneration;
		this.renderActiveTab(tab, generation);
	};
	/** Reveal the favicon after the image has loaded for the currently expected URL. */
	onFaviconLoad = () => {
		const img = this.elements.activeTabIcon;
		if (this.disposed || img === void 0 || this.expectedFaviconUrl === void 0) return;
		if (img.getAttribute("src") !== this.expectedFaviconUrl) return;
		this.faviconReady = true;
		this.showFaviconImage();
	};
	/** Keep the default glyph when the current favicon URL fails to load. */
	onFaviconError = () => {
		const img = this.elements.activeTabIcon;
		if (this.disposed || img === void 0) return;
		if (this.expectedFaviconUrl === void 0) {
			this.showFaviconFallback();
			return;
		}
		if (img.getAttribute("src") !== this.expectedFaviconUrl) return;
		if (this.faviconReady) return;
		this.showFaviconFallback();
	};
	/** Prompt for host access to the current non-loopback site so page reading can proceed. */
	onGrantAccess = () => {
		const origin = this.accessOrigin;
		if (origin === void 0 || this.permissions === void 0) return;
		this.permissions.request({ origins: [origin] }).then((granted) => {
			if (this.disposed || this.elements.grantAccessButton === void 0) return;
			this.elements.grantAccessButton.hidden = granted;
		}, () => {});
	};
	/** Open connection settings from the compact panel header. */
	onOpenSettings = () => {
		this.showSettings();
	};
	/** Retry the currently selected local Harness origin. */
	onRetry = () => {
		this.connect();
	};
	/** Restore the presentation that was active before address editing. */
	onCancelSettings = () => {
		this.elements.settingsError.textContent = "";
		this.elements.originInput.value = this.origin;
		this.setState(this.stateBeforeSettings);
	};
	/** Save a submitted address without allowing a document navigation. */
	onSaveSettings = (event) => {
		event.preventDefault();
		this.saveSettings();
	};
};
//#endregion
//#region lib/types/extension/sidepanel.js
/** MV3 side-panel entry that mounts the local Harness connection controller. */
/**
* Resolve and validate one required static side-panel element.
* @param id - document id owned by sidepanel.html.
* @param constructor - expected DOM element constructor.
* @returns the matching element.
*/
function requiredElement(id, constructor) {
	const element = document.getElementById(id);
	if (!(element instanceof constructor)) throw new Error(`browser side panel: #${id} is missing or has the wrong element type`);
	return element;
}
/** Resolve the complete element set expected by the controller. */
function resolveElements() {
	return {
		root: requiredElement("panel-root", HTMLElement),
		status: requiredElement("panel-status", HTMLElement),
		frame: requiredElement("harness-frame", HTMLIFrameElement),
		loading: requiredElement("loading-view", HTMLElement),
		loadingTitle: requiredElement("loading-title", HTMLElement),
		loadingDetail: requiredElement("loading-detail", HTMLElement),
		offline: requiredElement("offline-view", HTMLElement),
		offlineDetail: requiredElement("offline-detail", HTMLElement),
		settings: requiredElement("settings-view", HTMLElement),
		settingsForm: requiredElement("settings-form", HTMLFormElement),
		originInput: requiredElement("harness-origin", HTMLInputElement),
		settingsError: requiredElement("settings-error", HTMLElement),
		settingsButton: requiredElement("settings-button", HTMLButtonElement),
		retryButton: requiredElement("retry-button", HTMLButtonElement),
		cancelButton: requiredElement("cancel-button", HTMLButtonElement),
		activeTab: requiredElement("panel-active-tab", HTMLElement),
		activeTabIcon: requiredElement("panel-active-tab-icon", HTMLImageElement),
		activeTabIconFallback: requiredElement("panel-active-tab-icon-fallback", HTMLElement),
		activeTabTitle: requiredElement("panel-active-tab-title", HTMLElement),
		grantAccessButton: requiredElement("grant-page-access", HTMLButtonElement)
	};
}
const panelFetch = globalThis.fetch.bind(globalThis);
/** Ask the Service Worker to start the registered local companion. */
async function ensureHarness(origin) {
	const response = await chrome.runtime.sendMessage({
		kind: "ensure-local-harness",
		origin
	});
	if (typeof response !== "object" || response === null || !("ok" in response)) throw new Error("浏览器后台没有返回本机服务启动结果。");
	if (response.ok !== true) {
		const message = "error" in response && typeof response.error === "string" ? response.error : "本机服务启动失败。";
		throw new Error(message);
	}
}
/** Tell the Service Worker which tab the side-panel header is showing. */
function reportFocusedTab(tabId) {
	chrome.runtime.sendMessage({
		kind: "focus-tab",
		tabId
	});
}
/**
* Forward one iframe bridge envelope through this extension page.
* Content scripts inside the side-panel iframe are not a reliable sender for Host operations.
* @param message - versioned probe-time request from the embedded Web Client.
* @returns the Service Worker response payload.
*/
async function forwardBridge(message) {
	return await chrome.runtime.sendMessage(message);
}
const controller = new SidePanelController(resolveElements(), chrome.storage.local, panelFetch, ensureHarness, chrome.tabs, chrome.permissions, reportFocusedTab, forwardBridge);
controller.start().catch((error) => {
	console.error("browser side panel: startup failed", error);
});
window.addEventListener("unload", () => {
	controller.dispose();
}, { once: true });
//#endregion
