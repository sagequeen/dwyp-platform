// =============================================================================
// herald_fairy.gs — The Herald (Identity Researcher + Brief Writer)
// DWYP Operations Platform
// Part of: GAS Rebuild v1.2
//
// Entry Points:
//   runHerald(contactId, episodeUid)      — Orchestrator: calls Bio then Brief
//   runHeraldBio(contactId)               — Research contact, update Bio_Summary,
//                                           extract and write social fields and
//                                           Organization, create Contact Library
//                                           subfolder
//   runHeraldBrief(contactId, episodeUid) — Create Guest Swipe subfolder,
//                                           generate guest brief doc
//
// Called by: Secretary (automatic); AppSheet manual trigger buttons
// Dependencies: fairy_circle.gs (getGovernance, logToAuditTrail, spawnTask,
//               extractPrompt, callGeminiAPIGrounded, callGeminiAPINoSearch,
//               extractJson, getManifest, writeManifest, getStagingFolderIdByUid,
//               appendEpisodeLog)
//
// Patch notes (post end-to-end test):
//   Fix 1 — All spawnTask() priority values corrected to valid enum
//            (urgent | deep_work | low_energy). "normal" → "low_energy",
//            "high" → "urgent".
//   Fix 2 — All spawnTask() category values corrected to valid enum.
//   Fix 3 — appendEpisodeLog() call added to runHerald().
//   Fix 4 — writeGuestSwipeFolderId() helper added.
//
// Patch notes (prompt assembly refactor):
//   Fix 5 — Research, Bio, and Brief prompts refactored from .replace()
//            placeholder substitution to context block + appended template.
//
// Patch notes (folder structure correction):
//   Fix 6 — Guest brief doc destination changed from Staging to Contact Library.
//
// Patch notes (form handler session):
//   Fix 7  — runHeraldBio() Step 2b: FormContext injection.
//   Fix 8  — runHeraldBrief() Step 1c: FormContext injection.
//   Fix 9  — runHerald() appendEpisodeLog() guarded with episodeUid truthy check.
//   Fix 10 — runHeraldBrief() Step 6 task spawn: workflowStep added.
//   Fix 11 — fairyNudge → executiveSummary at all spawnTask() call sites.
//
// Patch notes (Guest tab retirement):
//   Fix 12 — Guest tab retired. Contact_Library_Folder_ID retargeted to
//             Contacts tab. writeGuestSwipeFolderId() deleted.
//
// Patch notes (v1.5 schema sweep — Handoff v33):
//   Fix 13 — All spawnTask() calls: removed workstream: and category: keys.
//             Normalized assignedBy: to "The Fairy Team" at all call sites.
//             Updated priority: "low_energy" → "normal".
//   Fix 14 — runHeraldBio(): stale Social_Handle read replaced with first
//             populated platform-specific social field (Social_Instagram,
//             Social_X, Social_LinkedIn, Social_YouTube, Social_Podcast,
//             Social_Other). Priority order: Instagram → X → LinkedIn →
//             YouTube → Podcast → Other.
//   Fix 15 — Social fields extraction added to runHeraldBio() after research.
//             Second Gemini call (no search) with JSON-only instruction.
//             writeSocialFields() helper writes up to six fields in one
//             header-driven row pass. Non-fatal — bio proceeds on failure.
//   Fix 16 — Organization extraction added to runHeraldBio() after research.
//             writeOrganization() helper writes lower-third format
//             ("Title, Role at Org") to Contacts tab. Non-fatal.
//   Fix 17 — Bio_Summary 75-word truncation backstop added after Gemini
//             bio generation. Truncates to 75 words and logs WARNING if
//             Gemini returns over limit. Master Template prompt is the
//             primary enforcement; this is the code-level ceiling.
//   Fix 18 — Returning guest logic added to runHeraldBrief(). Queries
//             Episodes tab for prior completed episodes by Contact_ID.
//             If found, prior episode UIDs injected into brief context.
//
// Patch notes (payloadLink fix):
//   Fix 19 — writeGuestBriefDoc() now returns doc.getUrl(). Step 5 call
//             site captures return value as briefDocUrl. Step 6 spawnTask()
//             passes briefDocUrl as payloadLink so JT can open the brief
//             directly from the Review_Guest_Brief task in Pulse.
// =============================================================================


// =============================================================================
// ENTRY POINT 0: runHerald
// Orchestrator — called by Secretary on handoff.
// Calls Bio then Brief independently; Bio failure does not gate Brief.
// Safe to re-run.
// =============================================================================

function runHerald(contactId, episodeUid) {
  const actor = "Herald";

  try {
    runHeraldBio(contactId);
  } catch (e) {
    logToAuditTrail(actor, "error", episodeUid, contactId,
      `runHeraldBio threw unexpectedly: ${e.message}`, "ERROR");
  }

  try {
    runHeraldBrief(contactId, episodeUid);
  } catch (e) {
    logToAuditTrail(actor, "error", episodeUid, contactId,
      `runHeraldBrief threw unexpectedly: ${e.message}`, "ERROR");
  }

  // FIX 9 — Guard appendEpisodeLog() with episodeUid truthy check.
  // On form path, Herald may be called with no episodeUid — logging
  // would throw a spurious error. Only log when episode context exists.
  if (episodeUid) {
    try {
      appendEpisodeLog({
        episodeUid:  episodeUid,
        author:      actor,
        entryType:   "system",
        assetType:   "general",
        body:        "Herald complete: Bio_Summary updated and guest brief generated.",
        resolved:    false,
        visibleTo:   "both"
      });
    } catch (e) {
      logToAuditTrail(actor, "error", episodeUid, contactId,
        `appendEpisodeLog failed in runHerald: ${e.message}`, "WARNING");
    }
  }
}


// =============================================================================
// ENTRY POINT 1: runHeraldBio
// Research a contact via Gemini, update Bio_Summary, extract and write social
// fields and Organization to Contacts tab, create Contact Library subfolder.
// Safe to re-run — no duplicates on re-run.
// =============================================================================

function runHeraldBio(contactId) {
  const actor = "Herald";

  // --- Step 1: Read Contact record ---
  let contact;
  try {
    contact = getContactById(contactId);
  } catch (e) {
    logToAuditTrail(actor, "error", null, contactId,
      `Failed to read contact record: ${e.message}`, "ERROR");
    return;
  }

  if (!contact) {
    logToAuditTrail(actor, "error", null, contactId,
      `No contact record found for ID: ${contactId}`, "ERROR");
    return;
  }

  const displayName  = contact.Display_Name  || "Unknown";
  const email        = contact.Email         || "";
  const website      = contact.Website       || "";
  const personalNote = contact.Personal_Note || "";
  const existingBio  = contact.Bio_Summary   || "";

  // FIX 14 — Social_Handle retired. Read first populated platform-specific
  // social field as the research lead signal.
  // Priority: Instagram → X → LinkedIn → YouTube → Podcast → Other.
  const socialSignal = contact.Social_Instagram
    || contact.Social_X
    || contact.Social_LinkedIn
    || contact.Social_YouTube
    || contact.Social_Podcast
    || contact.Social_Other
    || "";

  // --- Step 2: Ensure Contact Library subfolder exists ---
  let contactFolderId = contact.Contact_Library_Folder_ID || "";
  try {
    contactFolderId = ensureContactLibraryFolder(contactId, displayName, contactFolderId);
    writeContactFolderId(contactId, contactFolderId);
  } catch (e) {
    logToAuditTrail(actor, "error", null, contactId,
      `Contact Library subfolder error: ${e.message}`, "WARNING");
    spawnTask({
      actionTitle:      "Herald: Contact Library folder creation failed — check manually",
      assignee:         getAssigneeByRole("producer"),
      assignedBy:       "The Fairy Team",
      status:           "open",
      priority:         "normal",
      contactId:        contactId,
      executiveSummary: `Could not create or locate Contact Library subfolder for ${displayName}.`
    });
  }

  // --- Step 2b: Read FormContext file from Contact Library ---
  // FIX 7 — If a FormContext file exists for this contact, read its content
  // and inject as Priority 1 into research and bio prompts.
  let formContext = "";
  if (contactFolderId) {
    try {
      const contextFileName = `FormContext_${contactId}.txt`;
      const folder          = DriveApp.getFolderById(contactFolderId);
      const contextFiles    = folder.getFilesByName(contextFileName);
      if (contextFiles.hasNext()) {
        formContext = contextFiles.next().getBlob().getDataAsString();
        logToAuditTrail(actor, "state_change", null, contactId,
          `[INFO] FormContext file found and loaded for ${displayName}.`, "INFO");
      } else {
        logToAuditTrail(actor, "state_change", null, contactId,
          `[INFO] No FormContext file found for ${displayName} — proceeding without form data.`, "INFO");
      }
    } catch (e) {
      logToAuditTrail(actor, "error", null, contactId,
        `[WARNING] FormContext file read failed for ${displayName}: ${e.message}. Proceeding without form data.`, "WARNING");
    }
  }

  // --- Step 3: Research contact via Gemini (grounded) ---
  // FIX 5  — Context block prepended; template appended.
  // FIX 7  — formContext injected as Priority 1 when available.
  // FIX 14 — socialSignal replaces stale Social_Handle read.
  // existingBio intentionally excluded: research step finds fresh verified
  // information. Anchoring to existing bio risks confirming prior errors.
  let researchOutput = "";
  const researchPromptKey = getGovernance("HERALD_RESEARCH_PROMPT_KEY");
  if (!researchPromptKey) {
    logToAuditTrail(actor, "error", null, contactId,
      "HERALD_RESEARCH_PROMPT_KEY not set in Governance_Config. Skipping research step.", "WARNING");
  } else {
    try {
      const researchPromptTemplate = extractPrompt(researchPromptKey);
      const researchContextParts   = [`GUEST NAME: ${displayName}`];
      if (formContext) {
        researchContextParts.push(`FORM SUBMISSION FROM GUEST (Priority 1 — highest trust):\n${formContext}`);
      }
      researchContextParts.push(
        `PERSONAL NOTE FROM JENNIFER (supplementary lead — treat as a lead, not a fact): ${personalNote || "(none)"}`,
        `EMAIL: ${email || "(not provided)"}`,
        `SOCIAL: ${socialSignal || "(not provided)"}`,
        `WEBSITE: ${website || "(not provided)"}`
      );
      const researchPrompt = researchContextParts.join("\n\n") + "\n\n" + researchPromptTemplate;

      const systemInstruction = "You are Herald, a research assistant for the DWYP podcast. Your job is to find accurate, public information about this person to inform their Bio_Summary.";
      researchOutput = callGeminiAPIGrounded(researchPrompt, systemInstruction, "Herald");
    } catch (e) {
      logToAuditTrail(actor, "error", null, contactId,
        `Gemini research call failed: ${e.message}`, "WARNING");
    }
  }

  // --- Step 3b: Extract social fields from research output ---
  // FIX 15 — Second Gemini call (no search) with JSON-only output instruction.
  // Extracts platform-specific social URLs found in research output.
  // writeSocialFields() writes all six fields in one header-driven pass.
  // Non-fatal — bio continues regardless of extraction outcome.
  if (researchOutput) {
    try {
      const socialExtractionPrompt = `You are extracting structured data from a research summary about a person.

Return ONLY a valid JSON object with exactly these six keys. Use null for any field not found.
Do not include any explanation, preamble, or markdown fencing — raw JSON only.

{
  "Social_Instagram": "<full Instagram profile URL or null>",
  "Social_YouTube":   "<full YouTube channel URL or null>",
  "Social_Podcast":   "<Spotify or Apple Podcasts URL — one URL only, prefer Spotify — or null>",
  "Social_LinkedIn":  "<full LinkedIn profile URL or null>",
  "Social_X":         "<full X/Twitter profile URL or null>",
  "Social_Other":     "<TikTok, Facebook, or other social URL — one URL only — or null>"
}

RESEARCH SUMMARY TO EXTRACT FROM:
${researchOutput}`;

      const socialSystemInstruction = "You are a structured data extractor. Return only valid JSON. No markdown. No explanation.";
      const socialRaw = callGeminiAPINoSearch(socialExtractionPrompt, socialSystemInstruction, "Herald");
      const socialData = extractJson(socialRaw);

      if (socialData && !socialData.error) {
        writeSocialFields(contactId, socialData);
        logToAuditTrail(actor, "state_change", null, contactId,
          `[INFO] Social fields extracted and written for ${displayName}.`, "INFO");
      } else {
        logToAuditTrail(actor, "error", null, contactId,
          `[WARNING] Social field extraction returned unparseable JSON for ${displayName}. Social fields not updated.`, "WARNING");
      }
    } catch (e) {
      logToAuditTrail(actor, "error", null, contactId,
        `[WARNING] Social field extraction failed for ${displayName}: ${e.message}. Proceeding without social field update.`, "WARNING");
    }
  }

  // --- Step 3c: Extract Organization from research output ---
  // FIX 16 — Second Gemini call (no search) with JSON-only output instruction.
  // Extracts Organization in lower-third format: "Title, Role at Org".
  // writeOrganization() writes to Contacts tab. Non-fatal.
  if (researchOutput) {
    try {
      const orgExtractionPrompt = `You are extracting a lower-third style organization description for a podcast guest.

Return ONLY a valid JSON object with exactly one key. Use null if insufficient information.
Do not include any explanation, preamble, or markdown fencing — raw JSON only.

Format for Organization: "Title, Role at Org" — for example:
  "Author, Speaker, and Executive at Nike"
  "Therapist and Founder at Healing Roots Counseling"
  "Pastor at Cornerstone Church"

{
  "Organization": "<lower-third format string or null>"
}

RESEARCH SUMMARY TO EXTRACT FROM:
${researchOutput}`;

      const orgSystemInstruction = "You are a structured data extractor. Return only valid JSON. No markdown. No explanation.";
      const orgRaw  = callGeminiAPINoSearch(orgExtractionPrompt, orgSystemInstruction, "Herald");
      const orgData = extractJson(orgRaw);

      if (orgData && !orgData.error && orgData.Organization) {
        writeOrganization(contactId, orgData.Organization);
        logToAuditTrail(actor, "state_change", null, contactId,
          `[INFO] Organization extracted and written for ${displayName}: "${orgData.Organization}"`, "INFO");
      } else {
        logToAuditTrail(actor, "state_change", null, contactId,
          `[INFO] Organization extraction returned no result for ${displayName} — field not updated.`, "INFO");
      }
    } catch (e) {
      logToAuditTrail(actor, "error", null, contactId,
        `[WARNING] Organization extraction failed for ${displayName}: ${e.message}. Proceeding without Organization update.`, "WARNING");
    }
  }

  // --- Step 4: Generate Bio_Summary via Gemini ---
  // FIX 5  — Context block prepended; template appended.
  // FIX 7  — formContext injected as Priority 1 when available.
  // FIX 17 — 75-word truncation backstop applied after generation.
  // existingBio passed here as "improve or replace" signal — correct place for it.
  let newBio = existingBio;
  const bioPromptKey = getGovernance("HERALD_BIO_PROMPT_KEY");
  if (!bioPromptKey) {
    logToAuditTrail(actor, "error", null, contactId,
      "HERALD_BIO_PROMPT_KEY not set in Governance_Config. Bio_Summary not updated.", "WARNING");
    spawnTask({
      actionTitle:      "Herald: Bio prompt key missing — Bio_Summary not updated",
      assignee:         getAssigneeByRole("producer"),
      assignedBy:       "The Fairy Team",
      status:           "open",
      priority:         "normal",
      contactId:        contactId,
      executiveSummary: `HERALD_BIO_PROMPT_KEY missing. Bio_Summary for ${displayName} was not updated.`
    });
  } else {
    try {
      const bioPromptTemplate = extractPrompt(bioPromptKey);
      const bioContextParts   = [`GUEST NAME: ${displayName}`];
      if (formContext) {
        bioContextParts.push(`FORM SUBMISSION FROM GUEST (Priority 1 — highest trust):\n${formContext}`);
      }
      bioContextParts.push(
        `PERSONAL NOTE FROM JENNIFER (supplementary lead — treat as a lead, not a fact): ${personalNote || "(none)"}`,
        `EXISTING BIO (improve or replace based on research): ${existingBio || "(none)"}`,
        `RESEARCH OUTPUT:\n${researchOutput || "(none)"}`
      );
      const bioPrompt = bioContextParts.join("\n\n") + "\n\n" + bioPromptTemplate;

      const systemInstruction = "You are Herald, a research assistant for the DWYP podcast. Your job is to write a concise, accurate Bio_Summary for this contact based on the research provided. The Bio_Summary must be 75 words or fewer.";
      const rawBio = callGeminiAPINoSearch(bioPrompt, systemInstruction, "Herald");

      // FIX 17 — 75-word hard ceiling. Master Template is the primary enforcement.
      // This backstop catches any Gemini response that runs over despite instructions.
      newBio = truncateTo75Words(rawBio, displayName, actor);

    } catch (e) {
      logToAuditTrail(actor, "error", null, contactId,
        `Gemini bio generation failed: ${e.message}`, "WARNING");
      newBio = existingBio; // preserve existing on failure
    }
  }

  // --- Step 5: Write Bio_Summary to Contacts tab ---
  try {
    writeBioSummary(contactId, newBio);
  } catch (e) {
    logToAuditTrail(actor, "error", null, contactId,
      `Failed to write Bio_Summary: ${e.message}`, "ERROR");
    return;
  }

  logToAuditTrail(actor, "state_change", null, contactId,
    `Bio_Summary updated for ${displayName}.`, "INFO");
}


// =============================================================================
// ENTRY POINT 2: runHeraldBrief
// Create Guest Swipe subfolder inside Staging, generate guest brief doc.
// Safe to re-run — overwrites existing brief doc if present.
// =============================================================================

function runHeraldBrief(contactId, episodeUid) {
  const actor = "Herald";

  // --- Step 1: Read Contact record ---
  let contact;
  try {
    contact = getContactById(contactId);
  } catch (e) {
    logToAuditTrail(actor, "error", episodeUid, contactId,
      `Failed to read contact record: ${e.message}`, "ERROR");
    return;
  }

  if (!contact) {
    logToAuditTrail(actor, "error", episodeUid, contactId,
      `No contact record found for ID: ${contactId}`, "ERROR");
    return;
  }

  const displayName = contact.Display_Name || "Unknown";
  const bioSummary  = contact.Bio_Summary  || "";

  // --- Step 1b: Read Contact Library folder ID from Contacts tab ---
  // FIX 12 — Guest tab retired. Contact_Library_Folder_ID now lives on
  // Contacts tab and is returned directly by getContactById().
  let contactFolderId = contact.Contact_Library_Folder_ID || "";

  if (!contactFolderId) {
    logToAuditTrail(actor, "error", episodeUid, contactId,
      `Contact Library folder ID not found for ${displayName}. Cannot write guest brief. Was runHeraldBio() called first?`, "ERROR");
    spawnTask({
      actionTitle:      "Herald: Contact Library folder missing — guest brief not written",
      assignee:         getAssigneeByRole("producer"),
      assignedBy:       "The Fairy Team",
      status:           "open",
      priority:         "urgent",
      contactId:        contactId,
      episodeUid:       episodeUid,
      executiveSummary: `Contact_Library_Folder_ID is empty on the Contacts tab for ${displayName}. Run Herald Bio first, or create the Contact Library folder manually and populate the field.`
    });
    return;
  }

  // --- Step 1c: Read FormContext file from Contact Library ---
  // FIX 8 — Inject form context as Priority 1 into brief prompt.
  let formContext = "";
  try {
    const contextFileName = `FormContext_${contactId}.txt`;
    const folder          = DriveApp.getFolderById(contactFolderId);
    const contextFiles    = folder.getFilesByName(contextFileName);
    if (contextFiles.hasNext()) {
      formContext = contextFiles.next().getBlob().getDataAsString();
      logToAuditTrail(actor, "state_change", episodeUid, contactId,
        `[INFO] FormContext file found and loaded for brief generation — ${displayName}.`, "INFO");
    } else {
      logToAuditTrail(actor, "state_change", episodeUid, contactId,
        `[INFO] No FormContext file found for ${displayName} — brief generated without form data.`, "INFO");
    }
  } catch (e) {
    logToAuditTrail(actor, "error", episodeUid, contactId,
      `[WARNING] FormContext file read failed for ${displayName}: ${e.message}. Proceeding without form data.`, "WARNING");
  }

  // --- Step 1d: Returning guest context ---
  // FIX 18 — Query Episodes tab for prior completed episodes by Contact_ID.
  // If found, inject prior episode UIDs into brief context so Herald knows
  // this is a returning guest and can shape the brief accordingly.
  let returningGuestContext = "";
  try {
    const priorEpisodes = getPriorCompletedEpisodes(contactId, episodeUid);
    if (priorEpisodes.length > 0) {
      returningGuestContext = `RETURNING GUEST — prior episode(s) on record:\n` +
        priorEpisodes.map(ep => `  - ${ep.Episode_UID} (recorded ${ep.Recording_Date || "date unknown"})`).join("\n");
      logToAuditTrail(actor, "state_change", episodeUid, contactId,
        `[INFO] Returning guest detected for ${displayName}. ${priorEpisodes.length} prior episode(s) found.`, "INFO");
    }
  } catch (e) {
    logToAuditTrail(actor, "error", episodeUid, contactId,
      `[WARNING] Returning guest lookup failed for ${displayName}: ${e.message}. Proceeding without prior episode context.`, "WARNING");
  }

  // --- Step 2: Read Production_Folder_ID from Episodes tab ---
  // getStagingFolderIdByUid() reads Production_Folder_ID — see fairy_circle patch #3.
  let stagingFolderId;
  try {
    stagingFolderId = getStagingFolderIdByUid(episodeUid);
  } catch (e) {
    logToAuditTrail(actor, "error", episodeUid, contactId,
      `Failed to read Production_Folder_ID: ${e.message}`, "ERROR");
    return;
  }

  if (!stagingFolderId) {
    logToAuditTrail(actor, "error", episodeUid, contactId,
      `No Production_Folder_ID found for episode ${episodeUid}. Cannot create Guest Swipe folder or brief.`, "ERROR");
    spawnTask({
      actionTitle:      "Herald: Staging folder missing — cannot generate guest brief",
      assignee:         getAssigneeByRole("producer"),
      assignedBy:       "The Fairy Team",
      status:           "open",
      priority:         "urgent",
      contactId:        contactId,
      episodeUid:       episodeUid,
      executiveSummary: `Production folder not found for ${episodeUid}. Guest brief could not be generated for ${displayName}.`
    });
    return;
  }

  // --- Step 3: Create Guest_Swipe subfolder inside Staging ---
  // FIX 12 — writeGuestSwipeFolderId() removed. Manifest is sole authority.
  let swipeFolderId;
  try {
    swipeFolderId = ensureGuestSwipeFolder(stagingFolderId, episodeUid, contactId);
    const manifest = getManifest(stagingFolderId) || {};
    manifest.guest_swipe_folder_id = swipeFolderId;
    writeManifest(stagingFolderId, manifest);
  } catch (e) {
    logToAuditTrail(actor, "error", episodeUid, contactId,
      `Guest Swipe folder error: ${e.message}`, "WARNING");
    spawnTask({
      actionTitle:      "Herald: Guest Swipe folder creation failed — check manually",
      assignee:         getAssigneeByRole("producer"),
      assignedBy:       "The Fairy Team",
      status:           "open",
      priority:         "normal",
      contactId:        contactId,
      episodeUid:       episodeUid,
      executiveSummary: `Could not create Guest_Swipe subfolder in Staging for ${displayName} / ${episodeUid}.`
    });
    // Non-fatal — continue to brief generation
  }

  // --- Step 4: Generate guest brief doc via Gemini ---
  // FIX 5  — Context block prepended; template appended.
  // FIX 8  — formContext injected as Priority 1 when available.
  // FIX 18 — returningGuestContext injected when available.
  // ${brandVoice} placeholder retained in template — .replace() applied
  // to briefPromptTemplate only, after extraction.
  const briefPromptKey = getGovernance("HERALD_BRIEF_PROMPT_KEY");
  if (!briefPromptKey) {
    logToAuditTrail(actor, "error", episodeUid, contactId,
      "HERALD_BRIEF_PROMPT_KEY not set in Governance_Config. Guest brief not generated.", "WARNING");
    spawnTask({
      actionTitle:      "Herald: Brief prompt key missing — guest brief not generated",
      assignee:         getAssigneeByRole("producer"),
      assignedBy:       "The Fairy Team",
      status:           "open",
      priority:         "normal",
      contactId:        contactId,
      episodeUid:       episodeUid,
      executiveSummary: `HERALD_BRIEF_PROMPT_KEY missing. Guest brief for ${displayName} was not generated.`
    });
    return;
  }

  // --- Step 4a: Load Brand Voice doc ---
  let brandVoice = "";
  try {
    brandVoice = DocumentApp.openById(getGovernance("BRAND_VOICE_ID")).getBody().getText();
  } catch (e) {
    logToAuditTrail(actor, "error", episodeUid, contactId,
      `Brand Voice doc could not be loaded: ${e.message}`, "WARNING");
    spawnTask({
      actionTitle:      "Herald: Brand Voice doc failed to load — brief generated without it",
      assignee:         getAssigneeByRole("producer"),
      assignedBy:       "The Fairy Team",
      status:           "open",
      priority:         "normal",
      contactId:        contactId,
      episodeUid:       episodeUid,
      executiveSummary: `BRAND_VOICE_ID doc could not be opened for ${displayName} / ${episodeUid}. Brief was generated without brand voice context.`
    });
  }

  let briefContent;
  try {
    const briefPromptTemplate = extractPrompt(briefPromptKey);
    const briefContextParts   = [
      `GUEST NAME: ${displayName}`,
      `EPISODE UID: ${episodeUid}`
    ];
    if (returningGuestContext) {
      briefContextParts.push(returningGuestContext);
    }
    if (formContext) {
      briefContextParts.push(`FORM SUBMISSION FROM GUEST (Priority 1 — highest trust):\n${formContext}`);
    }
    briefContextParts.push(`BIO SUMMARY: ${bioSummary || "(none)"}`);

    const briefPrompt = briefContextParts.join("\n\n") + "\n\n" + briefPromptTemplate.replace("${brandVoice}", brandVoice);

    const systemInstruction = "You are Herald, a research assistant for Don't Waste Your Pain, a podcast hosted by Jennifer Trepanier. Your output is the host's primary prep tool before the interview. Be accurate, specific, and unflinching. The detailed instructions are in the prompt.";
    briefContent = callGeminiAPINoSearch(briefPrompt, systemInstruction, "Herald");
  } catch (e) {
    logToAuditTrail(actor, "error", episodeUid, contactId,
      `Gemini brief generation failed: ${e.message}`, "ERROR");
    spawnTask({
      actionTitle:      "Herald: Guest brief generation failed",
      assignee:         getAssigneeByRole("producer"),
      assignedBy:       "The Fairy Team",
      status:           "open",
      priority:         "urgent",
      contactId:        contactId,
      episodeUid:       episodeUid,
      executiveSummary: `Gemini failed to generate guest brief for ${displayName} / ${episodeUid}: ${e.message}`
    });
    return;
  }

  // --- Step 5: Write brief doc to Contact Library folder ---
  // FIX 6  — Destination is Contact Library, not Staging.
  // FIX 19 — Capture return value (doc URL) for payloadLink in Step 6.
  let briefDocUrl;
  try {
    briefDocUrl = writeGuestBriefDoc(contactFolderId, displayName, episodeUid, briefContent);
  } catch (e) {
    logToAuditTrail(actor, "error", episodeUid, contactId,
      `Failed to write guest brief doc: ${e.message}`, "ERROR");
    spawnTask({
      actionTitle:      "Herald: Guest brief doc write failed",
      assignee:         getAssigneeByRole("producer"),
      assignedBy:       "The Fairy Team",
      status:           "open",
      priority:         "urgent",
      contactId:        contactId,
      episodeUid:       episodeUid,
      executiveSummary: `Could not write guest brief doc to Contact Library for ${displayName} / ${episodeUid}.`
    });
    return;
  }

  // --- Step 6: Spawn task — brief ready for review ---
  // FIX 10 — workflowStep required for AppSheet action buttons.
  // FIX 19 — payloadLink set to briefDocUrl so JT can open the brief
  //           directly from the Review_Guest_Brief task in Pulse.
  spawnTask({
    actionTitle:      "Review guest brief",
    assignee:         getAssigneeByRole("host"),
    assignedBy:       "The Fairy Team",
    status:           "open",
    priority:         "normal",
    contactId:        contactId,
    episodeUid:       episodeUid,
    workflowStep:     "Review_Guest_Brief",
    payloadLink:      briefDocUrl,
    executiveSummary: `Guest brief for ${displayName} is ready in the Contact Library folder.`
  });

  logToAuditTrail(actor, "state_change", episodeUid, contactId,
    `Guest brief generated and written to Contact Library for ${displayName}.`, "INFO");
}


// =============================================================================
// HELPERS — Contact record reads and writes
// =============================================================================

/**
 * Reads a full Contact record from the Contacts tab by Contact_ID.
 * Returns a plain object keyed by column header, or null if not found.
 */
function getContactById(contactId) {
  const ss    = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty("MASTER_SHEET_ID"));
  const sheet = ss.getSheetByName("Contacts");
  if (!sheet) throw new Error("Contacts tab not found.");

  const data    = sheet.getDataRange().getValues();
  const headers = data[0];
  const idCol   = headers.indexOf("Contact_ID");
  if (idCol === -1) throw new Error("Contact_ID column not found in Contacts tab.");

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idCol]).trim() === String(contactId).trim()) {
      const record = {};
      headers.forEach((h, idx) => { record[h] = data[i][idx]; });
      return record;
    }
  }
  return null;
}

/**
 * Writes Bio_Summary back to the Contacts tab for a given Contact_ID.
 * Never touches any other column, including Personal_Note.
 */
function writeBioSummary(contactId, bioText) {
  const ss    = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty("MASTER_SHEET_ID"));
  const sheet = ss.getSheetByName("Contacts");
  if (!sheet) throw new Error("Contacts tab not found.");

  const data    = sheet.getDataRange().getValues();
  const headers = data[0];
  const idCol   = headers.indexOf("Contact_ID");
  const bioCol  = headers.indexOf("Bio_Summary");
  if (idCol  === -1) throw new Error("Contact_ID column not found in Contacts tab.");
  if (bioCol === -1) throw new Error("Bio_Summary column not found in Contacts tab.");

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idCol]).trim() === String(contactId).trim()) {
      sheet.getRange(i + 1, bioCol + 1).setValue(bioText);
      return;
    }
  }
  throw new Error(`Contact_ID ${contactId} not found — Bio_Summary not written.`);
}

/**
 * Writes Contact_Library_Folder_ID to the Contacts tab for a given Contact_ID.
 * FIX 12 — Retargeted from Guest tab to Contacts tab.
 */
function writeContactFolderId(contactId, folderId) {
  const ss    = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty("MASTER_SHEET_ID"));
  const sheet = ss.getSheetByName("Contacts");
  if (!sheet) throw new Error("Contacts tab not found.");

  const data    = sheet.getDataRange().getValues();
  const headers = data[0];
  const idCol   = headers.indexOf("Contact_ID");
  const folCol  = headers.indexOf("Contact_Library_Folder_ID");
  if (idCol  === -1) throw new Error("Contact_ID column not found in Contacts tab.");
  if (folCol === -1) throw new Error("Contact_Library_Folder_ID column not found in Contacts tab.");

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idCol]).trim() === String(contactId).trim()) {
      sheet.getRange(i + 1, folCol + 1).setValue(folderId);
      return;
    }
  }
  throw new Error(`Contact_ID ${contactId} not found in Contacts tab — Contact_Library_Folder_ID not written.`);
}

/**
 * Writes up to six social platform fields to the Contacts tab in a single row pass.
 * FIX 15 — New helper for v1.5 social fields extraction.
 * Only writes fields with non-null, non-empty values from socialData.
 * Silently skips any key not present in the sheet headers.
 *
 * @param {string} contactId  - Contact_ID to update
 * @param {Object} socialData - Object with any subset of:
 *   { Social_Instagram, Social_YouTube, Social_Podcast,
 *     Social_LinkedIn, Social_X, Social_Other }
 */
function writeSocialFields(contactId, socialData) {
  const SOCIAL_FIELDS = [
    "Social_Instagram", "Social_YouTube", "Social_Podcast",
    "Social_LinkedIn",  "Social_X",       "Social_Other"
  ];

  const ss    = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty("MASTER_SHEET_ID"));
  const sheet = ss.getSheetByName("Contacts");
  if (!sheet) throw new Error("Contacts tab not found.");

  const data    = sheet.getDataRange().getValues();
  const headers = data[0];
  const idCol   = headers.indexOf("Contact_ID");
  if (idCol === -1) throw new Error("Contact_ID column not found in Contacts tab.");

  // Find the target row
  let targetRow = -1;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idCol]).trim() === String(contactId).trim()) {
      targetRow = i + 1; // 1-indexed for getRange
      break;
    }
  }
  if (targetRow === -1) throw new Error(`Contact_ID ${contactId} not found — social fields not written.`);

  // Write each populated social field in a single pass
  SOCIAL_FIELDS.forEach(field => {
    const value = socialData[field];
    if (!value || value === "null") return; // skip null or stringified null
    const colIdx = headers.indexOf(field);
    if (colIdx === -1) return; // field not in sheet — skip silently
    sheet.getRange(targetRow, colIdx + 1).setValue(value);
  });
}

/**
 * Writes Organization field to the Contacts tab in lower-third format.
 * FIX 16 — New helper for v1.5 Organization extraction.
 * Format: "Title, Role at Org" — e.g. "Author, Speaker, and Executive at Nike"
 *
 * @param {string} contactId   - Contact_ID to update
 * @param {string} orgString   - Formatted organization string
 */
function writeOrganization(contactId, orgString) {
  const ss    = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty("MASTER_SHEET_ID"));
  const sheet = ss.getSheetByName("Contacts");
  if (!sheet) throw new Error("Contacts tab not found.");

  const data    = sheet.getDataRange().getValues();
  const headers = data[0];
  const idCol   = headers.indexOf("Contact_ID");
  const orgCol  = headers.indexOf("Organization");
  if (idCol  === -1) throw new Error("Contact_ID column not found in Contacts tab.");
  if (orgCol === -1) throw new Error("Organization column not found in Contacts tab.");

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idCol]).trim() === String(contactId).trim()) {
      sheet.getRange(i + 1, orgCol + 1).setValue(orgString);
      return;
    }
  }
  throw new Error(`Contact_ID ${contactId} not found — Organization not written.`);
}

// NOTE: writeGuestSwipeFolderId() deleted — FIX 12.
// Guest_Swipe_Folder_ID retired from schema. Manifest is sole authority.


// =============================================================================
// HELPERS — Bio truncation
// =============================================================================

/**
 * Truncates a bio string to 75 words.
 * FIX 17 — Hard ceiling enforcing the 75-word Bio_Summary limit.
 * Master Template prompt is the primary enforcement mechanism.
 * This function is the code-level backstop for Gemini overruns.
 * Logs a WARNING to Audit Trail if truncation was required.
 *
 * @param {string} bioText     - Raw bio text from Gemini
 * @param {string} displayName - Guest name for audit log context
 * @param {string} actor       - Fairy name for audit log
 * @returns {string}           - Bio text at 75 words or fewer
 */
function truncateTo75Words(bioText, displayName, actor) {
  if (!bioText) return "";

  const words = bioText.trim().split(/\s+/);
  if (words.length <= 75) return bioText.trim();

  logToAuditTrail(actor, "error", null, "",
    `[WARNING] Bio_Summary for ${displayName} exceeded 75 words (${words.length} words). Truncated to 75.`, "WARNING");

  return words.slice(0, 75).join(" ");
}


// =============================================================================
// HELPERS — Returning guest lookup
// =============================================================================

/**
 * Queries the Episodes tab for prior completed episodes by Contact_ID.
 * Excludes the current episodeUid so it is not returned as a prior episode.
 * Returns array of episode row objects (plain keyed objects), sorted by
 * Recording_Date ascending (oldest first). Returns empty array if none found.
 *
 * FIX 18 — New helper. Replaces Episode_Count-based returning guest logic.
 * Episode_Count removed from v1.5 schema. Contact_ID link to any completed
 * episode is the sufficient signal.
 *
 * @param {string} contactId      - Contact_ID to query
 * @param {string} currentEpUid   - Current episode UID to exclude from results
 * @returns {Array}               - Array of prior episode row objects
 */
function getPriorCompletedEpisodes(contactId, currentEpUid) {
  const ss    = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty("MASTER_SHEET_ID"));
  const sheet = ss.getSheetByName("Episodes");
  if (!sheet) return [];

  const data    = sheet.getDataRange().getValues();
  const headers = data[0];
  const cidCol  = headers.indexOf("Contact_ID");
  const uidCol  = headers.indexOf("Episode_UID");
  const statCol = headers.indexOf("Status");

  if (cidCol === -1 || uidCol === -1 || statCol === -1) return [];

  const prior = [];
  for (let i = 1; i < data.length; i++) {
    const rowCid    = String(data[i][cidCol]).trim();
    const rowUid    = String(data[i][uidCol]).trim();
    const rowStatus = String(data[i][statCol]).trim();

    if (rowCid !== String(contactId).trim()) continue;
    if (rowUid === String(currentEpUid).trim()) continue;
    if (rowStatus !== "complete") continue;

    const row = {};
    headers.forEach((h, idx) => { row[h] = data[i][idx]; });
    prior.push(row);
  }

  // Sort oldest first by Recording_Date
  prior.sort((a, b) => {
    const da = a.Recording_Date ? new Date(a.Recording_Date) : new Date(0);
    const db = b.Recording_Date ? new Date(b.Recording_Date) : new Date(0);
    return da - db;
  });

  return prior;
}


// =============================================================================
// HELPERS — Folder management
// =============================================================================

/**
 * Ensures a Contact Library subfolder exists for this contact.
 * Named: Display_Name_ContactID
 * Returns the folder ID (existing or newly created).
 */
function ensureContactLibraryFolder(contactId, displayName, existingFolderId) {
  const libraryFolderId = getGovernance("CONTACT_LIBRARY_FOLDER_ID");
  if (!libraryFolderId) throw new Error("CONTACT_LIBRARY_FOLDER_ID not set in Governance_Config.");

  const folderName = `${displayName}_${contactId}`;

  if (existingFolderId) {
    try {
      DriveApp.getFolderById(existingFolderId);
      return existingFolderId;
    } catch (e) {
      // Stale folder ID — fall through to create
    }
  }

  const parentFolder = DriveApp.getFolderById(libraryFolderId);
  const existing     = parentFolder.getFoldersByName(folderName);
  if (existing.hasNext()) {
    return existing.next().getId();
  }

  const newFolder = parentFolder.createFolder(folderName);
  return newFolder.getId();
}

/**
 * Ensures a Guest_Swipe subfolder exists inside the Staging folder.
 * Returns the subfolder ID (existing or newly created).
 */
function ensureGuestSwipeFolder(stagingFolderId, episodeUid, contactId) {
  const folderName    = "Guest_Swipe";
  const stagingFolder = DriveApp.getFolderById(stagingFolderId);
  const existing      = stagingFolder.getFoldersByName(folderName);
  if (existing.hasNext()) {
    return existing.next().getId();
  }
  const newFolder = stagingFolder.createFolder(folderName);
  return newFolder.getId();
}


// =============================================================================
// HELPERS — Doc writing
// =============================================================================

/**
 * Writes (or overwrites) the guest brief doc in the target folder.
 * Doc named: GuestBrief_DisplayName_EpisodeUID
 * If a doc with that name already exists, it is trashed and replaced.
 * FIX 19 — Returns doc.getUrl() so the caller can pass it as payloadLink.
 *
 * @returns {string} The URL of the created Google Doc.
 */
function writeGuestBriefDoc(targetFolderId, displayName, episodeUid, briefContent) {
  const docName      = `GuestBrief_${displayName}_${episodeUid}`;
  const targetFolder = DriveApp.getFolderById(targetFolderId);

  const existing = targetFolder.getFilesByName(docName);
  while (existing.hasNext()) {
    existing.next().setTrashed(true);
  }

  const doc  = DocumentApp.create(docName);
  const body = doc.getBody();
  body.setText(briefContent);
  doc.saveAndClose();

  const file = DriveApp.getFileById(doc.getId());
  targetFolder.addFile(file);
  DriveApp.getRootFolder().removeFile(file);
  return doc.getUrl();
}


// =============================================================================
// END OF FILE — herald_fairy.gs
// =============================================================================