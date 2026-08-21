(function() {
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
	/** Validate one wait condition received across the bridge. */
	function isBridgeWaitCondition(value) {
		if (!isRecord(value)) return false;
		if (value.kind === "change") return isPageId(value.documentId) && typeof value.afterRevision === "number" && Number.isSafeInteger(value.afterRevision) && value.afterRevision >= 0;
		if (value.kind === "text") return typeof value.text === "string" && value.text.length > 0 && value.text.length <= 1e3 && (value.state === "present" || value.state === "absent");
		if (value.kind === "url") return typeof value.value === "string" && value.value.length > 0 && value.value.length <= 2e3 && (value.match === "exact" || value.match === "prefix" || value.match === "contains");
		return value.kind === "ready";
	}
	/**
	* Validate a wait request executed inside an already-resolved tab.
	* @param value - untrusted page-script wait payload.
	* @returns whether the payload is a supported wait request.
	*/
	function isBridgeWaitPageDomOperation(value) {
		return isRecord(value) && isBridgeWaitCondition(value.condition) && typeof value.timeoutMs === "number" && Number.isSafeInteger(value.timeoutMs) && value.timeoutMs >= 100 && value.timeoutMs <= 3e4 && typeof value.stableMs === "number" && Number.isSafeInteger(value.stableMs) && value.stableMs >= 0 && value.stableMs <= 2e3;
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
			case "inspect-page": return (value.tabId === void 0 || isSafeTabId(value.tabId)) && (value.mode === "start" || value.mode === "snapshot" || value.mode === "stop");
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
	//#endregion
	//#region lib/types/extension/page-document.js
	/** Document lifetime identity and DOM revision tracking for the in-page script. */
	/** Attribute carrying the latest page snapshot identity. */
	const PAGE_ID_ATTRIBUTE = "data-dsh-page-id";
	/** Attribute carrying one document-bound element reference. */
	const PAGE_REF_ATTRIBUTE = "data-dsh-page-ref";
	/** Attribute carrying the current document identity. */
	const DOCUMENT_ID_ATTRIBUTE = "data-dsh-document-id";
	let documentRevision = 0;
	let disposeRevisionObserver;
	/**
	* Create a UUID in browsers with or without randomUUID().
	* @returns an opaque document, page, or request identity.
	*/
	function createOpaqueId() {
		if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
		const bytes = crypto.getRandomValues(new Uint8Array(16));
		bytes[6] = (bytes[6] ?? 0) & 15 | 64;
		bytes[8] = (bytes[8] ?? 0) & 63 | 128;
		const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
		return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
	}
	/** Return whether a mutation only records this script's own reference attributes. */
	function isOwnProtocolMutation(mutation) {
		return mutation.type === "attributes" && typeof mutation.attributeName === "string" && mutation.attributeName.startsWith("data-dsh-");
	}
	/**
	* Observe document changes other than this extension's reference attributes.
	* @param onChange - callback for each relevant mutation batch.
	* @returns a disposer that disconnects the observer.
	*/
	function observeDocumentChanges(onChange) {
		if (typeof MutationObserver !== "function") return () => {};
		const observer = new MutationObserver((mutations) => {
			if (!mutations.every(isOwnProtocolMutation)) onChange();
		});
		observer.observe(document.documentElement, {
			subtree: true,
			childList: true,
			characterData: true,
			attributes: true
		});
		return () => {
			observer.disconnect();
		};
	}
	/**
	* Ensure the current document has a stable identity.
	* The identity survives reads of the same document and is replaced only when this
	* page script is created for a new document.
	* @returns the current document identity and revision.
	*/
	function ensureDocumentIdentity() {
		let documentId = document.documentElement.getAttribute(DOCUMENT_ID_ATTRIBUTE);
		if (documentId === null || documentId === "") {
			documentId = createOpaqueId();
			document.documentElement.setAttribute(DOCUMENT_ID_ATTRIBUTE, documentId);
			documentRevision = 0;
		}
		return {
			documentId,
			revision: documentRevision
		};
	}
	/** Arm the document revision for the first relevant mutation after a page snapshot. */
	function armDocumentRevision() {
		disposeRevisionObserver?.();
		let dispose = () => {};
		dispose = observeDocumentChanges(() => {
			documentRevision += 1;
			dispose();
			if (disposeRevisionObserver === dispose) disposeRevisionObserver = void 0;
		});
		disposeRevisionObserver = dispose;
	}
	/**
	* Return the current document identity without creating a new page snapshot.
	* @returns the current document identity and revision.
	*/
	function currentDocumentIdentity() {
		return ensureDocumentIdentity();
	}
	//#endregion
	//#region lib/types/extension/page-reader.js
	/** DOM extraction and document-bound element referencing for the active page. */
	const MAX_TEXT_LENGTH = 3e4;
	const MAX_FIELD_COUNT = 80;
	const MAX_ACTION_COUNT = 120;
	const MAX_LABEL_LENGTH = 160;
	const MAX_SHORT_FIELD_VALUE_LENGTH = 500;
	const UNLABELED = "(unlabeled)";
	const POINTER_CURSOR = "pointer";
	const INFERRED_CLICK_ROLE = "clickable";
	/** Compact icon controls need a rect so same-looking siblings can be told apart by placement. */
	const COMPACT_ACTION_PX = 56;
	/** Normalize rendered text while retaining meaningful line breaks. */
	function normalizeText(value) {
		return value.replace(/\r\n?/g, "\n").replace(/[\t\f\v\u00a0 ]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
	}
	/** Limit one string and notify the caller when information was omitted. */
	function limit(value, maxLength, onTruncated) {
		if (value.length <= maxLength) return value;
		onTruncated();
		return value.slice(0, maxLength);
	}
	/** Return whether one element is currently rendered. */
	function isVisible(element) {
		if (element.hidden || element.getAttribute("aria-hidden") === "true") return false;
		if (typeof element.checkVisibility === "function") return element.checkVisibility();
		let current = element;
		while (current !== null) {
			if (current.hidden) return false;
			const style = current.style;
			if (style.display === "none" || style.visibility === "hidden") return false;
			current = current.parentElement;
		}
		return true;
	}
	/** Return whether an element currently intersects the layout viewport. */
	function isInViewport(element) {
		const rect = element.getBoundingClientRect();
		if (rect.width === 0 && rect.height === 0) return isVisible(element);
		return rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth;
	}
	/** Return whether an input can expose authentication or payment secrets. */
	function isSecretInput$1(element) {
		if (!(element instanceof HTMLInputElement)) return false;
		if (element.type === "password" || element.type === "file" || element.type === "hidden") return true;
		return element.autocomplete.toLowerCase().split(/\s+/).some((token) => [
			"current-password",
			"new-password",
			"one-time-code",
			"cc-number",
			"cc-csc"
		].includes(token));
	}
	/** Return whether Chromium treats an element as an editable content host. */
	function isContentEditableElement$1(element) {
		if (element.isContentEditable) return true;
		const declared = element.getAttribute("contenteditable")?.trim().toLowerCase();
		return declared === "" || declared === "true" || declared === "plaintext-only";
	}
	/** Return the rounded viewport placement used to tell same-looking controls apart. */
	function elementRect(element) {
		const rect = element.getBoundingClientRect();
		return {
			x: Math.round(rect.left),
			y: Math.round(rect.top),
			width: Math.round(rect.width),
			height: Math.round(rect.height)
		};
	}
	/** Resolve the closest user-facing label for an element. */
	function elementLabel(element) {
		const labeledControl = element;
		const associated = Array.from(labeledControl.labels ?? []).map((label) => normalizeText(label.innerText || label.textContent || "")).filter(Boolean).join(" / ");
		const fallback = [
			element.getAttribute("aria-label"),
			element.getAttribute("placeholder"),
			element.getAttribute("title"),
			element.innerText || element.textContent,
			element.getAttribute("name"),
			element.id
		].map((candidate) => normalizeText(candidate ?? "")).find((candidate) => candidate !== "") ?? UNLABELED;
		return (associated || fallback).slice(0, MAX_LABEL_LENGTH);
	}
	/** Return a short heading or accessible name for a semantic container. */
	function containerTitle(element) {
		const labeledBy = element.getAttribute("aria-labelledby");
		if (labeledBy !== null) {
			const labelled = labeledBy.split(/\s+/).map((id) => document.getElementById(id)?.innerText || document.getElementById(id)?.textContent || "").map(normalizeText).filter(Boolean).join(" ");
			if (labelled !== "") return labelled.slice(0, 200);
		}
		const heading = element.querySelector("h1, h2, h3, h4, legend, [role=\"heading\"]");
		return [
			element.getAttribute("aria-label"),
			heading instanceof HTMLElement ? heading.innerText || heading.textContent : "",
			element.getAttribute("title")
		].map((candidate) => normalizeText(candidate ?? "")).find((candidate) => candidate !== "")?.slice(0, 200) ?? "";
	}
	/** Return whether an ancestor is a useful semantic context container. */
	function isContextContainer(element) {
		const role = element.getAttribute("role");
		return element instanceof HTMLDialogElement || element instanceof HTMLFormElement || element instanceof HTMLTableRowElement || element instanceof HTMLLIElement || role === "dialog" || role === "alertdialog" || role === "form" || role === "listitem" || role === "row" || role === "region" || role === "main" || role === "navigation" || role === "complementary" || role === "banner" || element.tagName === "MAIN" || element.tagName === "NAV" || element.tagName === "ASIDE" || element.tagName === "HEADER" || element.tagName === "SECTION" || element.tagName === "ARTICLE";
	}
	/** Return the nearest short dialog, form, row, or landmark title. */
	function elementContext(element) {
		let current = element.parentElement;
		while (current !== null) {
			if (isContextContainer(current)) {
				const title = containerTitle(current);
				if (title !== "") return title;
			}
			current = current.parentElement;
		}
	}
	/** Return whether an element is a supported editable field. */
	function isFieldElement(element) {
		return element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement || element instanceof HTMLElement && isContentEditableElement$1(element);
	}
	/** Return the stable field type exposed for one supported element. */
	function fieldType(element) {
		const role = element.getAttribute("role");
		if (role === "combobox" || role === "textbox") return role;
		if (element instanceof HTMLTextAreaElement) return "textarea";
		if (element instanceof HTMLSelectElement) return "select";
		if (element instanceof HTMLInputElement) return element.type || "text";
		return "textbox";
	}
	/** Return the current user-visible value stored by one field. */
	function fieldValue(element) {
		if (element instanceof HTMLSelectElement) return element.selectedOptions[0]?.text ?? element.value;
		if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) return element.value;
		return element.innerText || element.textContent || "";
	}
	/** Return native options for a select without dumping the full option list. */
	function fieldOptions(element, onTruncated) {
		if (!(element instanceof HTMLSelectElement)) return void 0;
		const options = [];
		for (const option of Array.from(element.options)) {
			if (options.length >= 40) {
				onTruncated();
				break;
			}
			options.push({
				value: option.value.slice(0, 1e3),
				label: normalizeText(option.text).slice(0, MAX_LABEL_LENGTH),
				selected: option.selected,
				disabled: option.disabled
			});
		}
		return options;
	}
	/** Return or assign the next opaque reference for one page element. */
	function assignPageRef(element, state) {
		const existing = element.getAttribute(PAGE_REF_ATTRIBUTE);
		if (existing !== null) return existing;
		const ref = `e${String(state.next)}`;
		state.next += 1;
		element.setAttribute(PAGE_REF_ATTRIBUTE, ref);
		return ref;
	}
	/** Convert one supported field to its bounded current state. */
	function formField(element, state, onTruncated) {
		const maxValueLength = element instanceof HTMLTextAreaElement || element instanceof HTMLElement && isContentEditableElement$1(element) ? MAX_TEXT_LENGTH : MAX_SHORT_FIELD_VALUE_LENGTH;
		const disabled = "disabled" in element && Boolean(element.disabled) || element.getAttribute("aria-disabled") === "true";
		const readOnly = "readOnly" in element && Boolean(element.readOnly) || element.getAttribute("aria-readonly") === "true";
		const required = "required" in element && Boolean(element.required) || element.getAttribute("aria-required") === "true";
		const field = {
			ref: assignPageRef(element, state),
			label: elementLabel(element),
			type: fieldType(element),
			value: limit(normalizeText(fieldValue(element)), maxValueLength, onTruncated),
			disabled,
			readOnly,
			required,
			inViewport: isInViewport(element),
			focused: element.ownerDocument.activeElement === element
		};
		if (element instanceof HTMLInputElement && (element.type === "checkbox" || element.type === "radio")) field.checked = element.checked;
		const context = elementContext(element);
		if (context !== void 0) field.context = context;
		const options = fieldOptions(element, onTruncated);
		if (options !== void 0) field.options = options;
		return field;
	}
	/** Return the click role exposed for one supported action element. */
	function actionRole(element) {
		const explicit = element.getAttribute("role");
		if (explicit !== null && explicit !== "") return explicit;
		if (element instanceof HTMLAnchorElement) return "link";
		if (element instanceof HTMLInputElement && (element.type === "checkbox" || element.type === "radio")) return element.type;
		return "button";
	}
	/** Return whether one action element currently rejects activation. */
	function actionDisabled(element) {
		return "disabled" in element && element.disabled || element.getAttribute("aria-disabled") === "true";
	}
	/** Convert a tri-state ARIA token into a boolean when the token is explicit. */
	function ariaBoolean(element, name) {
		const value = element.getAttribute(name);
		if (value === "true") return true;
		if (value === "false") return false;
	}
	/** Parse one computed CSS rgb/rgba color into 0-255 channels. */
	function parseCssColor(value) {
		const match = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*(\d*\.?\d+))?\s*\)/.exec(value);
		if (match === null) return void 0;
		return {
			r: Number(match[1]),
			g: Number(match[2]),
			b: Number(match[3]),
			a: match[4] === void 0 ? 1 : Number(match[4])
		};
	}
	/** Return whether one color is a saturated fill rather than gray, white, or transparent. */
	function isAccentColor(value) {
		const color = parseCssColor(value);
		if (color === void 0 || color.a < .4) return false;
		const max = Math.max(color.r, color.g, color.b);
		const min = Math.min(color.r, color.g, color.b);
		if (max < 80) return false;
		return (max - min) / max >= .25;
	}
	/** Return whether one control uses a saturated non-gray fill on itself or its nearest painted ancestor. */
	function isAccentSurface(element) {
		let current = element;
		for (let depth = 0; depth < 4 && current !== null; depth += 1) {
			if (isAccentColor(window.getComputedStyle(current).backgroundColor)) return true;
			current = current.parentElement;
		}
		return false;
	}
	/** Convert one supported action element to its bounded current state. */
	function pageAction(element, state, role) {
		const label = elementLabel(element);
		const action = {
			ref: assignPageRef(element, state),
			role: (role ?? actionRole(element)).slice(0, 32),
			label,
			disabled: actionDisabled(element),
			inViewport: isInViewport(element),
			focused: element.ownerDocument.activeElement === element
		};
		const rect = elementRect(element);
		const compact = rect.width > 0 && rect.height > 0 && rect.width <= COMPACT_ACTION_PX && rect.height <= COMPACT_ACTION_PX;
		if (label === UNLABELED || compact) action.rect = rect;
		if (isAccentSurface(element)) action.accent = true;
		const context = elementContext(element);
		if (context !== void 0) action.context = context;
		if (element instanceof HTMLAnchorElement) {
			const href = element.getAttribute("href");
			if (href !== null) action.href = href.slice(0, 2e3);
		}
		if (element instanceof HTMLInputElement && (element.type === "checkbox" || element.type === "radio")) action.checked = element.checked;
		const checked = ariaBoolean(element, "aria-checked");
		if (checked !== void 0) action.checked = checked;
		const selected = ariaBoolean(element, "aria-selected");
		if (selected !== void 0) action.selected = selected;
		const expanded = ariaBoolean(element, "aria-expanded");
		if (expanded !== void 0) action.expanded = expanded;
		const pressed = ariaBoolean(element, "aria-pressed");
		if (pressed !== void 0) action.pressed = pressed;
		return action;
	}
	/**
	* Return whether one pointer-cursor element is worth exposing on its own.
	* An element already referenced by this snapshot, or one wrapping a reference,
	* is skipped because that inner reference is the more precise click target.
	*/
	function isInferredClickTarget(element) {
		if (element.hasAttribute("data-dsh-page-ref")) return false;
		if (element.querySelector(`[data-dsh-page-ref]`) !== null) return false;
		if (element.getAttribute("aria-hidden") === "true") return false;
		const rect = element.getBoundingClientRect();
		return rect.width > 0 && rect.height > 0 && isInViewport(element);
	}
	/**
	* Record the outermost pointer-cursor element of each on-screen region.
	* Frameworks build icon controls from click handlers on plain containers, which
	* carry no role and no accessible name; without this pass the model has no
	* reference for a control the user can see, such as a chat composer send icon.
	* `cursor` inherits, so recording a region ends the descent into it.
	* @param element - current element of the depth-first walk.
	* @param parentCursor - computed cursor of the parent element.
	* @param actions - actions collected so far, extended in place.
	*/
	function collectInferredClickTargets(element, parentCursor, actions, state, onTruncated) {
		if (actions.length >= MAX_ACTION_COUNT) {
			onTruncated();
			return;
		}
		const style = window.getComputedStyle(element);
		if (style.display === "none" || style.visibility === "hidden") return;
		if (style.cursor === POINTER_CURSOR && parentCursor !== POINTER_CURSOR && isInferredClickTarget(element)) {
			actions.push(pageAction(element, state, INFERRED_CLICK_ROLE));
			return;
		}
		for (const child of element.children) if (child instanceof HTMLElement) collectInferredClickTargets(child, style.cursor, actions, state, onTruncated);
	}
	/** Collect the main document and accessible same-origin child-frame documents. */
	function pageDocuments$1() {
		const documents = [document];
		const frames = document.querySelectorAll("iframe");
		for (let index = 0; index < frames.length && index < 6; index += 1) try {
			const frameDocument = frames[index]?.contentDocument;
			if (frameDocument !== null && frameDocument !== void 0) documents.push(frameDocument);
		} catch {}
		return documents;
	}
	/** Remove references from the preceding snapshot before assigning a new document identity. */
	function clearPageRefs(documents) {
		for (const current of documents) for (const element of current.querySelectorAll(`[${PAGE_REF_ATTRIBUTE}]`)) element.removeAttribute(PAGE_REF_ATTRIBUTE);
	}
	/** Return current viewport and document scroll metrics. */
	function pageViewport() {
		const scrolling = document.scrollingElement ?? document.documentElement;
		return {
			width: window.innerWidth || document.documentElement.clientWidth,
			height: window.innerHeight || document.documentElement.clientHeight,
			scrollX: window.scrollX || scrolling.scrollLeft,
			scrollY: window.scrollY || scrolling.scrollTop,
			documentWidth: Math.max(document.documentElement.scrollWidth, scrolling.scrollWidth),
			documentHeight: Math.max(document.documentElement.scrollHeight, scrolling.scrollHeight)
		};
	}
	/** Return overflow style tokens that can actually produce a scrollbar. */
	function overflowTokens(element) {
		const style = window.getComputedStyle(element);
		return `${style.overflow} ${style.overflowX} ${style.overflowY} ${element.style.overflow}`;
	}
	/** Return whether an element currently has leftover scroll range on at least one axis. */
	function scrollRange(element) {
		const maxTop = Math.max(0, element.scrollHeight - element.clientHeight);
		const maxLeft = Math.max(0, element.scrollWidth - element.clientWidth);
		const vertical = maxTop > 1;
		const horizontal = maxLeft > 1;
		if (!vertical && !horizontal) return void 0;
		const overflow = overflowTokens(element);
		if (!(element === document.documentElement || element === document.body || element === document.scrollingElement || /auto|scroll|overlay/.test(overflow))) return void 0;
		return {
			axis: vertical && horizontal ? "both" : vertical ? "vertical" : "horizontal",
			top: element.scrollTop,
			left: element.scrollLeft,
			maxTop,
			maxLeft
		};
	}
	/** Collect visible containers that currently have leftover scroll range. */
	function collectScrollTargets(documents, state, onTruncated) {
		const targets = [];
		const seen = /* @__PURE__ */ new Set();
		const candidates = [];
		const scrolling = document.scrollingElement;
		if (scrolling instanceof HTMLElement) candidates.push(scrolling);
		if (document.documentElement instanceof HTMLElement) candidates.push(document.documentElement);
		if (document.body instanceof HTMLElement) candidates.push(document.body);
		for (const current of documents) for (const candidate of current.querySelectorAll("*")) candidates.push(candidate);
		for (const element of candidates) {
			if (seen.has(element) || !isVisible(element)) continue;
			const range = scrollRange(element);
			if (range === void 0) continue;
			seen.add(element);
			if (targets.length >= 40) {
				onTruncated();
				break;
			}
			const label = element === document.scrollingElement || element === document.documentElement || element === document.body ? "Document" : elementLabel(element);
			targets.push({
				ref: assignPageRef(element, state),
				label,
				...range
			});
		}
		return targets;
	}
	/**
	* Read bounded visible text, fields, and actionable references from the active document.
	* @returns a new snapshot identity and its bounded readable and actionable state.
	*/
	function readVisiblePage() {
		let truncated = false;
		/** Record that the current snapshot omitted bounded content. */
		const markTruncated = () => {
			truncated = true;
		};
		const documents = pageDocuments$1();
		clearPageRefs(documents);
		const identity = ensureDocumentIdentity();
		const pageId = createOpaqueId();
		document.documentElement.setAttribute(PAGE_ID_ATTRIBUTE, pageId);
		const referenceState = { next: 1 };
		const renderedParts = [];
		const controls = [];
		for (const current of documents) {
			const body = current.body;
			renderedParts.push(body.innerText || body.textContent || "");
			for (const candidate of current.querySelectorAll("input, textarea, select, [contenteditable], [role=\"textbox\"]")) if (isFieldElement(candidate)) controls.push(candidate);
		}
		const renderedText = normalizeText(renderedParts.join("\n"));
		controls.sort((left, right) => Number(right instanceof HTMLTextAreaElement) - Number(left instanceof HTMLTextAreaElement));
		const fields = [];
		const extraText = [];
		for (const control of controls) {
			if (isSecretInput$1(control) || !isVisible(control)) continue;
			if (fields.length >= MAX_FIELD_COUNT) {
				truncated = true;
				break;
			}
			const field = formField(control, referenceState, markTruncated);
			fields.push(field);
			if (field.value === "" || renderedText.includes(field.value.slice(0, 80))) continue;
			extraText.push(field.type === "textarea" || field.type === "textbox" ? field.value : `${field.label}: ${field.value}`);
		}
		const actionSelector = [
			"button",
			"a[href]",
			"input[type=\"button\"]",
			"input[type=\"submit\"]",
			"input[type=\"reset\"]",
			"input[type=\"checkbox\"]",
			"input[type=\"radio\"]",
			"[role=\"button\"]",
			"[role=\"link\"]",
			"[role=\"option\"]",
			"[role=\"tab\"]",
			"[role=\"menuitem\"]",
			"[role=\"checkbox\"]",
			"[role=\"radio\"]"
		].join(", ");
		const actions = [];
		for (const current of documents) {
			for (const candidate of current.querySelectorAll(actionSelector)) {
				if (isSecretInput$1(candidate) || !isVisible(candidate)) continue;
				if (actions.length >= MAX_ACTION_COUNT) {
					truncated = true;
					break;
				}
				actions.push(pageAction(candidate, referenceState));
			}
			if (actions.length >= MAX_ACTION_COUNT) break;
		}
		for (const current of documents) collectInferredClickTargets(current.body, "", actions, referenceState, markTruncated);
		const scrollTargets = collectScrollTargets(documents, referenceState, markTruncated);
		const page = {
			pageId,
			documentId: identity.documentId,
			revision: identity.revision,
			viewport: pageViewport(),
			text: limit(normalizeText([renderedText, ...extraText].filter(Boolean).join("\n\n")), MAX_TEXT_LENGTH, markTruncated),
			fields,
			actions,
			scrollTargets,
			truncated
		};
		armDocumentRevision();
		return page;
	}
	//#endregion
	//#region lib/types/extension/page-actor.js
	/** Document-bound click, fill, select, scroll, focus, and key operations executed inside the active page. */
	/** Stable page-action failure returned through the extension bridge. */
	var PageActionError = class extends Error {
		/** Machine-readable error code preserved through content-script messaging. */
		code;
		/** Create one page action failure with a stable code. */
		constructor(code, message) {
			super(`${code}: ${message}`);
			this.name = "PageActionError";
			this.code = code;
		}
	};
	const LINE_SCROLL_PX = 40;
	const SKIP_KEYPRESS = new Set([
		"Tab",
		"Escape",
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
	/** Collect the main document and accessible same-origin child-frame documents. */
	function pageDocuments() {
		const documents = [document];
		const frames = document.querySelectorAll("iframe");
		for (let index = 0; index < frames.length && index < 6; index += 1) try {
			const frameDocument = frames[index]?.contentDocument;
			if (frameDocument !== null && frameDocument !== void 0) documents.push(frameDocument);
		} catch {}
		return documents;
	}
	/** Resolve a reference only when it belongs to the latest page snapshot. */
	function resolveElement(pageId, ref) {
		if (document.documentElement.getAttribute("data-dsh-page-id") !== pageId) throw new PageActionError("BROWSER_PAGE_STALE", "the page changed or was read again; read the current page before retrying");
		for (const current of pageDocuments()) {
			const element = current.querySelector(`[${PAGE_REF_ATTRIBUTE}="${ref}"]`);
			if (element !== null) return element;
		}
		throw new PageActionError("BROWSER_ELEMENT_NOT_FOUND", `element reference ${ref} is no longer present; read the page again`);
	}
	/** Return whether one page element currently rejects activation. */
	function isDisabled(element) {
		return "disabled" in element && element.disabled || element.getAttribute("aria-disabled") === "true";
	}
	/** Return whether one page element currently rejects editing. */
	function isReadOnly(element) {
		return "readOnly" in element && Boolean(element.readOnly) || element.getAttribute("aria-readonly") === "true";
	}
	/** Reject controls whose values can contain authentication or payment secrets. */
	function isSecretInput(element) {
		if (!(element instanceof HTMLInputElement)) return false;
		if (element.type === "password" || element.type === "file" || element.type === "hidden") return true;
		return element.autocomplete.toLowerCase().split(/\s+/).some((token) => [
			"current-password",
			"new-password",
			"one-time-code",
			"cc-number",
			"cc-csc"
		].includes(token));
	}
	/** Return whether Chromium treats an element as an editable content host. */
	function isContentEditableElement(element) {
		if (element.isContentEditable) return true;
		const declared = element.getAttribute("contenteditable")?.trim().toLowerCase();
		return declared === "" || declared === "true" || declared === "plaintext-only";
	}
	/** Set a native input value without being shadowed by framework instance properties. */
	function setInputValue(element, value) {
		const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
		if (descriptor?.set === void 0) throw new PageActionError("BROWSER_ELEMENT_NOT_EDITABLE", "the input value setter is unavailable");
		descriptor.set.call(element, value);
	}
	/** Set a native textarea value without being shadowed by framework instance properties. */
	function setTextAreaValue(element, value) {
		const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value");
		if (descriptor?.set === void 0) throw new PageActionError("BROWSER_ELEMENT_NOT_EDITABLE", "the textarea value setter is unavailable");
		descriptor.set.call(element, value);
	}
	/** Replace contenteditable text through Chromium's editing engine so page frameworks receive the native edit. */
	function setContentEditableValue(element, value) {
		const ownerDocument = element.ownerDocument;
		const selection = ownerDocument.getSelection();
		if (selection === null) throw new PageActionError("BROWSER_ELEMENT_NOT_EDITABLE", "the contenteditable selection is unavailable");
		const range = ownerDocument.createRange();
		range.selectNodeContents(element);
		selection.removeAllRanges();
		selection.addRange(range);
		let applied = false;
		try {
			applied = value === "" ? ownerDocument.execCommand("delete", false) : ownerDocument.execCommand("insertText", false, value);
		} catch {
			throw new PageActionError("BROWSER_ELEMENT_NOT_EDITABLE", "the contenteditable editing command failed");
		}
		if (!applied) throw new PageActionError("BROWSER_ELEMENT_NOT_EDITABLE", "the contenteditable editing command was rejected");
	}
	/** Notify page frameworks that one user-facing value changed. */
	function dispatchValueEvents(element, value) {
		element.dispatchEvent(new InputEvent("input", {
			bubbles: true,
			composed: true,
			inputType: "insertText",
			data: value
		}));
		element.dispatchEvent(new Event("change", {
			bubbles: true,
			composed: true
		}));
	}
	/** Submit the owning form, click a nearby send control, or dispatch Enter for standalone search. */
	function submitElement(element) {
		const form = element.closest("form");
		if (form instanceof HTMLFormElement) {
			form.requestSubmit();
			return;
		}
		const send = findComposerSubmitButton(element);
		if (send !== void 0) {
			clickElement(send);
			return;
		}
		if (element instanceof HTMLButtonElement || element.getAttribute("role") === "button") {
			element.click();
			return;
		}
		dispatchKeySequence(element, "Enter", {});
	}
	const COMPOSER_SCOPE_SELECTOR = "form, [role=\"form\"], .el-editor-sender, .ch-chat-input, [class*=\"editor-sender\"]";
	const SEND_CONTROL_NAME = /发送|send|submit|提交/i;
	const REJECT_CONTROL_NAME = /删除|delete|清空|clear|关闭|close|取消|cancel|新开对话|new chat|new conversation/i;
	const COMPOSER_CONTROL_SELECTOR = "button, [role=\"button\"], input[type=\"submit\"]";
	const COMPOSER_ANCESTOR_WALK = 8;
	/** Collect accessible names used to recognize send versus destructive composer controls. */
	function controlName(element) {
		return [
			element.getAttribute("aria-label"),
			element.getAttribute("title"),
			element.innerText || element.textContent
		].filter((candidate) => candidate !== null && candidate !== "").join(" ");
	}
	/** Return whether one control is a native form submit button. */
	function isNativeSubmitControl(element) {
		return (element instanceof HTMLInputElement || element instanceof HTMLButtonElement) && element.type === "submit";
	}
	/**
	* Find an enabled send or submit control inside one composer subtree.
	* Named send/submit wins; otherwise a native submit; otherwise the unique remaining non-destructive button.
	* Destructive names such as delete are never chosen, including the first button in a send-button cluster.
	*/
	function submitButtonIn(scope, from) {
		const controls = [...scope.querySelectorAll(COMPOSER_CONTROL_SELECTOR)].filter((element) => element !== from && !isDisabled(element));
		const namedSend = controls.find((element) => {
			const name = controlName(element);
			return SEND_CONTROL_NAME.test(name) && !REJECT_CONTROL_NAME.test(name);
		});
		if (namedSend !== void 0) return namedSend;
		const nativeSubmit = controls.find((element) => isNativeSubmitControl(element) && !REJECT_CONTROL_NAME.test(controlName(element)));
		if (nativeSubmit !== void 0) return nativeSubmit;
		const remaining = controls.filter((element) => !REJECT_CONTROL_NAME.test(controlName(element)));
		return remaining.length === 1 ? remaining[0] : void 0;
	}
	/** Locate a nearby composer send control when the filled field is not inside a native form. */
	function findComposerSubmitButton(from) {
		const closest = from.closest(COMPOSER_SCOPE_SELECTOR);
		if (closest !== null) return submitButtonIn(closest, from);
		let scope = from.parentElement;
		for (let depth = 0; depth < COMPOSER_ANCESTOR_WALK && scope !== null; depth += 1) {
			const found = submitButtonIn(scope, from);
			if (found !== void 0) return found;
			scope = scope.parentElement;
		}
	}
	/** Click a nearby send control when Enter was prevented on a non-form composer field. */
	function submitStandaloneComposer(element) {
		if (element.closest("form") instanceof HTMLFormElement) return;
		const send = findComposerSubmitButton(element);
		if (send === void 0 || send === element) return;
		clickElement(send);
	}
	/** Return the current user-visible text stored by one filled control. */
	function currentEditableValue(element) {
		if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) return element.value;
		return (element.innerText || element.textContent || "").replace(/\s+/g, " ").trim();
	}
	/** Normalize comparison text so fill verification is independent of surrounding whitespace. */
	function normalizeComparable(value) {
		return value.replace(/\s+/g, " ").trim();
	}
	/** Fill one supported text field and optionally submit it. */
	function fillElement(element, value, submit) {
		if (isDisabled(element) || isReadOnly(element) || isSecretInput(element)) throw new PageActionError("BROWSER_ELEMENT_NOT_EDITABLE", "the referenced control cannot accept text");
		element.focus();
		if (element instanceof HTMLInputElement) {
			if ([
				"button",
				"checkbox",
				"color",
				"file",
				"hidden",
				"image",
				"radio",
				"range",
				"reset",
				"submit"
			].includes(element.type)) throw new PageActionError("BROWSER_ELEMENT_NOT_EDITABLE", `input type ${element.type} cannot accept text`);
			setInputValue(element, value);
		} else if (element instanceof HTMLTextAreaElement) setTextAreaValue(element, value);
		else if (isContentEditableElement(element)) {
			setContentEditableValue(element, value);
			const actual = normalizeComparable(currentEditableValue(element));
			const expected = normalizeComparable(value);
			if (expected !== "" && actual !== expected && !actual.includes(expected)) throw new PageActionError("BROWSER_ELEMENT_NOT_EDITABLE", "the contenteditable value did not match the requested text");
			element.dispatchEvent(new Event("change", {
				bubbles: true,
				composed: true
			}));
			if (submit) submitElement(element);
			return;
		} else throw new PageActionError("BROWSER_ELEMENT_NOT_EDITABLE", "the referenced element is not a text field");
		dispatchValueEvents(element, value);
		if (normalizeComparable(currentEditableValue(element)) !== normalizeComparable(value)) throw new PageActionError("BROWSER_ELEMENT_NOT_EDITABLE", "the control value did not match the requested text after filling");
		if (submit) submitElement(element);
	}
	/** Return whether one element is a native or ARIA control that should receive the click. */
	function isActivationControl(element) {
		if (isDisabled(element)) return false;
		if (element instanceof HTMLButtonElement) return true;
		if (element instanceof HTMLAnchorElement && element.getAttribute("href") !== null) return true;
		if (element instanceof HTMLInputElement) return [
			"button",
			"submit",
			"reset",
			"image",
			"checkbox",
			"radio"
		].includes(element.type);
		const role = element.getAttribute("role");
		return role === "button" || role === "link" || role === "tab" || role === "menuitem" || role === "option" || role === "checkbox" || role === "radio";
	}
	/**
	* Resolve the control a click should activate.
	* Icon markup and composer chrome are often the referenced node; the named send or nearest button is the effect.
	*/
	function activationTarget(element) {
		if (isActivationControl(element)) return element;
		const closest = element.closest("button, a[href], input[type=\"button\"], input[type=\"submit\"], [role=\"button\"]");
		if (closest instanceof HTMLElement && isActivationControl(closest)) return closest;
		const send = findComposerSubmitButton(element);
		if (send !== void 0) return send;
		const nested = [...element.querySelectorAll(COMPOSER_CONTROL_SELECTOR)].filter((candidate) => isActivationControl(candidate) && !REJECT_CONTROL_NAME.test(controlName(candidate)));
		const only = nested[0];
		return nested.length === 1 && only !== void 0 ? only : element;
	}
	/** Dispatch a pointer sequence then a native click so framework click and pointer handlers both run. */
	function dispatchActivation(element) {
		const mouseInit = {
			bubbles: true,
			cancelable: true,
			composed: true,
			button: 0
		};
		if (typeof PointerEvent === "function") {
			const pointerInit = {
				...mouseInit,
				pointerId: 1,
				pointerType: "mouse"
			};
			element.dispatchEvent(new PointerEvent("pointerdown", pointerInit));
			element.dispatchEvent(new MouseEvent("mousedown", mouseInit));
			element.dispatchEvent(new PointerEvent("pointerup", pointerInit));
			element.dispatchEvent(new MouseEvent("mouseup", mouseInit));
		} else {
			element.dispatchEvent(new MouseEvent("mousedown", mouseInit));
			element.dispatchEvent(new MouseEvent("mouseup", mouseInit));
		}
		element.click();
	}
	/** Click the activation target of one referenced element. */
	function clickElement(element) {
		const target = activationTarget(element);
		if (isDisabled(target)) throw new PageActionError("BROWSER_ELEMENT_DISABLED", "the referenced element is disabled");
		target.focus();
		dispatchActivation(target);
	}
	/** Select one native option by exact value or normalized visible text. */
	function selectOption(element, requestedValue) {
		if (!(element instanceof HTMLSelectElement) || isDisabled(element)) throw new PageActionError("BROWSER_ELEMENT_NOT_EDITABLE", "the referenced element is not an enabled native select");
		const normalizedRequested = requestedValue.replace(/\s+/g, " ").trim();
		const option = Array.from(element.options).find((candidate) => candidate.value === requestedValue) ?? Array.from(element.options).find((candidate) => candidate.text.replace(/\s+/g, " ").trim() === normalizedRequested);
		if (option === void 0) throw new PageActionError("BROWSER_OPTION_NOT_FOUND", `no option matches ${requestedValue}`);
		const descriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");
		if (descriptor?.set === void 0) throw new PageActionError("BROWSER_ELEMENT_NOT_EDITABLE", "the select value setter is unavailable");
		descriptor.set.call(element, option.value);
		dispatchValueEvents(element, option.value);
		if (element.value !== option.value) throw new PageActionError("BROWSER_ELEMENT_NOT_EDITABLE", "the select value did not match the requested option");
		return option.value;
	}
	/** Return the document scrolling element used when no container ref is supplied. */
	function documentScrollElement() {
		const scrolling = document.scrollingElement;
		if (scrolling instanceof HTMLElement) return scrolling;
		return document.documentElement;
	}
	/** Return leftover scroll range for one element. */
	function scrollMetrics(element) {
		return {
			top: element.scrollTop,
			left: element.scrollLeft,
			maxTop: Math.max(0, element.scrollHeight - element.clientHeight),
			maxLeft: Math.max(0, element.scrollWidth - element.clientWidth)
		};
	}
	/** Apply one discrete movement to a scrollable element. */
	function applyScrollMovement(element, movement) {
		const pageHeight = element.clientHeight || window.innerHeight;
		const pageWidth = element.clientWidth || window.innerWidth;
		const maxTop = Math.max(0, element.scrollHeight - element.clientHeight);
		const maxLeft = Math.max(0, element.scrollWidth - element.clientWidth);
		switch (movement) {
			case "line-up":
				element.scrollTop = element.scrollTop - LINE_SCROLL_PX;
				break;
			case "line-down":
				element.scrollTop = element.scrollTop + LINE_SCROLL_PX;
				break;
			case "line-left":
				element.scrollLeft = element.scrollLeft - LINE_SCROLL_PX;
				break;
			case "line-right":
				element.scrollLeft = element.scrollLeft + LINE_SCROLL_PX;
				break;
			case "page-up":
				element.scrollTop = element.scrollTop - pageHeight;
				break;
			case "page-down":
				element.scrollTop = element.scrollTop + pageHeight;
				break;
			case "page-left":
				element.scrollLeft = element.scrollLeft - pageWidth;
				break;
			case "page-right":
				element.scrollLeft = element.scrollLeft + pageWidth;
				break;
			case "top":
				element.scrollTop = 0;
				break;
			case "bottom":
				element.scrollTop = maxTop;
				break;
			case "left-edge":
				element.scrollLeft = 0;
				break;
			case "right-edge":
				element.scrollLeft = maxLeft;
				break;
		}
	}
	/** Scroll the document viewport or one referenced scroll target. */
	function scrollTarget(pageId, ref, movement) {
		if (document.documentElement.getAttribute("data-dsh-page-id") !== pageId) throw new PageActionError("BROWSER_PAGE_STALE", "the page changed or was read again; read the current page before retrying");
		const element = ref === void 0 ? documentScrollElement() : resolveElement(pageId, ref);
		const before = scrollMetrics(element);
		if (ref !== void 0 && before.maxTop <= 1 && before.maxLeft <= 1) throw new PageActionError("BROWSER_SCROLL_TARGET_INVALID", "the referenced element is not a scrollable container");
		applyScrollMovement(element, movement);
		if ((element === document.documentElement || element === document.body || element === document.scrollingElement) && typeof window.scrollTo === "function") try {
			window.scrollTo(element.scrollLeft, element.scrollTop);
		} catch {}
		const after = scrollMetrics(element);
		const moved = after.top !== before.top || after.left !== before.left;
		return {
			pageId,
			...ref === void 0 ? {} : { ref },
			movement,
			...after,
			moved,
			atBoundary: !moved
		};
	}
	/** Return whether the referenced element currently holds document focus. */
	function isActiveElement(element) {
		const active = element.ownerDocument.activeElement;
		return active === element || element.contains(active);
	}
	/** Focus one referenced field or action and verify document.activeElement. */
	function focusElement(element) {
		if (isDisabled(element)) throw new PageActionError("BROWSER_ELEMENT_DISABLED", "the referenced element is disabled");
		if (element.tabIndex < 0 && !isContentEditableElement(element) && !(element instanceof HTMLInputElement) && !(element instanceof HTMLTextAreaElement) && !(element instanceof HTMLSelectElement) && !(element instanceof HTMLButtonElement) && !(element instanceof HTMLAnchorElement)) throw new PageActionError("BROWSER_ELEMENT_NOT_EDITABLE", "the referenced element is not focusable");
		element.focus();
		if (!isActiveElement(element)) throw new PageActionError("BROWSER_CAPABILITY_UNAVAILABLE", "document.activeElement is not the referenced element after focus");
	}
	/** Map a bounded key onto KeyboardEvent.code. */
	function keyCode(key) {
		if (key === "Space") return "Space";
		if (key.length === 1 && key >= "a" && key <= "z") return `Key${key.toUpperCase()}`;
		if (key.length === 1 && key >= "0" && key <= "9") return `Digit${key}`;
		return key;
	}
	/** Map a bounded key onto KeyboardEvent.key, applying Shift for letters. */
	function eventKeyFor(key, shift) {
		if (key === "Space") return " ";
		if (key.length === 1 && key >= "a" && key <= "z") return shift ? key.toUpperCase() : key;
		return key;
	}
	const NAMED_LEGACY_KEY_CODES = {
		Enter: 13,
		Escape: 27,
		Tab: 9,
		Space: 32,
		ArrowUp: 38,
		ArrowDown: 40,
		ArrowLeft: 37,
		ArrowRight: 39,
		Home: 36,
		End: 35,
		PageUp: 33,
		PageDown: 34,
		Backspace: 8,
		Delete: 46
	};
	/**
	* Map a bounded key onto the legacy `keyCode`/`which` value. Pages that gate a
	* gesture on `event.keyCode` — chat composers sending on `keyCode === 13` are
	* the common case — never react to a synthetic event that omits it, because
	* the constructor defaults these members to 0.
	*/
	function legacyKeyCode(key) {
		const named = NAMED_LEGACY_KEY_CODES[key];
		if (named !== void 0) return named;
		return key.toUpperCase().charCodeAt(0);
	}
	/** Dispatch a bubbling, cancelable key sequence against one element. */
	function dispatchKeySequence(element, key, modifiers) {
		const code = keyCode(key);
		const eventKey = eventKeyFor(key, modifiers.shift === true);
		const legacy = legacyKeyCode(key);
		let prevented = false;
		for (const type of [
			"keydown",
			"keypress",
			"keyup"
		]) {
			if (type === "keypress" && SKIP_KEYPRESS.has(key)) continue;
			const event = new KeyboardEvent(type, {
				key: eventKey,
				code,
				keyCode: legacy,
				which: legacy,
				bubbles: true,
				composed: true,
				cancelable: true,
				ctrlKey: modifiers.ctrl === true,
				altKey: modifiers.alt === true,
				shiftKey: modifiers.shift === true,
				metaKey: modifiers.meta === true
			});
			if (!element.dispatchEvent(event)) prevented = true;
		}
		return prevented;
	}
	/** Collect tabbable elements in document order. */
	function focusableElements() {
		const selector = "a[href], button, input, select, textarea, [contenteditable], [tabindex]";
		const elements = [];
		for (const current of pageDocuments()) for (const candidate of current.querySelectorAll(selector)) {
			if (isDisabled(candidate) || candidate.tabIndex < 0) continue;
			if (candidate instanceof HTMLInputElement && candidate.type === "hidden") continue;
			elements.push(candidate);
		}
		return elements;
	}
	/** Move focus to the next or previous tabbable element. */
	function moveFocus(from, reverse) {
		const elements = focusableElements();
		if (elements.length === 0) return false;
		const index = elements.indexOf(from);
		const next = elements[reverse ? index <= 0 ? elements.length - 1 : index - 1 : index === -1 || index === elements.length - 1 ? 0 : index + 1];
		if (next === void 0) return false;
		next.focus();
		return isActiveElement(next);
	}
	/** Apply the browser default for one bounded key when the page did not prevent it. */
	function applyKeyDefault(element, key, modifiers) {
		if (key === "Tab") return moveFocus(element, modifiers.shift === true);
		if (key === "Space" && element instanceof HTMLInputElement && (element.type === "checkbox" || element.type === "radio")) {
			if (element.type === "checkbox") element.checked = !element.checked;
			else element.checked = true;
			dispatchValueEvents(element, element.value);
			return true;
		}
		if (key === "Enter") {
			submitElement(element);
			return true;
		}
		if ((key === "Backspace" || key === "Delete") && (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
			const next = key === "Backspace" ? element.value.slice(0, -1) : "";
			if (element instanceof HTMLInputElement) setInputValue(element, next);
			else setTextAreaValue(element, next);
			dispatchValueEvents(element, next);
			return true;
		}
		return false;
	}
	/** Press one allowed key against a referenced element and verify an observable effect. */
	function pressKey(element, key, modifiers, repeat) {
		if (isDisabled(element)) throw new PageActionError("BROWSER_ELEMENT_DISABLED", "the referenced element is disabled");
		element.focus();
		let observed = false;
		for (let index = 0; index < repeat; index += 1) {
			if (dispatchKeySequence(element, key, modifiers)) {
				observed = true;
				if (key === "Enter") submitStandaloneComposer(element);
				continue;
			}
			if (applyKeyDefault(element, key, modifiers)) observed = true;
		}
		if (!observed) throw new PageActionError("BROWSER_CAPABILITY_UNAVAILABLE", "the page did not respond to the synthetic key event; real keyboard input is unavailable without extra permission");
	}
	/**
	* Execute one validated action against an element from the latest page read.
	* @param operation - click, fill, select, scroll, focus, or press operation carrying current page coordinates.
	* @returns confirmation of the completed page effect.
	*/
	function actOnPage(operation) {
		if (operation.kind === "scroll-page") return scrollTarget(operation.pageId, operation.ref, operation.movement);
		const element = resolveElement(operation.pageId, operation.ref);
		switch (operation.kind) {
			case "click-page-element":
				clickElement(element);
				return {
					pageId: operation.pageId,
					ref: operation.ref,
					action: "clicked"
				};
			case "fill-page-element":
				fillElement(element, operation.value, operation.submit);
				return {
					pageId: operation.pageId,
					ref: operation.ref,
					action: "filled"
				};
			case "select-page-option": {
				const value = selectOption(element, operation.value);
				return {
					pageId: operation.pageId,
					ref: operation.ref,
					action: "selected",
					value
				};
			}
			case "focus-page-element":
				focusElement(element);
				return {
					pageId: operation.pageId,
					ref: operation.ref,
					action: "focused"
				};
			case "press-page-key":
				pressKey(element, operation.key, operation.modifiers, operation.repeat);
				return {
					pageId: operation.pageId,
					ref: operation.ref,
					action: "pressed",
					key: operation.key
				};
		}
	}
	//#endregion
	//#region lib/types/extension/page-waiter.js
	/** In-page wait conditions for document change, text, URL, and load stability. */
	/** Stable wait failure that includes the last observed document coordinates. */
	var PageWaitError = class extends Error {
		/** Machine-readable wait timeout code. */
		code = "BROWSER_WAIT_TIMEOUT";
		/** Last observed tab URL. */
		url;
		/** Last observed document identity. */
		documentId;
		/** Last observed document revision. */
		revision;
		/**
		* Create one wait-timeout failure.
		* @param url - last observed location.
		* @param documentId - last observed document identity.
		* @param revision - last observed document revision.
		*/
		constructor(url, documentId, revision) {
			super(`${url} documentId=${documentId} revision=${String(revision)}`);
			this.name = "PageWaitError";
			this.url = url;
			this.documentId = documentId;
			this.revision = revision;
		}
	};
	/** Return whether the current URL satisfies one wait URL condition. */
	function urlMatches(href, value, match) {
		if (match === "exact") return href === value;
		if (match === "prefix") return href.startsWith(value);
		return href.includes(value);
	}
	/** Return normalized visible text used by text wait conditions. */
	function visibleText() {
		return (((document.body.innerText || "").trim() === "" ? document.body.textContent || "" : document.body.innerText) || "").replace(/\s+/g, " ");
	}
	/** Return whether one wait condition currently holds. */
	function conditionHolds(operation) {
		const identity = currentDocumentIdentity();
		const condition = operation.condition;
		if (condition.kind === "change") return identity.documentId !== condition.documentId || identity.revision > condition.afterRevision;
		if (condition.kind === "text") {
			const present = visibleText().includes(condition.text);
			return condition.state === "present" ? present : !present;
		}
		if (condition.kind === "url") return urlMatches(location.href, condition.value, condition.match);
		return document.readyState === "complete";
	}
	/** Wait until no further document revisions occur for the requested quiet period. */
	async function waitUntilStable(stableMs, deadline) {
		if (stableMs <= 0) return;
		let quietSince = Date.now();
		const stopObserving = observeDocumentChanges(() => {
			quietSince = Date.now();
		});
		try {
			while (Date.now() < deadline) {
				await delay(Math.min(50, Math.max(0, deadline - Date.now())));
				if (Date.now() - quietSince >= stableMs) return;
			}
		} finally {
			stopObserving();
		}
	}
	/** Yield for one bounded interval. */
	function delay(ms) {
		return new Promise((resolve) => {
			setTimeout(resolve, ms);
		});
	}
	/**
	* Wait until a page condition holds, then return a fresh snapshot.
	* @param operation - validated wait condition and timeout bounds.
	* @returns a new page snapshot after the condition is observed.
	*/
	async function waitForPage(operation) {
		const deadline = Date.now() + operation.timeoutMs;
		if (operation.condition.kind === "url") {
			window.addEventListener("hashchange", onLocationSignal);
			window.addEventListener("popstate", onLocationSignal);
		}
		try {
			while (Date.now() <= deadline) {
				if (conditionHolds(operation)) {
					if (operation.condition.kind === "ready" || operation.stableMs > 0) {
						await waitUntilStable(operation.stableMs, deadline);
						if (operation.condition.kind !== "ready" && !conditionHolds(operation)) continue;
						if (operation.condition.kind === "ready" && document.readyState !== "complete") continue;
					}
					return readVisiblePage();
				}
				await delay(Math.min(50, Math.max(0, deadline - Date.now())));
			}
		} finally {
			window.removeEventListener("hashchange", onLocationSignal);
			window.removeEventListener("popstate", onLocationSignal);
		}
		const identity = currentDocumentIdentity();
		throw new PageWaitError(location.href, identity.documentId, identity.revision);
	}
	/** Location listeners exist so History API and hash changes wake the wait loop promptly. */
	function onLocationSignal() {}
	//#endregion
	//#region lib/types/extension/page-probe-protocol.js
	/** Shared MAIN-world probe event names and snapshot bounds. */
	/** Isolated-world request asking the MAIN-world probe for its current buffers. */
	const PAGE_PROBE_REQUEST_EVENT = "dsh-page-probe-request";
	/** MAIN-world reply carrying a cloned Network/Console snapshot. */
	const PAGE_PROBE_SNAPSHOT_EVENT = "dsh-page-probe-snapshot";
	//#endregion
	//#region lib/types/extension/page-probe-collector.js
	/** Isolated-world collector that asks the MAIN-world probe for a Network/Console snapshot. */
	/** Empty inspect payload used when the MAIN-world probe did not answer. */
	const UNHOOKED = {
		hooked: false,
		network: [],
		console: [],
		omittedNetwork: 0,
		omittedConsole: 0
	};
	/**
	* Ask the MAIN-world probe for its current buffers.
	* @param mode - whether to start, read, or finish page observation.
	* @param target - window used for CustomEvent exchange.
	* @returns a protocol-valid inspect payload, hooked or not.
	*/
	function collectPageProbe(mode, target = window) {
		const requestId = crypto.randomUUID();
		return new Promise((resolve) => {
			let settled = false;
			/** Deliver one snapshot exactly once. */
			const finish = (content) => {
				if (settled) return;
				settled = true;
				target.removeEventListener(PAGE_PROBE_SNAPSHOT_EVENT, onSnapshot);
				resolve(content);
			};
			/** Accept a MAIN-world snapshot that matches this request. */
			const onSnapshot = (event) => {
				const detail = event.detail;
				if (detail.requestId !== requestId) return;
				finish({
					hooked: true,
					...detail.hookedAt === void 0 ? {} : { hookedAt: detail.hookedAt },
					network: detail.network,
					console: detail.console,
					omittedNetwork: detail.omittedNetwork,
					omittedConsole: detail.omittedConsole
				});
			};
			target.addEventListener(PAGE_PROBE_SNAPSHOT_EVENT, onSnapshot);
			const request = {
				requestId,
				mode
			};
			target.dispatchEvent(new CustomEvent(PAGE_PROBE_REQUEST_EVENT, { detail: request }));
			setTimeout(() => {
				finish(UNHOOKED);
			}, 400);
		});
	}
	const PAGE_ACTION_KINDS = new Set([
		"click-page-element",
		"fill-page-element",
		"select-page-option",
		"scroll-page",
		"focus-page-element",
		"press-page-key"
	]);
	/**
	* Return whether one runtime message is a page-read request.
	* @param message - untrusted content-script runtime message.
	* @returns whether the dedicated read discriminator is present.
	*/
	function isReadPageDomRequest(message) {
		return typeof message === "object" && message !== null && "kind" in message && message.kind === "dsh-read-page";
	}
	/**
	* Return whether one runtime message carries a validated page action.
	* @param message - untrusted content-script runtime message.
	* @returns whether the message contains one supported page action.
	*/
	function isActPageDomRequest(message) {
		if (typeof message !== "object" || message === null || !("kind" in message) || message.kind !== "dsh-act-page" || !("operation" in message) || !isBridgeOperation(message.operation)) return false;
		return PAGE_ACTION_KINDS.has(message.operation.kind);
	}
	/**
	* Return whether one runtime message carries a validated wait request.
	* @param message - untrusted content-script runtime message.
	* @returns whether the message contains one supported wait request.
	*/
	function isWaitPageDomRequest(message) {
		return typeof message === "object" && message !== null && "kind" in message && message.kind === "dsh-wait-page" && "operation" in message && isBridgeWaitPageDomOperation(message.operation);
	}
	/**
	* Return whether one runtime message is a page-inspect request.
	* @param message - untrusted content-script runtime message.
	* @returns whether the dedicated inspect discriminator is present.
	*/
	function isInspectPageDomRequest(message) {
		return typeof message === "object" && message !== null && "kind" in message && message.kind === "dsh-inspect-page" && "mode" in message && (message.mode === "start" || message.mode === "snapshot" || message.mode === "stop");
	}
	/** Map a thrown page-script error onto a stable bridge failure. */
	function failurePayload(error) {
		if (error instanceof PageWaitError) return {
			ok: false,
			error: {
				code: error.code,
				message: `BROWSER_WAIT_TIMEOUT: url=${error.url} documentId=${error.documentId} revision=${String(error.revision)}`
			}
		};
		return {
			ok: false,
			error: {
				code: error instanceof PageActionError ? error.code : "BROWSER_API_FAILED",
				message: error instanceof Error ? error.message : String(error)
			}
		};
	}
	/**
	* Answer page-read, action, wait, and inspect requests from the already-injected content script.
	* @param runtime - content-script runtime messaging API.
	* @param readPage - DOM extractor bound to this document.
	* @param actPage - document-bound page action executor.
	* @param waitPage - in-tab wait executor.
	* @param inspectPage - MAIN-world Network/Console collector.
	* @returns listener disposer.
	*/
	function installPageReader(runtime, readPage, actPage, waitPage, inspectPage) {
		/** Reply to one in-tab read, action, wait, or inspect request. */
		const listener = (message, _sender, sendResponse) => {
			if (!isReadPageDomRequest(message) && !isActPageDomRequest(message) && !isWaitPageDomRequest(message) && !isInspectPageDomRequest(message)) return;
			if (isWaitPageDomRequest(message)) {
				if (waitPage === void 0) {
					sendResponse(failurePayload(/* @__PURE__ */ new Error("browser extension: page waiter is unavailable")));
					return false;
				}
				waitPage(message.operation).then((content) => {
					if (!isBridgePageContent(content)) {
						sendResponse(failurePayload(/* @__PURE__ */ new Error("browser extension: page script returned an invalid result")));
						return;
					}
					sendResponse({
						ok: true,
						content
					});
				}, (error) => {
					sendResponse(failurePayload(error));
				});
				return true;
			}
			if (isInspectPageDomRequest(message)) {
				if (inspectPage === void 0) {
					sendResponse(failurePayload(/* @__PURE__ */ new Error("browser extension: page inspector is unavailable")));
					return false;
				}
				inspectPage(message.mode).then((content) => {
					if (!isBridgePageInspectContent(content)) {
						sendResponse(failurePayload(/* @__PURE__ */ new Error("browser extension: page script returned an invalid inspect result")));
						return;
					}
					sendResponse({
						ok: true,
						content
					});
				}, (error) => {
					sendResponse(failurePayload(error));
				});
				return true;
			}
			try {
				if (isReadPageDomRequest(message)) {
					const content = readPage();
					if (!isBridgePageContent(content)) throw new Error("browser extension: page script returned an invalid result");
					sendResponse({
						ok: true,
						content
					});
				} else {
					if (actPage === void 0) throw new Error("browser extension: page actor is unavailable");
					sendResponse({
						ok: true,
						receipt: actPage(message.operation)
					});
				}
			} catch (error) {
				sendResponse(failurePayload(error));
			}
			return false;
		};
		runtime.onMessage.addListener(listener);
		return () => {
			runtime.onMessage.removeListener(listener);
		};
	}
	//#endregion
	//#region lib/types/extension/page-content.js
	/** MV3 content-script entry that reads the current HTTP(S) page for the side assistant. */
	installPageReader(chrome.runtime, readVisiblePage, actOnPage, waitForPage, collectPageProbe);
	//#endregion
})();
