import type { UserConfig } from 'tsdown'
import { clientBundle } from '../tsdown.client.ts'

const background: UserConfig = {
  name: '@deepseek-ai/dsh-client-browser-extension/background',
  entry: { background: 'lib/types/extension/background.js' },
  outDir: 'extension',
  format: ['esm'],
  platform: 'browser',
  target: 'es2022',
  dts: false,
  clean: false,
  noExternal: true,
  outputOptions: { entryFileNames: 'background.js' },
}

const pageProbe: UserConfig = {
  name: '@deepseek-ai/dsh-client-browser-extension/page-probe',
  entry: { 'page-probe': 'lib/types/extension/page-probe.js' },
  outDir: 'extension',
  format: ['iife'],
  platform: 'browser',
  target: 'es2022',
  dts: false,
  clean: false,
  noExternal: true,
  outputOptions: { entryFileNames: 'page-probe.js' },
}

const pageContent: UserConfig = {
  name: '@deepseek-ai/dsh-client-browser-extension/page-content',
  entry: { 'page-content': 'lib/types/extension/page-content.js' },
  outDir: 'extension',
  format: ['iife'],
  platform: 'browser',
  target: 'es2022',
  dts: false,
  clean: false,
  noExternal: true,
  outputOptions: { entryFileNames: 'page-content.js' },
}

const content: UserConfig = {
  name: '@deepseek-ai/dsh-client-browser-extension/content',
  entry: { content: 'lib/types/extension/content.js' },
  outDir: 'extension',
  format: ['iife'],
  platform: 'browser',
  target: 'es2022',
  dts: false,
  clean: false,
  noExternal: true,
  outputOptions: { entryFileNames: 'content.js' },
}

const sidepanel: UserConfig = {
  name: '@deepseek-ai/dsh-client-browser-extension/sidepanel',
  entry: { sidepanel: 'lib/types/extension/sidepanel.js' },
  outDir: 'extension',
  format: ['esm'],
  platform: 'browser',
  target: 'es2022',
  dts: false,
  clean: false,
  noExternal: true,
  outputOptions: { entryFileNames: 'sidepanel.js' },
}

export default clientBundle(
  '@deepseek-ai/dsh-client-browser-extension',
  ['lib/types/index.js', 'lib/types/invariant.js'],
  { companions: [background, content, pageProbe, pageContent, sidepanel] },
)
