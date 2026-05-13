// =============================================================================
// FILE: vert_fairy.gs
// Fairy: The Vert Fairy (Show Notes Architect)
// Version: 1.0 | May 2026
// Author: Claude (Anthropic). Never edit directly in Apps Script or via Gemini.
//
// Replaces: Marcom Fairy (retired — AD #89).
//
// Trigger: Daily Pulse Loop D (finished transcript detection) or manual via
//          "Generate Show Notes" button on Fairy Remote Control.
// Entry point: runVertFairy(epUid)
//
// Job: Reads finished transcript + guest brief. Queries Vertex AI RAG corpus
//      (us-south1, generation via us-central1) to ground output in the show's
//      brand voice and content standards. Generates three-pass show notes per
//      the DWYP template. Writes a Show Notes Google Doc to the Staging root.
//      Patches manifest.show_notes with the doc ID. Hands off to Artist Fairy.
//
// Output format: DWYP PIPELINE DATA block (template: vert_fairy_show_notes.md).
//   PODCAST PLAYER COPY → episode description for podcast platforms
//   KEY TAKEAWAY        → 5 listener takeaways
//   HOOKS               → 10 synthesized hooks (numbered, max 20 words each)
//   QUOTES              → 10 verbatim quotes: 1–5 guest, 6–10 host
//   IMAGE PROMPTS       → 5 art-direction prompts for background images
//
// Artist Fairy reads from manifest.show_notes (falls back to episode_card).
// Section parsing: extractSectionFromProse() reads HOOKS and QUOTES sections.
//   HOOKS: numbered list → Artist Fairy strips "N. " prefix.
//   QUOTES: 1–5 = guest, 6–10 = host → split by HOST_NAME attribution.
//
// Cross-file dependencies (all compiled together in same GAS project):
//   fairy_circle.gs   — getGovernance, getStagingFolderIdByUid, getManifest,
//                       patchManifest, getContactIdByEpisodeUid,
//                       getContactLibraryFolderIdByContactId, logToAuditTrail,
//                       spawnTask, callClaudeAPI
//   filing_fairy.gs   — findGuestBriefInContactLibrary
//   artist_fairy.gs   — runArtistFairy
//
// Governance keys required:
//   STUDIO_CORPUS_ID         — full Vertex AI RAG corpus resource name (us-south1)
//   EPISODE_SEARCH_INDEX_KEY — Drive folder ID for Episode Index docs
//   PODCAST_NAME             — "Don't Waste Your Pain"
//   HOST_NAME                — used to split QUOTES into guest vs host
//   ASSIGNEE_PRODUCER        — Audra's email (for error task spawn)
//   CLAUDE_MODEL             — Claude model (via callClaudeAPI in fairy_circle.gs)
//   CLAUDE_API_KEY           — Anthropic API key (via callClaudeAPI in fairy_circle.gs)
// =============================================================================


// =============================================================================
// ENTRY POINT
// =============================================================================

/**
 * Main entry point. Replaces runMarcom().
 * Orchestrates context gathering, Vertex RAG query, Show Notes doc write,
 * manifest patch, and Artist Fairy handoff.
 *
 */
function runVertFairy(epUid) {
  const agentName = "Vert_Fairy";
  logToAuditTrail(agentName, "state_change", epUid, null,
    `Vert Fairy awakens for: ${epUid}`, "info");

  try {
    const context = gatherVertContext(epUid, agentName);
    if (!context) throw new Error("Could not gather episode context. Vert Fairy cannot proceed.");

    const rawContent = queryVertexShowNotes(context, agentName, epUid);
    if (!rawContent) throw new Error("Show notes generation returned empty content.");

    const showNotesContent = cleanHooksWithClaude(rawContent, agentName, epUid);

    // Create or overwrite Show Notes doc in Staging root
    let showNotesDocId = context.manifest.show_notes || null;

    if (showNotesDocId) {
      logToAuditTrail(agentName, "state_change", epUid, null,
        `Existing Show Notes doc found (${showNotesDocId}). Overwriting.`, "info");
      writeShowNotesDoc(showNotesDocId, showNotesContent, context, agentName, epUid);
    } else {
      showNotesDocId = createShowNotesDoc(
        context.stagingFolderId, context.guestName, epUid, agentName
      );
      writeShowNotesDoc(showNotesDocId, showNotesContent, context, agentName, epUid);
    }

    // Patch manifest — show_notes is now locked as the Google Doc ID
    patchManifest(context.stagingFolderId, {
      show_notes:         showNotesDocId,
      phase:              "3_Curation_Complete",
      status:             "in_progress",
      fairies_dispatched: [...(context.manifest.fairies_dispatched || []), "Vert_Fairy"]
    });

    // Pass 2 — Episode Index (full knowledge doc in dedicated index folder)
    const indexFolderId = getGovernance("EPISODE_SEARCH_INDEX_KEY");
    if (indexFolderId) {
      const indexContent = generateEpisodeIndex(context, showNotesContent, agentName, epUid);
      if (indexContent) {
        createEpisodeIndexDoc(context, indexContent, agentName, epUid, indexFolderId);
      }
    } else {
      logToAuditTrail(agentName, "state_change", epUid, null,
        "EPISODE_SEARCH_INDEX_KEY not configured — Episode Index skipped.", "warning");
    }

    logToAuditTrail(agentName, "state_change", epUid, null,
      `Show Notes complete for ${context.guestName}. Handing off to Artist Fairy.`, "info");

    runArtistFairy(epUid);

  } catch (err) {
    logToAuditTrail(agentName, "error", epUid, null,
      `runVertFairy failed: ${err.message}`, "error");
    spawnTask({
      episodeUid:       epUid,
      workflowStep:     "Produce_Episode",
      actionTitle:      `Show Notes generation failed: ${epUid}`,
      assignee:         getGovernance("ASSIGNEE_PRODUCER"),
      assignedBy:       "The Fairy Team",
      status:           "open",
      priority:         "urgent",
      executiveSummary: `Vert Fairy threw an error: ${err.message}. Check Audit_Trail and retry via Fairy Remote Control → Generate Show Notes.`
    });
  }
}


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

    if (!transcriptText) {
      logToAuditTrail(agentName, "error", epUid, null,
        "No transcript found in Episode/ or Staging root. Vert Fairy cannot run without a finished transcript.", "error");
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


// =============================================================================
// VERTEX RAG RETRIEVAL + CLAUDE GENERATION
// Two-phase pipeline: Vertex AI RAG retrieval (us-south1) → Claude generation.
// Vertex is retrieval only. Claude handles all prose output.
// If retrieval fails, Claude generates without corpus context.
// =============================================================================

/**
 * Phase 1 + Phase 2 orchestrator.
 * Retrieves corpus context from Vertex RAG, then generates with Claude.
 */
function queryVertexShowNotes(context, agentName, epUid) {
  const queryText     = `${context.guestName}: ${context.transcriptText.substring(0, 1000)}`;
  const corpusContext = retrieveVertexRAGContext(queryText, agentName, epUid);
  return generateShowNotesWithClaude(context, corpusContext, agentName, epUid);
}

/**
 * Calls the Vertex AI RAG retrieval API (pure retrieval — no generation).
 * Returns a formatted string of corpus chunks for Claude to use as context.
 * On failure: logs warning and returns empty string — generation still proceeds.
 */
function retrieveVertexRAGContext(queryText, agentName, epUid) {
  const corpusName = getGovernance("STUDIO_CORPUS_ID");
  if (!corpusName) {
    logToAuditTrail(agentName, "state_change", epUid, null,
      "STUDIO_CORPUS_ID not configured — skipping Vertex RAG retrieval.", "warning");
    return "";
  }

  const project  = corpusName.split("/")[1];
  const location = "us-south1";
  const token    = ScriptApp.getOAuthToken();
  const url      = `https://${location}-aiplatform.googleapis.com/v1beta1/projects/${project}/locations/${location}:retrieveContexts`;

  const payload = {
    vertexRagStore: {
      ragResources: [{ ragCorpus: corpusName }]
    },
    query: { text: queryText, similarityTopK: 10 }
  };

  try {
    const response = UrlFetchApp.fetch(url, {
      method:             "post",
      contentType:        "application/json",
      headers:            { Authorization: "Bearer " + token },
      payload:            JSON.stringify(payload),
      muteHttpExceptions: true
    });

    const code = response.getResponseCode();
    const body = response.getContentText();

    if (code !== 200) {
      logToAuditTrail(agentName, "state_change", epUid, null,
        `Vertex RAG retrieval returned ${code}: ${body.substring(0, 300)}. Proceeding without corpus context.`, "warning");
      return "";
    }

    const json     = JSON.parse(body);
    const contexts = (json.contexts && json.contexts.contexts) || [];

    if (!contexts.length) {
      logToAuditTrail(agentName, "state_change", epUid, null,
        "Vertex RAG retrieval returned no contexts. Proceeding without corpus context.", "warning");
      return "";
    }

    const formatted = contexts
      .map(function(c, i) { return `[Source ${i + 1}]\n${c.text || ""}`; })
      .join("\n\n");

    logToAuditTrail(agentName, "state_change", epUid, null,
      `Vertex RAG retrieval: ${contexts.length} chunks (${formatted.length} chars).`, "info");

    return formatted;

  } catch (e) {
    logToAuditTrail(agentName, "state_change", epUid, null,
      `Vertex RAG retrieval threw: ${e.message}. Proceeding without corpus context.`, "warning");
    return "";
  }
}

/**
 * Generates show notes via Claude API.
 * corpusContext: Vertex RAG retrieved chunks (may be empty string if retrieval failed).
 */
function generateShowNotesWithClaude(context, corpusContext, agentName, epUid) {
  const systemInstruction = buildShowNotesSystemInstruction();
  const prompt            = buildShowNotesPrompt(context, corpusContext);

  const result = callClaudeAPI(prompt, systemInstruction, agentName, null, { maxTokens: 8192 });
  if (!result) throw new Error("Claude returned empty content for show notes generation.");

  const source = corpusContext
    ? "Claude + Vertex RAG corpus context"
    : "Claude (no corpus context — retrieval unavailable)";
  logToAuditTrail(agentName, "state_change", epUid, null,
    `Show Notes generated via ${source} (${result.length} chars).`, "info");

  return result;
}


// =============================================================================
// HOOK CLEANUP PASS
// Targeted second Claude call to strip names and pronouns from hooks.
// Extracts HOOKS block, sends it alone, splices cleaned version back in.
// Failures degrade gracefully — original content returned unchanged.
// =============================================================================

/**
 * Sends the HOOKS section to Claude for a targeted cleanup pass.
 * Extracts the block between HOOKS: and QUOTES:, calls Claude with a
 * constrained prompt, then splices the cleaned list back into the full content.
 */
function cleanHooksWithClaude(content, agentName, epUid) {
  const hooksMatch = content.match(/(HOOKS:\n)([\s\S]*?)(\n*QUOTES:)/);
  if (!hooksMatch) {
    logToAuditTrail(agentName, "state_change", epUid, null,
      "cleanHooksWithClaude: HOOKS section not found. Skipping cleanup pass.", "info");
    return content;
  }

  const hooksBlock = hooksMatch[2].trim();
  const cleanupPrompt =
    "Rewrite any hook that describes a person or event. Talk about the concept or insight instead, not what happened.\n" +
    "Wrong: A dying individual refused pain medication to remain awake and say goodbye.\n" +
    "Right: Sometimes, being present means pain. Purpose gives that pain meaning.\n" +
    "Do not use names, pronouns, or generic stand-ins like \"individual,\" \"person,\" or \"a thirteen-year-old.\" " +
    "Keep it simple but significant, at home in a social media feed. " +
    "Return the same numbered list. No preamble, no explanation — just the list.\n\n" +
    hooksBlock;

  try {
    const cleaned = callClaudeAPI(cleanupPrompt, null, agentName, null, { maxTokens: 2048 });
    if (!cleaned) {
      logToAuditTrail(agentName, "error", epUid, null,
        "cleanHooksWithClaude: Claude returned empty response. Original hooks preserved.", "warning");
      return content;
    }

    logToAuditTrail(agentName, "state_change", epUid, null,
      "Hook cleanup pass complete.", "info");

    return content.replace(
      hooksMatch[0],
      hooksMatch[1] + cleaned.trim() + "\n\n" + "QUOTES:"
    );

  } catch (e) {
    logToAuditTrail(agentName, "error", epUid, null,
      `cleanHooksWithClaude failed: ${e.message}. Original hooks preserved.`, "warning");
    return content;
  }
}


// =============================================================================
// PROMPT BUILDERS
// =============================================================================

/**
 * Builds the system instruction for the Vert Fairy.
 * Reads PODCAST_NAME from Governance_Config so it stays current without
 * code changes. Specifies three-pass output structure and all voice rules.
 *
 */
function buildShowNotesSystemInstruction() {
  var podcastName = getGovernance("PODCAST_NAME") || "Don't Waste Your Pain";
  var hostName    = getGovernance("HOST_NAME")    || "JT";

  return `You are The Vert Fairy for "${podcastName}" — a podcast about what lives on the other side of pain, grief, and the moments that break and remake a person.

Your corpus contains the show's Brand Voice document, past Episode Cards, and content standards. Use them. Ground every voice decision in this show's actual standards, not generic podcast copy conventions.

YOUR JOB: Produce a complete three-pass content package for one episode. Everything you write must sound like it came from inside this show — not from a podcast content template.

VOICE PROHIBITIONS — these are automatic failures. If any appear in your output, rewrite before returning:
- Forbidden phrases: "heart-centered," "transformative journey," "profound exploration," "safe space," "deeply moving," "inspires us to," "in a world where," "sit with," "holds space," "unpacks," "dives deep," "game-changer," "paradigm shift," "on this journey," "resonates," "impactful," "journey," "faith-based"
- This show is never to be described or categorized as faith-based. Do not imply it.
- Forbidden register: wellness-poster language, inspirational-calendar tone, Goop newsletter aesthetics, church bulletin
- Forbidden patterns: opening with a rhetorical question, bullet points that restate the same idea in different words, CTAs that use the word "tune in"

WHAT THIS SHOW SOUNDS LIKE:
- Short declarative sentences that land like a fist
- Specificity over generality — name the pain, do not describe it from a distance
- Darkness and humor are allowed to coexist
- The listener should feel seen, not inspired
- If a sentence could appear on a motivational poster, kill it

CRITICAL OUTPUT RULES:
- Output the entire content package inside the DWYP PIPELINE DATA block below
- Use ALL CAPS section headings followed by a colon (e.g., HOOKS:) — this is required for downstream parsing
- Hooks and quotes use numbered lists (1. 2. 3. ...) — one item per line
- Do not skip any section. Do not add sections not listed below.
- Do not use markdown asterisks, JSON, or code fences
- This output is written directly to a Google Doc and parsed by automated systems

PASS 1 — PODCAST PLAYER COPY + TAKEAWAYS:

PODCAST PLAYER COPY (130–160 words):
- Lead with the pain or the question this episode answers — not the guest's biography
- The first sentence should make a listener feel seen before they know who the guest is
- The body names what this guest lived, built, or learned — specifically, not generally
- One sentence may name the guest directly
- The final sentence is the Medicine: what does a listener carry out of this episode?
- Do not sanitize emotions or truth. Humor lives alongside grief. The copy should reflect that.
Hard rules for this section: Do not begin with the guest's name. Do not use rhetorical questions. Write for someone scrolling at midnight who needs exactly what this episode offers. If any sentence could describe any episode on any podcast about this topic, rewrite it.

KEY TAKEAWAY (5 specific takeaways from this episode):
- These are what a listener carries out, not generic themes
- Each is specific to this guest and this conversation

PASS 2 — HOOKS AND QUOTES:

HOOKS (10 total, numbered 1–10):
- Synthesized from the main themes in the source material. Maximum 25 words each.
- Plain text — no "HOOK:" prefix, no quotation marks.

QUOTES (10 total, numbered 1–10):
- 1–5: Guest quotes. 6–10: ${hostName} (host) quotes.
- Verbatim from source material — you may remove filler words, repeated words
- You may use ellipsis to bridge sentences if context is preserved
- Always include attribution at end: — [Speaker Name]
- Maximum 20 words each (excluding attribution)
- Format each line exactly: "Quote text here." — Speaker Name

PASS 3 — ART DIRECTION FOR IMAGE PROMPTS:

IMAGE PROMPTS (5 total, numbered 1–5):
- Use the hooks and quotes as thematic inspiration
- Vary your approach: some with people, some nature, some symbolic objects, some environments
- Describe what to see in the image — specific, evocative, filmlike
- NEVER describe: wellness retreat, church bulletin, factory, fantasy, trite landscapes, soft light rays, clouds, silhouettes with open arms, glowing objects, warm beige or cream palettes, bright even lighting, arranged smiles

OUTPUT FORMAT — copy this structure exactly:

--- DWYP PIPELINE DATA ---

GUEST: [Full guest name]

PODCAST PLAYER COPY:
[Your 130–160 word description here]

KEY TAKEAWAY:
1.
2.
3.
4.
5.

HOOKS:
1.
2.
3.
4.
5.
6.
7.
8.
9.
10.

QUOTES:
1. "..." — [Guest Name]
2. "..." — [Guest Name]
3. "..." — [Guest Name]
4. "..." — [Guest Name]
5. "..." — [Guest Name]
6. "..." — ${hostName}
7. "..." — ${hostName}
8. "..." — ${hostName}
9. "..." — ${hostName}
10. "..." — ${hostName}

IMAGE PROMPTS:
1.
2.
3.
4.
5.

--- END PIPELINE DATA ---`;
}

/**
 * Builds the user-facing prompt for show notes generation.
 * Transcript is truncated at 25,000 characters.
 * corpusContext: retrieved Vertex RAG chunks (empty string if unavailable).
 */
function buildShowNotesPrompt(context, corpusContext) {
  var podcastName = getGovernance("PODCAST_NAME") || "Don't Waste Your Pain";

  var transcriptPreview = context.transcriptText
    ? context.transcriptText.substring(0, 25000)
    : "Transcript not available.";

  var truncationNote = (context.transcriptText && context.transcriptText.length > 25000)
    ? `\nNOTE: Transcript truncated at 25,000 characters. Full transcript is ${context.transcriptText.length} characters.`
    : "";

  var corpusSection = corpusContext
    ? `\nCORPUS CONTEXT — retrieved from the show's brand voice corpus. Ground your voice decisions here:\n${corpusContext}\n`
    : "\nCORPUS CONTEXT: Not available for this run. Rely on voice rules in your system instruction.\n";

  return `Generate the complete show notes content package for the following episode of "${podcastName}."

GUEST: ${context.guestName}
EPISODE UID: ${context.epUid}
${corpusSection}
GUEST BRIEF (Herald Research — treat as highest-trust context about this guest):
${context.guestBriefText || "Not available — work from transcript only."}

FINISHED TRANSCRIPT:
${transcriptPreview}${truncationNote}

Your directive:
Find the moments that would make someone stop what they are doing and listen.
Produce every section completely. This document is the permanent content record for this episode.`;
}


// =============================================================================
// EPISODE INDEX (Pass 2)
// Full knowledge index document for Studio. Created in the dedicated index folder
// (EPISODE_SEARCH_INDEX_KEY). Studio reads it on open to pre-populate all tabs.
// manifest.episode_index is patched with the doc ID on creation.
// Reel descriptions section is left blank — Daily Pulse fills it (Spoke 8).
// =============================================================================

/**
 * Generates the full Episode Index content via Claude.
 * Extracts hooks/quotes/image prompts from show notes rather than regenerating.
 * Generates new sections: summary, guest profile, caption seeds, transcript map.
 */
function generateEpisodeIndex(context, showNotesContent, agentName, epUid) {
  const systemInstruction =
    "You are building the Episode Knowledge Index for Studio — a permanent reference document " +
    "that loads on Studio open for this episode. Return only the markdown document. " +
    "No preamble, no explanation. Section headers must be exact — Studio parses them.";

  const prompt = buildEpisodeIndexPrompt(context, showNotesContent);

  try {
    const result = callClaudeAPI(prompt, systemInstruction, agentName, null, { maxTokens: 4096 });

    if (!result) {
      logToAuditTrail(agentName, "state_change", epUid, null,
        "generateEpisodeIndex: Claude returned empty. Index skipped.", "warning");
      return null;
    }

    logToAuditTrail(agentName, "state_change", epUid, null,
      `Episode index generated (${result.length} chars).`, "info");
    return result;

  } catch (e) {
    logToAuditTrail(agentName, "error", epUid, null,
      `generateEpisodeIndex failed: ${e.message}. Index skipped.`, "warning");
    return null;
  }
}

/**
 * Builds the prompt for Episode Index generation.
 * Show notes passed in full — hooks, quotes, image prompts extracted, not regenerated.
 * Transcript truncated at 15,000 chars for the transcript map section.
 */
function buildEpisodeIndexPrompt(context, showNotesContent) {
  const podcastName = getGovernance("PODCAST_NAME") || "Don't Waste Your Pain";

  const transcriptPreview = context.transcriptText
    ? context.transcriptText.substring(0, 15000)
    : "Not available.";

  return `Create the Episode Knowledge Index for "${podcastName}" — a permanent reference document Studio loads on open.

EPISODE UID: ${context.epUid}
GUEST: ${context.guestName}

GUEST BRIEF:
${context.guestBriefText || "Not available."}

SHOW NOTES (extract hooks, quotes, image prompts from here — do not regenerate them):
${showNotesContent}

TRANSCRIPT EXCERPT (for transcript map):
${transcriptPreview}

Produce the index in this exact structure:

# EPISODE INDEX
UID: ${context.epUid}
GUEST: ${context.guestName}

## EPISODE SUMMARY
[2–3 paragraphs. What this episode is about. Why someone would listen. What the guest brought in and what shifted.]

## GUEST PROFILE
[1–2 paragraphs. Guest background, expertise, what brought them to this topic. Source from guest brief and transcript.]

## KEY THEMES
[5 bullet points — the core concepts this episode explores]

## HOOKS
[Extract all hooks from the HOOKS section of the show notes. Same text, same numbering.]

## QUOTES
[Extract all quotes from the QUOTES section of the show notes. Format: N. "Text." — Speaker]

## IMAGE PROMPTS
[Extract all image prompts from the IMAGE PROMPTS section of the show notes. Same numbering.]

## CAPTION SEEDS
[5–7 short social captions. 1–2 sentences each. Written for Instagram/Threads. No emojis. No rhetorical questions. Hook in the first clause.]

## TRANSCRIPT MAP
[Landmark-dense outline of the episode as it flows. 8–12 bullets. Each bullet: a key moment, topic shift, or emotional turn. Ordered as they appear. No timestamps — sequence is what matters.]

## REEL DESCRIPTIONS
[Leave blank]`;
}

/**
 * Creates the Episode Index Google Doc in the dedicated index folder.
 * Patches manifest.episode_index with the new doc ID so Studio can load it.
 */
function createEpisodeIndexDoc(context, indexContent, agentName, epUid, indexFolderId) {
  try {
    const folder = DriveApp.getFolderById(indexFolderId);
    const doc    = DocumentApp.create(`EpisodeIndex_${epUid}_${context.guestName}`);
    DriveApp.getFileById(doc.getId()).moveTo(folder);

    const body = doc.getBody();
    body.clear();

    const lines = indexContent.split("\n");
    lines.forEach(function(line) { body.appendParagraph(line); });

    doc.saveAndClose();

    patchManifest(context.stagingFolderId, { episode_index: doc.getId() });

    logToAuditTrail(agentName, "state_change", epUid, null,
      `Episode index doc created: ${doc.getId()}`, "info");

  } catch (e) {
    logToAuditTrail(agentName, "error", epUid, null,
      `createEpisodeIndexDoc failed: ${e.message}.`, "warning");
  }
}


// =============================================================================
// DOCUMENT WRITER
// =============================================================================

/**
 * Creates the Show Notes doc in the Staging folder.
 * This is the primary creation path — Vert Fairy is the authority for Show Notes
 * creation. The doc ID is written to manifest.show_notes on success.
 *
 */
function createShowNotesDoc(stagingFolderId, guestName, epUid, agentName) {
  try {
    const folder = DriveApp.getFolderById(stagingFolderId);
    const doc    = DocumentApp.create(`ShowNotes_${epUid}_${guestName}`);
    DriveApp.getFileById(doc.getId()).moveTo(folder);
    logToAuditTrail(agentName, "state_change", epUid, null,
      `Show Notes doc created: ${doc.getId()}`, "info");
    return doc.getId();
  } catch (e) {
    logToAuditTrail(agentName, "error", epUid, null,
      `createShowNotesDoc failed: ${e.message}`, "error");
    throw e;
  }
}

/**
 * Clears and writes the Show Notes doc with the generated content.
 * Content is appended line-by-line to preserve newlines in Google Docs
 * (appendParagraph strips \n characters — splitting first is required).
 *
 */
function writeShowNotesDoc(docId, content, context, agentName, epUid) {
  try {
    const doc  = DocumentApp.openById(docId);
    const body = doc.getBody();

    body.clear();

    body.appendParagraph("SHOW NOTES")
      .setHeading(DocumentApp.ParagraphHeading.HEADING1);
    body.appendParagraph(
      `Episode UID: ${epUid} | Guest: ${context.guestName} | Generated: ${new Date().toDateString()}`
    );
    body.appendParagraph("");

    // Append content line by line — same pattern as writeEpisodeCard()
    const lines = (content || "Show notes generation did not return content. Re-run via Fairy Remote Control and check Audit_Trail.").split("\n");
    lines.forEach(line => body.appendParagraph(line));

    doc.saveAndClose();
    logToAuditTrail(agentName, "state_change", epUid, null,
      `Show Notes doc written for: ${context.guestName}`, "info");

  } catch (e) {
    logToAuditTrail(agentName, "error", epUid, null,
      `writeShowNotesDoc failed: ${e.message}`, "error");
    throw e;
  }
}


// =============================================================================
// TEST WRAPPER
// =============================================================================

function testRunVertFairy() {
  const TEST_EP_UID = "EP-260428-1928"; // Carrie Sipe — replace with real UID before running
  runVertFairy(TEST_EP_UID);
}
