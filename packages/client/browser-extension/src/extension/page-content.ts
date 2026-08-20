/** MV3 content-script entry that reads the current HTTP(S) page for the side assistant. */

import { readVisiblePage } from './page-reader.ts'
import { actOnPage } from './page-actor.ts'
import { waitForPage } from './page-waiter.ts'
import { collectPageProbe } from './page-probe-collector.ts'
import { installPageReader } from './page-content-runtime.ts'

installPageReader(chrome.runtime, readVisiblePage, actOnPage, waitForPage, collectPageProbe)
