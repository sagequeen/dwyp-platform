/**
 * DWYP Operations Platform — Scribe Fairy
 * File: scribe_fairy.gs
 * Version: 1.2 | March 2026
 *
 * Scribe is a cross-cutting concern, not a pipeline stage.
 * It fires at five defined touchpoints to draft guest-facing emails.
 * All email copy lives in the Master Template — no prose is hardcoded here.
 *
 * Entry points (called externally — no doPost in this file):
 *   scribeLetSchedule(contactId, episodeUid)    — T1: called by clerk_fairy on 'invite' payload
 *   scribeConfirmTech(contactId, episodeUid)    — T2: called by secretary_fairy after calendar event
 *   scribeGreatInterview(contactId, episodeUid) — T3: called by Daily Pulse on raw asset upload
 *   scribeReviewEpisode(contactId, episodeUid)  — T4: called by Daily Pulse on finished episode file
 *   scribeWereLive(contactId, episodeUid)       — T5: called by Daily Pulse on release date
 *
 * Template sections must exist in Master Template for each touchpoint.
 * If a section is missing, a fallback generic draft is created and a task
 * is spawned for Audra to review before the draft is sent.
 *
 * Dependencies (all from fairy_circle):
 *   getGovernance(), resolveEmailByContactId(), resolveDisplayNameByContactId(),
 *   scribeWriteAndDraft(), spawnTask(), logToAuditTrail()
 */


// ============================================================
// TOUCHPOINT 1 — LET'S SCHEDULE
// Trigger: AppSheet "Invite to Podcast" action → clerk_fairy → here
// ============================================================

function scribeLetSchedule(contactId, episodeUid) {
  var actor = "scribe_fairy:scribeLetSchedule";

  try {
    var guestEmail = resolveEmailByContactId(contactId);
    if (!guestEmail) {
      logToAuditTrail(actor, "error", episodeUid, contactId,
        "Cannot draft Let's Schedule — no email on contact record.", "warn");
      return;
    }

    var guestName = resolveDisplayNameByContactId(contactId, actor) || contactId;
    var hostName = getGovernance("HOST_NAME") || "JT";

    var templateText = extractPrompt(getGovernance("SCRIBE_LETS_SCHEDULE_KEY"));
    var contentPrompt;
    if (!templateText) {
      contentPrompt = "FALLBACK: Master Template section missing. Draft a generic warm, brief email inviting the guest to schedule their podcast recording. Mark the email clearly as a generic placeholder that needs review before sending.";
      spawnTask({
        actionTitle:      "Scribe template missing — Let's Schedule — " + guestName + " (" + episodeUid + ")",
        priority:         "urgent",
        assignee:         getAssigneeByRole("producer"),
        assignedBy:       "The Fairy Team",
        status:           "open",
        contactId:        contactId,
        episodeUid:       episodeUid,
        executiveSummary: "The Master Template section for the Let's Schedule email was missing. A generic draft was created. Review the draft and update the Master Template section before this touchpoint fires again."
      });
      logToAuditTrail(actor, "error", episodeUid, contactId,
        "Let's Schedule template section missing — falling back to generic draft.", "warn");
    }

    scribeWriteAndDraft({
      to: guestEmail,
      phase: "Phase1_TechCheck",
      episodeUid: episodeUid,
      guestName: guestName,
      hostName: hostName,
      contentPrompt: contentPrompt || null
    });

    logToAuditTrail(actor, "state_change", episodeUid, contactId,
      "Let's Schedule email draft created for contact: " + contactId, "info");

  } catch (err) {
    logToAuditTrail(actor, "error", episodeUid, contactId,
      "scribeLetSchedule failed: " + err.message, "error");
  }
}


// ============================================================
// TOUCHPOINT 2 — CONFIRM AND TECH CHECK
// Trigger: secretary_fairy after calendar event detected and episode record created
// ============================================================

function scribeConfirmTech(contactId, episodeUid) {
  var actor = "scribe_fairy:scribeConfirmTech";

  try {
    var guestEmail = resolveEmailByContactId(contactId);
    if (!guestEmail) {
      logToAuditTrail(actor, "error", episodeUid, contactId,
        "Cannot draft Confirm and Tech — no email on contact record.", "warn");
      return;
    }

    var guestName = resolveDisplayNameByContactId(contactId, actor) || contactId;
    var hostName = getGovernance("HOST_NAME") || "JT";

    var templateText = extractPrompt(getGovernance("SCRIBE_CONFIRM_TECH_KEY"));
    var contentPrompt;
    if (!templateText) {
      contentPrompt = "FALLBACK: Master Template section missing. Draft a generic confirmation email for the guest with recording date details and a tech check reminder. Mark the email clearly as a generic placeholder that needs review before sending.";
      spawnTask({
        actionTitle:      "Scribe template missing — Confirm and Tech — " + guestName + " (" + episodeUid + ")",
        priority:         "urgent",
        assignee:         getAssigneeByRole("producer"),
        assignedBy:       "The Fairy Team",
        status:           "open",
        contactId:        contactId,
        episodeUid:       episodeUid,
        executiveSummary: "The Master Template section for the Confirm and Tech email was missing. A generic draft was created. Review the draft and update the Master Template section before this touchpoint fires again."
      });
      logToAuditTrail(actor, "error", episodeUid, contactId,
        "Confirm and Tech template section missing — falling back to generic draft.", "warn");
    }

    scribeWriteAndDraft({
      to: guestEmail,
      phase: "Phase1_Confirmation",
      episodeUid: episodeUid,
      guestName: guestName,
      hostName: hostName,
      contentPrompt: contentPrompt || null
    });

    logToAuditTrail(actor, "state_change", episodeUid, contactId,
      "Confirm and Tech email draft created for contact: " + contactId, "info");

  } catch (err) {
    logToAuditTrail(actor, "error", episodeUid, contactId,
      "scribeConfirmTech failed: " + err.message, "error");
  }
}


// ============================================================
// TOUCHPOINT 3 — GREAT INTERVIEW
// Trigger: Daily Pulse detects raw asset upload in episode Raw folder
// ============================================================

function scribeGreatInterview(contactId, episodeUid) {
  var actor = "scribe_fairy:scribeGreatInterview";

  try {
    var guestEmail = resolveEmailByContactId(contactId);
    if (!guestEmail) {
      logToAuditTrail(actor, "error", episodeUid, contactId,
        "Cannot draft Great Interview — no email on contact record.", "warn");
      return;
    }

    var guestName = resolveDisplayNameByContactId(contactId, actor) || contactId;
    var hostName = getGovernance("HOST_NAME") || "JT";

    var templateText = extractPrompt(getGovernance("SCRIBE_GREAT_INTERVIEW_KEY"));
    var contentPrompt;
    if (!templateText) {
      contentPrompt = "FALLBACK: Master Template section missing. Draft a generic warm post-recording thank-you email to the guest. Mark the email clearly as a generic placeholder that needs review before sending.";
      spawnTask({
        actionTitle:      "Scribe template missing — Great Interview — " + guestName + " (" + episodeUid + ")",
        priority:         "urgent",
        assignee:         getAssigneeByRole("producer"),
        assignedBy:       "The Fairy Team",
        status:           "open",
        contactId:        contactId,
        episodeUid:       episodeUid,
        executiveSummary: "The Master Template section for the Great Interview email was missing. A generic draft was created. Review the draft and update the Master Template section before this touchpoint fires again."
      });
      logToAuditTrail(actor, "error", episodeUid, contactId,
        "Great Interview template section missing — falling back to generic draft.", "warn");
    }

    scribeWriteAndDraft({
      to: guestEmail,
      phase: "Phase2_PostRecording",
      episodeUid: episodeUid,
      guestName: guestName,
      hostName: hostName,
      contentPrompt: contentPrompt || null
    });

    logToAuditTrail(actor, "state_change", episodeUid, contactId,
      "Great Interview email draft created for contact: " + contactId, "info");

  } catch (err) {
    logToAuditTrail(actor, "error", episodeUid, contactId,
      "scribeGreatInterview failed: " + err.message, "error");
  }
}


// ============================================================
// TOUCHPOINT 4 — REVIEW YOUR EPISODE
// Trigger: Daily Pulse detects finished episode file in FINISHED_EPISODES folder
// Dependency: FINISHED_EPISODES governance key must be populated before this touchpoint can run
// ============================================================

function scribeReviewEpisode(contactId, episodeUid) {
  var actor = "scribe_fairy:scribeReviewEpisode";

  try {
    var guestEmail = resolveEmailByContactId(contactId);
    if (!guestEmail) {
      logToAuditTrail(actor, "error", episodeUid, contactId,
        "Cannot draft Review Your Episode — no email on contact record.", "warn");
      return;
    }

    var guestName = resolveDisplayNameByContactId(contactId, actor) || contactId;
    var hostName = getGovernance("HOST_NAME") || "JT";

    var templateText = extractPrompt(getGovernance("SCRIBE_REVIEW_EPISODE_KEY"));
    var contentPrompt;
    if (!templateText) {
      contentPrompt = "FALLBACK: Master Template section missing. Draft a generic email notifying the guest that their episode is ready for review, with a note that a link will be provided. Mark the email clearly as a generic placeholder that needs review before sending.";
      spawnTask({
        actionTitle:      "Scribe template missing — Review Your Episode — " + guestName + " (" + episodeUid + ")",
        priority:         "urgent",
        assignee:         getAssigneeByRole("producer"),
        assignedBy:       "The Fairy Team",
        status:           "open",
        contactId:        contactId,
        episodeUid:       episodeUid,
        executiveSummary: "The Master Template section for the Review Your Episode email was missing. A generic draft was created. Review the draft and update the Master Template section before this touchpoint fires again."
      });
      logToAuditTrail(actor, "error", episodeUid, contactId,
        "Review Your Episode template section missing — falling back to generic draft.", "warn");
    }

    scribeWriteAndDraft({
      to: guestEmail,
      phase: "Phase3_ReviewEpisode",
      episodeUid: episodeUid,
      guestName: guestName,
      hostName: hostName,
      contentPrompt: contentPrompt || null
    });

    logToAuditTrail(actor, "state_change", episodeUid, contactId,
      "Review Your Episode email draft created for contact: " + contactId, "info");

  } catch (err) {
    logToAuditTrail(actor, "error", episodeUid, contactId,
      "scribeReviewEpisode failed: " + err.message, "error");
  }
}


// ============================================================
// TOUCHPOINT 5 — WE'RE LIVE
// Trigger: Daily Pulse release date check — fires when release date = today
//          and Release_Reminder_Sent flag is not yet TRUE on Episodes tab
// Note: Daily Pulse sets Release_Reminder_Sent = TRUE after this fires.
//       Filing Fairy has no role here.
// ============================================================

function scribeWereLive(contactId, episodeUid) {
  var actor = "scribe_fairy:scribeWereLive";

  try {
    var guestEmail = resolveEmailByContactId(contactId);
    if (!guestEmail) {
      logToAuditTrail(actor, "error", episodeUid, contactId,
        "Cannot draft We're Live — no email on contact record.", "warn");
      return;
    }

    var guestName = resolveDisplayNameByContactId(contactId, actor) || contactId;
    var hostName = getGovernance("HOST_NAME") || "JT";

    var templateText = extractPrompt(getGovernance("SCRIBE_WERE_LIVE_KEY"));
    var contentPrompt;
    if (!templateText) {
      contentPrompt = "FALLBACK: Master Template section missing. Draft a generic excited, celebratory email notifying the guest that their episode is now live. Mark the email clearly as a generic placeholder that needs review before sending.";
      spawnTask({
        actionTitle:      "Scribe template missing — We're Live — " + guestName + " (" + episodeUid + ")",
        priority:         "urgent",
        assignee:         getAssigneeByRole("producer"),
        assignedBy:       "The Fairy Team",
        status:           "open",
        contactId:        contactId,
        episodeUid:       episodeUid,
        executiveSummary: "The Master Template section for the We're Live email was missing. A generic draft was created. Review the draft and update the Master Template section before this touchpoint fires again."
      });
      logToAuditTrail(actor, "error", episodeUid, contactId,
        "We're Live template section missing — falling back to generic draft.", "warn");
    }

    scribeWriteAndDraft({
      to: guestEmail,
      phase: "Phase3_WeAreLive",
      episodeUid: episodeUid,
      guestName: guestName,
      hostName: hostName,
      contentPrompt: contentPrompt || null
    });

    logToAuditTrail(actor, "state_change", episodeUid, contactId,
      "We're Live email draft created for contact: " + contactId, "info");

  } catch (err) {
    logToAuditTrail(actor, "error", episodeUid, contactId,
      "scribeWereLive failed: " + err.message, "error");
  }
}