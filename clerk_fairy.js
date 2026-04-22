
/**
 * DWYP Operations Platform — Clerk Fairy
 * File: clerk_fairy.gs
 * Version: 1.1 | April 2026
 *
 * Clerk owns doPost() exclusively. It receives incoming webhook payloads
 * from AppSheet and Frame.io, reads the 'type' field, and dispatches to
 * the correct fairy or executes the correct write. No business logic lives
 * here — Clerk only routes.
 *
 * Routes:
 *   type: "filing"                → runFilingFairy(episodeUid)
 *   type: "invite"                → scribeLetSchedule(contactId, episodeUid)
 *   type: "frameio_video_ready"   → spawn Review_Episode task + write Video_Status = "ready"
 *   type: "frameio_video_approved"→ write Video_Status = "approved"
 *
 * Expected payload shapes (JSON body):
 *   { "type": "filing", "episodeUid": "EP-250321-1400" }
 *   { "type": "invite", "contactId": "uuid", "episodeUid": "EP-250321-1400" }
 *   { "type": "frameio_video_ready",    "project_name": "DWYP - Jane Smith - EP-250321-1400", "review_link": "https://..." }
 *   { "type": "frameio_video_approved", "project_name": "DWYP - Jane Smith - EP-250321-1400" }
 *
 * Frame.io project name format: DWYP - [Guest Name] - [Episode_UID]
 * Episode_UID is the last segment after the final ' - ' separator.
 *
 * AppSheet webhook action configuration:
 *   - Action type: Webhook
 *   - Method: POST
 *   - Body: JSON (as above)
 *   - URL: this deployed Apps Script web app URL
 *
 * Dependencies:
 *   runFilingFairy()     — filing_fairy.gs
 *   scribeLetSchedule()  — scribe_fairy.gs
 *   logToAuditTrail()    — fairy_circle.gs
 *   getAssigneeByRole()  — fairy_circle.gs
 *   spawnTask()          — fairy_circle.gs
 *   patchEpisodes()      — fairy_circle.gs
 *   getEpisodeRow()      — fairy_circle.gs
 */

function doPost(e) {
  var actor = "clerk_fairy:doPost";
  var payload;

  // ── Parse payload ───────────────────────────────────────────
  try {
    payload = JSON.parse(e.postData.contents);
  } catch (err) {
    logToAuditTrail(actor, "error", null, null,
      "Clerk received unparseable payload: " + err.message, "error");
    return ContentService
      .createTextOutput(JSON.stringify({ status: "error", message: "Invalid JSON payload." }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  var type      = payload.type;
  var episodeUid = payload.episodeUid || null;
  var contactId  = payload.contactId  || null;

  // ── Route ───────────────────────────────────────────────────
  if (type === "filing") {
    if (!episodeUid) {
      logToAuditTrail(actor, "error", null, null,
        "Clerk received 'filing' payload with no episodeUid.", "error");
      return ContentService
        .createTextOutput(JSON.stringify({ status: "error", message: "Missing episodeUid for filing route." }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    logToAuditTrail(actor, "state_change", episodeUid, null,
      "Clerk dispatching to runFilingFairy for episode: " + episodeUid, "info");

    try {
      runFilingFairy(episodeUid);
    } catch (err) {
      logToAuditTrail(actor, "error", episodeUid, null,
        "runFilingFairy threw after Clerk dispatch: " + err.message, "error");
      return ContentService
        .createTextOutput(JSON.stringify({ status: "error", message: "Filing Fairy failed: " + err.message }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService
      .createTextOutput(JSON.stringify({ status: "ok", route: "filing", episodeUid: episodeUid }))
      .setMimeType(ContentService.MimeType.JSON);

  } else if (type === "invite") {
    if (!contactId || !episodeUid) {
      logToAuditTrail(actor, "error", episodeUid, contactId,
        "Clerk received 'invite' payload missing contactId or episodeUid.", "error");
      return ContentService
        .createTextOutput(JSON.stringify({ status: "error", message: "Missing contactId or episodeUid for invite route." }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    logToAuditTrail(actor, "state_change", episodeUid, contactId,
      "Clerk dispatching to scribeLetSchedule for contact: " + contactId, "info");

    try {
      scribeLetSchedule(contactId, episodeUid);
    } catch (err) {
      logToAuditTrail(actor, "error", episodeUid, contactId,
        "scribeLetSchedule threw after Clerk dispatch: " + err.message, "error");
      return ContentService
        .createTextOutput(JSON.stringify({ status: "error", message: "Scribe Let's Schedule failed: " + err.message }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService
      .createTextOutput(JSON.stringify({ status: "ok", route: "invite", contactId: contactId, episodeUid: episodeUid }))
      .setMimeType(ContentService.MimeType.JSON);

  } else if (type === "frameio_video_ready") {
    // ── Frame.io: video ready ────────────────────────────────
    var projectName = payload.project_name || "";
    var parsedUid   = parseEpisodeUidFromProjectName(projectName);

    if (!parsedUid) {
      logToAuditTrail(actor, "error", null, null,
        "[ERROR] Clerk frameio_video_ready: could not parse Episode_UID from project name: \"" + projectName + "\"", "error");
      return ContentService
        .createTextOutput(JSON.stringify({ status: "error", message: "Could not parse Episode_UID from Frame.io project name." }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    var episodeRow = getEpisodeRow(parsedUid);
    if (!episodeRow) {
      logToAuditTrail(actor, "error", parsedUid, null,
        "[ERROR] Clerk frameio_video_ready: episode not found in Episodes tab for UID: " + parsedUid, "error");
      return ContentService
        .createTextOutput(JSON.stringify({ status: "error", message: "Episode not found for UID: " + parsedUid }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    var reviewLink  = payload.review_link || "";
    var guestName   = episodeRow.Guest_Name || parsedUid;
    var epContactId = episodeRow.Contact_ID || "";

    logToAuditTrail(actor, "state_change", parsedUid, epContactId,
      "[INFO] Clerk frameio_video_ready: spawning Review_Episode task for " + guestName, "info");

    // Action 1: Spawn Review_Episode task
    try {
      spawnTask({
        actionTitle:      "Review episode: " + guestName,
        assignee:         getAssigneeByRole("host"),
        assignedBy:       "The Fairy Team",
        status:           "open",
        priority:         "normal",
        contactId:        epContactId,
        episodeUid:       parsedUid,
        workflowStep:     "Review_Episode",
        payloadLink:      reviewLink,
        executiveSummary: "The finished episode for " + guestName + " is ready for your review. Open the review link to view the video."
      });
    } catch (err) {
      logToAuditTrail(actor, "error", parsedUid, epContactId,
        "[ERROR] Clerk frameio_video_ready: spawnTask threw: " + err.message, "error");
      return ContentService
        .createTextOutput(JSON.stringify({ status: "error", message: "Review_Episode task spawn failed: " + err.message }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // Action 2: Write Video_Status = "ready" to Episodes tab
    try {
      patchEpisodes(parsedUid, { Video_Status: "ready" });
    } catch (err) {
      logToAuditTrail(actor, "error", parsedUid, epContactId,
        "[ERROR] Clerk frameio_video_ready: patchEpisodes threw: " + err.message, "error");
      return ContentService
        .createTextOutput(JSON.stringify({ status: "error", message: "Video_Status patch failed: " + err.message }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    logToAuditTrail(actor, "state_change", parsedUid, epContactId,
      "[INFO] Clerk frameio_video_ready: complete. Video_Status set to ready, Review_Episode task spawned.", "info");

    return ContentService
      .createTextOutput(JSON.stringify({ status: "ok", route: "frameio_video_ready", episodeUid: parsedUid }))
      .setMimeType(ContentService.MimeType.JSON);

  } else if (type === "frameio_video_approved") {
    // ── Frame.io: video approved ─────────────────────────────
    var approvedProjectName = payload.project_name || "";
    var approvedUid         = parseEpisodeUidFromProjectName(approvedProjectName);

    if (!approvedUid) {
      logToAuditTrail(actor, "error", null, null,
        "[ERROR] Clerk frameio_video_approved: could not parse Episode_UID from project name: \"" + approvedProjectName + "\"", "error");
      return ContentService
        .createTextOutput(JSON.stringify({ status: "error", message: "Could not parse Episode_UID from Frame.io project name." }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    var approvedRow = getEpisodeRow(approvedUid);
    if (!approvedRow) {
      logToAuditTrail(actor, "error", approvedUid, null,
        "[ERROR] Clerk frameio_video_approved: episode not found in Episodes tab for UID: " + approvedUid, "error");
      return ContentService
        .createTextOutput(JSON.stringify({ status: "error", message: "Episode not found for UID: " + approvedUid }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    var approvedContactId = approvedRow.Contact_ID || "";

    logToAuditTrail(actor, "state_change", approvedUid, approvedContactId,
      "[INFO] Clerk frameio_video_approved: writing Video_Status = approved for episode: " + approvedUid, "info");

    // Write Video_Status = "approved" to Episodes tab
    try {
      patchEpisodes(approvedUid, { Video_Status: "approved" });
    } catch (err) {
      logToAuditTrail(actor, "error", approvedUid, approvedContactId,
        "[ERROR] Clerk frameio_video_approved: patchEpisodes threw: " + err.message, "error");
      return ContentService
        .createTextOutput(JSON.stringify({ status: "error", message: "Video_Status patch failed: " + err.message }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    logToAuditTrail(actor, "state_change", approvedUid, approvedContactId,
      "[INFO] Clerk frameio_video_approved: complete. Video_Status set to approved.", "info");

    return ContentService
      .createTextOutput(JSON.stringify({ status: "ok", route: "frameio_video_approved", episodeUid: approvedUid }))
      .setMimeType(ContentService.MimeType.JSON);

  } else {
    // ── Unknown route ─────────────────────────────────────────
    logToAuditTrail(actor, "error", episodeUid, contactId,
      "Clerk received unknown payload type: " + type, "error");
    return ContentService
      .createTextOutput(JSON.stringify({ status: "error", message: "Unknown route type: " + type }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}


/**
 * Parses the Episode_UID from a Frame.io project name.
 * Expected format: DWYP - [Guest Name] - [Episode_UID]
 * Episode_UID is the last segment after the final ' - ' separator.
 * Returns null if the name cannot be parsed or the extracted segment
 * does not begin with "EP-".
 *
 * @param {string} projectName - The Frame.io project name.
 * @returns {string|null} Episode_UID (e.g. "EP-250321-1400"), or null on failure.
 */
function parseEpisodeUidFromProjectName(projectName) {
  if (!projectName || typeof projectName !== "string") return null;

  var segments = projectName.split(" - ");
  if (segments.length < 3) return null;

  var candidate = segments[segments.length - 1].trim();
  if (!candidate || candidate.indexOf("EP-") !== 0) return null;

  return candidate;
}
