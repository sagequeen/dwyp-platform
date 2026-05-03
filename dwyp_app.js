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
 *   Access: Any Google account
 *   Entry point: doGet() — no conflict with clerk_fairy doPost()
 *   HTML: dwyp_app.html (separate file in same GAS project)
 *
 * Dependencies:
 *   MASTER_SHEET_ID   — Script Property (set in GAS project settings)
 *   dwyp_app.html     — client-side HTML/CSS/JS (same GAS project)
 *   clerk_fairy.gs    — owns doPost(); not called by this file in v1
 */

// ── HELPERS ──────────────────────────────────────────────────────────────────

function sanitizeEmail(val) {
  return String(val).replace(/[^\x20-\x7E]/g, "").trim().toLowerCase();
}

/**
 * Validates a 4-digit PIN against User_Registry col 4.
 * Compares SHA-256(submitted PIN) to SHA-256(stored plain-text PIN).
 * Returns { success, userEmail, displayName, role } on match, { success: false } otherwise.
 * The raw PIN is never returned to the client.
 */
function validatePin(pin) {
  try {
    var clean = String(pin).replace(/\D/g, "").slice(0, 4);
    if (clean.length !== 4) return { success: false };

    var sheetId = PropertiesService.getScriptProperties().getProperty("MASTER_SHEET_ID");
    var ss      = SpreadsheetApp.openById(sheetId);
    var sheet   = ss.getSheetByName("User_Registry");
    var data    = sheet.getDataRange().getValues();

    function toHex(bytes) {
      return bytes.map(function(b) { return ("0" + (b & 0xff).toString(16)).slice(-2); }).join("");
    }

    var algo    = Utilities.DigestAlgorithm.SHA_256;
    var pinHash = toHex(Utilities.computeDigest(algo, clean));

    for (var i = 1; i < data.length; i++) {
      var row         = data[i];
      var storedEmail = sanitizeEmail(row[0]);
      if (!storedEmail) continue;

      var storedHash = toHex(Utilities.computeDigest(algo, String(row[3]).trim()));
      if (pinHash === storedHash) {
        return {
          success:     true,
          userEmail:   storedEmail,
          displayName: String(row[1]).trim(),
          role:        String(row[2]).trim()
        };
      }
    }

    return { success: false };
  } catch (err) {
    return { success: false };
  }
}

// ── COLUMN MAPS ──────────────────────────────────────────────────────────────

// Episode_Log tab column map (9 columns)
var EPISODE_LOG_COLS = {
  Log_ID:      1,
  Episode_UID: 2,
  Timestamp:   3,
  Author:      4,
  Entry_Type:  5,
  Asset_Type:  6,
  Body:        7,
  Resolved:    8,
  Visible_To:  9
};

// Social_Assets tab column map (17 columns)
var SOCIAL_ASSETS_COLS = {
  Post_ID:           1,
  Episode_UID:       2,
  Asset_Type:        3,
  Placeholder_Key:   4,
  Platform:          5,
  Release_Week:      6,
  Slot:              7,
  Status:            8,
  Caption:           9,
  Caption_Secondary: 10,
  Drive_File_ID:     11,
  Attribution_Label: 12,
  Scheduled_At:      13,
  Scheduler_Status:  14,
  Posted_At:         15,
  Created_At:        16,
  Created_By:        17
};

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
 * Injects Sheet ID, deployed URL, HOST_EMAIL, and Quick Link URLs into the page
 * via HtmlService template tags. User identity is established client-side via PIN.
 *
 * Governance_Config keys used:
 *   HOST_EMAIL          — identifies JT for task security filter
 *   IMAGE_WORKSHOP_GEM  — Gems quick link URL
 *   NOTEBOOKLM_LINK     — NotebookLM quick link URL
 */
function doGet(e) {
  var sheetId     = PropertiesService.getScriptProperties().getProperty("MASTER_SHEET_ID");
  var ss          = SpreadsheetApp.openById(sheetId);
  var deployedUrl = ScriptApp.getService().getUrl();

  // Fetch governance keys for client injection
  var govSheet  = ss.getSheetByName("Governance_Config");
  var govData   = govSheet.getDataRange().getValues();

  var govMap = {};
  for (var i = 0; i < govData.length; i++) {
    govMap[govData[i][0]] = govData[i][1];
  }

  function cleanUrl(v) { return String(v || "").trim().replace(/^["']+|["']+$/g, "").trim(); }

  var hostEmail     = cleanUrl(govMap["HOST_EMAIL"]);
  var gemsUrl       = cleanUrl(govMap["IMAGE_WORKSHOP_GEM"]);
  var notebooklmUrl = cleanUrl(govMap["NOTEBOOKLM_LINK"]);
  var ownerEmail    = Session.getEffectiveUser().getEmail();

  var template = HtmlService.createTemplateFromFile("dwyp_ui");
  template.sheetId       = sheetId;
  template.deployedUrl   = deployedUrl;
  template.hostEmail     = hostEmail;
  template.gemsUrl       = gemsUrl;
  template.notebooklmUrl = notebooklmUrl;
  template.ownerEmail    = ownerEmail;

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
      Assignee:          sanitizeEmail(row[TASKS_COLS.Assignee - 1]),
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
      userId:      sanitizeEmail(row[0]),
      displayName: String(row[1]).trim()
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

/**
 * Returns candidate Social_Assets counts for an episode.
 * Used by Episode Detail to gate Reels/Images asset buttons.
 * @param {string} episodeUid
 * @returns {{ reels: number, images: number }}
 */
function getSocialAssetCandidateCounts(episodeUid) {
  try {
    var sheetId = PropertiesService.getScriptProperties().getProperty("MASTER_SHEET_ID");
    var ss      = SpreadsheetApp.openById(sheetId);
    var sheet   = ss.getSheetByName("Social_Assets");
    var data    = sheet.getDataRange().getValues();

    var IMAGE_TYPES = ["hook_graphic", "quote_graphic_host", "quote_graphic_guest", "thumbnail"];
    var reels = 0, images = 0;

    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (String(row[SOCIAL_ASSETS_COLS.Episode_UID - 1]) !== String(episodeUid)) continue;
      if (row[SOCIAL_ASSETS_COLS.Status     - 1] !== "candidate") continue;
      var assetType = row[SOCIAL_ASSETS_COLS.Asset_Type - 1];
      if (assetType === "reel")                         reels++;
      if (IMAGE_TYPES.indexOf(assetType) !== -1)        images++;
    }

    return { reels: reels, images: images };
  } catch (err) {
    return { reels: 0, images: 0 };
  }
}

/**
 * Writes Video_Status on the Episodes row matching episodeUid.
 * @param {string} episodeUid
 * @param {string} status  — 'approved' | 'revision_requested'
 * @returns {{ success: boolean, error?: string }}
 */
function writeVideoStatus(episodeUid, status) {
  try {
    var sheetId = PropertiesService.getScriptProperties().getProperty("MASTER_SHEET_ID");
    var ss      = SpreadsheetApp.openById(sheetId);
    var sheet   = ss.getSheetByName("Episodes");
    var data    = sheet.getDataRange().getValues();

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][EPISODES_COLS.Episode_UID - 1]) === String(episodeUid)) {
        sheet.getRange(i + 1, EPISODES_COLS.Video_Status).setValue(status);
        return { success: true };
      }
    }
    return { success: false, error: "Episode not found: " + episodeUid };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Appends a row to the Episode_Log tab.
 * @param {string} episodeUid
 * @param {string} entryType  — e.g. 'feedback'
 * @param {string} assetType  — e.g. 'video'
 * @param {string} body       — freetext note
 * @param {string} visibleTo  — 'both' | 'internal'
 * @param {string} authorEmail — current user email passed from client
 * @returns {{ success: boolean, error?: string }}
 */
function appendEpisodeLogEntry(episodeUid, entryType, assetType, body, visibleTo, authorEmail) {
  try {
    var sheetId = PropertiesService.getScriptProperties().getProperty("MASTER_SHEET_ID");
    var ss      = SpreadsheetApp.openById(sheetId);
    var sheet   = ss.getSheetByName("Episode_Log");

    var now  = new Date();
    var pad  = function(n) { return String(n).padStart(2, "0"); };
    var yy   = String(now.getFullYear()).slice(2);
    var mm   = pad(now.getMonth() + 1);
    var dd   = pad(now.getDate());
    var hh   = pad(now.getHours());
    var mn   = pad(now.getMinutes());
    var nnn  = String(Math.floor(Math.random() * 900) + 100);
    var logId = "LOG-" + yy + mm + dd + "-" + hh + mn + "-" + nnn;

    var author = authorEmail || Session.getEffectiveUser().getEmail();

    var row = new Array(9).fill("");
    row[EPISODE_LOG_COLS.Log_ID      - 1] = logId;
    row[EPISODE_LOG_COLS.Episode_UID - 1] = episodeUid;
    row[EPISODE_LOG_COLS.Timestamp   - 1] = now;
    row[EPISODE_LOG_COLS.Author      - 1] = author;
    row[EPISODE_LOG_COLS.Entry_Type  - 1] = entryType;
    row[EPISODE_LOG_COLS.Asset_Type  - 1] = assetType;
    row[EPISODE_LOG_COLS.Body        - 1] = body;
    row[EPISODE_LOG_COLS.Resolved    - 1] = false;
    row[EPISODE_LOG_COLS.Visible_To  - 1] = visibleTo;

    sheet.appendRow(row);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Returns candidate Social_Assets rows for an episode and asset type(s).
 * assetType may be a string or an array of strings.
 * @param {string}          episodeUid
 * @param {string|string[]} assetType
 * @returns {object[]}
 */
function getSocialAssets(episodeUid, assetType) {
  try {
    var sheetId = PropertiesService.getScriptProperties().getProperty("MASTER_SHEET_ID");
    var ss      = SpreadsheetApp.openById(sheetId);
    var sheet   = ss.getSheetByName("Social_Assets");
    var data    = sheet.getDataRange().getValues();

    var types  = Array.isArray(assetType) ? assetType : [assetType];
    var assets = [];

    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (String(row[SOCIAL_ASSETS_COLS.Episode_UID - 1]) !== String(episodeUid)) continue;
      if (row[SOCIAL_ASSETS_COLS.Status     - 1] !== "candidate")                 continue;
      if (types.indexOf(row[SOCIAL_ASSETS_COLS.Asset_Type - 1]) === -1)           continue;

      assets.push({
        _rowIndex:       i + 1,
        Post_ID:         row[SOCIAL_ASSETS_COLS.Post_ID         - 1],
        Episode_UID:     row[SOCIAL_ASSETS_COLS.Episode_UID     - 1],
        Asset_Type:      row[SOCIAL_ASSETS_COLS.Asset_Type      - 1],
        Placeholder_Key: row[SOCIAL_ASSETS_COLS.Placeholder_Key - 1],
        Drive_File_ID:   row[SOCIAL_ASSETS_COLS.Drive_File_ID   - 1],
        Status:          row[SOCIAL_ASSETS_COLS.Status          - 1]
      });
    }

    return assets;
  } catch (err) {
    return [];
  }
}

/**
 * Writes Status on a Social_Assets row by row index.
 * @param {number} rowIndex - 1-based sheet row number (_rowIndex from asset object)
 * @param {string} status   - 'scheduled' | 'bank' | 'rejected'
 * @returns {{ success: boolean, error?: string }}
 */
function writeSocialAssetStatus(rowIndex, status) {
  try {
    var sheetId = PropertiesService.getScriptProperties().getProperty("MASTER_SHEET_ID");
    var ss      = SpreadsheetApp.openById(sheetId);
    var sheet   = ss.getSheetByName("Social_Assets");
    sheet.getRange(rowIndex, SOCIAL_ASSETS_COLS.Status).setValue(status);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Stub — logs to Audit_Trail and returns success.
 * Real Marcom trigger wired in Marcom spoke.
 * @param {string} episodeUid
 * @returns {{ success: boolean, error?: string }}
 */
function getOwnerEmail() {
  return Session.getEffectiveUser().getEmail();
}

function runMarcomForEpisode(episodeUid) {
  try {
    var sheetId = PropertiesService.getScriptProperties().getProperty("MASTER_SHEET_ID");
    var ss      = SpreadsheetApp.openById(sheetId);
    try {
      var audit = ss.getSheetByName("Audit_Trail");
      if (audit) {
        audit.appendRow([new Date(), "DWYP_App", "runMarcomForEpisode", episodeUid]);
      }
    } catch (logErr) { /* non-fatal — Audit_Trail may not exist yet */ }
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}


// ── IMAGE WORKSHOP ───────────────────────────────────────────────────────────

/**
 * Returns all files in the IMAGE_BACKGROUND_LIBRARY_ID Drive folder.
 * isAiGenerated: true when filename starts with "bg_" (Safety Fairy convention).
 * @returns {object[]} Array of { fileId, name, isAiGenerated }
 */
function getBackgroundLibrary() {
  try {
    var libraryId = getGovernance("IMAGE_BACKGROUND_LIBRARY_ID");
    if (!libraryId) return [];
    var folder = DriveApp.getFolderById(libraryId);
    var files  = folder.getFiles();
    var result = [];
    while (files.hasNext()) {
      var file = files.next();
      var name = file.getName();
      var id = file.getId();
      result.push({
        fileId:        id,
        name:          name,
        isAiGenerated: name.indexOf("bg_") === 0,
        thumbnailUrl:  'https://drive.google.com/thumbnail?id=' + id + '&sz=w320'
      });
    }
    return result;
  } catch (err) {
    return [];
  }
}

/**
 * Returns the full image as a base64 data URL for canvas placement.
 * Used instead of a Drive URL to avoid CORS restrictions in the GAS web app.
 * @param {string} fileId
 * @returns {{ success: true, dataUrl: string } | { success: false, error: string }}
 */
function getBackgroundImageData(fileId) {
  try {
    var file     = DriveApp.getFileById(fileId);
    var blob     = file.getBlob();
    var mimeType = blob.getContentType() || "image/png";
    var base64   = Utilities.base64Encode(blob.getBytes());
    return { success: true, dataUrl: "data:" + mimeType + ";base64," + base64 };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Decodes a base64 image string and saves it to the background library folder.
 * base64Data may include a data-URL prefix (data:image/png;base64,...) — stripped automatically.
 * @param {string} base64Data
 * @param {string} filename
 * @returns {{ fileId, name, isAiGenerated: false } | { success: false, error: string }}
 */
function uploadBackgroundToLibrary(base64Data, filename) {
  try {
    var libraryId = getGovernance("IMAGE_BACKGROUND_LIBRARY_ID");
    if (!libraryId) return { success: false, error: "IMAGE_BACKGROUND_LIBRARY_ID not configured" };
    var raw      = base64Data.replace(/^data:[^;]+;base64,/, "");
    var mimeType = base64Data.indexOf("jpeg") !== -1 ? "image/jpeg" : "image/png";
    var blob     = Utilities.newBlob(Utilities.base64Decode(raw), mimeType, filename);
    var folder   = DriveApp.getFolderById(libraryId);
    var file     = folder.createFile(blob);
    return { fileId: file.getId(), name: file.getName(), isAiGenerated: false };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Moves a background library file to trash.
 * @param {string} fileId
 * @returns {{ success: boolean, error?: string }}
 */
function deleteBackgroundFromLibrary(fileId) {
  try {
    DriveApp.getFileById(fileId).setTrashed(true);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Calls callGeminiImageAPI() with the prompt and optional canvas image,
 * saves the returned image to IMAGE_BACKGROUND_LIBRARY_ID, and returns
 * the base64 data + Drive file ID to the client.
 * Filename convention: bg_gen_YYMMDD-HHMM.png — picked up by isAiGenerated
 * detection in getBackgroundLibrary() (name.indexOf("bg_") === 0).
 * @param {string} prompt
 * @param {string|null} imageBase64  — base64 only (no data-URL prefix)
 * @param {string|null} mimeType     — e.g. "image/png"
 */
var BG_GEN_SYSTEM =
  "You are a social media graphic designer creating background images for a podcast about grief, " +
  "loss, pain, and human resilience. Your images will be used as canvas backgrounds with quote text " +
  "overlaid. Visual style: atmospheric, contemplative, emotionally honest. Cinematic in quality. Avoid " +
  "stock photo aesthetics, overly bright or cheerful imagery, and sanitized or generic compositions. " +
  "The full range of human emotion is appropriate — darkness, tenderness, intensity, quiet. Compose " +
  "with intentional negative space — the image will have a text quote overlaid, so avoid dense detail " +
  "across the entire composition. Never include: text, typography, watermarks, logos, brand marks, " +
  "symbols, decorative borders, or frames. Fill the frame completely. No letterboxing, no padding, " +
  "no solid color bars.";

function generateBackground(prompt, imageBase64, mimeType, aspectRatio) {
  try {
    var aspectLabels = { "9:16": "9:16 portrait (tall vertical)", "4:5": "4:5 portrait (feed)", "1:1": "1:1 square", "16:9": "16:9 landscape (wide horizontal)" };
    var aspectNote   = aspectRatio && aspectLabels[aspectRatio]
      ? "\n\nCanvas format: " + aspectLabels[aspectRatio] + " — compose and fill the frame completely for this orientation."
      : "";
    var result    = callGeminiImageAPI(
      BG_GEN_SYSTEM + aspectNote + "\n\nUser request: " + prompt,
      imageBase64  || null,
      mimeType     || null,
      "ImageWorkshop",
      null
    );
    var libraryId = getGovernance("IMAGE_BACKGROUND_LIBRARY_ID");
    if (!libraryId) return { success: false, error: "IMAGE_BACKGROUND_LIBRARY_ID not configured" };

    var now      = new Date();
    var pad      = function(n) { return String(n).padStart(2, "0"); };
    var ts       = String(now.getFullYear()).slice(2) +
                   pad(now.getMonth() + 1) + pad(now.getDate()) + "-" +
                   pad(now.getHours())     + pad(now.getMinutes());
    var ext      = (result.mimeType === "image/jpeg") ? "jpg" : "png";
    var slug     = prompt.trim().replace(/[^a-zA-Z0-9\s]/g, "").split(/\s+/).slice(0, 5)
                     .join("-").toLowerCase().replace(/-+$/, "");
    var filename = slug ? "bg_" + slug + "_" + ts + "." + ext : "bg_gen_" + ts + "." + ext;

    var blob   = Utilities.newBlob(Utilities.base64Decode(result.data), result.mimeType, filename);
    var folder = DriveApp.getFolderById(libraryId);
    var file   = folder.createFile(blob);

    return {
      success:  true,
      data:     result.data,
      mimeType: result.mimeType,
      fileId:   file.getId(),
      name:     filename
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Reads episode_manifest.json for raw_hooks and raw_quotes.
 * Returns manifest object, or { raw_hooks: [], raw_quotes: [] } if not found.
 * @param {string} episodeUid
 */
function getEpisodeManifest(episodeUid) {
  try {
    var folderId = getStagingFolderIdByUid(episodeUid);
    if (!folderId) return { raw_hooks: [], raw_quotes: [] };
    var manifest = getManifest(folderId);
    return manifest || { raw_hooks: [], raw_quotes: [] };
  } catch (err) {
    if (err.isManifestCorrupt) {
      logToAuditTrail("DwypApp", "error", episodeUid, "",
        `[WARNING] Manifest corrupt for episode ${episodeUid} — returning empty hook/quote data to UI. Folder: ${err.folderId || "unknown"}`,
        "WARNING");
    }
    return { raw_hooks: [], raw_quotes: [] };
  }
}

/**
 * Approves Audra's Guest Brief Enrich task and spawns the JT review task.
 * Called by the web app Approve button on Review_Guest_Brief tasks assigned to Audra.
 * Looks up Guest_Name from the Episodes tab, then calls spawnGuestBriefReviewForJT()
 * in herald_fairy.gs.
 *
 * @param {string} episodeUid
 * @returns {{ success: boolean, error?: string }}
 */
function approveGuestBriefEnrich(episodeUid) {
  try {
    var sheetId   = PropertiesService.getScriptProperties().getProperty("MASTER_SHEET_ID");
    var ss        = SpreadsheetApp.openById(sheetId);
    var epSheet   = ss.getSheetByName("Episodes");
    var epData    = epSheet.getDataRange().getValues();
    var epHeaders = epData[0];
    var uidCol    = epHeaders.indexOf("Episode_UID");
    var nameCol   = epHeaders.indexOf("Guest_Name");

    var displayName = episodeUid;
    for (var i = 1; i < epData.length; i++) {
      if (String(epData[i][uidCol]) === String(episodeUid)) {
        displayName = epData[i][nameCol] || episodeUid;
        break;
      }
    }

    spawnGuestBriefReviewForJT(episodeUid, displayName);
    logToAuditTrail("DwypApp", "human_action", episodeUid, "",
      "[INFO] Guest Brief approved by Audra — JT review task spawned.", "INFO");
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Stub — triggered when Audra taps the Fairy button on an All Assets Approved task.
 * Logs intent and spawns a manual-run notice to Audra.
 * TODO: Wire to clerk_fairy.gs doPost() in the clerk_fairy rebuild spoke to trigger
 * runFilingFairy() directly.
 *
 * @param {string} episodeUid
 * @returns {{ success: boolean, error?: string }}
 */
function triggerFilingFromTask(episodeUid) {
  try {
    logToAuditTrail("DwypApp", "human_action", episodeUid, "",
      "[INFO] triggerFilingFromTask called — clerk_fairy route unavailable. Manual run required.", "INFO");
    spawnTask({
      episodeUid:       episodeUid,
      workflowStep:     "Filing",
      actionTitle:      "Filing Fairy triggered from task — run manually",
      assignee:         getGovernance("ASSIGNEE_PRODUCER"),
      assignedBy:       "The Fairy Team",
      status:           "open",
      priority:         "urgent",
      executiveSummary: "Filing Fairy was triggered via the All Assets Approved button. The clerk_fairy.gs route is not yet wired. Run runFilingFairy(\"" + episodeUid + "\") manually from Apps Script to complete filing."
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Returns active (non-complete) episodes for the Image Workshop export picker.
 * Sorted by Episode_Sequence ascending.
 * @returns {{ guestName: string, episodeUid: string }[]}
 */
function getActiveEpisodes() {
  var sheetId = PropertiesService.getScriptProperties().getProperty("MASTER_SHEET_ID");
  var ss      = SpreadsheetApp.openById(sheetId);
  var sheet   = ss.getSheetByName("Episodes");
  var data    = sheet.getDataRange().getValues();

  var result = [];
  for (var i = 1; i < data.length; i++) {
    var row    = data[i];
    var status = row[EPISODES_COLS.Status - 1];
    if (status === "complete") continue;
    var uid  = row[EPISODES_COLS.Episode_UID      - 1];
    var name = row[EPISODES_COLS.Guest_Name       - 1];
    var seq  = row[EPISODES_COLS.Episode_Sequence - 1];
    if (!uid) continue;
    result.push({ episodeUid: String(uid), guestName: String(name || uid), _seq: seq || 999 });
  }
  result.sort(function(a, b) { return a._seq - b._seq; });
  return result.map(function(e) { return { episodeUid: e.episodeUid, guestName: e.guestName }; });
}

/**
 * Decodes a base64 PNG and writes it to the episode's Production folder.
 * Filename: image_[episodeUid]_[timestamp].png
 * base64Data may include a data-URL prefix — stripped automatically.
 * @param {string} episodeUid
 * @param {string} base64Data
 * @returns {{ success: true, filename: string } | { success: false, error: string }}
 */
function saveImageToStaging(episodeUid, base64Data) {
  try {
    var imagesFolder;
    var filePrefix;

    if (episodeUid) {
      var folderId = getStagingFolderIdByUid(episodeUid);
      if (!folderId) return { success: false, error: "Production folder not found for episode: " + episodeUid };
      var stagingFolder  = DriveApp.getFolderById(folderId);
      var imagesFolderIt = stagingFolder.getFoldersByName("Images");
      if (!imagesFolderIt.hasNext()) return { success: false, error: "Images folder not found in staging for episode: " + episodeUid };
      imagesFolder = imagesFolderIt.next();
      filePrefix   = "image_" + episodeUid;
    } else {
      var fallbackId = getGovernanceValue("IW_EXPORT_FALLBACK_FOLDER_ID") || "1-j74fbb3FdWRY2smdzUjsCgcdfdeljbr";
      imagesFolder   = DriveApp.getFolderById(fallbackId);
      filePrefix     = "image";
    }

    var now      = new Date();
    var pad      = function(n) { return String(n).padStart(2, "0"); };
    var ts       = String(now.getFullYear()).slice(2) +
                   pad(now.getMonth() + 1) + pad(now.getDate()) + "-" +
                   pad(now.getHours())     + pad(now.getMinutes());
    var filename = filePrefix + "_" + ts + ".png";
    var raw      = base64Data.replace(/^data:[^;]+;base64,/, "");
    var blob     = Utilities.newBlob(Utilities.base64Decode(raw), "image/png", filename);
    imagesFolder.createFile(blob);
    return { success: true, filename: filename };
  } catch (err) {
    return { success: false, error: err.message };
  }
}


// ── REVIEW TASKS ─────────────────────────────────────────────────────────────

/**
 * Returns the Drive file ID of the proxy video in the episode's Staging root.
 * Returns null if no file with a "proxy_" prefix is found.
 * @param {string} episodeUid
 * @returns {string|null}
 */
function getProxyFileId(episodeUid) {
  try {
    var folderId = getStagingFolderIdByUid(episodeUid);
    if (!folderId) return null;
    var episodeFolderIt = DriveApp.getFolderById(folderId).getFoldersByName("Episode");
    if (!episodeFolderIt.hasNext()) return null;
    var files = episodeFolderIt.next().getFiles();
    while (files.hasNext()) {
      var file = files.next();
      if (file.getName().indexOf("proxy_") === 0) return file.getId();
    }
    return null;
  } catch (err) {
    throw new Error("getProxyFileId failed for " + episodeUid + ": " + err.message);
  }
}

/**
 * Lists files in the root of Staging/[type]/ (Images or Reels).
 * DriveApp.getFiles() is non-recursive — Approved/Save/Delete subfolders are never traversed.
 * @param {string} episodeUid
 * @param {string} type  "Images" | "Reels"
 * @returns {object[]}  Array of { fileId, fileName, mimeType, thumbnailUrl }
 */
function listReviewFiles(episodeUid, type) {
  try {
    var folderId = getStagingFolderIdByUid(episodeUid);
    if (!folderId) return [];
    var stagingFolder = DriveApp.getFolderById(folderId);
    var typeFolders   = stagingFolder.getFoldersByName(type);
    if (!typeFolders.hasNext()) return [];
    var typeFolder = typeFolders.next();
    var files  = typeFolder.getFiles();
    var result = [];
    while (files.hasNext()) {
      var file = files.next();
      var id   = file.getId();
      result.push({
        fileId:       id,
        fileName:     file.getName(),
        mimeType:     file.getMimeType(),
        thumbnailUrl: "https://drive.google.com/thumbnail?id=" + id + "&sz=w400"
      });
    }
    return result;
  } catch (err) {
    throw new Error("listReviewFiles failed for " + episodeUid + " / " + type + ": " + err.message);
  }
}

/**
 * Moves a review file into Staging/[type]/[decision]/.
 * Drive move: removes file from all current parents, then adds to target subfolder.
 * @param {string} fileId
 * @param {string} episodeUid
 * @param {string} type      "Images" | "Reels"
 * @param {string} decision  "Approved" | "Save" | "Delete"
 * @returns {{ success: true }}
 */
function moveReviewFile(fileId, episodeUid, type, decision) {
  try {
    var folderId = getStagingFolderIdByUid(episodeUid);
    if (!folderId) throw new Error("Staging folder not found for episode: " + episodeUid);
    var stagingFolder = DriveApp.getFolderById(folderId);

    var typeFolders = stagingFolder.getFoldersByName(type);
    if (!typeFolders.hasNext()) throw new Error("Type folder not found: " + type);
    var typeFolder = typeFolders.next();

    var decisionFolders = typeFolder.getFoldersByName(decision);
    if (!decisionFolders.hasNext()) throw new Error("Decision folder not found: " + type + "/" + decision);
    var decisionFolder = decisionFolders.next();

    Drive.Files.update(
      {},
      fileId,
      null,
      {
        addParents:        decisionFolder.getId(),
        removeParents:     typeFolder.getId(),
        supportsAllDrives: true,
        fields:            "id"
      }
    );

    return { success: true };
  } catch (err) {
    throw new Error("moveReviewFile failed for " + fileId + ": " + err.message);
  }
}

/**
 * Spawns a Revise_Images task for Audra from JT's image comment.
 * @param {string} episodeUid
 * @param {string} fileName   — image filename, used in task title
 * @param {string} comment    — JT's note, written to Executive_Summary
 */
function submitImageRevision(episodeUid, fileName, comment) {
  spawnTask({
    actionTitle:      "Revise Image — " + fileName,
    assignee:         getGovernance("ASSIGNEE_PRODUCER"),
    assignedBy:       "The Fairy Team",
    status:           "open",
    priority:         "normal",
    episodeUid:       episodeUid,
    workflowStep:     "Revise_Images",
    executiveSummary: comment
  });
}

/**
 * Spawns a Revise_Reels task for Audra from JT's reel comment.
 * @param {string} episodeUid
 * @param {string} fileName   — reel filename, used in task title
 * @param {string} comment    — JT's note, written to Executive_Summary
 */
function submitReelRevision(episodeUid, fileName, comment) {
  spawnTask({
    actionTitle:      "Revise Reel — " + fileName,
    assignee:         getGovernance("ASSIGNEE_PRODUCER"),
    assignedBy:       "The Fairy Team",
    status:           "open",
    priority:         "normal",
    episodeUid:       episodeUid,
    workflowStep:     "Revise_Reels",
    executiveSummary: comment
  });
}

/**
 * Submits timestamped episode comments from JT's review session.
 * If an open Review_Episode task exists for the episode, appends to its Revision_Notes.
 * If none exists, spawns a new task for Audra with the comments as the body.
 * @param {string}   episodeUid
 * @param {object[]} comments    Array of { timestamp, note }
 * @param {string}   sessionDate ISO date string — used as session separator
 * @returns {{ success: true }}
 */
function submitEpisodeComments(episodeUid, comments, sessionDate) {
  try {
    var separator = "--- " + sessionDate + " ---";
    var lines     = [separator];
    for (var i = 0; i < comments.length; i++) {
      lines.push("[" + comments[i].timestamp + "] " + comments[i].note);
    }
    var block = lines.join("\n");

    var sheetId = PropertiesService.getScriptProperties().getProperty("MASTER_SHEET_ID");
    var ss      = SpreadsheetApp.openById(sheetId);
    var sheet   = ss.getSheetByName("Tasks");
    var data    = sheet.getDataRange().getValues();

    var producerEmail = getGovernance("ASSIGNEE_PRODUCER");
    var found = false;
    for (var r = 1; r < data.length; r++) {
      var row = data[r];
      if (String(row[TASKS_COLS.Episode_UID   - 1]) !== String(episodeUid))  continue;
      if (String(row[TASKS_COLS.Workflow_Step - 1]) !== "Revise_Episode")    continue;
      if (String(row[TASKS_COLS.Assignee      - 1]) !== producerEmail)       continue;
      if (String(row[TASKS_COLS.Status        - 1]) === "complete")          continue;
      var existing = String(row[TASKS_COLS.Revision_Notes - 1] || "");
      var updated  = existing ? existing + "\n" + block : block;
      sheet.getRange(r + 1, TASKS_COLS.Revision_Notes).setValue(updated);
      found = true;
      break;
    }

    if (!found) {
      var manifest  = getManifest(getStagingFolderIdByUid(episodeUid));
      var guestName = (manifest && manifest.guest_name) ? manifest.guest_name : episodeUid;
      spawnTask({
        episodeUid:       episodeUid,
        workflowStep:     "Revise_Episode",
        actionTitle:      "Revision Notes — " + guestName,
        assignee:         producerEmail,
        assignedBy:       "The Fairy Team",
        status:           "open",
        priority:         "normal",
        executiveSummary: block
      });
    }

    return { success: true };
  } catch (err) {
    throw new Error("submitEpisodeComments failed for " + episodeUid + ": " + err.message);
  }
}

/**
 * Checks whether both the Images/ and Reels/ staging roots have zero files.
 * Only counts files directly in each root — Approved/Save/Delete subfolders are excluded.
 * @param {string} episodeUid
 * @returns {{ ready: boolean, imagesEmpty: boolean, reelsEmpty: boolean }}
 */
function checkReadyForRelease(episodeUid) {
  try {
    var folderId = getStagingFolderIdByUid(episodeUid);
    if (!folderId) return { ready: false, imagesEmpty: false, reelsEmpty: false };
    var stagingFolder = DriveApp.getFolderById(folderId);

    function countRootFiles(subfolderName) {
      var subs = stagingFolder.getFoldersByName(subfolderName);
      if (!subs.hasNext()) return 0;
      var files = subs.next().getFiles();
      var n = 0;
      while (files.hasNext()) { files.next(); n++; }
      return n;
    }

    var imagesEmpty = countRootFiles("Images") === 0;
    var reelsEmpty  = countRootFiles("Reels")  === 0;
    return { ready: imagesEmpty && reelsEmpty, imagesEmpty: imagesEmpty, reelsEmpty: reelsEmpty };
  } catch (err) {
    throw new Error("checkReadyForRelease failed for " + episodeUid + ": " + err.message);
  }
}

// ── SOCIAL VERT ──────────────────────────────────────────────────────────────

var SOCIAL_VERT_SYSTEM =
  "You are Social Vert — the quote and hook engine for Don't Waste Your Pain. You work inside the Image Workshop. Your only job is to surface raw material from episode transcripts for use on graphic assets.\n\n" +
  "You do not write copy. You do not summarize. You do not explain. You find what is already there and return it in a format JT can use immediately on the canvas.\n\n" +
  "WHAT YOU RETURN\n\n" +
  "Default: conversational prose. Answer questions, discuss themes, surface ideas — respond naturally.\n\n" +
  "Chips only when JT explicitly asks for hooks, quotes, or image prompts. Each chip uses exactly this format:\n\n" +
  "[[HOOK: text]]\n" +
  "[[QUOTE: text — Guest Name]]\n" +
  "[[PROMPT: text]]\n\n" +
  "HOOK — A single declarative sentence synthesized from the episode. Not invented — sourced from what was actually said. Maximum 15 words. Creates tension or contradiction. Does not summarize. Stands alone in a feed with no context. Omniscient POV.\n\n" +
  "QUOTE — Verbatim from the transcript. Wrapped in quotation marks. Attribution always included with em-dash and full guest name — never first name only. Example: [[QUOTE: \"text\" — Kyla Mitsunaga]]. Filler words (um, ah, like, you know) may be removed. Ellipsis may bridge two sentences only when original meaning is fully intact and no ideas are compressed. Maximum 15 words.\n\n" +
  "Standalone test — mandatory before returning any quote: Read the quote with no surrounding context. Does a stranger understand what is being declared? If it requires the conversation to make sense, it fails. Do not return it. Find a different quote or report that none exists.\n\n" +
  "PROMPT — A background image direction for the canvas. No text in the image. No logos. Mood and composition only. One sentence.\n\n" +
  "OUTPUT FORMATTING\n\n" +
  "When returning chips, group by type with a blank line between each chip and a blank line between groups. Label each group:\n\n" +
  "Hooks\n" +
  "[[HOOK: text]]\n\n" +
  "[[HOOK: text]]\n\n" +
  "Quotes\n" +
  "[[QUOTE: \"text\" — Full Name]]\n\n" +
  "[[QUOTE: \"text\" — Full Name]]\n\n" +
  "Image Prompts\n" +
  "[[PROMPT: text]]\n\n" +
  "[[PROMPT: text]]\n\n" +
  "Do not run chips together in a block. Each chip gets its own line with breathing room.\n\n" +
  "DEFAULT CHIP COUNT (when chips are requested)\n" +
  "Unless JT specifies otherwise:\n" +
  "— 3 HOOK chips\n" +
  "— 3 QUOTE chips\n" +
  "— 2 PROMPT chips\n\n" +
  "Chips and prose may appear together in the same response. If JT asks \"what themes does this episode explore and can you give me some hooks?\" — answer the question in prose, then return the chips below.\n\n" +
  "HOW TO SPEAK\n\n" +
  "You are part of the Don't Waste Your Pain team. You are direct and do not perform enthusiasm. No preamble. No \"Here are your hooks!\" No \"Great question!\" No \"I found some powerful quotes for you.\"\n\n" +
  "When returning chips, lead with the group label and deliver. If you need to say something, say it in one sentence — plain, specific, no flourish.\n\n" +
  "Wrong: \"Here are some hooks, quotes, and image prompts for David Bedrick's episode!\"\n" +
  "Right: \"David Bedrick\"\n\n" +
  "Wrong: \"I've found some really powerful quotes from this transcript.\"\n" +
  "Right: \"Three quotes. One is borderline — flagged below.\"\n\n" +
  "If something is missing or a quote fails the standalone test, say so plainly and move on.\n\n" +
  "HARD RULES — NEVER VIOLATE\n\n" +
  "Quote integrity. Never present synthesized, paraphrased, or reconstructed text as a quote. If you cannot find a real verbatim quote that serves the task, say so. Do not invent one. Do not reconstruct from memory or general knowledge.\n\n" +
  "No hallucination. If it is not in the transcript, it does not exist. Do not infer from the guest's reputation, other appearances, or general knowledge about their work.\n\n" +
  "Logo — zero tolerance. Never reference, describe, or suggest the DWYP logo in any PROMPT chip.\n\n" +
  "If you cannot find a verbatim quote for a request, respond: \"I cannot find a verbatim quote for that. Want me to surface 3 passages you can review instead?\"\n\n" +
  "VOICE STANDARDS\n\n" +
  "Hooks must be precise and unflinching. No motivational poster language. No wellness retreat aesthetics. Darkness and humor are both allowed.\n\n" +
  "Forbidden phrases — if any appear in a hook, rewrite before returning:\n" +
  "heart-centered · transformative journey · profound exploration · safe space · deeply moving · inspires us to · in a world where · holds space · unpacks · dives deep · game-changer · paradigm shift · on this journey · resonates · impactful · raw and vulnerable · bravely shares · courageously · shows up · leaning in · the work · healing journey · sacred space · high vibe · aligned · authentic self · showing up fully · invite you to · I see you · witness your pain\n\n" +
  "Catchphrase rule. Never generate \"don't waste your pain,\" \"what is your superpower,\" or \"superpower\" as a hook or quote fragment.\n\n" +
  "PROMPT CHIP VISUAL STANDARD\n\n" +
  "The test: would this image fit in a film festival program, a literary journal, or a documentary title card? If yes, it works. If it looks like a wellness retreat, a motivational poster, a church bulletin, or a cult recruitment graphic — rewrite it.\n\n" +
  "Avoid in PROMPT chips: phoenix imagery, silhouettes with open arms, glowing objects, warm beige or cream palettes, stock photo aesthetics, bright even lighting, arranged smiles, wellness retreat aesthetics.";

/**
 * Queries Social Vert via Vertex AI RAG Engine. Retrieval + generation happen
 * in one call — the corpus returns grounded chunks and Gemini generates from them.
 * Supports multi-turn history.
 *
 * Governance keys used:
 *   STUDIO_CORPUS_ID — full Vertex RAG corpus resource name
 *                      (projects/dwyp-rag/locations/us-central1/ragCorpora/...)
 *   MODEL_NAME       — Gemini model (fallback: gemini-2.0-flash)
 *
 * @param {string}   userMessage
 * @param {object[]} history  — array of { role, content }
 * @returns {string} model response text
 */
function querySocialVert(userMessage, history) {
  var corpusName = getGovernance("STUDIO_CORPUS_ID");
  if (!corpusName) throw new Error("STUDIO_CORPUS_ID not configured in Governance_Config.");

  // Derive project from the corpus resource name.
  // NOTE: do NOT use the corpus location (us-south1) for the generation endpoint —
  // Gemini models on Vertex AI are not available in us-south1. The corpus resource
  // name in vertexRagStore is fully-qualified, so retrieval works cross-region.
  var project        = corpusName.split("/")[1];  // e.g. "dwyp-rag"
  var endpointRegion = "us-central1";

  var model = getGovernance("MODEL_NAME") || "gemini-2.0-flash";
  var token = ScriptApp.getOAuthToken();
  var url   = "https://" + endpointRegion + "-aiplatform.googleapis.com/v1beta1/projects/" +
              project + "/locations/" + endpointRegion +
              "/publishers/google/models/" + model + ":generateContent";

  var contents = [];
  if (Array.isArray(history)) {
    for (var i = 0; i < history.length; i++) {
      var turn = history[i];
      contents.push({
        role:  (turn.role === "model" || turn.role === "assistant") ? "model" : "user",
        parts: [{ text: turn.content }]
      });
    }
  }
  contents.push({ role: "user", parts: [{ text: userMessage }] });

  var payload = {
    systemInstruction: { parts: [{ text: SOCIAL_VERT_SYSTEM }] },
    contents:          contents,
    tools: [{
      retrieval: {
        vertexRagStore: {
          ragResources:   [{ ragCorpus: corpusName }],
          similarityTopK: 10
        }
      }
    }],
    generationConfig: { maxOutputTokens: 32768 }
  };

  var response = UrlFetchApp.fetch(url, {
    method:             "post",
    contentType:        "application/json",
    headers:            { Authorization: "Bearer " + token },
    payload:            JSON.stringify(payload),
    muteHttpExceptions: true
  });
  var code = response.getResponseCode();
  var body = response.getContentText();
  if (code !== 200) {
    logToAuditTrail("SocialVert", "error", "", "",
      "[ERROR] Social Vert RAG call returned " + code + ": " + body, "ERROR");
    throw new Error("Social Vert RAG call returned " + code + ": " + body);
  }

  var json       = JSON.parse(body);
  var candidates = json.candidates;
  if (!candidates || !candidates[0]) throw new Error("No candidates in Social Vert response.");
  var respParts  = candidates[0].content && candidates[0].content.parts;
  if (!respParts) throw new Error("No parts in Social Vert candidate.");
  // RAG responses may include grounding metadata parts alongside text — collect text only
  var text = respParts
    .filter(function(p) { return p.text; })
    .map(function(p)    { return p.text; })
    .join("");
  if (!text) throw new Error("Empty text in Social Vert response.");
  return text;
}

/**
 * Fallback for querySocialVert when the RAG corpus is unavailable (quota, provisioning).
 * Uses Gemini API directly with Social Vert persona. Multi-turn history is flattened
 * into the prompt. Chips format is preserved via system instruction.
 * @param {string}   userMessage
 * @param {object[]} history  — array of { role, content }
 * @returns {string}
 */
function querySocialVertDirect(userMessage, history) {
  var systemInstruction = SOCIAL_VERT_SYSTEM;

  var lines = [];
  if (Array.isArray(history)) {
    for (var i = 0; i < history.length; i++) {
      var turn   = history[i];
      var prefix = (turn.role === "model" || turn.role === "assistant") ? "Social Vert" : "JT";
      lines.push(prefix + ": " + turn.content);
    }
  }
  var prompt = lines.length ? lines.join("\n") + "\nJT: " + userMessage : userMessage;

  return callGeminiAPINoSearch(prompt, systemInstruction, "SocialVert");
}


// ── STUDIO / LIBRARIAN VERT ──────────────────────────────────────────────────

var STUDIO_SYSTEM_BASE =
  "You are Librarian Vert — the content intelligence engine inside the Studio for Don't Waste Your Pain (DWYP). " +
  "You have deep knowledge of all DWYP episodes through the corpus you can retrieve from. " +
  "DWYP is a faith-based podcast hosted by JT. The show features guests who have experienced profound pain " +
  "and turned it into purpose. The brand voice is warm, honest, direct, and redemptive. " +
  "Never be clinical or corporate. Write like a trusted collaborator who knows the show deeply.\n\n" +
  "If episode context is provided below, prioritize it. When citing episode content, be specific — name the guest, " +
  "reference the story. Return responses that are immediately usable, not rough drafts.\n\n";

var STUDIO_MODE_INSTRUCTIONS = {
  "images":
    "MODE: Image Direction. Surface raw material from episode content for use on graphic assets. " +
    "When returning hook ideas, format as: [[HOOK: the hook text]]\n" +
    "When returning quotes, format as: [[QUOTE: \"the quote text\" — Full Guest Name]]\n\n" +
    "HOOK — Based on a strong theme in the episode, synthesized from source material. " +
    "No more than 15 words. No heavy punctuation. Must stand alone and have meaning in a social media feed.\n\n" +
    "QUOTE — Verbatim from the transcript. No more than 20 words. Filler words may be removed. " +
    "Ellipsis may bridge two sentences only when the original meaning is fully intact. " +
    "Always include attribution with em-dash and full guest name. Wrapped in quotation marks.\n\n" +
    "Keep responses tight — 3–5 options maximum unless asked for more. No preamble. " +
    "No 'Here are your hooks!' Lead with the chips. One sentence of context maximum if something needs flagging.\n\n" +
    "Forbidden phrases — if any appear in a hook, rewrite before returning: " +
    "heart-centered · transformative journey · profound exploration · safe space · deeply moving · inspires us to · " +
    "in a world where · holds space · unpacks · dives deep · game-changer · resonates · impactful · raw and vulnerable · " +
    "bravely shares · courageously · showing up · healing journey · don't waste your pain · superpower",

  "episode-copy":
    "MODE: Writer. Draft episode copy, social posts, newsletter sections, or any written content for DWYP. " +
    "Match the show's voice: warm, honest, direct, redemptive. " +
    "Label each deliverable clearly. Lead with the strongest version. " +
    "Ask one clarifying question if the brief is too vague to write from.",

  "interview-prep":
    "MODE: Interview Prep. Help prepare for a guest interview. " +
    "Suggest research angles, opening questions, follow-up probes, and story hooks. " +
    "Draw from corpus knowledge of the guest if available. " +
    "Organize your response: Opening, Story Arc, Key Topics, Closing.",

  "social":
    "MODE: Social Media. Write captions, hooks, and post copy for social platforms. " +
    "Instagram: punchy, visual-first, 1–3 sentences max, strong opener. " +
    "Twitter/X: under 280 chars, no filler. LinkedIn: slightly longer, professional warmth. " +
    "Label each variation by platform. No hashtag suggestions unless asked.",

  "newsletter":
    "MODE: Newsletter. Write newsletter sections, story leads, and subscriber content. " +
    "Tone: like a letter from a trusted friend — personal, substantive, never promotional. " +
    "Standard sections: opener, episode spotlight, quote or story pull, call to action. " +
    "Keep total length under 400 words unless specified.",

  "outreach":
    "MODE: Outreach. Draft messages for guests, sponsors, or collaborators. " +
    "Be specific about what makes this person right for DWYP. " +
    "Do not be sycophantic. Lead with shared mission, not flattery. " +
    "Keep the ask clear and the message under 200 words.",

  "brainstorm":
    "MODE: Brainstorm. Serve as a creative thought partner. " +
    "Be generative — volume and variety over polish. " +
    "Organize ideas in short labeled groups. Challenge assumptions if it serves the work. " +
    "Ask a clarifying question if the brief is too open to be useful.",

  "writer":
    "MODE: Writer. Draft episode copy, social posts, newsletter sections, or any written content for DWYP. " +
    "Match the show's voice: warm, honest, direct, redemptive. " +
    "Label each deliverable clearly. Lead with the strongest version. " +
    "Ask one clarifying question if the brief is too vague to write from.",

  "show-notes":
    "MODE: Show Notes. Draft structured show notes for a DWYP episode. " +
    "Standard format: Episode Overview (2–3 sentences), Guest Bio (3–5 sentences), " +
    "Key Topics (bulleted), Notable Quotes (2–3), Resources section placeholder. " +
    "Match DWYP warmth and directness. Keep bio factual — no embellishment."
};

/**
 * Returns the Drive folder URL for a given episode, or the fallback social media folder.
 * Called by stOpenDrive() in the Studio UI.
 * @param {string} episodeUid
 * @returns {string} URL
 */
function getStudioDriveLink(episodeUid) {
  var fallback = "https://drive.google.com/drive/folders/1-j74fbb3FdWRY2smdzUjsCgcdfdeljbr";
  if (!episodeUid) return fallback;
  try {
    var folderId = getStagingFolderIdByUid(episodeUid);
    return folderId ? "https://drive.google.com/drive/folders/" + folderId : fallback;
  } catch (e) {
    return fallback;
  }
}

/**
 * Studio — Librarian Vert. Vertex AI RAG + Gemini, mode-aware system prompts.
 * Episode manifest is injected into the system prompt when episodeUid is supplied.
 *
 * Governance keys used:
 *   STUDIO_CORPUS_ID — full Vertex RAG corpus resource name
 *   MODEL_NAME       — Gemini model (fallback: gemini-2.0-flash)
 *
 * @param {string}   prompt
 * @param {string}   episodeUid — may be null/empty for general queries
 * @param {string}   mode       — images|writer|outreach|interview-prep|brainstorm|show-notes
 * @param {object[]} history    — array of { role, content }
 * @returns {{ success: boolean, text?: string, error?: string }}
 */
function callStudioLLM(prompt, episodeUid, mode, history) {
  try {
    var corpusName = getGovernance("STUDIO_CORPUS_ID");
    if (!corpusName) throw new Error("STUDIO_CORPUS_ID not configured in Governance_Config.");

    var project        = corpusName.split("/")[1];
    var endpointRegion = "us-central1";
    var model          = getGovernance("MODEL_NAME") || "gemini-2.0-flash";
    var token          = ScriptApp.getOAuthToken();
    var url            = "https://" + endpointRegion + "-aiplatform.googleapis.com/v1beta1/projects/" +
                         project + "/locations/" + endpointRegion +
                         "/publishers/google/models/" + model + ":generateContent";

    // Build system instruction: base + mode + optional episode context
    var modeKey   = mode || "images";
    var modeInstr = STUDIO_MODE_INSTRUCTIONS[modeKey] || STUDIO_MODE_INSTRUCTIONS["brainstorm"];
    var systemText = STUDIO_SYSTEM_BASE + modeInstr;

    var guestName = null;
    if (episodeUid) {
      try {
        var manifest  = getEpisodeManifest(episodeUid);
        guestName     = manifest.guest_name || null;
        var ctxLines  = [];
        if (guestName)            ctxLines.push("Guest: " + guestName);
        if (manifest.episode_uid) ctxLines.push("Episode UID: " + manifest.episode_uid);
        if (manifest.raw_hooks  && manifest.raw_hooks.length) {
          ctxLines.push("Hooks from this episode:\n" + manifest.raw_hooks.slice(0, 10).join("\n"));
        }
        if (manifest.raw_quotes && manifest.raw_quotes.length) {
          ctxLines.push("Quotes from this episode:\n" + manifest.raw_quotes.slice(0, 10).join("\n"));
        }
        if (ctxLines.length) systemText += "\n\nEPISODE CONTEXT:\n" + ctxLines.join("\n");
      } catch (ctxErr) {
        // Episode context is supplemental — proceed without it
      }
    }

    // Prefix the retrieval query with the guest name so Vertex RAG targets the right episode.
    // The history is stored with the original prompt; only the final turn sent to Vertex is augmented.
    var retrievalQuery = guestName ? guestName + " — " + prompt : prompt;

    var contents = [];
    if (Array.isArray(history)) {
      for (var i = 0; i < history.length; i++) {
        var turn = history[i];
        contents.push({
          role:  (turn.role === "model" || turn.role === "assistant") ? "model" : "user",
          parts: [{ text: turn.content }]
        });
      }
    }
    contents.push({ role: "user", parts: [{ text: retrievalQuery }] });

    var payload = {
      systemInstruction: { parts: [{ text: systemText }] },
      contents:          contents,
      tools: [{
        retrieval: {
          vertexRagStore: {
            ragResources:   [{ ragCorpus: corpusName }],
            similarityTopK: 10
          }
        }
      }],
      generationConfig: { maxOutputTokens: 32768 }
    };

    var response = UrlFetchApp.fetch(url, {
      method:             "post",
      contentType:        "application/json",
      headers:            { Authorization: "Bearer " + token },
      payload:            JSON.stringify(payload),
      muteHttpExceptions: true
    });
    var code = response.getResponseCode();
    var body = response.getContentText();
    if (code !== 200) {
      logToAuditTrail("StudioLLM", "error", episodeUid || "", "",
        "[ERROR] callStudioLLM returned " + code + ": " + body, "ERROR");
      return { success: false, error: "Vert returned " + code + ". Check the audit log." };
    }

    var json       = JSON.parse(body);
    var candidates = json.candidates;
    if (!candidates || !candidates[0]) return { success: false, error: "No candidates in response." };
    var respParts  = candidates[0].content && candidates[0].content.parts;
    if (!respParts) return { success: false, error: "No parts in response candidate." };
    var text = respParts
      .filter(function(p) { return p.text; })
      .map(function(p)    { return p.text; })
      .join("");
    if (!text) return { success: false, error: "Empty response from Vert." };

    return { success: true, text: text };
  } catch (err) {
    logToAuditTrail("StudioLLM", "error", episodeUid || "", "",
      "[ERROR] callStudioLLM threw: " + err.message, "ERROR");
    return { success: false, error: err.message };
  }
}


/**
 * Closes all open review tasks for the episode, then spawns an Audra filing task.
 * Workflow_Steps closed: Review_Episode, Review_Host_Graphics, Review_Guest_Graphics, Review_Reels.
 * @param {string} episodeUid
 * @returns {{ success: true }}
 */
function triggerReadyForRelease(episodeUid) {
  try {
    var REVIEW_STEPS = ["Review_Episode", "Review_Host_Graphics", "Review_Guest_Graphics", "Review_Reels"];

    var sheetId = PropertiesService.getScriptProperties().getProperty("MASTER_SHEET_ID");
    var ss      = SpreadsheetApp.openById(sheetId);
    var sheet   = ss.getSheetByName("Tasks");
    var data    = sheet.getDataRange().getValues();
    var now     = new Date();

    for (var r = 1; r < data.length; r++) {
      var row = data[r];
      if (String(row[TASKS_COLS.Episode_UID - 1]) !== String(episodeUid))         continue;
      if (String(row[TASKS_COLS.Status      - 1]) === "complete")                 continue;
      if (REVIEW_STEPS.indexOf(String(row[TASKS_COLS.Workflow_Step - 1])) === -1) continue;
      sheet.getRange(r + 1, TASKS_COLS.Status).setValue("complete");
      sheet.getRange(r + 1, TASKS_COLS.Completed_At).setValue(now);
    }

    var manifest  = getManifest(getStagingFolderIdByUid(episodeUid));
    var guestName = (manifest && manifest.guest_name) ? manifest.guest_name : episodeUid;

    spawnTask({
      episodeUid:   episodeUid,
      workflowStep: "Filing",
      actionTitle:  "Assets ready to file — " + guestName,
      assignee:     getGovernance("ASSIGNEE_PRODUCER"),
      assignedBy:   "The Fairy Team",
      status:       "open",
      priority:     "normal"
    });

    return { success: true };
  } catch (err) {
    throw new Error("triggerReadyForRelease failed for " + episodeUid + ": " + err.message);
  }
}


// ── CONTACTS ─────────────────────────────────────────────────────────────────

// Fields the front end is allowed to write. Everything else is schema-protected.
var CONTACTS_WRITABLE = { Tags: true, Personal_Note: true, Influence_Tier: true };

function getContacts() {
  try {
    var sheetId = PropertiesService.getScriptProperties().getProperty("MASTER_SHEET_ID");
    var ss      = SpreadsheetApp.openById(sheetId);
    var sheet   = ss.getSheetByName("Contacts");
    var data    = sheet.getDataRange().getValues();
    if (data.length < 2) return [];

    var headers  = data[0];
    var idIdx    = headers.indexOf("Contact_ID");
    var contacts = [];

    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (!row[idIdx]) continue;
      var contact = {};
      headers.forEach(function(h, idx) {
        var v = row[idx];
        contact[h] = (v !== null && v !== undefined) ? String(v) : "";
      });
      contact._rowIndex = i + 1;
      contacts.push(contact);
    }

    contacts.sort(function(a, b) {
      var da = a.Last_Activity ? new Date(a.Last_Activity) : new Date(0);
      var db = b.Last_Activity ? new Date(b.Last_Activity) : new Date(0);
      return db - da;
    });

    return contacts;
  } catch(e) {
    throw new Error("getContacts failed: " + e.message);
  }
}

function updateContactField(rowIndex, field, value) {
  if (!CONTACTS_WRITABLE[field]) throw new Error("Field not writable from front end: " + field);
  try {
    var sheetId = PropertiesService.getScriptProperties().getProperty("MASTER_SHEET_ID");
    var ss      = SpreadsheetApp.openById(sheetId);
    var sheet   = ss.getSheetByName("Contacts");
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var col     = headers.indexOf(field);
    if (col === -1) throw new Error("Column not found in Contacts sheet: " + field);
    sheet.getRange(rowIndex, col + 1).setValue(value);
    return { success: true };
  } catch(e) {
    throw new Error("updateContactField failed: " + e.message);
  }
}

// ── QUICK CAPTION ─────────────────────────────────────────────

var QUICK_CAPTION_SYSTEM =
  'You are a social media caption writer for a podcast called "Don\'t Waste Your Pain," hosted by JT. ' +
  'You watch short video clips or look at images, then write Instagram captions that match the show\'s voice: ' +
  'honest, hopeful, emotionally intelligent — never performative.\n\n' +
  'FIRST CALL — always return exactly three options using these exact headers (with the brackets):\n\n' +
  '[SHORT · HOOK]\n' +
  'One punchy hook. 1–3 lines max. Up to 3 hashtags. One emoji is fine, none is fine.\n\n' +
  '[MEDIUM · PERSONAL]\n' +
  '3–5 lines. Personal voice. Up to 4 hashtags.\n\n' +
  '[LONGER · STORY]\n' +
  '5–8 lines. Narrative arc that earns its ending. Up to 5 hashtags.\n\n' +
  'REVISION CALLS — return exactly one option using this exact header:\n\n' +
  '[REVISED]\n' +
  'The revised caption.\n\n' +
  'VOICE RULES:\n' +
  '- Never open with "I"\n' +
  '- Never use: journey, pouring my heart out, this one is special, honored, humbled, blessed, spaces, show up\n' +
  '- No promotional language, no throat-clearing, no preamble before the caption\n' +
  '- Don\'t narrate what you\'re doing — just write the caption';

/**
 * Analyzes an uploaded image or video and returns three Instagram caption options.
 * Images sent as inline base64. Videos uploaded to Gemini File API via qcUploadToFileApi.
 * @param {string} fileBase64 — base64 file content (no data-URI prefix)
 * @param {string} mimeType  — e.g. "image/jpeg", "video/mp4"
 * @returns {string} Gemini response with [SHORT · HOOK], [MEDIUM · PERSONAL], [LONGER · STORY] blocks
 */
function getQuickCaptions(fileBase64, mimeType) {
  try {
    return _getQuickCaptionsImpl(fileBase64, mimeType);
  } catch (e) {
    logToAuditTrail("QuickCaption", "error", "", "", "[THROW] " + e.name + ": " + e.message + "\n" + (e.stack || ""), "ERROR");
    throw e;
  }
}

function _getQuickCaptionsImpl(fileBase64, mimeType) {
  var apiKey = getGovernance("GEMINI_API_KEY");
  var model  = getGovernance("MODEL_NAME") || "gemini-2.0-flash";
  var url    = "https://generativelanguage.googleapis.com/v1beta/models/" +
               model + ":generateContent?key=" + apiKey;

  var isVideo = mimeType.indexOf("video/") === 0;
  var filePart;
  if (isVideo) {
    var fileUri = qcUploadToFileApi(fileBase64, mimeType, apiKey);
    filePart = { fileData: { mimeType: mimeType, fileUri: fileUri } };
  } else {
    filePart = { inlineData: { mimeType: mimeType, data: fileBase64 } };
  }

  var payload = {
    systemInstruction: { parts: [{ text: QUICK_CAPTION_SYSTEM }] },
    contents: [{
      role:  "user",
      parts: [filePart, { text: "Write three Instagram caption options for this." }]
    }],
    generationConfig: { maxOutputTokens: 4096 }
  };

  var response = UrlFetchApp.fetch(url, {
    method:             "post",
    contentType:        "application/json",
    payload:            JSON.stringify(payload),
    muteHttpExceptions: true
  });
  var code = response.getResponseCode();
  var body = response.getContentText();
  if (code !== 200) {
    logToAuditTrail("QuickCaption", "error", "", "", "[ERROR] getQuickCaptions returned " + code + ": " + body, "ERROR");
    throw new Error("Caption generation failed (" + code + ").");
  }
  var json       = JSON.parse(body);
  var candidates = json.candidates;
  if (!candidates || !candidates[0]) throw new Error("No candidates in response.");
  var parts = candidates[0].content && candidates[0].content.parts;
  if (!parts) throw new Error("No content parts in response.");
  return parts.filter(function(p) { return p.text; }).map(function(p) { return p.text; }).join("");
}

/**
 * Uploads a video to the Gemini File API via resumable upload (GAS-side).
 * Polls until state = ACTIVE before returning the fileUri.
 */
function qcUploadToFileApi(fileBase64, mimeType, apiKey) {
  var bytes      = Utilities.base64Decode(fileBase64);
  var blob       = Utilities.newBlob(bytes, mimeType, "reel_caption");
  var byteLength = bytes.length;

  var initUrl  = "https://generativelanguage.googleapis.com/upload/v1beta/files?uploadType=resumable&key=" + apiKey;
  var initResp = UrlFetchApp.fetch(initUrl, {
    method:  "post",
    headers: {
      "X-Goog-Upload-Protocol":              "resumable",
      "X-Goog-Upload-Command":               "start",
      "X-Goog-Upload-Header-Content-Length": byteLength,
      "X-Goog-Upload-Header-Content-Type":   mimeType,
      "Content-Type":                        "application/json"
    },
    payload:            JSON.stringify({ file: { display_name: "reel_caption" } }),
    muteHttpExceptions: true
  });
  if (initResp.getResponseCode() !== 200) {
    throw new Error("File API init failed (" + initResp.getResponseCode() + "): " + initResp.getContentText());
  }

  var uploadUrl = initResp.getHeaders()["X-Goog-Upload-URL"];
  if (!uploadUrl) throw new Error("File API response missing upload URL.");

  var uploadResp = UrlFetchApp.fetch(uploadUrl, {
    method:  "post",
    headers: {
      "X-Goog-Upload-Offset":  "0",
      "X-Goog-Upload-Command": "upload, finalize"
    },
    payload:            blob,
    muteHttpExceptions: true
  });
  if (uploadResp.getResponseCode() !== 200) {
    throw new Error("File API upload failed (" + uploadResp.getResponseCode() + "): " + uploadResp.getContentText());
  }

  var uploadJson = JSON.parse(uploadResp.getContentText());
  var fileName   = uploadJson.file && uploadJson.file.name;
  var fileUri    = uploadJson.file && uploadJson.file.uri;
  if (!fileUri) throw new Error("File API response missing uri: " + uploadResp.getContentText());

  var maxWait = 30000;
  var waited  = 0;
  while (waited < maxWait) {
    Utilities.sleep(3000);
    waited += 3000;
    var checkUrl  = "https://generativelanguage.googleapis.com/v1beta/" + fileName + "?key=" + apiKey;
    var checkResp = UrlFetchApp.fetch(checkUrl, { muteHttpExceptions: true });
    if (checkResp.getResponseCode() === 200) {
      var fileState = JSON.parse(checkResp.getContentText()).state;
      if (fileState === "ACTIVE") return fileUri;
      if (fileState === "FAILED") throw new Error("Gemini File API processing failed.");
    }
  }
  throw new Error("File did not become ACTIVE within 30s — try a shorter clip.");
}

/**
 * Sends a follow-up message for caption tweaks. No file re-upload — history carries context.
 * @param {string}   userMessage
 * @param {object[]} history — [{role:"user"|"model", content:string}, ...]
 * @returns {string} Gemini response with [REVISED] block
 */
function continueQuickCaption(userMessage, history) {
  var apiKey = getGovernance("GEMINI_API_KEY");
  var model  = getGovernance("MODEL_NAME") || "gemini-2.0-flash";
  var url    = "https://generativelanguage.googleapis.com/v1beta/models/" +
               model + ":generateContent?key=" + apiKey;

  var contents = [];
  if (Array.isArray(history)) {
    for (var i = 0; i < history.length; i++) {
      var t = history[i];
      contents.push({
        role:  (t.role === "model") ? "model" : "user",
        parts: [{ text: t.content }]
      });
    }
  }
  contents.push({ role: "user", parts: [{ text: userMessage }] });

  var payload = {
    systemInstruction: { parts: [{ text: QUICK_CAPTION_SYSTEM }] },
    contents:          contents,
    generationConfig:  { maxOutputTokens: 2048 }
  };

  var response = UrlFetchApp.fetch(url, {
    method:             "post",
    contentType:        "application/json",
    payload:            JSON.stringify(payload),
    muteHttpExceptions: true
  });
  var code = response.getResponseCode();
  var body = response.getContentText();
  if (code !== 200) {
    logToAuditTrail("QuickCaption", "error", "", "", "[ERROR] continueQuickCaption returned " + code + ": " + body, "ERROR");
    throw new Error("Caption revision failed (" + code + ").");
  }
  var json       = JSON.parse(body);
  var candidates = json.candidates;
  if (!candidates || !candidates[0]) throw new Error("No candidates in response.");
  var parts = candidates[0].content && candidates[0].content.parts;
  if (!parts) throw new Error("No content parts in response.");
  return parts.filter(function(p) { return p.text; }).map(function(p) { return p.text; }).join("");
}

