
/**
 * DWYP Operations Platform — Clerk Fairy
 * File: clerk_fairy.gs
 * Version: 1.0 | March 2026
 *
 * Clerk owns doPost() exclusively. It receives incoming webhook payloads
 * from AppSheet, reads the 'type' field, and dispatches to the correct fairy.
 * No business logic lives here — Clerk only routes.
 *
 * Routes:
 *   type: "filing"  → runFilingFairy(episodeUid)
 *   type: "invite"  → scribeLetSchedule(contactId, episodeUid)
 *
 * Expected payload shape (JSON body):
 *   { "type": "filing", "episodeUid": "EP-250321-1400" }
 *   { "type": "invite", "contactId": "uuid", "episodeUid": "EP-250321-1400" }
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

  var type = payload.type;
  var episodeUid = payload.episodeUid || null;
  var contactId = payload.contactId || null;

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

  } else {
    // ── Unknown route ─────────────────────────────────────────
    logToAuditTrail(actor, "error", episodeUid, contactId,
      "Clerk received unknown payload type: " + type, "error");
    return ContentService
      .createTextOutput(JSON.stringify({ status: "error", message: "Unknown route type: " + type }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}



