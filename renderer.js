const { ipcRenderer } = require("electron")

// Listen for script output
ipcRenderer.on("message", (event, message) => {
  // Logic to handle the message
  const outputElement = document.getElementById("script-output")
  outputElement.innerHTML += message + "<br>" // Adjust as needed
})

// Assuming you have stored the selected folder path in a variable
let selectedFolderPath = ""

document
  .getElementById("choose-folder")
  .addEventListener("click", async () => {
    const paths = await ipcRenderer.invoke("open-folder-dialog")
    document.getElementById("selected-folder").innerText = 
      `Selected Folders:\n ${paths.join('\n')}`
    selectedFolderPath = paths
  })

// Assuming you have stored the selected folder path in a variable
let selectedFolderPathExport = ""

document
  .getElementById("choose-folder-export")
  .addEventListener("click", async () => {
    const path = await ipcRenderer.invoke("open-folder-dialog-export")
    document.getElementById(
      "selected-folder-export"
    ).innerText = `Selected Folder: ${path}`
    selectedFolderPathExport = path
  })

document.getElementById("launch").addEventListener("click", () => {
  // Get the selected folder path
  const selectedFolderPathValidation =
    document.getElementById("selected-folder").textContent // Adjust based on how you show the selected folder path
  const selectedFolderPathExportValidation =
    document.getElementById("selected-folder-export").textContent // Adjust based on how you show the selected folder path
  // Get the selected filters
  const selectedFilters = Array.from(
    document.querySelectorAll(".filter-option:checked")
  ).map((checkbox) => checkbox.value)
  // Get the duration trim
  const trimduration = document.getElementById("trimduration").value
  // Get the concurrency limit
  const concurrencyLimit = document.getElementById("concurrencyLimit").value

  // Validation
  if (
    !selectedFolderPathValidation ||
    selectedFolderPathValidation.includes("No folder selected")
  ) {
    // Adjust the condition based on your implementation
    alert("Please select a source folder.")
    return
  }
  if (
    !selectedFolderPathExportValidation ||
    selectedFolderPathExportValidation.includes("No folder selected")
  ) {
    // Adjust the condition based on your implementation
    alert("Please select a destination folder.")
    return
  }
  if (selectedFilters.length === 0) {
    alert("Please select at least one filter.")
    return
  }
  if (
    !concurrencyLimit ||
    isNaN(concurrencyLimit) ||
    parseInt(concurrencyLimit, 10) < 1
  ) {
    alert("Please set a valid concurrency limit (a number greater than 0).")
    return
  }

  // If all validations pass, send the data to the main process
  ipcRenderer.send(
    "launch-script",
    selectedFolderPath,
    selectedFolderPathExport,
    selectedFilters.join(","),
    concurrencyLimit,
    trimduration
  )
})

document.getElementById("stop").addEventListener("click", () => {
  ipcRenderer.send("stop-script")
})
