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
