/** MV3 content-script entry for the DSH loopback Web Client bridge. */

import { installContentBridge } from './content-runtime.ts'

installContentBridge(window, chrome.runtime)
