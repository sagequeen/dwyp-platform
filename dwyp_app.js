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

// Episode_Log tab column map (10 columns)
var EPISODE_LOG_COLS = {
  Log_ID:          1,
  Episode_UID:     2,
  Timestamp:       3,
  Author:          4,
  Entry_Type:      5,
  Asset_Type:      6,
  Body:            7,
  Resolved:        8,
  Visible_To:      9,
  Revision_Round:  10
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
  Reel_Transcript: 8,
  Reel_Summary:    9,
  Caption_Host:  10,  // working caption — sole source of truth for card render, schedule, Make pull
  Caption_Guest: 11,  // omni-voice caption for guest package (Guest Package builder populates; empty until then)
  Notes:         12,
  Background_ID: 13,
  Canvas_State:  14,
  Status:        15,  // candidate | schedule | bank | rejected
  Availability:  16,  // available | placed | paired
  Created_At:    17,
  Created_By:    18,
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
  Asset_ID:          17,  // FK to Asset_Library.Asset_ID for revision tasks
  Bucket:            18   // User bucket enum — added Spoke 3
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
  Final_Episode_ID:    12,
  Episode_URL:         13,
  Episode_Type:        14,
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

  // User Registry — header-driven read for per-user bucket and default-bucket data.
  // Buckets and Default_Bucket columns are Audra hand-edits; may not exist yet.
  var userRegistry = [];
  var urSheet = ss.getSheetByName("User_Registry");
  if (urSheet) {
    var urData    = urSheet.getDataRange().getValues();
    var urHeaders = urData[0] || [];
    var urCol     = {};
    urHeaders.forEach(function(h, i) { if (h) urCol[String(h).trim()] = i; });
    for (var ri = 1; ri < urData.length; ri++) {
      var urRow   = urData[ri];
      var urEmail = String(urRow[urCol['User_ID'] !== undefined ? urCol['User_ID'] : 0] || '').trim();
      if (!urEmail) continue;
      var bucketsRaw   = urCol['Buckets']        !== undefined ? String(urRow[urCol['Buckets']]        || '') : '';
      var defBucketRaw = urCol['Default_Bucket'] !== undefined ? String(urRow[urCol['Default_Bucket']] || '').trim() : '';
      userRegistry.push({
        email:         urEmail,
        displayName:   urCol['Display_Name'] !== undefined ? String(urRow[urCol['Display_Name']] || '').trim() : urEmail,
        role:          urCol['Role']          !== undefined ? String(urRow[urCol['Role']]          || '').trim() : '',
        buckets:       bucketsRaw.split(',').map(function(s){ return s.trim(); }).filter(Boolean),
        defaultBucket: defBucketRaw
      });
    }
  }

  var template = HtmlService.createTemplateFromFile("dwyp_ui");
  template.sheetId       = sheetId;
  template.deployedUrl   = deployedUrl;
  template.hostEmail     = hostEmail;
  template.hostName      = hostName;
  template.gemsUrl       = gemsUrl;
  template.notebooklmUrl = notebooklmUrl;
  template.ownerEmail    = ownerEmail;
  template.userRegistry  = JSON.stringify(userRegistry);

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
    if (status === "archived") continue;

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
      Final_Episode_ID:     row[EPISODES_COLS.Final_Episode_ID - 1],
      Episode_URL:          row[EPISODES_COLS.Episode_URL - 1],
      Episode_Type:         row[EPISODES_COLS.Episode_Type - 1]
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
      Asset_ID:          String(row[TASKS_COLS.Asset_ID - 1] || ""),
      Bucket:            row.length > 17 ? String(row[TASKS_COLS.Bucket - 1] || "") : ""
    });
  }

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

    // Build row in TASKS_COLS order (18 columns)
    var dueDate = payload.dueDate ? new Date(payload.dueDate) : "";

    var row = new Array(18).fill("");
    row[TASKS_COLS.Task_ID           - 1] = taskId;
    row[TASKS_COLS.Action_Title      - 1] = payload.actionTitle      || "";
    row[TASKS_COLS.Assignee          - 1] = payload.assignee         || "";
    row[TASKS_COLS.Assigned_By       - 1] = payload.createdBy        || "";
    row[TASKS_COLS.Status            - 1] = "open";
    row[TASKS_COLS.Priority          - 1] = payload.priority         || "normal";
    row[TASKS_COLS.Due_Date          - 1] = dueDate;
    row[TASKS_COLS.Episode_UID       - 1] = payload.episodeUid       || "";
    row[TASKS_COLS.Executive_Summary - 1] = payload.executiveSummary || "";
    row[TASKS_COLS.Workflow_Step     - 1] = payload.workflowStep     || "";
    row[TASKS_COLS.Created_At        - 1] = now;
    row[TASKS_COLS.Asset_ID          - 1] = payload.assetId          || "";
    row[TASKS_COLS.Bucket            - 1] = payload.bucket           || "";

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
 * Marks Video_Status = "approved" and spawns Upload_Final_Episode task for Audra.
 * Idempotent: skips spawn if an open Upload_Final_Episode task already exists.
 */
function approveEpisodeForRelease(episodeUid) {
  try {
    var result = writeVideoStatus(episodeUid, "approved");
    if (!result.success) return result;

    var sheetId   = getMasterSheetId();
    var ss        = SpreadsheetApp.openById(sheetId);
    var taskSheet = ss.getSheetByName("Tasks");
    var tData     = taskSheet.getDataRange().getValues();
    var tHeaders  = tData[0];
    var tEpCol    = tHeaders.indexOf("Episode_UID");
    var tWfCol    = tHeaders.indexOf("Workflow_Step");
    var tStCol    = tHeaders.indexOf("Status");

    for (var t = 1; t < tData.length; t++) {
      if (String(tData[t][tEpCol]) !== String(episodeUid))       continue;
      if (String(tData[t][tWfCol]) !== "Upload_Final_Episode")   continue;
      var ts = String(tData[t][tStCol]);
      if (ts === "open" || ts === "in_progress")                 return { success: true };
    }

    var epSheet   = ss.getSheetByName("Episodes");
    var epData    = epSheet.getDataRange().getValues();
    var guestName = episodeUid;
    for (var i = 1; i < epData.length; i++) {
      if (String(epData[i][EPISODES_COLS.Episode_UID - 1]) !== String(episodeUid)) continue;
      guestName = String(epData[i][EPISODES_COLS.Guest_Name - 1] || episodeUid);
      break;
    }

    spawnTask({
      episodeUid:   episodeUid,
      workflowStep: "Upload_Final_Episode",
      actionTitle:  "Upload final episode — " + guestName,
      assignee:     getGovernance("ASSIGNEE_PRODUCER"),
      assignedBy:   "The Fairy Team",
      status:       "open",
      priority:     "normal"
    });

    return { success: true };
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
function appendEpisodeLogEntry(episodeUid, entryType, assetType, body, visibleTo, authorEmail, revisionRound) {
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

    var row = new Array(10).fill("");
    row[EPISODE_LOG_COLS.Log_ID          - 1] = logId;
    row[EPISODE_LOG_COLS.Episode_UID     - 1] = episodeUid;
    row[EPISODE_LOG_COLS.Timestamp       - 1] = now;
    row[EPISODE_LOG_COLS.Author          - 1] = author;
    row[EPISODE_LOG_COLS.Entry_Type      - 1] = entryType;
    row[EPISODE_LOG_COLS.Asset_Type      - 1] = assetType;
    row[EPISODE_LOG_COLS.Body            - 1] = body;
    row[EPISODE_LOG_COLS.Resolved        - 1] = false;
    row[EPISODE_LOG_COLS.Visible_To      - 1] = visibleTo;
    row[EPISODE_LOG_COLS.Revision_Round  - 1] = (revisionRound != null ? Number(revisionRound) : "");

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
        Summary:      String(row[ASSET_LIBRARY_COLS.Reel_Summary - 1] || ''),
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
 * Derivative-edit save endpoint. Called when JT commits changes from the edit ↗ surface.
 * action='save'      — overwrites the same AL row (Quote_Text, Canvas_State, Caption_Host).
 * action='save_copy' — appends a new AL row, Status='schedule', Availability='available';
 *                      shares Drive_File_ID with the source (reel use-case: same clip, new caption).
 * Images:  canvasJson carries Canvas_State; quoteText extracted from non-attribution canvas text.
 * Reels:   canvasJson is null; quoteText = title card text.
 * No Social_Assets touch — AL-only.
 */
function saveDerivativeAsset(assetId, action, canvasJson, captionText, quoteText) {
  try {
    var sheetId = getMasterSheetId();
    var ss      = SpreadsheetApp.openById(sheetId);
    var alName  = getGovernance('ASSET_LIBRARY_TAB_NAME') || 'Asset_Library';
    var alSheet = ss.getSheetByName(alName);
    if (!alSheet) return { ok: false, error: 'Asset_Library tab not found' };

    var data   = alSheet.getDataRange().getValues();
    var rowNum = -1;
    var src    = null;
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][ASSET_LIBRARY_COLS.Asset_ID - 1]) === String(assetId)) {
        rowNum = i + 1;
        src    = data[i];
        break;
      }
    }
    if (rowNum === -1) return { ok: false, error: 'Asset not found: ' + assetId };

    var quoteNorm = normalizeQuoteText(quoteText || '');
    var caption   = captionText || '';
    var now       = new Date();

    if (action === 'save') {
      alSheet.getRange(rowNum, ASSET_LIBRARY_COLS.Quote_Text  ).setValue(quoteNorm);
      alSheet.getRange(rowNum, ASSET_LIBRARY_COLS.Caption_Host).setValue(caption);
      if (canvasJson) alSheet.getRange(rowNum, ASSET_LIBRARY_COLS.Canvas_State).setValue(canvasJson);
      bumpVersion('asset_library', 'saveDerivativeAsset');
      try {
        var audit = ss.getSheetByName('Audit_Trail');
        if (audit) audit.appendRow([now, 'DWYP_App', 'DERIVATIVE_SAVE', assetId]);
      } catch (e) {}
      return { ok: true, assetId: assetId };
    }

    if (action === 'save_copy') {
      var newId  = 'AL-' + now.getTime() + '-' + Math.floor(Math.random() * 9000 + 1000);
      var newRow = new Array(data[0].length).fill('');
      newRow[ASSET_LIBRARY_COLS.Asset_ID      - 1] = newId;
      newRow[ASSET_LIBRARY_COLS.Episode_UID   - 1] = String(src[ASSET_LIBRARY_COLS.Episode_UID   - 1] || '');
      newRow[ASSET_LIBRARY_COLS.Asset_Type    - 1] = String(src[ASSET_LIBRARY_COLS.Asset_Type    - 1] || '');
      newRow[ASSET_LIBRARY_COLS.Drive_File_ID - 1] = String(src[ASSET_LIBRARY_COLS.Drive_File_ID - 1] || '');
      newRow[ASSET_LIBRARY_COLS.Display_Name  - 1] = String(src[ASSET_LIBRARY_COLS.Display_Name  - 1] || '');
      newRow[ASSET_LIBRARY_COLS.Quote_Text    - 1] = quoteNorm;
      newRow[ASSET_LIBRARY_COLS.Canvas_State  - 1] = canvasJson || '';
      newRow[ASSET_LIBRARY_COLS.Caption_Host  - 1] = caption;
      newRow[ASSET_LIBRARY_COLS.Status        - 1] = 'schedule';
      newRow[ASSET_LIBRARY_COLS.Availability  - 1] = 'available';
      newRow[ASSET_LIBRARY_COLS.Created_At    - 1] = now;
      newRow[ASSET_LIBRARY_COLS.Created_By    - 1] = 'jt';
      alSheet.appendRow(newRow);
      bumpVersion('asset_library', 'saveDerivativeAsset');
      try {
        var audit2 = ss.getSheetByName('Audit_Trail');
        if (audit2) audit2.appendRow([now, 'DWYP_App', 'DERIVATIVE_COPY', assetId + ' → ' + newId]);
      } catch (e) {}
      return { ok: true, assetId: newId };
    }

    return { ok: false, error: 'Unknown action: ' + action };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Returns the display-layer state for a single asset: display_text, caption_host,
 * caption_guest, canvas_state, quote_text_fallback, and background_id.
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
        caption_guest:       String(data[i][ASSET_LIBRARY_COLS.Caption_Guest - 1] || ''),
        caption_host:        String(data[i][ASSET_LIBRARY_COLS.Caption_Host  - 1] || ''),
        canvas_state:        String(data[i][ASSET_LIBRARY_COLS.Canvas_State  - 1] || '') || null,
        quote_text_fallback: String(data[i][ASSET_LIBRARY_COLS.Quote_Text    - 1] || ''),
        background_id:       String(data[i][ASSET_LIBRARY_COLS.Background_ID - 1] || '') || null
      };
    }
    return { ok: false, error: 'Asset not found: ' + assetId };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Promotes a reel to the Schedule candidate pool.
 * Flips the reel's existing Asset_Library row to Status: schedule.
 * No render or write beyond the status field — the reel is already a native Library row.
 * @param {string} reelAssetId
 * @returns {{ ok: boolean, error?: string }}
 */
function sendReelToSchedule(reelAssetId) {
  try {
    var ss     = SpreadsheetApp.openById(getMasterSheetId());
    var alName = getGovernance('ASSET_LIBRARY_TAB_NAME') || 'Asset_Library';
    var sheet  = ss.getSheetByName(alName);
    if (!sheet) return { ok: false, error: 'Asset_Library tab not found' };
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][ASSET_LIBRARY_COLS.Asset_ID - 1]) !== String(reelAssetId)) continue;
      sheet.getRange(i + 1, ASSET_LIBRARY_COLS.Status).setValue('schedule');
      bumpVersion('asset_library', 'sendReelToSchedule');
      return { ok: true };
    }
    return { ok: false, error: 'Reel not found: ' + reelAssetId };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Upserts an image asset into the Schedule candidate pool.
 * - If assetId matches an existing row: updates Status, Canvas_State, Caption_Host, Background_ID.
 * - If assetId is null or not found: creates a new row at Status: schedule.
 * No Drive write — Drive_File_ID is export-owned. Card preview renders client-side from Canvas_State.
 * @param {string} episodeUid
 * @param {string|null} assetId  — null on first send; existing Asset_ID on re-send
 * @param {string} canvasJson    — Fabric JSON with background objects stripped (no base64 srcs)
 * @param {string} captionHost
 * @param {string|null} backgroundId — Drive file ID of the background image, for round-trip restore
 * @returns {{ ok: boolean, assetId?: string, error?: string }}
 */
function sendImageToSchedule(episodeUid, assetId, canvasJson, captionHost, backgroundId) {
  try {
    var ss     = SpreadsheetApp.openById(getMasterSheetId());
    var alName = getGovernance('ASSET_LIBRARY_TAB_NAME') || 'Asset_Library';
    var alSheet = ss.getSheetByName(alName);
    if (!alSheet) return { ok: false, error: 'Asset_Library tab not found' };

    // Find existing row if assetId provided
    var data = alSheet.getDataRange().getValues();
    var foundRow = -1;
    if (assetId) {
      for (var i = 1; i < data.length; i++) {
        if (String(data[i][ASSET_LIBRARY_COLS.Asset_ID - 1]) === String(assetId)) {
          foundRow = i + 1;
          break;
        }
      }
    }

    if (foundRow !== -1) {
      // Update existing row
      alSheet.getRange(foundRow, ASSET_LIBRARY_COLS.Status).setValue('schedule');
      alSheet.getRange(foundRow, ASSET_LIBRARY_COLS.Canvas_State).setValue(canvasJson || '');
      if (captionHost !== undefined && captionHost !== null) {
        alSheet.getRange(foundRow, ASSET_LIBRARY_COLS.Caption_Host).setValue(captionHost);
      }
      if (backgroundId) alSheet.getRange(foundRow, ASSET_LIBRARY_COLS.Background_ID).setValue(backgroundId);
      bumpVersion('asset_library', 'sendImageToSchedule');
      return { ok: true, assetId: assetId };
    } else {
      // Create new row
      var newId   = Utilities.getUuid();
      var numCols = alSheet.getLastColumn();
      var row     = new Array(numCols).fill('');
      row[ASSET_LIBRARY_COLS.Asset_ID      - 1] = newId;
      row[ASSET_LIBRARY_COLS.Episode_UID   - 1] = episodeUid;
      row[ASSET_LIBRARY_COLS.Asset_Type    - 1] = 'quote_graphic';
      row[ASSET_LIBRARY_COLS.Canvas_State  - 1] = canvasJson || '';
      row[ASSET_LIBRARY_COLS.Caption_Host  - 1] = captionHost || '';
      row[ASSET_LIBRARY_COLS.Background_ID - 1] = backgroundId || '';
      row[ASSET_LIBRARY_COLS.Status        - 1] = 'schedule';
      row[ASSET_LIBRARY_COLS.Availability  - 1] = 'available';
      row[ASSET_LIBRARY_COLS.Created_At    - 1] = new Date();
      row[ASSET_LIBRARY_COLS.Created_By    - 1] = 'jt';
      alSheet.appendRow(row);
      bumpVersion('asset_library', 'sendImageToSchedule');
      return { ok: true, assetId: newId };
    }
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Exports one Schedule-pool asset to Manual_Exports/Singles/ inside the episode staging folder.
 * QG: writes the provided base64 PNG + matched .txt (Caption_Host).
 * Reel: COPIES the Drive file at Drive_File_ID + matched .txt (Display_Name + Caption_Host).
 * No Status or Availability changes — export is not a lifecycle move.
 * @param {string}      episodeUid
 * @param {string}      assetId     — Asset_Library Asset_ID
 * @param {string|null} base64Png   — base64 PNG (no data: prefix) for QG; null for reel
 * @returns {{ success: boolean, folderUrl?: string, error?: string }}
 */
function exportSingleScheduleAsset(episodeUid, assetId, base64Png) {
  try {
    var stagingId = getStagingFolderIdByUid(episodeUid);
    if (!stagingId) return { success: false, error: 'Staging folder not found: ' + episodeUid };
    var stagingFolder = DriveApp.getFolderById(stagingId);

    // Resolve Manual_Exports/Singles/ (create lazily)
    var exportIt  = stagingFolder.getFoldersByName('Manual_Exports');
    var exportRoot = exportIt.hasNext() ? exportIt.next() : stagingFolder.createFolder('Manual_Exports');
    var singlesIt  = exportRoot.getFoldersByName('Singles');
    var singlesFolder = singlesIt.hasNext() ? singlesIt.next() : exportRoot.createFolder('Singles');

    // Resolve AL row
    var ss      = SpreadsheetApp.openById(getMasterSheetId());
    var alName  = getGovernance('ASSET_LIBRARY_TAB_NAME') || 'Asset_Library';
    var alSheet = ss.getSheetByName(alName);
    if (!alSheet) return { success: false, error: 'Asset_Library tab not found' };

    var alData = alSheet.getDataRange().getValues();
    var al = null;
    for (var i = 1; i < alData.length; i++) {
      if (String(alData[i][ASSET_LIBRARY_COLS.Asset_ID - 1]) === String(assetId)) {
        al = {
          assetType:   String(alData[i][ASSET_LIBRARY_COLS.Asset_Type    - 1]),
          driveFileId: String(alData[i][ASSET_LIBRARY_COLS.Drive_File_ID - 1] || ''),
          displayName: String(alData[i][ASSET_LIBRARY_COLS.Display_Name  - 1] || ''),
          captionHost: String(alData[i][ASSET_LIBRARY_COLS.Caption_Host  - 1] || '')
        };
        break;
      }
    }
    if (!al) return { success: false, error: 'Asset not found: ' + assetId };

    var baseName = _safeFilename(al.displayName) || assetId;
    var isReel   = al.assetType.toLowerCase() === 'reel';

    var noExtSingle = '';
    if (isReel) {
      if (!al.driveFileId) return { success: false, error: 'No Drive file ID for reel: ' + assetId };
      var reelFile = DriveApp.getFileById(al.driveFileId);
      var ext      = reelFile.getName().split('.').pop() || 'mp4';
      var reelName = _uniqueFilename(singlesFolder, baseName, ext);
      noExtSingle  = reelName.substring(0, reelName.length - ext.length - 1);
      reelFile.makeCopy(reelName, singlesFolder);
      var txtBody = [al.displayName, al.captionHost].filter(Boolean).join('\n\n');
      singlesFolder.createFile(Utilities.newBlob(txtBody, 'text/plain', _uniqueFilename(singlesFolder, noExtSingle, 'txt')));
    } else {
      if (!base64Png) return { success: false, error: 'No PNG bytes provided for QG: ' + assetId };
      var imgName = _uniqueFilename(singlesFolder, baseName, 'png');
      noExtSingle  = imgName.substring(0, imgName.length - 4);
      var blob = Utilities.newBlob(Utilities.base64Decode(base64Png), 'image/png', imgName);
      singlesFolder.createFile(blob);
      singlesFolder.createFile(Utilities.newBlob(al.captionHost, 'text/plain', _uniqueFilename(singlesFolder, noExtSingle, 'txt')));
    }

    return { success: true, folderUrl: 'https://drive.google.com/drive/folders/' + singlesFolder.getId() };
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
    if (status === "archived") continue;
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

// ── EPISODE REVISION FLOW ────────────────────────────────────────────────────

/**
 * Returns the stream URL for the episode proxy (or any single video in Episode/).
 * Sets Drive sharing to anyone-with-link so the native <video> element can load it.
 * Prefers proxy_ prefix; falls back to any video/* file.
 * @param {string} episodeUid
 * @returns {{ url: string, error?: string }}
 */
function getProxyStreamUrl(episodeUid) {
  try {
    var stagingId = getStagingFolderIdByUid(episodeUid);
    if (!stagingId) return { url: '', error: 'Staging folder not found.' };
    var epFolderIt = DriveApp.getFolderById(stagingId).getFoldersByName('Episode');
    if (!epFolderIt.hasNext()) return { url: '', error: 'Episode/ subfolder not found.' };
    var epFolder = epFolderIt.next();
    var files = epFolder.getFiles();
    var proxyFile = null, anyVideoFile = null;
    while (files.hasNext()) {
      var f = files.next();
      if (f.getName().indexOf('proxy_') === 0) { proxyFile = f; break; }
      if (!anyVideoFile && f.getMimeType().indexOf('video/') === 0) anyVideoFile = f;
    }
    var target = proxyFile || anyVideoFile;
    if (!target) return { url: '', error: 'No video file found in Episode/ folder.' };
    target.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    var fileId = target.getId();
    return {
      url:        'https://drive.google.com/uc?id=' + fileId,
      previewUrl: 'https://drive.google.com/file/d/' + fileId + '/preview'
    };
  } catch (e) {
    return { url: '', error: e.message };
  }
}

/**
 * Shared V4 signing helper. method = 'GET' | 'POST'.
 * extraHeaders: {lowercaseName: value} — included in canonical headers and X-Goog-SignedHeaders;
 *   the caller's HTTP request must send them exactly as specified.
 * Throws on signBlob failure.
 */
function _signV4(method, objectPath, expirySec, bucket, signerSa, extraHeaders) {
  function pad2(n) { return String(n).padStart(2, '0'); }
  function toHex(bytes) {
    return bytes.map(function(b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
  }

  var now         = new Date();
  var dateStr     = now.getUTCFullYear() + pad2(now.getUTCMonth() + 1) + pad2(now.getUTCDate());
  var timeStr     = pad2(now.getUTCHours()) + pad2(now.getUTCMinutes()) + pad2(now.getUTCSeconds());
  var dateTimeStr = dateStr + 'T' + timeStr + 'Z';
  var credScope   = dateStr + '/auto/storage/goog4_request';
  var host        = 'storage.googleapis.com';
  var canonicalUri = '/' + bucket + '/' + objectPath;

  // Build sorted header map; host always included.
  var headerMap = { host: host };
  if (extraHeaders) {
    Object.keys(extraHeaders).forEach(function(k) { headerMap[k] = extraHeaders[k]; });
  }
  var headerNames      = Object.keys(headerMap).sort();
  // Trailing \n on canonical headers block is required by the V4 spec.
  var canonicalHeaders = headerNames.map(function(k) { return k + ':' + headerMap[k]; }).join('\n') + '\n';
  var signedHeaders    = headerNames.join(';');

  // Params must be in lexicographic order for the canonical query string.
  var queryParams = [
    ['X-Goog-Algorithm',     'GOOG4-RSA-SHA256'],
    ['X-Goog-Credential',    signerSa + '/' + credScope],
    ['X-Goog-Date',          dateTimeStr],
    ['X-Goog-Expires',       String(expirySec)],
    ['X-Goog-SignedHeaders', signedHeaders]
  ];
  var canonicalQs = queryParams.map(function(p) {
    return encodeURIComponent(p[0]) + '=' + encodeURIComponent(p[1]);
  }).join('&');

  var canonicalRequest = [method, canonicalUri, canonicalQs, canonicalHeaders, signedHeaders, 'UNSIGNED-PAYLOAD'].join('\n');
  var algo             = Utilities.DigestAlgorithm.SHA_256;
  var canonicalHash    = toHex(Utilities.computeDigest(algo, canonicalRequest));
  var stringToSign     = ['GOOG4-RSA-SHA256', dateTimeStr, credScope, canonicalHash].join('\n');

  // iamcredentials is the correct endpoint for impersonation-style signing;
  // iam.googleapis.com signBlob is an admin operation and may be blocked by org policy.
  // iamcredentials uses "payload" (not "bytesToSign") in the request body.
  var iamUrl  = 'https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/' +
                encodeURIComponent(signerSa) + ':signBlob';
  var iamResp = UrlFetchApp.fetch(iamUrl, {
    method:             'post',
    contentType:        'application/json',
    headers:            { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    payload:            JSON.stringify({ payload: Utilities.base64Encode(stringToSign) }),
    muteHttpExceptions: true
  });
  if (iamResp.getResponseCode() !== 200) {
    throw new Error('signBlob ' + iamResp.getResponseCode() + ': ' + iamResp.getContentText());
  }
  var sigHex = toHex(Utilities.base64Decode(JSON.parse(iamResp.getContentText()).signedBlob));
  return 'https://' + host + canonicalUri + '?' + canonicalQs + '&X-Goog-Signature=' + sigHex;
}

/**
 * Mints a V4-signed GCS GET URL for the episode proxy.
 * Config keys: REVIEW_GCS_BUCKET, GCS_SIGNER_SA, GCS_EXPIRY_SECONDS (default 28800 = 8h).
 */
function getEpisodeStreamUrl(episodeUid) {
  try {
    var bucket    = getGovernance('REVIEW_GCS_BUCKET');
    var signerSa  = getGovernance('GCS_SIGNER_SA');
    var expirySec = parseInt(getGovernance('GCS_EXPIRY_SECONDS') || '28800', 10);
    if (!bucket || !signerSa) return { error: 'REVIEW_GCS_BUCKET or GCS_SIGNER_SA not configured.' };
    return { url: _signV4('GET', 'episodes/' + episodeUid + '/proxy.mp4', expirySec, bucket, signerSa, {}) };
  } catch (e) {
    return { error: e.message };
  }
}

/**
 * Mints a V4-signed GCS POST URL for initiating a resumable upload of the episode proxy.
 * x-goog-resumable:start is included in signed headers — client must send it in the POST.
 * Config keys: REVIEW_GCS_BUCKET, GCS_SIGNER_SA, GCS_UPLOAD_EXPIRY_SECONDS (default 3600 = 1h).
 */
function getEpisodeUploadUrl(episodeUid) {
  try {
    var bucket    = getGovernance('REVIEW_GCS_BUCKET');
    var signerSa  = getGovernance('GCS_SIGNER_SA');
    var expirySec = parseInt(getGovernance('GCS_UPLOAD_EXPIRY_SECONDS') || '3600', 10);
    if (!bucket || !signerSa) return { error: 'REVIEW_GCS_BUCKET or GCS_SIGNER_SA not configured.' };
    return { url: _signV4('POST', 'episodes/' + episodeUid + '/proxy.mp4', expirySec, bucket, signerSa,
                          { 'x-goog-resumable': 'start' }) };
  } catch (e) {
    return { error: e.message };
  }
}

/**
 * Checks whether episodes/{uid}/proxy.mp4 exists in the review bucket.
 * Uses the GCS JSON API with the owner's OAuth token (cloud-platform scope).
 * @returns {{ exists: boolean } | { error: string }}
 */
function checkEpisodeProxyExists(episodeUid) {
  try {
    var bucket = getGovernance('REVIEW_GCS_BUCKET');
    if (!bucket) return { error: 'REVIEW_GCS_BUCKET not configured' };
    var objectName = encodeURIComponent('episodes/' + episodeUid + '/proxy.mp4');
    var url  = 'https://storage.googleapis.com/storage/v1/b/' + encodeURIComponent(bucket) + '/o/' + objectName;
    var resp = UrlFetchApp.fetch(url, {
      headers:            { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true
    });
    var code = resp.getResponseCode();
    if (code === 200) return { exists: true };
    if (code === 404) return { exists: false };
    return { error: 'GCS metadata ' + code + ': ' + resp.getContentText() };
  } catch (e) {
    return { error: e.message };
  }
}

/**
 * Completes the Upload_Produced_Episode task, flips Video_Status to 'review',
 * and spawns the Review_Episode task for the host.
 * @param {number} rowIndex  1-based Tasks sheet row
 * @param {string} episodeUid
 * @returns {{ success: boolean, error?: string }}
 */
function completeUploadEpisode(rowIndex, episodeUid) {
  try {
    var sheetId   = getMasterSheetId();
    var ss        = SpreadsheetApp.openById(sheetId);

    var taskSheet = ss.getSheetByName('Tasks');
    taskSheet.getRange(rowIndex, TASKS_COLS.Status).setValue('complete');
    taskSheet.getRange(rowIndex, TASKS_COLS.Completed_At).setValue(new Date());

    var epSheet   = ss.getSheetByName('Episodes');
    var epData    = epSheet.getDataRange().getValues();
    var guestName = episodeUid, contactId = '';
    for (var i = 1; i < epData.length; i++) {
      if (String(epData[i][EPISODES_COLS.Episode_UID - 1]) !== String(episodeUid)) continue;
      guestName = String(epData[i][EPISODES_COLS.Guest_Name - 1] || episodeUid);
      contactId = String(epData[i][EPISODES_COLS.Contact_ID - 1] || '');
      epSheet.getRange(i + 1, EPISODES_COLS.Video_Status).setValue('review');
      break;
    }
    patchEpisodes(episodeUid, { Status: 'review' });

    bumpVersion('episodes', 'completeUploadEpisode');
    bumpVersion('tasks',    'completeUploadEpisode');

    spawnTask({
      episodeUid:       episodeUid,
      contactId:        contactId,
      workflowStep:     'Review_Episode',
      actionTitle:      'Review episode: ' + guestName,
      assignee:         getGovernance('ASSIGNEE_HOST'),
      assignedBy:       'The Fairy Team',
      status:           'open',
      priority:         'normal',
      executiveSummary: 'The episode proxy for ' + guestName + ' is ready for your review.'
    }, true);

    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Called when Audra completes the Upload_Final_Episode task (UI path) or when the
 * Daily Pulse detects the final video in the episode Drive folder (backup path).
 * Reads the single file in Episode/, writes its Drive ID to Final_Episode_ID,
 * flips Episode Status → ready_to_release, spawns Filing + Release tasks.
 *
 * @param {string} episodeUid
 * @param {number} [rowIndex]  1-based Tasks sheet row. If omitted (pulse backup path),
 *                              the function scans Tasks for the open Upload_Final_Episode task.
 */
function completeFinalEpisodeUpload(episodeUid, rowIndex) {
  try {
    var stagingId = getStagingFolderIdByUid(episodeUid);
    if (!stagingId) return { ok: false, error: "Staging folder not found." };

    var stagingFolder = DriveApp.getFolderById(stagingId);
    var epFolderIt    = stagingFolder.getFoldersByName("Episode");
    if (!epFolderIt.hasNext()) return { ok: false, error: "Episode/ subfolder not found." };
    var epFolder = epFolderIt.next();

    var allFiles = epFolder.getFiles();
    var files    = [];
    while (allFiles.hasNext()) files.push(allFiles.next());
    if (files.length === 0) return { ok: false, error: "No file found in Episode/ folder yet." };
    if (files.length > 1)  return { ok: false, error: "Multiple files in Episode/ folder — move the extra file before completing." };
    var finalFileId = files[0].getId();

    var sheetId   = getMasterSheetId();
    var ss        = SpreadsheetApp.openById(sheetId);
    var taskSheet = ss.getSheetByName("Tasks");
    var tData     = taskSheet.getDataRange().getValues();
    var tHeaders  = tData[0];
    var tEpCol    = tHeaders.indexOf("Episode_UID");
    var tWfCol    = tHeaders.indexOf("Workflow_Step");
    var tStCol    = tHeaders.indexOf("Status");
    var tCaCol    = tHeaders.indexOf("Completed_At");

    var epSheet   = ss.getSheetByName("Episodes");
    var epData    = epSheet.getDataRange().getValues();
    var guestName = episodeUid, contactId = "";
    for (var i = 1; i < epData.length; i++) {
      if (String(epData[i][EPISODES_COLS.Episode_UID - 1]) !== String(episodeUid)) continue;
      guestName = String(epData[i][EPISODES_COLS.Guest_Name - 1] || episodeUid);
      contactId = String(epData[i][EPISODES_COLS.Contact_ID - 1] || "");
      break;
    }

    var hasRelease = false;
    for (var t = 1; t < tData.length; t++) {
      if (String(tData[t][tEpCol]) !== String(episodeUid)) continue;
      if (String(tData[t][tWfCol]) !== "release")          continue;
      var rs = String(tData[t][tStCol]);
      if (rs === "open" || rs === "in_progress") { hasRelease = true; break; }
    }

    // Writes
    var now = new Date();
    patchEpisodes(episodeUid, { Status: "ready_to_release", Final_Episode_ID: finalFileId });

    if (rowIndex) {
      // UI path — complete the task at the known row
      taskSheet.getRange(rowIndex, TASKS_COLS.Status).setValue("complete");
      taskSheet.getRange(rowIndex, TASKS_COLS.Completed_At).setValue(now);
    } else {
      // Pulse backup path — find and complete the open Upload_Final_Episode task
      for (var u = 1; u < tData.length; u++) {
        if (String(tData[u][tEpCol]) !== String(episodeUid))    continue;
        if (String(tData[u][tWfCol]) !== "Upload_Final_Episode") continue;
        var us = String(tData[u][tStCol]);
        if (us !== "open" && us !== "in_progress")              continue;
        taskSheet.getRange(u + 1, tStCol + 1).setValue("complete");
        taskSheet.getRange(u + 1, tCaCol + 1).setValue(now);
        break;
      }
    }

    var REVIEW_STEPS = ["Review_Episode", "Review_Host_Graphics", "Review_Guest_Graphics", "Review_Reels"];
    for (var r = 1; r < tData.length; r++) {
      if (String(tData[r][tEpCol]) !== String(episodeUid))        continue;
      if (String(tData[r][tStCol]) === "complete")                continue;
      if (REVIEW_STEPS.indexOf(String(tData[r][tWfCol])) === -1) continue;
      taskSheet.getRange(r + 1, tStCol + 1).setValue("complete");
      taskSheet.getRange(r + 1, tCaCol + 1).setValue(now);
    }

    spawnTask({
      episodeUid:   episodeUid,
      contactId:    contactId,
      workflowStep: "Filing",
      actionTitle:  "Assets ready to file — " + guestName,
      assignee:     getGovernance("ASSIGNEE_PRODUCER"),
      assignedBy:   "The Fairy Team",
      status:       "open",
      priority:     "normal"
    }, true);

    if (!hasRelease) {
      spawnTask({
        episodeUid:   episodeUid,
        contactId:    contactId,
        workflowStep: "release",
        actionTitle:  "Confirm release — " + guestName,
        assignee:     getGovernance("ASSIGNEE_PRODUCER"),
        assignedBy:   "The Fairy Team",
        status:       "open",
        priority:     "normal",
        payloadLink:  getGovernance("SPOTIFY_EPISODE_BASE")
      }, true);
    }

    bumpVersion("episodes", "completeFinalEpisodeUpload");
    bumpVersion("tasks",    "completeFinalEpisodeUpload");

    logToAuditTrail("completeFinalEpisodeUpload", "state_change", episodeUid, contactId,
      "[INFO] Final episode uploaded. Drive ID: " + finalFileId + ". Status → ready_to_release.", "INFO");

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Returns the Episode_Log revision history for the episode review rail, plus
 * the current video state and staging folder URL for the deep-link payload.
 * @param {string} episodeUid
 * @returns {{ ok, videoStatus, rows, stagingFolderUrl }}
 */
function getEpisodeRevisionHistory(episodeUid) {
  try {
    var sheetId = getMasterSheetId();
    var ss      = SpreadsheetApp.openById(sheetId);

    var epSheet = ss.getSheetByName('Episodes');
    var epData  = epSheet.getDataRange().getValues();
    var videoStatus = 'pending', stagingFolderId = '';
    for (var i = 1; i < epData.length; i++) {
      if (String(epData[i][EPISODES_COLS.Episode_UID - 1]) !== String(episodeUid)) continue;
      videoStatus     = String(epData[i][EPISODES_COLS.Video_Status        - 1] || 'pending');
      stagingFolderId = String(epData[i][EPISODES_COLS.Production_Folder_ID - 1] || '');
      break;
    }

    var rows = [];
    var logSheet = ss.getSheetByName('Episode_Log');
    if (logSheet) {
      var logData = logSheet.getDataRange().getValues();
      for (var j = 1; j < logData.length; j++) {
        var r = logData[j];
        if (String(r[EPISODE_LOG_COLS.Episode_UID - 1]) !== String(episodeUid)) continue;
        if (String(r[EPISODE_LOG_COLS.Entry_Type  - 1]) !== 'revision')         continue;
        if (String(r[EPISODE_LOG_COLS.Asset_Type  - 1]) !== 'video')             continue;
        var rr = r[EPISODE_LOG_COLS.Revision_Round - 1];
        rows.push({
          logId:         String(r[EPISODE_LOG_COLS.Log_ID    - 1]),
          timestamp:     r[EPISODE_LOG_COLS.Timestamp - 1]
            ? new Date(r[EPISODE_LOG_COLS.Timestamp - 1]).toISOString() : '',
          body:          String(r[EPISODE_LOG_COLS.Body       - 1]),
          revisionRound: (rr !== '' && rr != null) ? Number(rr) : null
        });
      }
    }

    var stagingFolderUrl = stagingFolderId
      ? 'https://drive.google.com/drive/folders/' + stagingFolderId : '';

    return { ok: true, videoStatus: videoStatus, rows: rows, stagingFolderUrl: stagingFolderUrl };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Writes a single Episode_Log revision row for the compose loop.
 * Called per-comment (not batched); optimistic append on client.
 * @param {string} episodeUid
 * @param {string} timecode      — MM:SS captured at focus moment; empty string if unknown
 * @param {string} body          — comment text
 * @param {number} revisionRound — current round integer
 * @param {string} authorEmail
 * @returns {{ ok: boolean, error?: string }}
 */
function submitEpisodeCommentRow(episodeUid, timecode, body, revisionRound, authorEmail) {
  try {
    if (!body || !body.trim()) return { ok: false, error: 'Empty comment.' };
    var formattedBody = timecode ? '[' + timecode + '] ' + body.trim() : body.trim();
    var res = appendEpisodeLogEntry(
      episodeUid, 'revision', 'video', formattedBody, 'both', authorEmail, revisionRound
    );
    if (res && res.success === false) return { ok: false, error: res.error };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Hard-seals the current revision round: spawns or appends to an open Revise_Episode
 * task (with staging folder deep-link) and sets Video_Status = 'revision_requested'.
 * @param {string} episodeUid
 * @param {string} authorEmail
 * @returns {{ ok: boolean, round: number, error?: string }}
 */
function requestEpisodeRevisions(episodeUid, authorEmail) {
  try {
    var sheetId = getMasterSheetId();
    var ss      = SpreadsheetApp.openById(sheetId);

    // Determine sealed round: max Revision_Round in Episode_Log for this episode
    var logSheet = ss.getSheetByName('Episode_Log');
    var maxRound = 0;
    if (logSheet) {
      var logData = logSheet.getDataRange().getValues();
      for (var j = 1; j < logData.length; j++) {
        if (String(logData[j][EPISODE_LOG_COLS.Episode_UID - 1]) !== String(episodeUid)) continue;
        if (String(logData[j][EPISODE_LOG_COLS.Entry_Type  - 1]) !== 'revision')         continue;
        var rr = logData[j][EPISODE_LOG_COLS.Revision_Round - 1];
        if (rr && Number(rr) > maxRound) maxRound = Number(rr);
      }
    }
    var round = maxRound || 1;

    // Staging folder URL for Payload_Link
    var epSheet = ss.getSheetByName('Episodes');
    var epData  = epSheet.getDataRange().getValues();
    var stagingFolderId = '', guestName = episodeUid;
    for (var i = 1; i < epData.length; i++) {
      if (String(epData[i][EPISODES_COLS.Episode_UID - 1]) !== String(episodeUid)) continue;
      stagingFolderId = String(epData[i][EPISODES_COLS.Production_Folder_ID - 1] || '');
      guestName       = String(epData[i][EPISODES_COLS.Guest_Name            - 1] || episodeUid);
      break;
    }
    var folderUrl = stagingFolderId
      ? 'https://drive.google.com/drive/folders/' + stagingFolderId : '';

    // Spawn or append to open Revise_Episode task
    var taskSheet     = ss.getSheetByName('Tasks');
    var producerEmail = getGovernance('ASSIGNEE_PRODUCER');
    var foundTask     = false;
    if (taskSheet) {
      var tData = taskSheet.getDataRange().getValues();
      for (var r = 1; r < tData.length; r++) {
        if (String(tData[r][TASKS_COLS.Episode_UID   - 1]) !== String(episodeUid))  continue;
        if (String(tData[r][TASKS_COLS.Workflow_Step - 1]) !== 'Revise_Episode')    continue;
        if (String(tData[r][TASKS_COLS.Status        - 1]) === 'complete')          continue;
        var existing = String(tData[r][TASKS_COLS.Revision_Notes - 1] || '');
        var note     = 'Round ' + round + ' sealed.';
        taskSheet.getRange(r + 1, TASKS_COLS.Revision_Notes).setValue(
          existing ? existing + '\n' + note : note
        );
        foundTask = true;
        break;
      }
      // Auto-complete the open Review_Episode task — JT is done reviewing
      for (var t = 1; t < tData.length; t++) {
        if (String(tData[t][TASKS_COLS.Episode_UID   - 1]) !== String(episodeUid)) continue;
        if (String(tData[t][TASKS_COLS.Workflow_Step - 1]) !== 'Review_Episode')   continue;
        if (String(tData[t][TASKS_COLS.Status        - 1]) === 'complete')         continue;
        taskSheet.getRange(t + 1, TASKS_COLS.Status).setValue('complete');
        taskSheet.getRange(t + 1, TASKS_COLS.Completed_At).setValue(new Date());
        break;
      }
    }
    if (!foundTask) {
      spawnTask({
        actionTitle:      'Episode Revisions — ' + guestName,
        assignee:         producerEmail,
        assignedBy:       'The Fairy Team',
        status:           'open',
        priority:         'normal',
        episodeUid:       episodeUid,
        workflowStep:     'Revise_Episode',
        payloadLink:      folderUrl,
        revisionNotes:    'Round ' + round + ' sealed.',
        executiveSummary: 'JT requested episode revisions. Open the Drive folder below, ' +
                          'move the old video to Archive/, drop v2, then click Complete.'
      });
    }

    writeVideoStatus(episodeUid, 'revision_requested');
    bumpVersion('episodes', 'requestEpisodeRevisions');

    logToAuditTrail('requestEpisodeRevisions', 'human_action', episodeUid, '',
      '[INFO] Episode revision round ' + round + ' sealed by ' + (authorEmail || 'JT') + '.', 'INFO');

    return { ok: true, round: round };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Complete handler for Revise_Episode tasks. Validates that exactly one video
 * file exists in the Episode/ subfolder before completing. Resets Video_Status
 * to 'pending' so JT can compose round N+1.
 * @param {string} episodeUid
 * @param {string} taskId       — TASK-... ID of the Revise_Episode task
 * @returns {{ ok: boolean, error?: string }}
 */
function completeEpisodeRevision(episodeUid, taskId) {
  try {
    var stagingId = getStagingFolderIdByUid(episodeUid);
    if (!stagingId) return { ok: false, error: 'Episode staging folder not found.' };

    var epFolderIt = DriveApp.getFolderById(stagingId).getFoldersByName('Episode');
    if (!epFolderIt.hasNext()) return { ok: false, error: 'Episode/ subfolder not found.' };
    var epFolder = epFolderIt.next();

    var videoFiles = [];
    var allFiles = epFolder.getFiles();
    while (allFiles.hasNext()) {
      var f = allFiles.next();
      if (f.getMimeType().indexOf('video/') === 0) videoFiles.push(f);
    }

    if (videoFiles.length === 0) {
      return { ok: false, error: 'Drop the revised video first.' };
    }
    if (videoFiles.length > 1) {
      return { ok: false, error: 'More than one video found. Move the old one to Archive/ first.' };
    }

    // Exactly 1 video — reset episode state to ready-for-review
    writeVideoStatus(episodeUid, 'pending');

    // Complete the Revise_Episode task
    if (taskId) updateTaskStatus(taskId, 'complete');

    bumpVersion('episodes', 'completeEpisodeRevision');
    logToAuditTrail('completeEpisodeRevision', 'state_change', episodeUid, '',
      '[INFO] Episode v2 accepted. File: ' + videoFiles[0].getId() +
      '. Video_Status reset to pending.', 'INFO');

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
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


// ── COMPANION ─────────────────────────────────────────────────────────────────
// Reusable spine shared by all four surface companions (Episode, Images, Reels, Schedule).
// Passes 2–4 add a context-assembly case to _companionBuildSystem and
// _companionBuildUserPrompt — the spine functions are unchanged.

/**
 * Assembles the layered companion prompt and calls Claude.
 *
 * surface:        'episode' | 'images' | 'reels' | 'schedule'
 * episodeUid:     EUID for the current episode
 * history:        Prior turns [{role:'user'|'assistant', content:string}] (in-session, client-managed)
 * userMessage:    JT's current message (raw — no transcript preamble)
 * workspaceState: Per-surface live state object:
 *   Episode:  { showNotesText: string }
 *   Images:   { activeAssetText: string }  — Pass 2 stub
 *   Reels:    { titleCardText: string, captionText: string }
 *   Schedule: { placedAssets: Array }       — Pass 4 stub
 */
function companionChat(surface, episodeUid, history, userMessage, workspaceState) {
  var companionVoice = extractPrompt("# Companion Voice");
  var showPhilosophy = extractPrompt("# Show Philosophy");
  var pillars        = extractPrompt("# Pillars");

  var system = _companionBuildSystem(surface, episodeUid, companionVoice, showPhilosophy, pillars);
  var prompt = _companionBuildUserPrompt(surface, workspaceState, userMessage);

  return callClaudeAPI(prompt, system, "companion_" + surface, history, { maxTokens: 2048 });
}

/**
 * Builds the system instruction: voice + brand from template + episode transcript.
 * Transcript injected into system instruction so it's always in context without
 * cluttering message history.
 */
function _companionBuildSystem(surface, episodeUid, companionVoice, showPhilosophy, pillars) {
  var system = '';

  if (companionVoice)  system += companionVoice + '\n\n';
  if (showPhilosophy)  system += '## SHOW PHILOSOPHY\n' + showPhilosophy + '\n\n';
  if (pillars)         system += '## PILLARS\n'         + pillars        + '\n\n';

  switch (surface) {
    case 'episode':
      var transcript = stLoadEpisodeIndex(episodeUid);
      if (transcript) {
        system += '## EPISODE TRANSCRIPT\n' +
                  'This is the source of truth for all factual claims. Use it to answer questions ' +
                  'about what was said, when, and by whom.\n\n' +
                  transcript + '\n\n';
      }
      system += 'IMPORTANT: Show notes visible in the conversation are JT\'s working draft to assist ' +
                'with — do not treat them as factual source. The transcript is the only source of truth. ' +
                'Never ground new copy on previously-generated copy.';
      break;
    case 'images': {
      var transcriptImg = stLoadEpisodeIndex(episodeUid);
      if (transcriptImg) {
        system += '## EPISODE TRANSCRIPT\n' +
                  'Source of truth for all copy. Verbatim quotes must come word-for-word from this text — ' +
                  'never paraphrased or reconstructed.\n\n' +
                  transcriptImg + '\n\n';
      }
      try {
        var hq = getEpisodeHooksAndQuotes(episodeUid);
        var poolLines = [];
        (hq.hooks  || []).forEach(function(h) { var t = (typeof h === 'string') ? h : (h.text || ''); if (t) poolLines.push('HOOK: ' + t); });
        (hq.quotes || []).forEach(function(q) { var t = (typeof q === 'string') ? q : (q.text || ''); if (t) poolLines.push('QUOTE: ' + t); });
        if (poolLines.length) {
          system += '## DO NOT REPEAT — ALREADY SURFACED TO JT\n' +
                    'These hooks and quotes have already been shown to JT. Offer fresh angles and different lines — do not re-serve these.\n\n' +
                    poolLines.join('\n') + '\n\n';
        }
      } catch (e) { /* non-fatal — pool exclusion omitted if unavailable */ }
      system += 'You are helping JT source and sharpen hook/quote/caption copy for a canvas graphic. ' +
                'When JT asks for a line to use, produce it in the correct production voice. ' +
                'Iterate on genuine variation — when JT pushes back, offer different angles, not the same idea reworded. ' +
                'Stay on copy for the current canvas asset. Do not draft copy that belongs to other surfaces.';
      break;
    }
    case 'reels': {
      var transcriptReel = stLoadEpisodeIndex(episodeUid);
      if (transcriptReel) {
        system += '## EPISODE TRANSCRIPT\n' +
                  'Source of truth for all copy. Verbatim quotes must come word-for-word from this text — ' +
                  'never paraphrased or reconstructed.\n\n' +
                  transcriptReel + '\n\n';
      }
      system += 'You are helping JT refine the title card and caption for a reel. ' +
                'REFINE-FIRST: default to improving what JT already has — sharpen the hook, tighten the language, improve the rhythm. ' +
                'Do not volunteer net-new title card or caption options unless JT explicitly asks you to generate alternatives. ' +
                'When JT does ask for new options, produce them in the correct production voice from the transcript. ' +
                'Verbatim quotes must come word-for-word from the transcript — never reconstruct or paraphrase. ' +
                'Do not draft copy for other surfaces (canvas graphics, show notes, schedule). Stay on the current reel.';
      break;
    }
    case 'schedule': {
      // THE FIREWALL: do NOT call stLoadEpisodeIndex here.
      // The companion must judge assets without episode context — same as the audience.
      system += 'You are a social-media strategist helping JT arrange her week of posts. ' +
                'You advise on the *arrangement* — coverage, pacing, format/platform mix, swipe-package balance, ' +
                'and whether the week works for an audience that has never heard the episode.\n\n' +
                'FIREWALL: You do not have the episode transcript. This is intentional. ' +
                'Judge every asset by whether it stands alone to someone who has never heard this episode. ' +
                'You cannot fall back on episode context the audience lacks — and neither can the audience.\n\n' +
                'ADVISE-FIRST: Default to assessing and improving the week JT has already arranged. ' +
                'Flag coverage gaps, pacing problems, format/platform mix issues, and assets that will not land ' +
                'without episode context. Produce net-new arrangement proposals only when JT explicitly asks. ' +
                'Do not invent posting strategy unprompted.\n\n' +
                'STAY ON ARRANGEMENT: This is scheduling work. If JT needs to rewrite a caption or re-cut a reel, ' +
                'point her to the Images or Reels surface — do not do copy work here. ' +
                'The firewall makes copy work structurally difficult anyway: you lack the transcript to pull from.\n\n' +
                'SLOT INTENT: Read the slot intent ("why" field per slot) as the goal for that slot — ' +
                'what that placement is trying to accomplish for the audience. ' +
                'For ad-hoc slots (flagged as such in the workspace), respect JT\'s placement choice ' +
                'and reason from craft; do not treat an ad-hoc slot as a plan gap to flag.\n\n' +
                'SOURCE AWARENESS: When making a resonance judgment, name what you are grounding it in. ' +
                'If trends data appears in the workspace, cite it. ' +
                'Otherwise, flag your response as general social-craft reasoning.\n\n' +
                'The central question governing every judgment: does this asset stand alone? ' +
                'Without the episode for context, will it resonate with a cold, short-attention-span scroll?';
      break;
    }
  }

  return system;
}

/**
 * Builds the per-turn user prompt: workspace state preamble + user message.
 * Workspace state is sent every turn so the companion always sees the live draft.
 */
function _companionBuildUserPrompt(surface, workspaceState, userMessage) {
  switch (surface) {
    case 'episode':
      var showNotes = workspaceState && workspaceState.showNotesText
        ? workspaceState.showNotesText.trim() : '';
      if (showNotes) {
        return '[SHOW NOTES — JT\'s current working draft]\n' + showNotes + '\n\n---\n\n' + userMessage;
      }
      return userMessage;
    case 'images': {
      var canvasText = workspaceState && workspaceState.activeAssetText
        ? workspaceState.activeAssetText.trim() : '';
      if (canvasText) {
        return '[CANVAS — current text on the canvas]\n' + canvasText + '\n\n---\n\n' + userMessage;
      }
      return userMessage;
    }
    case 'reels': {
      var titleCardText = workspaceState && workspaceState.titleCardText ? workspaceState.titleCardText.trim() : '';
      var reelCaption   = workspaceState && workspaceState.captionText   ? workspaceState.captionText.trim()   : '';
      if (titleCardText || reelCaption) {
        var preamble = '[CURRENT REEL DRAFT]';
        if (titleCardText) preamble += '\nTitle card: ' + titleCardText;
        if (reelCaption)   preamble += '\nCaption: '    + reelCaption;
        return preamble + '\n\n---\n\n' + userMessage;
      }
      return userMessage;
    }
    case 'schedule': {
      var placed   = workspaceState && workspaceState.placedAssets  ? workspaceState.placedAssets  : [];
      var unplaced = workspaceState && workspaceState.unplacedPool  ? workspaceState.unplacedPool  : [];
      if (!placed.length && !unplaced.length) return userMessage;
      var lines = ['[CURRENT WEEK STATE]'];
      if (placed.length) {
        lines.push('\nPlaced:');
        placed.forEach(function(item) {
          var loc = item.placement === 'swipe'
            ? 'Swipe Package'
            : (item.day || '') + (item.platform ? ' — ' + item.platform : '');
          var intent = item.adHoc
            ? '(ad-hoc slot)'
            : (item.slotIntent ? 'Slot intent: ' + item.slotIntent : '');
          var line = '  ' + loc + ' | ' + (item.assetType || '') + ' | ' + (item.displayName || item.assetId || '');
          if (intent) line += ' | ' + intent;
          if (item.surfaceText) line += '\n    "' + String(item.surfaceText).substring(0, 200) + '"';
          lines.push(line);
        });
      }
      if (unplaced.length) {
        lines.push('\nPool (unplaced):');
        unplaced.forEach(function(item) {
          var line = '  ' + (item.assetType || '') + ' | ' + (item.displayName || item.assetId || '');
          if (item.surfaceText) line += ' | "' + String(item.surfaceText).substring(0, 150) + '"';
          lines.push(line);
        });
      }
      return lines.join('\n') + '\n\n---\n\n' + userMessage;
    }
    default:
      return userMessage;
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
    var manifest = getEpisodeManifest(episodeUid);

    // Primary: Show Notes Doc — source of truth for hooks and quotes display
    if (manifest && manifest.show_notes) {
      try {
        var docText     = DocumentApp.openById(manifest.show_notes).getBody().getText();
        var toEntryNull = function(l) { return { assetId: null, text: l.trim().replace(/^\d+\.\s*/, '') }; };
        var toDocEntry  = function(item) { return { assetId: null, text: item.text }; };

        var hooksBlock = extractSectionFromProse(docText, "HOOKS");
        var fallHooks  = hooksBlock
          ? hooksBlock.split("\n").map(toEntryNull).filter(function(e) { return e.text.length > 0; })
          : [];

        var quotesSection = _bridgeSliceSection_(docText, 'GUEST QUOTES:', 'HOST INSTAGRAM CAPTIONS:');
        var fallQuotes    = _bridgeParseRankedItems_(quotesSection || '', 'QUOTE').map(toDocEntry);

        return { hooks: fallHooks, quotes: fallQuotes, imagePrompts: (manifest.image_prompts) || [] };
      } catch (docErr) { /* Doc read failed — fall through */ }
    }

    // Fallback: manifest raw arrays
    if (manifest && manifest.raw_hooks && manifest.raw_hooks.length) {
      var toEntry = function(t) { return { assetId: null, text: t }; };
      return {
        hooks:        manifest.raw_hooks.map(toEntry),
        quotes:       (manifest.raw_quotes || []).map(toEntry),
        imagePrompts: manifest.image_prompts || []
      };
    }

    // Fallback: Asset_Library rows (episodes with no doc)
    var sheetId = getMasterSheetId();
    var ss      = SpreadsheetApp.openById(sheetId);
    var alName  = getGovernance("ASSET_LIBRARY_TAB_NAME") || "Asset_Library";
    var alSheet = ss.getSheetByName(alName);
    if (alSheet) {
      var alData  = alSheet.getDataRange().getValues();
      var hooks   = [];
      var quotes  = [];
      for (var i = 1; i < alData.length; i++) {
        var row = alData[i];
        if (String(row[ASSET_LIBRARY_COLS.Episode_UID - 1]) !== String(episodeUid)) continue;
        var normType = String(row[ASSET_LIBRARY_COLS.Asset_Type - 1]).toLowerCase().replace(/[_ ]/g,'');
        if (normType !== 'quotegraphic') continue;
        var text    = String(row[ASSET_LIBRARY_COLS.Quote_Text   - 1] || '').trim();
        var name    = String(row[ASSET_LIBRARY_COLS.Display_Name - 1] || '').trim();
        var assetId = String(row[ASSET_LIBRARY_COLS.Asset_ID     - 1]);
        if (!text) continue;
        var captionHost = String(row[ASSET_LIBRARY_COLS.Caption_Host - 1] || '').trim();
        var entry = { assetId: assetId, text: text, captionHost: captionHost || null };
        if (name.toLowerCase().indexOf('hook') === 0) {
          hooks.push(entry);
        } else {
          quotes.push(entry);
        }
      }
      if (hooks.length || quotes.length) {
        return { hooks: hooks, quotes: quotes, imagePrompts: (manifest && manifest.image_prompts) || [] };
      }
    }

    return { hooks: [], quotes: [], imagePrompts: [] };
  } catch (e) {
    return { hooks: [], quotes: [], imagePrompts: [], error: e.message };
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
    return { url: 'https://drive.google.com/file/d/' + fileId + '/preview' };
  } catch(e) {
    return { url: '', error: e.message };
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
 * Uploads a Drive MP4 to the Gemini Files API as audio/mp4 and returns the raw
 * response text. Throws on any failure — no silent nulls.
 * Flow: resumable upload → poll until ACTIVE → generateContent → DELETE temp file.
 * @private
 */
function callGeminiAudioAnalysis_(driveFileId, prompt, apiKey) {
  var file     = DriveApp.getFileById(driveFileId);
  var fileSize = file.getSize();
  var fileName = file.getName();
  var mimeType = 'audio/mp4';

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
    throw new Error('Upload init failed (' + initResp.getResponseCode() + '): ' + initResp.getContentText().slice(0, 200));
  }
  var hdrs      = initResp.getHeaders();
  var uploadUrl = hdrs['location'] || hdrs['Location'] || hdrs['x-goog-upload-url'];
  if (!uploadUrl) throw new Error('No upload URL in response headers for: ' + fileName);

  var rawChunkSize = getGovernance('REEL_UPLOAD_CHUNK_BYTES');
  var chunkBytes   = (rawChunkSize && parseInt(rawChunkSize, 10) > 0)
                     ? parseInt(rawChunkSize, 10)
                     : 40 * 1024 * 1024;
  var token        = ScriptApp.getOAuthToken();
  var driveUrl     = 'https://www.googleapis.com/drive/v3/files/' + driveFileId + '?alt=media';
  var offset       = 0;
  var uploadResp;

  while (offset < fileSize) {
    var end       = Math.min(offset + chunkBytes - 1, fileSize - 1);
    var actualLen = end - offset + 1;
    var isFinal   = (end >= fileSize - 1);

    var chunkFetch = UrlFetchApp.fetch(driveUrl, {
      method:  'GET',
      headers: { 'Authorization': 'Bearer ' + token, 'Range': 'bytes=' + offset + '-' + end },
      muteHttpExceptions: true
    });
    var driveCode = chunkFetch.getResponseCode();
    if (driveCode !== 206 && driveCode !== 200) {
      throw new Error('Drive byte-range fetch failed (' + driveCode + ') at offset ' + offset + ' for: ' + fileName);
    }

    uploadResp = UrlFetchApp.fetch(uploadUrl, {
      method:  'POST',
      headers: {
        'X-Goog-Upload-Command': isFinal ? 'upload, finalize' : 'upload',
        'X-Goog-Upload-Offset':  String(offset)
      },
      payload:            chunkFetch.getBlob().setContentType(mimeType),
      muteHttpExceptions: true
    });

    var upCode = uploadResp.getResponseCode();
    if (upCode !== 200) {
      throw new Error((isFinal ? 'Final chunk' : 'Chunk') + ' upload failed (' + upCode + ') at offset ' + offset + ' for: ' + fileName);
    }
    offset += actualLen;
  }

  var gemFile = JSON.parse(uploadResp.getContentText()).file;
  if (!gemFile || !gemFile.uri) throw new Error('No file URI in upload response for: ' + fileName);

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
  if (state !== 'ACTIVE') throw new Error('Gemini file never became ACTIVE after ' + polls + ' polls: ' + fileName);

  var model   = getGovernance('MODEL_NAME') || 'gemini-2.5-flash';
  var genResp = UrlFetchApp.fetch(
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
  if (!text) throw new Error('Gemini returned empty response for: ' + fileName);

  try {
    UrlFetchApp.fetch(
      'https://generativelanguage.googleapis.com/v1beta/' + gemFile.name + '?key=' + apiKey,
      { method: 'DELETE', muteHttpExceptions: true }
    );
  } catch (e) {}

  return text;
}

/**
 * Parses Gemini dual-output: splits on TRANSCRIPT: / GLOSS: delimiters.
 * Throws if neither field is found.
 * @private
 */
function _parseReelAudioResponse_(text) {
  var tMatch = text.match(/TRANSCRIPT:\s*([\s\S]*?)(?=GLOSS:|$)/i);
  var gMatch = text.match(/GLOSS:\s*([\s\S]*?)$/i);
  var transcript = tMatch ? tMatch[1].trim() : '';
  var gloss      = gMatch ? gMatch[1].trim() : '';
  if (!transcript && !gloss) throw new Error('Could not parse TRANSCRIPT or GLOSS from Gemini response');
  return { transcript: transcript, gloss: gloss };
}


function normalizeSummary(s) {
  return String(s || '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}


/**
 * Scans Staging/Reels/ (and Approved/ subfolder) for MP4 files, creates
 * Asset_Library rows for any not yet registered, then runs Gemini video
 * analysis to populate Reel_Summary on rows that lack one.
 *
 * Idempotent: skips files already in AL; skips rows with Reel_Summary unless
 * force:true. Has a 4.5-minute timeout guard — re-run if timedOut:true.
 *
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
  var MAX_MS    = 20 * 60 * 1000;
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
      hasSummary: !!String(row[ASSET_LIBRARY_COLS.Reel_Transcript - 1]).trim()
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

  // ── 5. Gemini dual-output audio analysis for rows without a transcript ─────
  var promptKey = getGovernance('REEL_ANALYSIS_PROMPT_KEY');
  if (!promptKey) throw new Error('syncReelAssets: REEL_ANALYSIS_PROMPT_KEY not set in Governance_Config');
  var basePrompt = extractPrompt(promptKey);
  if (!basePrompt) throw new Error('syncReelAssets: prompt section "' + promptKey + '" not found in Master Template');
  var audioPrompt = basePrompt + (guestName ? '\n\nGuest: ' + guestName : '');

  var apiKey     = getGovernance('GEMINI_API_KEY');
  var summarized = 0;
  var skipped    = 0;
  var timedOut   = false;

  for (var n = 0; n < mp4s.length; n++) {
    if (Date.now() - startTime > MAX_MS) { timedOut = true; break; }

    var entry = existingRows[mp4s[n].getId()];
    if (!entry) { skipped++; continue; }
    if (entry.hasSummary && !force) { skipped++; continue; }

    try {
      var raw    = callGeminiAudioAnalysis_(mp4s[n].getId(), audioPrompt, apiKey);
      var parsed = _parseReelAudioResponse_(raw);
      alSheet.getRange(entry.rowNum, ASSET_LIBRARY_COLS.Reel_Transcript).setValue(normalizeSummary(parsed.transcript));
      alSheet.getRange(entry.rowNum, ASSET_LIBRARY_COLS.Reel_Summary).setValue(normalizeSummary(parsed.gloss));
      summarized++;
    } catch (e) {
      errors.push('Audio analysis failed for ' + mp4s[n].getName() + ': ' + e.message);
      skipped++;
    }
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
        Quote_Text:         String(row[ASSET_LIBRARY_COLS.Quote_Text         - 1] || ''),
        Reel_Transcript: String(row[ASSET_LIBRARY_COLS.Reel_Transcript - 1] || ''),
        Reel_Summary:    String(row[ASSET_LIBRARY_COLS.Reel_Summary    - 1] || ''),
        Caption_Host:       String(row[ASSET_LIBRARY_COLS.Caption_Host       - 1] || ''),
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
      var prevScore = (prev.Caption_Host ? 2 : 0) + ((prev.Reel_Summary || prev.Reel_Transcript) ? 1 : 0);
      var currScore = (r.Caption_Host    ? 2 : 0) + ((r.Reel_Summary    || r.Reel_Transcript)    ? 1 : 0);
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
      summary    = String(data[i][ASSET_LIBRARY_COLS.Reel_Transcript - 1] || '').trim();
      episodeUid = String(data[i][ASSET_LIBRARY_COLS.Episode_UID  - 1] || '');
      rowNum     = i + 1;
      break;
    }
    if (rowNum === -1) return { ok: false, error: 'Reel not found: ' + assetId };
    if (!summary)     return { ok: false, error: 'Summary pending — try again later' };

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
function spawnReelEditTask(episodeUid, assetId, type, revisionNotes) {
  try {
    var sheetId = getMasterSheetId();
    var ss      = SpreadsheetApp.openById(sheetId);
    var alName  = getGovernance('ASSET_LIBRARY_TAB_NAME') || 'Asset_Library';
    var sheet   = ss.getSheetByName(alName);
    var displayName = assetId;
    var driveFileId = '';
    if (sheet) {
      var data = sheet.getDataRange().getValues();
      for (var i = 1; i < data.length; i++) {
        if (String(data[i][ASSET_LIBRARY_COLS.Asset_ID - 1]) !== String(assetId)) continue;
        displayName = String(data[i][ASSET_LIBRARY_COLS.Display_Name - 1] || assetId);
        driveFileId = String(data[i][ASSET_LIBRARY_COLS.Drive_File_ID - 1] || '');
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
      revisionNotes:    revisionNotes || '',
      assetId:          assetId,
      payloadLink:      driveFileId ? 'https://drive.google.com/file/d/' + driveFileId + '/view' : ''
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
function requestReelRevision(episodeUid, assetId, revisionNotes) {
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

    // Spawn Revise_Reels task for Audra with JT's fix text in Revision_Notes
    var result = spawnReelEditTask(episodeUid, assetId, 'request_revision', revisionNotes || '');
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
 * completes the Revise_Reels task. New file should already be in Reels/ root.
 * Reel card visibility is driven by Episode.Status (AD #93) — no task spawn needed.
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

    // Move old file to Reels/Superseded/ to keep root clean
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
 * Called when Audra taps Complete on a Revise_Reels card task.
 * Scans the episode's Reels/ folder for any file that is NOT the original reel
 * (identified by Drive_File_ID in Asset_Library). Expects exactly one new file.
 * Delegates swap + task completion to closeReelRevision().
 */
function completeReelRevision(episodeUid, assetId) {
  try {
    var stagingId = getStagingFolderIdByUid(episodeUid);
    if (!stagingId) return { ok: false, error: "Staging folder not found." };

    var stagingFolder = DriveApp.getFolderById(stagingId);
    var reelsFolderIt = stagingFolder.getFoldersByName("Reels");
    if (!reelsFolderIt.hasNext()) return { ok: false, error: "Reels/ folder not found." };
    var reelsFolder = reelsFolderIt.next();

    var sheetId = getMasterSheetId();
    var ss      = SpreadsheetApp.openById(sheetId);
    var alName  = getGovernance("ASSET_LIBRARY_TAB_NAME") || "Asset_Library";
    var alSheet = ss.getSheetByName(alName);
    if (!alSheet) return { ok: false, error: "Asset_Library not found." };

    var alData    = alSheet.getDataRange().getValues();
    var oldFileId = "";
    for (var i = 1; i < alData.length; i++) {
      if (String(alData[i][ASSET_LIBRARY_COLS.Asset_ID - 1]) !== String(assetId)) continue;
      oldFileId = String(alData[i][ASSET_LIBRARY_COLS.Drive_File_ID - 1] || "");
      break;
    }

    var allFiles = reelsFolder.getFiles();
    var newFiles = [];
    while (allFiles.hasNext()) {
      var f = allFiles.next();
      if (f.getId() !== oldFileId) newFiles.push(f);
    }

    if (newFiles.length === 0) return { ok: false, error: "No revised reel found in Reels/ root. Upload the v2 file there first." };
    if (newFiles.length > 1)   return { ok: false, error: "Multiple new reels found in Reels/ root. Leave only the v2 reel." };

    return closeReelRevision(episodeUid, assetId, newFiles[0].getId());
  } catch (err) {
    return { ok: false, error: err.message };
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

// ── SCHEDULE SURFACE ─────────────────────────────────────────

/**
 * Loads all data needed to render the Schedule surface in one round-trip.
 * Candidate pool: Asset_Library rows for this episode where Status='schedule'.
 * Week structure: Posting_Schedule (days, slots, why sentences).
 * Placements: Social_Assets rows for this episode (week + swipe).
 */
function getScheduleData(episodeUid) {
  try {
    var sheetId = getMasterSheetId();
    var ss      = SpreadsheetApp.openById(sheetId);

    // — Candidate pool (Status='schedule') —
    var alSheet    = ss.getSheetByName("Asset_Library");
    var candidates = [];
    if (alSheet) {
      var alData = alSheet.getDataRange().getValues();
      for (var i = 1; i < alData.length; i++) {
        var row = alData[i];
        if (String(row[ASSET_LIBRARY_COLS.Episode_UID - 1]) !== String(episodeUid)) continue;
        if (String(row[ASSET_LIBRARY_COLS.Status      - 1]).toLowerCase() !== 'schedule') continue;
        var fileId = String(row[ASSET_LIBRARY_COLS.Drive_File_ID - 1] || '');
        candidates.push({
          assetId:      String(row[ASSET_LIBRARY_COLS.Asset_ID      - 1]),
          assetType:    String(row[ASSET_LIBRARY_COLS.Asset_Type     - 1]),
          driveFileId:  fileId,
          displayName:  String(row[ASSET_LIBRARY_COLS.Display_Name  - 1] || ''),
          quoteText:    String(row[ASSET_LIBRARY_COLS.Quote_Text     - 1] || ''),
          reelSummary:  String(row[ASSET_LIBRARY_COLS.Reel_Summary - 1] || ''),
          captionHost:  String(row[ASSET_LIBRARY_COLS.Caption_Host   - 1] || ''),
          captionGuest: String(row[ASSET_LIBRARY_COLS.Caption_Guest  - 1] || ''),
          canvasState:  String(row[ASSET_LIBRARY_COLS.Canvas_State   - 1] || ''),
          backgroundId: String(row[ASSET_LIBRARY_COLS.Background_ID  - 1] || ''),
          availability: String(row[ASSET_LIBRARY_COLS.Availability   - 1]),
          thumbnailUrl: fileId ? 'https://drive.google.com/thumbnail?id=' + fileId + '&sz=w200' : ''
        });
      }
    }

    // — Social_Assets placement records for this episode —
    var saSheet    = ss.getSheetByName("Social_Assets");
    var placements = [];
    if (saSheet) {
      var saData = saSheet.getDataRange().getValues();
      for (var j = 1; j < saData.length; j++) {
        var saRow = saData[j];
        if (String(saRow[SOCIAL_ASSETS_COLS.Episode_UID - 1]) !== String(episodeUid)) continue;
        var slot = String(saRow[SOCIAL_ASSETS_COLS.Slot - 1]);
        if (!slot) continue;
        placements.push({
          postId:         String(saRow[SOCIAL_ASSETS_COLS.Post_ID          - 1]),
          assetLibraryId: String(saRow[SOCIAL_ASSETS_COLS.Asset_Library_ID - 1]),
          slot:           slot
        });
      }
    }

    // — Posting_Schedule week structure —
    var schedSheet = ss.getSheetByName("Posting_Schedule");
    var days       = [];
    if (schedSheet) {
      var schedData = schedSheet.getDataRange().getValues();
      var DAY_ORDER = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
      var dayMap    = {};
      DAY_ORDER.forEach(function(d) { dayMap[d] = []; });
      for (var k = 1; k < schedData.length; k++) {
        var s   = schedData[k];
        var sid = String(s[POSTING_SCHEDULE_COLS.Slot_ID - 1]);
        var day = String(s[POSTING_SCHEDULE_COLS.Day    - 1]);
        if (!sid || !day || !dayMap[day]) continue;
        dayMap[day].push({
          slotId:    sid,
          assetType: String(s[POSTING_SCHEDULE_COLS.Asset_Type - 1]),
          platform:  String(s[POSTING_SCHEDULE_COLS.Platform   - 1]),
          why:       String(s[POSTING_SCHEDULE_COLS.Why        - 1]),
          sortOrder: Number(s[POSTING_SCHEDULE_COLS.Sort_Order - 1]) || 0
        });
      }
      days = DAY_ORDER
        .filter(function(d) { return dayMap[d].length > 0; })
        .map(function(d) {
          var slots = dayMap[d].slice().sort(function(a, b) { return a.sortOrder - b.sortOrder; });
          var why   = slots[0] ? slots[0].why : '';
          return { day: d, why: why, slots: slots };
        });
    }

    return { candidates: candidates, placements: placements, days: days };
  } catch (err) {
    return { candidates: [], placements: [], days: [], error: err.message };
  }
}

/**
 * Places an asset into a Schedule slot (week or swipe).
 * Week slot: creates SA row + sets AL.Availability='placed'.
 * Swipe slot ('SWIPE'): creates SA row only (Availability is week-only; unchanged).
 */
function placeAssetSchedule(episodeUid, assetId, slotId, caption) {
  try {
    var sheetId = getMasterSheetId();
    var ss      = SpreadsheetApp.openById(sheetId);

    var saSheet = ss.getSheetByName("Social_Assets");
    if (!saSheet) return { success: false, error: "Social_Assets tab not found" };

    var postId = "SA-" + assetId + "-" + slotId + "-" + Date.now();
    var saRow  = new Array(Object.keys(SOCIAL_ASSETS_COLS).length).fill("");
    saRow[SOCIAL_ASSETS_COLS.Post_ID          - 1] = postId;
    saRow[SOCIAL_ASSETS_COLS.Asset_Library_ID - 1] = assetId;
    saRow[SOCIAL_ASSETS_COLS.Episode_UID      - 1] = episodeUid;
    saRow[SOCIAL_ASSETS_COLS.Slot             - 1] = slotId;
    saRow[SOCIAL_ASSETS_COLS.Caption          - 1] = caption || "";
    saRow[SOCIAL_ASSETS_COLS.Scheduled_At     - 1] = new Date();
    saRow[SOCIAL_ASSETS_COLS.Created_At       - 1] = new Date();
    saRow[SOCIAL_ASSETS_COLS.Created_By       - 1] = Session.getEffectiveUser().getEmail();
    saSheet.appendRow(saRow);

    if (slotId !== 'SWIPE') {
      var alSheet = ss.getSheetByName("Asset_Library");
      if (alSheet) {
        var alData = alSheet.getDataRange().getValues();
        for (var i = 1; i < alData.length; i++) {
          if (String(alData[i][ASSET_LIBRARY_COLS.Asset_ID - 1]) !== String(assetId)) continue;
          alSheet.getRange(i + 1, ASSET_LIBRARY_COLS.Availability).setValue("placed");
          break;
        }
      }
    }

    bumpVersion("social_assets", "placeAssetSchedule");
    return { success: true, postId: postId };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Removes an asset from a Schedule slot.
 * Deletes the SA row matching assetId + slotId + episodeUid.
 * Week slot: flips AL.Availability back to 'available'.
 * Swipe slot: no Availability change.
 *
 * PROPOSED RULE (Audra confirm): on week-slot removal, always flip to 'available'.
 * Rationale: Availability is week-only; one asset should not normally occupy two
 * week-slots (sink+badge discourages it); binary flag reads as "currently in the week."
 */
function removeAssetFromSchedule(episodeUid, assetId, slotId) {
  try {
    var sheetId = getMasterSheetId();
    var ss      = SpreadsheetApp.openById(sheetId);

    var saSheet = ss.getSheetByName("Social_Assets");
    if (saSheet) {
      var saData = saSheet.getDataRange().getValues();
      for (var i = saData.length - 1; i >= 1; i--) {
        if (String(saData[i][SOCIAL_ASSETS_COLS.Asset_Library_ID - 1]) !== String(assetId))   continue;
        if (String(saData[i][SOCIAL_ASSETS_COLS.Slot             - 1]) !== String(slotId))    continue;
        if (String(saData[i][SOCIAL_ASSETS_COLS.Episode_UID      - 1]) !== String(episodeUid)) continue;
        saSheet.deleteRow(i + 1);
        break;
      }
    }

    if (slotId !== 'SWIPE') {
      var alSheet = ss.getSheetByName("Asset_Library");
      if (alSheet) {
        var alData = alSheet.getDataRange().getValues();
        for (var j = 1; j < alData.length; j++) {
          if (String(alData[j][ASSET_LIBRARY_COLS.Asset_ID - 1]) !== String(assetId)) continue;
          alSheet.getRange(j + 1, ASSET_LIBRARY_COLS.Availability).setValue("available");
          break;
        }
      }
    }

    bumpVersion("social_assets", "removeAssetFromSchedule");
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Assembles the Export All package in Manual_Exports/[Day]/ + /SWIPE/ inside the episode staging folder.
 * Gate: Availability = placed on the Asset_Library row.
 * Re-run: day/SWIPE folders cleared and rebuilt each run; Manual_Exports/Singles/ left untouched.
 * QG images: written from client-rendered base64 (imageRenders map).
 * Reels: Drive file COPIED into day/SWIPE folder (archive copy stays in Reels/).
 * Structure: Manual_Exports/[Day]/ + /SWIPE/ — episode-scoped by staging location; no guest wrapper.
 * @param {string} episodeUid
 * @param {Object} imageRenders  — { [assetId]: base64Png } for placed QG assets (no data: prefix)
 * @returns {{ success: boolean, folderUrl?: string, summary?: object, error?: string }}
 */
function exportAllSchedule(episodeUid, imageRenders) {
  imageRenders = imageRenders || {};
  try {
    var ss = SpreadsheetApp.openById(getMasterSheetId());

    // Staging → Manual_Exports root (create lazily)
    var stagingId = getStagingFolderIdByUid(episodeUid);
    if (!stagingId) return { success: false, error: 'Staging folder not found for: ' + episodeUid };
    var stagingFolder = DriveApp.getFolderById(stagingId);
    var exportIt      = stagingFolder.getFoldersByName('Manual_Exports');
    var exportRoot    = exportIt.hasNext() ? exportIt.next() : stagingFolder.createFolder('Manual_Exports');

    // Clear-and-rebuild: trash existing day/SWIPE folders (Singles/ left intact)
    var DAY_ORDER = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    DAY_ORDER.forEach(function(d) {
      var it = exportRoot.getFoldersByName(d);
      if (it.hasNext()) it.next().setTrashed(true);
    });
    var swipeIt = exportRoot.getFoldersByName('SWIPE');
    if (swipeIt.hasNext()) swipeIt.next().setTrashed(true);

    // Build AL map: placed assets for this episode only
    var alSheet = ss.getSheetByName('Asset_Library');
    var alMap   = {};
    if (alSheet) {
      var alRows = alSheet.getDataRange().getValues();
      for (var a = 1; a < alRows.length; a++) {
        var alRow = alRows[a];
        if (String(alRow[ASSET_LIBRARY_COLS.Episode_UID  - 1]) !== String(episodeUid)) continue;
        if (String(alRow[ASSET_LIBRARY_COLS.Availability - 1]).toLowerCase() !== 'placed') continue;
        var aid = String(alRow[ASSET_LIBRARY_COLS.Asset_ID - 1]);
        alMap[aid] = {
          assetType:    String(alRow[ASSET_LIBRARY_COLS.Asset_Type    - 1]),
          driveFileId:  String(alRow[ASSET_LIBRARY_COLS.Drive_File_ID - 1] || ''),
          displayName:  String(alRow[ASSET_LIBRARY_COLS.Display_Name  - 1] || ''),
          captionHost:  String(alRow[ASSET_LIBRARY_COLS.Caption_Host  - 1] || ''),
          captionGuest: String(alRow[ASSET_LIBRARY_COLS.Caption_Guest - 1] || '')
        };
      }
    }

    // Partition Social_Assets placements into day-slots vs. SWIPE (skip if AL row not placed)
    var saSheet = ss.getSheetByName('Social_Assets');
    if (!saSheet) return { success: false, error: 'Social_Assets tab not found' };
    var saRows        = saSheet.getDataRange().getValues();
    var dayPlacements = {};
    var swipePlacements = [];

    for (var s = 1; s < saRows.length; s++) {
      var sr   = saRows[s];
      if (String(sr[SOCIAL_ASSETS_COLS.Episode_UID - 1]) !== String(episodeUid)) continue;
      var slot = String(sr[SOCIAL_ASSETS_COLS.Slot             - 1] || '');
      var alId = String(sr[SOCIAL_ASSETS_COLS.Asset_Library_ID - 1] || '');
      if (!slot || !alId || !alMap[alId]) continue;

      if (slot === 'SWIPE') {
        swipePlacements.push(alId);
      } else {
        var day = slot.split('-')[0].toUpperCase();
        if (!dayPlacements[day]) dayPlacements[day] = [];
        dayPlacements[day].push(alId);
      }
    }

    var imageCount   = 0;
    var reelCount    = 0;
    var missingCount = 0;

    DAY_ORDER.forEach(function(day) {
      var ids = dayPlacements[day];
      if (!ids || ids.length === 0) return;
      var dayFolder = exportRoot.createFolder(day);
      ids.forEach(function(alId) {
        var al = alMap[alId];
        if (!al) { missingCount++; return; }
        _writeAssetToExportFolder(al, dayFolder, false, imageRenders[alId] || null);
        if (al.assetType.toLowerCase() === 'reel') reelCount++; else imageCount++;
      });
    });

    if (swipePlacements.length > 0) {
      var swipeFolder = exportRoot.createFolder('SWIPE');
      swipePlacements.forEach(function(alId) {
        var al = alMap[alId];
        if (!al) { missingCount++; return; }
        _writeAssetToExportFolder(al, swipeFolder, true, imageRenders[alId] || null);
        if (al.assetType.toLowerCase() === 'reel') reelCount++; else imageCount++;
      });
    }

    return {
      success:   true,
      folderUrl: 'https://drive.google.com/drive/folders/' + exportRoot.getId(),
      summary:   {
        days:    Object.keys(dayPlacements).filter(function(d) { return dayPlacements[d].length > 0; }).length,
        swipe:   swipePlacements.length,
        images:  imageCount,
        reels:   reelCount,
        missing: missingCount
      }
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Writes one asset into an export folder.
 * QG: writes PNG from base64Png + matching .txt (Caption_Host).
 * Reel: COPIES the Drive file (archive stays in Reels/) + matching .txt.
 * Caption variant: captionHost for day folders, captionGuest (fallback: host) for SWIPE.
 * @param {object}      al       — AL record { assetType, driveFileId, displayName, captionHost, captionGuest }
 * @param {Folder}      folder   — target Drive folder
 * @param {boolean}     isSwipe  — true for SWIPE folder (selects guest caption)
 * @param {string|null} base64Png — client-rendered PNG bytes (QG only); null for reels
 */
function _writeAssetToExportFolder(al, folder, isSwipe, base64Png) {
  var baseName = _safeFilename(al.displayName) || 'asset';
  var isReel   = al.assetType.toLowerCase() === 'reel';
  var caption  = isSwipe
    ? (al.captionGuest || al.captionHost || '')
    : (al.captionHost || '');

  if (isReel) {
    if (al.driveFileId) {
      try {
        var reelFile  = DriveApp.getFileById(al.driveFileId);
        var ext       = reelFile.getName().split('.').pop() || 'mp4';
        var reelName  = _uniqueFilename(folder, baseName, ext);
        var noExt     = reelName.substring(0, reelName.length - ext.length - 1);
        reelFile.makeCopy(reelName, folder);
        var txtBody = [al.displayName, caption].filter(Boolean).join('\n\n');
        folder.createFile(Utilities.newBlob(txtBody, 'text/plain', _uniqueFilename(folder, noExt, 'txt')));
        return;
      } catch (copyErr) {
        folder.createFile(Utilities.newBlob('[Reel file not found: ' + al.driveFileId + ']', 'text/plain', baseName + '.copy-error.txt'));
      }
    }
    var txtBody = [al.displayName, caption].filter(Boolean).join('\n\n');
    folder.createFile(Utilities.newBlob(txtBody, 'text/plain', _uniqueFilename(folder, baseName, 'txt')));
  } else {
    var imgName = _uniqueFilename(folder, baseName, 'png');
    var noExt   = imgName.substring(0, imgName.length - 4);
    if (base64Png) {
      folder.createFile(Utilities.newBlob(Utilities.base64Decode(base64Png), 'image/png', imgName));
    } else {
      folder.createFile(Utilities.newBlob('[Image render missing for: ' + baseName + ']', 'text/plain', baseName + '.png.missing.txt'));
    }
    folder.createFile(Utilities.newBlob(caption, 'text/plain', _uniqueFilename(folder, noExt, 'txt')));
  }
}

/**
 * Returns a filename that does not collide with existing files in folder.
 * If baseName.ext is taken, tries baseName-2.ext, baseName-3.ext, etc.
 * Used at export time so reel Save-a-Copy (same Drive_File_ID, different caption) never
 * overwrites a sibling export that shares the same title slug.
 * @param {GoogleAppsScript.Drive.Folder} folder
 * @param {string} baseName  - no extension
 * @param {string} ext       - without leading dot
 * @returns {string}         - collision-free full filename (baseName[suffix].ext)
 */
function _uniqueFilename(folder, baseName, ext) {
  var candidate = baseName + '.' + ext;
  if (!folder.getFilesByName(candidate).hasNext()) return candidate;
  var n = 2;
  while (true) {
    candidate = baseName + '-' + n + '.' + ext;
    if (!folder.getFilesByName(candidate).hasNext()) return candidate;
    n++;
  }
}

/**
 * Strips filesystem-invalid characters from a name and trims to 120 chars.
 */
function _safeFilename(name) {
  if (!name) return '';
  return String(name).replace(/[\\/:*?"<>|#%&{}]/g, '').replace(/\s+/g, ' ').trim().substring(0, 120);
}

// ── EPISODE ARRANGE ──────────────────────────────────────────────────────────

/**
 * Full-rewrite save of the episode schedule.
 * orderedEuids: ordered array of future episode UIDs (in_production/review/ready_to_release).
 * Computes next-Tuesday base, assigns dates by position, clears dates for
 * non-live/non-archived episodes not in the list (drag-back to TBD).
 */
function saveArrangeOrder(orderedEuids) {
  try {
    if (!Array.isArray(orderedEuids)) return { ok: false, error: 'orderedEuids must be an array' };
    var sheetId = getMasterSheetId();
    var ss      = SpreadsheetApp.openById(sheetId);
    var sheet   = ss.getSheetByName('Episodes');
    if (!sheet) return { ok: false, error: 'Episodes tab not found' };

    var data    = sheet.getDataRange().getValues();
    var headers = data[0];
    var uidIdx  = headers.indexOf('Episode_UID');
    var rdIdx   = headers.indexOf('Release_Date');
    var statIdx = headers.indexOf('Status');
    if (uidIdx === -1 || rdIdx === -1 || statIdx === -1) {
      return { ok: false, error: 'Required columns missing from Episodes tab' };
    }

    var base     = _nextTuesdayBase_();
    var orderMap = {};
    orderedEuids.forEach(function(uid, i) { orderMap[String(uid)] = i; });

    for (var i = 1; i < data.length; i++) {
      var uid    = String(data[i][uidIdx]);
      var status = String(data[i][statIdx]);
      if (status === 'live' || status === 'archived') continue; // fixed — never touched

      if (orderMap.hasOwnProperty(uid)) {
        var pos  = orderMap[uid];
        var date = new Date(base.getTime());
        date.setDate(date.getDate() + pos * 7);
        sheet.getRange(i + 1, rdIdx + 1).setValue(date);
      } else {
        sheet.getRange(i + 1, rdIdx + 1).setValue(''); // drag-back → TBD
      }
    }

    bumpVersion('episodes', 'saveArrangeOrder');
    logToAuditTrail('Arrange', 'state_change', '', '',
      '[INFO] Episode schedule saved: ' + orderedEuids.length + ' episodes arranged.', 'INFO');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Returns next Tuesday on or after today (client and server use the same rule).
 * If today IS Tuesday, base = today.
 */
function _nextTuesdayBase_() {
  var d = new Date();
  d.setHours(0, 0, 0, 0);
  var day      = d.getDay(); // 0=Sun, 2=Tue
  var daysUntil = (2 - day + 7) % 7;
  d.setDate(d.getDate() + daysUntil);
  return d;
}

// ── CARD EDIT MODE ────────────────────────────────────────────────────────────

/**
 * Updates the Guest_Name field on a single episode row.
 */
function updateEpisodeName(episodeUid, newName) {
  try {
    var sheetId = getMasterSheetId();
    var ss      = SpreadsheetApp.openById(sheetId);
    var sheet   = ss.getSheetByName('Episodes');
    if (!sheet) return { ok: false, error: 'Episodes tab not found' };
    var data    = sheet.getDataRange().getValues();
    var headers = data[0];
    var uidIdx  = headers.indexOf('Episode_UID');
    var nameIdx = headers.indexOf('Guest_Name');
    if (uidIdx === -1 || nameIdx === -1) return { ok: false, error: 'Required columns missing' };
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][uidIdx]) !== String(episodeUid)) continue;
      sheet.getRange(i + 1, nameIdx + 1).setValue(String(newName || '').trim());
      bumpVersion('episodes', 'updateEpisodeName');
      return { ok: true };
    }
    return { ok: false, error: 'Episode not found' };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Returns completed tasks for a given episode — for the un-complete affordance
 * in the card edit mode. Excludes open/in_progress (those are in state.tasks).
 */
function getEpisodeCompletedTasks(episodeUid) {
  try {
    var sheetId = getMasterSheetId();
    var ss      = SpreadsheetApp.openById(sheetId);
    var sheet   = ss.getSheetByName('Tasks');
    if (!sheet) return [];
    var data    = sheet.getDataRange().getValues();
    var headers = data[0];
    var epIdx   = headers.indexOf('Episode_UID');
    var statIdx = headers.indexOf('Status');
    var wsIdx   = headers.indexOf('Workflow_Step');
    var titIdx  = headers.indexOf('Action_Title');
    var idIdx   = headers.indexOf('Task_ID');
    if (epIdx === -1 || statIdx === -1) return [];

    var SKIP_STEPS = ['Recording_Reminder', 'Release_Reminder', 'Runway', 'Release_Day'];
    var tasks = [];
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][epIdx]) !== String(episodeUid)) continue;
      if (String(data[i][statIdx]) !== 'complete')       continue;
      var ws = String(data[i][wsIdx] || '');
      if (SKIP_STEPS.indexOf(ws) !== -1)                 continue; // demoted cues — skip
      tasks.push({
        _rowIndex:     i + 1,
        Task_ID:       data[i][idIdx],
        Action_Title:  data[i][titIdx],
        Workflow_Step: ws
      });
    }
    return tasks;
  } catch (e) {
    return [];
  }
}

/**
 * Flips a completed task back to open. Human-reversible; no system cascade.
 */
function uncompleteTask(rowIndex) {
  try {
    var sheetId = getMasterSheetId();
    var ss      = SpreadsheetApp.openById(sheetId);
    var sheet   = ss.getSheetByName('Tasks');
    if (!sheet) return { ok: false, error: 'Tasks tab not found' };
    sheet.getRange(rowIndex, TASKS_COLS.Status).setValue('open');
    sheet.getRange(rowIndex, TASKS_COLS.Completed_At).setValue('');
    bumpVersion('tasks', 'uncompleteTask');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
