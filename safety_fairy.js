// =============================================================================
// safety_fairy.gs — DWYP Operations Platform
// The Safety Fairy (Content Risk Auditor)
// Version: 1.4 | April 2026
// Author: Claude (Anthropic) — per Preservation Mandate, all GAS code written
//         by Claude only. Never edit directly in Apps Script or via Gemini.
//
// TRIGGER: Called by Daily Pulse (time-based) when an episode has a Raw_Folder_ID
//          and safety_audited is not true in the manifest.
//          Also safe to call manually: runSafetyFairy("EP-YYMMDD-HHmm")
//
// MISSION: Truth over Sanitation. Flags platform risks and listener sensitivity
//          issues only. Profanity is not flagged by default. Flag logic lives in
//          the Content Sensitivity doc (CONTENT_SENSITIVITY_ID), not in code.
//
// OUTPUTS:
//   - Production Notes doc: CONTENT FLAGS section overwritten with Gemini output
//   - Manifest: safety_audited = true, safety_critical = true | false
//   - Audit_Trail: one entry on completion or failure
//   - Tasks: spawned on failure paths, when flags exist, and on successful completion
//
// GOVERNANCE KEYS USED:
//   CONTENT_SENSITIVITY_ID  — Content sensitivity policy doc
//   MASTER_TEMPLATE_ID      — Source of # Raw Production Notes prompt section
//   GEMINI_API_KEY          — Gemini API key (via Carousel)
//   MODEL_NAME              — Gemini model name (via Carousel)
//   ASSIGNEE_PRODUCER       — Task assignee for system failures and Produce_Episode tasks
//   ASSIGNEE_HOST           — Task assignee for Custom_Images task (JT)
//
// GRACEFUL DEGRADATION:
//   Transcript not found       → WARNING log, spawn task to Audra, return
//   Sensitivity doc unreadable → WARNING log, proceed without it
//   Gemini call fails          → ERROR log, spawn task to Audra, return
//   Production Notes not found → ERROR log, spawn task to Audra, return
//
// RE-RUN BEHAVIOR:
//   Overwrites CONTENT FLAGS section in Production Notes on every run.
//   No history is kept. Re-running is intentional and safe.
//   Idempotency fix: clears and rewrites the first content paragraph after the
//   CONTENT FLAGS: heading rather than deleting paragraphs, preventing the
//   "Can't remove last paragraph in a document section" crash on re-run.
//
// NOTE ON TIMESTAMPS:
//   Flag output timestamps reflect raw transcript position only.
//   They will shift after editing. See Master Template # Raw Production Notes
//   section for the note to JT on this behavior.
// =============================================================================


// =============================================================================
// ENTRY POINT
// =============================================================================

/**
 * Main entry point for the Safety Fairy.
 * Called by Daily Pulse or manually with an Episode_UID.
 * Orchestrates: data reads → Gemini audit → Production Notes write → manifest patch.
 * One Audit_Trail entry on completion or failure only — no internal step logging.
 *
 * @param {string} episodeUid - Episode_UID to audit (e.g. "EP-260315-1430")
 */
function runSafetyFairy(episodeUid) {
  const agentName = "Safety_Fairy";

  if (!episodeUid) {
    logToAuditTrail(agentName, "error", "", "", "[ERROR] runSafetyFairy called without an episodeUid. Aborting.", "ERROR");
    return;
  }

  try {

    // -------------------------------------------------------------------------
    // STEP 1: Read episode row from Episodes tab
    // -------------------------------------------------------------------------
    const episodeRow = getEpisodeRow(episodeUid);
    if (!episodeRow) {
      logToAuditTrail(agentName, "error", episodeUid, "", "[ERROR] Episode not found in Episodes tab. Aborting.", "ERROR");
      spawnTask({
        actionTitle:      `Safety Fairy: episode record not found — ${episodeUid}`,
        assignee:         getGovernance("ASSIGNEE_PRODUCER"),
        assignedBy:       "The Fairy Team",
        status:           "open",
        priority:         "urgent",
        episodeUid:       episodeUid,
        workflowStep:     "Produce_Episode",
        executiveSummary: `Safety audit failed — episode row missing from Episodes tab for ${episodeUid}.`
      });
      return;
    }

    const rawFolderId = episodeRow.Raw_Folder_ID;
    const contactId   = episodeRow.Contact_ID;
    const guestName   = episodeRow.Guest_Name || episodeUid;

    if (!rawFolderId) {
      logToAuditTrail(agentName, "error", episodeUid, contactId, "[ERROR] Raw_Folder_ID not set on episode. Aborting.", "ERROR");
      spawnTask({
        actionTitle:      `Safety Fairy: Raw_Folder_ID missing — ${guestName}`,
        assignee:         getGovernance("ASSIGNEE_PRODUCER"),
        assignedBy:       "The Fairy Team",
        status:           "open",
        priority:         "urgent",
        contactId:        contactId,
        episodeUid:       episodeUid,
        workflowStep:     "Produce_Episode",
        executiveSummary: `Safety audit failed — Raw_Folder_ID is empty on the Episodes row for ${episodeUid}. Set it and re-run.`
      });
      return;
    }

    // -------------------------------------------------------------------------
    // STEP 2: Resolve guest Display_Name from Contacts tab
    // -------------------------------------------------------------------------
    const displayName = resolveDisplayNameByContactId(contactId) || guestName;

    // -------------------------------------------------------------------------
    // STEP 3: Find transcript file in Raw folder
    // Returns { text, url } or null.
    // -------------------------------------------------------------------------
    const transcriptResult = readTranscriptFromRawFolder(rawFolderId);
    if (transcriptResult === null) {
      logToAuditTrail(agentName, "error", episodeUid, contactId, "[WARNING] Transcript file not found in Raw folder. Aborting audit.", "WARNING");
      spawnTask({
        actionTitle:      `Safety Fairy: transcript not found — ${displayName}`,
        assignee:         getGovernance("ASSIGNEE_PRODUCER"),
        assignedBy:       "The Fairy Team",
        status:           "open",
        priority:         "urgent",
        contactId:        contactId,
        episodeUid:       episodeUid,
        workflowStep:     "Produce_Episode",
        executiveSummary: `Safety audit blocked — transcript file missing from Raw folder for ${episodeUid}. Upload a transcript file with "transcript" in the filename and re-run.`
      });
      return;
    }

    const transcriptText = transcriptResult.text;
    const transcriptUrl  = transcriptResult.url;

    // -------------------------------------------------------------------------
    // STEP 4: Read Content Sensitivity doc (graceful degradation if missing)
    // -------------------------------------------------------------------------
    const sensitivityDoc = readContentSensitivityDoc();
    // sensitivityDoc may be "" — audit proceeds without it, per spec.

    // -------------------------------------------------------------------------
    // STEP 5: Find Production Notes doc ID from manifest
    // -------------------------------------------------------------------------
    const stagingFolderId   = getStagingFolderIdByUid(episodeUid);
    const manifest          = stagingFolderId ? getManifest(stagingFolderId) : null;
    const productionNotesId = manifest && manifest.asset_ids
      ? manifest.asset_ids.production_notes
      : null;

    if (!productionNotesId) {
      logToAuditTrail(agentName, "error", episodeUid, contactId, "[ERROR] Production Notes doc ID not found in manifest. Aborting audit.", "ERROR");
      spawnTask({
        actionTitle:      `Safety Fairy: Production Notes not found — ${displayName}`,
        assignee:         getGovernance("ASSIGNEE_PRODUCER"),
        assignedBy:       "The Fairy Team",
        status:           "open",
        priority:         "urgent",
        contactId:        contactId,
        episodeUid:       episodeUid,
        workflowStep:     "Produce_Episode",
        executiveSummary: `Safety audit failed — Production Notes doc ID is missing from the manifest for ${episodeUid}. Check the manifest and re-run.`
      });
      return;
    }

    // -------------------------------------------------------------------------
    // STEP 6: Build forensic prompt and run Gemini audit
    // -------------------------------------------------------------------------
    const forensicPrompt = buildForensicPrompt(displayName, sensitivityDoc);
    const auditResults   = processForensicTranscript(transcriptText, episodeUid, agentName, forensicPrompt);

    if (!auditResults || auditResults.length === 0) {
      logToAuditTrail(agentName, "error", episodeUid, contactId, "[ERROR] Gemini audit returned no results. Aborting.", "ERROR");
      spawnTask({
        actionTitle:      `Safety Fairy: audit returned no output — ${displayName}`,
        assignee:         getGovernance("ASSIGNEE_PRODUCER"),
        assignedBy:       "The Fairy Team",
        status:           "open",
        priority:         "urgent",
        contactId:        contactId,
        episodeUid:       episodeUid,
        workflowStep:     "Produce_Episode",
        payloadLink:      `https://docs.google.com/document/d/${productionNotesId}/edit`,
        executiveSummary: `Safety audit failed — Gemini returned empty results for ${episodeUid}. Check API logs and re-run.`
      });
      return;
    }

    // -------------------------------------------------------------------------
    // STEP 7: Compile audit output and check for critical flags
    // -------------------------------------------------------------------------
    const compiledOutput = compileAuditOutput(auditResults);
    const isCritical     = detectCriticalFlags(compiledOutput);

    // -------------------------------------------------------------------------
    // STEP 8: Write compiled output to Production Notes doc
    // -------------------------------------------------------------------------
    writeContentFlagsToProductionNotes(productionNotesId, compiledOutput, episodeUid, agentName);

    // -------------------------------------------------------------------------
    // STEP 9: Patch manifest
    // -------------------------------------------------------------------------
    if (stagingFolderId) {
      patchManifest(stagingFolderId, {
        safety_audited:  true,
        safety_critical: isCritical
      });
    }

    // -------------------------------------------------------------------------
    // STEP 10: Single completion audit log entry
    // -------------------------------------------------------------------------
    logToAuditTrail(
      agentName,
      "state_change",
      episodeUid,
      contactId,
      `[INFO] Safety audit complete. Critical: ${isCritical}. Production Notes updated.`,
      "INFO"
    );

    // -------------------------------------------------------------------------
    // STEP 11: Spawn success tasks
    //
    // Task A — Audra: Produce_Episode
    //   Notifies Audra the transcript is audited and ready for production.
    //   Payload_Link → Production Notes doc.
    //
    // Task B — JT: Custom_Images
    //   Notifies JT the transcript is available for Image Workshop.
    //   Payload_Link → transcript file in Drive.
    //   Complete button only — no downstream actions.
    // -------------------------------------------------------------------------
    const successSummary = isCritical
      ? `Safety audit complete for ${displayName}. Critical flags were identified. Review the CONTENT FLAGS section in Production Notes before editing.`
      : `Safety audit complete for ${displayName}. No critical flags. Episode is clear for production.`;

    // Task A — Audra
    spawnTask({
      actionTitle:      `Safety audit complete — ready for production: ${displayName}`,
      assignee:         getGovernance("ASSIGNEE_PRODUCER"),
      assignedBy:       "The Fairy Team",
      status:           "open",
      priority:         "normal",
      contactId:        contactId,
      episodeUid:       episodeUid,
      workflowStep:     "Produce_Episode",
      payloadLink:      `https://docs.google.com/document/d/${productionNotesId}/edit`,
      executiveSummary: successSummary
    });

    // Task B — JT (Image Workshop)
    spawnTask({
      actionTitle:      `${displayName}: Image Workshop Ready!`,
      assignee:         getGovernance("ASSIGNEE_HOST"),
      assignedBy:       "The Fairy Team",
      status:           "open",
      priority:         "normal",
      contactId:        contactId,
      episodeUid:       episodeUid,
      workflowStep:     "Custom_Images",
      payloadLink:      transcriptUrl,
      executiveSummary: `Enable Gemini, Select "The Virtual Graphic Designer" Gem, and enable NanoBanana via the Tools icon in the Gem's chat box.`
    });

  } catch (err) {
    logToAuditTrail(agentName, "error", episodeUid, "", `[ERROR] Safety Fairy threw an unexpected error: ${err.message}`, "ERROR");
    spawnTask({
      actionTitle:      `Safety Fairy: unexpected error — ${episodeUid}`,
      assignee:         getGovernance("ASSIGNEE_PRODUCER"),
      assignedBy:       "The Fairy Team",
      status:           "open",
      priority:         "urgent",
      episodeUid:       episodeUid,
      workflowStep:     "Produce_Episode",
      executiveSummary: `Safety audit failed — unexpected runtime error for ${episodeUid}: ${err.message}. Check Audit_Trail and re-run.`
    });
  }
}

// =============================================================================
// DATA READERS
// =============================================================================

/**
 * Finds and reads the transcript file from the Raw production folder.
 * Matches any file whose name contains "transcript" (case-insensitive).
 * Returns { text, url } where text is the full file content and url is the
 * Drive file URL — used as Payload_Link on the Custom_Images task for JT.
 * Returns null if no transcript is found or on error.
 * Returns null (not throws) — caller handles graceful degradation.
 *
 * @param {string} rawFolderId - Drive folder ID of the Raw production folder
 * @returns {{ text: string, url: string } | null}
 */
function readTranscriptFromRawFolder(rawFolderId) {
  try {
    const folder = DriveApp.getFolderById(rawFolderId);
    const files  = folder.getFiles();

    while (files.hasNext()) {
      const file = files.next();
      if (file.getName().toLowerCase().includes("transcript")) {
        return {
          text: file.getBlob().getDataAsString(),
          url:  file.getUrl()
        };
      }
    }

    return null; // No transcript file found

  } catch (e) {
    logToAuditTrail("Safety_Fairy", "error", "", "", `[ERROR] readTranscriptFromRawFolder failed: ${e.message}`, "ERROR");
    return null;
  }
}

/**
 * Reads the Content Sensitivity policy doc via CONTENT_SENSITIVITY_ID governance key.
 * Returns the full doc text as a string.
 * Returns "" on failure — audit proceeds without it, per spec.
 * Logs a WARNING if the doc is unreadable but does not abort the run.
 */
function readContentSensitivityDoc() {
  try {
    const docId = getGovernance("CONTENT_SENSITIVITY_ID");
    if (!docId) {
      logToAuditTrail("Safety_Fairy", "error", "", "", "[WARNING] CONTENT_SENSITIVITY_ID not set in Governance_Config. Proceeding without sensitivity policy.", "WARNING");
      return "";
    }

    const doc = DocumentApp.openById(docId);
    return doc.getBody().getText();

  } catch (e) {
    logToAuditTrail("Safety_Fairy", "error", "", "", `[WARNING] Content Sensitivity doc unreadable: ${e.message}. Proceeding without it.`, "WARNING");
    return "";
  }
}

// =============================================================================
// PROMPT BUILDER + OUTPUT PROCESSORS
// =============================================================================

/**
 * Builds the forensic directive passed to processForensicTranscript().
 * Pulls the audit prompt from the Master Template via extractPrompt().
 * Appends guest name and sensitivity policy if available.
 * Returns the full directive string.
 *
 * Prompt behavior is template-driven — edit the Master Template
 * "# Raw Production Notes" section to change what Gemini looks for.
 * No code change needed.
 *
 * @param {string} displayName    - Guest's display name for prompt personalisation
 * @param {string} sensitivityDoc - Content sensitivity policy text (may be "")
 */
function buildForensicPrompt(displayName, sensitivityDoc) {
  const templatePrompt = extractPrompt("# Raw Production Notes");

  const guestContext = displayName
    ? `Guest name: ${displayName}.`
    : "";

  const sensitivityContext = sensitivityDoc
    ? `\n\nCONTENT SENSITIVITY POLICY (apply this when flagging):\n${sensitivityDoc}`
    : "";

  const baseDirective = templatePrompt
    || "Identify any content that poses platform risk or listener sensitivity concerns. Be specific. Include approximate timestamps where relevant. Plain text output only. No markdown.";

  return `${guestContext}\n\n${baseDirective}${sensitivityContext}`;
}

/**
 * Compiles the array of chunk results from processForensicTranscript()
 * into a single plain text string for writing to Production Notes.
 *
 * Chunks with errors are noted inline so the output is complete
 * even when individual chunks fail — partial audits are visible rather than silent.
 *
 * Error chunks do not abort compilation — they are included as a note
 * so the reviewer knows coverage was incomplete on that segment.
 *
 * @param {Array} auditResults - Array of { chunk_index, rawText } or { chunk_index, error }
 */
function compileAuditOutput(auditResults) {
  if (!auditResults || auditResults.length === 0) return "";

  // Single-chunk transcripts: return the raw text directly, no header needed.
  if (auditResults.length === 1) {
    if (auditResults[0].error) {
      return `[Audit error on segment 1: ${auditResults[0].error}]`;
    }
    return (auditResults[0].rawText || "").trim();
  }

  // Multi-chunk transcripts: label each segment for reviewer orientation.
  const parts = auditResults.map(result => {
    if (result.error) {
      return `--- Segment ${result.chunk_index} ---\n[Audit error on this segment: ${result.error}]`;
    }
    const text = (result.rawText || "").trim();
    if (!text) {
      return `--- Segment ${result.chunk_index} ---\nNo flags identified in this segment.`;
    }
    return `--- Segment ${result.chunk_index} ---\n${text}`;
  });

  return parts.join("\n\n");
}

/**
 * Scans compiled audit output for critical flag indicators.
 * Returns true if any critical signal is found, false otherwise.
 *
 * Critical signals are plain-text markers Gemini is instructed to use
 * via the Master Template prompt. Default marker: "[CRITICAL]".
 * Adding or changing markers requires only a Master Template edit — no code change.
 *
 * Current signals checked (case-insensitive):
 *   [CRITICAL] — explicit critical flag marker
 *   [HIGH]     — high-severity flag marker
 *
 * safety_critical = true means the episode needs human review before editing.
 * It does not mean the episode cannot be published — that is a human decision.
 *
 * @param {string} compiledOutput - Full compiled audit text
 */
function detectCriticalFlags(compiledOutput) {
  if (!compiledOutput) return false;
  const lower = compiledOutput.toLowerCase();
  return lower.includes("[critical]") || lower.includes("[high]");
}

// =============================================================================
// PRODUCTION NOTES WRITER
// =============================================================================

/**
 * Writes the compiled Safety Fairy audit output to the Production Notes doc.
 * Overwrites the existing CONTENT FLAGS section entirely — no history kept.
 * Re-running is intentional and safe.
 *
 * Strategy:
 *   1. Read all paragraphs in the doc.
 *   2. Find the paragraph whose text matches "CONTENT FLAGS:" (case-insensitive).
 *   3. Find the first content paragraph immediately after the heading.
 *      - If it exists: set its text to the new audit output directly (clear-and-rewrite).
 *      - If it does not exist: insert a new paragraph after the heading.
 *   4. Delete any additional paragraphs that follow the now-updated content paragraph,
 *      stopping before the next ALL-CAPS heading or end of doc.
 *   5. If CONTENT FLAGS: heading is not found, append it at the end of the doc.
 *
 * PATCH (idempotency fix): The previous approach deleted all paragraphs after the
 * heading before inserting new content. On re-run, if the audit output was the
 * final content in the doc, this caused a "Can't remove last paragraph in a
 * document section" crash. The new approach clears and rewrites the first content
 * paragraph rather than deleting it, guaranteeing at least one paragraph always
 * survives. Remaining surplus paragraphs are deleted after the rewrite is in place.
 *
 * @param {string} productionNotesId - Google Doc ID of the Production Notes doc
 * @param {string} compiledOutput    - Full compiled audit text to write
 * @param {string} episodeUid        - For audit logging
 * @param {string} agentName         - For audit logging
 */
function writeContentFlagsToProductionNotes(productionNotesId, compiledOutput, episodeUid, agentName) {
  try {
    const doc  = DocumentApp.openById(productionNotesId);
    const body = doc.getBody();

    const outputText = compiledOutput || "No flags identified.";

    // Find the CONTENT FLAGS: heading paragraph index
    let numChildren     = body.getNumChildren();
    let flagsHeadingIdx = -1;

    for (let i = 0; i < numChildren; i++) {
      const child = body.getChild(i);
      if (child.getType() === DocumentApp.ElementType.PARAGRAPH) {
        const text = child.asParagraph().getText().trim();
        if (text.toLowerCase() === "content flags:") {
          flagsHeadingIdx = i;
          break;
        }
      }
    }

    if (flagsHeadingIdx === -1) {
      // CONTENT FLAGS: heading not found — append heading + output at end of doc.
      logToAuditTrail(agentName, "error", episodeUid, "", "[WARNING] CONTENT FLAGS: heading not found in Production Notes. Appending at end of doc.", "WARNING");
      body.appendParagraph("CONTENT FLAGS:")
        .setHeading(DocumentApp.ParagraphHeading.HEADING2);
      body.appendParagraph(outputText);
      doc.saveAndClose();
      return;
    }

    // -------------------------------------------------------------------------
    // PATCH: Clear-and-rewrite approach.
    // Find the first content paragraph after the heading.
    // Set its text directly rather than deleting it — this avoids the
    // "Can't remove last paragraph" crash when the section has only one paragraph.
    // -------------------------------------------------------------------------

    // Identify the index of the first content paragraph after the heading.
    // A content paragraph is any paragraph that is not an ALL-CAPS heading.
    numChildren = body.getNumChildren(); // re-read after possible earlier operations
    let firstContentIdx = -1;

    for (let i = flagsHeadingIdx + 1; i < numChildren; i++) {
      const child = body.getChild(i);
      if (child.getType() !== DocumentApp.ElementType.PARAGRAPH) continue;

      const text          = child.asParagraph().getText().trim();
      const isNextSection = /^[A-Z][A-Z\s]{2,}:$/.test(text) && text !== "CONTENT FLAGS:";

      if (isNextSection) break; // Reached next section — stop looking

      // This is a content paragraph within the CONTENT FLAGS section.
      firstContentIdx = i;
      break;
    }

    if (firstContentIdx === -1) {
      // No content paragraph exists after the heading — insert one.
      body.insertParagraph(flagsHeadingIdx + 1, outputText);
    } else {
      // Content paragraph exists — overwrite its text in place.
      body.getChild(firstContentIdx).asParagraph().setText(outputText);

      // Now delete any surplus paragraphs that follow the rewritten paragraph,
      // stopping before the next ALL-CAPS section heading or end of doc.
      // Work backwards to avoid index shifting.
      const afterRewrite = body.getNumChildren();
      for (let i = afterRewrite - 1; i > firstContentIdx; i--) {
        const child = body.getChild(i);
        if (child.getType() !== DocumentApp.ElementType.PARAGRAPH) continue;

        const text          = child.asParagraph().getText().trim();
        const isNextSection = /^[A-Z][A-Z\s]{2,}:$/.test(text) && text !== "CONTENT FLAGS:";

        if (isNextSection) break; // Protect subsequent sections

        body.removeChild(child);
      }
    }

    doc.saveAndClose();

  } catch (e) {
    logToAuditTrail(agentName, "error", episodeUid, "", `[ERROR] writeContentFlagsToProductionNotes failed: ${e.message}`, "ERROR");
    throw e; // Re-throw — caller handles task spawn
  }
}


// =============================================================================
// TEST WRAPPER
// Remove or comment out after first successful run.
// =============================================================================

/**
 * Manual test entry point. Replace the Episode_UID with a real value.
 * Run from Apps Script editor to verify end-to-end behavior.
 */
function testSafetyFairy() {
  runSafetyFairy("EP-260411-2307"); // Replace with a real Episode_UID
}