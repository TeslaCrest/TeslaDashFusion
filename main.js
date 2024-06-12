const treeKill = require("tree-kill")
const { app, BrowserWindow, dialog, ipcMain } = require("electron")
const path = require("path")
const { spawn } = require("child_process")

const VideoCombiner = require("./combineVideos")
let combiner = null // Keep a reference accessible for cancellation

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1024,
    height: 768,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: true,
      contextIsolation: false,
    },
  })

  mainWindow.loadFile("index.html")
  //   mainWindow.webContents.openDevTools();
}

app.whenReady().then(createWindow)

app.on("before-quit", () => {
  if (combiner !== null) {
    combiner.cancelOperation() // Call the function to set the cancellation flag
    console.log("Cancellation requested")
  }
})

ipcMain.handle('open-folder-dialog', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory', 'multiSelections']
  })
  return result.filePaths
})

ipcMain.handle("open-folder-dialog-export", async () => {
  const result = await dialog.showOpenDialog({ properties: ["openDirectory"] })
  return result.filePaths[0] // Return the selected directory path
})

ipcMain.on(
  "launch-script",
  async (
    event,
    folderPath,
    folderExportPath,
    selectedFilter,
    concurrencyLimit
  ) => {
    combiner = new VideoCombiner()

    combiner.on("message", (msg) => {
      console.log(msg)
      event.sender.send("message", msg)
    })

    try {
      await combiner.mainFunction(
        folderPath,
        folderExportPath,
        selectedFilter,
        concurrencyLimit
      )
      event.sender.send("script-output", "Process completed successfully")
    } catch (error) {
      console.error("Error during script execution", error)
      event.sender.send("script-output", `Error: ${error.message}`)
    }
  }
)

ipcMain.on("stop-script", () => {
  if (combiner) {
    combiner.cancelOperation()
    combiner = null // Optionally reset the reference
  }
})
