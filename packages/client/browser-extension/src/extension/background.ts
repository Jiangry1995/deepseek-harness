/** MV3 Service Worker entry for DSH browser tab operations. */

import { installBackground } from './runtime.ts'

installBackground(chrome.runtime, chrome.tabs, chrome.scripting, chrome.sidePanel)
