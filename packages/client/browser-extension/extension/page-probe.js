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
	/** MAIN-world fetch/XHR/console probe. Installed at document_start so later page scripts are wrapped. */
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
	* Render console arguments without throwing on cyclic values.
	* @param args - console arguments.
	* @returns one bounded line.
	*/
	function renderConsoleArgs(args) {
		return clip(args.map((arg) => {
			if (typeof arg === "string") return arg;
			if (arg instanceof Error) return arg.message;
			try {
				return JSON.stringify(arg) ?? String(arg);
			} catch {
				return String(arg);
			}
		}).join(" "));
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
		const method = init?.method ?? request?.method ?? "GET";
		return {
			method: clip(String(method).toUpperCase() || "GET"),
			url: sanitizeUrl(url)
		};
	}
	/** Install the page probe once per document. */
	function installPageProbe(target = globalThis) {
		if (target[INSTALLED] === true) return;
		target[INSTALLED] = true;
		const hookedAt = Date.now();
		const network = [];
		const consoleEntries = [];
		let omittedNetwork = 0;
		let omittedConsole = 0;
		const xhrMeta = /* @__PURE__ */ new WeakMap();
		/**
		* Push one entry into a bounded ring buffer.
		* @param list - destination buffer.
		* @param entry - new observation.
		* @param max - retained count.
		* @param omitted - callback when an older entry is dropped.
		*/
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
		const originalFetch = target.fetch.bind(target);
		target.fetch = async function patchedFetch(input, init) {
			const described = describeFetchInput(input, init);
			const startedAt = Date.now();
			try {
				const response = await originalFetch(input, init);
				recordNetwork({
					at: Date.now(),
					source: "fetch",
					method: described.method,
					url: described.url,
					status: response.status,
					ok: response.ok,
					durationMs: Date.now() - startedAt
				});
				return response;
			} catch (error) {
				recordNetwork({
					at: Date.now(),
					source: "fetch",
					method: described.method,
					url: described.url,
					durationMs: Date.now() - startedAt,
					error: clip(error instanceof Error ? error.message : String(error))
				});
				throw error;
			}
		};
		const originalOpen = XMLHttpRequest.prototype.open;
		const originalSend = XMLHttpRequest.prototype.send;
		XMLHttpRequest.prototype.open = function patchedOpen(method, url, ...rest) {
			xhrMeta.set(this, {
				method: clip(String(method).toUpperCase() || "GET"),
				url: sanitizeUrl(String(url)),
				startedAt: 0
			});
			originalOpen.apply(this, [
				method,
				url,
				...rest
			]);
		};
		XMLHttpRequest.prototype.send = function patchedSend(body) {
			const meta = xhrMeta.get(this);
			if (meta !== void 0) meta.startedAt = Date.now();
			this.addEventListener("loadend", () => {
				if (meta === void 0) return;
				const failed = this.status === 0 && this.readyState === XMLHttpRequest.DONE;
				recordNetwork({
					at: Date.now(),
					source: "xhr",
					method: meta.method,
					url: meta.url,
					...failed ? {} : {
						status: this.status,
						ok: this.status >= 200 && this.status < 300
					},
					durationMs: Date.now() - meta.startedAt,
					...failed ? { error: clip(this.statusText || "network error") } : {}
				});
			});
			originalSend.call(this, body);
		};
		for (const level of [
			"log",
			"info",
			"warn",
			"error",
			"debug"
		]) {
			const original = target.console[level].bind(target.console);
			target.console[level] = (...args) => {
				recordConsole(level, renderConsoleArgs(args));
				original(...args);
			};
		}
		target.addEventListener("error", (event) => {
			recordConsole("error", clip(event.message || "uncaught error"));
		});
		target.addEventListener("unhandledrejection", (event) => {
			recordConsole("error", clip(`unhandledrejection ${event.reason instanceof Error ? event.reason.message : String(event.reason)}`));
		});
		target.addEventListener(PAGE_PROBE_REQUEST_EVENT, (event) => {
			const detail = event.detail;
			const snapshot = {
				requestId: typeof detail?.requestId === "string" ? detail.requestId : "",
				hooked: true,
				hookedAt,
				network: network.slice(),
				console: consoleEntries.slice(),
				omittedNetwork,
				omittedConsole
			};
			target.dispatchEvent(new CustomEvent(PAGE_PROBE_SNAPSHOT_EVENT, { detail: snapshot }));
			if (detail?.reset === true) {
				network.length = 0;
				consoleEntries.length = 0;
				omittedNetwork = 0;
				omittedConsole = 0;
			}
		});
	}
	installPageProbe();
	//#endregion
	exports.installPageProbe = installPageProbe;
	return exports;
})({});
