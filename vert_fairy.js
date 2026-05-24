// =============================================================================
// FILE: vert_fairy.gs
// Fairy: The Vert Fairy (Show Notes Architect)
// Version: 1.0 | May 2026
// Author: Claude (Anthropic). Never edit directly in Apps Script or via Gemini.
//
// Replaces: Marcom Fairy (retired — AD #89).
//
// Trigger: Daily Pulse Loop D (transcript detected, episode_index_v2 not set).
//          Manual: dev_tools.js → test_buildEpisodeIndexV2.
// Entry points: buildEpisodeIndexV2(epUid, opts) — Track A
//               runEditorialPass(epUid, opts)     — Track B
//
// Track A: Reads finished transcript + guest brief via gatherVertContext.
//           Calls Claude to build Episode Knowledge Index v2 (neutral,
//           extract-not-interpret posture). Writes markdown file to
//           EPISODE_SEARCH_INDEX_KEY folder. Patches manifest.episode_index_v2.
//
// Track B: Reads Episode Index v2. Calls Claude with Master Template structure
//           to generate full show notes. Patches manifest.show_notes.
//
// Cross-file dependencies (all compiled together in same GAS project):
//   fairy_circle.gs   — getGovernance, getStagingFolderIdByUid, getManifest,
//                       patchManifest, getContactIdByEpisodeUid,
//                       getContactLibraryFolderIdByContactId, logToAuditTrail,
//                       spawnTask, callClaudeAPI, bumpVersion, getMasterSheetId
//   filing_fairy.gs   — findGuestBriefInContactLibrary
//
// Governance keys required:
//   EPISODE_SEARCH_INDEX_KEY — Drive folder ID for Episode Index docs
//   PODCAST_NAME             — "Don't Waste Your Pain"
//   ASSIGNEE_PRODUCER        — Audra's email (for error task spawn)
//   CLAUDE_MODEL             — Claude model (via callClaudeAPI in fairy_circle.gs)
//   CLAUDE_API_KEY           — Anthropic API key (via callClaudeAPI in fairy_circle.gs)
// =============================================================================



// =============================================================================
// CONTEXT GATHERING
// =============================================================================

/**
 * Gathers all episode context needed for show notes generation.
 *
 * Transcript lookup: Episode/ subfolder first (correct per asset structure),
 * then Staging root as fallback for any manually placed transcripts.
 *
 * Guest Brief lookup: Contact Library folder via Contact_ID → reads
 * findGuestBriefInContactLibrary() (in filing_fairy.gs).
 */
function gatherVertContext(epUid, agentName) {
  try {
    const stagingFolderId = getStagingFolderIdByUid(epUid);
    if (!stagingFolderId) throw new Error("Staging folder not found.");

    const manifest = getManifest(stagingFolderId);
    if (!manifest) throw new Error("Manifest not found.");

    // --- Guest Brief: Contact Library lookup ---
    let guestBriefText = "";
    try {
      const contactId = getContactIdByEpisodeUid(epUid);
      if (contactId) {
        const contactLibraryFolderId = getContactLibraryFolderIdByContactId(contactId);
        if (contactLibraryFolderId) {
          guestBriefText = findGuestBriefInContactLibrary(
            contactLibraryFolderId, epUid, agentName
          );
        } else {
          logToAuditTrail(agentName, "error", epUid, contactId,
            "Contact_Library_Folder_ID not found on Contacts tab. Guest Brief unavailable.", "warning");
        }
      } else {
        logToAuditTrail(agentName, "error", epUid, null,
          "Contact_ID not found for this episode. Guest Brief unavailable.", "warning");
      }
    } catch (e) {
      logToAuditTrail(agentName, "error", epUid, null,
        `Guest Brief lookup failed: ${e.message}. Continuing without brief.`, "warning");
    }

    // --- Transcript: Episode/ subfolder first, Staging root fallback ---
    const stagingFolder = DriveApp.getFolderById(stagingFolderId);
    let transcriptText  = null;

    const episodeFolderIt = stagingFolder.getFoldersByName("Episode");
    if (episodeFolderIt.hasNext()) {
      const episodeFolder = episodeFolderIt.next();
      transcriptText = findTranscriptInFolder(episodeFolder, agentName, epUid, "Episode/");
    }

    if (!transcriptText) {
      transcriptText = findTranscriptInFolder(stagingFolder, agentName, epUid, "Staging root");
    }

    if (!transcriptText && manifest.raw_folder_id) {
      try {
        const rawFolder = DriveApp.getFolderById(manifest.raw_folder_id);
        transcriptText  = findTranscriptInFolder(rawFolder, agentName, epUid, "Raw Production");
      } catch (e) {
        logToAuditTrail(agentName, "error", epUid, null,
          `Raw Production folder lookup failed: ${e.message}`, "warning");
      }
    }

    if (!transcriptText) {
      logToAuditTrail(agentName, "error", epUid, null,
        "No transcript found in Episode/, Staging root, or Raw Production. Vert Fairy cannot run without a finished transcript.", "error");
      throw new Error("No transcript found. Vert Fairy cannot proceed.");
    }

    return {
      epUid,
      stagingFolderId,
      manifest,
      guestName:      manifest.guest_name,
      guestBriefText: guestBriefText || "",
      transcriptText: transcriptText
    };

  } catch (e) {
    logToAuditTrail(agentName, "error", epUid, null,
      `gatherVertContext failed: ${e.message}`, "error");
    return null;
  }
}

/**
 * Scans a Drive folder for a finished transcript file.
 * Skips proxy_ prefixed files.
 * Prefers files with "finished", "final", or "clean" in the name.
 * Falls back to any readable file with "transcript" in the name.
 * Returns text content or null if not found.
 *
 */
function findTranscriptInFolder(driveFolder, agentName, epUid, folderLabel) {
  const files  = driveFolder.getFiles();
  let fallback = null;

  while (files.hasNext()) {
    const file     = files.next();
    const name     = file.getName().toLowerCase();
    const mimeType = file.getMimeType();

    if (name.startsWith("proxy_")) continue;

    const isTranscript = name.includes("transcript");
    const isFinished   = name.includes("finished") || name.includes("final") || name.includes("clean");
    const isReadable   = mimeType === MimeType.PLAIN_TEXT
                      || mimeType === MimeType.GOOGLE_DOCS
                      || name.endsWith(".txt");

    if (isTranscript && isReadable) {
      let text = "";
      if (mimeType === MimeType.GOOGLE_DOCS) {
        text = DocumentApp.openById(file.getId()).getBody().getText();
      } else {
        text = file.getBlob().getDataAsString();
      }

      if (isFinished) {
        logToAuditTrail(agentName, "state_change", epUid, null,
          `Finished transcript found in ${folderLabel}: ${file.getName()} (${text.length} chars).`, "info");
        return text;
      }
      fallback = text;
    }
  }

  if (fallback) {
    logToAuditTrail(agentName, "error", epUid, null,
      `No "finished/final/clean" transcript in ${folderLabel} — using first available transcript file.`, "warning");
    return fallback;
  }

  return null;
}



/**
 * Builds the prompt for the Episode Knowledge Index.
 * Transcript injected directly — Claude reads source, extract-not-interpret posture.
 * No show notes required at this stage; hooks/quotes are Track C.
 */
function buildEpisodeIndexPrompt(context) {
  const podcastName = getGovernance("PODCAST_NAME") || "Don't Waste Your Pain";

  const transcriptText = context.transcriptText || "Not available.";

  // AI Search Index — appended after substrate sections, fenced by boundary.
  // Composes # Pillars + # Voice Prohibitions as context for the curatorial block.
  var aiSearchIndexBlock = "";
  try {
    var aiSearchIndex = extractPrompt("# AI Search Index");
    var pillars       = extractPrompt("# Pillars");
    var voiceProhibs  = extractPrompt("# Voice Prohibitions");
    var composed      = [pillars, voiceProhibs, aiSearchIndex]
      .filter(function(s) { return s && s.trim(); }).join('\n\n');
    if (composed.trim()) {
      aiSearchIndexBlock =
        "\n\n---\n" +
        "The sections above are literal transcript extraction. " +
        "The following is interpretive/curatorial indexing — judgment is expected here and only here.\n\n" +
        composed;
    }
  } catch (e) {
    // AI Search Index section unavailable — proceed without
  }

  return `Create the Episode Knowledge Index for "${podcastName}" — a permanent reference document Studio loads on open.

EPISODE UID: ${context.epUid}
GUEST: ${context.guestName}

GUEST BRIEF:
${context.guestBriefText || "Not available."}

FINISHED TRANSCRIPT:
${transcriptText}

Posture: Extract, do not interpret. Record what speakers said in language close to their own. Do not attribute intent, motivation, or causation the speaker did not express. Synthesis and characterization belong downstream — this index stays neutral.

Produce the index in this exact structure:

# EPISODE INDEX
UID: ${context.epUid}
GUEST: ${context.guestName}

## EPISODE SUMMARY
[2–3 paragraphs. What this episode is about. Why someone would listen. What the guest brought in and what shifted. Neutral — no hooks, no marketing language.]

## GUEST PROFILE
[1–2 paragraphs. Guest background, expertise, what brought them to this topic. Source from guest brief and transcript.]

## KEY THEMES
[5 bullet points — the core concepts this episode explores]

## CAPTION SEEDS
[5–7 short social captions. 1–2 sentences each. Written for Instagram/Threads. No emojis. No rhetorical questions. Hook in the first clause.]

## TRANSCRIPT MAP
[Landmark-dense outline of the episode as it flows. 8–12 bullets. Each bullet: a key moment, topic shift, or emotional turn. Ordered as they appear. No timestamps — sequence is what matters.]

## REEL DESCRIPTIONS
[Leave blank]${aiSearchIndexBlock}`;
}


// =============================================================================
// EPISODE INDEX V2 — Claude-Based Build (Track A)
// Entry: buildEpisodeIndexV2(epUid, opts)
// Reads transcript directly via gatherVertContext. Claude synthesizes neutral
// knowledge index (extract-not-interpret). No Vertex RAG calls.
// =============================================================================

/**
 * Builds a permanent Episode Index v2 for the given episode.
 * Runs 10 marker-driven Vertex RAG queries, assembles results
 * into a structured Markdown doc in EPISODE_SEARCH_INDEX_KEY folder.
 * Writes file ID to manifest.episode_index_v2.
 *
 * @param {string} epUid - Episode UID
 * @param {object} [opts]
 * @param {boolean} [opts.force=false] - If true, trashes existing v2 doc and rebuilds
 * @return {object} - { status, fileId, fileName, markerCounts, sizeTokens, errors }
 */
function buildEpisodeIndexV2(epUid, opts) {
  var force     = !!(opts && opts.force === true);
  var agentName = "Vert_Fairy_IndexV2";
  var errors    = [];

  // ── 1. Read Episodes row in one pass ────────────────────────────────────────
  var sheetId = getMasterSheetId();
  if (!sheetId) throw new Error("buildEpisodeIndexV2: MASTER_SHEET_ID not set.");

  var ss = SpreadsheetApp.openById(sheetId);

  var epSheet   = ss.getSheetByName("Episodes");
  if (!epSheet) throw new Error("buildEpisodeIndexV2: Episodes tab not found.");
  var epData    = epSheet.getDataRange().getValues();
  var epHeaders = epData[0];

  var uidCol       = epHeaders.indexOf("Episode_UID");
  var guestNameCol = epHeaders.indexOf("Guest_Name");
  var relDateCol   = epHeaders.indexOf("Release_Date");
  var contactIdCol = epHeaders.indexOf("Contact_ID");
  var prodFolCol   = epHeaders.indexOf("Production_Folder_ID");

  if (uidCol === -1 || prodFolCol === -1) {
    throw new Error("buildEpisodeIndexV2: Episode_UID or Production_Folder_ID column missing from Episodes tab.");
  }

  var epRow   = null;
  var allUids = [];
  for (var i = 1; i < epData.length; i++) {
    allUids.push(String(epData[i][uidCol]));
    if (String(epData[i][uidCol]) === String(epUid)) { epRow = epData[i]; }
  }
  if (!epRow) {
    Logger.log('DEBUG sheetId resolved: ' + getMasterSheetId());
    Logger.log('DEBUG isStaging() returns: ' + isStaging());
    Logger.log('DEBUG searching for epUid: "' + epUid + '" (length ' + epUid.length + ')');
    Logger.log('DEBUG first 5 Episode_UIDs from sheet: ' + JSON.stringify(allUids.slice(0, 5)));
    Logger.log('DEBUG total rows scanned: ' + allUids.length);
    throw new Error("buildEpisodeIndexV2: episode not found: " + epUid);
  }

  var guestName       = guestNameCol !== -1 ? String(epRow[guestNameCol] || "")  : "";
  var releaseDate     = relDateCol   !== -1 ? epRow[relDateCol]                  : null;
  var contactId       = contactIdCol !== -1 ? String(epRow[contactIdCol] || "")  : "";
  var stagingFolderId = String(epRow[prodFolCol] || "");

  if (!stagingFolderId) {
    return { status: "skipped_no_transcript", errors: ["Production_Folder_ID not set for " + epUid] };
  }

  // ── 2. Manifest + idempotency check ─────────────────────────────────────────
  var manifest     = getManifest(stagingFolderId);
  var existingV2Id = manifest && manifest.episode_index_v2;

  if (existingV2Id) {
    // Verify file still exists and is not trashed
    var fileExists = false;
    try {
      var checkFile = DriveApp.getFileById(existingV2Id);
      fileExists = !checkFile.isTrashed();
    } catch (e) { /* file not found */ }

    if (!fileExists) {
      // Manifest points to a missing file — repair and rebuild
      logToAuditTrail(agentName, "state_change", epUid, null,
        "EPISODE_INDEX_V2_MANIFEST_REPAIR: file " + existingV2Id + " missing in Drive. Rebuilding.", "warning");
      patchManifest(stagingFolderId, { episode_index_v2: null });
      existingV2Id = null;
    } else if (!force) {
      return { status: "skipped_exists", fileId: existingV2Id };
    } else {
      // Force path — trash existing, clear manifest, continue
      try {
        DriveApp.getFileById(existingV2Id).setTrashed(true);
      } catch (e) { /* already gone */ }
      patchManifest(stagingFolderId, { episode_index_v2: null });
      logToAuditTrail(agentName, "state_change", epUid, null,
        "EPISODE_INDEX_V2_FORCE_DELETE: trashed " + existingV2Id, "info");
    }
  }

  // ── 3. Gather full episode context (transcript, guest brief) ─────────────────
  var context = gatherVertContext(epUid, agentName);
  if (!context) {
    throw new Error("buildEpisodeIndexV2: Could not gather episode context for " + epUid);
  }

  // ── 4. Build prompt + call Claude ────────────────────────────────────────────
  var systemInstruction =
    "You are building the Episode Knowledge Index for Studio — a permanent reference document " +
    "that loads on Studio open for this episode. Return only the markdown document. " +
    "No preamble, no explanation. Section headers must be exact — Studio parses them.";

  var prompt       = buildEpisodeIndexPrompt(context);
  var claudeResult = callClaudeAPI(prompt, systemInstruction, agentName, null, { maxTokens: 8192 });

  if (!claudeResult) {
    throw new Error("buildEpisodeIndexV2: Claude returned empty content for " + epUid);
  }

  logToAuditTrail(agentName, "state_change", epUid, null,
    "EPISODE_INDEX_V2_CLAUDE_COMPLETE: " + claudeResult.length + " chars", "info");

  // ── 5. Write to Drive ───────────────────────────────────────────────────────
  var indexFolderId = getGovernance("EPISODE_SEARCH_INDEX_KEY");
  if (!indexFolderId) throw new Error("buildEpisodeIndexV2: EPISODE_SEARCH_INDEX_KEY not configured.");

  var guestSlug = (context.guestName || "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
  var fileName    = "Episode_Index_v2_" + epUid + "_" + guestSlug + ".md";
  var indexFolder = DriveApp.getFolderById(indexFolderId);
  var newFile     = indexFolder.createFile(fileName, claudeResult, "text/markdown");
  var newFileId   = newFile.getId();

  // ── 6. Patch manifest ───────────────────────────────────────────────────────
  patchManifest(stagingFolderId, { episode_index_v2: newFileId });

  // ── 7. Audit log + version bump ─────────────────────────────────────────────
  var sizeTokens = Math.ceil(claudeResult.length / 4);

  logToAuditTrail(agentName, "state_change", epUid, null,
    "EPISODE_INDEX_V2_BUILT: fileId=" + newFileId + " fileName=" + fileName +
    " sizeTokens=" + sizeTokens + (errors.length ? " errors=" + JSON.stringify(errors) : ""), "info");

  bumpVersion("manifests", "buildEpisodeIndexV2");

  return {
    status:     "built",
    fileId:     newFileId,
    fileName:   fileName,
    sizeTokens: sizeTokens,
    errors:     errors
  };
}


// =============================================================================
// EDITORIAL PASS (Track B)
// Entry: runEditorialPass(epUid, opts)
// Reads transcript directly (same loader as Track A). Neither pass is downstream
// of the other. Calls Claude with Master Template v2.1 structure, writes complete
// Show Notes Doc to the episode's Staging folder.
// No Vertex calls. No Asset_Library writes.
// =============================================================================

/**
 * Reads Episode Index v2, calls Claude with Master Template v2.1 structure,
 * writes complete Show Notes Doc to the episode's Staging folder. Writes file ID
 * to manifest.show_notes.
 *
 * @param {string} epUid - Episode UID
 * @param {object} [opts]
 * @param {boolean} [opts.force=false] - If true, trashes existing Show Notes Doc and rewrites
 * @return {object} - { status, fileId, fileName, sizeChars, claudeMs }
 */
function runEditorialPass(epUid, opts) {
  var force     = !!(opts && opts.force === true);
  var agentName = "Vert_Fairy_Editorial";

  // ── 1. Read Episodes row ─────────────────────────────────────────────────────
  var sheetId = getMasterSheetId();
  if (!sheetId) throw new Error("runEditorialPass: MASTER_SHEET_ID not set.");

  var ss      = SpreadsheetApp.openById(sheetId);
  var epSheet = ss.getSheetByName("Episodes");
  if (!epSheet) throw new Error("runEditorialPass: Episodes tab not found.");

  var epData    = epSheet.getDataRange().getValues();
  var epHeaders = epData[0];

  var uidCol       = epHeaders.indexOf("Episode_UID");
  var guestNameCol = epHeaders.indexOf("Guest_Name");
  var relDateCol   = epHeaders.indexOf("Release_Date");
  var contactIdCol = epHeaders.indexOf("Contact_ID");
  var prodFolCol   = epHeaders.indexOf("Production_Folder_ID");

  if (uidCol === -1 || prodFolCol === -1) {
    throw new Error("runEditorialPass: Episode_UID or Production_Folder_ID column missing from Episodes tab.");
  }

  var epRow = null;
  for (var i = 1; i < epData.length; i++) {
    if (String(epData[i][uidCol]) === String(epUid)) { epRow = epData[i]; break; }
  }
  if (!epRow) throw new Error("runEditorialPass: episode not found: " + epUid);

  var guestName       = guestNameCol !== -1 ? String(epRow[guestNameCol] || "")  : "";
  var releaseDate     = relDateCol   !== -1 ? epRow[relDateCol]                  : null;
  var contactId       = contactIdCol !== -1 ? String(epRow[contactIdCol] || "")  : "";
  var stagingFolderId = String(epRow[prodFolCol] || "");

  if (!stagingFolderId) {
    throw new Error("runEditorialPass: Production_Folder_ID not set for " + epUid);
  }

  // ── 2. Manifest + idempotency check ─────────────────────────────────────────
  var manifest            = getManifest(stagingFolderId);
  var existingShowNotesId = manifest ? (manifest.show_notes || null) : null;

  if (existingShowNotesId) {
    var fileExists = false;
    try {
      var checkFile = DriveApp.getFileById(existingShowNotesId);
      fileExists = !checkFile.isTrashed();
    } catch (e) { /* file not found */ }

    if (!fileExists) {
      logToAuditTrail(agentName, "state_change", epUid, null,
        "SHOW_NOTES_MANIFEST_REPAIR: file " + existingShowNotesId + " missing in Drive. Rebuilding.", "warning");
      patchManifest(stagingFolderId, { show_notes: null });
    } else if (!force) {
      return { status: "skipped_exists", fileId: existingShowNotesId };
    } else {
      try { DriveApp.getFileById(existingShowNotesId).setTrashed(true); } catch (e) { /* already gone */ }
      patchManifest(stagingFolderId, { show_notes: null });
      logToAuditTrail(agentName, "state_change", epUid, null,
        "SHOW_NOTES_FORCE_DELETE: trashed " + existingShowNotesId, "info");
    }
  }

  // ── 3. Read inputs ───────────────────────────────────────────────────────────

  // Transcript + guest brief — shared context gatherer (same loader as Track A)
  var vertCtx = gatherVertContext(epUid, agentName);
  if (!vertCtx) throw new Error("runEditorialPass: Could not load episode context — see audit trail.");
  var transcriptText = vertCtx.transcriptText;
  var guestBriefText = vertCtx.guestBriefText || "";

  // Content Sensitivity doc
  var contentSensitivityText = "";
  try {
    var contentSensId = getGovernance("CONTENT_SENSITIVITY_ID");
    if (contentSensId) contentSensitivityText = DocumentApp.openById(contentSensId).getBody().getText();
  } catch (e) {
    logToAuditTrail(agentName, "state_change", epUid, null,
      "runEditorialPass: Content Sensitivity doc unreadable: " + e.message + ". Continuing without.", "warning");
  }

  // Master Template — compose voice + mechanics + structure from named sections
  var templatePrompt = "";
  try {
    var hostVoice      = extractPrompt("# Host Voice");
    var voiceProhibits = extractPrompt("# Voice Prohibitions");
    var captionMech    = extractPrompt("# Caption Mechanics");
    var ranking        = extractPrompt("# Ranking Schema");
    var showNotes      = extractPrompt("# Show Notes");
    templatePrompt = [hostVoice, voiceProhibits, captionMech, ranking, showNotes]
      .filter(function(s) { return s.trim(); }).join('\n\n');
  } catch (e) {
    throw new Error("runEditorialPass: Master Template sections unreadable: " + e.message);
  }
  if (!templatePrompt) {
    throw new Error("runEditorialPass: Master Template sections missing or empty — check # Host Voice, # Voice Prohibitions, # Caption Mechanics, # Ranking Schema, # Show Notes headings in template");
  }

  // ── 5. Release date string ───────────────────────────────────────────────────
  var releaseDateStr = "TBD";
  if (releaseDate) {
    releaseDateStr = (releaseDate instanceof Date)
      ? releaseDate.toISOString().slice(0, 10)
      : String(releaseDate).slice(0, 10);
  }

  // ── 6. Build prompt ──────────────────────────────────────────────────────────
  var systemInstruction = _buildEditorialPassSystemInstruction_(templatePrompt);
  var userPrompt        = _buildEditorialPassPrompt_(
    epUid, guestName, releaseDateStr, guestBriefText, contentSensitivityText, transcriptText
  );

  // ── 7. Call Claude ───────────────────────────────────────────────────────────
  var claudeStart  = Date.now();
  var claudeResult = callClaudeAPI(userPrompt, systemInstruction, agentName, null, { maxTokens: 16384 });
  var claudeMs     = Date.now() - claudeStart;

  if (!claudeResult) throw new Error("runEditorialPass: Claude returned empty content.");

  // ── 8. Write Show Notes Doc ──────────────────────────────────────────────────
  var guestSlug = guestName.toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
  var fileName = "Show_Notes_v2_" + epUid + "_" + guestSlug;

  var doc = DocumentApp.create(fileName);
  DriveApp.getFileById(doc.getId()).moveTo(DriveApp.getFolderById(stagingFolderId));

  var docBody = doc.getBody();
  docBody.clear();
  docBody.appendParagraph("SHOW NOTES — v2 (Editorial Pass)")
    .setHeading(DocumentApp.ParagraphHeading.HEADING1);
  docBody.appendParagraph(
    "Episode UID: " + epUid + " | Guest: " + guestName + " | Generated: " + new Date().toDateString()
  );
  docBody.appendParagraph("");
  claudeResult.split("\n").forEach(function(line) { docBody.appendParagraph(line); });
  doc.saveAndClose();

  var newDocId  = doc.getId();
  var sizeChars = claudeResult.length;

  // ── 9. Manifest write ────────────────────────────────────────────────────────
  patchManifest(stagingFolderId, { show_notes: newDocId });

  // ── 10. Audit log ────────────────────────────────────────────────────────────
  logToAuditTrail(agentName, "state_change", epUid, null,
    "SHOW_NOTES_GENERATED_V2: fileId=" + newDocId + " fileName=" + fileName +
    " sizeChars=" + sizeChars + " claudeMs=" + claudeMs, "info");

  // ── 11. Return ───────────────────────────────────────────────────────────────
  return { status: "generated", fileId: newDocId, fileName: fileName, sizeChars: sizeChars, claudeMs: claudeMs };
}


/**
 * Builds the system instruction for the editorial pass.
 * Voice authority comes from Master Template sections (# Host Voice, # Voice Prohibitions, # Caption Mechanics, # Ranking Schema, # Show Notes).
 * Hardcoded VOICE PROHIBITIONS block retained as belt-and-suspenders guard.
 */
function _buildEditorialPassSystemInstruction_(masterTemplateStructure) {
  return "VOICE PROHIBITIONS — these are automatic failures. If any appear in your output, rewrite before returning:\n" +
    "- Forbidden phrases: \"heart-centered,\" \"transformative journey,\" \"profound exploration,\" \"safe space,\" \"deeply moving,\" \"inspires us to,\" \"in a world where,\" \"sit with,\" \"holds space,\" \"unpacks,\" \"dives deep,\" \"game-changer,\" \"paradigm shift,\" \"on this journey,\" \"resonates,\" \"impactful,\" \"journey,\" \"faith-based\"\n" +
    "- This show is never to be described or categorized as faith-based. Do not imply it.\n" +
    "- Forbidden register: wellness-poster language, inspirational-calendar tone, Goop newsletter aesthetics, church bulletin\n" +
    "- Forbidden patterns: opening with a rhetorical question, bullet points that restate the same idea in different words, CTAs that use the word \"tune in\"\n\n" +
    "WHAT THIS SHOW SOUNDS LIKE:\n" +
    "- Short declarative sentences that land like a fist\n" +
    "- Specificity over generality — name the pain, do not describe it from a distance\n" +
    "- Darkness and humor are allowed to coexist\n" +
    "- The listener should feel seen, not inspired\n" +
    "- If a sentence could appear on a motivational poster, kill it\n\n" +
    "REQUIRED EPISODE CARD STRUCTURE (this is your exact required output format — not a suggestion):\n" +
    masterTemplateStructure + "\n\n" +
    "CRITICAL OUTPUT RULES:\n" +
    "- The template above is your exact required structure. It is not a suggestion.\n" +
    "- Every ALL CAPS line ending in a colon is a required section heading. Output it verbatim, then complete that section per its instructions.\n" +
    "- Work through every section in order. Do not skip any. Do not add any sections not in the template.\n" +
    "- Write in plain prose. No JSON. No markdown. No asterisks. No code fences.\n" +
    "- This output will be written directly to a Google Doc. Do not add preamble, sign-off, or commentary.\n" +
    "- Start immediately with the first section heading.";
}


/**
 * Builds the user-facing prompt for the editorial pass.
 * Full transcript injected directly — quotes selected from real words, not paraphrase.
 */
function _buildEditorialPassPrompt_(epUid, guestName, releaseDateStr, guestBriefText, contentSensitivityText, transcriptText) {
  return "Build the complete audience-facing content package for this episode.\n\n" +
    "GUEST: " + guestName + "\n" +
    "EPISODE UID: " + epUid + "\n" +
    "RELEASE DATE: " + releaseDateStr + "\n\n" +
    "GUEST BRIEF (Concierge Research):\n" +
    (guestBriefText || "Not available.") + "\n\n" +
    "CONTENT SENSITIVITY GUIDE:\n" +
    (contentSensitivityText || "Not available.") + "\n\n" +
    "FINISHED TRANSCRIPT:\n" +
    (transcriptText || "Not available.") + "\n\n" +
    "You are reading the raw transcript. Guest quotes must be verbatim — select from the speaker's actual words on the page. Every hook, caption, and quote in your output must be sourceable to a specific line in this transcript.\n\n" +
    "Surface the Medicine. Write copy that earns trust, not clicks. Complete every section.";
}


// =============================================================================
// BRIDGE (Track C)
// Entry: materializeQuoteGraphicAssets(epUid, opts)
// Reads Show Notes Doc (manifest.show_notes) written by runEditorialPass (Track B).
// Parses HOOKS, GUEST QUOTES, STARTER CAPTIONS — HOOKS, STARTER CAPTIONS — GUEST QUOTES.
// Writes one Asset_Library row per hook and per guest quote.
// No Claude/Gemini/Vert calls. No PNG creation. No image prompts.
// Render-on-send: Drive_File_ID, Canvas_State, Background_ID left empty at creation.
// Midnight pass owns Quality_Score, Slot_Tags. Manual trigger only.
// =============================================================================

/**
 * Slices a section out of full doc text by exact header strings.
 * Returns content between startHeader (exclusive) and endHeader (exclusive),
 * or to end of text if endHeader not found or not provided.
 * Returns '' if startHeader not found.
 */
function _bridgeSliceSection_(fullText, startHeader, endHeader) {
  // Normalize em-dash / en-dash / horizontal bar to hyphen-minus before matching
  // so header constants are robust to whatever Unicode dash the doc emits.
  var normDash = function(s) { return s.replace(/[–—―]/g, '-'); };
  var normText  = normDash(fullText);
  var normStart = normDash(startHeader);

  var startIdx = normText.indexOf(normStart);
  if (startIdx === -1) return '';
  var contentStart = startIdx + normStart.length;
  if (!endHeader) return fullText.slice(contentStart);
  var normEnd = normDash(endHeader);
  var endIdx  = normText.indexOf(normEnd, contentStart);
  return endIdx === -1 ? fullText.slice(contentStart) : fullText.slice(contentStart, endIdx);
}

/**
 * Parses a STARTER CAPTIONS block into a Map of label-number → caption body.
 * The caption body is everything between the entry's label line and the next
 * entry's label line (or end of block), trimmed.
 *
 * @param {string} block       — extracted section content
 * @param {string} labelPrefix — 'Hook' or 'Guest Quote'
 * @returns {Map<number, string>}
 */
function _bridgeParseLabeledCaptions_(block, labelPrefix) {
  var result     = new Map();
  // Group 1 = number, Group 2 = inline caption text (may be empty for multi-line formats)
  var labelRegex = new RegExp('^' + labelPrefix + '\\s+(\\d+):\\s*(.*)$', 'gm');
  var matches    = Array.from(block.matchAll(labelRegex));
  for (var i = 0; i < matches.length; i++) {
    var m          = matches[i];
    var num        = parseInt(m[1], 10);
    var inlineText = (m[2] || '').trim();
    var bodyStart  = m.index + m[0].length;
    var bodyEnd    = (i + 1 < matches.length) ? matches[i + 1].index : block.length;
    var bodyText   = block.slice(bodyStart, bodyEnd).trim();
    // Inline text takes priority (single-line format); fall back to body for multi-line
    result.set(num, inlineText || bodyText);
  }
  return result;
}

/**
 * Appends the CAPTION_SIGNOFF governance value to a caption string.
 * Idempotent — skips append if the signoff is already present.
 * Returns captionText unchanged if signoff is empty or captionText is empty.
 */
function _appendCaptionSignoff_(captionText) {
  var signoff = (getGovernance("CAPTION_SIGNOFF") || "").trim();
  if (!signoff || !captionText) return captionText;
  var trimmed = captionText.trimEnd();
  if (trimmed.slice(-signoff.length) === signoff) return captionText;
  return trimmed + "\n\n" + signoff;
}


/**
 * Parses a HOOKS or GUEST QUOTES section (v2.3 format) into ranked items.
 * Each block has a numbered label line (e.g. HOOK 1: or QUOTE 1:) followed by
 * SLOT_TAGS: and QUALITY_SCORE: lines.
 *
 * @param {string} sectionText  — extracted section content
 * @param {string} labelPrefix  — 'HOOK' or 'QUOTE' (all-caps, matches template)
 * @returns {Array<{index: number, text: string, slot_tags: string[], quality_score: number}>}
 */
function _bridgeParseRankedItems_(sectionText, labelPrefix) {
  var VALID_TAGS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Any"];
  var agentName  = 'Bridge_Fairy';
  var result     = [];
  var labelRegex = new RegExp('^' + labelPrefix + '\\s+(\\d+):\\s*(.*)$', 'gm');
  var matches    = Array.from(sectionText.matchAll(labelRegex));

  for (var i = 0; i < matches.length; i++) {
    var m     = matches[i];
    var index = parseInt(m[1], 10);
    var text  = m[2].trim();

    var blockStart = m.index + m[0].length;
    var blockEnd   = (i + 1 < matches.length) ? matches[i + 1].index : sectionText.length;
    var block      = sectionText.slice(blockStart, blockEnd);

    // ATTRIBUTION (QUOTE blocks only — v3.0 format: separate labeled line)
    if (labelPrefix === 'QUOTE') {
      var attrMatch = block.match(/^ATTRIBUTION:\s*(.+)$/m);
      if (attrMatch) {
        text = text + ' — ' + attrMatch[1].trim();
      } else {
        logToAuditTrail(agentName, 'state_change', '', null,
          '_bridgeParseRankedItems_: ATTRIBUTION missing for QUOTE ' + index + ' — using bare quote text', 'WARNING');
      }
    }

    // SLOT_TAGS
    var slotTagsMatch = block.match(/^SLOT_TAGS:\s*(.+)$/m);
    var slot_tags;
    if (slotTagsMatch) {
      var rawTags = slotTagsMatch[1].split(',').map(function(t) { return t.trim(); }).filter(Boolean);
      slot_tags   = rawTags.filter(function(t) { return VALID_TAGS.indexOf(t) !== -1; });
      var dropped = rawTags.filter(function(t) { return VALID_TAGS.indexOf(t) === -1; });
      if (dropped.length) {
        logToAuditTrail(agentName, 'state_change', '', null,
          '_bridgeParseRankedItems_: Dropped unrecognized tags [' + dropped.join(', ') + '] for ' + labelPrefix + ' ' + index, 'WARNING');
      }
      if (!slot_tags.length) {
        slot_tags = ['Any'];
        logToAuditTrail(agentName, 'state_change', '', null,
          '_bridgeParseRankedItems_: All tags invalid for ' + labelPrefix + ' ' + index + ' — defaulting to Any', 'WARNING');
      }
    } else {
      slot_tags = ['Any'];
      logToAuditTrail(agentName, 'state_change', '', null,
        '_bridgeParseRankedItems_: SLOT_TAGS missing for ' + labelPrefix + ' ' + index + ' — defaulting to Any', 'WARNING');
    }

    // QUALITY_SCORE
    var qualMatch    = block.match(/^QUALITY_SCORE:\s*(\d+)$/m);
    var quality_score;
    if (qualMatch) {
      quality_score = parseInt(qualMatch[1], 10);
      if (quality_score < 1 || quality_score > 5) {
        logToAuditTrail(agentName, 'state_change', '', null,
          '_bridgeParseRankedItems_: QUALITY_SCORE ' + quality_score + ' out of [1,5] for ' + labelPrefix + ' ' + index + ' — clamping', 'WARNING');
        quality_score = Math.max(1, Math.min(5, quality_score));
      }
    } else {
      quality_score = 3;
      logToAuditTrail(agentName, 'state_change', '', null,
        '_bridgeParseRankedItems_: QUALITY_SCORE missing for ' + labelPrefix + ' ' + index + ' — defaulting to 3', 'WARNING');
    }

    result.push({ index: index, text: text, slot_tags: slot_tags, quality_score: quality_score });
  }

  return result;
}


/**
 * Reads Show Notes Doc (manifest.show_notes), parses HOOKS + GUEST QUOTES + labeled
 * STARTER CAPTIONS, writes one Asset_Library row per hook and per guest quote.
 * Caption_Host is the label-paired starter caption.
 * Render-on-send: Drive_File_ID, Canvas_State, Background_ID, Image_Prompt left empty.
 * Midnight pass owns Quality_Score, Slot_Tags — both left empty.
 *
 * @param {string} epUid
 * @param {Object} opts        — { force?: boolean }
 *                                force=true: existing rows where Created_By='system'
 *                                AND Canvas_State='' are flipped to Status='rejected',
 *                                Availability='rejected' (preserved under "rows are never
 *                                deleted"), then fresh rows are written.
 *                                Rows JT has touched (Canvas_State non-empty)
 *                                are preserved untouched.
 * @returns {Object}           — { status: 'created' | 'skipped' | 'rebuilt' | 'error',
 *                                  hookCount, quoteCount, totalRows, errors }
 */
function materializeQuoteGraphicAssets(epUid, opts) {
  var force     = !!(opts && opts.force === true);
  var agentName = 'Bridge_Fairy';
  var errors    = [];

  // Section header delimiters — em-dash is U+2014, verbatim from Master Template v2.1.
  // HEADER_HOST_INSTAGRAM_CAPTIONS is the end-of-block sentinel for STARTER CAPTIONS — GUEST QUOTES.
  var HEADER_HOOKS                   = 'HOOKS:';
  var HEADER_GUEST_QUOTES            = 'GUEST QUOTES:';
  var HEADER_STARTER_CAPTIONS_HOOKS  = 'STARTER CAPTIONS — HOOKS:';
  var HEADER_STARTER_CAPTIONS_QUOTES = 'STARTER CAPTIONS — GUEST QUOTES:';
  var HEADER_HOST_INSTAGRAM_CAPTIONS = 'HOST INSTAGRAM CAPTIONS:';

  logToAuditTrail(agentName, 'state_change', epUid, null,
    'materializeQuoteGraphicAssets START force=' + force, 'INFO');

  // ── 1. Resolve manifest + show notes doc ────────────────────────────────────
  var stagingFolderId = getStagingFolderIdByUid(epUid);
  if (!stagingFolderId) {
    logToAuditTrail(agentName, 'error', epUid, null,
      'SHOW_NOTES_MISSING: staging folder not found for ' + epUid, 'ERROR');
    return { status: 'error', errors: ['staging folder not found'] };
  }

  var manifest = getManifest(stagingFolderId);
  if (!manifest) {
    logToAuditTrail(agentName, 'error', epUid, null,
      'SHOW_NOTES_MISSING: manifest not found in staging folder', 'ERROR');
    return { status: 'error', errors: ['manifest not found'] };
  }

  var showNotesId = manifest.show_notes;
  if (!showNotesId) {
    logToAuditTrail(agentName, 'error', epUid, null,
      'SHOW_NOTES_MISSING: manifest.show_notes is empty — Track B must run first', 'ERROR');
    return { status: 'error', errors: ['show_notes missing — Track B must run first'] };
  }

  // ── 2. Idempotency check ────────────────────────────────────────────────────
  var sheetId = getMasterSheetId();
  var ss      = SpreadsheetApp.openById(sheetId);
  var alName  = getGovernance('ASSET_LIBRARY_TAB_NAME') || 'Asset_Library';
  var alSheet = ss.getSheetByName(alName);
  if (!alSheet) {
    logToAuditTrail(agentName, 'error', epUid, null,
      'Asset_Library tab not found', 'ERROR');
    return { status: 'error', errors: ['Asset_Library tab not found'] };
  }

  var alData       = alSheet.getDataRange().getValues();
  var existingRows = [];
  for (var r = 1; r < alData.length; r++) {
    if (String(alData[r][ASSET_LIBRARY_COLS.Episode_UID - 1]) === String(epUid) &&
        String(alData[r][ASSET_LIBRARY_COLS.Asset_Type  - 1]) === 'quote_graphic') {
      existingRows.push({ rowNum: r + 1, row: alData[r] });
    }
  }

  if (existingRows.length > 0) {
    if (!force) {
      logToAuditTrail(agentName, 'state_change', epUid, null,
        'BRIDGE_SKIPPED: ' + existingRows.length + ' existing Quote_Graphic rows found', 'INFO');
      return { status: 'skipped', existingCount: existingRows.length };
    }

    // force path: flip system-untouched rows; preserve rows JT has touched
    var flippedCount   = 0;
    var protectedCount = 0;
    for (var ei = 0; ei < existingRows.length; ei++) {
      var er           = existingRows[ei];
      var createdBy    = String(er.row[ASSET_LIBRARY_COLS.Created_By    - 1] || '');
      var canvasState  = String(er.row[ASSET_LIBRARY_COLS.Canvas_State  - 1] || '');
      if (createdBy === 'system' && canvasState === '') {
        alSheet.getRange(er.rowNum, ASSET_LIBRARY_COLS.Status).setValue('rejected');
        alSheet.getRange(er.rowNum, ASSET_LIBRARY_COLS.Availability).setValue('rejected');
        flippedCount++;
      } else {
        protectedCount++;
      }
    }
    logToAuditTrail(agentName, 'state_change', epUid, null,
      'BRIDGE_REBUILD: flipped=' + flippedCount + ' protected=' + protectedCount, 'INFO');
  }

  // ── 3. Parse Show Notes Doc ─────────────────────────────────────────────────
  var docText;
  try {
    docText = DocumentApp.openById(showNotesId).getBody().getText();
  } catch (e) {
    logToAuditTrail(agentName, 'error', epUid, null,
      'Cannot read Show Notes Doc (' + showNotesId + '): ' + e.message, 'ERROR');
    return { status: 'error', errors: ['Cannot read Show Notes Doc: ' + e.message] };
  }

  // Slice sections using precise header string boundaries — avoids extractSectionFromProse
  // regex limitations with em-dash headings and Note: false-terminators.
  var hooksBlock         = _bridgeSliceSection_(docText, HEADER_HOOKS,                   HEADER_GUEST_QUOTES);
  var quotesBlock        = _bridgeSliceSection_(docText, HEADER_GUEST_QUOTES,            HEADER_STARTER_CAPTIONS_HOOKS);
  var hookCaptionsBlock  = _bridgeSliceSection_(docText, HEADER_STARTER_CAPTIONS_HOOKS,  HEADER_STARTER_CAPTIONS_QUOTES);
  var quoteCaptionsBlock = _bridgeSliceSection_(docText, HEADER_STARTER_CAPTIONS_QUOTES, HEADER_HOST_INSTAGRAM_CAPTIONS);

  if (!hooksBlock)         logToAuditTrail(agentName, 'state_change', epUid, null, '[WARNING] HOOKS section not found in Show Notes Doc', 'WARNING');
  if (!quotesBlock)        logToAuditTrail(agentName, 'state_change', epUid, null, '[WARNING] GUEST QUOTES section not found in Show Notes Doc', 'WARNING');
  if (!hookCaptionsBlock)  logToAuditTrail(agentName, 'state_change', epUid, null, '[WARNING] STARTER CAPTIONS — HOOKS section not found in Show Notes Doc', 'WARNING');
  if (!quoteCaptionsBlock) logToAuditTrail(agentName, 'state_change', epUid, null, '[WARNING] STARTER CAPTIONS — GUEST QUOTES section not found in Show Notes Doc', 'WARNING');

  // HOOKS: v2.3 format — HOOK N: / SLOT_TAGS: / QUALITY_SCORE: blocks
  var hookItems = _bridgeParseRankedItems_(hooksBlock || '', 'HOOK');
  var hooks     = hookItems.map(function(h) { return h.text; });

  // GUEST QUOTES: v2.3 format — QUOTE N: / SLOT_TAGS: / QUALITY_SCORE: blocks
  var quoteItems = _bridgeParseRankedItems_(quotesBlock || '', 'QUOTE');
  var quotes     = quoteItems.map(function(q) { return q.text; });

  // STARTER CAPTIONS: multi-line body parser. Returns Map<number, string> where
  // the value is everything between the label line and the next label line, trimmed.
  var hookCaptions  = _bridgeParseLabeledCaptions_(hookCaptionsBlock  || '', 'Hook');
  var quoteCaptions = _bridgeParseLabeledCaptions_(quoteCaptionsBlock || '', 'Guest Quote');

  // ── 4. Validate parsed counts ───────────────────────────────────────────────
  var hookCaptionCount  = hookCaptions.size;
  var quoteCaptionCount = quoteCaptions.size;

  if (hooks.length !== 10) {
    var msg = 'Expected 10 hooks, got ' + hooks.length;
    logToAuditTrail(agentName, 'state_change', epUid, null, '[WARNING] ' + msg, 'WARNING');
    errors.push(msg);
  }
  if (quotes.length !== 6) {
    var msg = 'Expected 6 guest quotes, got ' + quotes.length;
    logToAuditTrail(agentName, 'state_change', epUid, null, '[WARNING] ' + msg, 'WARNING');
    errors.push(msg);
  }
  if (hookCaptionCount !== 10) {
    var msg = 'Expected 10 hook captions, got ' + hookCaptionCount;
    logToAuditTrail(agentName, 'state_change', epUid, null, '[WARNING] ' + msg, 'WARNING');
    errors.push(msg);
  }
  if (quoteCaptionCount !== 6) {
    var msg = 'Expected 6 quote captions, got ' + quoteCaptionCount;
    logToAuditTrail(agentName, 'state_change', epUid, null, '[WARNING] ' + msg, 'WARNING');
    errors.push(msg);
  }

  if (hooks.length === 0 && quotes.length === 0) {
    logToAuditTrail(agentName, 'error', epUid, null,
      'No hooks or quotes parsed from Show Notes Doc ' + showNotesId, 'ERROR');
    return { status: 'error', hookCount: 0, quoteCount: 0, totalRows: 0,
             errors: ['no hooks or quotes parsed from Show Notes Doc'] };
  }

  // ── 5. Build Asset_Library row array ────────────────────────────────────────
  // Row width matched to actual sheet column count — guards against ASSET_LIBRARY_COLS
  // having more entries than the live sheet has columns.
  var numCols = alSheet.getLastColumn();
  var rows    = [];
  var now     = new Date();

  for (var i = 0; i < hooks.length; i++) {
    var hookRow = new Array(numCols).fill('');
    hookRow[ASSET_LIBRARY_COLS.Asset_ID      - 1] = Utilities.getUuid();
    hookRow[ASSET_LIBRARY_COLS.Episode_UID   - 1] = epUid;
    hookRow[ASSET_LIBRARY_COLS.Asset_Type    - 1] = 'quote_graphic';
    hookRow[ASSET_LIBRARY_COLS.Drive_File_ID - 1] = '';
    hookRow[ASSET_LIBRARY_COLS.Display_Name  - 1] = 'Hook ' + (i + 1);
    // RETIRED Slide_Index write (May 2026) — Item 92 Phase 1 retired pairing logic; v2.3 retired write path.
    hookRow[ASSET_LIBRARY_COLS.Quote_Text    - 1] = hooks[i];
    hookRow[ASSET_LIBRARY_COLS.Reel_Summary  - 1] = '';
    hookRow[ASSET_LIBRARY_COLS.Image_Prompt  - 1] = '';
    hookRow[ASSET_LIBRARY_COLS.Caption_Host  - 1] = _appendCaptionSignoff_(hookCaptions.get(i + 1) || '');
    hookRow[ASSET_LIBRARY_COLS.Caption_Guest - 1] = '';
    hookRow[ASSET_LIBRARY_COLS.Notes         - 1] = '';
    hookRow[ASSET_LIBRARY_COLS.Background_ID - 1] = '';
    hookRow[ASSET_LIBRARY_COLS.Canvas_State  - 1] = '';
    hookRow[ASSET_LIBRARY_COLS.Status        - 1] = 'candidate';
    hookRow[ASSET_LIBRARY_COLS.Availability  - 1] = 'available';
    hookRow[ASSET_LIBRARY_COLS.Created_At    - 1] = now;
    hookRow[ASSET_LIBRARY_COLS.Created_By    - 1] = 'system';
    hookRow[ASSET_LIBRARY_COLS.Quality_Score - 1] = hookItems[i] ? hookItems[i].quality_score : '';
    hookRow[ASSET_LIBRARY_COLS.Slot_Tags     - 1] = hookItems[i] ? hookItems[i].slot_tags.join(', ') : '';
    rows.push(hookRow);
  }

  for (var j = 0; j < quotes.length; j++) {
    var quoteRow = new Array(numCols).fill('');
    quoteRow[ASSET_LIBRARY_COLS.Asset_ID      - 1] = Utilities.getUuid();
    quoteRow[ASSET_LIBRARY_COLS.Episode_UID   - 1] = epUid;
    quoteRow[ASSET_LIBRARY_COLS.Asset_Type    - 1] = 'quote_graphic';
    quoteRow[ASSET_LIBRARY_COLS.Drive_File_ID - 1] = '';
    quoteRow[ASSET_LIBRARY_COLS.Display_Name  - 1] = 'Guest Quote ' + (j + 1);
    // RETIRED Slide_Index write (May 2026) — Item 92 Phase 1 retired pairing logic; v2.3 retired write path.
    quoteRow[ASSET_LIBRARY_COLS.Quote_Text    - 1] = quotes[j];
    quoteRow[ASSET_LIBRARY_COLS.Reel_Summary  - 1] = '';
    quoteRow[ASSET_LIBRARY_COLS.Image_Prompt  - 1] = '';
    quoteRow[ASSET_LIBRARY_COLS.Caption_Host  - 1] = _appendCaptionSignoff_(quoteCaptions.get(j + 1) || '');
    quoteRow[ASSET_LIBRARY_COLS.Caption_Guest - 1] = '';
    quoteRow[ASSET_LIBRARY_COLS.Notes         - 1] = '';
    quoteRow[ASSET_LIBRARY_COLS.Background_ID - 1] = '';
    quoteRow[ASSET_LIBRARY_COLS.Canvas_State  - 1] = '';
    quoteRow[ASSET_LIBRARY_COLS.Status        - 1] = 'candidate';
    quoteRow[ASSET_LIBRARY_COLS.Availability  - 1] = 'available';
    quoteRow[ASSET_LIBRARY_COLS.Created_At    - 1] = now;
    quoteRow[ASSET_LIBRARY_COLS.Created_By    - 1] = 'system';
    quoteRow[ASSET_LIBRARY_COLS.Quality_Score - 1] = quoteItems[j] ? quoteItems[j].quality_score : '';
    quoteRow[ASSET_LIBRARY_COLS.Slot_Tags     - 1] = quoteItems[j] ? quoteItems[j].slot_tags.join(', ') : '';
    rows.push(quoteRow);
  }

  // ── 6. Write batch to Asset_Library ────────────────────────────────────────
  var totalRows = rows.length;
  try {
    var lastRow = alSheet.getLastRow();
    alSheet.getRange(lastRow + 1, 1, rows.length, numCols).setValues(rows);
    bumpVersion('asset_library', 'materializeQuoteGraphicAssets');
  } catch (e) {
    logToAuditTrail(agentName, 'error', epUid, null,
      'Asset_Library write failed: ' + e.message, 'ERROR');
    errors.push(e.message);
    return { status: 'error', hookCount: hooks.length, quoteCount: quotes.length,
             totalRows: 0, errors: errors };
  }

  // ── 7. Patch manifest ───────────────────────────────────────────────────────
  patchManifest(stagingFolderId, {
    quote_graphic_assets_built: true,
    quote_graphic_asset_count:  hooks.length + quotes.length
  });

  // ── 8. Audit log on completion ──────────────────────────────────────────────
  logToAuditTrail(agentName, 'state_change', epUid, null,
    'QUOTE_GRAPHIC_ASSETS_MATERIALIZED: Created ' + totalRows + ' rows — ' +
    hooks.length + ' hooks + ' + quotes.length + ' quotes', 'INFO');

  // ── 9. Return summary ───────────────────────────────────────────────────────
  return {
    status:     existingRows.length > 0 ? 'rebuilt' : 'created',
    hookCount:  hooks.length,
    quoteCount: quotes.length,
    totalRows:  totalRows,
    errors:     errors
  };
}


// =============================================================================
// REEL EDITORIAL PASS (Track D)
// Entry: runReelEditorialPass(epUid, opts)
// Reads Reel-type Asset_Library rows, passes raw Reel_Summary values to Claude
// with composed Voice Prohibitions + Ranking Schema + Reel Editorial sections.
// Writes cleaned Reel_Summary, Slot_Tags, Quality_Score back to each row.
// Manual trigger only — no Daily Pulse wiring in this spoke.
// =============================================================================

/**
 * Parses Claude's reel editorial response into an array of structured objects.
 * Expected block format per reel:
 *   REEL [Asset_ID]:
 *   SUMMARY: [2-3 sentence cleaned summary]
 *   SLOT_TAGS: [comma-separated days]
 *   QUALITY_SCORE: [1-5]
 *
 * @param {string} responseText — full Claude response
 * @returns {Array<{asset_id: string, summary: string, slot_tags: string[], quality_score: number}>}
 */
function _parseReelEditorialOutput_(responseText) {
  var VALID_TAGS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Any"];
  var agentName  = 'Bridge_Fairy';
  var result     = [];

  // Split on blank lines; each non-empty block that opens with REEL is one entry
  var blocks = responseText.split(/\n\s*\n/);

  for (var i = 0; i < blocks.length; i++) {
    var block = blocks[i].trim();
    if (!block) continue;

    var assetIdMatch = block.match(/^REEL\s+([^:\n]+):/i);
    if (!assetIdMatch) continue;
    var assetId = assetIdMatch[1].trim();

    var summaryMatch = block.match(/^SUMMARY:\s*(.+)$/m);
    var summary = summaryMatch ? summaryMatch[1].trim() : '';

    // SLOT_TAGS
    var slotTagsMatch = block.match(/^SLOT_TAGS:\s*(.+)$/m);
    var slot_tags;
    if (slotTagsMatch) {
      var rawTags = slotTagsMatch[1].split(',').map(function(t) { return t.trim(); }).filter(Boolean);
      slot_tags   = rawTags.filter(function(t) { return VALID_TAGS.indexOf(t) !== -1; });
      var dropped = rawTags.filter(function(t) { return VALID_TAGS.indexOf(t) === -1; });
      if (dropped.length) {
        logToAuditTrail(agentName, 'state_change', '', null,
          '_parseReelEditorialOutput_: Dropped unrecognized tags [' + dropped.join(', ') + '] for REEL ' + assetId, 'WARNING');
      }
      if (!slot_tags.length) {
        slot_tags = ['Any'];
        logToAuditTrail(agentName, 'state_change', '', null,
          '_parseReelEditorialOutput_: All tags invalid for REEL ' + assetId + ' — defaulting to Any', 'WARNING');
      }
    } else {
      slot_tags = ['Any'];
      logToAuditTrail(agentName, 'state_change', '', null,
        '_parseReelEditorialOutput_: SLOT_TAGS missing for REEL ' + assetId + ' — defaulting to Any', 'WARNING');
    }

    // QUALITY_SCORE
    var qualMatch = block.match(/^QUALITY_SCORE:\s*(\d+)$/m);
    var quality_score;
    if (qualMatch) {
      quality_score = parseInt(qualMatch[1], 10);
      if (quality_score < 1 || quality_score > 5) {
        logToAuditTrail(agentName, 'state_change', '', null,
          '_parseReelEditorialOutput_: QUALITY_SCORE ' + quality_score + ' out of [1,5] for REEL ' + assetId + ' — clamping', 'WARNING');
        quality_score = Math.max(1, Math.min(5, quality_score));
      }
    } else {
      quality_score = 3;
      logToAuditTrail(agentName, 'state_change', '', null,
        '_parseReelEditorialOutput_: QUALITY_SCORE missing for REEL ' + assetId + ' — defaulting to 3', 'WARNING');
    }

    result.push({ asset_id: assetId, summary: summary, slot_tags: slot_tags, quality_score: quality_score });
  }

  return result;
}


/**
 * Reads Reel-type Asset_Library rows for an episode, passes raw Reel_Summary
 * values to Claude (with composed Voice Prohibitions + Ranking Schema + Reel Editorial),
 * and writes cleaned summary, Slot_Tags, Quality_Score back to each row.
 *
 * @param {string} epUid
 * @param {Object} [opts]
 * @param {boolean} [opts.force=false] — if true, reprocesses rows that already have Quality_Score
 * @returns {{ status: string, processed: number, skipped: number, errors: string[] }}
 */
function runReelEditorialPass(epUid, opts) {
  var force     = !!(opts && opts.force === true);
  var agentName = 'Bridge_Fairy';

  // ── 1. Read Asset_Library ──────────────────────────────────────────────────────
  var sheetId = getMasterSheetId();
  if (!sheetId) throw new Error("runReelEditorialPass: MASTER_SHEET_ID not set.");

  var ss     = SpreadsheetApp.openById(sheetId);
  var alName = getGovernance('ASSET_LIBRARY_TAB_NAME') || 'Asset_Library';
  var alSheet = ss.getSheetByName(alName);
  if (!alSheet) throw new Error("runReelEditorialPass: Asset_Library tab not found.");

  var alData = alSheet.getDataRange().getValues();

  // ── 2. Filter reel rows ────────────────────────────────────────────────────────
  var targetRows = [];
  var skipCount  = 0;

  for (var i = 1; i < alData.length; i++) {
    var row = alData[i];
    if (String(row[ASSET_LIBRARY_COLS.Episode_UID - 1]) !== String(epUid)) continue;
    if (String(row[ASSET_LIBRARY_COLS.Asset_Type  - 1]).toLowerCase() !== 'reel') continue;

    var summary      = String(row[ASSET_LIBRARY_COLS.Reel_Summary  - 1] || '').trim();
    var qualityScore = String(row[ASSET_LIBRARY_COLS.Quality_Score - 1] || '').trim();
    var assetId      = String(row[ASSET_LIBRARY_COLS.Asset_ID      - 1] || '');

    if (!summary) {
      logToAuditTrail(agentName, 'state_change', epUid, null,
        'REEL_EDITORIAL_SKIP: ' + assetId + ' — Reel_Summary empty', 'INFO');
      skipCount++;
      continue;
    }

    if (qualityScore && !force) {
      logToAuditTrail(agentName, 'state_change', epUid, null,
        'REEL_EDITORIAL_SKIP: ' + assetId + ' — Quality_Score already set (' + qualityScore + '), force=false', 'INFO');
      skipCount++;
      continue;
    }

    targetRows.push({ rowNum: i + 1, assetId: assetId, summary: summary });
  }

  // ── 3. Early exit if nothing to do ───────────────────────────────────────────
  if (targetRows.length === 0) {
    logToAuditTrail(agentName, 'state_change', epUid, null,
      'REEL_EDITORIAL_NO_WORK: skipped=' + skipCount, 'INFO');
    return { status: 'no_work', processed: 0, skipped: skipCount, errors: [] };
  }

  logToAuditTrail(agentName, 'state_change', epUid, null,
    'REEL_EDITORIAL_START: epUid=' + epUid + ' reelCount=' + targetRows.length, 'INFO');

  // ── 4. Compose system prompt ──────────────────────────────────────────────────
  var voice    = extractPrompt("# Voice Prohibitions");
  var ranking  = extractPrompt("# Ranking Schema");
  var reelEd   = extractPrompt("# Reel Editorial");
  var systemPrompt = [voice, ranking, reelEd].filter(function(s) { return s.trim(); }).join('\n\n');

  if (!systemPrompt) {
    throw new Error("runReelEditorialPass: Master Template sections missing — check # Voice Prohibitions, # Ranking Schema, # Reel Editorial");
  }

  // ── 5. Build user message ─────────────────────────────────────────────────────
  var userLines = [
    "Process the following reels. For each, return a block in the exact format specified in the Reel Editorial template.",
    ""
  ];
  for (var t = 0; t < targetRows.length; t++) {
    userLines.push("REEL " + targetRows[t].assetId + ":");
    userLines.push("RAW_SUMMARY: " + targetRows[t].summary);
    userLines.push("");
  }
  var userMessage = userLines.join('\n');

  // ── 6. Call Claude ────────────────────────────────────────────────────────────
  var claudeResponse = callClaudeAPI(systemPrompt, userMessage, agentName, null, { maxTokens: 8192 });
  if (!claudeResponse) throw new Error("runReelEditorialPass: Claude returned empty response.");

  // ── 7. Parse response ─────────────────────────────────────────────────────────
  var parsedReels = _parseReelEditorialOutput_(claudeResponse);

  // ── 8. Write back to Asset_Library ───────────────────────────────────────────
  var processedCount = 0;
  var errors         = [];

  // Re-read for fresh row indices (Claude call may take several seconds)
  alData = alSheet.getDataRange().getValues();

  for (var p = 0; p < parsedReels.length; p++) {
    var parsed = parsedReels[p];
    try {
      var foundRow = -1;
      for (var r = 1; r < alData.length; r++) {
        if (String(alData[r][ASSET_LIBRARY_COLS.Asset_ID - 1]) === String(parsed.asset_id)) {
          foundRow = r + 1;
          break;
        }
      }

      if (foundRow === -1) {
        var errMsg = 'REEL_EDITORIAL_ERROR: Asset_ID not found: ' + parsed.asset_id;
        logToAuditTrail(agentName, 'error', epUid, null, errMsg, 'ERROR');
        errors.push(errMsg);
        continue;
      }

      alSheet.getRange(foundRow, ASSET_LIBRARY_COLS.Reel_Summary ).setValue(parsed.summary);
      alSheet.getRange(foundRow, ASSET_LIBRARY_COLS.Slot_Tags    ).setValue(parsed.slot_tags.join(', '));
      alSheet.getRange(foundRow, ASSET_LIBRARY_COLS.Quality_Score).setValue(parsed.quality_score);
      processedCount++;
    } catch (e) {
      var errMsg = 'REEL_EDITORIAL_ERROR: Write failed for ' + parsed.asset_id + ': ' + e.message;
      logToAuditTrail(agentName, 'error', epUid, null, errMsg, 'ERROR');
      errors.push(errMsg);
    }
  }

  if (processedCount > 0) bumpVersion('asset_library', 'runReelEditorialPass');

  // ── 9. Log completion ─────────────────────────────────────────────────────────
  logToAuditTrail(agentName, 'state_change', epUid, null,
    'REEL_EDITORIAL_COMPLETE: processed=' + processedCount + ' skipped=' + skipCount + ' errors=' + errors.length, 'INFO');

  return { status: 'processed', processed: processedCount, skipped: skipCount, errors: errors };
}


