// ============================================================================
// FILE: filing_fairy.gs
// Fairy: The Filing Fairy (Archive Bridge)
// Trigger: Audra taps button on final approval task → AppSheet webhook → clerk_fairy.gs → runFilingFairy()
//
// Responsibilities:
//   - Preflight check: Video_Status + Images_Status on Episodes tab (not manifest)
//   - Assemble Guest Swipe package: doc + graphics + reels → Guest_Swipe/ subfolder
//   - Copy Episode Card to NotebookLM Staging
//   - Move Staging folder to Finished Episodes
//   - Patch Episodes tab to Complete
//   - Scribe We're Live email draft
//   - Spawn confirmation task for JT
//
// Entry point: runFilingFairy(epUid)
// doPost() has moved to clerk_fairy.gs — do not add it back here.
//
// Schema drift resolved at onboarding:
//   - GUEST_SWIPE_FOLDER_ID governance key retired — Guest_Swipe/ subfolder already
//     exists inside Staging (created by Secretary). Filing locates by folder name.
//   - Guest graphics source: Guest_Graphics/ subfolder inside Staging (not Staging root).
//   - manifest.guest_email retired — resolved via resolveEmailByContactId(contact_id).
//   - upsertProductionLog() retired — replaced by patchEpisodes().
//   - CONFIG.PODCAST_NAME → getGovernance("PODCAST_NAME").
//   - scanForReadyAssets() not ported — Daily Pulse Loop 4 owns asset scanning.
//   - doPost() approval routing not ported — AppSheet writes directly to Episodes tab.
//   - logToAuditTrail() eventCategory: valid enums only (error|state_change|human_action).
//   - spawnTask() keys: camelCase only.
//   - Status values: plain enums only, no emoji.
// ============================================================================


// ============================================================================
// PREFLIGHT CHECK
// Reads Video_Status and Images_Status from the Episodes tab.
// Approval authority is the Episodes tab — not the manifest.
// AppSheet writes approval state directly to Video_Status and Images_Status.
//
// Returns true if all clear. Returns false if blocked — caller must exit.
//
// Per the Preservation Mandate: do NOT simplify or thin this function.
// ============================================================================

function preflightCheck(epUid, agentName) {
  const episodeRow = getEpisodeRow(epUid);

  if (!episodeRow) {
    logToAuditTrail(agentName, "error", epUid, "",
      "Preflight failed — could not read episode row from Episodes tab.");
    spawnTask({
      episodeUid:       epUid,
      workflowStep:     "Filing",
      actionTitle:      `Filing blocked — episode row not found: ${epUid}`,
      assignee:         getGovernance("ASSIGNEE_PRODUCER"),
      assignedBy:       "The Fairy Team",
      status:           "open",
      priority:         "urgent",
      executiveSummary: `preflightCheck() could not find episode row for ${epUid}. Check Episodes tab.`
    });
    return false;
  }

  const videoStatus  = episodeRow.Video_Status  || "pending";
  const imagesStatus = episodeRow.Images_Status || "pending";

  const videoApproved  = videoStatus  === "approved";
  const imagesApproved = imagesStatus === "approved";

  if (videoApproved && imagesApproved) {
    logToAuditTrail(agentName, "state_change", epUid, "",
      `Preflight passed. Video_Status: ${videoStatus}, Images_Status: ${imagesStatus}. Filing proceeding.`);
    return true;
  }

  // Build specific, actionable block message
  const blockedAssets = [];
  if (!videoApproved)  blockedAssets.push(`video (${videoStatus})`);
  if (!imagesApproved) blockedAssets.push(`images (${imagesStatus})`);
  const blockedSummary = blockedAssets.join(" and ");

  const guestName = episodeRow.Guest_Name || epUid;

  logToAuditTrail(agentName, "state_change", epUid, "",
    `Filing blocked — not all assets approved. Pending: ${blockedSummary}.`);

  spawnTask({
    episodeUid:       epUid,
    workflowStep:     "Filing",
    actionTitle:      `Filing blocked — assets not yet approved: ${guestName}`,
    assignee:         getGovernance("ASSIGNEE_PRODUCER"),
    assignedBy:       "The Fairy Team",
    status:           "open",
    priority:         "urgent",
    payloadLink:      `https://drive.google.com/drive/folders/${getStagingFolderIdByUid(epUid)}`,
    executiveSummary: `Filing Fairy cannot close this episode yet. The following assets are not approved: ${blockedSummary}. Complete the review cycle before re-triggering Filing Fairy. Pending: ${blockedSummary}. Once approved in AppSheet, re-trigger Filing Fairy from your task.`
  });

  return false;
}


// ============================================================================
// THE FILING FAIRY (Archive Bridge)
//
// Execution order:
//   1. Preflight check — reads Episodes tab. Blocks if not all approved.
//   2. Locate Guest_Swipe/ subfolder inside Staging (created by Secretary).
//   3. Create Guest Swipe doc from Episode Card sections.
//   4. Copy guest graphics from Guest_Graphics/ subfolder → Guest_Swipe/.
//   5. Copy reels from Reels/ subfolder → Guest_Swipe/.
//   6. Set permissions on Guest_Swipe/ folder to guest email.
//   7. Copy Episode Card to NotebookLM Staging.
//   8. Patch Episodes tab to Complete.
//   9. Patch manifest — phase, status, filing metadata.
//  10. Move Staging folder to Finished Episodes (all assets ride along).
//  11. Scribe We're Live email draft.
//  12. Spawn confirmation task for JT.
//
// Per the Preservation Mandate: do NOT simplify or thin this function.
// ============================================================================

function runFilingFairy(epUid) {
  const agentName = "Filing_Fairy";
  logToAuditTrail(agentName, "state_change", epUid, "",
    `Filing Fairy executing for: ${epUid}`);

  try {
    // --- Preflight: read approval state from Episodes tab ---
    if (!preflightCheck(epUid, agentName)) return;

    const stagingFolderId = getStagingFolderIdByUid(epUid);
    if (!stagingFolderId) throw new Error("Staging folder not found.");

    const manifest = getManifest(stagingFolderId);
    if (!manifest) throw new Error("Manifest not found.");

    const guestName  = manifest.guest_name;
    const contactId  = manifest.contact_id;
    const stagingFolder = DriveApp.getFolderById(stagingFolderId);

    // --- Resolve guest email via CRM ---
    const guestEmail = resolveEmailByContactId(contactId);
    if (!guestEmail) {
      logToAuditTrail(agentName, "error", epUid, contactId,
        `Could not resolve guest email for contact_id: ${contactId}. Swipe folder permissions and We're Live email will be skipped.`);
    }

    // --- Resolve required folder IDs ---
    const finishedFolderId = getGovernance("FINISHED_EPISODES");
    if (!finishedFolderId) throw new Error("FINISHED_EPISODES folder ID not in Governance_Config.");

    const notebookFolderId = getGovernance("NOTEBOOK_STAGING");
    const episodeCardId    = manifest.asset_ids ? manifest.asset_ids.episode_card : null;

    // =========================================================================
    // STEP 1: LOCATE Guest_Swipe/ SUBFOLDER INSIDE STAGING
    // Secretary created this at scheduling time. Filing does not create it.
    // =========================================================================
    let swipeFolder   = null;
    let swipeFolderId = null;

    const subfolders = stagingFolder.getFolders();
    while (subfolders.hasNext()) {
      const sub = subfolders.next();
      if (sub.getName() === "Guest_Swipe") {
        swipeFolder   = sub;
        swipeFolderId = sub.getId();
        break;
      }
    }

    if (!swipeFolder) {
      logToAuditTrail(agentName, "error", epUid, "",
        "Guest_Swipe/ subfolder not found inside Staging. Creating fallback.");
      swipeFolder   = stagingFolder.createFolder("Guest_Swipe");
      swipeFolderId = swipeFolder.getId();
    }

    logToAuditTrail(agentName, "state_change", epUid, "",
      `Guest_Swipe/ folder located: ${swipeFolderId}`);

    // =========================================================================
    // STEP 2: CREATE GUEST SWIPE DOC FROM EPISODE CARD
    // Sections: HOOKS, GUEST QUOTES, GUEST INSTAGRAM CAPTION,
    //           GUEST LINKEDIN AND FACEBOOK
    // =========================================================================
    if (episodeCardId) {
      try {
        createGuestSwipeDoc(episodeCardId, swipeFolder, guestName, epUid, agentName);
      } catch (err) {
        logToAuditTrail(agentName, "error", epUid, "",
          `Guest Swipe doc creation failed: ${err.message}. Continuing.`);
      }
    } else {
      logToAuditTrail(agentName, "error", epUid, "",
        "No Episode Card ID in manifest. Guest Swipe doc skipped.");
    }

    // =========================================================================
    // STEP 3: COPY GUEST GRAPHICS FROM Guest_Graphics/ SUBFOLDER → Guest_Swipe/
    // Guest graphics live in Guest_Graphics/ subfolder (Artist Fairy populated).
    // Old pattern (scanning Staging root for _guest filename) is retired.
    // =========================================================================
    let guestGraphicsFolder = null;
    const stagingSubfolders = stagingFolder.getFolders();
    while (stagingSubfolders.hasNext()) {
      const sub = stagingSubfolders.next();
      if (sub.getName() === "Guest_Graphics") {
        guestGraphicsFolder = sub;
        break;
      }
    }

    if (guestGraphicsFolder) {
      const graphicFiles = guestGraphicsFolder.getFiles();
      while (graphicFiles.hasNext()) {
        const file = graphicFiles.next();
        file.makeCopy(file.getName(), swipeFolder);
        logToAuditTrail(agentName, "state_change", epUid, "",
          `Guest graphic copied to Guest_Swipe/: ${file.getName()}`);
      }
    } else {
      logToAuditTrail(agentName, "error", epUid, "",
        "Guest_Graphics/ subfolder not found in Staging. Guest graphics not copied to swipe package.");
    }

    // =========================================================================
    // STEP 4: COPY REELS FROM Reels/ SUBFOLDER → Guest_Swipe/
    // =========================================================================
    let reelsFolder = null;
    const stagingSubfolders2 = stagingFolder.getFolders();
    while (stagingSubfolders2.hasNext()) {
      const sub = stagingSubfolders2.next();
      if (sub.getName() === "Reels") {
        reelsFolder = sub;
        break;
      }
    }

    if (reelsFolder) {
      const reelFiles = reelsFolder.getFiles();
      while (reelFiles.hasNext()) {
        const file = reelFiles.next();
        file.makeCopy(file.getName(), swipeFolder);
        logToAuditTrail(agentName, "state_change", epUid, "",
          `Reel copied to Guest_Swipe/: ${file.getName()}`);
      }
    } else {
      logToAuditTrail(agentName, "error", epUid, "",
        "Reels/ subfolder not found in Staging. Reels not copied to swipe package.");
    }

    // =========================================================================
    // STEP 5: SET GUEST_SWIPE/ PERMISSIONS TO GUEST EMAIL
    // Non-fatal if email not resolved — logged above.
    // =========================================================================
    if (guestEmail) {
      try {
        DriveApp.getFolderById(swipeFolderId)
          .addViewer(guestEmail);
        logToAuditTrail(agentName, "state_change", epUid, contactId,
          `Guest_Swipe/ folder shared with: ${guestEmail}`);
      } catch (err) {
        logToAuditTrail(agentName, "error", epUid, contactId,
          `Could not set swipe folder permissions: ${err.message}. Manual share required.`);
      }
    }

    // =========================================================================
    // STEP 6: COPY EPISODE CARD TO NOTEBOOKLM STAGING
    // =========================================================================
    let notebookCopyId = null;
    if (episodeCardId) {
      if (notebookFolderId) {
        try {
          const notebookFolder = DriveApp.getFolderById(notebookFolderId);
          const cardFile       = DriveApp.getFileById(episodeCardId);
          const notebookCopy   = cardFile.makeCopy(
            `NotebookLM_${epUid}_${guestName}`,
            notebookFolder
          );
          notebookCopyId = notebookCopy.getId();
          logToAuditTrail(agentName, "state_change", epUid, "",
            `Episode Card copied to NotebookLM Staging: ${notebookCopyId}`);
        } catch (err) {
          logToAuditTrail(agentName, "error", epUid, "",
            `NotebookLM copy failed: ${err.message}. Continuing.`);
        }
      } else {
        logToAuditTrail(agentName, "error", epUid, "",
          "NOTEBOOK_STAGING folder ID not in Governance_Config. NotebookLM copy skipped.");
      }
    } else {
      logToAuditTrail(agentName, "error", epUid, "",
        "No Episode Card ID in manifest. NotebookLM copy skipped.");
    }

    // =========================================================================
    // STEP 7: PATCH EPISODES TAB TO COMPLETE
    // patchEpisodes() replaces upsertProductionLog() from old system.
    // =========================================================================
    patchEpisodes(epUid, {
      Status:          "complete",
      Production_Status: "complete",
      Janitor_Handoff: new Date().toISOString()
    });

    logToAuditTrail(agentName, "state_change", epUid, "",
      "Episodes tab patched to complete.");

    // =========================================================================
    // STEP 8: PATCH MANIFEST
    // =========================================================================
    patchManifest(stagingFolderId, {
      phase:               "4_Archived",
      status:              "complete",
      swipe_folder_id:     swipeFolderId,
      notebook_lm_copy_id: notebookCopyId,
      approved_at:         new Date().toISOString(),
      fairies_dispatched:  [...(manifest.fairies_dispatched || []), "Filing_Fairy"]
    });

    // =========================================================================
    // STEP 9: MOVE STAGING FOLDER TO FINISHED EPISODES
    // All remaining assets ride along. This is the last destructive action.
    // =========================================================================
    const finishedFolder = DriveApp.getFolderById(finishedFolderId);
    stagingFolder.moveTo(finishedFolder);
    logToAuditTrail(agentName, "state_change", epUid, "",
      `Staging folder moved to Finished Episodes.`);

    // =========================================================================
    // STEP 10: SCRIBE — WE'RE LIVE EMAIL DRAFT
    // Guest email resolved from Contacts tab — not manifest.
    // Podcast name from Governance_Config — not CONFIG object.
    // All prose is template-driven via Master Template.
    // =========================================================================
    const swipeFolderUrl = `https://drive.google.com/drive/folders/${swipeFolderId}`;
    const episodeCardUrl = episodeCardId
      ? `https://docs.google.com/document/d/${episodeCardId}`
      : "";
    const podcastName    = getGovernance("PODCAST_NAME") || "the podcast";
    const hostName       = getGovernance("HOST_NAME")    || "JT";

    if (guestEmail) {
      scribeWriteAndDraft({
        to:            guestEmail,
        phase:         "Phase3_WeAreLive",
        episodeUid:    epUid,
        guestName:     guestName,
        hostName:      hostName,
        contentPrompt: `Write the We're Live release email to the guest per the Master Template.
          Their episode of "${podcastName}" is officially released.
          Their sharing assets (social copy and graphics) are ready at: ${swipeFolderUrl}
          JT will add the actual episode URL before sending.`
      });

      logToAuditTrail(agentName, "state_change", epUid, contactId,
        "We're Live email draft created via Scribe.");
    } else {
      logToAuditTrail(agentName, "error", epUid, contactId,
        "Guest email not resolved. We're Live email draft skipped. Manual send required.");
    }

    // =========================================================================
    // STEP 11: SPAWN CONFIRMATION TASK FOR JT
    // =========================================================================
    spawnTask({
      episodeUid:       epUid,
      contactId:        contactId,
      workflowStep:     "Filing",
      actionTitle:      `Episode archived: ${guestName}`,
      assignee:         getGovernance("ASSIGNEE_HOST"),
      assignedBy:       "The Fairy Team",
      status:           "open",
      priority:         "normal",
      payloadLink:      episodeCardUrl,
      executiveSummary: `Episode for ${guestName} filed to Finished Episodes. Swipe folder created. NotebookLM copy done. Release email draft in Gmail. Filing complete. Add the episode URL to the release email draft before sending. Swipe folder: ${swipeFolderUrl}`
    });

    logToAuditTrail(agentName, "state_change", epUid, "",
      `Filing complete for ${epUid}. Episode archived.`);

  } catch (err) {
    logToAuditTrail(agentName, "error", epUid, "",
      `runFilingFairy threw an error: ${err.message}`);
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


// ============================================================================
// GUEST SWIPE DOC CREATOR
// Creates guest-facing sharing doc inside Guest_Swipe/ subfolder.
// Content extracted from Episode Card by section heading via extractSectionFromProse().
// Sections: HOOKS, GUEST QUOTES, GUEST INSTAGRAM CAPTION, GUEST LINKEDIN AND FACEBOOK.
// All prose is sourced from the Episode Card — no hardcoded copy here.
//
// Per the Preservation Mandate: do NOT thin this function.
// ============================================================================

function createGuestSwipeDoc(episodeCardId, swipeFolder, guestName, epUid, agentName) {
  const cardDoc  = DocumentApp.openById(episodeCardId);
  const cardText = cardDoc.getBody().getText();

  // Extract sections from Episode Card by heading
  const hooksContent         = extractSectionFromProse(cardText, "HOOKS");
  const guestQuotesContent   = extractSectionFromProse(cardText, "GUEST QUOTES");
  const guestInstaContent    = extractSectionFromProse(cardText, "GUEST INSTAGRAM CAPTION");
  const guestLinkedInContent = extractSectionFromProse(cardText, "GUEST LINKEDIN AND FACEBOOK");

  // Create swipe doc
  const swipeDoc  = DocumentApp.create(`GuestSwipe_${epUid}_${guestName}`);
  const swipeBody = swipeDoc.getBody();

  swipeBody.appendParagraph(`GUEST SHARING ASSETS — ${guestName}`)
    .setHeading(DocumentApp.ParagraphHeading.HEADING1);
  swipeBody.appendParagraph(`Episode: ${getGovernance("PODCAST_NAME") || "Don't Waste Your Pain"} | Generated: ${new Date().toDateString()}`);
  swipeBody.appendParagraph("");
  swipeBody.appendParagraph("These assets are ready for you to copy, paste, and make your own.");
  swipeBody.appendParagraph("");

  swipeBody.appendParagraph("─────────────────────────────────────────────");
  swipeBody.appendParagraph("HOOKS")
    .setHeading(DocumentApp.ParagraphHeading.HEADING2);
  swipeBody.appendParagraph(hooksContent || "See Episode Card for hooks.");
  swipeBody.appendParagraph("");

  swipeBody.appendParagraph("─────────────────────────────────────────────");
  swipeBody.appendParagraph("GUEST QUOTES")
    .setHeading(DocumentApp.ParagraphHeading.HEADING2);
  swipeBody.appendParagraph(guestQuotesContent || "See Episode Card for quotes.");
  swipeBody.appendParagraph("");

  swipeBody.appendParagraph("─────────────────────────────────────────────");
  swipeBody.appendParagraph("INSTAGRAM CAPTION")
    .setHeading(DocumentApp.ParagraphHeading.HEADING2);
  swipeBody.appendParagraph(guestInstaContent || "See Episode Card for Instagram caption.");
  swipeBody.appendParagraph("");

  swipeBody.appendParagraph("─────────────────────────────────────────────");
  swipeBody.appendParagraph("LINKEDIN AND FACEBOOK")
    .setHeading(DocumentApp.ParagraphHeading.HEADING2);
  swipeBody.appendParagraph(guestLinkedInContent || "See Episode Card for LinkedIn and Facebook posts.");
  swipeBody.appendParagraph("");

  swipeDoc.saveAndClose();

  // Move to Guest_Swipe/ subfolder
  DriveApp.getFileById(swipeDoc.getId()).moveTo(swipeFolder);

  logToAuditTrail(agentName, "state_change", epUid, "",
    `Guest Swipe doc created: ${swipeDoc.getId()}`);

  return swipeDoc.getId();
}