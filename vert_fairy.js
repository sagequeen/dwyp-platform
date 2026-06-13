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
// Track A: Reads finished transcript via gatherVertContext.
//           Calls Claude to build Episode Knowledge Index v2 (neutral,
//           extract-not-interpret posture). Writes markdown file to
//           EPISODE_SEARCH_INDEX_KEY folder. Patches manifest.episode_index_v2.
//
// Track B: Reads Episode Index v2. Calls Claude with Master Template structure
//           to generate full show notes. Patches manifest.show_notes.
//
// Cross-file dependencies (all compiled together in same GAS project):
//   fairy_circle.gs   — getGovernance, getStagingFolderIdByUid, getManifest,
//                       patchManifest, logToAuditTrail,
//                       spawnTask, callClaudeAPI, bumpVersion, getMasterSheetId
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
 */
function gatherVertContext(epUid, agentName) {
  try {
    const stagingFolderId = getStagingFolderIdByUid(epUid);
    if (!stagingFolderId) throw new Error("Staging folder not found.");

    const manifest = getManifest(stagingFolderId);
    if (!manifest) throw new Error("Manifest not found.");

    // --- Transcript: Episode/ subfolder first, Staging root fallback ---
    const stagingFolder = DriveApp.getFolderById(stagingFolderId);
    let transcriptText  = null;
    let transcriptMeta  = null;

    const episodeFolderIt = stagingFolder.getFoldersByName("Episode");
    if (episodeFolderIt.hasNext()) {
      const episodeFolder = episodeFolderIt.next();
      const r1 = findTranscriptInFolder(episodeFolder, agentName, epUid, "Episode/");
      if (r1) { transcriptText = r1.text; transcriptMeta = r1; }
    }

    if (!transcriptText) {
      const r2 = findTranscriptInFolder(stagingFolder, agentName, epUid, "Staging root");
      if (r2) { transcriptText = r2.text; transcriptMeta = r2; }
    }

    if (!transcriptText && manifest.raw_folder_id) {
      try {
        const rawFolder = DriveApp.getFolderById(manifest.raw_folder_id);
        let r3 = findTranscriptInFolder(rawFolder, agentName, epUid, "Raw Production");
        if (!r3 && _sniffRenameRawTranscript_(rawFolder, agentName, epUid)) {
          r3 = findTranscriptInFolder(rawFolder, agentName, epUid, "Raw Production (post sniff-rename)");
        }
        if (r3) { transcriptText = r3.text; transcriptMeta = r3; }
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
      guestName:             manifest.guest_name,
      transcriptText:        transcriptText,
      transcriptFileId:      transcriptMeta ? transcriptMeta.fileId      : null,
      transcriptLastUpdated: transcriptMeta ? transcriptMeta.lastUpdated : null
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
        return { text: text, fileId: file.getId(), lastUpdated: file.getLastUpdated() };
      }
      fallback = { text: text, fileId: file.getId(), lastUpdated: file.getLastUpdated() };
    }
  }

  if (fallback) {
    logToAuditTrail(agentName, "state_change", epUid, null,
      `No "finished/final/clean" transcript in ${folderLabel} — using first available transcript file.`, "info");
    return fallback;
  }

  return null;
}

/**
 * Detection fallback (Audra, 2026-06-12): Resolve exports transcripts as .txt
 * into Raw without "transcript" in the name, so name-based detection misses
 * them. Scans a folder for unlabeled .txt candidates, content-sniffs by
 * timecode density, and renames the single qualifying file so name-based
 * detection finds it. Exactly one qualifier -> rename + true. Multiple
 * qualifiers -> idempotent task spawn, no rename (never guess). None -> false
 * (the existing no-transcript error path proceeds unchanged: Claude does not
 * write, the error task fires).
 */
function _sniffRenameRawTranscript_(rawFolder, agentName, epUid) {
  const SNIFF_MIN_TIMECODES = 10;
  try {
    const files = rawFolder.getFiles();
    const candidates = [];
    while (files.hasNext()) {
      const f    = files.next();
      const name = f.getName().toLowerCase();
      if (name.startsWith("proxy_"))   continue;
      if (name.includes("transcript")) continue;
      if (!name.endsWith(".txt"))      continue;
      let text = "";
      try { text = f.getBlob().getDataAsString(); } catch (readErr) { continue; }
      const hits = (text.match(/\d{1,2}:\d{2}:\d{2}/g) || []).length;
      if (hits >= SNIFF_MIN_TIMECODES) candidates.push({ file: f, hits: hits });
    }

    if (candidates.length === 0) return false;

    if (candidates.length > 1) {
      _spawnTranscriptAmbiguityTaskIfNone_(epUid, agentName, candidates.length);
      logToAuditTrail(agentName, "state_change", epUid, null,
        `Transcript sniff: ${candidates.length} unlabeled .txt files in Raw look like transcripts — not guessing. Task spawned.`, "info");
      return false;
    }

    const f       = candidates[0].file;
    const oldName = f.getName();
    const newName = oldName.replace(/\.txt$/i, "") + " Transcript.txt";
    f.setName(newName);
    logToAuditTrail(agentName, "state_change", epUid, null,
      `Transcript sniff: renamed "${oldName}" to "${newName}" in Raw (${candidates[0].hits} timecode hits).`, "info");
    return true;
  } catch (e) {
    logToAuditTrail(agentName, "error", epUid, null,
      `Transcript sniff failed: ${e.message}`, "warning");
    return false;
  }
}

/**
 * Spawns the multi-candidate ambiguity task unless one is already open for
 * this episode. Workflow_Step "Errors" — generic-completable by allow-list.
 */
function _spawnTranscriptAmbiguityTaskIfNone_(epUid, agentName, count) {
  try {
    const sheetId = getMasterSheetId();
    const ss      = SpreadsheetApp.openById(sheetId);
    const sheet   = ss.getSheetByName("Tasks");
    if (!sheet) return;
    const data  = sheet.getDataRange().getValues();
    const heads = data[0];
    const epCol = heads.indexOf("Episode_UID");
    const stCol = heads.indexOf("Status");
    const atCol = heads.indexOf("Action_Title");
    if (epCol === -1 || stCol === -1 || atCol === -1) return;
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][epCol]) !== String(epUid)) continue;
      const st = String(data[i][stCol]);
      if (st !== "open" && st !== "in_progress") continue;
      if (String(data[i][atCol]).indexOf("Multiple transcript candidates") === 0) return;
    }
    spawnTask({
      episodeUid:       epUid,
      workflowStep:     "Errors",
      actionTitle:      "Multiple transcript candidates in Raw - rename the real one",
      executiveSummary: count + " unlabeled .txt files in the Raw folder look like transcripts. The pipeline will not guess - add 'Transcript' to the correct file's name; the next pulse picks it up.",
      assignee:         getGovernance("ASSIGNEE_PRODUCER"),
      assignedBy:       "Vert Fairy",
      status:           "open",
      priority:         "urgent"
    }, true);
  } catch (e) { /* non-fatal */ }
}



/**
 * Builds the prompt for the Episode Knowledge Index.
 * Transcript injected directly — Claude reads source, extract-not-interpret posture.
 * No show notes required at this stage; hooks/quotes are Track C.
 */
function buildEpisodeIndexPrompt(context) {
  const podcastName = getGovernance("PODCAST_NAME") || "Don't Waste Your Pain";

  const transcriptText = context.transcriptText || "Not available.";

  // AI Search Index — enumerated as a required output section.
  // Pillars + Voice Prohibitions loaded as grounding context within the section.
  var aiSearchIndexBlock = "";
  try {
    var aiSearchIndex = extractPrompt("# AI Search Index");
    var pillars       = extractPrompt("# Pillars");
    var voiceProhibs  = extractPrompt("# Voice Prohibitions");
    var grounding     = [pillars, voiceProhibs]
      .filter(function(s) { return s && s.trim(); }).join('\n\n');
    if (aiSearchIndex && aiSearchIndex.trim()) {
      var preamble = "This section is interpretive/curatorial — judgment is expected here and only here." +
        (grounding.trim() ? " Apply the following as grounding:\n\n" + grounding : "");
      aiSearchIndexBlock = "\n\n## AI SEARCH INDEX\n" + preamble + "\n\n" + aiSearchIndex;
    }
  } catch (e) {
    // AI Search Index section unavailable — proceed without
  }

  return `Create the Episode Knowledge Index for "${podcastName}" — a permanent reference document Studio loads on open.

EPISODE UID: ${context.epUid}
GUEST: ${context.guestName}

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

  // Prepend freshness stamp — records source transcript identity and build time
  // so a future pass can detect a stale index by comparing transcript lastUpdated vs. BUILT_AT.
  var builtAt           = new Date().toISOString();
  var transcriptFileId  = context.transcriptFileId     || "unknown";
  var transcriptUpdated = context.transcriptLastUpdated
    ? context.transcriptLastUpdated.toISOString()
    : "unknown";
  claudeResult =
    "<!-- BUILT_FROM: " + transcriptFileId +
    " @ " + transcriptUpdated +
    " | BUILT_AT: " + builtAt + " -->\n\n" +
    claudeResult;

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
    var showNotes      = extractPrompt("# Show Notes");
    templatePrompt = [hostVoice, voiceProhibits, captionMech, showNotes]
      .filter(function(s) { return s.trim(); }).join('\n\n');
  } catch (e) {
    throw new Error("runEditorialPass: Master Template sections unreadable: " + e.message);
  }
  if (!templatePrompt) {
    throw new Error("runEditorialPass: Master Template sections missing or empty — check # Host Voice, # Voice Prohibitions, # Caption Mechanics, # Show Notes headings in template");
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
    epUid, guestName, releaseDateStr, contentSensitivityText, transcriptText
  );

  // ── 7. Call Claude ───────────────────────────────────────────────────────────
  var claudeStart  = Date.now();
  var claudeResult = callClaudeAPI(userPrompt, systemInstruction, agentName, null, { maxTokens: 16384 });
  var claudeMs     = Date.now() - claudeStart;

  if (!claudeResult) throw new Error("runEditorialPass: Claude returned empty content.");

  // Normalize section headers before anything consumes the output. Claude
  // intermittently omits the trailing colon on header lines; every downstream
  // parser (getShowNotesForEdit, _vertBuildSectionProvenance_, Track C header
  // slicers, extractSectionFromProse boundaries) keys on the "HEADER:" form.
  // Master Template prompt is the primary enforcement; this is the code-level
  // backstop (same pattern as the bio word-cap, Fix 17).
  claudeResult = _normalizeShowNotesHeaders_(claudeResult);

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

  // ── 9. Manifest write + section provenance ───────────────────────────────────
  var snPatch = { show_notes: newDocId };
  var snProvenance = _vertBuildSectionProvenance_(claudeResult, new Date());
  if (Object.keys(snProvenance).length > 0) {
    snPatch.show_notes_sections = snProvenance;
  }
  patchManifest(stagingFolderId, snPatch);
  bumpVersion('manifests', 'runEditorialPass');

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
function _buildEditorialPassPrompt_(epUid, guestName, releaseDateStr, contentSensitivityText, transcriptText) {
  return "Build the complete audience-facing content package for this episode.\n\n" +
    "GUEST: " + guestName + "\n" +
    "EPISODE UID: " + epUid + "\n" +
    "RELEASE DATE: " + releaseDateStr + "\n\n" +
    "CONTENT SENSITIVITY GUIDE:\n" +
    (contentSensitivityText || "Not available.") + "\n\n" +
    "FINISHED TRANSCRIPT:\n" +
    (transcriptText || "Not available.") + "\n\n" +
    "You are reading the raw transcript. Guest quotes must be verbatim — select from the speaker's actual words on the page. Every hook, caption, and quote in your output must be sourceable to a specific line in this transcript.\n\n" +
    "Surface the Medicine. Write copy that earns trust, not clicks. Complete every section.";
}


/**
 * Parses claudeResult into per-section provenance records for manifest.show_notes_sections.
 * Mirrors getShowNotesForEdit's parse logic so the baseline is byte-stable on round-trip.
 *
 * Baseline stored in canonical re-serialized form (same format saveShowNotes submits),
 * so diffing is: normalize(submitted) === normalize(baseline) with no prefix asymmetry.
 *
 * INSIGHT BULLETS fold applied here to match getShowNotesForEdit's load behavior.
 *
 * @param {string} claudeResult
 * @param {Date}   now
 * @returns {Object}  keyed by normalized header (e.g. 'hooks', 'guest_quotes')
 */
/**
 * Normalizes section header lines to the canonical "ALL CAPS:" form.
 * A line consisting only of caps and spaces (3+ chars, no colon) is a
 * header missing its colon; content lines carry punctuation, digits,
 * or lowercase and never match.
 */
function _normalizeShowNotesHeaders_(text) {
  return text.split('\n').map(function(line) {
    var t = line.trim();
    if (/^[A-Z][A-Z\s]{2,}$/.test(t)) return t + ':';
    return line;
  }).join('\n');
}

function _vertBuildSectionProvenance_(claudeResult, now) {
  var ts    = now.toISOString();
  var lines = claudeResult.split('\n');

  // Same header test as getShowNotesForEdit (colon optional — tolerant of
  // pre-normalization docs; headerToKey strips it either way)
  function isSectionHeader(line) {
    return /^[A-Z][A-Z\s]{2,}:?\s*$/.test(line.trim());
  }
  function headerToKey(header) {
    return header.trim().replace(/:$/, '').toLowerCase().replace(/\s+/g, '_');
  }

  // Walk lines, collect raw content per header key
  var rawSections = {};
  var keyOrder    = [];
  var curKey      = null;
  var curLines    = [];

  function flush() {
    if (curKey === null) return;
    rawSections[curKey] = curLines.join('\n');
  }

  for (var i = 0; i < lines.length; i++) {
    if (isSectionHeader(lines[i])) {
      flush();
      curKey   = headerToKey(lines[i]);
      curLines = [];
      keyOrder.push(curKey);
    } else if (curKey !== null) {
      curLines.push(lines[i]);
    }
  }
  flush();

  // INSIGHT BULLETS fold: mirrors getShowNotesForEdit behavior
  if ('insight_bullets' in rawSections) {
    var bullContent = rawSections['insight_bullets'];
    if ('episode_description' in rawSections) {
      rawSections['episode_description'] += (rawSections['episode_description'] ? '\n\n' : '') + bullContent;
    } else {
      rawSections['episode_description'] = bullContent;
    }
    delete rawSections['insight_bullets'];
    var bullIdx = keyOrder.indexOf('insight_bullets');
    if (bullIdx !== -1) keyOrder.splice(bullIdx, 1);
  }

  // Build provenance records
  var result = {};
  for (var ki = 0; ki < keyOrder.length; ki++) {
    var key     = keyOrder[ki];
    if (!(key in rawSections)) continue;
    var content = rawSections[key];
    var baseline, itemCount, status;

    if (key === 'hooks') {
      // Parse same way as getShowNotesForEdit: capture group 1 (bare text, no N. prefix)
      var hookItems = [];
      var hookRe    = /^\s*\d+\.\s*(.+)$/gm;
      var hm;
      while ((hm = hookRe.exec(content)) !== null) {
        hookItems.push(hm[1].trim());
      }
      itemCount = hookItems.length;
      status    = itemCount === 0 ? 'failed' : 'ok';
      // Canonical baseline: same format saveShowNotes re-serializes (N. text)
      baseline = hookItems.map(function(t, i) { return (i + 1) + '. ' + t; }).join('\n');

    } else if (key === 'guest_quotes') {
      // Parse same way as getShowNotesForEdit
      var quoteRe      = new RegExp('^QUOTE\\s+(\\d+):\\s*(.*)$', 'gm');
      var quoteMatches = [];
      var qm;
      while ((qm = quoteRe.exec(content)) !== null) {
        quoteMatches.push({ index: qm.index, len: qm[0].length, quoteText: qm[2].trim() });
      }
      var quoteItems = [];
      for (var qi = 0; qi < quoteMatches.length; qi++) {
        var blockStart = quoteMatches[qi].index + quoteMatches[qi].len;
        var blockEnd   = (qi + 1 < quoteMatches.length) ? quoteMatches[qi + 1].index : content.length;
        var block      = content.slice(blockStart, blockEnd);
        var attrM      = block.match(/^ATTRIBUTION:\s*(.+)$/m);
        quoteItems.push({
          quoteText:   quoteMatches[qi].quoteText,
          attribution: attrM ? attrM[1].trim() : ''
        });
      }
      itemCount = quoteItems.length;
      status    = itemCount === 0 ? 'failed' : 'ok';
      // Canonical baseline: same format saveShowNotes re-serializes
      baseline = quoteItems.map(function(item, i) {
        return 'QUOTE ' + (i + 1) + ': ' + item.quoteText + '\nATTRIBUTION: ' + item.attribution;
      }).join('\n');

    } else {
      var nonEmpty = content.split('\n').filter(function(l) { return l.trim().length > 0; });
      itemCount = nonEmpty.length;
      status    = itemCount === 0 ? 'failed' : 'ok';
      baseline  = content.trim();
    }

    result[key] = {
      source:    'vert',
      status:    status,
      itemCount: itemCount,
      baseline:  baseline,
      at:        ts
    };
  }

  return result;
}


// =============================================================================
// BRIDGE (Track C)
// Entry: materializeQuoteGraphicAssets(epUid, opts)
// Reads Show Notes Doc (manifest.show_notes) written by runEditorialPass (Track B).
// Parses HOOKS, GUEST QUOTES, STARTER CAPTIONS — HOOKS, STARTER CAPTIONS — GUEST QUOTES.
// Writes one Asset_Library row per hook and per guest quote.
// No Claude/Gemini/Vert calls. No PNG creation. No image prompts.
// Render-on-send: Drive_File_ID, Canvas_State, Background_ID left empty at creation.
// Manual trigger only.
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
 * Parses a HOOKS or GUEST QUOTES section into items.
 * HOOK block format: N. [text]  (numbered list written by saveShowNotes)
 * QUOTE block format: QUOTE N: "[text]" / ATTRIBUTION: [Name]
 *
 * @param {string} sectionText  — extracted section content
 * @param {string} labelPrefix  — 'HOOK' or 'QUOTE' (all-caps, matches template)
 * @returns {Array<{index: number, text: string}>}
 */
function _bridgeParseRankedItems_(sectionText, labelPrefix) {
  var agentName  = 'Bridge_Fairy';
  var result     = [];
  var labelRegex = labelPrefix === 'HOOK'
    ? /^\s*(\d+)\.\s*(.+)$/gm
    : new RegExp('^' + labelPrefix + '\\s+(\\d+):\\s*(.*)$', 'gm');
  var matches    = Array.from(sectionText.matchAll(labelRegex));

  for (var i = 0; i < matches.length; i++) {
    var m     = matches[i];
    var index = parseInt(m[1], 10);
    var text  = m[2].trim();

    var blockStart = m.index + m[0].length;
    var blockEnd   = (i + 1 < matches.length) ? matches[i + 1].index : sectionText.length;
    var block      = sectionText.slice(blockStart, blockEnd);

    // ATTRIBUTION (QUOTE blocks only — separate labeled line, AD #112)
    if (labelPrefix === 'QUOTE') {
      var attrMatch = block.match(/^ATTRIBUTION:\s*(.+)$/m);
      if (attrMatch) {
        text = text + ' — ' + attrMatch[1].trim();
      } else {
        logToAuditTrail(agentName, 'state_change', '', null,
          '_bridgeParseRankedItems_: ATTRIBUTION missing for QUOTE ' + index + ' — using bare quote text', 'WARNING');
      }
    }

    result.push({ index: index, text: text });
  }

  return result;
}


/**
 * Normalizes hook/quote text for dedup comparison: unifies dashes (the quote
 * attribution separator), collapses whitespace, lowercases. Used to match parsed
 * Show Notes items against existing Asset_Library Quote_Text values.
 */
function _bridgeNormText_(s) {
  return String(s == null ? '' : s)
    .replace(/[–—―]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Header-driven read of an episode's Status from the Episodes tab.
 * Self-contained (does not depend on EPISODES_COLS being in scope here).
 * Returns '' if the episode or columns are not found.
 */
function _bridgeGetEpisodeStatus_(epUid) {
  var ss = SpreadsheetApp.openById(getMasterSheetId());
  var sh = ss.getSheetByName('Episodes');
  if (!sh) return '';
  var data = sh.getDataRange().getValues();
  if (!data.length) return '';
  var hdr    = data[0];
  var uidCol = hdr.indexOf('Episode_UID');
  var stCol  = hdr.indexOf('Status');
  if (uidCol === -1 || stCol === -1) return '';
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][uidCol]) === String(epUid)) return String(data[i][stCol] || '');
  }
  return '';
}

/**
 * Reads Show Notes Doc (manifest.show_notes), parses HOOKS + GUEST QUOTES,
 * writes one Asset_Library row per hook and per guest quote.
 * Caption_Host left empty — composed in the Images surface per asset.
 * Render-on-send: Drive_File_ID, Canvas_State, Background_ID, Reel_Summary_Clean left empty.
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

  // Section header delimiters — em-dash is U+2014, verbatim from Master Template.
  var HEADER_HOOKS                   = 'HOOKS:';
  var HEADER_GUEST_QUOTES            = 'GUEST QUOTES:';
  var HEADER_HOST_INSTAGRAM_CAPTIONS = 'HOST INSTAGRAM CAPTIONS:';

  logToAuditTrail(agentName, 'state_change', epUid, null,
    'materializeQuoteGraphicAssets START force=' + force, 'INFO');

  // ── 0. Status gate (SPOKE Asset Deletion §3) ────────────────────────────────
  // Floor replenishment runs only across the active pre-release span. Never for
  // upcoming (no transcript), live, or archived. Applies to the force path too.
  var REPLENISH_STATUSES = { in_production: true, review: true, ready_to_release: true };
  var epStatus = _bridgeGetEpisodeStatus_(epUid);
  if (!REPLENISH_STATUSES[String(epStatus || '').toLowerCase()]) {
    logToAuditTrail(agentName, 'state_change', epUid, null,
      'BRIDGE_STATUS_GATE: status="' + epStatus +
      '" outside {in_production,review,ready_to_release} — skipping replenishment', 'INFO');
    return { status: 'skipped', reason: 'status_gate', episodeStatus: epStatus };
  }

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

  var alData = alSheet.getDataRange().getValues();

  // Single pass: collect this episode's quote_graphic rows with classification.
  // Placeholder rows (no Quote_Text AND no Display_Name) are ignored entirely.
  var epRows = [];
  for (var r = 1; r < alData.length; r++) {
    if (String(alData[r][ASSET_LIBRARY_COLS.Episode_UID - 1]) !== String(epUid)) continue;
    if (String(alData[r][ASSET_LIBRARY_COLS.Asset_Type  - 1]) !== 'quote_graphic') continue;
    var qtRaw = String(alData[r][ASSET_LIBRARY_COLS.Quote_Text   - 1] || '').trim();
    var dnRaw = String(alData[r][ASSET_LIBRARY_COLS.Display_Name - 1] || '').trim();
    if (qtRaw === '' && dnRaw === '') continue; // placeholder row — ignore
    epRows.push({
      rowNum:      r + 1,
      status:      String(alData[r][ASSET_LIBRARY_COLS.Status       - 1] || '').toLowerCase(),
      quoteText:   qtRaw,
      isHook:      dnRaw.indexOf('Hook ') === 0,
      createdBy:   String(alData[r][ASSET_LIBRARY_COLS.Created_By   - 1] || ''),
      canvasState: String(alData[r][ASSET_LIBRARY_COLS.Canvas_State - 1] || '')
    });
  }
  var hadExistingRows = epRows.length > 0;

  // Force rebuild: flip system-authored, JT-untouched rows to rejected (preserved,
  // not deleted — AD #99). Their text becomes eligible for fresh recreation below.
  // JT-touched rows (Canvas_State present) are protected.
  var flippedRowNums = {};
  if (force) {
    var flippedCount = 0, protectedCount = 0;
    for (var fi = 0; fi < epRows.length; fi++) {
      var er = epRows[fi];
      if (er.createdBy === 'system' && er.canvasState === '') {
        alSheet.getRange(er.rowNum, ASSET_LIBRARY_COLS.Status).setValue('rejected');
        alSheet.getRange(er.rowNum, ASSET_LIBRARY_COLS.Availability).setValue('rejected');
        er.status = 'rejected';
        flippedRowNums[er.rowNum] = true;
        flippedCount++;
      } else {
        protectedCount++;
      }
    }
    logToAuditTrail(agentName, 'state_change', epUid, null,
      'BRIDGE_REBUILD: flipped=' + flippedCount + ' protected=' + protectedCount, 'INFO');
  }

  // Counts toward the floor exclude rejected rows (per type). The dedup set
  // (existingTexts) holds every text that must NOT be (re)created — all remaining
  // rows EXCEPT the ones force just flipped. Live rejected rows therefore enforce
  // do-not-regenerate; force-flipped rows are recreated fresh.
  var EXPECTED_HOOKS  = 10;
  var EXPECTED_QUOTES = 6;
  var existingHookCount = 0, existingQuoteCount = 0;
  var existingTexts = {};
  var rejectedHeldBack = 0;
  for (var ci = 0; ci < epRows.length; ci++) {
    var row = epRows[ci];
    if (!flippedRowNums[row.rowNum]) {
      var ek = _bridgeNormText_(row.quoteText);
      if (ek) existingTexts[ek] = true;
    }
    if (row.status === 'rejected') {
      if (!flippedRowNums[row.rowNum] && row.quoteText) rejectedHeldBack++;
      continue; // rejected rows never count toward the floor
    }
    if (row.isHook) existingHookCount++; else existingQuoteCount++;
  }

  var needHooks  = existingHookCount  < EXPECTED_HOOKS;
  var needQuotes = existingQuoteCount < EXPECTED_QUOTES;

  if (rejectedHeldBack) {
    logToAuditTrail(agentName, 'state_change', epUid, null,
      'BRIDGE_EXCLUSIONS: ' + rejectedHeldBack +
      ' live rejected text(s) held back from regeneration', 'INFO');
  }

  if (!needHooks && !needQuotes) {
    logToAuditTrail(agentName, 'state_change', epUid, null,
      'BRIDGE_AT_FLOOR: hooks=' + existingHookCount + '/' + EXPECTED_HOOKS +
      ' quotes=' + existingQuoteCount + '/' + EXPECTED_QUOTES + ' (non-rejected)', 'INFO');
    return { status: 'skipped', existingHookCount: existingHookCount, existingQuoteCount: existingQuoteCount };
  }

  logToAuditTrail(agentName, 'state_change', epUid, null,
    'BRIDGE_REPLENISH: hooks=' + existingHookCount + '/' + EXPECTED_HOOKS +
    ' quotes=' + existingQuoteCount + '/' + EXPECTED_QUOTES + ' (non-rejected) — topping up missing', 'INFO');

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
  var hooksBlock  = _bridgeSliceSection_(docText, HEADER_HOOKS,        HEADER_GUEST_QUOTES);
  var quotesBlock = _bridgeSliceSection_(docText, HEADER_GUEST_QUOTES, HEADER_HOST_INSTAGRAM_CAPTIONS);

  if (!hooksBlock)  logToAuditTrail(agentName, 'state_change', epUid, null, '[WARNING] HOOKS section not found in Show Notes Doc', 'WARNING');
  if (!quotesBlock) logToAuditTrail(agentName, 'state_change', epUid, null, '[WARNING] GUEST QUOTES section not found in Show Notes Doc', 'WARNING');

  // HOOKS: N. [text]   GUEST QUOTES: QUOTE N: "[text]" / ATTRIBUTION: [Name]
  var hookItems  = _bridgeParseRankedItems_(hooksBlock  || '', 'HOOK');
  var quoteItems = _bridgeParseRankedItems_(quotesBlock || '', 'QUOTE');

  // ── 4. Validate parsed counts (only for types being topped up) ──────────────
  if (needHooks && hookItems.length !== 10) {
    var msgH = 'Expected 10 hooks in Show Notes Doc, parsed ' + hookItems.length;
    logToAuditTrail(agentName, 'state_change', epUid, null, '[WARNING] ' + msgH, 'WARNING');
    errors.push(msgH);
  }
  if (needQuotes && quoteItems.length !== 6) {
    var msgQ = 'Expected 6 guest quotes in Show Notes Doc, parsed ' + quoteItems.length;
    logToAuditTrail(agentName, 'state_change', epUid, null, '[WARNING] ' + msgQ, 'WARNING');
    errors.push(msgQ);
  }
  if ((needHooks && hookItems.length === 0) && (needQuotes && quoteItems.length === 0)) {
    var errMsg = 'No parseable content in Show Notes Doc (' + showNotesId + ') for either type';
    logToAuditTrail(agentName, 'error', epUid, null, errMsg, 'ERROR');
    return { status: 'error', hookCount: 0, quoteCount: 0, totalRows: 0, errors: [errMsg] };
  }

  // ── 5. Build Asset_Library rows — dedup against existingTexts ────────────────
  // Only parsed items whose normalized text is NOT already present (active OR
  // live-rejected) are written. This tops the floor up from genuinely new distinct
  // items and never resurrects a rejected text (do-not-regenerate). Row width is
  // matched to the live sheet column count; unset cells default to ''.
  var numCols    = alSheet.getLastColumn();
  var rows       = [];
  var now        = new Date();
  var addedHooks = 0, addedQuotes = 0, skippedDup = 0;

  if (needHooks) {
    for (var hi = 0; hi < hookItems.length; hi++) {
      var hKey = _bridgeNormText_(hookItems[hi].text);
      if (!hKey || existingTexts[hKey]) { skippedDup++; continue; }
      existingTexts[hKey] = true;
      var hookRow = new Array(numCols).fill('');
      hookRow[ASSET_LIBRARY_COLS.Asset_ID     - 1] = Utilities.getUuid();
      hookRow[ASSET_LIBRARY_COLS.Episode_UID  - 1] = epUid;
      hookRow[ASSET_LIBRARY_COLS.Asset_Type   - 1] = 'quote_graphic';
      hookRow[ASSET_LIBRARY_COLS.Display_Name - 1] = 'Hook ' + hookItems[hi].index;
      hookRow[ASSET_LIBRARY_COLS.Quote_Text   - 1] = hookItems[hi].text;
      hookRow[ASSET_LIBRARY_COLS.Status       - 1] = 'candidate';
      hookRow[ASSET_LIBRARY_COLS.Availability - 1] = 'available';
      hookRow[ASSET_LIBRARY_COLS.Created_At   - 1] = now;
      hookRow[ASSET_LIBRARY_COLS.Created_By   - 1] = 'system';
      rows.push(hookRow);
      addedHooks++;
    }
  }

  if (needQuotes) {
    for (var qi = 0; qi < quoteItems.length; qi++) {
      var qKey = _bridgeNormText_(quoteItems[qi].text);
      if (!qKey || existingTexts[qKey]) { skippedDup++; continue; }
      existingTexts[qKey] = true;
      var quoteRow = new Array(numCols).fill('');
      quoteRow[ASSET_LIBRARY_COLS.Asset_ID     - 1] = Utilities.getUuid();
      quoteRow[ASSET_LIBRARY_COLS.Episode_UID  - 1] = epUid;
      quoteRow[ASSET_LIBRARY_COLS.Asset_Type   - 1] = 'quote_graphic';
      quoteRow[ASSET_LIBRARY_COLS.Display_Name - 1] = 'Guest Quote ' + quoteItems[qi].index;
      quoteRow[ASSET_LIBRARY_COLS.Quote_Text   - 1] = quoteItems[qi].text;
      quoteRow[ASSET_LIBRARY_COLS.Status       - 1] = 'candidate';
      quoteRow[ASSET_LIBRARY_COLS.Availability - 1] = 'available';
      quoteRow[ASSET_LIBRARY_COLS.Created_At   - 1] = now;
      quoteRow[ASSET_LIBRARY_COLS.Created_By   - 1] = 'system';
      rows.push(quoteRow);
      addedQuotes++;
    }
  }

  if (rows.length === 0) {
    logToAuditTrail(agentName, 'state_change', epUid, null,
      'BRIDGE_NOOP: below floor but no new distinct items to add — all parsed items ' +
      'already present or held back as rejected (skippedDup=' + skippedDup + ')', 'INFO');
    return { status: 'skipped', reason: 'no_new_items',
             existingHookCount: existingHookCount, existingQuoteCount: existingQuoteCount,
             skippedDup: skippedDup };
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
    return { status: 'error', hookCount: addedHooks, quoteCount: addedQuotes,
             totalRows: 0, errors: errors };
  }

  // ── 7. Patch manifest ───────────────────────────────────────────────────────
  // quote_graphic_asset_count tracks net new rows written this run (floor top-up),
  // not a cumulative total — replenishment is incremental by design.
  patchManifest(stagingFolderId, {
    quote_graphic_assets_built: true,
    quote_graphic_asset_count:  totalRows
  });

  // ── 8. Audit log on completion ──────────────────────────────────────────────
  logToAuditTrail(agentName, 'state_change', epUid, null,
    'QUOTE_GRAPHIC_ASSETS_MATERIALIZED: ' + totalRows + ' new rows — +' +
    addedHooks + ' hooks, +' + addedQuotes + ' quotes (skippedDup=' + skippedDup + ')', 'INFO');

  // ── 9. Return summary ───────────────────────────────────────────────────────
  return {
    status:     force ? 'rebuilt' : (hadExistingRows ? 'replenished' : 'created'),
    hookCount:  addedHooks,
    quoteCount: addedQuotes,
    totalRows:  totalRows,
    skippedDup: skippedDup,
    errors:     errors
  };
}




// runReelEditorialPass retired — Gemini dual-output via syncReelAssets writes Reel_Transcript (col 8) and Reel_Summary (col 9) directly.


