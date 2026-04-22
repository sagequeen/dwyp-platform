/**
 * DWYP Operations Platform — Web App
 * File: dwyp_app.gs
 * Version: 1.1 | April 2026
 *
 * Custom frontend replacing AppSheet as the primary UI for JT and Audra.
 * Deployed as a second web app from the existing GAS project.
 * clerk_fairy.gs owns doPost(). This file owns doGet() only.
 *
 * Architecture:
 *   - doGet()             → serves dwyp_app.html with injected config
 *   - getEpisodes()       → returns active Episodes tab rows as objects with _rowIndex
 *   - getTasks()          → returns open/in_progress Tasks tab rows as objects with _rowIndex
 *   - writeTaskComplete() → writes Status=complete + Completed_At to Tasks tab
 *   - deleteTaskRow()     → deletes a Task row (manual tasks only, client confirms first)
 *
 * Data reads: Sheets API via google.script.run, authenticated as current user (Audra).
 * Data writes: Sheets API via google.script.run for task actions.
 *              fetch() to clerk_fairy doPost() for Filing (v2, not wired in v1).
 *
 * Known limitations (v1):
 *   - Row indices fetched at load time. Stale if sheet changes mid-session.
 *     Acceptable for v1: single-user sessions, short duration, sheet is auditable.
 *     Revisit if concurrent usage or long-session patterns emerge.
 *   - Filing button not wired. Audra fires Filing Fairy directly from GAS.
 *   - Produce_Episode task auto-complete on Video_Status change: deferred to v2.
 *   - People list: deferred to v2.
 *   - JT task security filter: deferred to v2 (requires HOST_EMAIL from governance).
 *
 * Deployment:
 *   Execute as: Me (Audra)
 *   Access: Specific Google accounts
 *   Entry point: doGet() — no conflict with clerk_fairy doPost()
 *   HTML: dwyp_app.html (separate file in same GAS project)
 *
 * Dependencies:
 *   MASTER_SHEET_ID   — Script Property (set in GAS project settings)
 *   dwyp_app.html     — client-side HTML/CSS/JS (same GAS project)
 *   clerk_fairy.gs    — owns doPost(); not called by this file in v1
 */

// ── COLUMN MAPS ──────────────────────────────────────────────────────────────

// Tasks tab column map (1-based, matches v1.5 schema column order)
var TASKS_COLS = {
  Task_ID:           1,
  Action_Title:      2,
  Assignee:          3,
  Assigned_By:       4,
  Status:            5,
  Priority:          6,
  Due_Date:          7,
  Contact_ID:        8,
  Episode_UID:       9,
  Workflow_Step:     10,
  Executive_Summary: 11,
  Payload_Link:      12,
  Revision_Notes:    13,
  Created_At:        14,
  Completed_At:      15,
  Note_Sent_At:      16
};

// Episodes tab column map (1-based, matches v1.5 schema column order)
var EPISODES_COLS = {
  Episode_Sequence:    1,
  Release_Date:        2,
  Episode_UID:         3,
  Contact_ID:          4,
  Guest_Name:          5,
  Status:              6,
  Raw_Folder_ID:       7,
  Production_Folder_ID: 8,
  Recording_Date:      9,
  Calendar_Event_ID:   10,
  Video_Status:        11,
  Images_Status:       12,
  Episode_URL:         13,
  Episode_Type:        14,
  Frameio_Project_ID:  15
};


// ── SERVER: ENTRY POINT ──────────────────────────────────────────────────────

/**
 * Serves the web app HTML shell from dwyp_ui.html.
 * Injects Sheet ID, deployed URL, authenticated user email,
 * HOST_EMAIL (for security filter), and Quick Link URLs into the page
 * via HtmlService template tags.
 *
 * Governance_Config keys used:
 *   HOST_EMAIL          — identifies JT for task security filter
 *   IMAGE_WORKSHOP_GEM  — Gems quick link URL
 *   NOTEBOOKLM_LINK     — NotebookLM quick link URL
 */
function doGet(e) {
  var sheetId     = PropertiesService.getScriptProperties().getProperty("MASTER_SHEET_ID");
  var userEmail   = Session.getActiveUser().getEmail();
  var deployedUrl = ScriptApp.getService().getUrl();

  // Fetch governance keys for client injection
  var ss         = SpreadsheetApp.openById(sheetId);
  var govSheet   = ss.getSheetByName("Governance_Config");
  var govData    = govSheet.getDataRange().getValues();

  var govMap = {};
  for (var i = 0; i < govData.length; i++) {
    govMap[govData[i][0]] = govData[i][1];
  }

  var hostEmail      = govMap["HOST_EMAIL"]         || "";
  var gemsUrl        = govMap["IMAGE_WORKSHOP_GEM"] || "";
  var notebooklmUrl  = govMap["NOTEBOOKLM_LINK"]   || "";

  var template = HtmlService.createTemplateFromFile("dwyp_ui");
  template.sheetId        = sheetId;
  template.userEmail      = userEmail;
  template.deployedUrl    = deployedUrl;
  template.hostEmail      = hostEmail;
  template.gemsUrl        = gemsUrl;
  template.notebooklmUrl  = notebooklmUrl;

  return template.evaluate()
    .setTitle("DWYP Operations")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}


// ── SERVER: DATA FUNCTIONS ───────────────────────────────────────────────────

/**
 * Returns all active Episodes (Status <> "complete") as an array of objects.
 * Includes _rowIndex (1-based sheet row number) for write operations.
 * Sorted by Episode_Sequence ascending.
 */
function getEpisodes() {
  var sheetId = PropertiesService.getScriptProperties().getProperty("MASTER_SHEET_ID");
  var ss      = SpreadsheetApp.openById(sheetId);
  var sheet   = ss.getSheetByName("Episodes");
  var data    = sheet.getDataRange().getValues();

  var episodes = [];
  for (var i = 1; i < data.length; i++) {
    var row    = data[i];
    var status = row[EPISODES_COLS.Status - 1];
    if (status === "complete") continue;

    episodes.push({
      _rowIndex:            i + 1,
      Episode_Sequence:     row[EPISODES_COLS.Episode_Sequence - 1],
      Release_Date:         row[EPISODES_COLS.Release_Date - 1] ? String(row[EPISODES_COLS.Release_Date - 1]) : "",
      Episode_UID:          row[EPISODES_COLS.Episode_UID - 1],
      Contact_ID:           row[EPISODES_COLS.Contact_ID - 1],
      Guest_Name:           row[EPISODES_COLS.Guest_Name - 1],
      Status:               status,
      Production_Folder_ID: row[EPISODES_COLS.Production_Folder_ID - 1],
      Recording_Date:       row[EPISODES_COLS.Recording_Date - 1] ? String(row[EPISODES_COLS.Recording_Date - 1]) : "",
      Video_Status:         row[EPISODES_COLS.Video_Status - 1],
      Images_Status:        row[EPISODES_COLS.Images_Status - 1],
      Episode_URL:          row[EPISODES_COLS.Episode_URL - 1],
      Episode_Type:         row[EPISODES_COLS.Episode_Type - 1],
      Frameio_Project_ID:   row[EPISODES_COLS.Frameio_Project_ID - 1]
    });
  }

  episodes.sort(function(a, b) {
    return (a.Episode_Sequence || 0) - (b.Episode_Sequence || 0);
  });

  return episodes;
}

/**
 * Returns all open and in_progress Tasks as an array of objects.
 * Includes _rowIndex (1-based sheet row number) for write operations.
 * Client handles filtering by Episode_UID, user email, and security filter.
 */
function getTasks() {
  var sheetId = PropertiesService.getScriptProperties().getProperty("MASTER_SHEET_ID");
  var ss      = SpreadsheetApp.openById(sheetId);
  var sheet   = ss.getSheetByName("Tasks");
  var data    = sheet.getDataRange().getValues();

  var tasks = [];
  for (var i = 1; i < data.length; i++) {
    var row    = data[i];
    var status = row[TASKS_COLS.Status - 1];
    if (status !== "open" && status !== "in_progress") continue;

    tasks.push({
      _rowIndex:         i + 1,
      Task_ID:           row[TASKS_COLS.Task_ID - 1],
      Action_Title:      row[TASKS_COLS.Action_Title - 1],
      Assignee:          row[TASKS_COLS.Assignee - 1],
      Assigned_By:       row[TASKS_COLS.Assigned_By - 1],
      Status:            status,
      Priority:          row[TASKS_COLS.Priority - 1],
      Due_Date:          row[TASKS_COLS.Due_Date - 1] ? String(row[TASKS_COLS.Due_Date - 1]) : "",
      Contact_ID:        row[TASKS_COLS.Contact_ID - 1],
      Episode_UID:       row[TASKS_COLS.Episode_UID - 1],
      Workflow_Step:     row[TASKS_COLS.Workflow_Step - 1],
      Executive_Summary: row[TASKS_COLS.Executive_Summary - 1],
      Payload_Link:      row[TASKS_COLS.Payload_Link - 1]
    });
  }

  Logger.log(JSON.stringify(tasks));
return tasks;
}

/**
 * Marks a task complete. Writes Status = "complete" and Completed_At = now().
 * Called by Approve and Complete buttons.
 *
 * @param {number} rowIndex - 1-based sheet row number (_rowIndex from task object)
 * @returns {object} { success: true } or { success: false, error: string }
 */
function writeTaskComplete(rowIndex) {
  try {
    var sheetId = PropertiesService.getScriptProperties().getProperty("MASTER_SHEET_ID");
    var ss      = SpreadsheetApp.openById(sheetId);
    var sheet   = ss.getSheetByName("Tasks");

    sheet.getRange(rowIndex, TASKS_COLS.Status).setValue("complete");
    sheet.getRange(rowIndex, TASKS_COLS.Completed_At).setValue(new Date());

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Deletes a task row. Manual tasks only — client enforces the gate before calling.
 * Called by Delete button (after client-side confirmation dialog).
 *
 * @param {number} rowIndex - 1-based sheet row number (_rowIndex from task object)
 * @returns {object} { success: true } or { success: false, error: string }
 */
function deleteTaskRow(rowIndex) {
  try {
    var sheetId = PropertiesService.getScriptProperties().getProperty("MASTER_SHEET_ID");
    var ss      = SpreadsheetApp.openById(sheetId);
    var sheet   = ss.getSheetByName("Tasks");
    sheet.deleteRow(rowIndex);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Fetches all rows from User_Registry as an array of { userId, displayName } objects.
 * Used to populate the Assignee dropdown in the new task form.
 */
function getUsers() {
  var sheetId = PropertiesService.getScriptProperties().getProperty("MASTER_SHEET_ID");
  var ss      = SpreadsheetApp.openById(sheetId);
  var sheet   = ss.getSheetByName("User_Registry");
  var data    = sheet.getDataRange().getValues();

  var users = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (!row[0]) continue; // skip blank rows
    users.push({
      userId:      String(row[0]).trim(), // User_ID = email
      displayName: String(row[1]).trim()  // Display_Name
    });
  }
  return users;
}

/**
 * Creates a new manual task row in the Tasks tab.
 * Generates a Task_ID in the system format: TASK-YYMMDD-HHMM-NNN.
 * Assigned_By is set to the creating user's email (not "The Fairy Team"),
 * which enables the Delete button and marks it as a manual task.
 *
 * @param {object} payload - Task fields from the form:
 *   { assignee, episodeUid, dueDate, actionTitle, executiveSummary, priority, createdBy }
 * @returns {object} { success: true } or { success: false, error: string }
 */
function createTask(payload) {
  try {
    var sheetId = PropertiesService.getScriptProperties().getProperty("MASTER_SHEET_ID");
    var ss      = SpreadsheetApp.openById(sheetId);
    var sheet   = ss.getSheetByName("Tasks");

    // Generate Task_ID: TASK-YYMMDD-HHMM-NNN
    var now    = new Date();
    var pad    = function(n) { return String(n).padStart(2, "0"); };
    var yy     = String(now.getFullYear()).slice(2);
    var mm     = pad(now.getMonth() + 1);
    var dd     = pad(now.getDate());
    var hh     = pad(now.getHours());
    var mn     = pad(now.getMinutes());
    var nnn    = String(Math.floor(Math.random() * 900) + 100); // 100-999
    var taskId = "TASK-" + yy + mm + dd + "-" + hh + mn + "-" + nnn;

    // Build row in TASKS_COLS order (16 columns)
    var dueDate = payload.dueDate ? new Date(payload.dueDate) : "";

    var row = new Array(16).fill("");
    row[TASKS_COLS.Task_ID           - 1] = taskId;
    row[TASKS_COLS.Action_Title      - 1] = payload.actionTitle      || "";
    row[TASKS_COLS.Assignee          - 1] = payload.assignee         || "";
    row[TASKS_COLS.Assigned_By       - 1] = payload.createdBy        || "";
    row[TASKS_COLS.Status            - 1] = "open";
    row[TASKS_COLS.Priority          - 1] = payload.priority         || "normal";
    row[TASKS_COLS.Due_Date          - 1] = dueDate;
    row[TASKS_COLS.Episode_UID       - 1] = payload.episodeUid       || "";
    row[TASKS_COLS.Executive_Summary - 1] = payload.executiveSummary || "";
    row[TASKS_COLS.Created_At        - 1] = now;

    sheet.appendRow(row);
    return { success: true, taskId: taskId };
  } catch (err) {
    return { success: false, error: err.message };
  }
}


// ── SERVER: IMAGE REVIEW ─────────────────────────────────────────────────────

/**
 * Returns the image files inside the appropriate subfolder of the episode's
 * staging folder, for use in the image review UI.
 *
 * workflowStep routing:
 *   Review_Social_Images → Social_Images/
 *   Review_Thumbnails    → Thumbnails/
 *
 * Subfolder lives directly inside the staging folder (Production_Folder_ID).
 * Uses getStagingFolderIdByUid() from fairy_circle.gs (same GAS project).
 *
 * @param {string} episodeUid   - Episode_UID from Episodes tab
 * @param {string} workflowStep - "Review_Social_Images" or "Review_Thumbnails"
 * @returns {Array<{fileId, fileName, thumbnailUrl}>}
 */
function getImagesForReview(episodeUid, workflowStep) {
  try {
    var stagingFolderId = getStagingFolderIdByUid(episodeUid);
    if (!stagingFolderId) {
      Logger.log("getImagesForReview: staging folder not found for " + episodeUid);
      return [];
    }

    var subfolderName = (workflowStep === "Review_Social_Images") ? "Social_Images" : "Thumbnails";

    var stagingFolder = DriveApp.getFolderById(stagingFolderId);
    var subIter = stagingFolder.getFoldersByName(subfolderName);
    if (!subIter.hasNext()) {
      Logger.log("getImagesForReview: subfolder '" + subfolderName + "' not found for " + episodeUid);
      return [];
    }
    var targetFolder = subIter.next();

    var files  = targetFolder.getFiles();
    var result = [];
    while (files.hasNext()) {
      var file    = files.next();
      var thumbUrl = "";
      try {
        thumbUrl = file.getThumbnailLink();
      } catch (e) {
        Logger.log("getImagesForReview: getThumbnailLink failed for " + file.getId() + ": " + e.message);
      }
      result.push({
        fileId:       file.getId(),
        fileName:     file.getName(),
        thumbnailUrl: thumbUrl
      });
    }

    Logger.log("getImagesForReview: found " + result.length + " file(s) in " + subfolderName + " for " + episodeUid);
    return result;

  } catch (err) {
    Logger.log("getImagesForReview error: " + err.message);
    return [];
  }
}

/**
 * Completes an image review task:
 *   1. Trashes each fileId in declinedFileIds from Drive.
 *   2. Closes the task (Status = "complete", Completed_At = now()).
 *   3. Checks if any other Review_Social_Images or Review_Thumbnails tasks
 *      for this episode are still open. If none remain, writes
 *      Images_Status = "approved" to the Episodes tab via patchEpisodes().
 *
 * @param {string}   episodeUid      - Episode_UID
 * @param {string}   taskId          - Task_ID string (e.g. "TASK-260421-1234-123")
 * @param {string[]} declinedFileIds - Drive file IDs to trash (Remove selections)
 * @returns {object} { success: true } or { success: false, error: string }
 */
function submitImageReview(episodeUid, taskId, declinedFileIds) {
  try {
    // 1. Trash declined files
    if (declinedFileIds && declinedFileIds.length) {
      for (var d = 0; d < declinedFileIds.length; d++) {
        try {
          DriveApp.getFileById(declinedFileIds[d]).setTrashed(true);
          Logger.log("submitImageReview: trashed file " + declinedFileIds[d]);
        } catch (e) {
          Logger.log("submitImageReview: could not trash " + declinedFileIds[d] + ": " + e.message);
        }
      }
    }

    // 2. Close the task — scan Tasks tab for matching Task_ID string
    var sheetId   = PropertiesService.getScriptProperties().getProperty("MASTER_SHEET_ID");
    var ss        = SpreadsheetApp.openById(sheetId);
    var taskSheet = ss.getSheetByName("Tasks");
    var taskData  = taskSheet.getDataRange().getValues();

    var taskRowIndex = -1;
    for (var i = 1; i < taskData.length; i++) {
      if (String(taskData[i][TASKS_COLS.Task_ID - 1]) === String(taskId)) {
        taskRowIndex = i + 1; // 1-based
        break;
      }
    }

    if (taskRowIndex === -1) {
      Logger.log("submitImageReview: task not found: " + taskId);
      return { success: false, error: "Task not found: " + taskId };
    }

    taskSheet.getRange(taskRowIndex, TASKS_COLS.Status).setValue("complete");
    taskSheet.getRange(taskRowIndex, TASKS_COLS.Completed_At).setValue(new Date());
    Logger.log("submitImageReview: closed task " + taskId + " at row " + taskRowIndex);

    // 3. Check for remaining open image review tasks on this episode
    var imageSteps  = ["Review_Social_Images", "Review_Thumbnails"];
    var freshData   = taskSheet.getDataRange().getValues();
    var anyOpen     = false;

    for (var j = 1; j < freshData.length; j++) {
      var row   = freshData[j];
      var rId   = String(row[TASKS_COLS.Task_ID       - 1]);
      var rEp   = String(row[TASKS_COLS.Episode_UID   - 1]);
      var rStep = String(row[TASKS_COLS.Workflow_Step - 1]);
      var rStat = String(row[TASKS_COLS.Status        - 1]);

      if (rId === String(taskId)) continue;               // skip the task we just closed
      if (rEp !== String(episodeUid)) continue;
      if (imageSteps.indexOf(rStep) === -1) continue;
      if (rStat === "open" || rStat === "in_progress") {
        anyOpen = true;
        break;
      }
    }

    // 4. If all image reviews complete, approve Images_Status on the episode
    if (!anyOpen) {
      patchEpisodes(episodeUid, { Images_Status: "approved" });
      Logger.log("submitImageReview: all image reviews done for " + episodeUid + " — Images_Status set to approved");
    }

    return { success: true };

  } catch (err) {
    Logger.log("submitImageReview error: " + err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Writes arbitrary field values to the matching Episodes tab row.
 * Supported fields: Images_Status, Status. Extend as needed.
 *
 * @param {string} episodeUid - Episode_UID to match
 * @param {object} fields     - e.g. { Images_Status: "approved" }
 */
function patchEpisodes(episodeUid, fields) {
  try {
    var sheetId = PropertiesService.getScriptProperties().getProperty("MASTER_SHEET_ID");
    var ss      = SpreadsheetApp.openById(sheetId);
    var sheet   = ss.getSheetByName("Episodes");
    var data    = sheet.getDataRange().getValues();

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][EPISODES_COLS.Episode_UID - 1]) === String(episodeUid)) {
        var rowIndex = i + 1;
        if (fields.Images_Status !== undefined) {
          sheet.getRange(rowIndex, EPISODES_COLS.Images_Status).setValue(fields.Images_Status);
          Logger.log("patchEpisodes: Images_Status=" + fields.Images_Status + " for " + episodeUid);
        }
        if (fields.Status !== undefined) {
          sheet.getRange(rowIndex, EPISODES_COLS.Status).setValue(fields.Status);
          Logger.log("patchEpisodes: Status=" + fields.Status + " for " + episodeUid);
        }
        return;
      }
    }
    Logger.log("patchEpisodes: episode not found: " + episodeUid);
  } catch (err) {
    Logger.log("patchEpisodes error: " + err.message);
  }
}