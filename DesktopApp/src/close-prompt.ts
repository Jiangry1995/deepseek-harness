import { BrowserWindow } from 'electron'
import { parseClosePromptChoice, type CloseBehavior } from './close-behavior.js'

/** 关闭询问页里等用户点按钮或按 Esc。 */
const CLOSE_PROMPT_WAIT_SCRIPT = `new Promise((resolve) => {
  const done = (choice) => resolve(choice)
  for (const button of document.querySelectorAll('[data-choice]')) {
    button.addEventListener('click', () => done(button.getAttribute('data-choice')))
  }
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') done('cancel')
  })
})`

/** 弹出与 Harness 同风格的关闭询问卡，避免系统原生对话框。 */
export async function promptWindowClose(
  parent: BrowserWindow,
  htmlPath: string,
): Promise<CloseBehavior> {
  const prompt = new BrowserWindow({
    parent,
    modal: true,
    show: false,
    width: 440,
    height: 248,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    autoHideMenuBar: true,
    skipTaskbar: true,
    frame: false,
    backgroundColor: '#ffffff',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  prompt.setMenuBarVisibility(false)
  await prompt.loadFile(htmlPath)
  prompt.show()
  prompt.focus()
  let settled = false
  const choice = await new Promise<CloseBehavior>((resolve) => {
    const finish = (value: CloseBehavior) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    prompt.once('closed', () => { finish('cancel') })
    void prompt.webContents.executeJavaScript(CLOSE_PROMPT_WAIT_SCRIPT, true).then(
      (raw: unknown) => { finish(parseClosePromptChoice(raw)) },
      () => { finish('cancel') },
    )
  })
  if (!prompt.isDestroyed()) prompt.close()
  return choice
}
