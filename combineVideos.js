const EventEmitter = require("events")
const ffmpeg = require("fluent-ffmpeg")
const ffmpegStatic = require("ffmpeg-static")
const fs = require("fs")
const path = require("path")
const isPackaged = require("electron").app.isPackaged

const twoxtwo = `
      [1:v][0:v][2:v][3:v]xstack=inputs=4:layout=0_0|w0_0|0_h0|w0_h0
      `
const backbig = `
        [0:v]scale=1280:960[v0];
        [1:v]scale=426:320[v1];
        [2:v]scale=426:320[v2];
        [3:v]scale=426:320[v3];
        [v0][v2][v1][v3]xstack=inputs=4:layout=0_0|0_960|426_960|852_960
      `
const frontbig = `
      [0:v]scale=426:320[v0];
      [1:v]scale=1280:960[v1];
      [2:v]scale=426:320[v2];
      [3:v]scale=426:320[v3];
      [v1][v2][v0][v3]xstack=inputs=4:layout=0_0|0_960|426_960|852_960
    `
const leftbig = `
        [0:v]scale=426:320[v0];
        [1:v]scale=426:320[v1];
        [2:v]scale=1280:960[v2];
        [3:v]scale=426:320[v3];
        [v2][v1][v0][v3]xstack=inputs=4:layout=0_0|0_960|426_960|852_960
      `
const rightbig = `
        [0:v]scale=426:320[v0];
        [1:v]scale=426:320[v1];
        [2:v]scale=426:320[v2];
        [3:v]scale=1280:960[v3];
        [v3][v1][v0][v2]xstack=inputs=4:layout=0_0|0_960|426_960|852_960
        `

class VideoCombiner extends EventEmitter {
  constructor() {
    super()
    this.ffmpeg = ffmpeg
    const lastSlashIndex = Math.max(
      ffmpegStatic.lastIndexOf("/"),
      ffmpegStatic.lastIndexOf("\\")
    )
    const ffmpegPath = isPackaged
      ? path.join(
          process.resourcesPath,
          "app.asar.unpacked",
          "node_modules",
          "ffmpeg-static",
          ffmpegStatic.substring(lastSlashIndex + 1)
        )
      : ffmpegStatic

    this.ffmpeg.setFfmpegPath(ffmpegPath)
    this.isCancelled = false // Flag to track cancellation
    this.videosDir = "" // The first argument is the directory path
    this.combinedDir = ""
    this.logFilePath = ""
    this.concatenedDir = ""
    this.selectedFilter = ""
  }
  // Log method for writing messages to the log file
  log(message) {
    const timestamp = new Date().toISOString()
    const logMessage = `[${timestamp}] ${message}\n`
    console.log(logMessage) // Optional: also output to console
    this.logStream.write(logMessage)
  }
  // Ensure to close the logStream when done
  closeLog() {
    this.log("Closing log stream")
    this.logStream.end()
  }
  // Helper method to check for cancellation
  checkCancellation() {
    if (this.isCancelled) {
      throw new Error("Operation cancelled")
    }
  }

  // Method to initiate cancellation
  cancelOperation() {
    this.isCancelled = true
    this.emptyDirectory(this.combinedDir)
    this.emit(
      "message",
      "Treatment operation cancelled. Processing will stop after the current subfolder is completed."
    )
    this.log("Operation cancelled")
    this.closeLog()
  }

  // Generates a unique filename for temporary usage
  generateFilename() {
    const now = new Date()
    const timestamp = now.toISOString().replace(/[^0-9]/g, "")
    return `file_${timestamp}.txt`
  }

  // Function to test if a string contains a specific number
  containsNumber(testString, number) {
    const numbersArray = testString.split(",").map(Number) // Convert to array of numbers
    return numbersArray.includes(number)
  }

  // Function to concatenate videos
  async concatenateVideos(videoPaths, outputPath) {
    this.checkCancellation() // Check for cancellation at the start
    // Sort videoPaths by file names in ascending order
    videoPaths.sort((a, b) => {
      // Extract file names from paths
      const fileNameA = path.basename(a)
      const fileNameB = path.basename(b)
      // Use localeCompare to compare the file names
      return fileNameA.localeCompare(fileNameB)
    })
    return new Promise((resolve, reject) => {
      const fileListPath = path.join(this.concatenedDir, this.generateFilename())
      const fileListContent = videoPaths
        .map((file) => `file '${file}'`)
        .join("\n")
      fs.writeFileSync(fileListPath, fileListContent)

      const self = this

      this.ffmpeg()
        .input(fileListPath)
        .inputOptions(["-f concat", "-safe 0"])
        .output(outputPath)
        .outputOptions("-c copy")
        .on("error", (err) => {
          console.error("Error:", err)
          reject(err)
        })
        .on("end", () => {
          fs.unlinkSync(fileListPath) // Clean up the temporary file list
          resolve(outputPath)
          self.emit("message", `Concatenation completed: ${outputPath}`)
          self.log(`Concatenation completed: ${outputPath}`)
        })
        .run()
    })
  }

  async listSubfolders(directory) {
    this.checkCancellation()
    const items = await fs.promises.readdir(directory, {
      withFileTypes: true,
    })
    const subfolders = items
      .filter((item) => item.isDirectory())
      .map((item) => path.join(directory, item.name))
      .sort()
      .reverse() // Sort names in descending order
    return subfolders
  }

  async checkProcessedMarker(subfolder, filterNumber) {
    this.checkCancellation()
    const markerFilePath = path.join(
      subfolder,
      ".processed_" + filterNumber
    )
    try {
      await fs.promises.access(markerFilePath)
      return true // File exists
    } catch {
      return false // File does not exist
    }
  }

  async processVideosInSubfolder(subfolder) {
    this.checkCancellation()
    this.emit("message", `Starting processing for subfolder: ${subfolder}`)
    this.log(`Starting processing for subfolder: ${subfolder}`)
    let files = await fs.promises.readdir(subfolder)

    // Filter out non-.mp4 files
    files = files.filter((file) => path.extname(file).toLowerCase() === ".mp4")


    if (files.length < 4) {
      this.emit(
        "message",
        `Not enough videos found in ${subfolder}, this app requires at least one video file per camera.\n`
      )
      this.log(`Not enough videos found in ${subfolder}\n`)
    } else {
      // Organize files by timestamp
      let filesByTimestamp = files.reduce((acc, file) => {
        const dateTimeCamera = file.split("-").slice(0, -1).join("-") // Assuming format "YYYY-MM-DD_HH-MM-SS-camera_id"
        if (!acc[dateTimeCamera]) acc[dateTimeCamera] = []
        acc[dateTimeCamera].push(path.join(subfolder, file))
        return acc
      }, {})


      let combinedVideosPathstwoxtwo = []
      let combinedVideosPathsfrontbig = []
      let combinedVideosPathsbackbig = []
      let combinedVideosPathsleftbig = []
      let combinedVideosPathsrightbig = []

      const isProcessedtwoxtwo = await this.checkProcessedMarker(subfolder, "2x2")
      const isProcessedfrontbig = await this.checkProcessedMarker(subfolder, "frontbig")
      const isProcessedbackbig = await this.checkProcessedMarker(subfolder, "backbig")
      const isProcessedleftbig = await this.checkProcessedMarker(subfolder, "leftbig")
      const isProcessedrightbig = await this.checkProcessedMarker(subfolder, "rightbig")
      // Method to dynamically check each filter based on this.selectedFilter

      const filterNumbers = this.selectedFilter.split(",")

      const filterNames = ["2x2", "frontbig", "backbig", "leftbig", "rightbig"];

      let allFiltersProcessed = true
      for (const number of filterNumbers) {
        if ((await this.checkProcessedMarker(subfolder, filterNames[number])) === false) {
          // If any filter is not processed, return false
          allFiltersProcessed = false
          break
        }
      }

      if (allFiltersProcessed) {
        this.log(
          subfolder +
            " has already been processed for all selected filters. Skipping."
        )
        this.emit(
          "message",
          "Subfolder " +
            subfolder +
            " has already been processed for all selected filters. Skipping."
        )
      } else {
        for (const dateTimeCamera in filesByTimestamp) {
          this.checkCancellation()
          const inputs = filesByTimestamp[dateTimeCamera]

          // Check if all files in inputs exist
          let allFilesExist = true
          for (const inputFile of inputs) {
            if (!fs.existsSync(inputFile)) {
              console.log(
                `File does not exist: ${inputFile}, skipping ${dateTimeCamera}`
              )
              allFilesExist = false
              break // Exit the loop for checking files as soon as a missing file is found
            }
          }

          // If not all files exist, skip to the next iteration of the dateTimeCamera loop
          if (!allFilesExist || inputs.length < 4) {
            continue
          }

          const outputPathtwoxtwo = path.join(
            this.combinedDir,
            `combined_${dateTimeCamera}_2x2.mp4`
          )
          const outputPathfrontbig = path.join(
            this.combinedDir,
            `combined_${dateTimeCamera}_frontbig.mp4`
          )
          const outputPathbackbig = path.join(
            this.combinedDir,
            `combined_${dateTimeCamera}_backbig.mp4`
          )
          const outputPathleftbig = path.join(
            this.combinedDir,
            `combined_${dateTimeCamera}_leftbig.mp4`
          )
          const outputPathrightbig = path.join(
            this.combinedDir,
            `combined_${dateTimeCamera}_rightbig.mp4`
          )

          combinedVideosPathstwoxtwo.push(outputPathtwoxtwo)
          combinedVideosPathsfrontbig.push(outputPathfrontbig)
          combinedVideosPathsbackbig.push(outputPathbackbig)
          combinedVideosPathsleftbig.push(outputPathleftbig)
          combinedVideosPathsrightbig.push(outputPathrightbig)

          if (
            !isProcessedtwoxtwo &&
            this.containsNumber(this.selectedFilter, 1)
          ) {
            await this.combineVideos(inputs, outputPathtwoxtwo, twoxtwo)
          } else if (this.containsNumber(this.selectedFilter, 1)) {
            this.log(
              subfolder + " has already been processed for filter 1. Skipping."
            )
          }

          if (
            !isProcessedfrontbig &&
            this.containsNumber(this.selectedFilter, 2)
          ) {
            await this.combineVideos(inputs, outputPathfrontbig, frontbig)
          } else if (this.containsNumber(this.selectedFilter, 2)) {
            this.log(
              subfolder + " has already been processed for filter 2. Skipping."
            )
          }

          if (
            !isProcessedbackbig &&
            this.containsNumber(this.selectedFilter, 3)
          ) {
            await this.combineVideos(inputs, outputPathbackbig, backbig)
          } else if (this.containsNumber(this.selectedFilter, 3)) {
            this.log(
              subfolder + " has already been processed for filter 3. Skipping."
            )
          }

          if (
            !isProcessedleftbig &&
            this.containsNumber(this.selectedFilter, 4)
          ) {
            await this.combineVideos(inputs, outputPathleftbig, leftbig)
          } else if (this.containsNumber(this.selectedFilter, 4)) {
            this.log(
              subfolder + " has already been processed for filter 4. Skipping."
            )
          }

          if (
            !isProcessedrightbig &&
            this.containsNumber(this.selectedFilter, 5)
          ) {
            await this.combineVideos(inputs, outputPathrightbig, rightbig)
          } else if (this.containsNumber(this.selectedFilter, 5)) {
            this.log(
              subfolder + " has already been processed for filter 5. Skipping."
            )
          }
        }
        const outputPathDir = path.join(
          this.concatenedDir,
          `/${path.basename(subfolder)}/`
        )

        console.log(outputPathDir)
        await fs.promises.mkdir(outputPathDir, { recursive: true })

        if (
          !isProcessedtwoxtwo &&
          this.containsNumber(this.selectedFilter, 1)
        ) {
          const finalOutputPathtwoxtwo = path.join(
            outputPathDir,
            `${path.basename(subfolder)}_2x2.mp4`
          )
          await this.concatenateVideos(
            combinedVideosPathstwoxtwo,
            finalOutputPathtwoxtwo
          )
          // Mark the folder as processed by creating a .processed file
          const markerFilePathtwoxtwo = path.join(subfolder, ".processed_2x2")
          await fs.promises.writeFile(markerFilePathtwoxtwo, "processed_2x2")
        }

        if (
          !isProcessedfrontbig &&
          this.containsNumber(this.selectedFilter, 2)
        ) {
          const finalOutputPathfrontbig = path.join(
            outputPathDir,
            `${path.basename(subfolder)}_frontbig.mp4`
          )
          await this.concatenateVideos(
            combinedVideosPathsfrontbig,
            finalOutputPathfrontbig
          )
          // Mark the folder as processed by creating a .processed file
          const markerFilePathfrontbig = path.join(
            subfolder,
            ".processed_frontbig"
          )
          await fs.promises.writeFile(
            markerFilePathfrontbig,
            "processed_frontbig"
          )
        }

        if (
          !isProcessedbackbig &&
          this.containsNumber(this.selectedFilter, 3)
        ) {
          const finalOutputPathbackbig = path.join(
            outputPathDir,
            `${path.basename(subfolder)}_backbig.mp4`
          )
          await this.concatenateVideos(
            combinedVideosPathsbackbig,
            finalOutputPathbackbig
          )
          // Mark the folder as processed by creating a .processed file
          const markerFilePathbackbig = path.join(
            subfolder,
            ".processed_backbig"
          )
          await fs.promises.writeFile(
            markerFilePathbackbig,
            "processed_backbig"
          )
        }

        if (
          !isProcessedleftbig &&
          this.containsNumber(this.selectedFilter, 4)
        ) {
          const finalOutputPathleftbig = path.join(
            outputPathDir,
            `${path.basename(subfolder)}_leftbig.mp4`
          )
          await this.concatenateVideos(
            combinedVideosPathsleftbig,
            finalOutputPathleftbig
          )
          // Mark the folder as processed by creating a .processed file
          const markerFilePathleftbig = path.join(
            subfolder,
            ".processed_leftbig"
          )
          await fs.promises.writeFile(
            markerFilePathleftbig,
            "processed_leftbig"
          )
        }

        if (
          !isProcessedrightbig &&
          this.containsNumber(this.selectedFilter, 5)
        ) {
          const finalOutputPathrightbig = path.join(
            outputPathDir,
            `${path.basename(subfolder)}_rightbig.mp4`
          )
          await this.concatenateVideos(
            combinedVideosPathsrightbig,
            finalOutputPathrightbig
          )
          // Mark the folder as processed by creating a .processed file
          const markerFilePathrightbig = path.join(
            subfolder,
            ".processed_rightbig"
          )
          await fs.promises.writeFile(
            markerFilePathrightbig,
            "processed_rightbig"
          )
        }

        this.emit("message", `Finished processing subfolder: ${subfolder}\n`)
        this.log(`Finished processing subfolder: ${subfolder}\n`)
      }
    }
  }

  async combineVideos(inputs, outputPath, filter) {
    this.checkCancellation()
    return new Promise((resolve, reject) => {
      // this.emit('message',`Starting combination for output: ${outputPath}`)
      const command = this.ffmpeg()

      const backVideo = inputs.find((input) => input.includes("back"))
      const frontVideo = inputs.find((input) => input.includes("front"))
      const leftVideo = inputs.find((input) => input.includes("left"))
      const rightVideo = inputs.find((input) => input.includes("right"))

      if (backVideo) command.addInput(backVideo)
      if (frontVideo) command.addInput(frontVideo)
      if (leftVideo) command.addInput(leftVideo)
      if (rightVideo) command.addInput(rightVideo)



      const self = this
      command
        .complexFilter(filter)

        .outputOptions([
          "-r",
          "30",
          "-preset",
          "ultrafast",
          "-b:v",
          "2M",
          "-crf",
          "23",
          "-g",
          "60",
          "-profile:v",
          "high",
          "-level",
          "4.2",
        ])
        .on("error", function (err) {
          self.emit(
            "message",
            `FFmpeg error for output: ${outputPath} - ${err.message}`
          )
          self.log(`FFmpeg error for output: ${outputPath} - ${err.message}`)
          reject(err)
        })
        .on("end", function () {
          // this.emit('message',
          //   `\n========> Combination finished successfully for output: ${outputPath}\n`
          // )
          self.log(
            `Combibation finished successfully for output: ${outputPath} `
          )
          resolve(outputPath)
        })
        .on("stderr", function (stderrLine) {
          self.log(`FFmpeg stderr: ${stderrLine}`)
        })
        .save(outputPath)
    })
  }

  getFormattedTimestamp() {
    const now = new Date()
    const year = now.getFullYear()
    const month = (now.getMonth() + 1).toString().padStart(2, "0")
    const day = now.getDate().toString().padStart(2, "0")
    const hours = now.getHours().toString().padStart(2, "0")
    const minutes = now.getMinutes().toString().padStart(2, "0")
    const seconds = now.getSeconds().toString().padStart(2, "0")
    return `${year}-${month}-${day}-${hours}-${minutes}-${seconds}`
  }

  async mainFunction(
    folderPath,
    folderExportPath,
    selectedFilter,
    concurrencyLimit
  ) {
    this.isCancelled = false // Ensure flag is reset at start

    // Command line arguments
    this.videosDir = path.resolve(folderPath) // The first argument is the directory path
    this.concatenedDir = path.resolve(folderExportPath)
    this.selectedFilter = selectedFilter

    const timestamp = this.getFormattedTimestamp()
    this.combinedDir = path.resolve(
      this.concatenedDir,
      `${timestamp}-processing/`
    )
    this.logFilePath = path.resolve(this.concatenedDir, `${timestamp}-log.txt`)
    this.logStream = fs.createWriteStream(this.logFilePath, { flags: "a" }) // 'a' flag for appending

    this.log("VideoCombiner initialized")

    await fs.promises.mkdir(this.combinedDir, { recursive: true })
    await this.emptyDirectory(this.combinedDir)

    try {
      await this.processAllSubfolders(concurrencyLimit)
    } catch (error) {
      if (error.message === "Operation cancelled") {
        this.emit("message", "Operation was cancelled.")
        this.log("Operation was cancelled.")
      } else {
        this.emit("message", `Error during processing: ${error.message}`)
        this.log("Error during processing: ", error.message)
      }
    }
  }

  async processAllSubfolders(concurrencyLimit) {
    const pLimit = (await import("p-limit")).default
    const limit = pLimit(Number(concurrencyLimit)) // Concurrency limit
    try {
      const subfolders = await this.listSubfolders(this.videosDir)
      const promises = subfolders.map((subfolder) => {
        return limit(() => this.processVideosInSubfolder(subfolder)) // Apply the limit to each subfolder processing
      })

      // Wait for all limited tasks to complete
      await Promise.all(promises)
      this.emit("message", "All subfolders processed successfully.")
      this.log("All subfolders processed successfully.")
      this.closeLog()
    } catch (err) {
      console.error("An error occurred during processing:", err)
      this.log("Error during processing: ", err.message)
      this.closeLog()
    }
  }
  async emptyDirectory(dir) {
    try {
      const files = await fs.promises.readdir(dir)
      for (const file of files) {
        await fs.promises.unlink(path.join(dir, file))
      }
      console.log("Directory has been emptied")
      this.log("Temp directory has been emptied")
    } catch (err) {
      console.error(`Error while emptying the directory: ${err}`)
      this.log("Error while emptying the temp directory: ", err.message)
    }
  }
}
module.exports = VideoCombiner
