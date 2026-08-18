/**
 * Client chrome surface. The browser side-panel iframe tags itself with
 * `dsh-surface=side-panel` (see the extension's sidepanel-runtime); a normal
 * web window has no such query and stays on the desktop three-column shell.
 */

/** Query key the side-panel iframe sets on the Harness Web UI URL. */
export const CLIENT_SURFACE_QUERY = 'dsh-surface'

/** Value that marks the Chrome side-panel iframe, as opposed to the desktop app. */
export const SIDE_PANEL_SURFACE = 'side-panel'

/** Rendering surface the shell can branch on. */
export type ClientSurface = 'desktop' | 'side-panel'

/**
 * Read the chrome surface from a URL search string.
 * Only an exact `dsh-surface=side-panel` pair selects the side panel; any
 * other value (or a missing key) stays on the desktop shell so a narrow
 * desktop window does not inherit the plugin layout.
 * @param search - `window.location.search` (leading `?` optional).
 * @returns `'side-panel'` when the query says so, otherwise `'desktop'`.
 */
export function readClientSurface(search: string = window.location.search): ClientSurface {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  return params.get(CLIENT_SURFACE_QUERY) === SIDE_PANEL_SURFACE ? 'side-panel' : 'desktop'
}
