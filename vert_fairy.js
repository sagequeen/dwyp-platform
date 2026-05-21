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
  var hookCount   = parseInt(getGovernance("STUDIO_HOOK_GENERATE_COUNT"),  10) || 10;
  var quoteCount  = parseInt(getGovernance("STUDIO_QUOTE_GENERATE_COUNT"), 10) || 10;

  var hooksOutput = [];
  for (var h = 1; h <= hookCount; h++) hooksOutput.push(h + '.');
  var hooksOutputList = hooksOutput.join('\n');

  var guestEnd   = Math.ceil(quoteCount / 2);
  var quotesOutput = [];
  for (var qi = 1; qi <= guestEnd; qi++) quotesOutput.push(qi + '. "..." — [Guest Name]');
  for (var qi2 = guestEnd + 1; qi2 <= quoteCount; qi2++) quotesOutput.push(qi2 + '. "..." — ' + hostName);
  var quotesOutputList = quotesOutput.join('\n');

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

HOOKS (${hookCount} total, numbered 1–${hookCount}):
- Synthesized from the main themes in the source material. Maximum 25 words each.
- Plain text — no "HOOK:" prefix, no quotation marks.

QUOTES (${quoteCount} total, numbered 1–${quoteCount}):
- 1–${guestEnd}: Guest quotes. ${guestEnd + 1}–${quoteCount}: ${hostName} (host) quotes.
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
${hooksOutputList}

QUOTES:
${quotesOutputList}

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
// EPISODE INDEX V2 — Marker-Driven Build
// No Claude calls. No Show Notes Doc writes. No Asset_Library writes.
// Entry: buildEpisodeIndexV2(epUid, opts)
// Retirement of v1 passes is a separate spoke — this adds alongside, not over.
// =============================================================================

const EPISODE_INDEX_V2_MARKERS = [
  { id: 'vulnerability',  label: 'First-Person Vulnerability',     prompt: 'Passages where the guest reveals something tender or vulnerable about themselves, speaking in first-person present tense. Moments of personal disclosure, admitted struggle, or emotional honesty about ongoing experience.' },
  { id: 'pivot',          label: 'Narrative Pivots',               prompt: 'Moments in the conversation where the guest\'s framing shifts mid-thought, where a previously held understanding changes, or where the narrative arc turns toward unexpected insight. Verbal markers of realization or reversal.' },
  { id: 'distinctive',    label: 'Distinctive Phrasing',           prompt: 'Memorable, quotable lines with idiosyncratic word choice or distinctive phrasing. Sentences that crystallize an idea in unusual language. Sticky statements that stand on their own outside context.' },
  { id: 'emotional_peak', label: 'Emotional Peaks',                prompt: 'High-affect moments where strong emotion surfaces in the conversation — grief, anger, joy, fear, awe. Passages where the emotional register intensifies visibly through word choice, pacing, or admission.' },
  { id: 'reframing',      label: 'Reframing Language',             prompt: 'Moments where the guest takes a commonly held idea, assumption, or framing and tilts it — offers a counter-frame, complicates a binary, or reveals a hidden dimension. Patterns like "actually," "but really," "what people miss."' },
  { id: 'anecdote',       label: 'Concrete Stories and Anecdotes', prompt: 'Specific stories or anecdotes with sensory detail, named people or places, time-bound events. Narrative beats grounded in concrete experience rather than abstract reflection.' },
  { id: 'wisdom',         label: 'Wisdom Statements',              prompt: 'Articulated insights presented as hard-won lessons or theses. Lines where the guest summarizes a learning, principle, or truth they\'ve arrived at through experience.' },
  { id: 'turn_density',   label: 'Speaker-Turn Density Shifts',    prompt: 'Sections where speaker turn rhythm shifts noticeably — back-and-forth dialogue giving way to extended monologue, or vice versa. Moments where one speaker holds the floor uninterrupted, or where rapid exchange picks up after long stretches.' },
  { id: 'callbacks',      label: 'Callbacks',                      prompt: 'Passages where an earlier moment, phrase, or theme is referenced again later in the conversation. Returning motifs, repeated phrases, ideas revisited with new context.' },
  { id: 'boundaries',     label: 'Topic and Phase Boundaries',     prompt: 'Moments where the conversation transitions from one topic, theme, or phase to another. Verbal markers like "so let\'s talk about," "that brings me to," or natural shifts in subject matter.' }
];

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

  // ── 3. Transcript file ID (for doc header) ───────────────────────────────────
  // Primary: Staging/Episode/ subfolder. Fallback: Raw folder (Production_Folder_ID sibling).
  var transcriptFileId = "—";
  try {
    var _transcriptMimeMatch = function(mime, name) {
      return mime === MimeType.PLAIN_TEXT || mime === MimeType.GOOGLE_DOCS || name.endsWith(".txt");
    };
    var _scanFolderForTranscript = function(folder) {
      var it = folder.getFiles();
      while (it.hasNext()) {
        var f = it.next(); var fn = f.getName().toLowerCase(); var fm = f.getMimeType();
        if (fn.startsWith("proxy_")) continue;
        if (fn.includes("transcript") && _transcriptMimeMatch(fm, fn)) return f.getId();
      }
      return null;
    };

    // Primary: Staging/Episode/
    var stagingFolder = DriveApp.getFolderById(stagingFolderId);
    var epFolderIt    = stagingFolder.getFoldersByName("Episode");
    if (epFolderIt.hasNext()) {
      transcriptFileId = _scanFolderForTranscript(epFolderIt.next()) || "—";
    }

    // Fallback: Raw folder
    if (transcriptFileId === "—") {
      var rawFolderId = getRawFolderIdByUid(epUid);
      if (rawFolderId) {
        transcriptFileId = _scanFolderForTranscript(DriveApp.getFolderById(rawFolderId)) || "—";
      }
    }
  } catch (e) {
    errors.push("Transcript file scan failed: " + e.message);
  }

  if (transcriptFileId === "—") {
    logToAuditTrail(agentName, "state_change", epUid, null,
      "buildEpisodeIndexV2: No transcript found in Staging/Episode/ or Raw folder. Corpus queries run whole-corpus.", "warning");
  }

  // ── 4. Influence_Tier from Contacts ─────────────────────────────────────────
  var influenceTier = "—";
  if (contactId) {
    try {
      var cSheet = ss.getSheetByName("Contacts");
      if (cSheet) {
        var cData    = cSheet.getDataRange().getValues();
        var cHeaders = cData[0];
        var cIdCol   = cHeaders.indexOf("Contact_ID");
        var cTierCol = cHeaders.indexOf("Influence_Tier");
        if (cIdCol !== -1 && cTierCol !== -1) {
          for (var ci = 1; ci < cData.length; ci++) {
            if (String(cData[ci][cIdCol]) === contactId) {
              influenceTier = String(cData[ci][cTierCol] || "") || "—";
              break;
            }
          }
        }
      }
    } catch (e) {
      errors.push("Influence_Tier lookup failed: " + e.message);
    }
  }

  // ── 5. Vertex RAG config ────────────────────────────────────────────────────
  var corpusName = getGovernance("STUDIO_CORPUS_ID");
  if (!corpusName) throw new Error("buildEpisodeIndexV2: STUDIO_CORPUS_ID not configured.");

  // VERTEX_RAG_REGION governance key — falls back to hardcoded region until key is populated.
  var region  = getGovernance("VERTEX_RAG_REGION") || "us-south1";
  var project = corpusName.split("/")[1];
  var token   = ScriptApp.getOAuthToken();

  // ── 6. Run 10 marker queries (Pattern A — guest name + epUid prefix) ─────────
  // Prefix biases corpus retrieval toward this episode's speaker labels without
  // embedding opener-transcript content (which would penalize mid-episode peaks).
  var buckets      = {};  // markerID → [{text, score}] after truncation
  var markerCounts = {};

  for (var mi = 0; mi < EPISODE_INDEX_V2_MARKERS.length; mi++) {
    var marker    = EPISODE_INDEX_V2_MARKERS[mi];
    var queryText = "[Episode: " + guestName + " (" + epUid + ")] " + marker.prompt;
    var chunks    = _vertexMarkerQuery_(queryText, corpusName, project, region, token, 15, agentName, epUid);

    if (chunks === null) {
      errors.push("Marker query returned null: " + marker.id);
      buckets[marker.id] = [];
    } else {
      // Sort by similarity score descending; fall back to response order if score absent
      chunks.sort(function(a, b) { return (b.score || 0) - (a.score || 0); });

      // Truncate to 8000 estimated tokens per bucket
      var kept        = [];
      var accumulated = 0;
      for (var ki = 0; ki < chunks.length; ki++) {
        var est = _estimateTokens_(chunks[ki].text);
        if (accumulated + est > 8000) break;
        kept.push(chunks[ki]);
        accumulated += est;
      }
      buckets[marker.id] = kept;
    }
    markerCounts[marker.id] = buckets[marker.id].length;
  }

  // If every marker came back empty, abort — no doc written, no manifest update
  var anySuccess = EPISODE_INDEX_V2_MARKERS.some(function(m) {
    return buckets[m.id] && buckets[m.id].length > 0;
  });
  if (!anySuccess) {
    throw new Error("buildEpisodeIndexV2: all 10 marker queries returned empty. No doc written for " + epUid);
  }

  // ── 7. Assemble markdown ────────────────────────────────────────────────────
  var releaseDateStr = "—";
  if (releaseDate) {
    releaseDateStr = (releaseDate instanceof Date)
      ? releaseDate.toISOString().slice(0, 10)
      : String(releaseDate).slice(0, 10);
  }
  var indexCreated = new Date().toISOString().slice(0, 10);
  var guestSlug    = guestName.toLowerCase()
                      .replace(/[^a-z0-9]+/g, "-")
                      .replace(/^-+|-+$/g, "")
                      .slice(0, 30);

  var md = [];

  // Header
  md.push("# Episode Index v2 — " + epUid);
  md.push("");
  md.push("**Guest:** " + (guestName || "—"));
  md.push("**Release Date:** " + releaseDateStr);
  md.push("**Influence Tier:** " + influenceTier);
  md.push("**Index Created:** " + indexCreated);
  md.push("**Index Version:** 2.0");
  md.push("**Transcript Source:** " + transcriptFileId);
  md.push("");
  md.push("---");
  md.push("");

  // Annotated TOC — driven by the boundaries marker bucket
  md.push("## Annotated Table of Contents");
  md.push("");
  md.push("*Conversation phase boundaries with marker presence per window.*");
  md.push("");

  var boundaryChunks = buckets["boundaries"] || [];
  if (!boundaryChunks.length) {
    md.push("TOC unavailable — boundaries marker returned no results.");
    md.push("");
  } else {
    // Sort chronologically by parsed timestamp
    var sortedBoundaries = boundaryChunks.slice().sort(function(a, b) {
      return _parseTimestampSecs_(a.text) - _parseTimestampSecs_(b.text);
    });

    sortedBoundaries.forEach(function(bc) {
      var bTs   = _parseTimestamp_(bc.text);
      var bSecs = _parseTimestampSecs_(bc.text);
      var brief = _extractFirstSentence_(bc.text);

      // Scan the other 9 markers for chunks within ±60 seconds of this boundary
      var nearby = [];
      EPISODE_INDEX_V2_MARKERS.forEach(function(m) {
        if (m.id === "boundaries") return;
        var hit = (buckets[m.id] || []).some(function(mc) {
          return Math.abs(_parseTimestampSecs_(mc.text) - bSecs) <= 60;
        });
        if (hit) nearby.push(m.label);
      });

      md.push("### [" + bTs + "] — " + brief);
      md.push("Markers present in this window: " + (nearby.length ? nearby.join(", ") : "none"));
      md.push("");
    });
  }

  md.push("---");
  md.push("");

  // Marker Buckets — first 9 in spec order (boundaries drives TOC only)
  md.push("## Marker Buckets");
  md.push("");

  EPISODE_INDEX_V2_MARKERS.forEach(function(marker) {
    if (marker.id === "boundaries") return;
    md.push("### " + marker.label);
    md.push("");
    var mChunks = buckets[marker.id] || [];
    if (!mChunks.length) {
      md.push("*No chunks matched this marker for this episode.*");
      md.push("");
    } else {
      mChunks.forEach(function(c) {
        var ts      = _parseTimestamp_(c.text);
        var speaker = _parseSpeaker_(c.text);
        var body    = (c.text || "").trim();
        md.push("**[" + ts + "]** " + speaker + ": " + body);
        md.push("");
      });
    }
  });

  // Reel Descriptions stub — Daily Pulse owns this section
  md.push("---");
  md.push("");
  md.push("## Reel Descriptions");
  md.push("");
  md.push("*Managed by Daily Pulse — updated when reels are added or removed.*");
  md.push("");
  md.push("**Last Reel Sync:** —");
  md.push("");
  md.push("---");
  md.push("");
  md.push("*Reel sections appended here by Daily Pulse. Do not edit manually.*");

  var markdownContent = md.join("\n");

  // ── 8. Write to Drive ───────────────────────────────────────────────────────
  var indexFolderId = getGovernance("EPISODE_SEARCH_INDEX_KEY");
  if (!indexFolderId) throw new Error("buildEpisodeIndexV2: EPISODE_SEARCH_INDEX_KEY not configured.");

  var fileName    = "Episode_Index_v2_" + epUid + "_" + guestSlug + ".md";
  var indexFolder = DriveApp.getFolderById(indexFolderId);
  var newFile     = indexFolder.createFile(fileName, markdownContent, "text/markdown");
  var newFileId   = newFile.getId();

  // ── 9. Patch manifest ───────────────────────────────────────────────────────
  patchManifest(stagingFolderId, { episode_index_v2: newFileId });

  // ── 10. Audit log + return ──────────────────────────────────────────────────
  var totalTokens = EPISODE_INDEX_V2_MARKERS.reduce(function(sum, m) {
    return sum + (buckets[m.id] || []).reduce(function(s, c) {
      return s + _estimateTokens_(c.text);
    }, 0);
  }, 0);

  logToAuditTrail(agentName, "state_change", epUid, null,
    "EPISODE_INDEX_V2_BUILT: fileId=" + newFileId + " fileName=" + fileName +
    " sizeTokens=" + totalTokens + " markerCounts=" + JSON.stringify(markerCounts) +
    (errors.length ? " errors=" + JSON.stringify(errors) : ""), "info");

  return {
    status:       "built",
    fileId:       newFileId,
    fileName:     fileName,
    markerCounts: markerCounts,
    sizeTokens:   totalTokens,
    errors:       errors
  };
}

/**
 * Runs one Vertex RAG marker query. Returns [{text, score}] or null on fatal failure.
 */
function _vertexMarkerQuery_(queryText, corpusName, project, region, token, topK, agentName, epUid) {
  var url = "https://" + region + "-aiplatform.googleapis.com/v1beta1/projects/" + project +
            "/locations/" + region + ":retrieveContexts";
  var payload = {
    vertexRagStore: { ragResources: [{ ragCorpus: corpusName }] },
    query: { text: queryText, similarityTopK: topK }
  };
  try {
    var resp = UrlFetchApp.fetch(url, {
      method:             "post",
      contentType:        "application/json",
      headers:            { Authorization: "Bearer " + token },
      payload:            JSON.stringify(payload),
      muteHttpExceptions: true
    });
    var code = resp.getResponseCode();
    var body = resp.getContentText();
    if (code !== 200) {
      logToAuditTrail(agentName, "state_change", epUid, null,
        "_vertexMarkerQuery_ HTTP " + code + ": " + body.substring(0, 200), "warning");
      return null;
    }
    var json     = JSON.parse(body);
    var contexts = (json.contexts && json.contexts.contexts) || [];
    return contexts.map(function(c) { return { text: c.text || "", score: c.score || 0 }; });
  } catch (e) {
    logToAuditTrail(agentName, "state_change", epUid, null,
      "_vertexMarkerQuery_ threw: " + e.message, "warning");
    return null;
  }
}

/** Extracts [HH:MM:SS] or HH:MM:SS from chunk text. Returns "HH:MM:SS" or "--:--:--". */
function _parseTimestamp_(text) {
  var m = (text || "").match(/\[?(\d{1,2}:\d{2}:\d{2})\]?/);
  return m ? m[1] : "--:--:--";
}

/** Returns timestamp as total seconds for numeric comparison. */
function _parseTimestampSecs_(text) {
  var m = (text || "").match(/\[?(\d{1,2}):(\d{2}):(\d{2})\]?/);
  if (!m) return 0;
  return parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseInt(m[3], 10);
}

/** Extracts speaker name from chunk text. Expects "SPEAKER: text" or "[HH:MM:SS] SPEAKER: text". */
function _parseSpeaker_(text) {
  var m = (text || "").match(/^\[?[\d:]+\]?\s*([A-Z][A-Za-z\s\-'.]+?):/);
  return m ? m[1].trim() : "Unknown";
}

/** Returns first sentence of chunk text for use as a TOC brief phrase. */
function _extractFirstSentence_(text) {
  // Strip timestamp + speaker prefix, then take first sentence
  var clean = (text || "").replace(/^\[?[\d:]+\]?\s*[A-Za-z][A-Za-z\s\-'.]+?:\s*/, "").trim();
  var m     = clean.match(/^(.{10,80}[.!?])/);
  return m ? m[1] : (clean.slice(0, 60) + (clean.length > 60 ? "…" : ""));
}

function _estimateTokens_(text) {
  return Math.ceil((text || "").length / 4);
}


// =============================================================================
// EDITORIAL PASS (Track B)
// Entry: runEditorialPass(epUid, opts)
// Reads Episode Index v2, calls Claude with Master Template v2.1 structure,
// writes complete Show Notes Doc to the episode's Staging folder.
// No transcript reads. No Vertex calls. No Asset_Library writes.
// Retirement of old Vert passes is a separate spoke — this adds alongside, not over.
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
  var indexV2Id           = manifest ? (manifest.episode_index_v2 || null) : null;

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

  // ── 3. Verify Index v2 ───────────────────────────────────────────────────────
  if (!indexV2Id) {
    throw new Error("runEditorialPass: Episode Index v2 not built — run buildEpisodeIndexV2 first");
  }

  // ── 4. Read inputs ───────────────────────────────────────────────────────────

  // Episode Index v2 — plain markdown file written by buildEpisodeIndexV2
  var episodeIndexV2Text;
  try {
    episodeIndexV2Text = DriveApp.getFileById(indexV2Id).getBlob().getDataAsString();
  } catch (e) {
    throw new Error("runEditorialPass: Could not read Episode Index v2 (" + indexV2Id + "): " + e.message);
  }

  // Content Sensitivity doc
  var contentSensitivityText = "";
  try {
    var contentSensId = getGovernance("CONTENT_SENSITIVITY_ID");
    if (contentSensId) contentSensitivityText = DocumentApp.openById(contentSensId).getBody().getText();
  } catch (e) {
    logToAuditTrail(agentName, "state_change", epUid, null,
      "runEditorialPass: Content Sensitivity doc unreadable: " + e.message + ". Continuing without.", "warning");
  }

  // Guest Brief — best effort via Contact Library
  var guestBriefText = "";
  try {
    if (contactId) {
      var contactLibraryFolderId = getContactLibraryFolderIdByContactId(contactId);
      if (contactLibraryFolderId) {
        guestBriefText = findGuestBriefInContactLibrary(contactLibraryFolderId, epUid, agentName) || "";
      } else {
        logToAuditTrail(agentName, "state_change", epUid, contactId,
          "Contact_Library_Folder_ID not found. Guest Brief unavailable.", "warning");
      }
    }
  } catch (e) {
    logToAuditTrail(agentName, "state_change", epUid, null,
      "runEditorialPass: Guest Brief lookup failed: " + e.message + ". Continuing without.", "warning");
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
    epUid, guestName, releaseDateStr, guestBriefText, contentSensitivityText, episodeIndexV2Text
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
 * Full Episode Index v2 sent without truncation — it is curated and within budget.
 */
function _buildEditorialPassPrompt_(epUid, guestName, releaseDateStr, guestBriefText, contentSensitivityText, episodeIndexV2Text) {
  return "Build the complete audience-facing content package for this episode.\n\n" +
    "GUEST: " + guestName + "\n" +
    "EPISODE UID: " + epUid + "\n" +
    "RELEASE DATE: " + releaseDateStr + "\n\n" +
    "GUEST BRIEF (Concierge Research):\n" +
    (guestBriefText || "Not available — work from the Episode Index.") + "\n\n" +
    "CONTENT SENSITIVITY GUIDE:\n" +
    (contentSensitivityText || "Not available.") + "\n\n" +
    "EPISODE INDEX V2:\n" +
    episodeIndexV2Text + "\n\n" +
    "You are reading a curated Episode Index, not a raw transcript. The Index has been organized by editorial markers — vulnerability, narrative pivots, distinctive phrasing, emotional peaks, reframing language, concrete anecdotes, wisdom statements, speaker dynamics, callbacks, and topic boundaries. Use it. Trust the markers. Find the moments that will make someone stop what they are doing and listen.\n\n" +
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


// =============================================================================
// TEST WRAPPER
// =============================================================================

function testRunVertFairy() {
  const TEST_EP_UID = "EP-260428-1928"; // Carrie Sipe — replace with real UID before running
  runVertFairy(TEST_EP_UID);
}
