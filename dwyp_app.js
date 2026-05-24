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

// Asset_Library tab column map (20 columns — single source of truth for content assets)
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
  Caption_Host:  10,  // working caption — sole source of truth for card render, schedule, Make pull
  Caption_Guest: 11,  // omni-voice caption for guest package (Guest Package builder populates; empty until then)
  Notes:         12,
  Background_ID: 13,
  Canvas_State:  14,
  Status:        15,  // candidate | scheduled | bank | rejected
  Availability:  16,  // available | placed | paired
  Created_At:    17,
  Created_By:    18,
  Quality_Score: 19,  // int 1–5; empty until midnight pass populates — read-only in wiring spoke
  Slot_Tags:     20,  // comma-separated Posting_Schedule Slot_IDs; empty until midnight pass
  Display_Text:  21   // JT-edited card text; source of truth for card stack render; null until first edit
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
  Note_Sent_At:      16,
  Asset_ID:          17   // FK to Asset_Library.Asset_ID for revision tasks
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
  Frameio_Project_ID:  15,
  Guest_Package_URL:   16  // populated by Guest Package builder spoke; open slot only
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
      Payload_Link:      row[TASKS_COLS.Payload_Link - 1],
      Asset_ID:          String(row[TASKS_COLS.Asset_ID - 1] || "")
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

    // Build row in TASKS_COLS order (17 columns)
    var dueDate = payload.dueDate ? new Date(payload.dueDate) : "";

    var row = new Array(17).fill("");
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
    row[TASKS_COLS.Asset_ID          - 1] = payload.assetId          || "";

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
        Caption:      String(row[ASSET_LIBRARY_COLS.Caption_Host - 1] || ''),
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
      // RETIRED Slide_Index pairing (May 2026) — one asset = one slot
      // if (placedSlideIdx && placedSlideIdx !== "") {
      //   for (var j = 1; j < alData.length; j++) {
      //     if (String(alData[j][ASSET_LIBRARY_COLS.Asset_ID    - 1]) === String(assetId))     continue;
      //     if (String(alData[j][ASSET_LIBRARY_COLS.Episode_UID - 1]) !== String(episodeUid))  continue;
      //     if (String(alData[j][ASSET_LIBRARY_COLS.Slide_Index - 1]) !== placedSlideIdx)      continue;
      //     alSheet.getRange(j + 1, ASSET_LIBRARY_COLS.Availability).setValue("paired");
      //   }
      // }
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
        // RETIRED Slide_Index pairing (May 2026) — one asset = one slot
        // if (slideIdx && slideIdx !== "" && slideIdx !== "null") {
        //   for (var k = 1; k < alData.length; k++) {
        //     if (String(alData[k][ASSET_LIBRARY_COLS.Asset_ID    - 1]) === foundAlId)    continue;
        //     if (String(alData[k][ASSET_LIBRARY_COLS.Episode_UID - 1]) !== episodeUid)   continue;
        //     if (String(alData[k][ASSET_LIBRARY_COLS.Slide_Index - 1]) !== slideIdx)     continue;
        //     if (String(alData[k][ASSET_LIBRARY_COLS.Availability- 1]) === "paired") {
        //       alSheet.getRange(k + 1, ASSET_LIBRARY_COLS.Availability).setValue("available");
        //     }
        //   }
        // }
      }
    }

    bumpVersion("asset_library", "unscheduleAsset");
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ── CANVAS UNSCHEDULE HELPERS (Phase 2, May 2026) ────────────────────────────

/**
 * Returns a plain object for the Asset_Library row matching assetId, or null.
 * Includes _rowNum for targeted writes.
 */
function getAssetLibraryRow(assetId) {
  var sheetId = getMasterSheetId();
  var ss      = SpreadsheetApp.openById(sheetId);
  var alName  = getGovernance("ASSET_LIBRARY_TAB_NAME") || "Asset_Library";
  var alSheet = ss.getSheetByName(alName);
  if (!alSheet) return null;
  var data = alSheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][ASSET_LIBRARY_COLS.Asset_ID - 1]) !== String(assetId)) continue;
    var row = data[i];
    return {
      _rowNum:       i + 1,
      Asset_ID:      String(row[ASSET_LIBRARY_COLS.Asset_ID      - 1]),
      Episode_UID:   String(row[ASSET_LIBRARY_COLS.Episode_UID   - 1]),
      Drive_File_ID: String(row[ASSET_LIBRARY_COLS.Drive_File_ID - 1] || ''),
      Status:        String(row[ASSET_LIBRARY_COLS.Status        - 1]),
      Availability:  String(row[ASSET_LIBRARY_COLS.Availability  - 1]),
      Quote_Text:    String(row[ASSET_LIBRARY_COLS.Quote_Text    - 1] || ''),
      Caption_Host:  String(row[ASSET_LIBRARY_COLS.Caption_Host  - 1] || '')
    };
  }
  return null;
}

/**
 * Patches specific ASSET_LIBRARY_COLS fields on the row for assetId.
 * @param {string} assetId
 * @param {Object} fields  e.g. { Status: 'candidate', Drive_File_ID: '' }
 */
function patchAssetLibraryRow(assetId, fields) {
  var sheetId = getMasterSheetId();
  var ss      = SpreadsheetApp.openById(sheetId);
  var alName  = getGovernance("ASSET_LIBRARY_TAB_NAME") || "Asset_Library";
  var alSheet = ss.getSheetByName(alName);
  if (!alSheet) return;
  var data = alSheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][ASSET_LIBRARY_COLS.Asset_ID - 1]) !== String(assetId)) continue;
    var rowNum = i + 1;
    Object.keys(fields).forEach(function(colName) {
      var colIdx = ASSET_LIBRARY_COLS[colName];
      if (colIdx) alSheet.getRange(rowNum, colIdx).setValue(fields[colName]);
    });
    break;
  }
}

/**
 * Sets Status = 'rejected' on an Asset_Library row. Card stops appearing in candidate pool.
 */
function rejectAsset(assetId) {
  try {
    patchAssetLibraryRow(assetId, { Status: 'rejected' });
    bumpVersion('asset_library', 'rejectAsset');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Deletes the first Social_Assets row whose Asset_Library_ID column matches assetId.
 */
function deleteSocialAssetByAssetLibraryId(assetId) {
  var sheetId = getMasterSheetId();
  var ss      = SpreadsheetApp.openById(sheetId);
  var saSheet = ss.getSheetByName("Social_Assets");
  if (!saSheet) return;
  var data = saSheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][SOCIAL_ASSETS_COLS.Asset_Library_ID - 1]) !== String(assetId)) continue;
    saSheet.deleteRow(i + 1);
    break;
  }
}

/**
 * Canvas-level unschedule by assetId.
 * Trashes the Drive PNG (non-fatal), deletes the Social_Assets row, and resets the
 * Asset_Library row to candidate/available — preserving Quote_Text and Caption_Host.
 *
 * Distinct from unscheduleAsset(episodeUid, slotId), which operates by slot lookup
 * and is called from the accordion-level unschedule flow.
 */
function unscheduleAssetById(assetId) {
  var agentName = "Publish_Unschedule";
  try {
    var alRow = getAssetLibraryRow(assetId);
    if (!alRow) throw new Error("Asset not found: " + assetId);

    // 1. Trash the PNG — non-fatal; log warn and continue on failure
    if (alRow.Drive_File_ID) {
      try {
        DriveApp.getFileById(alRow.Drive_File_ID).setTrashed(true);
      } catch (e) {
        logToAuditTrail(agentName, "state_change", alRow.Episode_UID, "",
          "PNG_TRASH_FAILED for " + alRow.Drive_File_ID + ": " + e.message, "WARN");
      }
    }

    // 2. Delete matching Social_Assets row
    deleteSocialAssetByAssetLibraryId(assetId);

    // 3. Reset AL row — Quote_Text and Caption_Host are intentionally preserved
    patchAssetLibraryRow(assetId, {
      Status:        'candidate',
      Availability:  'available',
      Drive_File_ID: '',
      Canvas_State:  ''
    });

    bumpVersion("asset_library", "unscheduleAssetById");
    logToAuditTrail(agentName, "state_change", alRow.Episode_UID, "",
      "Unscheduled " + assetId + " — quote and caption preserved.", "INFO");

    return { success: true, assetId: assetId };
  } catch (e) {
    logToAuditTrail(agentName, "error", "", "",
      "UNSCHEDULE_FAILED for " + assetId + ": " + e.message, "ERROR");
    return { success: false, error: e.message };
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
 * Manual trigger for Track A (Episode Index build) from Fairy Remote Control.
 * Calls buildEpisodeIndexV2 — Claude reads transcript directly, writes neutral
 * knowledge index, patches manifest.episode_index_v2.
 */
function runVertFairyForEpisode(episodeUid) {
  try {
    logToAuditTrail("DWYP_App", "human_action", episodeUid, "",
      "[INFO] Manual Track A trigger from Fairy Remote Control.");
    buildEpisodeIndexV2(episodeUid, { force: false });
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
      try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}
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
 * Returns up to 30 images from the PRECOMP_BG_IMAGES Drive folder.
 * Used as the fallback candidate pool in getRankedCandidates() before Vert Fairy Pass 2 ships.
 * @returns {{ fileId: string, name: string, thumbnailUrl: string }[]}
 * Publish no longer consumes — Design tab only (May 2026 pare-down).
 */
function getPrecompBgImages() {
  try {
    var folderId = getGovernance('PRECOMP_BACKGROUND_LIBRARY_ID');
    if (!folderId) return [];
    var folder = DriveApp.getFolderById(folderId);
    var files   = folder.getFiles();
    var result  = [];
    while (files.hasNext() && result.length < 60) {
      var file = files.next();
      if (file.getMimeType().indexOf('image/') !== 0) continue;
      var id   = file.getId();
      var name = file.getName();
      // Parse text color signal from filename: *_darktext → black, *_lighttext (or anything else) → white
      var lower     = name.toLowerCase();
      var textColor = lower.indexOf('darktext') !== -1 ? '#1a1714' : '#ffffff';
      try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}
      result.push({
        fileId:       id,
        name:         name,
        textColor:    textColor,
        thumbnailUrl: 'https://drive.google.com/thumbnail?id=' + id + '&sz=w320'
      });
    }
    // Sort by filename so bg_001 < bg_002 regardless of Drive insertion order
    result.sort(function(a, b) { return a.name.localeCompare(b.name); });
    return result;
  } catch (err) {
    return [];
  }
}

function saveAssetDraft(assetId, canvasJson, captionText, displayText, captionFinal) {
  try {
    var ss     = SpreadsheetApp.openById(getMasterSheetId());
    var alName = getGovernance('ASSET_LIBRARY_TAB_NAME') || 'Asset_Library';
    var sheet  = ss.getSheetByName(alName);
    if (!sheet) return { ok: false, error: 'Asset_Library tab not found' };

    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][ASSET_LIBRARY_COLS.Asset_ID - 1]) !== String(assetId)) continue;
      var row     = i + 1;
      var written = false;
      if (captionText !== undefined && captionText !== null) {
        sheet.getRange(row, ASSET_LIBRARY_COLS.Caption_Host).setValue(captionText);
        written = true;
      }
      if (canvasJson !== undefined && canvasJson !== null) {
        sheet.getRange(row, ASSET_LIBRARY_COLS.Canvas_State).setValue(canvasJson);
        written = true;
      }
      if (displayText !== undefined && displayText !== null) {
        sheet.getRange(row, ASSET_LIBRARY_COLS.Display_Text).setValue(displayText);
        written = true;
      }
      // Caption_Guest (col 11) reserved for Guest Package builder — not written here
      if (written) bumpVersion('asset_library', 'saveAssetDraft');
      return { ok: true };
    }
    return { ok: false, error: 'Asset not found: ' + assetId };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Returns the display-layer state for a single asset: display_text, caption_host,
 * caption_guest, canvas_state, and quote_text_fallback.
 * Used by the frontend to do a targeted refresh without re-fetching the full candidate list.
 */
function getAssetDisplayState(assetId) {
  try {
    var ss     = SpreadsheetApp.openById(getMasterSheetId());
    var alName = getGovernance('ASSET_LIBRARY_TAB_NAME') || 'Asset_Library';
    var sheet  = ss.getSheetByName(alName);
    if (!sheet) return { ok: false, error: 'Asset_Library tab not found' };
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][ASSET_LIBRARY_COLS.Asset_ID - 1]) !== String(assetId)) continue;
      return {
        ok:                  true,
        display_text:        String(data[i][ASSET_LIBRARY_COLS.Display_Text  - 1] || '') || null,
        caption_guest:       String(data[i][ASSET_LIBRARY_COLS.Caption_Guest - 1] || ''),
        caption_host:        String(data[i][ASSET_LIBRARY_COLS.Caption_Host  - 1] || ''),
        canvas_state:        String(data[i][ASSET_LIBRARY_COLS.Canvas_State  - 1] || '') || null,
        quote_text_fallback: String(data[i][ASSET_LIBRARY_COLS.Quote_Text    - 1] || '')
      };
    }
    return { ok: false, error: 'Asset not found: ' + assetId };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Returns the full image as a base64 data URL for canvas placement.
 * Used instead of a Drive URL to avoid CORS restrictions in the GAS web app.
 * @param {string} fileId
 * @returns {{ success: true, dataUrl: string } | { success: false, error: string }}
 */
/**
 * Exports the current canvas render to a Manual_Exports subfolder inside the episode working folder.
 * Also writes canvasJson to the AL row (Export IS save + render — canonical state after manual export).
 * @param {string} episodeUid
 * @param {string} slotId
 * @param {string} assetId
 * @param {string} b64           - base64-encoded PNG, no data: prefix
 * @param {string} canvasJson    - Fabric.js canvas JSON, base64 srcs already stripped
 * @returns {{ success: boolean, filename?: string, url?: string, folderUrl?: string, error?: string }}
 */
function exportAssetToDrive(episodeUid, slotId, assetId, b64, canvasJson, day, canvasText, caption) {
  try {
    var stagingId = getStagingFolderIdByUid(episodeUid);
    if (!stagingId) return { success: false, error: 'Staging folder not found for: ' + episodeUid };
    var stagingFolder  = DriveApp.getFolderById(stagingId);
    var exportFolderIt = stagingFolder.getFoldersByName('Manual_Exports');
    var exportFolder   = exportFolderIt.hasNext() ? exportFolderIt.next() : stagingFolder.createFolder('Manual_Exports');

    var timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyMMdd-HHmm');
    var dayPrefix = day ? (String(day).toUpperCase() + '_') : '';
    var baseName  = dayPrefix + (slotId || 'noslot') + '_' + (assetId || 'noasset') + '_' + timestamp;
    var filename  = baseName + '.png';
    var blob      = Utilities.newBlob(Utilities.base64Decode(b64), 'image/png', filename);
    var file      = exportFolder.createFile(blob);
    var fileId    = file.getId();

    // Write paired .txt companion (canvas text + caption)
    var txtParts = [];
    if (canvasText) txtParts.push(String(canvasText).trim());
    if (caption)    txtParts.push(String(caption).trim());
    if (txtParts.length) {
      var txtBlob = Utilities.newBlob(txtParts.join('\n\n'), 'text/plain', baseName + '.txt');
      exportFolder.createFile(txtBlob);
    }

    var ss = SpreadsheetApp.openById(getMasterSheetId());

    if (assetId && canvasJson) {
      var alName  = getGovernance('ASSET_LIBRARY_TAB_NAME') || 'Asset_Library';
      var alSheet = ss.getSheetByName(alName);
      if (alSheet) {
        var alData = alSheet.getDataRange().getValues();
        for (var i = 1; i < alData.length; i++) {
          if (String(alData[i][ASSET_LIBRARY_COLS.Asset_ID - 1]) !== String(assetId)) continue;
          alSheet.getRange(i + 1, ASSET_LIBRARY_COLS.Canvas_State).setValue(canvasJson);
          break;
        }
      }
      bumpVersion('asset_library', 'exportAssetToDrive');
    }

    try {
      var audit = ss.getSheetByName('Audit_Trail');
      if (audit) audit.appendRow([new Date(), 'DWYP_App', 'exportAssetToDrive', assetId + ' → ' + filename]);
    } catch(logErr) {}

    return {
      success:   true,
      filename:  filename,
      url:       'https://drive.google.com/file/d/' + fileId + '/view',
      folderUrl: 'https://drive.google.com/drive/folders/' + exportFolder.getId()
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Copies a reel's Drive file into Manual_Exports with a day prefix, then writes a
 * paired .txt companion (title card text + caption). Used by Design tab Reels export.
 */
function exportReelToDrive(episodeUid, day, reelAssetId, titleText, caption) {
  try {
    var stagingId = getStagingFolderIdByUid(episodeUid);
    if (!stagingId) return { success: false, error: 'Staging folder not found for: ' + episodeUid };
    var stagingFolder  = DriveApp.getFolderById(stagingId);
    var exportFolderIt = stagingFolder.getFoldersByName('Manual_Exports');
    var exportFolder   = exportFolderIt.hasNext() ? exportFolderIt.next() : stagingFolder.createFolder('Manual_Exports');

    // Resolve reel's Drive file ID from Asset_Library
    var ss     = SpreadsheetApp.openById(getMasterSheetId());
    var alName = getGovernance('ASSET_LIBRARY_TAB_NAME') || 'Asset_Library';
    var alSheet = ss.getSheetByName(alName);
    if (!alSheet) return { success: false, error: 'Asset_Library sheet not found' };

    var alData  = alSheet.getDataRange().getValues();
    var driveFileId = null;
    for (var i = 1; i < alData.length; i++) {
      if (String(alData[i][ASSET_LIBRARY_COLS.Asset_ID - 1]) === String(reelAssetId)) {
        driveFileId = String(alData[i][ASSET_LIBRARY_COLS.Drive_File_ID - 1] || '');
        break;
      }
    }
    if (!driveFileId) return { success: false, error: 'No Drive file ID found for reel: ' + reelAssetId };

    var timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyMMdd-HHmm');
    var dayPrefix = day ? (String(day).toUpperCase() + '_') : '';
    var reelFile  = DriveApp.getFileById(driveFileId);
    var ext       = reelFile.getName().split('.').pop() || 'mp4';
    var baseName  = dayPrefix + 'reel_' + reelAssetId + '_' + timestamp;

    // Move the reel file into Manual_Exports — evacuates Reels/ root, silencing Loop C
    reelFile.setName(baseName + '.' + ext);
    reelFile.moveTo(exportFolder);
    var movedFile = reelFile;

    // Write paired .txt companion
    var txtParts = [];
    if (titleText) txtParts.push(String(titleText).trim());
    if (caption)   txtParts.push(String(caption).trim());
    if (txtParts.length) {
      var txtBlob = Utilities.newBlob(txtParts.join('\n\n'), 'text/plain', baseName + '.txt');
      exportFolder.createFile(txtBlob);
    }

    try {
      var audit = ss.getSheetByName('Audit_Trail');
      if (audit) audit.appendRow([new Date(), 'DWYP_App', 'exportReelToDrive', reelAssetId + ' → ' + baseName]);
    } catch(logErr) {}

    return {
      success:   true,
      filename:  baseName,
      url:       'https://drive.google.com/file/d/' + movedFile.getId() + '/view',
      folderUrl: 'https://drive.google.com/drive/folders/' + exportFolder.getId()
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

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
    "Return quotes as: [[QUOTE: \"the quote text\" — Full Guest Name]]\n\n" +
    "HOOK — Synthesized from the main themes in the source material. Talk about the concept or insight, not what happened — never describe a person or event. No names, pronouns, or generic stand-ins like \"individual\" or \"person.\" Simple but significant, at home in a social media feed. Maximum 25 words.\n\n" +
    "QUOTE — Verbatim from the source material. You may remove filler words and repeated words, and use ellipsis to bridge sentences as long as context is preserved. Always include attribution with em-dash and full guest name. Wrapped in quotation marks. Maximum 20 words.",

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
 * Loads transcript for Studio companion context (stRagContext).
 * Uses gatherVertContext — same three-tier lookup as Track A/B (Episode/ → Staging root → Raw Production).
 * Falls back to Episode Index v2 if transcript not found.
 * @param {string} episodeUid
 * @returns {string}
 */
function stLoadEpisodeIndex(episodeUid) {
  if (!episodeUid) return '';
  try {
    var vertCtx = gatherVertContext(episodeUid, "Studio");
    if (vertCtx && vertCtx.transcriptText) return vertCtx.transcriptText;
  } catch (e) {
    logToAuditTrail("Studio", "state_change", episodeUid, "", "stLoadEpisodeIndex transcript: " + e.message, "warning");
  }
  try {
    var stagingFolderId = getStagingFolderIdByUid(episodeUid);
    if (!stagingFolderId) return '';
    var manifest = getManifest(stagingFolderId);
    if (manifest && manifest.episode_index_v2) {
      return DriveApp.getFileById(manifest.episode_index_v2).getBlob().getDataAsString();
    }
  } catch (e) {
    logToAuditTrail("Studio", "state_change", episodeUid, "", "stLoadEpisodeIndex fallback: " + e.message, "warning");
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
        var captionHost = String(row[ASSET_LIBRARY_COLS.Caption_Host - 1] || '').trim();
        var entry = { assetId: assetId, text: text, captionHost: captionHost || null };
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
      displayName = String(data[i][ASSET_LIBRARY_COLS.Quote_Text - 1] || data[i][ASSET_LIBRARY_COLS.Display_Name - 1] || '').trim();
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
      displayName = String(data[i][ASSET_LIBRARY_COLS.Quote_Text - 1] || data[i][ASSET_LIBRARY_COLS.Display_Name - 1] || '').trim();
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

      var displayName = String(row[ASSET_LIBRARY_COLS.Quote_Text - 1] || row[ASSET_LIBRARY_COLS.Display_Name - 1] || 'Reel clip').trim();
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
 * Normalizes curly quotes to ASCII in Quote_Text before any write to Asset_Library.
 * Replaces U+2018/U+2019 (single curly) and U+201C/U+201D (double curly) with ASCII equivalents.
 * Em-dash (U+2014) and en-dash (U+2013) are intentionally left unchanged.
 */
function normalizeQuoteText(str) {
  if (!str) return str;
  return str
    .replace(/‘/g, "'")
    .replace(/’/g, "'")
    .replace(/“/g, '"')
    .replace(/”/g, '"');
}

// ── APPROVED/ FOLDER HELPERS (Spoke A) ───────────────────────────────────────

/**
 * Returns the Approved/ subfolder at the episode production folder root,
 * creating it if it does not exist.
 * Distinct from Images/Approved/ and Reels/Approved/, which belong to the
 * pre-pipeline staging review flow.
 * @param {string} episodeUid
 * @returns {GoogleAppsScript.Drive.Folder}
 */
function getOrCreateApprovedFolder(episodeUid) {
  var stagingId = getStagingFolderIdByUid(episodeUid);
  if (!stagingId) throw new Error('Production folder not found for episode: ' + episodeUid);
  var root = DriveApp.getFolderById(stagingId);
  var it   = root.getFoldersByName('Approved');
  return it.hasNext() ? it.next() : root.createFolder('Approved');
}

/**
 * Returns the slot-stable filename for an Approved/ asset.
 * Format: {slotId}_{MMM-DD-YY}.{ext}
 * Examples: SLOT-MON-01_MAY-18-26.png  |  CUSTOM-MON-1748291234567_MAY-18-26.mp4
 * JT_TIMEZONE from Governance_Config; falls back to script timezone if unset.
 * @param {string} slotId
 * @param {Date}   scheduledAt
 * @param {string} extension  - 'png' | 'mp4' | 'txt'
 * @returns {string}
 */
function buildApprovedFilename(slotId, scheduledAt, extension) {
  var tz = getGovernance('JT_TIMEZONE') || Session.getScriptTimeZone();
  var dt = scheduledAt instanceof Date ? scheduledAt : new Date(scheduledAt);
  var ds = Utilities.formatDate(dt, tz, 'MMM-dd-yy').toUpperCase();
  return slotId + '_' + ds + '.' + extension;
}

/**
 * Writes an asset blob + caption sidecar (.txt) to Approved/ with slot-stable names.
 * Overwrites any existing file with the same name (find-trash-create — Drive does
 * not replace by name automatically).
 * Logs APPROVED_WRITE to Audit_Trail.
 * @param {string} episodeUid
 * @param {string} slotId
 * @param {Date}   scheduledAt
 * @param {GoogleAppsScript.Base.Blob} assetBlob
 * @param {string} captionText
 * @param {string} extension  - 'png' | 'mp4'
 * @returns {{ assetUrl: string, txtUrl: string, filename: string }}
 */
function writeApprovedAsset(episodeUid, slotId, scheduledAt, assetBlob, captionText, extension) {
  var folder      = getOrCreateApprovedFolder(episodeUid);
  var filename    = buildApprovedFilename(slotId, scheduledAt, extension);
  var txtFilename = buildApprovedFilename(slotId, scheduledAt, 'txt');

  var existing = folder.getFilesByName(filename);
  while (existing.hasNext()) existing.next().setTrashed(true);
  var existingTxt = folder.getFilesByName(txtFilename);
  while (existingTxt.hasNext()) existingTxt.next().setTrashed(true);

  var assetFile = folder.createFile(assetBlob.setName(filename));
  var txtFile   = folder.createFile(Utilities.newBlob(captionText || '', 'text/plain', txtFilename));

  try {
    var ss    = SpreadsheetApp.openById(getMasterSheetId());
    var audit = ss.getSheetByName('Audit_Trail');
    if (audit) audit.appendRow([new Date(), 'DWYP_App', 'APPROVED_WRITE', episodeUid + ' · ' + filename]);
  } catch (logErr) {}

  return {
    assetUrl: 'https://drive.google.com/file/d/' + assetFile.getId() + '/view',
    txtUrl:   'https://drive.google.com/file/d/' + txtFile.getId()   + '/view',
    filename: filename
  };
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
          if (quoteText)  alSheet.getRange(i + 1, ASSET_LIBRARY_COLS.Quote_Text   ).setValue(normalizeQuoteText(quoteText));
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
        if (quoteText)  alRow[ASSET_LIBRARY_COLS.Quote_Text   - 1] = normalizeQuoteText(quoteText);
        if (canvasJson) alRow[ASSET_LIBRARY_COLS.Canvas_State - 1] = canvasJson;
        alRow[ASSET_LIBRARY_COLS.Created_At   - 1] = new Date();
        alRow[ASSET_LIBRARY_COLS.Created_By   - 1] = "publish_canvas";
        alSheet2.appendRow(alRow);
      }
    }

    // Snapshot Caption_Host from AL row at schedule time — authoritative source for Approved/ sidecar
    var captionForApproved = caption || '';
    if (assetId && alData) {
      for (var ci = 1; ci < alData.length; ci++) {
        if (String(alData[ci][ASSET_LIBRARY_COLS.Asset_ID - 1]) !== String(assetId)) continue;
        captionForApproved = String(alData[ci][ASSET_LIBRARY_COLS.Caption_Host - 1] || '') || caption || '';
        break;
      }
    }

    // Create Social_Assets row
    var scheduledAt = new Date();
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
    saRow[SOCIAL_ASSETS_COLS.Scheduled_At     - 1] = scheduledAt;
    saRow[SOCIAL_ASSETS_COLS.Created_At       - 1] = new Date();
    saRow[SOCIAL_ASSETS_COLS.Created_By       - 1] = "publish_canvas";
    saSheet.appendRow(saRow);
    bumpVersion("asset_library", "addToWeekAsImage");

    // Fan-out: write PNG + caption sidecar to Approved/ — non-fatal; slot fill is authoritative
    try {
      writeApprovedAsset(episodeUid, slotId, scheduledAt, blob, captionForApproved, 'png');
    } catch (approvedErr) {
      try {
        var auditLog = ss.getSheetByName('Audit_Trail');
        if (auditLog) auditLog.appendRow([new Date(), 'DWYP_App', 'APPROVED_WRITE_FAILED',
          'episodeUid=' + episodeUid + ' | slotId=' + slotId + ' | assetId=' + (resolvedAlId || 'drive-fallback') + ' | err=' + approvedErr.message]);
      } catch (e2) {}
    }

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
    if (quoteText)  alSheet.getRange(alRowNum, ASSET_LIBRARY_COLS.Quote_Text  ).setValue(normalizeQuoteText(quoteText));
    if (canvasJson) alSheet.getRange(alRowNum, ASSET_LIBRARY_COLS.Canvas_State).setValue(canvasJson);

    // Update Social_Assets row (caption always; Drive_File_ID only when image changed)
    var saSheet     = ss.getSheetByName("Social_Assets");
    var slotId      = '';
    var scheduledAt = new Date();
    if (saSheet && postId) {
      var saData = saSheet.getDataRange().getValues();
      for (var j = 1; j < saData.length; j++) {
        if (String(saData[j][SOCIAL_ASSETS_COLS.Post_ID - 1]) !== String(postId)) continue;
        slotId = String(saData[j][SOCIAL_ASSETS_COLS.Slot - 1] || '');
        if (fileId) saSheet.getRange(j + 1, SOCIAL_ASSETS_COLS.Drive_File_ID).setValue(fileId);
        saSheet.getRange(j + 1, SOCIAL_ASSETS_COLS.Caption      ).setValue(caption || "");
        saSheet.getRange(j + 1, SOCIAL_ASSETS_COLS.Scheduled_At ).setValue(scheduledAt);
        break;
      }
    }

    bumpVersion("asset_library", "rescheduleAsset");

    // Fan-out: write PNG + caption sidecar to Approved/ — non-fatal; slot fill is authoritative
    if (imageDataB64 && slotId) {
      try {
        var captionForApproved = caption || '';
        for (var ri = 1; ri < alData.length; ri++) {
          if (String(alData[ri][ASSET_LIBRARY_COLS.Asset_ID - 1]) !== String(assetId)) continue;
          captionForApproved = String(alData[ri][ASSET_LIBRARY_COLS.Caption_Host - 1] || '') || caption || '';
          break;
        }
        writeApprovedAsset(episodeUid, slotId, scheduledAt, blob, captionForApproved, 'png');
      } catch (approvedErr) {
        try {
          var auditRe = ss.getSheetByName('Audit_Trail');
          if (auditRe) auditRe.appendRow([new Date(), 'DWYP_App', 'APPROVED_WRITE_FAILED',
            'episodeUid=' + episodeUid + ' | slotId=' + slotId + ' | assetId=' + assetId + ' | err=' + approvedErr.message]);
        } catch (e2) {}
      }
    }

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


// ── REEL ASSET SYNC ───────────────────────────────────────────────────────────

/**
 * Uploads a Drive video to the Gemini Files API and returns a verbose
 * description using the configured Gemini model. Returns null on any failure.
 * Flow: resumable upload → poll until ACTIVE → generateContent → DELETE temp file.
 * Size limit: 45 MB (Files API practical limit for GAS payload).
 * @private
 */
function callGeminiVideoAnalysis_(driveFileId, prompt, apiKey) {
  try {
    var file     = DriveApp.getFileById(driveFileId);
    var fileSize = file.getSize();
    var mimeType = file.getMimeType() || 'video/mp4';
    var fileName = file.getName();
    if (fileSize > 45 * 1024 * 1024) {
      Logger.log('[callGeminiVideoAnalysis_] Skipping — too large (' + Math.round(fileSize / 1048576) + 'MB): ' + fileName);
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
      Logger.log('[callGeminiVideoAnalysis_] Init failed ' + initResp.getResponseCode() + ': ' + initResp.getContentText().slice(0, 200));
      return null;
    }
    var hdrs      = initResp.getHeaders();
    var uploadUrl = hdrs['location'] || hdrs['Location'] || hdrs['x-goog-upload-url'];
    if (!uploadUrl) { Logger.log('[callGeminiVideoAnalysis_] No upload URL in response headers'); return null; }

    // Upload bytes
    var uploadResp = UrlFetchApp.fetch(uploadUrl, {
      method: 'POST', contentType: mimeType,
      headers: { 'X-Goog-Upload-Command': 'upload, finalize', 'X-Goog-Upload-Offset': '0' },
      payload: file.getBlob(),
      muteHttpExceptions: true
    });
    if (uploadResp.getResponseCode() !== 200) {
      Logger.log('[callGeminiVideoAnalysis_] Upload failed ' + uploadResp.getResponseCode());
      return null;
    }

    var gemFile = JSON.parse(uploadResp.getContentText()).file;
    if (!gemFile || !gemFile.uri) { Logger.log('[callGeminiVideoAnalysis_] No file URI in upload response'); return null; }

    // Poll until ACTIVE (max ~60s at 5s intervals)
    var state = gemFile.state || 'PROCESSING';
    var polls = 0;
    while (state !== 'ACTIVE' && polls < 12) {
      Utilities.sleep(5000);
      var pollResp = UrlFetchApp.fetch(
        'https://generativelanguage.googleapis.com/v1beta/' + gemFile.name + '?key=' + apiKey,
        { muteHttpExceptions: true }
      );
      state = (JSON.parse(pollResp.getContentText()).state) || 'PROCESSING';
      polls++;
    }
    if (state !== 'ACTIVE') { Logger.log('[callGeminiVideoAnalysis_] File never became ACTIVE after ' + polls + ' polls'); return null; }

    // Generate content
    var model     = getGovernance('MODEL_NAME') || 'gemini-2.5-flash';
    var genResp   = UrlFetchApp.fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + apiKey,
      {
        method: 'POST', contentType: 'application/json',
        payload: JSON.stringify({ contents: [{ parts: [
          { file_data: { mime_type: mimeType, file_uri: gemFile.uri } },
          { text: prompt }
        ]}]}),
        muteHttpExceptions: true
      }
    );
    var genResult = JSON.parse(genResp.getContentText());
    var text = genResult.candidates && genResult.candidates[0] &&
               genResult.candidates[0].content && genResult.candidates[0].content.parts &&
               genResult.candidates[0].content.parts[0] && genResult.candidates[0].content.parts[0].text;

    // Delete temp file from Gemini — non-fatal
    try {
      UrlFetchApp.fetch(
        'https://generativelanguage.googleapis.com/v1beta/' + gemFile.name + '?key=' + apiKey,
        { method: 'DELETE', muteHttpExceptions: true }
      );
    } catch (e) {}

    return text || null;
  } catch (err) {
    Logger.log('[callGeminiVideoAnalysis_] Error: ' + err.message);
    return null;
  }
}


/**
 * Scans Staging/Reels/ (and Approved/ subfolder) for MP4 files, creates
 * Asset_Library rows for any not yet registered, then runs Gemini video
 * analysis to populate Reel_Summary on rows that lack one.
 *
 * Idempotent: skips files already in AL; skips rows with Reel_Summary unless
 * force:true. Has a 4.5-minute timeout guard — re-run if timedOut:true.
 *
 * After this runs: call runReelEditorialPass(epUid) to have Claude clean the
 * summaries and assign Slot_Tags + Quality_Score.
 *
 * @param {string} epUid
 * @param {Object} [opts]
 * @param {boolean} [opts.force=false] — reprocess rows that already have Reel_Summary
 * @returns {{ status, created, summarized, skipped, timedOut, errors }}
 */
function syncReelAssets(epUid, opts) {
  var force     = !!(opts && opts.force === true);
  var agentName = 'SyncReelAssets';
  var errors    = [];
  var MAX_MS    = 4.5 * 60 * 1000;
  var startTime = Date.now();

  // ── 1. Staging folder + guest name ──────────────────────────────────────
  var stagingId = getStagingFolderIdByUid(epUid);
  if (!stagingId) return { status: 'error', errors: ['Staging folder not found for: ' + epUid] };

  var manifest  = getManifest(stagingId);
  var guestName = (manifest && manifest.guest_name) || '';

  // ── 2. Read existing reel rows, indexed by Drive_File_ID ─────────────────
  var sheetId = getMasterSheetId();
  var ss      = SpreadsheetApp.openById(sheetId);
  var alName  = getGovernance('ASSET_LIBRARY_TAB_NAME') || 'Asset_Library';
  var alSheet = ss.getSheetByName(alName);
  if (!alSheet) return { status: 'error', errors: ['Asset_Library tab not found'] };

  var alData       = alSheet.getDataRange().getValues();
  var numCols      = alSheet.getLastColumn();
  var existingRows = {};

  for (var i = 1; i < alData.length; i++) {
    var row = alData[i];
    if (String(row[ASSET_LIBRARY_COLS.Episode_UID - 1]) !== String(epUid)) continue;
    var normType = String(row[ASSET_LIBRARY_COLS.Asset_Type - 1]).toLowerCase().replace(/[_ ]/g, '');
    if (normType !== 'reel' && normType !== 'bankclip') continue;
    var fid = String(row[ASSET_LIBRARY_COLS.Drive_File_ID - 1] || '');
    if (fid) existingRows[fid] = {
      rowNum:     i + 1,
      assetId:    String(row[ASSET_LIBRARY_COLS.Asset_ID     - 1]),
      hasSummary: !!String(row[ASSET_LIBRARY_COLS.Reel_Summary - 1]).trim()
    };
  }

  // ── 3. Collect MP4s from Staging/Reels/ (Approved/ first, then root) ─────
  var reelsFolderIt = DriveApp.getFolderById(stagingId).getFoldersByName('Reels');
  if (!reelsFolderIt.hasNext()) {
    logToAuditTrail(agentName, 'state_change', epUid, null, 'SYNC_REEL_ASSETS: No Reels/ folder found', 'INFO');
    return { status: 'done', created: 0, summarized: 0, skipped: 0, timedOut: false, errors: [] };
  }
  var reelsFolder  = reelsFolderIt.next();
  var scanFolders  = [];
  var apprvIt      = reelsFolder.getFoldersByName('Approved');
  if (apprvIt.hasNext()) scanFolders.push(apprvIt.next());
  scanFolders.push(reelsFolder);

  var seen = {};
  var mp4s = [];
  for (var sf = 0; sf < scanFolders.length; sf++) {
    var it = scanFolders[sf].getFiles();
    while (it.hasNext()) {
      var f = it.next();
      if (f.getMimeType() !== 'video/mp4') continue;
      if (seen[f.getId()]) continue;
      seen[f.getId()] = true;
      mp4s.push(f);
    }
  }

  if (!mp4s.length) {
    logToAuditTrail(agentName, 'state_change', epUid, null, 'SYNC_REEL_ASSETS: No MP4 files found in Reels/', 'INFO');
    return { status: 'done', created: 0, summarized: 0, skipped: 0, timedOut: false, errors: [] };
  }

  // ── 4. Create AL rows for unregistered files ─────────────────────────────
  var now     = new Date();
  var created = 0;

  for (var m = 0; m < mp4s.length; m++) {
    var mp4file    = mp4s[m];
    var mp4FileId  = mp4file.getId();
    if (existingRows[mp4FileId]) continue;

    var displayName = mp4file.getName().replace(/\.mp4$/i, '').replace(/[_-]/g, ' ').trim().slice(0, 80);
    var assetId     = Utilities.getUuid();
    var newRow      = new Array(numCols).fill('');
    newRow[ASSET_LIBRARY_COLS.Asset_ID      - 1] = assetId;
    newRow[ASSET_LIBRARY_COLS.Episode_UID   - 1] = epUid;
    newRow[ASSET_LIBRARY_COLS.Asset_Type    - 1] = 'Reel';
    newRow[ASSET_LIBRARY_COLS.Drive_File_ID - 1] = mp4FileId;
    newRow[ASSET_LIBRARY_COLS.Display_Name  - 1] = displayName;
    newRow[ASSET_LIBRARY_COLS.Status        - 1] = 'candidate';
    newRow[ASSET_LIBRARY_COLS.Availability  - 1] = 'available';
    newRow[ASSET_LIBRARY_COLS.Created_At    - 1] = now;
    newRow[ASSET_LIBRARY_COLS.Created_By    - 1] = 'system';

    alSheet.getRange(alSheet.getLastRow() + 1, 1, 1, numCols).setValues([newRow]);
    existingRows[mp4FileId] = { rowNum: alSheet.getLastRow(), assetId: assetId, hasSummary: false };
    created++;
  }

  if (created > 0) bumpVersion('asset_library', 'syncReelAssets');

  // ── 5. Gemini summary for rows with empty Reel_Summary ───────────────────
  var apiKey = getGovernance('GEMINI_API_KEY');
  var videoPrompt =
    "Watch this video clip carefully. This is a reel clip from the podcast 'Don't Waste Your Pain'" +
    (guestName ? ', featuring ' + guestName : '') + '.\n\n' +
    'Describe in full detail:\n' +
    '1. What is being said — key phrases and direct quotes verbatim\n' +
    '2. The emotional tone and energy of the speaker\n' +
    '3. The main point or takeaway\n' +
    '4. Any compelling story beats or turning points\n\n' +
    'Be verbose and thorough — this summary will be used by Claude to write social media captions.';

  var summarized = 0;
  var skipped    = 0;
  var timedOut   = false;

  for (var n = 0; n < mp4s.length; n++) {
    if (Date.now() - startTime > MAX_MS) { timedOut = true; break; }

    var entry = existingRows[mp4s[n].getId()];
    if (!entry) { skipped++; continue; }
    if (entry.hasSummary && !force) { skipped++; continue; }

    var summary = callGeminiVideoAnalysis_(mp4s[n].getId(), videoPrompt, apiKey);
    if (!summary) {
      errors.push('Gemini returned null for file ' + mp4s[n].getId() + ' (' + mp4s[n].getName() + ')');
      skipped++;
      continue;
    }

    alSheet.getRange(entry.rowNum, ASSET_LIBRARY_COLS.Reel_Summary).setValue(summary);
    summarized++;
    Utilities.sleep(2000);
  }

  if (summarized > 0) bumpVersion('asset_library', 'syncReelAssets');

  logToAuditTrail(agentName, 'state_change', epUid, null,
    'SYNC_REEL_ASSETS COMPLETE: created=' + created + ' summarized=' + summarized +
    ' skipped=' + skipped + (timedOut ? ' TIMED_OUT=true — re-run to continue' : '') +
    (errors.length ? ' errors=' + JSON.stringify(errors) : ''), 'INFO');

  return {
    status:     timedOut ? 'timed_out' : 'done',
    created:    created,
    summarized: summarized,
    skipped:    skipped,
    timedOut:   timedOut,
    errors:     errors
  };
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
        Quote_Text:    String(row[ASSET_LIBRARY_COLS.Quote_Text    - 1] || ''),
        Reel_Summary:  String(row[ASSET_LIBRARY_COLS.Reel_Summary  - 1] || ''),
        Caption_Host:  String(row[ASSET_LIBRARY_COLS.Caption_Host  - 1] || ''),
        Caption_Guest: String(row[ASSET_LIBRARY_COLS.Caption_Guest - 1] || ''),
        Status:        String(row[ASSET_LIBRARY_COLS.Status        - 1]),
        Availability:  String(row[ASSET_LIBRARY_COLS.Availability  - 1]),
        createdAt:     String(row[ASSET_LIBRARY_COLS.Created_At    - 1] || ''),
        thumbnailUrl:  fileId ? 'https://drive.google.com/thumbnail?id=' + fileId + '&sz=w160' : ''
      });
    }
    // Deduplicate by Drive_File_ID — keep row with Caption_Host, then newest Created_At
    var bestByKey = {};
    var keyOrder  = [];
    reels.forEach(function(r) {
      var key = r.Drive_File_ID || r.Asset_ID;
      if (!bestByKey[key]) { bestByKey[key] = r; keyOrder.push(key); return; }
      var prev      = bestByKey[key];
      var prevScore = (prev.Caption_Host ? 2 : 0) + (prev.Reel_Summary ? 1 : 0);
      var currScore = (r.Caption_Host    ? 2 : 0) + (r.Reel_Summary    ? 1 : 0);
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
 * Returns the top-6 ranked Asset_Library candidates for a given episode + asset type.
 * Server-side ranking — frontend never sees the full pool.
 * For Reels, delegates to getReelsForEpisode() and maps to candidate shape.
 * Sorts by Quality_Score DESC, Created_At ASC (stable secondary). Empty Quality_Score = 0.
 *
 * future midnight pass populates Quality_Score / Slot_Tags; ranking gains tag-match
 * tiebreaker against slot Why when those fields are populated.
 */
function getRankedAssetLibraryCandidates(episodeUid, assetType) {
  try {
    var normType = String(assetType || '').toLowerCase().replace(/[_ ]/g, '');
    var isReel   = (normType === 'reel' || normType === 'bankclip');

    if (isReel) {
      var reels  = getReelsForEpisode(episodeUid);
      var sorted = reels.slice().sort(function(a, b) {
        var qa = Number(a.Quality_Score) || 0;
        var qb = Number(b.Quality_Score) || 0;
        if (qb !== qa) return qb - qa;
        return String(a.createdAt).localeCompare(String(b.createdAt));
      });
      return sorted.slice(0, 6).map(function(r) {
        return {
          asset_id:      r.Asset_ID,
          asset_type:    r.Asset_Type || 'Reel',
          quality_score: Number(r.Quality_Score) || 0,
          slot_tags:     r.Slot_Tags ? String(r.Slot_Tags).split(',').map(function(t) { return t.trim(); }) : [],
          thumb_url:     r.thumbnailUrl || '',
          preview_text:  r.Reel_Summary || r.Quote_Text || r.Display_Name || '',
          display_text:  null,
          title_card:    r.Quote_Text || r.Display_Name || '',
          caption_host:  String(r.Caption_Host  || ''),
          caption_guest: r.Caption_Guest || '',
          background_id: null,
          canvas_state:  null,
          drive_file_id: r.Drive_File_ID || '',
          quote_text:    ''
        };
      });
    }

    var sheetId = getMasterSheetId();
    var ss      = SpreadsheetApp.openById(sheetId);
    var alName  = getGovernance("ASSET_LIBRARY_TAB_NAME") || "Asset_Library";
    var sheet   = ss.getSheetByName(alName);
    if (!sheet) return [];
    var data = sheet.getDataRange().getValues();

    var candidates = [];
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (String(row[ASSET_LIBRARY_COLS.Episode_UID - 1]) !== String(episodeUid)) continue;
      var rowType  = String(row[ASSET_LIBRARY_COLS.Asset_Type - 1]).toLowerCase().replace(/[_ ]/g, '');
      if (rowType !== normType) continue;
      var status = String(row[ASSET_LIBRARY_COLS.Status - 1]).toLowerCase();
      if (status === 'rejected') continue;
      var avail = String(row[ASSET_LIBRARY_COLS.Availability - 1]).toLowerCase();
      if (avail !== 'available') continue;

      var qs      = Number(row[ASSET_LIBRARY_COLS.Quality_Score - 1]) || 0;
      var fileId  = String(row[ASSET_LIBRARY_COLS.Drive_File_ID - 1] || '');
      var rawTags = String(row[ASSET_LIBRARY_COLS.Slot_Tags    - 1] || '');
      if (fileId) {
        try { DriveApp.getFileById(fileId).setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}
      }
      var _displayText = String(row[ASSET_LIBRARY_COLS.Display_Text - 1] || '') || null;
      var _displayName = String(row[ASSET_LIBRARY_COLS.Display_Name - 1] || '');
      var _isQuote     = _displayName.toLowerCase().indexOf('quote') === 0;
      candidates.push({
        asset_id:      String(row[ASSET_LIBRARY_COLS.Asset_ID      - 1]),
        asset_type:    String(row[ASSET_LIBRARY_COLS.Asset_Type     - 1]),
        quality_score: qs,
        is_quote:      _isQuote,
        slot_tags:     rawTags ? rawTags.split(',').map(function(t) { return t.trim(); }) : [],
        thumb_url:     fileId ? 'https://drive.google.com/thumbnail?id=' + fileId + '&sz=w200' : '',
        preview_text:  _displayText || String(row[ASSET_LIBRARY_COLS.Quote_Text - 1] || row[ASSET_LIBRARY_COLS.Display_Name - 1] || ''),
        display_text:  _displayText,
        quote_text:    String(row[ASSET_LIBRARY_COLS.Quote_Text    - 1] || ''),
        caption_host:  String(row[ASSET_LIBRARY_COLS.Caption_Host  - 1] || ''),
        caption_guest: String(row[ASSET_LIBRARY_COLS.Caption_Guest - 1] || ''),
        background_id: String(row[ASSET_LIBRARY_COLS.Background_ID - 1] || '') || null,
        canvas_state:  String(row[ASSET_LIBRARY_COLS.Canvas_State  - 1] || '') || null,
        drive_file_id: fileId,
        created_at:    String(row[ASSET_LIBRARY_COLS.Created_At    - 1] || '')
      });
    }

    var quoteBonus = parseFloat(getGovernance("STUDIO_QUOTE_RANK_BONUS")) || 0;
    candidates.sort(function(a, b) {
      var aScore = a.quality_score + (a.is_quote ? quoteBonus : 0);
      var bScore = b.quality_score + (b.is_quote ? quoteBonus : 0);
      if (bScore !== aScore) return bScore - aScore;
      return String(a.created_at).localeCompare(String(b.created_at));
    });
    return candidates;
  } catch (e) {
    return [];
  }
}

/**
 * Assembles the slot foreground context for the right-rail Claude companion.
 * Called on every right-rail Claude send. Returns the active card + same-date siblings + episode.
 * Sibling cap = 4 hardcoded; OQ-D is the deferred UX question — replace literal with
 * getGovernance("PUBLISH_SIBLING_CONTEXT_CAP") when that question resolves.
 */
function assembleSlotForegroundContext(activeAssetId, activeAssetType, episodeUid) {
  var SIBLING_CAP = 4;
  var result = {
    active_card:        null,
    same_date_siblings: [],
    episode:            { episode_uid: episodeUid, guest_name: '', release_date: '' }
  };
  try {
    var sheetId = getMasterSheetId();
    var ss      = SpreadsheetApp.openById(sheetId);
    var alName  = getGovernance("ASSET_LIBRARY_TAB_NAME") || "Asset_Library";
    var sheet   = ss.getSheetByName(alName);
    if (!sheet || !activeAssetId) return result;

    var data     = sheet.getDataRange().getValues();
    var siblings = [];

    for (var i = 1; i < data.length; i++) {
      var row       = data[i];
      var rowEpUid  = String(row[ASSET_LIBRARY_COLS.Episode_UID  - 1]);
      var rowId     = String(row[ASSET_LIBRARY_COLS.Asset_ID     - 1]);
      if (rowEpUid !== String(episodeUid)) continue;

      var cardObj = {
        asset_id:      rowId,
        asset_type:    String(row[ASSET_LIBRARY_COLS.Asset_Type    - 1]),
        quote_text:    String(row[ASSET_LIBRARY_COLS.Quote_Text    - 1] || ''),
        reel_summary:  String(row[ASSET_LIBRARY_COLS.Reel_Summary  - 1] || ''),
        caption_host:  String(row[ASSET_LIBRARY_COLS.Caption_Host  - 1] || ''),
        caption_guest: String(row[ASSET_LIBRARY_COLS.Caption_Guest - 1] || ''),
        background_id: String(row[ASSET_LIBRARY_COLS.Background_ID - 1] || '') || null,
        quality_score: Number(row[ASSET_LIBRARY_COLS.Quality_Score - 1]) || 0,
        slot_tags:     String(row[ASSET_LIBRARY_COLS.Slot_Tags     - 1] || '')
      };

      if (rowId === String(activeAssetId)) {
        result.active_card = cardObj;
      } else {
        var avail = String(row[ASSET_LIBRARY_COLS.Availability - 1]).toLowerCase();
        if (avail === 'available' || avail === 'placed') {
          siblings.push(cardObj);
        }
      }
    }

    siblings.sort(function(a, b) {
      if (b.quality_score !== a.quality_score) return b.quality_score - a.quality_score;
      return String(a.asset_id).localeCompare(String(b.asset_id));
    });
    result.same_date_siblings = siblings.slice(0, SIBLING_CAP);

    try {
      var epSheet = ss.getSheetByName("Episodes");
      if (epSheet) {
        var epData = epSheet.getDataRange().getValues();
        for (var j = 1; j < epData.length; j++) {
          if (String(epData[j][EPISODES_COLS.Episode_UID - 1]) === String(episodeUid)) {
            result.episode.guest_name   = String(epData[j][EPISODES_COLS.Guest_Name   - 1] || '');
            result.episode.release_date = String(epData[j][EPISODES_COLS.Release_Date - 1] || '');
            break;
          }
        }
      }
    } catch(e2) {}

    return result;
  } catch (e) {
    return result;
  }
}

/**
 * Writes Caption_Host to the Asset_Library row matching Asset_ID.
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
      sheet.getRange(i + 1, ASSET_LIBRARY_COLS.Caption_Host).setValue(captionFinal);
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
 * Generates a Caption_Host for a reel by passing its Reel_Summary through Claude.
 * Writes the result back to Asset_Library and returns { ok, caption }.
 */
function generateReelCaption(assetId) {
  try {
    var sheetId = getMasterSheetId();
    var ss      = SpreadsheetApp.openById(sheetId);
    var alName  = getGovernance('ASSET_LIBRARY_TAB_NAME') || 'Asset_Library';
    var sheet   = ss.getSheetByName(alName);
    if (!sheet) return { ok: false, error: 'Asset_Library not found' };

    var data    = sheet.getDataRange().getValues();
    var rowNum  = -1, summary = '', episodeUid = '';
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][ASSET_LIBRARY_COLS.Asset_ID - 1]) !== String(assetId)) continue;
      summary    = String(data[i][ASSET_LIBRARY_COLS.Reel_Summary - 1] || '').trim();
      episodeUid = String(data[i][ASSET_LIBRARY_COLS.Episode_UID  - 1] || '');
      rowNum     = i + 1;
      break;
    }
    if (rowNum === -1) return { ok: false, error: 'Reel not found: ' + assetId };
    if (!summary)     return { ok: false, error: 'No Reel_Summary — run Sync Reels first' };

    var captionMechanics  = extractPrompt('# Caption Mechanics')   || '';
    var voiceProhibitions = extractPrompt('# Voice Prohibitions')  || '';

    var systemPrompt = [
      captionMechanics  ? ('CAPTION MECHANICS:\n' + captionMechanics)  : '',
      voiceProhibitions ? ('VOICE PROHIBITIONS:\n' + voiceProhibitions) : ''
    ].filter(Boolean).join('\n\n');

    var userPrompt =
      'Write one social media caption for this podcast reel clip.\n\n' +
      'REEL SUMMARY:\n' + summary + '\n\n' +
      'Rules: write from the host perspective. One caption only. No hashtags. No em-dashes. No ellipses. ' +
      'Return only the caption text — no preamble, no label.';

    var caption = callClaudeAPI(userPrompt, systemPrompt || null, 'generateReelCaption');
    if (!caption) return { ok: false, error: 'Claude returned empty response' };
    caption = caption.trim();

    sheet.getRange(rowNum, ASSET_LIBRARY_COLS.Caption_Host).setValue(caption);
    bumpVersion('asset_library', 'generateReelCaption');
    logToAuditTrail('generateReelCaption', 'state_change', episodeUid, '',
      '[INFO] Generated Caption_Host for asset ' + assetId, 'INFO');

    return { ok: true, caption: caption };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Spawns a revision task linked to a reel by Asset_ID.
 * type: 'edit_vids' → action title for Vids edit request
 *       'request_revision' → action title for revision request (not called directly; use requestReelRevision)
 */
function spawnReelEditTask(episodeUid, assetId, type) {
  try {
    var sheetId = getMasterSheetId();
    var ss      = SpreadsheetApp.openById(sheetId);
    var alName  = getGovernance('ASSET_LIBRARY_TAB_NAME') || 'Asset_Library';
    var sheet   = ss.getSheetByName(alName);
    var displayName = assetId;
    if (sheet) {
      var data = sheet.getDataRange().getValues();
      for (var i = 1; i < data.length; i++) {
        if (String(data[i][ASSET_LIBRARY_COLS.Asset_ID - 1]) !== String(assetId)) continue;
        displayName = String(data[i][ASSET_LIBRARY_COLS.Display_Name - 1] || assetId);
        break;
      }
    }

    var actionTitle = type === 'edit_vids'
      ? ('Edit reel in Vids: ' + displayName)
      : ('Revise reel: ' + displayName);

    spawnTask({
      actionTitle:      actionTitle,
      assignee:         getGovernance('ASSIGNEE_PRODUCER'),
      assignedBy:       'The Fairy Team',
      status:           'open',
      priority:         'normal',
      episodeUid:       episodeUid,
      workflowStep:     'Revise_Reels',
      executiveSummary: 'JT requested a reel edit. Asset_ID: ' + assetId,
      assetId:          assetId
    });

    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Phase 6 — Step 1: JT taps Request Revision.
 * Completes the open Review_Reels task for this episode (JT's review pass is done),
 * then spawns a Revise_Reels task for Audra carrying the Asset_ID FK.
 */
function requestReelRevision(episodeUid, assetId) {
  try {
    var sheetId = getMasterSheetId();
    var ss      = SpreadsheetApp.openById(sheetId);

    // Complete the open Review_Reels task for this episode
    var taskSheet = ss.getSheetByName('Tasks');
    if (taskSheet) {
      var tData    = taskSheet.getDataRange().getValues();
      var tHeaders = tData[0];
      var tIdCol   = tHeaders.indexOf('Task_ID');
      var tEpCol   = tHeaders.indexOf('Episode_UID');
      var tWfCol   = tHeaders.indexOf('Workflow_Step');
      var tStCol   = tHeaders.indexOf('Status');
      for (var t = 1; t < tData.length; t++) {
        if (String(tData[t][tEpCol]) !== String(episodeUid))        continue;
        if (String(tData[t][tWfCol]) !== 'Review_Reels')            continue;
        var ts = String(tData[t][tStCol]);
        if (ts !== 'open' && ts !== 'in_progress')                  continue;
        updateTaskStatus(String(tData[t][tIdCol]), 'complete', true);
        break;
      }
    }

    // Spawn Revise_Reels task for Audra
    var result = spawnReelEditTask(episodeUid, assetId, 'request_revision');
    if (!result.ok) return result;

    logToAuditTrail('requestReelRevision', 'human_action', episodeUid, '',
      '[INFO] JT requested revision for reel ' + assetId + '. Review_Reels completed; Revise_Reels spawned.', 'INFO');

    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Phase 6 — Step 3: Atomic close after Audra uploads revised reel.
 * Swaps new Drive_File_ID onto the AL row, moves old file to Reels/Superseded/,
 * completes the Revise_Reels task. New file should already be in Reels/ root —
 * Loop C will detect it on next Pulse and spawn a fresh Review_Reels for JT.
 */
function closeReelRevision(episodeUid, assetId, newDriveFileId) {
  try {
    var sheetId = getMasterSheetId();
    var ss      = SpreadsheetApp.openById(sheetId);
    var alName  = getGovernance('ASSET_LIBRARY_TAB_NAME') || 'Asset_Library';
    var alSheet = ss.getSheetByName(alName);
    if (!alSheet) return { ok: false, error: 'Asset_Library not found' };

    var alData = alSheet.getDataRange().getValues();
    var rowNum = -1, oldDriveFileId = '';
    for (var i = 1; i < alData.length; i++) {
      if (String(alData[i][ASSET_LIBRARY_COLS.Asset_ID - 1]) !== String(assetId)) continue;
      oldDriveFileId = String(alData[i][ASSET_LIBRARY_COLS.Drive_File_ID - 1] || '');
      rowNum = i + 1;
      break;
    }
    if (rowNum === -1) return { ok: false, error: 'AL row not found for asset: ' + assetId };

    // Move old file to Reels/Superseded/ to evacuate root and silence Loop C
    if (oldDriveFileId && oldDriveFileId !== newDriveFileId) {
      try {
        var stagingId     = getStagingFolderIdByUid(episodeUid);
        var stagingFolder = DriveApp.getFolderById(stagingId);
        var reelsFolderIt = stagingFolder.getFoldersByName('Reels');
        if (reelsFolderIt.hasNext()) {
          var reelsFolder    = reelsFolderIt.next();
          var supersededIt   = reelsFolder.getFoldersByName('Superseded');
          var supersededFolder = supersededIt.hasNext()
            ? supersededIt.next()
            : reelsFolder.createFolder('Superseded');
          DriveApp.getFileById(oldDriveFileId).moveTo(supersededFolder);
        }
      } catch (moveErr) {
        logToAuditTrail('closeReelRevision', 'error', episodeUid, '',
          '[WARNING] Could not move old reel to Superseded/: ' + moveErr.message, 'WARNING');
      }
    }

    // Swap Drive_File_ID on AL row
    alSheet.getRange(rowNum, ASSET_LIBRARY_COLS.Drive_File_ID).setValue(newDriveFileId);
    bumpVersion('asset_library', 'closeReelRevision');

    // Complete open Revise_Reels task for this episode/asset
    var taskSheet = ss.getSheetByName('Tasks');
    if (taskSheet) {
      var tData    = taskSheet.getDataRange().getValues();
      var tHeaders = tData[0];
      var tIdCol   = tHeaders.indexOf('Task_ID');
      var tEpCol   = tHeaders.indexOf('Episode_UID');
      var tWfCol   = tHeaders.indexOf('Workflow_Step');
      var tStCol   = tHeaders.indexOf('Status');
      var tAsCol   = tHeaders.indexOf('Asset_ID');
      for (var t = 1; t < tData.length; t++) {
        if (String(tData[t][tEpCol]) !== String(episodeUid))   continue;
        if (String(tData[t][tWfCol]) !== 'Revise_Reels')       continue;
        var ts = String(tData[t][tStCol]);
        if (ts !== 'open' && ts !== 'in_progress')             continue;
        // If Asset_ID column exists, match on it; otherwise close first Revise_Reels found
        if (tAsCol !== -1 && String(tData[t][tAsCol]) && String(tData[t][tAsCol]) !== String(assetId)) continue;
        updateTaskStatus(String(tData[t][tIdCol]), 'complete', true);
        bumpVersion('tasks', 'closeReelRevision');
        break;
      }
    }

    logToAuditTrail('closeReelRevision', 'state_change', episodeUid, '',
      '[INFO] Reel revision closed for asset ' + assetId +
      '. Old file ' + oldDriveFileId + ' → Superseded/. New file: ' + newDriveFileId, 'INFO');

    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
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
 * Schedules a reel into a slot (new) or reschedules it (existing SA row for same slot).
 * Reschedule path: updates SA row in place, resets old asset to candidate/available if
 * a different asset is being placed.
 * Fan-out: copies reel mp4 + caption sidecar to Approved/ after SA write (non-fatal).
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

    // Read AL once — used for new-asset update, old-asset reset, caption snapshot, and fan-out
    var alData             = alSheet ? alSheet.getDataRange().getValues() : [];
    var captionForApproved = caption || '';
    for (var i = 1; i < alData.length; i++) {
      if (String(alData[i][ASSET_LIBRARY_COLS.Asset_ID - 1]) !== String(assetId)) continue;
      alSheet.getRange(i + 1, ASSET_LIBRARY_COLS.Status      ).setValue("scheduled");
      alSheet.getRange(i + 1, ASSET_LIBRARY_COLS.Availability).setValue("placed");
      if (!driveFileId) driveFileId = String(alData[i][ASSET_LIBRARY_COLS.Drive_File_ID - 1]);
      captionForApproved = String(alData[i][ASSET_LIBRARY_COLS.Caption_Host - 1] || '') || caption || '';
      break;
    }

    // Check for existing SA row by (episodeUid, slotId) — reschedule vs. new schedule
    var saData       = saSheet.getDataRange().getValues();
    var existingSaRow = -1;
    var oldAlId       = '';
    for (var j = 1; j < saData.length; j++) {
      if (String(saData[j][SOCIAL_ASSETS_COLS.Episode_UID - 1]) !== String(episodeUid)) continue;
      if (String(saData[j][SOCIAL_ASSETS_COLS.Slot        - 1]) !== String(slotId))     continue;
      existingSaRow = j + 1;  // 1-based sheet row
      oldAlId       = String(saData[j][SOCIAL_ASSETS_COLS.Asset_Library_ID - 1]);
      break;
    }

    var postId;
    if (existingSaRow !== -1) {
      // Reschedule: update existing SA row in place
      postId = String(saData[existingSaRow - 1][SOCIAL_ASSETS_COLS.Post_ID - 1]);
      saSheet.getRange(existingSaRow, SOCIAL_ASSETS_COLS.Asset_Library_ID).setValue(assetId);
      saSheet.getRange(existingSaRow, SOCIAL_ASSETS_COLS.Caption          ).setValue(caption);
      saSheet.getRange(existingSaRow, SOCIAL_ASSETS_COLS.Drive_File_ID    ).setValue(driveFileId);
      saSheet.getRange(existingSaRow, SOCIAL_ASSETS_COLS.Scheduled_At     ).setValue(scheduledAt);
      saSheet.getRange(existingSaRow, SOCIAL_ASSETS_COLS.Scheduler_Status ).setValue("pending");
      // Reset displaced asset to candidate/available
      if (oldAlId && oldAlId !== assetId && alSheet) {
        for (var k = 1; k < alData.length; k++) {
          if (String(alData[k][ASSET_LIBRARY_COLS.Asset_ID - 1]) !== String(oldAlId)) continue;
          alSheet.getRange(k + 1, ASSET_LIBRARY_COLS.Status      ).setValue("candidate");
          alSheet.getRange(k + 1, ASSET_LIBRARY_COLS.Availability).setValue("available");
          break;
        }
      }
    } else {
      // New schedule: append SA row
      postId    = "PB-" + episodeUid + "-" + slotId + "-" + Date.now();
      var saRow = new Array(Object.keys(SOCIAL_ASSETS_COLS).length).fill("");
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
    }

    bumpVersion("asset_library", "scheduleReel");

    // Fan-out: copy reel mp4 + caption sidecar to Approved/ — non-fatal; slot fill is authoritative
    if (driveFileId && slotId) {
      try {
        var reelBlob = DriveApp.getFileById(driveFileId).getBlob();
        writeApprovedAsset(episodeUid, slotId, scheduledAt, reelBlob, captionForApproved, 'mp4');
      } catch (approvedErr) {
        try {
          var auditRl = ss.getSheetByName('Audit_Trail');
          if (auditRl) auditRl.appendRow([new Date(), 'DWYP_App', 'APPROVED_WRITE_FAILED',
            'episodeUid=' + episodeUid + ' | slotId=' + slotId + ' | assetId=' + assetId + ' | err=' + approvedErr.message]);
        } catch (e2) {}
      }
    }

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
