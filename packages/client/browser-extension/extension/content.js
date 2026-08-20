(function() {
	//#region lib/types/protocol.js
	/** Page-to-content-script protocol owned by the browser-extension provider package. */
	/** Protocol channel shared by the Web Client, content script, and Service Worker. */
	const BROWSER_EXTENSION_CHANNEL = "dsh-browser-extension";
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
	function isRecord(value) {
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
		return value.channel === "dsh-browser-extension" && value.version === 6 && value.direction === direction;
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
	/** Validate one optional element placement. */
	function isBridgePageRect(value) {
		return isRecord(value) && Number.isFinite(value.x) && Number.isFinite(value.y) && isNonNegativeNumber(value.width) && isNonNegativeNumber(value.height);
	}
	/** Validate one bounded clickable element summary. */
	function isBridgePageAction(value) {
		return isRecord(value) && isPageRef(value.ref) && typeof value.role === "string" && value.role.length > 0 && value.role.length <= 32 && typeof value.label === "string" && value.label.length <= 160 && (value.rect === void 0 || isBridgePageRect(value.rect)) && (value.accent === void 0 || typeof value.accent === "boolean") && typeof value.disabled === "boolean" && typeof value.inViewport === "boolean" && typeof value.focused === "boolean" && (value.context === void 0 || typeof value.context === "string" && value.context.length <= 200) && (value.href === void 0 || typeof value.href === "string" && value.href.length <= 2e3) && (value.checked === void 0 || typeof value.checked === "boolean") && (value.selected === void 0 || typeof value.selected === "boolean") && (value.expanded === void 0 || typeof value.expanded === "boolean") && (value.pressed === void 0 || typeof value.pressed === "boolean");
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
	/** Validate one bounded network observation. */
	function isBridgeNetworkEntry(value) {
		return isRecord(value) && typeof value.at === "number" && Number.isSafeInteger(value.at) && value.at >= 0 && (value.source === "fetch" || value.source === "xhr") && typeof value.method === "string" && value.method.length > 0 && value.method.length <= 16 && typeof value.url === "string" && value.url.length <= 500 && (value.status === void 0 || typeof value.status === "number" && Number.isSafeInteger(value.status) && value.status >= 0 && value.status <= 999) && (value.ok === void 0 || typeof value.ok === "boolean") && (value.durationMs === void 0 || typeof value.durationMs === "number" && Number.isSafeInteger(value.durationMs) && value.durationMs >= 0) && (value.error === void 0 || typeof value.error === "string" && value.error.length <= 500);
	}
	/** Validate one bounded console observation. */
	function isBridgeConsoleEntry(value) {
		return isRecord(value) && typeof value.at === "number" && Number.isSafeInteger(value.at) && value.at >= 0 && (value.level === "log" || value.level === "info" || value.level === "warn" || value.level === "error" || value.level === "debug") && typeof value.text === "string" && value.text.length <= 500;
	}
	/**
	* Validate inspect content returned directly by the active-page script.
	* @param value - untrusted content-script result.
	* @returns whether the value is one bounded inspect snapshot.
	*/
	function isBridgePageInspectContent(value) {
		return isRecord(value) && typeof value.hooked === "boolean" && (value.hookedAt === void 0 || typeof value.hookedAt === "number" && Number.isSafeInteger(value.hookedAt) && value.hookedAt >= 0) && Array.isArray(value.network) && value.network.length <= 40 && value.network.every(isBridgeNetworkEntry) && Array.isArray(value.console) && value.console.length <= 40 && value.console.every(isBridgeConsoleEntry) && typeof value.omittedNetwork === "number" && Number.isSafeInteger(value.omittedNetwork) && value.omittedNetwork >= 0 && typeof value.omittedConsole === "number" && Number.isSafeInteger(value.omittedConsole) && value.omittedConsole >= 0;
	}
	/**
	* Validate one complete bounded page-inspect result.
	* @param value - untrusted extension result.
	* @returns whether the value is one complete bounded inspect result.
	*/
	function isBridgePageInspect(value) {
		return isRecord(value) && isBridgeTab(value.tab) && isBridgePageInspectContent(value) && jsonByteLength(value) <= 49152;
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
			case "inspect-page": return (value.tabId === void 0 || isSafeTabId(value.tabId)) && typeof value.reset === "boolean";
			case "click-page-element":
			case "focus-page-element": return isPageId(value.pageId) && isPageRef(value.ref);
			case "fill-page-element": return isPageId(value.pageId) && isPageRef(value.ref) && typeof value.value === "string" && value.value.length <= 1e4 && typeof value.submit === "boolean";
			case "select-page-option": return isPageId(value.pageId) && isPageRef(value.ref) && typeof value.value === "string" && value.value.length <= 1e3;
			case "scroll-page": return isPageId(value.pageId) && (value.ref === void 0 || isPageRef(value.ref)) && typeof value.movement === "string" && SCROLL_MOVEMENTS.has(value.movement);
			case "press-page-key": return isPageId(value.pageId) && isPageRef(value.ref) && isRecord(value.modifiers) && (value.modifiers.ctrl === void 0 || typeof value.modifiers.ctrl === "boolean") && (value.modifiers.alt === void 0 || typeof value.modifiers.alt === "boolean") && (value.modifiers.shift === void 0 || typeof value.modifiers.shift === "boolean") && (value.modifiers.meta === void 0 || typeof value.modifiers.meta === "boolean") && isAllowedPressKey(value.key, {
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
	/** Validate an operation-specific result received from the Service Worker. */
	function isBridgeOperationResult(value) {
		if (!isRecord(value)) return false;
		switch (value.kind) {
			case "open-tab": return isBridgeTab(value.tab);
			case "list-tabs": return Array.isArray(value.tabs) && value.tabs.every(isBridgeTab);
			case "read-page":
			case "wait-page": return isBridgePage(value.page);
			case "inspect-page": return isBridgePageInspect(value.inspect);
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
	//#region lib/types/extension/content-runtime.js
	/** Isolated-world bridge between the DSH page and the extension Service Worker. */
	/**
	* Install the loopback page bridge.
	* @param target - loopback DSH page window.
	* @param runtime - Chromium runtime messaging API.
	* @returns listener disposer.
	*/
	function installContentBridge(target, runtime) {
		/** Announce that the content script supports the current protocol version. */
		const postReady = () => {
			target.postMessage({
				channel: BROWSER_EXTENSION_CHANNEL,
				version: 6,
				direction: "ready"
			}, target.location.origin);
		};
		/** Echo one validated Service Worker response to its page request. */
		const postResponse = (requestId, response) => {
			target.postMessage({
				channel: BROWSER_EXTENSION_CHANNEL,
				version: 6,
				direction: "response",
				requestId,
				response
			}, target.location.origin);
		};
		/** Forward page probes and validated requests from the same window. */
		const onMessage = (event) => {
			if (event.source !== target) return;
			if (isBridgeProbe(event.data)) {
				postReady();
				return;
			}
			if (!isBridgeRequest(event.data)) return;
			const request = event.data;
			runtime.sendMessage(request).then((response) => {
				const candidate = {
					channel: BROWSER_EXTENSION_CHANNEL,
					version: 6,
					direction: "response",
					requestId: request.requestId,
					response
				};
				if (isBridgeResponse(candidate)) postResponse(request.requestId, candidate.response);
				else postResponse(request.requestId, {
					ok: false,
					error: {
						code: "BROWSER_INVALID_REQUEST",
						message: "browser extension: invalid Service Worker response"
					}
				});
			}, (error) => {
				postResponse(request.requestId, {
					ok: false,
					error: {
						code: "BROWSER_API_FAILED",
						message: error instanceof Error ? error.message : String(error)
					}
				});
			});
		};
		target.addEventListener("message", onMessage);
		postReady();
		return () => {
			target.removeEventListener("message", onMessage);
		};
	}
	//#endregion
	//#region lib/types/extension/content.js
	/** MV3 content-script entry for the DSH loopback Web Client bridge. */
	installContentBridge(window, chrome.runtime);
	//#endregion
})();
