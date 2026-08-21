(function(exports) {
	Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
	//#region lib/types/extension/page-probe-protocol.js
	/** Shared MAIN-world probe event names and snapshot bounds. */
	/** Isolated-world request asking the MAIN-world probe for its current buffers. */
	const PAGE_PROBE_REQUEST_EVENT = "dsh-page-probe-request";
	/** MAIN-world reply carrying a cloned Network/Console snapshot. */
	const PAGE_PROBE_SNAPSHOT_EVENT = "dsh-page-probe-snapshot";
	//#endregion
	//#region lib/types/extension/page-probe.js
	/** Dormant MAIN-world controller for short-lived fetch/XHR/console observation. */
	const INSTALLED = "__dshPageProbeInstalled";
	/** ASCII placeholder so URL encoding does not turn the redaction into `%E2%80%A6`. */
	const REDACTED_QUERY_VALUE = "__redacted__";
	/**
	* Truncate one string to the inspect text budget.
	* @param value - raw text.
	* @returns a bounded string.
	*/
	function clip(value) {
		return value.length <= 500 ? value : value.slice(0, 500);
	}
	/**
	* Convert one diagnostic value without enumerating page-owned objects.
	* @param value - console argument, rejection reason, or fetch error.
	* @returns bounded primitive text or a fixed object category.
	*/
	function inspectValue(value) {
		if (value === null) return "null";
		switch (typeof value) {
			case "string": return clip(value);
			case "undefined": return "undefined";
			case "boolean": return value ? "true" : "false";
			case "number": return String(value);
			case "bigint": return `${String(value)}n`;
			case "symbol": return clip(String(value));
			case "function": return "[Function]";
			case "object":
				try {
					if (value instanceof Error) try {
						return clip(`${value.name || "Error"}: ${value.message}`);
					} catch {
						return "[Error]";
					}
				} catch {
					return "[Object]";
				}
				try {
					return Array.isArray(value) ? "[Array]" : "[Object]";
				} catch {
					return "[Object]";
				}
		}
		return "[Unknown]";
	}
	/**
	* Render console arguments without retaining or traversing page-owned objects.
	* @param args - console arguments.
	* @returns one bounded line.
	*/
	function renderConsoleArgs(args) {
		return clip(args.map(inspectValue).join(" "));
	}
	/**
	* Strip credentials and obvious secret query parameters from a request URL.
	* @param raw - request URL, possibly relative.
	* @returns a bounded sanitized absolute or original URL.
	*/
	function sanitizeUrl(raw) {
		try {
			const url = new URL(raw, location.href);
			url.username = "";
			url.password = "";
			for (const key of [...url.searchParams.keys()]) if (/(token|secret|password|passwd|pwd|authorization|signature|access_token)/i.test(key)) url.searchParams.set(key, REDACTED_QUERY_VALUE);
			return clip(url.href);
		} catch {
			return clip(raw);
		}
	}
	/**
	* Resolve fetch() input into a method and URL without reading the body.
	* @param input - fetch resource.
	* @param init - optional fetch init.
	* @returns method and sanitized URL.
	*/
	function describeFetchInput(input, init) {
		const request = input instanceof Request ? input : void 0;
		const url = typeof input === "string" ? input : request?.url ?? (typeof input === "object" && input !== null && "url" in input ? String(input.url) : String(input));
		return {
			method: clip((init?.method ?? request?.method ?? "GET").toUpperCase() || "GET"),
			url: sanitizeUrl(url)
		};
	}
	/**
	* Install one dormant page-probe controller for the current document.
	* @param target - MAIN-world global whose page APIs are observed during an active capture.
	*/
	function installPageProbe(target = globalThis) {
		if (target[INSTALLED] === true) return;
		target[INSTALLED] = true;
		const network = [];
		const consoleEntries = [];
		const xhrMeta = /* @__PURE__ */ new WeakMap();
		let omittedNetwork = 0;
		let omittedConsole = 0;
		let hookedAt;
		let captureGeneration = 0;
		let active = false;
		let installation;
		/** Push one entry into a bounded ring buffer. */
		function push(list, entry, max, omitted) {
			list.push(entry);
			while (list.length > max) {
				list.shift();
				omitted();
			}
		}
		/** Record one completed or failed network call. */
		function recordNetwork(entry) {
			push(network, entry, 40, () => {
				omittedNetwork += 1;
			});
		}
		/** Record one console or uncaught-error line. */
		function recordConsole(level, text) {
			push(consoleEntries, {
				at: Date.now(),
				level,
				text: clip(text)
			}, 40, () => {
				omittedConsole += 1;
			});
		}
		/** Clear retained observations before a new capture session. */
		function clear() {
			network.length = 0;
			consoleEntries.length = 0;
			omittedNetwork = 0;
			omittedConsole = 0;
		}
		/** Record one uncaught page error while capture is active. */
		function onError(event) {
			if (!active) return;
			recordConsole("error", clip(event.message || "uncaught error"));
		}
		/** Record one unhandled rejection while capture is active. */
		function onUnhandledRejection(event) {
			if (!active) return;
			recordConsole("error", clip(`unhandledrejection ${inspectValue(event.reason)}`));
		}
		/** Start a fresh capture and install wrappers around the methods currently owned by the page. */
		function start() {
			if (active) stop();
			clear();
			captureGeneration += 1;
			hookedAt = Date.now();
			active = true;
			const generation = captureGeneration;
			const originalFetch = target.fetch;
			const patchedFetch = function patchedFetch(input, init) {
				if (!active || generation !== captureGeneration) return Reflect.apply(originalFetch, target, [input, init]);
				const described = describeFetchInput(input, init);
				const startedAt = Date.now();
				return Reflect.apply(originalFetch, target, [input, init]).then((response) => {
					if (active && generation === captureGeneration) recordNetwork({
						at: Date.now(),
						source: "fetch",
						method: described.method,
						url: described.url,
						status: response.status,
						ok: response.ok,
						durationMs: Date.now() - startedAt
					});
					return response;
				}, (error) => {
					if (active && generation === captureGeneration) recordNetwork({
						at: Date.now(),
						source: "fetch",
						method: described.method,
						url: described.url,
						durationMs: Date.now() - startedAt,
						error: inspectValue(error)
					});
					throw error;
				});
			};
			const Xhr = target.XMLHttpRequest;
			const originalOpen = Xhr.prototype.open;
			const originalSend = Xhr.prototype.send;
			const patchedOpen = function patchedOpen(method, url, ...rest) {
				if (active && generation === captureGeneration) xhrMeta.set(this, {
					method: clip(method.toUpperCase() || "GET"),
					url: sanitizeUrl(String(url))
				});
				originalOpen.apply(this, [
					method,
					url,
					...rest
				]);
			};
			const patchedSend = function patchedSend(body) {
				const described = active && generation === captureGeneration ? xhrMeta.get(this) : void 0;
				if (described !== void 0) {
					const startedAt = Date.now();
					this.addEventListener("loadend", () => {
						if (!active || generation !== captureGeneration) return;
						const failed = this.status === 0 && this.readyState === XMLHttpRequest.DONE;
						recordNetwork({
							at: Date.now(),
							source: "xhr",
							method: described.method,
							url: described.url,
							...failed ? {} : {
								status: this.status,
								ok: this.status >= 200 && this.status < 300
							},
							durationMs: Date.now() - startedAt,
							...failed ? { error: clip(this.statusText || "network error") } : {}
						});
					}, { once: true });
				}
				originalSend.call(this, body);
			};
			const consolePatches = [];
			for (const level of [
				"log",
				"info",
				"warn",
				"error",
				"debug"
			]) {
				const original = target.console[level];
				const patched = (...args) => {
					Reflect.apply(original, target.console, args);
					if (!active || generation !== captureGeneration) return;
					try {
						recordConsole(level, renderConsoleArgs(args));
					} catch {}
				};
				consolePatches.push({
					level,
					original,
					patched
				});
				target.console[level] = patched;
			}
			installation = {
				originalFetch,
				patchedFetch,
				originalOpen,
				patchedOpen,
				originalSend,
				patchedSend,
				consolePatches
			};
			target.fetch = patchedFetch;
			Xhr.prototype.open = patchedOpen;
			Xhr.prototype.send = patchedSend;
			target.addEventListener("error", onError);
			target.addEventListener("unhandledrejection", onUnhandledRejection);
		}
		/** Stop capture and restore only methods still owned by this controller. */
		function stop() {
			if (!active) return;
			active = false;
			target.removeEventListener("error", onError);
			target.removeEventListener("unhandledrejection", onUnhandledRejection);
			if (installation === void 0) return;
			if (target.fetch === installation.patchedFetch) target.fetch = installation.originalFetch;
			const Xhr = target.XMLHttpRequest;
			if (Xhr.prototype.open === installation.patchedOpen) Xhr.prototype.open = installation.originalOpen;
			if (Xhr.prototype.send === installation.patchedSend) Xhr.prototype.send = installation.originalSend;
			for (const patch of installation.consolePatches) if (target.console[patch.level] === patch.patched) target.console[patch.level] = patch.original;
			installation = void 0;
		}
		/** Build one immutable response from the current observation state. */
		function snapshot(requestId) {
			return {
				requestId,
				hooked: true,
				...hookedAt === void 0 ? {} : { hookedAt },
				network: network.slice(),
				console: consoleEntries.slice(),
				omittedNetwork,
				omittedConsole
			};
		}
		target.addEventListener(PAGE_PROBE_REQUEST_EVENT, (event) => {
			const detail = event.detail;
			const requestId = typeof detail === "object" && detail !== null && "requestId" in detail && typeof detail.requestId === "string" ? detail.requestId : "";
			const mode = typeof detail === "object" && detail !== null && "mode" in detail ? detail.mode : void 0;
			if (mode === "start") start();
			if (mode === "stop") stop();
			target.dispatchEvent(new CustomEvent(PAGE_PROBE_SNAPSHOT_EVENT, { detail: snapshot(requestId) }));
		});
	}
	installPageProbe();
	//#endregion
	exports.installPageProbe = installPageProbe;
	return exports;
})({});
