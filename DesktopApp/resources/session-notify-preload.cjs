'use strict'

const { ipcRenderer } = require('electron')

const IDLE_CHANNEL = 'dsh-session-idle'
const BUSY_SELECTOR = '[data-state="ongoing"], [data-state="running"]'

let previousBusy = 0
let idleTimer = null

/** 统计当前页面里仍在执行的会话/工具指示。 */
function countBusy() {
  return document.querySelectorAll(BUSY_SELECTOR).length
}

/** 忙碌变为空闲后稍等一帧，避免 React 重绘造成误报。 */
function onDomChanged() {
  const nextBusy = countBusy()
  if (previousBusy > 0 && nextBusy === 0) {
    clearTimeout(idleTimer)
    idleTimer = setTimeout(() => {
      idleTimer = null
      if (countBusy() !== 0) return
      ipcRenderer.send(IDLE_CHANNEL, { title: document.title })
    }, 400)
  }
  if (nextBusy > 0) {
    clearTimeout(idleTimer)
    idleTimer = null
  }
  previousBusy = nextBusy
}

/** 监听会话状态点，任务结束后通知主进程。 */
function watchSessionIdle() {
  onDomChanged()
  const observer = new MutationObserver(onDomChanged)
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['data-state'],
  })
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', watchSessionIdle, { once: true })
} else {
  watchSessionIdle()
}
