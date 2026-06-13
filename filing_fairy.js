// ============================================================================
// FILE: filing_fairy.gs
// Fairy: The Filing Fairy (Archive)
//
// Responsibilities:
//   - Patch manifest to archived state
//   - Patch Episodes tab Status → complete
//   - Move Staging folder wholesale to Finished Episodes
//
// Entry point: runFilingFairy(epUid)
//   Called by housekeeping.gs: archiveLiveEpisodes() on nightly schedule.
//   clerk_fairy.gs also routes type:"filing" here — that route is orphaned
//   since the button-tap trigger was retired. Awaiting hub decision to remove.
//
// No preflight gates. No asset assembly. No email. No task spawning.
// Folder moves wholesale — all contents ride along.
// ============================================================================


function runFilingFairy(epUid) {
  const agentName = "Filing_Fairy";
  logToAuditTrail(agentName, "state_change", epUid, "",
    `[INFO] Filing Fairy executing for: ${epUid}`, "INFO");

  try {
    const stagingFolderId = getStagingFolderIdByUid(epUid);
    if (!stagingFolderId) throw new Error("Staging folder not found.");

    const finishedFolderId = getGovernance("FINISHED_EPISODES");
    if (!finishedFolderId) throw new Error("FINISHED_EPISODES folder ID not in Governance_Config.");

    // Patch manifest before moving — folder ID becomes unreliable after move
    patchManifest(stagingFolderId, {
      phase:       "4_Archived",
      status:      "archived",
      archived_at: new Date().toISOString()
    });

    patchEpisodes(epUid, { Status: "archived" });
    logToAuditTrail(agentName, "state_change", epUid, "",
      "[INFO] Episodes tab patched to complete.", "INFO");

    DriveApp.getFolderById(stagingFolderId)
      .moveTo(DriveApp.getFolderById(finishedFolderId));
    logToAuditTrail(agentName, "state_change", epUid, "",
      "[INFO] Staging folder moved to Finished Episodes. Filing complete.", "INFO");

  } catch (err) {
    logToAuditTrail(agentName, "error", epUid, "",
      `[ERROR] runFilingFairy threw an error: ${err.message}`, "ERROR");
    spawnTask({
      episodeUid:       epUid,
      workflowStep:     "Filing",
      actionTitle:      `Filing Fairy failed: ${epUid}`,
      assignee:         getGovernance("ASSIGNEE_PRODUCER"),
      assignedBy:       "The Fairy Team",
      status:           "open",
      priority:         "urgent",
      payloadLink:      `https://drive.google.com/drive/folders/${getStagingFolderIdByUid(epUid)}`,
      executiveSummary: `Filing Fairy threw an error: ${err.message}. Episode folder may still be in Staging. Manual filing required.`
    });
  }
}


/**
 * Scans the Contact Library folder for a guest brief Google Doc.
 * Prefers a doc whose name ends with _${epUid} (exact episode match).
 * Falls back to the most recently updated GuestBrief doc in the folder.
 * Returns doc text, or empty string if none found.
 *
 * Called by vert_fairy.gs: gatherVertContext().
 * Docs written by herald_fairy.gs: writeGuestBriefDoc() — named GuestBrief_DisplayName_EpisodeUID.
 */
function findGuestBriefInContactLibrary(contactLibraryFolderId, epUid, agentName) {
  try {
    const folder = DriveApp.getFolderById(contactLibraryFolderId);
    const files  = folder.getFiles();
    let exactMatch = null;
    let fallback   = null;

    while (files.hasNext()) {
      const file = files.next();
      if (file.getMimeType() !== MimeType.GOOGLE_DOCS) continue;
      const name = file.getName();
      if (!name.startsWith("GuestBrief")) continue;

      if (name.endsWith("_" + epUid)) {
        exactMatch = file;
        break;
      }
      if (!fallback || file.getLastUpdated() > fallback.getLastUpdated()) {
        fallback = file;
      }
    }

    const target = exactMatch || fallback;
    if (!target) {
      logToAuditTrail(agentName, "error", epUid, null,
        "findGuestBriefInContactLibrary: no GuestBrief doc found in Contact Library folder.", "warning");
      return "";
    }

    const text = DocumentApp.openById(target.getId()).getBody().getText();
    logToAuditTrail(agentName, "state_change", epUid, null,
      "Guest Brief loaded: " + target.getName() + " (" + text.length + " chars).", "info");
    return text;

  } catch (e) {
    logToAuditTrail(agentName, "error", epUid, null,
      "findGuestBriefInContactLibrary error: " + e.message, "warning");
    return "";
  }
}
