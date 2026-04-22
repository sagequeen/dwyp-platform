// =============================================================================
// FILE: marcom_fairy.gs
// Fairy: The Marcom Fairy (Narrative Architect)
// Version: 1.1 | April 2026
// Author: Claude (Anthropic) — per Preservation Mandate, all GAS code written
//         by Claude only. Never edit directly in Apps Script or via Gemini.
//
// Trigger: Manual (runMarcom(epUid)) or Daily Pulse backup.
// Fires after finished assets uploaded to Staging.
//
// Job: Episode Card (Pass 1 audience copy + Pass 2 search index).
// Hands off to Artist Fairy on completion.
//
// SCHEMA: v1.5 (Handoff v34)
// Key changes from old system:
//   - Episode Card created by Marcom (primary path) — not Secretary
//   - Guest Brief lookup reads Contact_Library_Folder_ID from Contacts tab
//     via Contact_ID from Episodes tab — resolved via fairy_circle helper
//   - Transcript lookup reads Production_Folder_ID from Episodes tab
//     via getStagingFolderIdByUid() in fairy_circle
//   - scanForReadyAssets() removed — replaced by Daily Pulse Loop 4
//   - doPost() approval routing removed — AppSheet writes directly to Episodes tab
//   - preflightCheck(), runFilingFairy(), createGuestSwipeDoc() not in this file
//   - logToAuditTrail() eventCategory: enum only (error|state_change|human_action)
//   - spawnTask() keys: camelCase only, no workstream, assignedBy: "The Fairy Team"
//   - patchProductionLog()/upsertProductionLog() replaced by patchEpisodes()
//   - CONFIG.PODCAST_NAME replaced by getGovernance("PODCAST_NAME")
// =============================================================================

// =============================================================================
// MARCOM FAIRY — ENTRY POINT
// =============================================================================

/**
 * Entry point for the Marcom Fairy.
 * Called manually or as a Daily Pulse backup after finished assets are in Staging.
 * Orchestrates Pass 1 (audience copy), Pass 2 (search index), Episode Card write,
 * manifest patch, and Artist Fairy handoff.
 *
 * Per the Preservation Mandate: do NOT simplify, rename, or thin this function.
 */
function runMarcom(epUid) {
  const agentName = "Marcom_Fairy";
  logToAuditTrail(agentName, "state_change", epUid, null,
    `Marcom Fairy awakens for: ${epUid}`, "info");

  try {
    const context = gatherEpisodeContext(epUid, agentName);
    if (!context) throw new Error("Could not gather episode context. Marcom cannot proceed.");

    const brandVoice = loadRuntimeDoc("BRAND_VOICE_ID", "Brand Voice", agentName, epUid);

    // --- Pass 1: Audience-Facing Copy (PROSE — no JSON parsing) ---
    logToAuditTrail(agentName, "state_change", epUid, null,
      "Generating audience-facing prose copy...", "info");
    const audienceProse = generateAudienceProse(context, brandVoice, agentName, epUid);

    // --- Pass 2: NotebookLM Search Index (PROSE — template-driven) ---
    logToAuditTrail(agentName, "state_change", epUid, null,
      "Generating NotebookLM search index (prose)...", "info");
    const searchIndexProse = generateSearchIndex(context, audienceProse, brandVoice, agentName, epUid);

    // --- Episode Card: create (primary path) or write to existing ---
    // Marcom is the authority for Episode Card creation. Secretary does not create this doc.
    let episodeCardId = context.manifest.asset_ids
      ? context.manifest.asset_ids.episode_card
      : null;

    if (episodeCardId) {
      // Episode Card already exists — overwrite contents
      logToAuditTrail(agentName, "state_change", epUid, null,
        `Episode Card found in manifest (${episodeCardId}). Writing content.`, "info");
      writeEpisodeCard(episodeCardId, audienceProse, searchIndexProse, context, agentName, epUid);
    } else {
      // Primary creation path — Marcom creates the Episode Card
      logToAuditTrail(agentName, "state_change", epUid, null,
        "No Episode Card ID in manifest. Marcom creating Episode Card doc.", "info");
      episodeCardId = createEpisodeCardDoc(
        context.stagingFolderId, context.guestName, epUid, agentName
      );
      const existingAssetIds = context.manifest.asset_ids || {};
      patchManifest(context.stagingFolderId, {
        asset_ids: { ...existingAssetIds, episode_card: episodeCardId }
      });
      writeEpisodeCard(episodeCardId, audienceProse, searchIndexProse, context, agentName, epUid);
    }

    // --- Patch Manifest ---
    // All audience copy lives in Episode Card doc — no manifest blobs for content.
    // top_hooks retained for Fairy Nudge surface only.
    const topHooks = extractTopHooksFromProse(audienceProse);
    patchManifest(context.stagingFolderId, {
      phase:              "3_Curation_Complete",
      status:             "in_progress",
      top_hooks:          topHooks,
      fairies_dispatched: [...(context.manifest.fairies_dispatched || []), "Marcom_Fairy"]
    });

    // --- Patch Episodes tab ---
    patchEpisodes(epUid, {
      Production_Status: "in_progress"
    });

    logToAuditTrail(agentName, "state_change", epUid, null,
      `Episode Card complete for ${context.guestName}. Handing off to Artist Fairy.`, "info");

    runArtistFairy(epUid);

  } catch (err) {
    logToAuditTrail(agentName, "error", epUid, null,
      `runMarcom failed: ${err.message}`, "error");
    spawnTask({
      actionTitle:  `Marcom Fairy failed: ${epUid}`,
      assignee:     getGovernance("ASSIGNEE_PRODUCER"),
      assignedBy:   "The Fairy Team",
      status:       "open",
      priority:     "urgent",
      episodeUid:   epUid,
      workflowStep: "Produce_Episode",
      payloadLink:  `https://drive.google.com/drive/folders/${getStagingFolderIdByUid(epUid)}`
    });
  }
}


// =============================================================================
// MARCOM: CONTEXT GATHERING
// =============================================================================

/**
 * Gathers all episode context needed for Marcom's two passes.
 *
 * Guest Brief lookup (new schema):
 *   - Reads Contact_ID from Episodes tab via epUid
 *   - Reads Contact_Library_Folder_ID from Contacts tab via Contact_ID
 *   - Searches that folder for a file matching "GuestBrief_" name pattern
 *
 * Transcript lookup (new schema):
 *   - Reads Production_Folder_ID from Episodes tab via epUid
 *     via getStagingFolderIdByUid() in fairy_circle
 *   - Searches Staging folder for the finished transcript
 *
 * Per the Preservation Mandate: do NOT simplify, rename, or thin this function.
 */
function gatherEpisodeContext(epUid, agentName) {
  try {
    const stagingFolderId = getStagingFolderIdByUid(epUid);
    if (!stagingFolderId) throw new Error("Staging folder not found.");

    const manifest = getManifest(stagingFolderId);
    if (!manifest) throw new Error("Manifest not found.");

    // --- Guest Brief: new schema lookup via Contact Library ---
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

    // --- Production Notes ---
    let productionNotesText = "";
    const notesDocId = manifest.asset_ids ? manifest.asset_ids.production_notes : null;
    if (notesDocId) {
      try {
        productionNotesText = DocumentApp.openById(notesDocId).getBody().getText();
      } catch (e) {
        logToAuditTrail(agentName, "error", epUid, null,
          `Could not load Production Notes: ${e.message}`, "warning");
      }
    }

    // --- Transcript: hard requirement. No transcript = Marcom cannot run. ---
    const transcriptText = findFinishedTranscript(stagingFolderId, agentName, epUid);
    if (!transcriptText) {
      logToAuditTrail(agentName, "error", epUid, null,
        "No transcript found in Staging folder. Marcom cannot run without a finished transcript.", "error");
      spawnTask({
        actionTitle:      `Transcript missing — Marcom blocked: ${manifest.guest_name || epUid}`,
        assignee:         getGovernance("ASSIGNEE_PRODUCER"),
        assignedBy:       "The Fairy Team",
        status:           "open",
        priority:         "urgent",
        episodeUid:       epUid,
        workflowStep:     "Produce_Episode",
        payloadLink:      `https://drive.google.com/drive/folders/${stagingFolderId}`,
        executiveSummary: `Marcom cannot run — no finished transcript found in the Staging folder for ${epUid}. Upload a finished transcript and re-run.`
      });
      throw new Error("No transcript found. Marcom cannot proceed.");
    }

    return {
      epUid,
      stagingFolderId,
      manifest,
      guestName:           manifest.guest_name,
      guestBriefText:      guestBriefText || "",
      productionNotesText: productionNotesText || "",
      transcriptText:      transcriptText || ""
    };

  } catch (e) {
    logToAuditTrail(agentName, "error", epUid, null,
      `gatherEpisodeContext failed: ${e.message}`, "error");
    return null;
  }
}

/**
 * Searches the Contact Library folder for the Guest Brief doc for this episode.
 * Matches by filename pattern: "GuestBrief_" prefix.
 * Returns full doc text, or empty string if not found.
 */
function findGuestBriefInContactLibrary(contactLibraryFolderId, epUid, agentName) {
  try {
    const folder = DriveApp.getFolderById(contactLibraryFolderId);
    const files = folder.getFiles();
    while (files.hasNext()) {
      const file = files.next();
      const name = file.getName();
      if (name.startsWith("GuestBrief_")) {
        const mimeType = file.getMimeType();
        let text = "";
        if (mimeType === MimeType.GOOGLE_DOCS) {
          text = DocumentApp.openById(file.getId()).getBody().getText();
        } else if (mimeType === MimeType.PLAIN_TEXT) {
          text = file.getBlob().getDataAsString();
        }
        logToAuditTrail(agentName, "state_change", epUid, null,
          `Guest Brief located: ${name} (${text.length} chars).`, "info");
        return text;
      }
    }
    logToAuditTrail(agentName, "error", epUid, null,
      `No GuestBrief_ file found in Contact Library folder: ${contactLibraryFolderId}`, "warning");
    return "";
  } catch (e) {
    logToAuditTrail(agentName, "error", epUid, null,
      `findGuestBriefInContactLibrary failed: ${e.message}`, "warning");
    return "";
  }
}

/**
 * Searches the Staging folder for the finished transcript.
 * Prefers files with "finished", "final", or "clean" in the name.
 * Falls back to any file with "transcript" in the name.
 * The finished transcript lives in Staging — the raw transcript lives in Raw
 * and is used by Safety Fairy for content auditing.
 *
 * Per the Preservation Mandate: do NOT simplify, rename, or thin this function.
 */
function findFinishedTranscript(stagingFolderId, agentName, epUid) {
  const folder = DriveApp.getFolderById(stagingFolderId);
  const files = folder.getFiles();
  let fallback = null;

  while (files.hasNext()) {
    const file = files.next();
    const name = file.getName().toLowerCase();
    const mimeType = file.getMimeType();

    const isTranscript = name.includes("transcript");
    const isFinished   = name.includes("finished") || name.includes("final") || name.includes("clean");
    const isReadable   = mimeType === MimeType.PLAIN_TEXT || mimeType === MimeType.GOOGLE_DOCS
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
          `Finished transcript located in Staging folder: ${file.getName()}`, "info");
        return text;
      }
      fallback = text;
    }
  }

  if (fallback) {
    logToAuditTrail(agentName, "error", epUid, null,
      "No finished transcript found in Staging folder — using first available transcript file.", "warning");
    return fallback;
  }

  logToAuditTrail(agentName, "error", epUid, null,
    `No transcript found in Staging folder: ${stagingFolderId}`, "warning");
  return null;
}

/**
 * Loads a runtime doc (Brand Voice, etc.) from Governance_Config by key.
 * Non-blocking — returns empty string on failure.
 *
 * Per the Preservation Mandate: do NOT simplify, rename, or thin this function.
 */
function loadRuntimeDoc(govKey, docLabel, agentName, epUid) {
  const docId = getGovernance(govKey);
  if (!docId) {
    logToAuditTrail(agentName, "error", epUid, null,
      `${docLabel} doc ID not found in Governance_Config key: ${govKey}`, "warning");
    return "";
  }
  try {
    const text = DocumentApp.openById(docId).getBody().getText();
    logToAuditTrail(agentName, "state_change", epUid, null,
      `${docLabel} doc loaded (${text.length} chars).`, "info");
    return text;
  } catch (e) {
    logToAuditTrail(agentName, "error", epUid, null,
      `Could not load ${docLabel} doc: ${e.message}`, "warning");
    return "";
  }
}


// =============================================================================
// MARCOM: PASS 1 — AUDIENCE-FACING PROSE
// =============================================================================

/**
 * Generates audience-facing content as structured prose.
 * Output is written directly to the Episode Card doc — no JSON extraction required.
 * Sections, voice, and all social content are controlled via the Master Template doc.
 *
 * Per the Preservation Mandate: do NOT thin this prompt.
 */
function generateAudienceProse(context, brandVoice, agentName, epUid) {
  const podcastName = getGovernance("PODCAST_NAME") || "Don't Waste Your Pain";
  const templateStructure = extractPrompt("# Finished Episode Card and Indexing Template");

  const systemInstruction = `You are The Marcom Fairy for the podcast "${podcastName}."
You are a master narrative architect and content strategist. Your job is to transform
a raw interview into a complete content package that serves the audience and honors the guest.

YOUR VOICE AUTHORITY — this is not a suggestion. Every word you write must pass through this filter:
${brandVoice || "Warm, visceral, unflinching. Truth over polish. Never corporate."}

VOICE PROHIBITIONS — these are automatic failures. If any appear in your output, rewrite before returning:
- Forbidden phrases: "heart-centered," "transformative journey," "profound exploration," "safe space," "deeply moving," "inspires us to," "in a world where," "sit with," "holds space," "unpacks," "dives deep," "game-changer," "paradigm shift," "on this journey," "resonates," "impactful"
- Forbidden patterns: opening with a rhetorical question in the podcast player copy, bullet points that restate the same idea in different words, CTAs that use the word "tune in"
- Forbidden register: wellness-poster language, inspirational-calendar tone, anything that sounds like it was written for a Goop newsletter

WHAT THIS SHOW SOUNDS LIKE INSTEAD:
- Short declarative sentences that land like a fist
- Specificity over generality — name the pain, don't describe it from a distance
- Darkness and humor are allowed to coexist
- The listener should feel seen, not inspired
- If a sentence could appear on a motivational poster, kill it

${templateStructure ? `REQUIRED EPISODE CARD STRUCTURE (from Master Template):\n${templateStructure}` : ""}

CRITICAL OUTPUT RULES:
- The template above is your exact required structure. It is not a suggestion.
- Every ALL CAPS line ending in a colon is a required section heading. Output it verbatim, then complete that section per its instructions.
- Work through every section in order. Do not skip any. Do not add any sections not in the template.
- Write in plain prose. No JSON. No markdown. No asterisks. No code fences.
- This output will be written directly to a Google Doc. Do not add preamble, sign-off, or commentary.
- Start immediately with the first section heading.`;

  const prompt = `Build the complete audience-facing content package for this episode.

GUEST: ${context.guestName}
EPISODE UID: ${context.epUid}

GUEST BRIEF (Herald Research):
${context.guestBriefText || "Not available — work from transcript."}

FINISHED TRANSCRIPT:
${context.transcriptText
  ? context.transcriptText.substring(0, 25000)
  : "Transcript not available."}

${context.transcriptText && context.transcriptText.length > 25000
  ? `NOTE: Transcript was truncated at 25,000 characters. Full transcript is ${context.transcriptText.length} characters.`
  : ""}

Your directive: Find the moments that will make someone stop what they are doing and listen.
Surface the Medicine. Write copy that earns trust, not clicks.
Complete every section. The Episode Card is the permanent record of this episode.`;

  return callGeminiAPINoSearch(prompt, systemInstruction, agentName);
}

/**
 * Extracts top hooks from prose output for manifest storage.
 * Scans for lines starting with "HOOK:" under the Hooks section.
 * Returns first 2 matches joined, or empty string.
 */
function extractTopHooksFromProse(audienceProse) {
  if (!audienceProse) return "";
  const lines = audienceProse.split("\n");
  const hooks = [];

  for (const line of lines) {
    if (hooks.length >= 2) break;
    const trimmed = line.trim();
    if (trimmed.toUpperCase().startsWith("HOOK:")) {
      hooks.push(trimmed.replace(/^HOOK:\s*/i, "").substring(0, 150));
    }
  }

  return hooks.join(" | ");
}


// =============================================================================
// MARCOM: PASS 2 — NOTEBOOKLM SEARCH INDEX (PROSE)
// =============================================================================

/**
 * Generates the rich search index for the NotebookLM archive as prose.
 * Structure is defined in the Master Template under "# THE AI SEARCH INDEX".
 * Edit that section to change field order, depth, or instructions — no code change needed.
 *
 * Per the Preservation Mandate: do NOT thin this prompt.
 */
function generateSearchIndex(context, audienceProse, brandVoice, agentName, epUid) {
  const podcastName = getGovernance("PODCAST_NAME") || "Don't Waste Your Pain";
  const templateStructure = extractPrompt("# THE AI SEARCH INDEX");

  const systemInstruction = `You are The Marcom Fairy for "${podcastName},"
now operating in your Archivist mode. Your job is to build a search index that will
live inside a NotebookLM content archive. This index must be rich enough that an AI
can retrieve this episode in response to specific thematic, emotional, or narrative queries.

Think like a librarian who has read every episode and can connect them across time.
Think like a researcher who needs to find "the episode where someone talked about
forgiving their mother" or "episodes with a Death Initiates + Mothering intersection."

YOUR VOICE: Precise, specific, archival. Every sentence should earn its place.
No filler. No generic summaries. Specific to THIS guest and THIS episode only.

${brandVoice ? `BRAND VOICE (for tonal consistency):\n${brandVoice}` : ""}

${templateStructure
  ? `SEARCH INDEX STRUCTURE (from Master Template — follow this exactly):\n${templateStructure}`
  : `Write the following sections:
PILLAR ALIGNMENT — Primary and Secondary pillar with 2-3 sentences each explaining why.
GUEST PROFILE — Areas of Expertise, Relationship to Pain, Archetype with rationale.
EPISODE CHARACTER — Tonal Profile, Emotional Register, Tension Point.
CONTENT INTELLIGENCE — Primary Themes (hashtag-style), Search Keywords, Standalone Segments, Pairing Notes, Curator Notes.
CORE STATEMENT — Medicine Statement (one sentence).`}

CRITICAL OUTPUT RULES:
- Write in plain prose. No JSON. No markdown. No asterisks. No code fences.
- Use clear section headings in ALL CAPS followed by a colon and line break.
- Sub-items use plain labels followed by a dash or colon. Example:
  PILLAR ALIGNMENT:
  Primary Pillar — Death Initiates: [2-3 sentences]
  Secondary Pillar — Mothering Nurtures: [2-3 sentences]
- This output will be appended directly to a Google Doc.
- Do not add preamble or sign-off.`;

  const prompt = `Build the NotebookLM search index for this episode.

GUEST: ${context.guestName}
EPISODE UID: ${context.epUid}

GUEST BRIEF:
${context.guestBriefText || "Not available."}

AUDIENCE COPY SUMMARY (first 3000 chars of Pass 1 prose):
${audienceProse ? audienceProse.substring(0, 3000) : "Not available."}

TRANSCRIPT (for deep thematic analysis):
${context.transcriptText
  ? context.transcriptText.substring(0, 10000)
  : "Not available — work from Guest Brief and audience copy."}

Your directive: Build the index that lets a future researcher find this episode
when they need exactly what this guest has to offer. Be specific. Be precise.
Generic tags are useless. The Medicine must be findable.`;

  const result = callGeminiAPINoSearch(prompt, systemInstruction, agentName);

  if (!result) {
    logToAuditTrail(agentName, "error", epUid, null,
      "Pass 2 returned empty response. Episode Card Part II will show fallback message.", "warning");
    return "";
  }

  logToAuditTrail(agentName, "state_change", epUid, null,
    `Search index prose generated (${result.length} chars).`, "info");

  return result;
}


// =============================================================================
// MARCOM: EPISODE CARD WRITER
// =============================================================================

/**
 * Clears and writes the Episode Card doc with both passes.
 * Part I: Audience-facing prose appended directly.
 * Part II: Search index prose appended directly — no field extraction.
 *
 * Per the Preservation Mandate: do NOT simplify, rename, or thin this function.
 */
function writeEpisodeCard(docId, audienceProse, searchIndexProse, context, agentName, epUid) {
  try {
    const doc = DocumentApp.openById(docId);
    const body = doc.getBody();

    body.clear();

    // =========================================================================
    // PART 1: EPISODE IDENTITY HEADER + AUDIENCE COPY
    // =========================================================================
    body.appendParagraph("FINISHED EPISODE CARD and INDEXING")
      .setHeading(DocumentApp.ParagraphHeading.HEADING1);
    body.appendParagraph(
      `Episode UID: ${epUid} | Guest: ${context.guestName} | Generated: ${new Date().toDateString()}`
    );
    body.appendParagraph("");

    body.appendParagraph("PART I: THE WRITE-UP (Audience Copy)")
      .setHeading(DocumentApp.ParagraphHeading.HEADING1);
    body.appendParagraph("");

    // Append audience prose line by line to preserve newlines in the Google Doc.
    // appendParagraph() strips \n characters — splitting first is required.
    const audienceLines = (audienceProse || "Audience copy generation did not return content.").split("\n");
    audienceLines.forEach(line => body.appendParagraph(line));

    // =========================================================================
    // PART 2: AI SEARCH INDEX
    // =========================================================================
    body.appendParagraph("");
    body.appendParagraph("─────────────────────────────────────────────");
    body.appendParagraph("PART II: THE AI SEARCH INDEX")
      .setHeading(DocumentApp.ParagraphHeading.HEADING1);
    body.appendParagraph(
      "This section is structured for NotebookLM ingestion and cross-episode retrieval."
    );
    body.appendParagraph("");

    // Append search index prose line by line — same reason as above.
    const searchLines = (
      searchIndexProse ||
      "Search index generation did not return content. Re-run runMarcom() or check Audit Trail."
    ).split("\n");
    searchLines.forEach(line => body.appendParagraph(line));

    doc.saveAndClose();
    logToAuditTrail(agentName, "state_change", epUid, null,
      `Episode Card written for: ${context.guestName}`, "info");

  } catch (e) {
    logToAuditTrail(agentName, "error", epUid, null,
      `writeEpisodeCard failed: ${e.message}`, "error");
    throw e;
  }
}

/**
 * Creates the Episode Card doc in the Staging folder.
 * This is the primary creation path — Marcom is the authority for Episode Card creation.
 * Secretary does not create this doc.
 *
 * Per the Preservation Mandate: do NOT simplify, rename, or thin this function.
 */
function createEpisodeCardDoc(stagingFolderId, guestName, epUid, agentName) {
  try {
    const folder = DriveApp.getFolderById(stagingFolderId);
    const doc = DocumentApp.create(`EpisodeCard_${epUid}_${guestName}`);
    DriveApp.getFileById(doc.getId()).moveTo(folder);
    logToAuditTrail(agentName, "state_change", epUid, null,
      `Episode Card doc created: ${doc.getId()}`, "info");
    return doc.getId();
  } catch (e) {
    logToAuditTrail(agentName, "error", epUid, null,
      `createEpisodeCardDoc failed: ${e.message}`, "error");
    throw e;
  }
}

function testRunMarcom() {
  const TEST_EP_UID = "EP-260325-0552"; // Replace with real Episode UID before running
  runMarcom(TEST_EP_UID);
}