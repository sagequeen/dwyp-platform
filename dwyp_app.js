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

    var sheetId = getMasterSheetId();
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

// Social_Assets tab column map (13 columns — scheduling + Make integration only)
var SOCIAL_ASSETS_COLS = {
  Post_ID:          1,
  Asset_Library_ID: 2,  // FK → Asset_Library
  Episode_UID:      3,
  Slot:             4,
  Asset_Type:       5,
  Platform:         6,
  Caption:          7,
  Drive_File_ID:    8,
  Scheduled_At:     9,
  Scheduler_Status: 10,
  Posted_At:        11,
  Created_At:       12,
  Created_By:       13
};

// Asset_Library tab column map (18 columns — single source of truth for content assets)
var ASSET_LIBRARY_COLS = {
  Asset_ID:      1,
  Episode_UID:   2,
  Asset_Type:    3,
  Drive_File_ID: 4,
  Display_Name:  5,
  Slide_Index:   6,
  Quote_Text:    7,
  Reel_Summary:  8,
  Image_Prompt:  9,
  Caption_Draft: 10,
  Caption_Final: 11,
  Notes:         12,
  Background_ID: 13,
  Canvas_State:  14,
  Status:        15,  // candidate | scheduled | bank | rejected
  Availability:  16,  // available | placed | paired
  Created_At:    17,
  Created_By:    18
};

// Posting_Schedule tab column map (6 columns)
var POSTING_SCHEDULE_COLS = {
  Slot_ID:    1,
  Day:        2,
  Asset_Type: 3,
  Platform:   4,
  Why:        5,
  Sort_Order: 6
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


// ── SERVER: VERSION ENDPOINTS ────────────────────────────────────────────────

/**
 * Returns all domain versions as a flat object { domain: versionNumber }.
 * Called by the frontend on tab return to determine which domains need a refetch.
 * image_library uses a Drive folder hybrid — auto-bumps if Drive is newer than
 * the last bumpVersion() call (catches external file additions by Audra).
 */
function getAllVersions() {
  var sheetId = getMasterSheetId();
  var ss      = SpreadsheetApp.openById(sheetId);
  var sheet   = ss.getSheetByName("Versions");
  if (!sheet) return {};

  var data   = sheet.getDataRange().getValues();
  var result = {};
  for (var i = 1; i < data.length; i++) {
    var domain = String(data[i][0]).trim();
    if (!domain) continue;
    result[domain] = domain === "image_library"
      ? _resolveImageLibraryVersion(data[i])
      : (Number(data[i][1]) || 0);
  }
  return result;
}

/**
 * Returns the current version number for a single domain.
 * image_library applies the same Drive folder hybrid as getAllVersions().
 */
function getDomainVersion(domain) {
  var sheetId = getMasterSheetId();
  var ss      = SpreadsheetApp.openById(sheetId);
  var sheet   = ss.getSheetByName("Versions");
  if (!sheet) return 0;

  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === domain) {
      return domain === "image_library"
        ? _resolveImageLibraryVersion(data[i])
        : (Number(data[i][1]) || 0);
    }
  }
  return 0;
}

/**
 * image_library hybrid resolver.
 * Compares the Drive folder's last-updated timestamp to the Versions row's
 * Last_Modified. If Drive is newer, calls bumpVersion("image_library") to
 * record the external change and returns the bumped version number.
 * Fails closed to the sheet version on any Drive API error.
 */
function _resolveImageLibraryVersion(versionRow) {
  var sheetVersion = Number(versionRow[1]) || 0;
  try {
    var folderId = getGovernance("IMAGE_BACKGROUND_LIBRARY_ID");
    if (!folderId) return sheetVersion;
    var folder       = DriveApp.getFolderById(folderId);
    var lastModified = versionRow[2] instanceof Date ? versionRow[2] : new Date(versionRow[2]);
    var files = folder.getFiles();
    var newestMod = null;
    while (files.hasNext()) {
      var fileMod = files.next().getLastUpdated();
      if (!newestMod || fileMod > newestMod) newestMod = fileMod;
    }
    if (newestMod && newestMod > lastModified) {
      var bumped = bumpVersion("image_library", "drive_sync");
      return bumped !== null ? bumped : sheetVersion;
    }
    return sheetVersion;
  } catch (e) {
    return sheetVersion;
  }
}

/**
 * Batch-fetches data for the active frontend loader domains.
 * Accepts an array of domain names (subset of ['tasks','episodes','contacts']).
 * Returns an object keyed by domain with fetched data.
 * Domains outside the active set are silently skipped.
 * Per-domain failures are caught and logged; other domains succeed normally.
 */
function getDomainsBatch(domains) {
  var FETCHABLE = { tasks: true, episodes: true, contacts: true };
  var result    = {};
  for (var i = 0; i < domains.length; i++) {
    var d = domains[i];
    if (!FETCHABLE[d]) continue;
    try {
      if (d === 'tasks')    result.tasks    = getTasks();
      if (d === 'episodes') result.episodes = getEpisodes();
      if (d === 'contacts') result.contacts = getContacts();
    } catch (e) {
      Logger.log('[getDomainsBatch] domain=' + d + ' failed: ' + e.message);
    }
  }
  return result;
}


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
  var sheetId     = getMasterSheetId();
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
  var hostName      = String(govMap["HOST_NAME"] || "").trim();
  var gemsUrl       = cleanUrl(govMap["IMAGE_WORKSHOP_GEM"]);
  var notebooklmUrl = cleanUrl(govMap["NOTEBOOKLM_LINK"]);
  var ownerEmail    = Session.getEffectiveUser().getEmail();

  var template = HtmlService.createTemplateFromFile("dwyp_ui");
  template.sheetId       = sheetId;
  template.deployedUrl   = deployedUrl;
  template.hostEmail     = hostEmail;
  template.hostName      = hostName;
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
  var sheetId = getMasterSheetId();
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
  var sheetId = getMasterSheetId();
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
    var sheetId = getMasterSheetId();
    var ss      = SpreadsheetApp.openById(sheetId);
    var sheet   = ss.getSheetByName("Tasks");

    sheet.getRange(rowIndex, TASKS_COLS.Status).setValue("complete");
    sheet.getRange(rowIndex, TASKS_COLS.Completed_At).setValue(new Date());
    bumpVersion("tasks", "writeTaskComplete");
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
    var sheetId = getMasterSheetId();
    var ss      = SpreadsheetApp.openById(sheetId);
    var sheet   = ss.getSheetByName("Tasks");
    sheet.deleteRow(rowIndex);
    bumpVersion("tasks", "deleteTaskRow");
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
  var sheetId = getMasterSheetId();
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
    var sheetId = getMasterSheetId();
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
    bumpVersion("tasks", "createTask");
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
    var sheetId = getMasterSheetId();
    var ss      = SpreadsheetApp.openById(sheetId);
    var alName  = getGovernance("ASSET_LIBRARY_TAB_NAME") || "Asset_Library";
    var sheet   = ss.getSheetByName(alName);
    if (!sheet) return { reels: 0, images: 0 };
    var data = sheet.getDataRange().getValues();

    function normType(t) { return String(t).toLowerCase().replace(/[_ ]/g,''); }
    var IMAGE_TYPES = ["quotegraphic", "thumbnail", "bankclip"];
    var reels = 0, images = 0;

    for (var i = 1; i < data.length; i++) {
      var row   = data[i];
      if (String(row[ASSET_LIBRARY_COLS.Episode_UID  - 1]) !== String(episodeUid)) continue;
      if (String(row[ASSET_LIBRARY_COLS.Status       - 1]).toLowerCase() !== "candidate") continue;
      var avail = String(row[ASSET_LIBRARY_COLS.Availability - 1]).toLowerCase();
      if (avail === "placed" || avail === "paired") continue;
      var assetType = normType(row[ASSET_LIBRARY_COLS.Asset_Type - 1]);
      if (assetType === "reel")                    reels++;
      if (IMAGE_TYPES.indexOf(assetType) !== -1)   images++;
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
    var sheetId = getMasterSheetId();
    var ss      = SpreadsheetApp.openById(sheetId);
    var sheet   = ss.getSheetByName("Episodes");
    var data    = sheet.getDataRange().getValues();

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][EPISODES_COLS.Episode_UID - 1]) === String(episodeUid)) {
        sheet.getRange(i + 1, EPISODES_COLS.Video_Status).setValue(status);
        bumpVersion("episodes", "writeVideoStatus");
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
    var sheetId = getMasterSheetId();
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
    var sheetId = getMasterSheetId();
    var ss      = SpreadsheetApp.openById(sheetId);
    var alName  = getGovernance("ASSET_LIBRARY_TAB_NAME") || "Asset_Library";
    var sheet   = ss.getSheetByName(alName);
    if (!sheet) return [];
    var data    = sheet.getDataRange().getValues();

    function normalizeType(t) { return String(t).toLowerCase().replace(/[_ ]/g,''); }
    var rawTypes = Array.isArray(assetType) ? assetType : [assetType];
    var types    = rawTypes.map(normalizeType);
    var assets   = [];

    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (String(row[ASSET_LIBRARY_COLS.Episode_UID - 1]) !== String(episodeUid)) continue;
      if (String(row[ASSET_LIBRARY_COLS.Status      - 1]).toLowerCase() !== "candidate") continue;
      if (types.indexOf(normalizeType(row[ASSET_LIBRARY_COLS.Asset_Type - 1])) === -1) continue;
      var avail = String(row[ASSET_LIBRARY_COLS.Availability - 1]).toLowerCase();
      if (avail === "placed" || avail === "paired") continue;

      var fileId = String(row[ASSET_LIBRARY_COLS.Drive_File_ID - 1]);
      var assetId = String(row[ASSET_LIBRARY_COLS.Asset_ID - 1]);
      assets.push({
        _rowIndex:    i + 1,
        Post_ID:      assetId,  // UI compat — Asset_ID is the identifier
        Asset_ID:     assetId,
        Episode_UID:  String(row[ASSET_LIBRARY_COLS.Episode_UID  - 1]),
        Asset_Type:   String(row[ASSET_LIBRARY_COLS.Asset_Type   - 1]),
        Drive_File_ID: fileId,
        Caption:      String(row[ASSET_LIBRARY_COLS.Caption_Draft - 1] || ''),
        Status:       String(row[ASSET_LIBRARY_COLS.Status        - 1]),
        Slide_Index:  String(row[ASSET_LIBRARY_COLS.Slide_Index   - 1]),
        Availability: String(row[ASSET_LIBRARY_COLS.Availability  - 1]),
        Display_Name: String(row[ASSET_LIBRARY_COLS.Display_Name  - 1]),
        Summary:      String(row[ASSET_LIBRARY_COLS.Reel_Summary  - 1] || ''),
        thumbnailUrl: fileId ? 'https://drive.google.com/thumbnail?id=' + fileId + '&sz=w160' : ''
      });
    }

    // Drive fallback: if no sheet rows exist, scan Staging subfolder
    if (assets.length === 0) {
      assets = getStagingCandidates_(episodeUid, rawTypes[0]);
    }

    return assets;
  } catch (err) {
    return [];
  }
}

/**
 * Scans the episode's Staging Drive folder for candidates when Social_Assets has no rows.
 * Quote_Graphic / Bank_Clip → Images/  |  Reel → Reels/  |  Thumbnail → Thumbnails/
 * Prefers Approved/ subfolder when present; falls back to folder root.
 */
function getStagingCandidates_(episodeUid, assetType) {
  try {
    var stagingId = getStagingFolderIdByUid(episodeUid);
    if (!stagingId) return [];
    var stagingFolder = DriveApp.getFolderById(stagingId);

    var norm = String(assetType).toLowerCase().replace(/[_ ]/g,'');
    var folderName = (norm === 'reel') ? 'Reels' : (norm === 'thumbnail') ? 'Thumbnails' : 'Images';

    var typeFolderIt = stagingFolder.getFoldersByName(folderName);
    if (!typeFolderIt.hasNext()) return [];
    var typeFolder = typeFolderIt.next();

    var fileObjs = [];
    var approvedIt = typeFolder.getFoldersByName('Approved');
    if (approvedIt.hasNext()) {
      var approvedIt2 = approvedIt.next().getFiles();
      while (approvedIt2.hasNext()) fileObjs.push(approvedIt2.next());
    }
    if (!fileObjs.length) {
      var rootIt = typeFolder.getFiles();
      while (rootIt.hasNext()) fileObjs.push(rootIt.next());
    }

    var normCheck = String(assetType).toLowerCase().replace(/[_ ]/g,'');
    var isReel    = (normCheck === 'reel' || normCheck === 'bankclip');
    if (isReel) {
      fileObjs = fileObjs.filter(function(f) { return f.getMimeType() === 'video/mp4'; });
    }
    return fileObjs.map(function(f, idx) {
      var id          = f.getId();
      var displayName = isReel ? ('Reel ' + (idx + 1)) : '';
      return {
        _rowIndex:    -1,
        Post_ID:      id,   // Drive file ID as fallback identifier
        Asset_ID:     null, // No AL row yet
        Episode_UID:  episodeUid,
        Asset_Type:   assetType,
        Drive_File_ID: id,
        Caption:      '',
        Status:       'candidate',
        Slide_Index:  '',
        Availability: 'available',
        Display_Name: displayName,
        Summary:      '',
        thumbnailUrl: 'https://drive.google.com/thumbnail?id=' + id + '&sz=w160',
        _fromDrive:   true
      };
    });
  } catch (err) {
    return [];
  }
}

/**
 * Updates Display_Name on an Asset_Library row and renames the Drive file.
 * Called when JT edits a reel tile's display name in the Publish left panel.
 * assetId null means Drive-fallback asset with no AL row — Drive rename only.
 */
function updateReelDisplayName(assetId, newName, fileId) {
  try {
    if (assetId) {
      var sheetId = getMasterSheetId();
      var ss      = SpreadsheetApp.openById(sheetId);
      var alName  = getGovernance("ASSET_LIBRARY_TAB_NAME") || "Asset_Library";
      var sheet   = ss.getSheetByName(alName);
      if (sheet) {
        var data = sheet.getDataRange().getValues();
        for (var i = 1; i < data.length; i++) {
          if (String(data[i][ASSET_LIBRARY_COLS.Asset_ID - 1]) === String(assetId)) {
            sheet.getRange(i + 1, ASSET_LIBRARY_COLS.Display_Name).setValue(newName);
            break;
          }
        }
      }
    }
    if (fileId) {
      DriveApp.getFileById(fileId).setName(newName);
    }
    bumpVersion("asset_library", "updateReelDisplayName");
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Writes Status on an Asset_Library row by Asset_ID.
 * @param {string} assetId - Asset_Library Asset_ID (_rowIndex no longer used)
 * @param {string} status  - 'candidate' | 'scheduled' | 'bank' | 'rejected'
 * @returns {{ success: boolean, error?: string }}
 */
function writeSocialAssetStatus(assetId, status) {
  try {
    var sheetId = getMasterSheetId();
    var ss      = SpreadsheetApp.openById(sheetId);
    var alName  = getGovernance("ASSET_LIBRARY_TAB_NAME") || "Asset_Library";
    var sheet   = ss.getSheetByName(alName);
    if (!sheet) return { success: false, error: "Asset_Library tab not found" };
    var data    = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][ASSET_LIBRARY_COLS.Asset_ID - 1]) !== String(assetId)) continue;
      sheet.getRange(i + 1, ASSET_LIBRARY_COLS.Status).setValue(status);
      bumpVersion("asset_library", "writeSocialAssetStatus");
      return { success: true };
    }
    return { success: false, error: "Asset not found: " + assetId };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Returns the Posting_Schedule template + placed Social_Assets for an episode.
 * Used by the Publish tab to render the week accordion.
 * @param {string} episodeUid
 * @returns {{ days: Array, error?: string }}
 */
function getPublishSchedule(episodeUid) {
  try {
    var sheetId   = getMasterSheetId();
    var ss        = SpreadsheetApp.openById(sheetId);
    var schedSheet = ss.getSheetByName("Posting_Schedule");
    if (!schedSheet) return { days: [], error: "Posting_Schedule tab not found" };
    var schedData  = schedSheet.getDataRange().getValues();

    var saSheet = ss.getSheetByName("Social_Assets");
    var saData  = saSheet ? saSheet.getDataRange().getValues() : [[]];

    var placedBySlot = {};
    for (var i = 1; i < saData.length; i++) {
      var row    = saData[i];
      var epUid  = String(row[SOCIAL_ASSETS_COLS.Episode_UID - 1]);
      if (epUid !== String(episodeUid)) continue;
      var slotId = String(row[SOCIAL_ASSETS_COLS.Slot - 1]);
      if (!slotId) continue;  // any SA row with a Slot value is placed
      var fid = String(row[SOCIAL_ASSETS_COLS.Drive_File_ID - 1]);
      placedBySlot[slotId] = {
        postId:         String(row[SOCIAL_ASSETS_COLS.Post_ID          - 1]),
        assetLibraryId: String(row[SOCIAL_ASSETS_COLS.Asset_Library_ID - 1]),
        driveFileId:    fid,
        caption:        String(row[SOCIAL_ASSETS_COLS.Caption          - 1]),
        schedulerStatus: String(row[SOCIAL_ASSETS_COLS.Scheduler_Status - 1]),
        assetType:      String(row[SOCIAL_ASSETS_COLS.Asset_Type       - 1]),
        thumbnailUrl:   fid ? "https://drive.google.com/thumbnail?id=" + fid + "&sz=w160" : ""
      };
    }

    var DAY_ORDER = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
    var dayMap    = {};
    DAY_ORDER.forEach(function(d) { dayMap[d] = []; });

    for (var j = 1; j < schedData.length; j++) {
      var s      = schedData[j];
      var sid    = String(s[POSTING_SCHEDULE_COLS.Slot_ID - 1]);
      var day    = String(s[POSTING_SCHEDULE_COLS.Day    - 1]);
      if (!sid || !day || !dayMap[day]) continue;
      dayMap[day].push({
        slotId:    sid,
        assetType: String(s[POSTING_SCHEDULE_COLS.Asset_Type - 1]),
        platform:  String(s[POSTING_SCHEDULE_COLS.Platform   - 1]),
        why:       String(s[POSTING_SCHEDULE_COLS.Why        - 1]),
        sortOrder: Number(s[POSTING_SCHEDULE_COLS.Sort_Order - 1]) || 0,
        isPlaybook: true,
        filled:    placedBySlot[sid] || null
      });
    }

    var days = DAY_ORDER.map(function(day) {
      var slots = dayMap[day];
      slots.sort(function(a, b) { return a.sortOrder - b.sortOrder; });
      return { day: day, slots: slots };
    });
    return { days: days };
  } catch (err) {
    return { days: [], error: err.message };
  }
}

/**
 * Places an asset into a Publish schedule slot.
 * Asset_Library: Availability → placed, siblings → paired.
 * Social_Assets: creates new row linking AL row to the slot.
 * @param {string} episodeUid
 * @param {string} slotId
 * @param {string} assetId    - Asset_Library Asset_ID (null for Drive-fallback)
 * @param {string} caption
 * @param {string} driveFileId
 * @param {string} assetType
 * @returns {{ success: boolean, error?: string }}
 */
function placeAssetInSlot(episodeUid, slotId, assetId, caption, driveFileId, assetType) {
  try {
    var sheetId = getMasterSheetId();
    var ss      = SpreadsheetApp.openById(sheetId);
    var alName  = getGovernance("ASSET_LIBRARY_TAB_NAME") || "Asset_Library";
    var alSheet = ss.getSheetByName(alName);
    var saSheet = ss.getSheetByName("Social_Assets");

    var alData         = alSheet ? alSheet.getDataRange().getValues() : [];
    var placedSlideIdx = null;
    var resolvedAlId   = assetId;
    var resolvedFileId = driveFileId;
    var resolvedType   = assetType;

    if (assetId && alSheet) {
      // Update existing AL row
      for (var i = 1; i < alData.length; i++) {
        if (String(alData[i][ASSET_LIBRARY_COLS.Asset_ID - 1]) !== String(assetId)) continue;
        alSheet.getRange(i + 1, ASSET_LIBRARY_COLS.Availability).setValue("placed");
        alSheet.getRange(i + 1, ASSET_LIBRARY_COLS.Status).setValue("scheduled");
        placedSlideIdx = String(alData[i][ASSET_LIBRARY_COLS.Slide_Index - 1]);
        resolvedFileId = resolvedFileId || String(alData[i][ASSET_LIBRARY_COLS.Drive_File_ID - 1]);
        resolvedType   = resolvedType   || String(alData[i][ASSET_LIBRARY_COLS.Asset_Type   - 1]);
        break;
      }
      // Mark sibling slides (same Slide_Index) as paired in AL
      if (placedSlideIdx && placedSlideIdx !== "") {
        for (var j = 1; j < alData.length; j++) {
          if (String(alData[j][ASSET_LIBRARY_COLS.Asset_ID    - 1]) === String(assetId))     continue;
          if (String(alData[j][ASSET_LIBRARY_COLS.Episode_UID - 1]) !== String(episodeUid))  continue;
          if (String(alData[j][ASSET_LIBRARY_COLS.Slide_Index - 1]) !== placedSlideIdx)      continue;
          alSheet.getRange(j + 1, ASSET_LIBRARY_COLS.Availability).setValue("paired");
        }
      }
    } else if (driveFileId && assetType && alSheet) {
      // Drive-fallback: create an AL stub row first
      var newAlId = "AL-DRV-" + Date.now();
      var alRow   = new Array(Object.keys(ASSET_LIBRARY_COLS).length).fill("");
      alRow[ASSET_LIBRARY_COLS.Asset_ID     - 1] = newAlId;
      alRow[ASSET_LIBRARY_COLS.Episode_UID  - 1] = episodeUid;
      alRow[ASSET_LIBRARY_COLS.Asset_Type   - 1] = assetType;
      alRow[ASSET_LIBRARY_COLS.Drive_File_ID- 1] = driveFileId;
      alRow[ASSET_LIBRARY_COLS.Status       - 1] = "scheduled";
      alRow[ASSET_LIBRARY_COLS.Availability - 1] = "placed";
      alRow[ASSET_LIBRARY_COLS.Created_At   - 1] = new Date();
      alRow[ASSET_LIBRARY_COLS.Created_By   - 1] = "drive_fallback";
      alSheet.appendRow(alRow);
      resolvedAlId = newAlId;
    }

    // Create Social_Assets row
    var postId  = "PB-" + episodeUid + "-" + slotId + "-" + Date.now();
    var saRow   = new Array(Object.keys(SOCIAL_ASSETS_COLS).length).fill("");
    saRow[SOCIAL_ASSETS_COLS.Post_ID          - 1] = postId;
    saRow[SOCIAL_ASSETS_COLS.Asset_Library_ID - 1] = resolvedAlId || "";
    saRow[SOCIAL_ASSETS_COLS.Episode_UID      - 1] = episodeUid;
    saRow[SOCIAL_ASSETS_COLS.Slot             - 1] = slotId;
    saRow[SOCIAL_ASSETS_COLS.Asset_Type       - 1] = resolvedType  || assetType || "";
    saRow[SOCIAL_ASSETS_COLS.Caption          - 1] = caption || "";
    saRow[SOCIAL_ASSETS_COLS.Drive_File_ID    - 1] = resolvedFileId || "";
    saRow[SOCIAL_ASSETS_COLS.Scheduled_At     - 1] = new Date();
    saRow[SOCIAL_ASSETS_COLS.Created_At       - 1] = new Date();
    saRow[SOCIAL_ASSETS_COLS.Created_By       - 1] = Session.getEffectiveUser().getEmail();
    saSheet.appendRow(saRow);
    bumpVersion("asset_library", "placeAssetInSlot");
    return { success: true, assetLibraryId: resolvedAlId || '', postId: postId };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Reverses placeAssetInSlot: deletes the Social_Assets row, resets the
 * Asset_Library row to Status=candidate / Availability=available,
 * and un-pairs any siblings in Asset_Library.
 */
function unscheduleAsset(episodeUid, slotId) {
  try {
    var sheetId = getMasterSheetId();
    var ss      = SpreadsheetApp.openById(sheetId);
    var saSheet = ss.getSheetByName("Social_Assets");
    var saData  = saSheet ? saSheet.getDataRange().getValues() : [];

    var foundAlId      = null;
    var saRowToDelete  = -1;

    for (var i = 1; i < saData.length; i++) {
      if (String(saData[i][SOCIAL_ASSETS_COLS.Slot       - 1]) !== String(slotId))     continue;
      if (String(saData[i][SOCIAL_ASSETS_COLS.Episode_UID- 1]) !== String(episodeUid)) continue;
      foundAlId     = String(saData[i][SOCIAL_ASSETS_COLS.Asset_Library_ID - 1]);
      saRowToDelete = i + 1;
      break;
    }

    if (saRowToDelete === -1) return { success: false, error: "Slot not found: " + slotId };

    // Delete the SA row (deleteRow shifts subsequent rows — do after reading)
    saSheet.deleteRow(saRowToDelete);

    // Reset the AL row + un-pair siblings
    if (foundAlId) {
      var alName  = getGovernance("ASSET_LIBRARY_TAB_NAME") || "Asset_Library";
      var alSheet = ss.getSheetByName(alName);
      if (alSheet) {
        var alData       = alSheet.getDataRange().getValues();
        var slideIdx     = null;
        for (var j = 1; j < alData.length; j++) {
          if (String(alData[j][ASSET_LIBRARY_COLS.Asset_ID - 1]) !== foundAlId) continue;
          alSheet.getRange(j + 1, ASSET_LIBRARY_COLS.Status      ).setValue("candidate");
          alSheet.getRange(j + 1, ASSET_LIBRARY_COLS.Availability).setValue("available");
          slideIdx = String(alData[j][ASSET_LIBRARY_COLS.Slide_Index - 1]);
          break;
        }
        // Un-pair image siblings
        if (slideIdx && slideIdx !== "" && slideIdx !== "null") {
          for (var k = 1; k < alData.length; k++) {
            if (String(alData[k][ASSET_LIBRARY_COLS.Asset_ID    - 1]) === foundAlId)    continue;
            if (String(alData[k][ASSET_LIBRARY_COLS.Episode_UID - 1]) !== episodeUid)   continue;
            if (String(alData[k][ASSET_LIBRARY_COLS.Slide_Index - 1]) !== slideIdx)     continue;
            if (String(alData[k][ASSET_LIBRARY_COLS.Availability- 1]) === "paired") {
              alSheet.getRange(k + 1, ASSET_LIBRARY_COLS.Availability).setValue("available");
            }
          }
        }
      }
    }

    bumpVersion("asset_library", "unscheduleAsset");
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
    var sheetId = getMasterSheetId();
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

/**
 * Manual trigger for Vert Fairy from Fairy Remote Control.
 * Replaces the dead runMarcomForEpisode() path with a live call to runVertFairy().
 * runVertFairy() generates Show Notes via Vertex RAG, writes the Show Notes doc,
 * patches manifest.show_notes, and hands off to Artist Fairy.
 */
function runVertFairyForEpisode(episodeUid) {
  try {
    logToAuditTrail("DWYP_App", "human_action", episodeUid, "",
      "[INFO] Manual Vert Fairy trigger from Fairy Remote Control.");
    runVertFairy(episodeUid);
    return { success: true };
  } catch (e) {
    logToAuditTrail("DWYP_App", "error", episodeUid, "",
      "[ERROR] runVertFairyForEpisode: " + e.message);
    return { success: false, error: e.message };
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
/**
 * Moves a background image to a 'deleted' subfolder within the background library.
 * getBackgroundLibrary() uses folder.getFiles() (immediate children only),
 * so files in subfolders are automatically excluded from future library loads.
 */
function deleteBackgroundPhoto(fileId) {
  try {
    var libraryId     = getGovernance("IMAGE_BACKGROUND_LIBRARY_ID");
    var library       = DriveApp.getFolderById(libraryId);
    var deletedQuery  = library.getFoldersByName('deleted');
    var deletedFolder = deletedQuery.hasNext() ? deletedQuery.next() : library.createFolder('deleted');
    DriveApp.getFileById(fileId).moveTo(deletedFolder);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

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
 * Returns a low-res thumbnail of a Drive image as a base64 data URL.
 * Fetches via Drive thumbnail API (sz=w600) — much faster than getBackgroundImageData.
 * Used by Publish canvas for progressive background loading (thumbnail shows instantly,
 * full res swaps in after).
 */

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
 * Calls callGeminiImageConversational() with the prompt and optional canvas image,
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
    var result    = callGeminiImageConversational(
      BG_GEN_SYSTEM + aspectNote + "\n\nUser request: " + prompt,
      [],
      imageBase64 || null,
      mimeType    || null
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

    var blob   = Utilities.newBlob(Utilities.base64Decode(result.base64), result.mimeType, filename);
    var folder = DriveApp.getFolderById(libraryId);
    var file   = folder.createFile(blob);

    return {
      success:  true,
      data:     result.base64,
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
    var sheetId   = getMasterSheetId();
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
 * Returns active (non-complete) episodes for the episode picker.
 * Sorted by Episode_Sequence ascending.
 * @returns {{ guestName: string, episodeUid: string }[]}
 */
function getActiveEpisodes() {
  var sheetId = getMasterSheetId();
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
 * Returns proxy file ID, Video_Status, hasReviewTask flag, and any existing
 * Revise_Episode revision notes — one call for the Publish Episode accordion.
 * @param {string} episodeUid
 * @returns {{ proxyFileId, videoStatus, hasReviewTask, revisionNotes }}
 */
function getEpisodeReviewContext(episodeUid) {
  try {
    var sheetId = getMasterSheetId();
    var ss      = SpreadsheetApp.openById(sheetId);

    // Video_Status from Episodes tab
    var epSheet  = ss.getSheetByName("Episodes");
    var epData   = epSheet.getDataRange().getValues();
    var videoStatus = '';
    for (var i = 1; i < epData.length; i++) {
      if (String(epData[i][EPISODES_COLS.Episode_UID - 1]) === String(episodeUid)) {
        videoStatus = String(epData[i][EPISODES_COLS.Video_Status - 1] || '');
        break;
      }
    }

    // Check Tasks: Review_Episode (open) + Revise_Episode notes
    var tSheet = ss.getSheetByName("Tasks");
    var tData  = tSheet.getDataRange().getValues();
    var hasReviewTask = false;
    var revisionNotes = '';
    for (var j = 1; j < tData.length; j++) {
      var row = tData[j];
      if (String(row[TASKS_COLS.Episode_UID  - 1]) !== String(episodeUid)) continue;
      var step   = String(row[TASKS_COLS.Workflow_Step - 1]);
      var status = String(row[TASKS_COLS.Status        - 1]);
      if (step === 'Review_Episode' && status !== 'complete') hasReviewTask = true;
      if (step === 'Revise_Episode' && status !== 'complete') {
        var notes = String(row[TASKS_COLS.Revision_Notes - 1] || '');
        if (notes) revisionNotes = notes;
      }
    }

    var proxyFileId = getProxyFileId(episodeUid);

    return {
      proxyFileId:   proxyFileId,
      videoStatus:   videoStatus,
      hasReviewTask: hasReviewTask,
      revisionNotes: revisionNotes
    };
  } catch (err) {
    return { proxyFileId: null, videoStatus: '', hasReviewTask: false, revisionNotes: '' };
  }
}

/**
 * Full episode revision request: sets Video_Status, logs to Episode_Log, and spawns
 * a Revise_Episode task for Audra. Replaces the two-step client chain (F-4).
 * @param {string} episodeUid
 * @param {string} notes       — JT's revision description
 * @param {string} authorEmail — passed from client (APP_CONFIG.userEmail)
 * @returns {{ success: boolean, error?: string }}
 */
function submitEpisodeRevisionRequest(episodeUid, notes, authorEmail) {
  try {
    writeVideoStatus(episodeUid, "revision_requested");
    appendEpisodeLogEntry(episodeUid, "feedback", "video", notes, "both", authorEmail);
    // Spawn or append to existing Revise_Episode task for producer
    var today = new Date().toISOString().split("T")[0];
    submitEpisodeComments(episodeUid, [{ timestamp: "—", note: notes }], today);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
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

    var sheetId = getMasterSheetId();
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
      bumpVersion("tasks", "submitEpisodeComments");
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

    function countApprovedFiles(subfolderName) {
      var subs = stagingFolder.getFoldersByName(subfolderName);
      if (!subs.hasNext()) return 0;
      var approvedIt = subs.next().getFoldersByName("Approved");
      if (!approvedIt.hasNext()) return 0;
      var files = approvedIt.next().getFiles();
      var n = 0;
      while (files.hasNext()) { files.next(); n++; }
      return n;
    }

    var imagesEmpty = countRootFiles("Images") === 0;
    var reelsEmpty  = countRootFiles("Reels")  === 0;
    var hasApproved = countApprovedFiles("Images") > 0 || countApprovedFiles("Reels") > 0;
    return { ready: imagesEmpty && reelsEmpty && hasApproved, imagesEmpty: imagesEmpty, reelsEmpty: reelsEmpty };
  } catch (err) {
    throw new Error("checkReadyForRelease failed for " + episodeUid + ": " + err.message);
  }
}


// ── STUDIO ───────────────────────────────────────────────────────────────────

var CLAUDE_STUDIO_SYSTEM =
  "You are Claude — the content intelligence engine inside the Studio for Don't Waste Your Pain (DWYP). " +
  "You have deep knowledge of all DWYP episodes through the corpus you can retrieve from. " +
  "DWYP is a podcast hosted by JT about what lives on the other side of pain, grief, and the moments that break and remake a person. " +
  "The show features guests who have experienced profound pain and turned it into purpose. " +
  "The brand voice is honest, direct, specific, and unsentimental — darkness and humor coexist. " +
  "Never be clinical or corporate. Write like a trusted collaborator who knows the show deeply.\n\n" +
  "If episode context is provided below, prioritize it. When citing episode content, be specific — name the guest, " +
  "reference the story. Return responses that are immediately usable, not rough drafts.\n\n";

var STUDIO_MODE_INSTRUCTIONS = {
  "images":
    "You are a social media expert going through transcripts of podcast episodes to create striking and interesting feed graphics.\n\n" +
    "Return hooks as: [[HOOK: the hook text]]\n" +
    "Return quotes as: [[QUOTE: \"the quote text\" — Full Guest Name]]\n" +
    "Return image prompts as: [[PROMPT: the prompt text]]\n\n" +
    "HOOK — Synthesized from the main themes in the source material. Talk about the concept or insight, not what happened — never describe a person or event. No names, pronouns, or generic stand-ins like \"individual\" or \"person.\" Simple but significant, at home in a social media feed. Maximum 25 words.\n\n" +
    "QUOTE — Verbatim from the source material. You may remove filler words and repeated words, and use ellipsis to bridge sentences as long as context is preserved. Always include attribution with em-dash and full guest name. Wrapped in quotation marks. Maximum 20 words.\n\n" +
    "PROMPT — Cinematic, realistic direction for a background image. Must not look like it comes from a wellness retreat, church bulletin, or fantasy setting.",

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
 * Lightweight keyword heuristic for image generation intent.
 * Intentionally broad — false positives are acceptable; the image path handles them gracefully.
 */
function isImageRequest(userMessage) {
  var msg = (userMessage || '').toLowerCase();
  return ['background', 'image', 'generate', 'create', 'visualize', 'picture',
          'photo', 'make me', 'show me', 'try something', 'different one',
          'change it', 'new version', 'darker', 'lighter', 'more', 'less',
          'option', 'instead'
  ].some(function(term) { return msg.indexOf(term) !== -1; });
}

/**
 * Explicit text-writing intent — takes priority over isImageRequest.
 * Catches requests like "write a caption", "draft a hook", etc., where image keywords
 * in pasted context (reel summaries, episode descriptions) would otherwise misfire.
 */
function isExplicitTextRequest(userMessage) {
  var msg = (userMessage || '').toLowerCase().slice(0, 200);
  return ['caption', 'write a', 'write me', 'draft a', 'draft me',
          'give me a', 'give me text', 'describe', 'hook for', 'script for',
          'copy for', 'headline', 'tagline', 'bio', 'post copy', 'caption for',
          'write copy', 'summarize', 'rewrite'
  ].some(function(term) { return msg.indexOf(term) !== -1; });
}

/**
 * Studio routing function. Detects image vs text intent and routes accordingly.
 * Image path: callGeminiImageConversational() — imageHistory only, never touches conversationHistory.
 * Text path:  callClaudeAPI() with ragContext injected into system prompt.
 * Two separate history arrays — image iterations never pollute the main text thread.
 *
 * @param {string}   prompt
 * @param {string}   ragContext            — retrieved corpus context (may be empty string)
 * @param {object[]} conversationHistory   — [{role, parts:[{text}]}] for main text thread
 * @param {object[]} imageHistory          — [{role, parts}] raw turns for image thread
 * @param {object}   options               — { mode: string, episodeUid: string|null }
 * @returns {{ type: 'text'|'image', text?, base64?, mimeType?, updatedConversationHistory?, updatedImageHistory?, tokenCount }}
 */
function generateWithClaude(prompt, ragContext, conversationHistory, imageHistory, options) {
  var mode       = (options && options.mode)       || 'images';
  var episodeUid = (options && options.episodeUid) || '';

  // ── Image path ──────────────────────────────────────────────────────────────
  // isExplicitTextRequest takes priority — pasted summaries often contain image keywords
  // ("background", "create") that would otherwise misfire into the image path.
  if (isImageRequest(prompt) && !isExplicitTextRequest(prompt)) {
    try {
      var imgResult = callGeminiImageConversational(prompt, imageHistory || []);
      return {
        type:                'image',
        base64:              imgResult.base64,
        mimeType:            imgResult.mimeType,
        text:                imgResult.text,
        updatedImageHistory: imgResult.updatedHistory,
        tokenCount:          imgResult.tokenCount
      };
    } catch (imgErr) {
      // Gemini returned text-only — fall through to text path below
      Logger.log('Image path failed, routing to text: ' + imgErr.message);
    }
  }

  // ── Text path ───────────────────────────────────────────────────────────────
  var modeInstr  = STUDIO_MODE_INSTRUCTIONS[mode] || STUDIO_MODE_INSTRUCTIONS['brainstorm'];
  var systemText = CLAUDE_STUDIO_SYSTEM + modeInstr;
  if (ragContext) {
    systemText += "\n\nCORPUS CONTEXT (retrieved):\n" + ragContext;
  }

  // Convert GAS-style history [{role, parts:[{text}]}] to Claude messages [{role, content}]
  var history  = Array.isArray(conversationHistory) ? conversationHistory : [];
  var messages = [];
  for (var i = 0; i < history.length; i++) {
    var turn    = history[i];
    var role    = (turn.role === 'model' || turn.role === 'assistant') ? 'assistant' : 'user';
    var content = turn.parts ? turn.parts.map(function(p) { return p.text || ''; }).join('') : (turn.content || '');
    messages.push({ role: role, content: content });
  }

  var responseText = callClaudeAPI(prompt, systemText, 'Studio', messages, { maxTokens: 8192 });

  var updatedHistory = history.concat([
    { role: 'user',  parts: [{ text: prompt }] },
    { role: 'model', parts: [{ text: responseText }] }
  ]);

  var tokenCount = Math.round((systemText.length + prompt.length + responseText.length) / 4);

  return {
    type:                       'text',
    text:                       responseText,
    updatedConversationHistory: updatedHistory,
    tokenCount:                 tokenCount
  };
}

/**
 * Saves a generated Studio background image to the background library folder.
 * Called by the UI when JT explicitly saves an image from the Studio canvas.
 * @param {string} base64Data
 * @param {string} mimeType
 * @param {string} guestSlug
 * @returns {{ fileId, url, filename }}
 */
function saveBackgroundToLibrary(base64Data, mimeType, guestSlug) {
  var libraryId = getGovernance("IMAGE_BACKGROUND_LIBRARY_ID");
  if (!libraryId) throw new Error("IMAGE_BACKGROUND_LIBRARY_ID not configured.");

  var ext      = (mimeType === "image/jpeg") ? "jpg" : "png";
  var ts       = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyMMdd-HHmm");
  var filename = "bg_" + (guestSlug || "studio") + "_" + ts + "." + ext;

  var blob   = Utilities.newBlob(Utilities.base64Decode(base64Data), mimeType, filename);
  var folder = DriveApp.getFolderById(libraryId);
  var file   = folder.createFile(blob);

  logToAuditTrail("Studio", "state_change", guestSlug || "", "", "BG_SAVED: " + filename, "info");

  return {
    fileId:   file.getId(),
    url:      "https://drive.google.com/file/d/" + file.getId() + "/view",
    filename: filename
  };
}


/**
 * Loads the Episode Index doc for Studio context.
 * Primary: searches EPISODE_SEARCH_INDEX_KEY folder for a file whose name contains the epUid.
 * Fallback: reads manifest.episode_index doc ID.
 * Returns doc text, or empty string if not found.
 * @param {string} episodeUid
 * @returns {string}
 */
function stLoadEpisodeIndex(episodeUid) {
  if (!episodeUid) return '';
  try {
    var indexFolderId = getGovernance("EPISODE_SEARCH_INDEX_KEY");
    if (indexFolderId) {
      var folder = DriveApp.getFolderById(indexFolderId);
      var files  = folder.getFiles();
      while (files.hasNext()) {
        var file = files.next();
        if (file.getName().indexOf(episodeUid) !== -1) {
          return DocumentApp.openById(file.getId()).getBody().getText();
        }
      }
    }
    // Fallback: manifest.episode_index
    var stagingFolderId = getStagingFolderIdByUid(episodeUid);
    if (stagingFolderId) {
      var manifest = getManifest(stagingFolderId);
      if (manifest && manifest.episode_index) {
        return DocumentApp.openById(manifest.episode_index).getBody().getText();
      }
    }
  } catch (e) {
    logToAuditTrail("Studio", "state_change", episodeUid, "", "stLoadEpisodeIndex: " + e.message, "warning");
  }
  return '';
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

    var sheetId = getMasterSheetId();
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
    bumpVersion("tasks", "triggerReadyForRelease");

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
    var sheetId = getMasterSheetId();
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
    var sheetId = getMasterSheetId();
    var ss      = SpreadsheetApp.openById(sheetId);
    var sheet   = ss.getSheetByName("Contacts");
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var col     = headers.indexOf(field);
    if (col === -1) throw new Error("Column not found in Contacts sheet: " + field);
    sheet.getRange(rowIndex, col + 1).setValue(value);
    bumpVersion("contacts", "updateContactField");
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
    // base64Decode produces a JS integer array — ~8 bytes per raw byte in V8 heap
    var estimatedRawMB = Math.round(fileBase64.length * 0.75 / 1024 / 1024);
    if (estimatedRawMB > 15) {
      throw new Error("Video too large (" + estimatedRawMB + "MB) — trim to under 15MB and try again.");
    }
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

  var initHeaders = initResp.getHeaders();
  var uploadUrl   = initHeaders["X-Goog-Upload-URL"] || initHeaders["x-goog-upload-url"];
  if (!uploadUrl) throw new Error("File API response missing upload URL. Headers: " + JSON.stringify(Object.keys(initHeaders)));

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

// ── PUBLISH V3 ───────────────────────────────────────────────────────────────

/**
 * Returns hooks, quotes, and image prompts from the episode manifest.
 * Falls back to empty arrays when manifest fields are absent.
 */
function getEpisodeHooksAndQuotes(episodeUid) {
  try {
    // Primary: read Quote_Graphic rows from Asset_Library — each row is an extractable asset
    var sheetId = getMasterSheetId();
    var ss      = SpreadsheetApp.openById(sheetId);
    var alName  = getGovernance("ASSET_LIBRARY_TAB_NAME") || "Asset_Library";
    var alSheet = ss.getSheetByName(alName);

    if (alSheet) {
      var alData = alSheet.getDataRange().getValues();
      var hooks  = [];
      var quotes = [];
      for (var i = 1; i < alData.length; i++) {
        var row = alData[i];
        if (String(row[ASSET_LIBRARY_COLS.Episode_UID - 1]) !== String(episodeUid)) continue;
        var normType = String(row[ASSET_LIBRARY_COLS.Asset_Type - 1]).toLowerCase().replace(/[_ ]/g,'');
        if (normType !== 'quotegraphic') continue;
        var text    = String(row[ASSET_LIBRARY_COLS.Quote_Text    - 1] || '').trim();
        var name    = String(row[ASSET_LIBRARY_COLS.Display_Name  - 1] || '').trim();
        var assetId = String(row[ASSET_LIBRARY_COLS.Asset_ID      - 1]);
        if (!text) continue;
        var captionDraft = String(row[ASSET_LIBRARY_COLS.Caption_Draft - 1] || '').trim();
        var entry = { assetId: assetId, text: text, captionDraft: captionDraft || null };
        // Display_Name prefix "Hook" → hooks, "Quote" → quotes; default quotes
        if (name.toLowerCase().indexOf('hook') === 0) {
          hooks.push(entry);
        } else {
          quotes.push(entry);
        }
      }
      if (hooks.length || quotes.length) {
        var manifest = getEpisodeManifest(episodeUid);
        return { hooks: hooks, quotes: quotes, imagePrompts: (manifest && manifest.image_prompts) || [] };
      }
    }

    // Fallback: doc/manifest — no Asset_IDs available yet
    var manifest = getEpisodeManifest(episodeUid);
    if (manifest && manifest.raw_hooks && manifest.raw_hooks.length) {
      var toEntry = function(t) { return { assetId: null, text: t }; };
      return {
        hooks:        manifest.raw_hooks.map(toEntry),
        quotes:       (manifest.raw_quotes || []).map(toEntry),
        imagePrompts: manifest.image_prompts || []
      };
    }

    if (manifest && manifest.show_notes) {
      try {
        var docText = DocumentApp.openById(manifest.show_notes).getBody().getText();
        var toEntryNull = function(l) { return { assetId: null, text: l.trim().replace(/^\d+\.\s*/, '') }; };

        var hooksBlock  = extractSectionFromProse(docText, "HOOKS");
        var fallHooks   = hooksBlock
          ? hooksBlock.split("\n").map(toEntryNull).filter(function(e) { return e.text.length > 0; })
          : [];

        var quotesBlock = extractSectionFromProse(docText, "QUOTES");
        var fallQuotes  = quotesBlock
          ? quotesBlock.split("\n").map(toEntryNull).filter(function(e) { return e.text.length > 0; })
          : [];

        return { hooks: fallHooks, quotes: fallQuotes, imagePrompts: manifest.image_prompts || [] };
      } catch (docErr) { /* Doc read failed */ }
    }

    return { hooks: [], quotes: [], imagePrompts: [] };
  } catch (e) {
    return { hooks: [], quotes: [], imagePrompts: [], error: e.message };
  }
}

/**
 * Generates a social media caption using Claude for a Publish graphic or reel.
 * @param {string} episodeUid
 * @param {string} platform   — e.g. 'Instagram Story', 'Instagram Feed', 'Reel'
 * @param {string} contentText — text on graphic or reel display name
 * @returns {{ success: boolean, text?: string, error?: string }}
 */
function generatePublishCaption(episodeUid, platform, contentText) {
  try {
    var plat = (platform || 'Instagram').toUpperCase();
    var promptText =
      "PLATFORM: " + plat + "\n\n" +
      "Write a social media caption for the above platform for the Don't Waste Your Pain podcast.\n\n" +
      "Content on the graphic or in the clip:\n" + (contentText || "(no content provided)") + "\n\n" +
      "Platform-specific instructions:\n" +
      "- INSTAGRAM STORY or INSTAGRAM FEED: punchy opener, under 125 characters, no hashtags\n" +
      "- REEL: 1-2 sentences, hook-first, can go up to 200 characters\n" +
      "Match the DWYP voice: honest, direct, specific, unsentimental. " +
      "Return only the caption text.";

    var text = callClaudeAPI(promptText, CLAUDE_STUDIO_SYSTEM + STUDIO_MODE_INSTRUCTIONS['social'], 'Studio', null, { maxTokens: 512 });
    return { success: true, text: text };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Returns the stored summary for a reel, or generates + stores one if missing.
 * Called on-demand when a reel is selected and has no summary.
 * @param {string} postId
 * @param {string} episodeUid
 * @returns {{ success: boolean, summary: string }}
 */
/**
 * Generates a 5–8 word title card hook for a reel clip.
 * Uses the AL Reel_Summary as context. Audra uses this text in DaVinci as an overlay.
 * @param {string} assetId
 * @param {string} episodeUid
 * @returns {{ titleCard: string, error?: string }}
 */
function generateReelTitleCard(assetId, episodeUid) {
  try {
    var sheetId = getMasterSheetId();
    var ss      = SpreadsheetApp.openById(sheetId);
    var alName  = getGovernance("ASSET_LIBRARY_TAB_NAME") || "Asset_Library";
    var sheet   = ss.getSheetByName(alName);
    if (!sheet) return { titleCard: '', error: "Asset_Library tab not found" };
    var data = sheet.getDataRange().getValues();

    var summary = '';
    var displayName = '';
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][ASSET_LIBRARY_COLS.Asset_ID - 1]) !== String(assetId)) continue;
      summary     = String(data[i][ASSET_LIBRARY_COLS.Reel_Summary  - 1] || '').trim();
      displayName = String(data[i][ASSET_LIBRARY_COLS.Display_Name  - 1] || '').trim();
      break;
    }

    var manifest  = getEpisodeManifest(episodeUid);
    var guestName = (manifest && manifest.guest_name) ? manifest.guest_name : '';

    var prompt =
      "Write a single title card for a social media reel — 5 to 8 words maximum.\n\n" +
      "The title card is a short text hook that appears overlaid on the first seconds of the reel. " +
      "It must stop the scroll. No punctuation at the end unless it's a question mark. No quotation marks.\n\n" +
      (displayName ? "Clip name: " + displayName + "\n" : "") +
      (guestName   ? "Guest: " + guestName + "\n" : "") +
      (summary     ? "What the clip is about: " + summary + "\n" : "") +
      "\nRules: Draw from the content above — name the specific thing (a decision, a revelation, a moment, a person). " +
      "Never describe what someone 'talks about' or use phrases like 'the truth about' or 'what happens when.' " +
      "State the thing itself. DWYP voice — honest, not hype. No 'This will change your life' energy.\n\n" +
      "Return ONLY the title card text — nothing else.";

    var result = callClaudeAPI(prompt, CLAUDE_STUDIO_SYSTEM + STUDIO_MODE_INSTRUCTIONS['social'], 'Studio', null, { maxTokens: 64 });
    return { titleCard: result ? result.trim().replace(/^["']|["']$/g, '') : '' };
  } catch (err) {
    return { titleCard: '', error: err.message };
  }
}

/**
 * Sets a Drive reel file to "anyone with link can view" and returns its
 * direct streaming URL for use in a <video> element.
 */
function getReelStreamUrl(fileId) {
  try {
    var file = DriveApp.getFileById(fileId);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return { url: 'https://drive.google.com/uc?id=' + fileId };
  } catch(e) {
    return { url: '', error: e.message };
  }
}

/**
 * Generates fresh caption variants for a reel, saves to Caption_Draft,
 * clears Caption_Final, and returns the first variant.
 */
function generateReelCaption(assetId, episodeUid) {
  try {
    var sheetId = getMasterSheetId();
    var ss      = SpreadsheetApp.openById(sheetId);
    var alName  = getGovernance("ASSET_LIBRARY_TAB_NAME") || "Asset_Library";
    var sheet   = ss.getSheetByName(alName);
    if (!sheet) return { caption: '', error: "Asset_Library tab not found" };
    var data = sheet.getDataRange().getValues();

    var rowIndex    = -1;
    var summary     = '';
    var displayName = '';
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][ASSET_LIBRARY_COLS.Asset_ID - 1]) !== String(assetId)) continue;
      rowIndex    = i + 1;
      summary     = String(data[i][ASSET_LIBRARY_COLS.Reel_Summary  - 1] || '').trim();
      displayName = String(data[i][ASSET_LIBRARY_COLS.Display_Name  - 1] || '').trim();
      break;
    }
    if (rowIndex === -1) return { caption: '', error: "Asset not found: " + assetId };

    var manifest  = getEpisodeManifest(episodeUid);
    var guestName = (manifest && manifest.guest_name)    ? manifest.guest_name    : '';
    var epTitle   = (manifest && manifest.episode_title) ? manifest.episode_title : '';

    var variantsJson = generateCaptionVariants_(summary || displayName, guestName, epTitle, true);
    var first = '';
    try {
      var arr = JSON.parse(variantsJson);
      if (Array.isArray(arr) && arr.length) {
        var s = arr[0];
        first = (s.length > 1 && s[0] === '"' && s[s.length - 1] === '"') ? s.slice(1, -1) : s;
      }
    } catch(e) {}

    sheet.getRange(rowIndex, ASSET_LIBRARY_COLS.Caption_Draft).setValue(variantsJson);
    sheet.getRange(rowIndex, ASSET_LIBRARY_COLS.Caption_Final).setValue('');
    bumpVersion("asset_library", "generateReelCaption");
    return { caption: first, draft: variantsJson };
  } catch (err) {
    return { caption: '', error: err.message };
  }
}

function getOrGenerateReelSummary(assetId, episodeUid) {
  try {
    var sheetId = getMasterSheetId();
    var ss      = SpreadsheetApp.openById(sheetId);
    var alName  = getGovernance("ASSET_LIBRARY_TAB_NAME") || "Asset_Library";
    var sheet   = ss.getSheetByName(alName);
    if (!sheet) return { success: false, summary: '', error: "Asset_Library tab not found" };
    var data    = sheet.getDataRange().getValues();

    var rowIndex    = -1;
    var existing    = '';
    var displayName = '';
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][ASSET_LIBRARY_COLS.Asset_ID - 1]) !== String(assetId)) continue;
      rowIndex    = i + 1;
      existing    = String(data[i][ASSET_LIBRARY_COLS.Reel_Summary  - 1] || '').trim();
      displayName = String(data[i][ASSET_LIBRARY_COLS.Display_Name  - 1] || '').trim();
      break;
    }
    if (existing) return { success: true, summary: existing };

    var manifest  = getEpisodeManifest(episodeUid);
    var guestName = (manifest && manifest.guest_name)    ? manifest.guest_name    : '';
    var epTitle   = (manifest && manifest.episode_title) ? manifest.episode_title : '';

    var promptText =
      "In 1-2 sentences, describe what this social media video clip is likely about.\n\n" +
      "Clip name: " + (displayName || 'Reel clip') + "\n" +
      (epTitle   ? "Episode: " + epTitle + "\n"   : "") +
      (guestName ? "Guest: "   + guestName + "\n" : "") +
      "\nWrite as a factual note for internal use — no filler, no hype. " +
      "This will be used as context when generating captions.";

    var summaryText = callClaudeAPI(promptText, CLAUDE_STUDIO_SYSTEM + STUDIO_MODE_INSTRUCTIONS['social'], 'Studio', null, { maxTokens: 256 });
    if (summaryText) {
      var summary = summaryText.trim();
      if (rowIndex > 0) {
        sheet.getRange(rowIndex, ASSET_LIBRARY_COLS.Reel_Summary).setValue(summary);
        bumpVersion("asset_library", "getOrGenerateReelSummary");
      }
      return { success: true, summary: summary };
    }
    return { success: false, summary: '' };
  } catch (e) {
    return { success: false, summary: '', error: e.message };
  }
}

/**
 * Background: pre-generates summaries for all reels in this episode that lack one.
 * Client fires this fire-and-forget after setting the episode.
 * @param {string} episodeUid
 */
function ensureReelSummaries(episodeUid) {
  try {
    var sheetId  = getMasterSheetId();
    var ss       = SpreadsheetApp.openById(sheetId);
    var alName   = getGovernance("ASSET_LIBRARY_TAB_NAME") || "Asset_Library";
    var sheet    = ss.getSheetByName(alName);
    if (!sheet) return { done: false, error: "Asset_Library tab not found" };
    var data     = sheet.getDataRange().getValues();
    var manifest = getEpisodeManifest(episodeUid);
    var guestName = (manifest && manifest.guest_name)    ? manifest.guest_name    : '';
    var epTitle   = (manifest && manifest.episode_title) ? manifest.episode_title : '';

    for (var i = 1; i < data.length; i++) {
      var row    = data[i];
      if (String(row[ASSET_LIBRARY_COLS.Episode_UID - 1]) !== String(episodeUid)) continue;
      var normAt = String(row[ASSET_LIBRARY_COLS.Asset_Type - 1]).toLowerCase().replace(/[_ ]/g,'');
      if (normAt !== 'reel' && normAt !== 'bankclip') continue;
      var existing = String(row[ASSET_LIBRARY_COLS.Reel_Summary - 1] || '').trim();
      if (existing) continue;

      var displayName = String(row[ASSET_LIBRARY_COLS.Display_Name - 1] || 'Reel clip').trim();
      var promptText =
        "In 1-2 sentences, describe what this social media video clip is likely about.\n\n" +
        "Clip name: " + displayName + "\n" +
        (epTitle   ? "Episode: " + epTitle   + "\n" : "") +
        (guestName ? "Guest: "   + guestName + "\n" : "") +
        "\nFactual note for internal use — no filler. Used for caption generation context.";

      try {
        var reelSummary = callClaudeAPI(promptText, CLAUDE_STUDIO_SYSTEM + STUDIO_MODE_INSTRUCTIONS['social'], 'Studio', null, { maxTokens: 256 });
        if (reelSummary) sheet.getRange(i + 1, ASSET_LIBRARY_COLS.Reel_Summary).setValue(reelSummary.trim());
      } catch (genErr) { /* non-fatal — skip this reel */ }
    }
    bumpVersion("asset_library", "ensureReelSummaries");
    return { done: true };
  } catch (e) {
    return { done: false, error: e.message };
  }
}

/**
 * Saves a canvas-exported PNG to Staging/Images/, updates Asset_Library row (if assetId provided),
 * and creates a Social_Assets row linking the AL asset to the slot.
 * @param {string} episodeUid
 * @param {string} slotId
 * @param {string|null} assetId     - Asset_Library Asset_ID; null for drive-fallback
 * @param {string} imageDataB64     - base64-encoded PNG (no data: prefix)
 * @param {string} mimeType         - 'image/png'
 * @param {string} caption
 * @param {string} quoteText        - text placed on the graphic (written back to AL Quote_Text)
 * @param {string} canvasJson       - Fabric.js canvas JSON (written back to AL Canvas_State)
 * @returns {{ success: true, postId: string, fileId: string } | { success: false, error: string }}
 */
function addToWeekAsImage(episodeUid, slotId, assetId, imageDataB64, mimeType, caption, quoteText, canvasJson) {
  try {
    var stagingId = getStagingFolderIdByUid(episodeUid);
    if (!stagingId) return { success: false, error: "Staging folder not found for: " + episodeUid };
    var stagingFolder = DriveApp.getFolderById(stagingId);
    var imgFolderIt   = stagingFolder.getFoldersByName("Images");
    var imgFolder     = imgFolderIt.hasNext() ? imgFolderIt.next() : stagingFolder.createFolder("Images");

    var filename = "quote_graphic_" + slotId + "_" + Date.now() + ".png";
    var blob     = Utilities.newBlob(Utilities.base64Decode(imageDataB64), mimeType || "image/png", filename);
    var file     = imgFolder.createFile(blob);
    var fileId   = file.getId();

    var sheetId = getMasterSheetId();
    var ss      = SpreadsheetApp.openById(sheetId);

    // Update Asset_Library row with the rendered PNG and canvas state
    var resolvedAlId = assetId;
    if (assetId) {
      var alName  = getGovernance("ASSET_LIBRARY_TAB_NAME") || "Asset_Library";
      var alSheet = ss.getSheetByName(alName);
      if (alSheet) {
        var alData = alSheet.getDataRange().getValues();
        for (var i = 1; i < alData.length; i++) {
          if (String(alData[i][ASSET_LIBRARY_COLS.Asset_ID - 1]) !== String(assetId)) continue;
          alSheet.getRange(i + 1, ASSET_LIBRARY_COLS.Drive_File_ID).setValue(fileId);
          alSheet.getRange(i + 1, ASSET_LIBRARY_COLS.Availability ).setValue("placed");
          alSheet.getRange(i + 1, ASSET_LIBRARY_COLS.Status       ).setValue("scheduled");
          if (quoteText)  alSheet.getRange(i + 1, ASSET_LIBRARY_COLS.Quote_Text   ).setValue(quoteText);
          if (canvasJson) alSheet.getRange(i + 1, ASSET_LIBRARY_COLS.Canvas_State ).setValue(canvasJson);
          break;
        }
      }
    } else {
      // Drive-fallback: create a minimal AL row so the SA FK is not null
      var alName2  = getGovernance("ASSET_LIBRARY_TAB_NAME") || "Asset_Library";
      var alSheet2 = ss.getSheetByName(alName2);
      if (alSheet2) {
        resolvedAlId = "AL-PB-" + Date.now();
        var alRow    = new Array(Object.keys(ASSET_LIBRARY_COLS).length).fill("");
        alRow[ASSET_LIBRARY_COLS.Asset_ID     - 1] = resolvedAlId;
        alRow[ASSET_LIBRARY_COLS.Episode_UID  - 1] = episodeUid;
        alRow[ASSET_LIBRARY_COLS.Asset_Type   - 1] = "quote_graphic";
        alRow[ASSET_LIBRARY_COLS.Drive_File_ID- 1] = fileId;
        alRow[ASSET_LIBRARY_COLS.Status       - 1] = "scheduled";
        alRow[ASSET_LIBRARY_COLS.Availability - 1] = "placed";
        if (quoteText)  alRow[ASSET_LIBRARY_COLS.Quote_Text   - 1] = quoteText;
        if (canvasJson) alRow[ASSET_LIBRARY_COLS.Canvas_State - 1] = canvasJson;
        alRow[ASSET_LIBRARY_COLS.Created_At   - 1] = new Date();
        alRow[ASSET_LIBRARY_COLS.Created_By   - 1] = "publish_canvas";
        alSheet2.appendRow(alRow);
      }
    }

    // Create Social_Assets row
    var postId  = "PB-" + episodeUid + "-" + slotId + "-" + Date.now();
    var saSheet = ss.getSheetByName("Social_Assets");
    var saRow   = new Array(Object.keys(SOCIAL_ASSETS_COLS).length).fill("");
    saRow[SOCIAL_ASSETS_COLS.Post_ID          - 1] = postId;
    saRow[SOCIAL_ASSETS_COLS.Asset_Library_ID - 1] = resolvedAlId || "";
    saRow[SOCIAL_ASSETS_COLS.Episode_UID      - 1] = episodeUid;
    saRow[SOCIAL_ASSETS_COLS.Slot             - 1] = slotId;
    saRow[SOCIAL_ASSETS_COLS.Asset_Type       - 1] = "quote_graphic";
    saRow[SOCIAL_ASSETS_COLS.Caption          - 1] = caption || "";
    saRow[SOCIAL_ASSETS_COLS.Drive_File_ID    - 1] = fileId;
    saRow[SOCIAL_ASSETS_COLS.Scheduled_At     - 1] = new Date();
    saRow[SOCIAL_ASSETS_COLS.Created_At       - 1] = new Date();
    saRow[SOCIAL_ASSETS_COLS.Created_By       - 1] = "publish_canvas";
    saSheet.appendRow(saRow);
    bumpVersion("asset_library", "addToWeekAsImage");
    return { success: true, postId: postId, fileId: fileId, assetLibraryId: resolvedAlId };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Updates an already-scheduled asset with a new canvas render.
 * Overwrites the Drive file, updates Asset_Library (Drive_File_ID, Canvas_State, Quote_Text),
 * and updates the Social_Assets row (Drive_File_ID, Caption, Scheduled_At).
 * @param {string} assetId      - Asset_Library Asset_ID
 * @param {string} postId       - Social_Assets Post_ID
 * @param {string} imageDataB64 - base64-encoded PNG (no data: prefix)
 * @param {string} mimeType     - 'image/png'
 * @param {string} caption
 * @param {string} quoteText
 * @param {string} canvasJson   - Fabric.js canvas JSON
 * @returns {{ success: boolean, fileId?: string, error?: string }}
 */
function rescheduleAsset(assetId, postId, imageDataB64, mimeType, caption, quoteText, canvasJson) {
  try {
    var sheetId = getMasterSheetId();
    var ss      = SpreadsheetApp.openById(sheetId);

    // Read the existing AL row to get the episode folder
    var alName   = getGovernance("ASSET_LIBRARY_TAB_NAME") || "Asset_Library";
    var alSheet  = ss.getSheetByName(alName);
    if (!alSheet) return { success: false, error: "Asset_Library tab not found" };
    var alData   = alSheet.getDataRange().getValues();

    var episodeUid = null;
    var alRowNum   = -1;
    for (var i = 1; i < alData.length; i++) {
      if (String(alData[i][ASSET_LIBRARY_COLS.Asset_ID - 1]) !== String(assetId)) continue;
      alRowNum   = i + 1;
      episodeUid = String(alData[i][ASSET_LIBRARY_COLS.Episode_UID - 1]);
      break;
    }
    if (alRowNum === -1) return { success: false, error: "Asset not found: " + assetId };

    var fileId = null;
    if (imageDataB64) {
      // Save new PNG to Staging/Images/
      var stagingId = getStagingFolderIdByUid(episodeUid);
      if (!stagingId) return { success: false, error: "Staging folder not found for: " + episodeUid };
      var stagingFolder = DriveApp.getFolderById(stagingId);
      var imgFolderIt   = stagingFolder.getFoldersByName("Images");
      var imgFolder     = imgFolderIt.hasNext() ? imgFolderIt.next() : stagingFolder.createFolder("Images");
      var filename = "quote_graphic_reschedule_" + assetId + "_" + Date.now() + ".png";
      var blob     = Utilities.newBlob(Utilities.base64Decode(imageDataB64), mimeType || "image/png", filename);
      fileId = imgFolder.createFile(blob).getId();
      alSheet.getRange(alRowNum, ASSET_LIBRARY_COLS.Drive_File_ID).setValue(fileId);
    }
    if (quoteText)  alSheet.getRange(alRowNum, ASSET_LIBRARY_COLS.Quote_Text  ).setValue(quoteText);
    if (canvasJson) alSheet.getRange(alRowNum, ASSET_LIBRARY_COLS.Canvas_State).setValue(canvasJson);

    // Update Social_Assets row (caption always; Drive_File_ID only when image changed)
    var saSheet = ss.getSheetByName("Social_Assets");
    if (saSheet && postId) {
      var saData = saSheet.getDataRange().getValues();
      for (var j = 1; j < saData.length; j++) {
        if (String(saData[j][SOCIAL_ASSETS_COLS.Post_ID - 1]) !== String(postId)) continue;
        if (fileId) saSheet.getRange(j + 1, SOCIAL_ASSETS_COLS.Drive_File_ID).setValue(fileId);
        saSheet.getRange(j + 1, SOCIAL_ASSETS_COLS.Caption      ).setValue(caption || "");
        saSheet.getRange(j + 1, SOCIAL_ASSETS_COLS.Scheduled_At ).setValue(new Date());
        break;
      }
    }

    bumpVersion("asset_library", "rescheduleAsset");
    return { success: true, fileId: fileId };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Appends a new slot to Posting_Schedule and returns the slot object.
 * Called when JT adds a custom slot via the platform picker popup.
 * @param {string} day       - 'Monday' | 'Tuesday' | ...
 * @param {string} platform  - 'Instagram Story' | 'Instagram Feed' | 'Reel' | etc.
 * @param {string} assetType - 'quote_graphic' | 'reel' | etc.
 * @returns {{ success: boolean, slot?: object, error?: string }}
 */
function addPostingSlot(day, platform, assetType) {
  try {
    var sheetId   = getMasterSheetId();
    var ss        = SpreadsheetApp.openById(sheetId);
    var schedSheet = ss.getSheetByName("Posting_Schedule");
    if (!schedSheet) return { success: false, error: "Posting_Schedule tab not found" };

    var existingData = schedSheet.getDataRange().getValues();
    var maxSort = 0;
    for (var i = 1; i < existingData.length; i++) {
      var s = Number(existingData[i][POSTING_SCHEDULE_COLS.Sort_Order - 1]) || 0;
      if (s > maxSort) maxSort = s;
    }

    var slotId   = "CUSTOM-" + day.toUpperCase().slice(0, 3) + "-" + Date.now();
    var sortOrder = maxSort + 10;
    var newRow   = new Array(Object.keys(POSTING_SCHEDULE_COLS).length).fill("");
    newRow[POSTING_SCHEDULE_COLS.Slot_ID    - 1] = slotId;
    newRow[POSTING_SCHEDULE_COLS.Day        - 1] = day;
    newRow[POSTING_SCHEDULE_COLS.Asset_Type - 1] = assetType || "quote_graphic";
    newRow[POSTING_SCHEDULE_COLS.Platform   - 1] = platform  || "";
    newRow[POSTING_SCHEDULE_COLS.Why        - 1] = "Custom slot";
    newRow[POSTING_SCHEDULE_COLS.Sort_Order - 1] = sortOrder;
    schedSheet.appendRow(newRow);

    return {
      success: true,
      slot: {
        slotId:    slotId,
        assetType: assetType || "quote_graphic",
        platform:  platform  || "",
        why:       "Custom slot",
        sortOrder: sortOrder,
        isPlaybook: false,
        filled:    null
      }
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ── ASSET ENRICHMENT ─────────────────────────────────────────────────────────

/**
 * Reads the raw podcast transcript for an episode and asks Claude to extract
 * hooks and quotes. Creates Asset_Library rows for each with Caption_Draft
 * (JSON array of 3 variants). Idempotent — skips texts already in AL.
 * @param {string} episodeUid
 * @returns {{ done: boolean, hooks?: number, quotes?: number, created?: number, error?: string }}
 */
function enrichQuoteAssetsFromTranscript(episodeUid) {
  try {
    var sheetId = getMasterSheetId();
    var ss      = SpreadsheetApp.openById(sheetId);
    var alName  = getGovernance("ASSET_LIBRARY_TAB_NAME") || "Asset_Library";
    var alSheet = ss.getSheetByName(alName);
    if (!alSheet) return { done: false, error: "Asset_Library tab not found" };

    // Scan existing quote_graphic rows — if any exist, skip re-extraction (Gemini is non-deterministic)
    var alData        = alSheet.getDataRange().getValues();
    var needsBackfill = []; // { rowNum, text } for rows with empty Caption_Draft
    var existingCount = 0;
    for (var i = 1; i < alData.length; i++) {
      var row = alData[i];
      if (String(row[ASSET_LIBRARY_COLS.Episode_UID - 1]) !== String(episodeUid)) continue;
      var normType = String(row[ASSET_LIBRARY_COLS.Asset_Type - 1]).toLowerCase().replace(/[_ ]/g, '');
      if (normType !== 'quotegraphic') continue;
      existingCount++;
      var existingText    = String(row[ASSET_LIBRARY_COLS.Quote_Text    - 1]).trim();
      var existingCaption = String(row[ASSET_LIBRARY_COLS.Caption_Draft - 1]).trim();
      if (!existingCaption || existingCaption === '[]') needsBackfill.push({ rowNum: i + 1, text: existingText });
    }

    // If rows already exist, only backfill missing captions — never re-extract
    if (existingCount > 0) {
      var manifest  = getEpisodeManifest(episodeUid);
      var guestName = (manifest && manifest.guest_name)    ? manifest.guest_name    : '';
      var epTitle   = (manifest && manifest.episode_title) ? manifest.episode_title : '';
      var backfilled = 0;
      if (needsBackfill.length) {
        var backfillMap = generateCaptionVariantsBatch_(
          needsBackfill.map(function(b) { return b.text; }),
          guestName, epTitle, false
        );
        needsBackfill.forEach(function(b, bIdx) {
          var variants = backfillMap[bIdx] || '[]';
          if (variants !== '[]') { alSheet.getRange(b.rowNum, ASSET_LIBRARY_COLS.Caption_Draft).setValue(variants); backfilled++; }
        });
        if (backfilled) bumpVersion("asset_library", "enrichQuoteAssetsFromTranscript");
      }
      return { done: true, skipped: existingCount, backfilled: backfilled };
    }

    // No existing rows — read transcript from Raw folder
    var rawFolderId = getRawFolderIdByUid(episodeUid);
    if (!rawFolderId) return { done: false, error: "Raw folder not found for: " + episodeUid };

    var transcriptText = null;
    var folder = DriveApp.getFolderById(rawFolderId);
    var files  = folder.getFiles();
    while (files.hasNext()) {
      var file = files.next();
      if (file.getName().toLowerCase().indexOf("transcript") === -1) continue;
      var mime = file.getMimeType();
      if (mime === "application/vnd.google-apps.document") {
        transcriptText = DocumentApp.openById(file.getId()).getBody().getText();
      } else if (mime === "text/plain") {
        transcriptText = file.getBlob().getDataAsString();
      } else if (mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
        transcriptText = file.getAs("text/plain").getDataAsString();
      }
      if (transcriptText) break;
    }
    if (!transcriptText) return { done: false, error: "No transcript file found in Raw folder" };

    var manifest  = getEpisodeManifest(episodeUid);
    var guestName = (manifest && manifest.guest_name)    ? manifest.guest_name    : '';
    var epTitle   = (manifest && manifest.episode_title) ? manifest.episode_title : '';
    var apiKey    = getGovernance("GEMINI_API_KEY");

    // Call 1: Gemini extracts hooks and quotes from the full transcript (1M-token context, no Claude TPM issue)
    // Line-based format avoids JSON parsing failures caused by embedded quotes in real transcript text
    var extractPrompt =
      "Extract hooks and quotes from this podcast transcript for social media quote graphics.\n\n" +
      "Guest: " + (guestName || "unknown") + "\n" +
      "Episode: " + (epTitle   || "unknown") + "\n\n" +
      "Hooks: standalone provocative or insightful statements that could stand alone on a quote graphic.\n" +
      "Quotes: direct, memorable verbatim speech from the guest — specific and emotionally true.\n" +
      "Extract 5–15 of each — only the best. Do not pad.\n\n" +
      "Return ONLY plain lines in this exact format (no JSON, no markdown, no numbering):\n" +
      "HOOK: the hook text\n" +
      "QUOTE: the quote text — " + (guestName || "Guest");

    var extraction = callGeminiTextAnalysis_(transcriptText, extractPrompt, apiKey);
    if (!extraction) return { done: false, error: "Gemini extraction returned nothing" };

    // Parse line-based response
    var hooks  = [];
    var quotes = [];
    var lines  = extraction.split(/\r?\n/);
    lines.forEach(function(line) {
      var trimmed = line.trim();
      if (/^HOOK:\s*/i.test(trimmed)) {
        var t = trimmed.replace(/^HOOK:\s*/i, '').trim();
        if (t) hooks.push(t);
      } else if (/^QUOTE:\s*/i.test(trimmed)) {
        var q = trimmed.replace(/^QUOTE:\s*/i, '').trim();
        if (q) quotes.push(q);
      }
    });

    var allEntries = hooks.map(function(t)  { return { prefix: 'Hook',  text: t }; })
                   .concat(quotes.map(function(t) { return { prefix: 'Quote', text: t }; }));
    if (!allEntries.length) return { done: true, hooks: 0, quotes: 0, created: 0 };

    // Call 2: one Claude batch call for all caption variants (Claude only sees short extracted texts)
    var variantMap = generateCaptionVariantsBatch_(
      allEntries.map(function(e) { return e.text; }),
      guestName, epTitle, false
    );

    // Write AL rows
    var created = 0;
    allEntries.forEach(function(entry, idx) {
      var captionVariants = variantMap[idx] || '[]';
      var assetId     = 'AL-' + episodeUid + '-QG-' + (Date.now() + idx);
      var displayName = entry.prefix + ': ' + entry.text.slice(0, 60);
      var newRow = new Array(Object.keys(ASSET_LIBRARY_COLS).length).fill('');
      newRow[ASSET_LIBRARY_COLS.Asset_ID     - 1] = assetId;
      newRow[ASSET_LIBRARY_COLS.Episode_UID  - 1] = episodeUid;
      newRow[ASSET_LIBRARY_COLS.Asset_Type   - 1] = 'quote_graphic';
      newRow[ASSET_LIBRARY_COLS.Display_Name - 1] = displayName;
      newRow[ASSET_LIBRARY_COLS.Quote_Text   - 1] = entry.text;
      newRow[ASSET_LIBRARY_COLS.Caption_Draft- 1] = captionVariants;
      newRow[ASSET_LIBRARY_COLS.Status       - 1] = 'candidate';
      newRow[ASSET_LIBRARY_COLS.Availability - 1] = 'available';
      newRow[ASSET_LIBRARY_COLS.Created_At   - 1] = new Date();
      newRow[ASSET_LIBRARY_COLS.Created_By   - 1] = 'transcript_enrichment';
      alSheet.appendRow(newRow);
      created++;
    });
    if (created) bumpVersion("asset_library", "enrichQuoteAssetsFromTranscript");
    return { done: true, hooks: hooks.length, quotes: quotes.length, created: created };
  } catch (err) {
    return { done: false, error: err.message };
  }
}

/**
 * Scans Staging/Reels/ for MP4 files, runs each through Gemini video for a
 * verbose description, then Claude for 3 caption variants. Creates or updates
 * Asset_Library rows. Idempotent — skips files already enriched.
 * @param {string} episodeUid
 * @returns {{ done: boolean, processed?: number, skipped?: number, error?: string }}
 */
function enrichReelsForEpisode(episodeUid) {
  try {
    var sheetId = getMasterSheetId();
    var ss      = SpreadsheetApp.openById(sheetId);
    var alName  = getGovernance("ASSET_LIBRARY_TAB_NAME") || "Asset_Library";
    var alSheet = ss.getSheetByName(alName);
    if (!alSheet) return { done: false, error: "Asset_Library tab not found" };

    // Index existing reel rows by Drive_File_ID
    var alData = alSheet.getDataRange().getValues();
    var existingByFileId = {};
    for (var i = 1; i < alData.length; i++) {
      var row = alData[i];
      if (String(row[ASSET_LIBRARY_COLS.Episode_UID - 1]) !== String(episodeUid)) continue;
      var normType = String(row[ASSET_LIBRARY_COLS.Asset_Type - 1]).toLowerCase().replace(/[_ ]/g, '');
      if (normType !== 'reel' && normType !== 'bankclip') continue;
      var fid = String(row[ASSET_LIBRARY_COLS.Drive_File_ID - 1]);
      if (fid) existingByFileId[fid] = { rowNum: i + 1, hasSummary: !!String(row[ASSET_LIBRARY_COLS.Reel_Summary - 1]).trim() };
    }

    // Scan Staging/Reels/ — prefer Approved/ subfolder
    var stagingId = getStagingFolderIdByUid(episodeUid);
    if (!stagingId) return { done: false, error: "Staging folder not found for: " + episodeUid };
    var reelsFolderIt = DriveApp.getFolderById(stagingId).getFoldersByName('Reels');
    if (!reelsFolderIt.hasNext()) return { done: true, processed: 0, skipped: 0 };
    var reelsFolder = reelsFolderIt.next();

    var mp4Files = [];
    var approvedIt = reelsFolder.getFoldersByName('Approved');
    if (approvedIt.hasNext()) {
      var aIt = approvedIt.next().getFiles();
      while (aIt.hasNext()) { var af = aIt.next(); if (af.getMimeType() === 'video/mp4') mp4Files.push(af); }
    }
    if (!mp4Files.length) {
      var rIt = reelsFolder.getFiles();
      while (rIt.hasNext()) { var rf = rIt.next(); if (rf.getMimeType() === 'video/mp4') mp4Files.push(rf); }
    }
    if (!mp4Files.length) return { done: true, processed: 0, skipped: 0 };

    var manifest  = getEpisodeManifest(episodeUid);
    var guestName = (manifest && manifest.guest_name)    ? manifest.guest_name    : '';
    var epTitle   = (manifest && manifest.episode_title) ? manifest.episode_title : '';
    var apiKey    = getGovernance("GEMINI_API_KEY");

    var processed  = 0;
    var skipped    = 0;
    var timedOut   = false;
    var startTime  = Date.now();
    var MAX_MS     = 4.5 * 60 * 1000; // leave 1.5 min buffer before GAS 6-min limit

    for (var reelNum = 0; reelNum < mp4Files.length; reelNum++) {
      if (Date.now() - startTime > MAX_MS) {
        timedOut = true;
        console.log('[enrichReelsForEpisode] Time limit approaching — stopping at reel ' + reelNum + '. Re-run to continue.');
        break;
      }

      var file     = mp4Files[reelNum];
      var fileId   = file.getId();
      var fileName = file.getName().replace(/\.mp4$/i, '').replace(/[_-]/g, ' ').trim();
      if (existingByFileId[fileId] && existingByFileId[fileId].hasSummary) { skipped++; continue; }

      var videoPrompt =
        "Watch this video clip carefully. This is from the 'Don't Waste Your Pain' podcast" +
        (guestName ? " featuring " + guestName : "") + ".\n\n" +
        "Describe in full detail:\n" +
        "1. What is being said — key phrases and direct quotes verbatim\n" +
        "2. The emotional tone and energy of the speaker\n" +
        "3. The main point or takeaway\n" +
        "4. Any compelling story beats or turning points\n\n" +
        "Be verbose and thorough — this will be used to write social media captions.";

      var summary = callGeminiVideoAnalysis_(fileId, videoPrompt, apiKey);
      if (!summary) { skipped++; continue; }

      var captionVariants = generateCaptionVariants_(summary, guestName, epTitle, true);

      if (existingByFileId[fileId]) {
        alSheet.getRange(existingByFileId[fileId].rowNum, ASSET_LIBRARY_COLS.Reel_Summary ).setValue(summary);
        alSheet.getRange(existingByFileId[fileId].rowNum, ASSET_LIBRARY_COLS.Caption_Draft).setValue(captionVariants);
      } else {
        var assetId = 'AL-' + episodeUid + '-RL-' + fileId.slice(-8);
        var newRow  = new Array(Object.keys(ASSET_LIBRARY_COLS).length).fill('');
        newRow[ASSET_LIBRARY_COLS.Asset_ID     - 1] = assetId;
        newRow[ASSET_LIBRARY_COLS.Episode_UID  - 1] = episodeUid;
        newRow[ASSET_LIBRARY_COLS.Asset_Type   - 1] = 'Reel';
        newRow[ASSET_LIBRARY_COLS.Drive_File_ID- 1] = fileId;
        newRow[ASSET_LIBRARY_COLS.Display_Name - 1] = (fileName.slice(0, 80) || ('Reel ' + (reelNum + 1)));
        newRow[ASSET_LIBRARY_COLS.Reel_Summary - 1] = summary;
        newRow[ASSET_LIBRARY_COLS.Caption_Draft- 1] = captionVariants;
        newRow[ASSET_LIBRARY_COLS.Status       - 1] = 'candidate';
        newRow[ASSET_LIBRARY_COLS.Availability - 1] = 'available';
        newRow[ASSET_LIBRARY_COLS.Created_At   - 1] = new Date();
        newRow[ASSET_LIBRARY_COLS.Created_By   - 1] = 'reel_enrichment';
        alSheet.appendRow(newRow);
      }
      processed++;
      Utilities.sleep(3000); // brief pause between files
    }

    if (processed) bumpVersion("asset_library", "enrichReelsForEpisode");
    return { done: true, processed: processed, skipped: skipped, timedOut: timedOut, remaining: timedOut ? mp4Files.length - processed - skipped : 0 };
  } catch (err) {
    return { done: false, error: err.message };
  }
}

/**
 * Uploads a Drive video to the Gemini Files API and returns a verbose
 * description using gemini-1.5-flash. Returns null on any failure.
 * @private
 */
function callGeminiVideoAnalysis_(driveFileId, prompt, apiKey) {
  try {
    var file     = DriveApp.getFileById(driveFileId);
    var fileSize = file.getSize();
    var mimeType = file.getMimeType() || 'video/mp4';
    var fileName = file.getName();
    if (fileSize > 45 * 1024 * 1024) {
      console.log("[callGeminiVideoAnalysis_] Skipping — too large (" + Math.round(fileSize / 1048576) + "MB): " + fileName);
      return null;
    }

    // Initiate resumable upload
    var initResp = UrlFetchApp.fetch(
      'https://generativelanguage.googleapis.com/upload/v1beta/files?uploadType=resumable&key=' + apiKey,
      {
        method: 'POST', contentType: 'application/json',
        headers: {
          'X-Goog-Upload-Protocol':              'resumable',
          'X-Goog-Upload-Command':               'start',
          'X-Goog-Upload-Header-Content-Length': String(fileSize),
          'X-Goog-Upload-Header-Content-Type':   mimeType
        },
        payload: JSON.stringify({ file: { display_name: fileName } }),
        muteHttpExceptions: true
      }
    );
    if (initResp.getResponseCode() !== 200) {
      console.log("[callGeminiVideoAnalysis_] Init failed " + initResp.getResponseCode());
      return null;
    }
    var hdrs      = initResp.getHeaders();
    var uploadUrl = hdrs['location'] || hdrs['Location'] || hdrs['x-goog-upload-url'];
    if (!uploadUrl) { console.log("[callGeminiVideoAnalysis_] No upload URL"); return null; }

    // Upload bytes
    var uploadResp = UrlFetchApp.fetch(uploadUrl, {
      method: 'POST', contentType: mimeType,
      headers: { 'X-Goog-Upload-Command': 'upload, finalize', 'X-Goog-Upload-Offset': '0' },
      payload: file.getBlob(),
      muteHttpExceptions: true
    });
    if (uploadResp.getResponseCode() !== 200) { console.log("[callGeminiVideoAnalysis_] Upload failed " + uploadResp.getResponseCode()); return null; }

    var gemFile = JSON.parse(uploadResp.getContentText()).file;
    if (!gemFile || !gemFile.uri) { console.log("[callGeminiVideoAnalysis_] No file URI"); return null; }

    // Poll until ACTIVE (max ~60s)
    var state = gemFile.state || 'PROCESSING';
    var polls = 0;
    while (state !== 'ACTIVE' && polls < 12) {
      Utilities.sleep(5000);
      state = (JSON.parse(UrlFetchApp.fetch(
        'https://generativelanguage.googleapis.com/v1beta/' + gemFile.name + '?key=' + apiKey,
        { muteHttpExceptions: true }
      ).getContentText()).state) || 'PROCESSING';
      polls++;
    }
    if (state !== 'ACTIVE') { console.log("[callGeminiVideoAnalysis_] Never became ACTIVE"); return null; }

    // Generate content
    var genResult = JSON.parse(UrlFetchApp.fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + apiKey,
      {
        method: 'POST', contentType: 'application/json',
        payload: JSON.stringify({ contents: [{ parts: [
          { file_data: { mime_type: mimeType, file_uri: gemFile.uri } },
          { text: prompt }
        ]}]}),
        muteHttpExceptions: true
      }
    ).getContentText());
    var text = genResult.candidates && genResult.candidates[0] &&
               genResult.candidates[0].content && genResult.candidates[0].content.parts &&
               genResult.candidates[0].content.parts[0] && genResult.candidates[0].content.parts[0].text;

    // Cleanup
    try { UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/' + gemFile.name + '?key=' + apiKey, { method: 'DELETE', muteHttpExceptions: true }); } catch (e) {}

    return text || null;
  } catch (err) {
    console.log("[callGeminiVideoAnalysis_] Error: " + err.message);
    return null;
  }
}

/**
 * Calls Claude for 3 caption variants for a quote graphic or reel clip.
 * Returns a JSON array string '["v1","v2","v3"]', or '[]' on failure.
 * @private
 */
function generateCaptionVariants_(contentText, guestName, epTitle, forReel) {
  try {
    var limit  = forReel ? '500' : '150';
    var angle3 = forReel
      ? '3. Story-lead: opens with the emotional context or a turning point in the clip, then delivers the insight'
      : '3. Story-tease: implies there is a bigger story behind this moment';
    var reelRules = forReel
      ? "Rules: DWYP voice — honest, direct, specific, unsentimental. " +
        "Each caption is 3–5 full sentences. Do not tease — say the actual thing. " +
        "Draw directly from the content: name the specific idea, moment, or claim. " +
        "First sentence is the hook (bold claim or specific detail). " +
        "Remaining sentences develop the idea or give it stakes. " +
        "Under " + limit + " characters. No hashtags."
      : "Rules: DWYP voice — honest, direct, specific, unsentimental. Each under " + limit + " characters. No hashtags.";
    var prompt =
      "Write exactly 3 Instagram caption variants for a " + (forReel ? 'short podcast Reel' : 'quote graphic') + ".\n\n" +
      (guestName ? "Guest: " + guestName + "\n" : "") +
      (epTitle   ? "Episode: " + epTitle + "\n\n" : "\n") +
      "Content:\n" + contentText + "\n\n" +
      "Each variant takes a different angle:\n" +
      "1. Hook-first: opens with the most compelling claim or direct quote\n" +
      "2. Question-lead: opens with a question this content answers\n" +
      angle3 + "\n\n" +
      reelRules + "\n\n" +
      'Return ONLY a JSON array: ["caption1", "caption2", "caption3"]';

    var response = callClaudeAPI(
      prompt, CLAUDE_STUDIO_SYSTEM + STUDIO_MODE_INSTRUCTIONS['social'],
      'Enrichment', null, { maxTokens: 800 }
    );
    if (!response) return '[]';
    var match = response.match(/\[[\s\S]*?\]/);
    return match ? match[0] : '[]';
  } catch (err) {
    return '[]';
  }
}

/**
 * One Claude call for N items — returns object keyed by index with JSON-string variant arrays.
 * Avoids per-item API calls and stays well under 30k TPM since input is compact extracted text.
 * @private
 * @param {string[]} texts
 * @param {string} guestName
 * @param {string} epTitle
 * @param {boolean} forReel
 * @returns {Object.<string, string>} e.g. {"0": '["v1","v2","v3"]', "1": '["v1","v2","v3"]'}
 */
function generateCaptionVariantsBatch_(texts, guestName, epTitle, forReel) {
  try {
    if (!texts || !texts.length) return {};
    var limit  = forReel ? '500' : '150';
    var angle3 = forReel
      ? '3. Story-lead: opens with the emotional context or a turning point in the clip, then delivers the insight'
      : '3. Story-tease: implies there is a bigger story behind this moment';
    var reelRules = forReel
      ? "Rules: DWYP voice — honest, direct, specific, unsentimental. " +
        "Each caption is 3–5 full sentences. Do not tease — say the actual thing. " +
        "Draw directly from the content: name the specific idea, moment, or claim. " +
        "First sentence is the hook (bold claim or specific detail). " +
        "Remaining sentences develop the idea or give it stakes. " +
        "Under " + limit + " characters. No hashtags."
      : "Rules: DWYP voice — honest, direct, specific, unsentimental. Each under " + limit + " characters. No hashtags.";
    var itemLines = texts.map(function(t, i) { return '[' + i + ']: ' + t; }).join('\n');
    var prompt =
      "Write exactly 3 Instagram caption variants for EACH of the following " +
      (forReel ? 'Reel clips' : 'quote graphic items') + " from the Don't Waste Your Pain podcast.\n\n" +
      (guestName ? "Guest: " + guestName + "\n" : "") +
      (epTitle   ? "Episode: " + epTitle   + "\n\n" : "\n") +
      "Each variant takes a different angle:\n" +
      "1. Hook-first: opens with the most compelling claim or direct quote\n" +
      "2. Question-lead: opens with a question this content answers\n" +
      angle3 + "\n\n" +
      reelRules + "\n\n" +
      "Items:\n" + itemLines + "\n\n" +
      'Return ONLY a JSON object where keys are item indices (strings) and values are arrays of 3 captions:\n' +
      '{"0": ["cap1","cap2","cap3"], "1": ["cap1","cap2","cap3"], ...}';

    var response = callClaudeAPI(
      prompt, CLAUDE_STUDIO_SYSTEM + STUDIO_MODE_INSTRUCTIONS['social'],
      'Enrichment', null, { maxTokens: 4096 }
    );
    if (!response) return {};
    var objMatch = response.match(/\{[\s\S]*\}/);
    if (!objMatch) return {};
    var parsed = JSON.parse(objMatch[0]);
    var result = {};
    Object.keys(parsed).forEach(function(k) {
      result[k] = Array.isArray(parsed[k]) ? JSON.stringify(parsed[k]) : '[]';
    });
    return result;
  } catch (err) {
    console.log('[generateCaptionVariantsBatch_] Error: ' + err.message);
    return {};
  }
}

/**
 * Calls Gemini Flash with plain text input. No file upload needed — text goes directly in the
 * generateContent payload. Gemini handles the full transcript size (up to ~1M tokens).
 * @private
 * @param {string} textContent  The full text to analyze
 * @param {string} prompt       Instruction prepended to the text
 * @param {string} apiKey
 * @returns {string|null}
 */
function callGeminiTextAnalysis_(textContent, prompt, apiKey) {
  try {
    var resp = UrlFetchApp.fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + apiKey,
      {
        method: 'POST', contentType: 'application/json',
        payload: JSON.stringify({ contents: [{ parts: [{ text: prompt + '\n\nTRANSCRIPT:\n' + textContent }] }] }),
        muteHttpExceptions: true
      }
    );
    if (resp.getResponseCode() !== 200) {
      console.log('[callGeminiTextAnalysis_] Error ' + resp.getResponseCode() + ': ' + resp.getContentText().slice(0, 300));
      return null;
    }
    var result = JSON.parse(resp.getContentText());
    var text = result.candidates && result.candidates[0] &&
               result.candidates[0].content && result.candidates[0].content.parts &&
               result.candidates[0].content.parts[0] && result.candidates[0].content.parts[0].text;
    return text || null;
  } catch (err) {
    console.log('[callGeminiTextAnalysis_] Error: ' + err.message);
    return null;
  }
}

// ── REELS SURFACE ─────────────────────────────────────────────────────────────

/**
 * Returns all Asset_Library rows for an episode where Asset_Type is Reel/BankClip
 * and Status != rejected. Used by the Reels Surface card list.
 */
function getReelsForEpisode(episodeUid) {
  try {
    var sheetId = getMasterSheetId();
    var ss      = SpreadsheetApp.openById(sheetId);
    var alName  = getGovernance("ASSET_LIBRARY_TAB_NAME") || "Asset_Library";
    var sheet   = ss.getSheetByName(alName);
    if (!sheet) return [];
    var data    = sheet.getDataRange().getValues();
    var reels   = [];
    for (var i = 1; i < data.length; i++) {
      var row      = data[i];
      if (String(row[ASSET_LIBRARY_COLS.Episode_UID - 1]) !== String(episodeUid)) continue;
      var normType = String(row[ASSET_LIBRARY_COLS.Asset_Type - 1]).toLowerCase().replace(/[_ ]/g, '');
      if (normType !== 'reel' && normType !== 'bankclip') continue;
      var status   = String(row[ASSET_LIBRARY_COLS.Status - 1]).toLowerCase();
      if (status === 'rejected') continue;
      var fileId   = String(row[ASSET_LIBRARY_COLS.Drive_File_ID - 1]);
      reels.push({
        _rowIndex:     i + 1,
        Asset_ID:      String(row[ASSET_LIBRARY_COLS.Asset_ID      - 1]),
        Episode_UID:   String(row[ASSET_LIBRARY_COLS.Episode_UID   - 1]),
        Asset_Type:    String(row[ASSET_LIBRARY_COLS.Asset_Type    - 1]),
        Drive_File_ID: fileId,
        Display_Name:  String(row[ASSET_LIBRARY_COLS.Display_Name  - 1] || ''),
        Reel_Summary:  String(row[ASSET_LIBRARY_COLS.Reel_Summary  - 1] || ''),
        Caption_Draft: String(row[ASSET_LIBRARY_COLS.Caption_Draft - 1] || ''),
        Caption_Final: String(row[ASSET_LIBRARY_COLS.Caption_Final - 1] || ''),
        Status:        String(row[ASSET_LIBRARY_COLS.Status        - 1]),
        Availability:  String(row[ASSET_LIBRARY_COLS.Availability  - 1]),
        createdAt:     String(row[ASSET_LIBRARY_COLS.Created_At    - 1] || ''),
        thumbnailUrl:  fileId ? 'https://drive.google.com/thumbnail?id=' + fileId + '&sz=w160' : ''
      });
    }
    // Deduplicate by Drive_File_ID — keep row with Caption_Final, then newest Created_At
    var bestByKey = {};
    var keyOrder  = [];
    reels.forEach(function(r) {
      var key = r.Drive_File_ID || r.Asset_ID;
      if (!bestByKey[key]) { bestByKey[key] = r; keyOrder.push(key); return; }
      var prev      = bestByKey[key];
      var prevScore = (prev.Caption_Final ? 2 : 0) + (prev.Reel_Summary ? 1 : 0);
      var currScore = (r.Caption_Final    ? 2 : 0) + (r.Reel_Summary    ? 1 : 0);
      if (currScore > prevScore || (currScore === prevScore && r.createdAt > prev.createdAt)) {
        bestByKey[key] = r;
      }
    });
    return keyOrder.map(function(k) { return bestByKey[k]; });
  } catch (e) {
    return [];
  }
}

/**
 * Writes Caption_Final to the Asset_Library row matching Asset_ID.
 * Called debounced on caption blur from the Reels Surface card list.
 */
function updateCaption(assetId, captionFinal) {
  try {
    var sheetId = getMasterSheetId();
    var ss      = SpreadsheetApp.openById(sheetId);
    var alName  = getGovernance("ASSET_LIBRARY_TAB_NAME") || "Asset_Library";
    var sheet   = ss.getSheetByName(alName);
    if (!sheet) return { success: false, error: "Asset_Library tab not found" };
    var data    = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][ASSET_LIBRARY_COLS.Asset_ID - 1]) !== String(assetId)) continue;
      sheet.getRange(i + 1, ASSET_LIBRARY_COLS.Caption_Final).setValue(captionFinal);
      bumpVersion("asset_library", "updateCaption");
      return { success: true };
    }
    return { success: false, error: "Asset not found: " + assetId };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Writes Display_Name to the Asset_Library row matching Asset_ID.
 * Called on name edit commit from the Reels Surface card list.
 */
function updateDisplayName(assetId, displayName) {
  try {
    var sheetId = getMasterSheetId();
    var ss      = SpreadsheetApp.openById(sheetId);
    var alName  = getGovernance("ASSET_LIBRARY_TAB_NAME") || "Asset_Library";
    var sheet   = ss.getSheetByName(alName);
    if (!sheet) return { success: false, error: "Asset_Library tab not found" };
    var data    = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][ASSET_LIBRARY_COLS.Asset_ID - 1]) !== String(assetId)) continue;
      sheet.getRange(i + 1, ASSET_LIBRARY_COLS.Display_Name).setValue(displayName);
      bumpVersion("asset_library", "updateDisplayName");
      return { success: true };
    }
    return { success: false, error: "Asset not found: " + assetId };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Routes a Reels Surface caption chat request to Claude or Gemini per PUBLISH_LLM_MODE.
 * Assembles system prompt + episode/reel context from sheets (never shown to JT).
 * payload: { episodeUid, assetId, platform, day, captionCurrent, conversationHistory, userMessage }
 */
function callPublishLLM(payload) {
  try {
    var episodeUid     = payload.episodeUid      || '';
    var assetId        = payload.assetId         || '';
    var platform       = payload.platform        || '';
    var day            = payload.day             || '';
    var captionCurrent = payload.captionCurrent  || '';
    var history        = payload.conversationHistory || [];
    var userMessage    = payload.userMessage     || "Please give me 3 caption options for this reel.";

    var reelSummary = '';
    var sheetId     = getMasterSheetId();
    var ss          = SpreadsheetApp.openById(sheetId);
    var alName      = getGovernance("ASSET_LIBRARY_TAB_NAME") || "Asset_Library";
    var alSheet     = ss.getSheetByName(alName);
    if (alSheet && assetId) {
      var alData = alSheet.getDataRange().getValues();
      for (var i = 1; i < alData.length; i++) {
        if (String(alData[i][ASSET_LIBRARY_COLS.Asset_ID - 1]) !== String(assetId)) continue;
        reelSummary = String(alData[i][ASSET_LIBRARY_COLS.Reel_Summary - 1] || '').trim();
        break;
      }
    }

    var guestName = '';
    if (episodeUid) {
      var manifest = getEpisodeManifest(episodeUid);
      guestName    = (manifest && manifest.guest_name) ? manifest.guest_name : '';
    }

    var systemPrompt =
      "You are a social media caption collaborator for the Don't Waste Your Pain podcast, hosted by JT (Jennifer Trepanier). " +
      "You write in JT's brand voice: warm, direct, faith-adjacent but not churchy, emotionally honest. " +
      "You are a collaborator, not a caption bot. Respond conversationally. " +
      "When generating caption options, return them as discrete options formatted with [[CAPTION:option text]] " +
      "delimiters so the UI can render them as tappable chips.\n\n" +
      "Context:\n" +
      (guestName       ? "- Episode guest: "  + guestName      + "\n" : "") +
      (episodeUid      ? "- Episode UID: "    + episodeUid     + "\n" : "") +
      (day && platform ? "- Slot: Reel for "  + platform + " on " + day + "\n" : "") +
      (reelSummary     ? "- Reel summary: "   + reelSummary    + "\n" : "") +
      (captionCurrent  ? "- Current caption: "+ captionCurrent + "\n" : "");

    var mode = (getGovernance("PUBLISH_LLM_MODE") || "claude").toLowerCase();
    var responseText;
    if (mode === "gemini") {
      var historyText = '';
      history.forEach(function(msg) {
        historyText += (msg.role === 'user' ? 'User: ' : 'Assistant: ') + msg.content + '\n';
      });
      var fullPrompt = systemPrompt + (historyText ? '\n\n' + historyText : '') + '\nUser: ' + userMessage;
      responseText   = callGeminiAPI(fullPrompt, null);
    } else {
      responseText = callClaudeAPI(userMessage, systemPrompt, 'Publish', history, { maxTokens: 512 });
    }
    return { success: true, text: responseText || '' };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Writes a Social_Assets row and updates Asset_Library Status → scheduled / Availability → placed.
 * Called when JT confirms a reel schedule from the schedule popover.
 * schedulePayload: { episodeUid, slotId, assetId, caption, driveFileId, platform, scheduledAt }
 */
function scheduleReel(schedulePayload) {
  try {
    var episodeUid  = schedulePayload.episodeUid  || '';
    var slotId      = schedulePayload.slotId      || '';
    var assetId     = schedulePayload.assetId     || '';
    var caption     = schedulePayload.caption     || '';
    var driveFileId = schedulePayload.driveFileId || '';
    var platform    = schedulePayload.platform    || '';
    var scheduledAt = schedulePayload.scheduledAt ? new Date(schedulePayload.scheduledAt) : new Date();

    var sheetId = getMasterSheetId();
    var ss      = SpreadsheetApp.openById(sheetId);
    var alName  = getGovernance("ASSET_LIBRARY_TAB_NAME") || "Asset_Library";
    var alSheet = ss.getSheetByName(alName);
    var saSheet = ss.getSheetByName("Social_Assets");
    if (!saSheet) return { success: false, error: "Social_Assets tab not found" };

    if (assetId && alSheet) {
      var alData = alSheet.getDataRange().getValues();
      for (var i = 1; i < alData.length; i++) {
        if (String(alData[i][ASSET_LIBRARY_COLS.Asset_ID - 1]) !== String(assetId)) continue;
        alSheet.getRange(i + 1, ASSET_LIBRARY_COLS.Status      ).setValue("scheduled");
        alSheet.getRange(i + 1, ASSET_LIBRARY_COLS.Availability).setValue("placed");
        if (!driveFileId) driveFileId = String(alData[i][ASSET_LIBRARY_COLS.Drive_File_ID - 1]);
        break;
      }
    }

    var postId = "PB-" + episodeUid + "-" + slotId + "-" + Date.now();
    var saRow  = new Array(Object.keys(SOCIAL_ASSETS_COLS).length).fill("");
    saRow[SOCIAL_ASSETS_COLS.Post_ID          - 1] = postId;
    saRow[SOCIAL_ASSETS_COLS.Asset_Library_ID - 1] = assetId;
    saRow[SOCIAL_ASSETS_COLS.Episode_UID      - 1] = episodeUid;
    saRow[SOCIAL_ASSETS_COLS.Slot             - 1] = slotId;
    saRow[SOCIAL_ASSETS_COLS.Asset_Type       - 1] = "Reel";
    saRow[SOCIAL_ASSETS_COLS.Platform         - 1] = platform;
    saRow[SOCIAL_ASSETS_COLS.Caption          - 1] = caption;
    saRow[SOCIAL_ASSETS_COLS.Drive_File_ID    - 1] = driveFileId;
    saRow[SOCIAL_ASSETS_COLS.Scheduled_At     - 1] = scheduledAt;
    saRow[SOCIAL_ASSETS_COLS.Scheduler_Status - 1] = "pending";
    saRow[SOCIAL_ASSETS_COLS.Created_At       - 1] = new Date();
    saRow[SOCIAL_ASSETS_COLS.Created_By       - 1] = Session.getEffectiveUser().getEmail();
    saSheet.appendRow(saRow);
    bumpVersion("asset_library", "scheduleReel");
    return { success: true, postId: postId };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Creates a revision request row in the Revision_Requests sheet.
 * payload: { episodeUid, assetId, assetType, reelName, requestText }
 */
function submitRevisionRequest(payload) {
  try {
    var sheetId = getMasterSheetId();
    var ss      = SpreadsheetApp.openById(sheetId);
    var tabName = getGovernance("REVISION_REQUESTS_TAB_NAME") || "Revision_Requests";
    var sheet   = ss.getSheetByName(tabName);
    if (!sheet) {
      sheet = ss.insertSheet(tabName);
      sheet.appendRow(['Request_ID','Episode_UID','Asset_ID','Asset_Type','Reel_Name','Request_Text','Status','Created_At','Created_By']);
      sheet.setFrozenRows(1);
    }
    var requestId = 'REV-' + new Date().getTime();
    sheet.appendRow([
      requestId,
      payload.episodeUid  || '',
      payload.assetId     || '',
      payload.assetType   || 'Reel',
      payload.reelName    || '',
      payload.requestText || '',
      'open',
      new Date().toISOString(),
      'JT'
    ]);
    return { success: true, requestId: requestId };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Releases a scheduled reel back to the library.
 * Sets Asset_Library Status → candidate, Availability → available.
 * Sets Social_Assets Scheduler_Status → cancelled for pending rows matching assetId.
 */
function unscheduleReel(assetId) {
  try {
    var sheetId = getMasterSheetId();
    var ss      = SpreadsheetApp.openById(sheetId);
    var alName  = getGovernance("ASSET_LIBRARY_TAB_NAME") || "Asset_Library";
    var saName  = getGovernance("SOCIAL_ASSETS_TAB_NAME") || "Social_Assets";
    var alSheet = ss.getSheetByName(alName);
    var saSheet = ss.getSheetByName(saName);

    if (alSheet) {
      var alData = alSheet.getDataRange().getValues();
      for (var i = 1; i < alData.length; i++) {
        if (String(alData[i][ASSET_LIBRARY_COLS.Asset_ID - 1]) === String(assetId)) {
          alSheet.getRange(i + 1, ASSET_LIBRARY_COLS.Status).setValue('candidate');
          alSheet.getRange(i + 1, ASSET_LIBRARY_COLS.Availability).setValue('available');
          break;
        }
      }
    }

    if (saSheet) {
      var saData = saSheet.getDataRange().getValues();
      for (var j = 1; j < saData.length; j++) {
        if (String(saData[j][SOCIAL_ASSETS_COLS.Asset_Library_ID - 1]) === String(assetId) &&
            String(saData[j][SOCIAL_ASSETS_COLS.Scheduler_Status - 1]).toLowerCase() === 'pending') {
          saSheet.getRange(j + 1, SOCIAL_ASSETS_COLS.Scheduler_Status).setValue('cancelled');
        }
      }
    }

    bumpVersion("asset_library", "unscheduleReel");
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
