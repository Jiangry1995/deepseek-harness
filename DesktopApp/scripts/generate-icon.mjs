import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow } from 'electron'

const desktopRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const resources = join(desktopRoot, 'resources')

/** 把 PNG 包进最简 ICO 容器，供 Windows 快捷方式使用。 */
function wrapPngAsIco(png) {
  const header = Buffer.alloc(22)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(1, 4)
  header.writeUInt16LE(1, 10)
  header.writeUInt16LE(32, 12)
  header.writeUInt32LE(png.length, 14)
  header.writeUInt32LE(header.length, 18)
  return Buffer.concat([header, png])
}

app.disableHardwareAcceleration()
void app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false })
  try {
    const svg = await readFile(join(resources, 'icon.svg'))
    const source = `data:image/svg+xml;base64,${svg.toString('base64')}`
    await window.loadURL('data:text/html,<canvas id="icon" width="256" height="256"></canvas>')
    const dataUrl = await window.webContents.executeJavaScript(`
      new Promise((resolve, reject) => {
        const image = new Image()
        image.onload = () => {
          const canvas = document.getElementById('icon')
          canvas.getContext('2d').drawImage(image, 0, 0, 256, 256)
          resolve(canvas.toDataURL('image/png'))
        }
        image.onerror = () => reject(new Error('Could not decode resources/icon.svg'))
        image.src = ${JSON.stringify(source)}
      })
    `)
    const png = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64')
    await Promise.all([
      writeFile(join(resources, 'icon.png'), png),
      writeFile(join(resources, 'icon.ico'), wrapPngAsIco(png)),
    ])
    app.exit(0)
  } catch (error) {
    console.error(error)
    app.exit(1)
  } finally {
    window.destroy()
  }
})
