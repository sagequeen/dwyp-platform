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

function generateBackground(prompt, imageBase64, mimeType) {
  try {
    var result    = callGeminiImageAPI(
      BG_GEN_SYSTEM + "\n\nUser request: " + prompt,
      imageBase64 || null,
      mimeType    || null,
      "ImageWorkshop"
    );
    var libraryId = getGovernance("IMAGE_BACKGROUND_LIBRARY_ID");
    if (!libraryId) return { success: false, error: "IMAGE_BACKGROUND_LIBRARY_ID not configured" };

    var now      = new Date();
    var pad      = function(n) { return String(n).padStart(2, "0"); };
    var ts       = String(now.getFullYear()).slice(2) +
                   pad(now.getMonth() + 1) + pad(now.getDate()) + "-" +
                   pad(now.getHours())     + pad(now.getMinutes());
    var ext      = (result.mimeType === "image/jpeg") ? "jpg" : "png";
    var filename = "bg_gen_" + ts + "." + ext;

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
 * Decodes a base64 PNG and writes it to the episode's Production folder.
 * Filename: image_[episodeUid]_[timestamp].png
 * base64Data may include a data-URL prefix — stripped automatically.
 * @param {string} episodeUid
 * @param {string} base64Data
 * @returns {{ success: true, filename: string } | { success: false, error: string }}
 */
function saveImageToStaging(episodeUid, base64Data) {
  try {
    var folderId = getStagingFolderIdByUid(episodeUid);
    if (!folderId) return { success: false, error: "Production folder not found for episode: " + episodeUid };
    var now      = new Date();
    var pad      = function(n) { return String(n).padStart(2, "0"); };
    var ts       = String(now.getFullYear()).slice(2) +
                   pad(now.getMonth() + 1) + pad(now.getDate()) + "-" +
                   pad(now.getHours())     + pad(now.getMinutes());
    var filename = "image_" + episodeUid + "_" + ts + ".png";
    var raw      = base64Data.replace(/^data:[^;]+;base64,/, "");
    var blob     = Utilities.newBlob(Utilities.base64Decode(raw), "image/png", filename);
    DriveApp.getFolderById(folderId).createFile(blob);
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

    var file    = DriveApp.getFileById(fileId);
    var parents = file.getParents();
    while (parents.hasNext()) parents.next().removeFile(file);
    decisionFolder.addFile(file);

    return { success: true };
  } catch (err) {
    throw new Error("moveReviewFile failed for " + fileId + ": " + err.message);
  }
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

    var found = false;
    for (var r = 1; r < data.length; r++) {
      var row = data[r];
      if (String(row[TASKS_COLS.Episode_UID   - 1]) !== String(episodeUid)) continue;
      if (String(row[TASKS_COLS.Workflow_Step - 1]) !== "Review_Episode")   continue;
      if (String(row[TASKS_COLS.Status        - 1]) === "complete")         continue;
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
        workflowStep:     "Review_Episode",
        actionTitle:      "Episode Comments — " + guestName,
        assignee:         getGovernance("ASSIGNEE_PRODUCER"),
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
