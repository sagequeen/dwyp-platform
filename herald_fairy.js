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
// Called by: Secretary (automatic)
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
//
// Patch notes (thin-data hard-stop — Herald 1b.1):
//   Fix 20 — Identity check added to runHerald() before Bio/Brief pass.
//             checkGuestIdentity() calls callGeminiAPIGrounded() with a narrow
//             identity-confirmation prompt (honorifics stripped: Dr., Mr.,
//             Mrs., Ms., Rev., Pastor, Coach, etc.). Returns
//             { confirmed, possibleMatches }.
//             On confirmed identity: normal flow unchanged.
//             On unconfirmed identity (pending path):
//             — runHeraldBio() skips all Gemini research/extraction steps;
//               leaves Bio_Summary untouched (content-or-blank, D12).
//             — runHeraldBrief() skips Gemini brief generation; writes a
//               pending brief doc to Contact Library (same writeGuestBriefDoc
//               helper) listing possible matches; writes identity_pending: true
//               to episode manifest when episodeUid is present; no JT task.
//             — Audra-only task spawned in runHerald() with workflowStep
//               "Verify_Guest_Identity" and executiveSummary
//               "New guest detected — verify identity: [name]".
//             — Audit_Trail logged at each stage; appendEpisodeLog written
//               with pending message when episodeUid present.
//             — Fail-open: identity check error treats contact as confirmed
//               so tool failures never block normal Herald flow.
//             — Standalone runHeraldBio()/runHeraldBrief() calls bypass the
//               check (manual re-runs assume operator has handled identity).
// =============================================================================


// =============================================================================
// ENTRY POINT 0: runHerald
// Orchestrator — called by Secretary on handoff.
// Calls Bio then Brief independently; Bio failure does not gate Brief.
// Safe to re-run.
// =============================================================================

function runHerald(contactId, episodeUid) {
  const actor = "Herald";

  // FIX 20 — Identity check before Bio/Brief pass.
  // Read contact for display name and supplementary signals.
  // Fail-open on any error: null identityResult falls through to confirmed path.
  let identityResult   = null;
  let displayNameCheck = String(contactId); // fallback for log/task messages
  try {
    const contactForCheck = getContactById(contactId);
    if (contactForCheck) {
      displayNameCheck = contactForCheck.Display_Name || String(contactId);
      identityResult   = checkGuestIdentity(
        displayNameCheck,
        contactForCheck.Email || "",
        contactForCheck.Social_Instagram
          || contactForCheck.Social_X
          || contactForCheck.Social_LinkedIn
          || contactForCheck.Social_YouTube
          || contactForCheck.Social_Podcast
          || contactForCheck.Social_Other
          || "",
        contactForCheck.Website || ""
      );
    }
  } catch (e) {
    logToAuditTrail(actor, "error", episodeUid, contactId,
      `[WARNING] Identity check failed — proceeding as confirmed: ${e.message}`, "WARNING");
    identityResult = null;
  }

  // FIX 20 — Pending path: identity not confirmed.
  if (identityResult && identityResult.confirmed === false) {

    try {
      runHeraldBio(contactId, identityResult);
    } catch (e) {
      logToAuditTrail(actor, "error", episodeUid, contactId,
        `runHeraldBio threw unexpectedly (pending path): ${e.message}`, "ERROR");
    }

    if (episodeUid) {
      try {
        runHeraldBrief(contactId, episodeUid, identityResult);
      } catch (e) {
        logToAuditTrail(actor, "error", episodeUid, contactId,
          `runHeraldBrief threw unexpectedly (pending path): ${e.message}`, "ERROR");
      }
    }

    spawnTask({
      actionTitle:      `Verify guest identity: ${displayNameCheck}`,
      assignee:         getGovernance("ASSIGNEE_PRODUCER"),
      assignedBy:       "The Fairy Team",
      status:           "open",
      priority:         "urgent",
      contactId:        contactId,
      episodeUid:       episodeUid || "",
      workflowStep:     "Verify_Guest_Identity",
      executiveSummary: `Herald couldn't confirm this guest's identity with enough confidence to proceed. Check their public profiles, update the contact record with any missing details (email, website, social handles), then re-run Herald from the Fairy Remote Control.`
    });

    logToAuditTrail(actor, "state_change", episodeUid, contactId,
      `Identity unconfirmed for ${displayNameCheck} — Verify_Guest_Identity task spawned for Audra.`, "WARNING");

    if (episodeUid) {
      try {
        appendEpisodeLog({
          episodeUid: episodeUid,
          author:     actor,
          entryType:  "system",
          assetType:  "general",
          body:       `Herald: Identity unconfirmed for ${displayNameCheck} — Audra notified via Verify_Guest_Identity task.`,
          resolved:   false,
          visibleTo:  "both"
        });
      } catch (e) {
        logToAuditTrail(actor, "error", episodeUid, contactId,
          `appendEpisodeLog failed in runHerald (pending path): ${e.message}`, "WARNING");
      }
    }

    return;
  }

  // Confirmed path: normal flow — no changes below this line.
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

function runHeraldBio(contactId, identityResult) {
  const actor = "Herald";

  // Result flags (Enrich cluster, June 2026) — additive return so the
  // Contacts surface can report what actually landed instead of a blanket
  // "Enrichment complete." Existing callers ignore the return value.
  const bioResult = {
    bioUpdated: false, socialUpdated: false, orgUpdated: false,
    socialParseFailed: false, transcriptUsed: false
  };

  // --- Step 1: Read Contact record ---
  let contact;
  try {
    contact = getContactById(contactId);
  } catch (e) {
    logToAuditTrail(actor, "error", null, contactId,
      `Failed to read contact record: ${e.message}`, "ERROR");
    return bioResult;
  }

  if (!contact) {
    logToAuditTrail(actor, "error", null, contactId,
      `No contact record found for ID: ${contactId}`, "ERROR");
    return bioResult;
  }

  const displayName  = contact.Display_Name  || "Unknown";
  const email        = contact.Email         || "";
  const website      = contact.Website       || "";
  const personalNote = contact.Personal_Note || "";
  const existingBio  = contact.Bio_Summary   || "";

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
      assignee:         getGovernance("ASSIGNEE_PRODUCER"),
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

  // D12 — Pending path: identity unconfirmed. Skip all Gemini passes.
  // Bio_Summary is content-or-blank: leave it untouched (no sentinel write).
  // Pending status is carried by the Verify_Guest_Identity task spawned in runHerald.
  if (identityResult && identityResult.confirmed === false) {
    logToAuditTrail(actor, "state_change", null, contactId,
      `[INFO] Identity unconfirmed for ${displayName} — skipping research pass. Bio_Summary left as-is; status carried by task.`, "INFO");
    return bioResult;
  }

  // --- Step 3: Research contact via Gemini (grounded) ---
  // FIX 5  — Context block prepended; template appended.
  // FIX 7  — formContext injected as Priority 1 when available.
  // All populated contact fields ride as breadcrumbs; anchors lead.
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
      // All populated contact fields ride as research breadcrumbs;
      // URL/email anchors lead the context (Contacts surface spoke).
      const anchorLines = [];
      if (email)   anchorLines.push(`EMAIL: ${email}`);
      if (website) anchorLines.push(`WEBSITE: ${website}`);
      [["Social_Instagram", "INSTAGRAM"], ["Social_YouTube", "YOUTUBE"],
       ["Social_Podcast", "PODCAST"], ["Social_LinkedIn", "LINKEDIN"],
       ["Social_X", "X"], ["Social_Other", "OTHER SOCIAL"]].forEach(function(pair) {
        if (contact[pair[0]]) anchorLines.push(`${pair[1]}: ${contact[pair[0]]}`);
      });
      researchContextParts.push(
        `KNOWN PROFILES AND CONTACT POINTS (anchors — research these directly):\n${anchorLines.length ? anchorLines.join("\n") : "(none on record)"}`,
        `PERSONAL NOTE FROM JENNIFER (supplementary lead — treat as a lead, not a fact): ${personalNote || "(none)"}`
      );
      const breadcrumbLines = [];
      if (contact.Organization) breadcrumbLines.push(`ORGANIZATION ON RECORD: ${contact.Organization}`);
      if (contact.Referred_By)  breadcrumbLines.push(`REFERRED BY: ${contact.Referred_By}`);
      if (contact.Tags)         breadcrumbLines.push(`TAGS: ${contact.Tags}`);
      if (breadcrumbLines.length) researchContextParts.push(breadcrumbLines.join("\n"));
      // Enrich cluster (June 2026): if a transcript exists for any of this
      // contact's episodes, the guest's own words ride as a research anchor.
      const transcriptForResearch = _heraldFindTranscriptForContact_(contactId);
      if (transcriptForResearch) {
        bioResult.transcriptUsed = true;
        researchContextParts.push(
          `EPISODE TRANSCRIPT (the guest's own words on the show - high-trust signal for who they are, what they do, and links or organizations they mention):\n${transcriptForResearch}`);
      }
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
        bioResult.socialUpdated = true;
        logToAuditTrail(actor, "state_change", null, contactId,
          `[INFO] Social fields extracted and written for ${displayName}.`, "INFO");
      } else {
        bioResult.socialParseFailed = true;
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
        bioResult.orgUpdated = true;
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
      assignee:         getGovernance("ASSIGNEE_PRODUCER"),
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
    return bioResult;
  }
  bioResult.bioUpdated = (newBio !== existingBio);

  logToAuditTrail(actor, "state_change", null, contactId,
    `Bio_Summary updated for ${displayName}.`, "INFO");
  return bioResult;
}


// =============================================================================
// ENTRY POINT 2: runHeraldBrief
// Create Guest Swipe subfolder inside Staging, generate guest brief doc.
// Safe to re-run — overwrites existing brief doc if present.
// =============================================================================

function runHeraldBrief(contactId, episodeUid, identityResult) {
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
      assignee:         getGovernance("ASSIGNEE_PRODUCER"),
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

  // FIX 20 — Pending path: identity unconfirmed.
  // Write a pending brief doc to Contact Library; flag manifest; no JT task.
  if (identityResult && identityResult.confirmed === false) {
    const matchLines = (identityResult.possibleMatches && identityResult.possibleMatches.length > 0)
      ? identityResult.possibleMatches
          .map(m =>
            `• ${m.name || "(unknown)"} — ${m.platform || "(unknown)"} — ${m.url || "(no URL)"} — Confidence: ${m.confidence || "(unknown)"}`)
          .join("\n")
      : "None found automatically.";

    const pendingBriefContent =
      `GUEST BRIEF — ENRICHMENT PENDING\n` +
      `Guest: ${displayName}\n` +
      `Episode: ${episodeUid || "(none)"}\n\n` +
      `Bio / Research\n` +
      `──────────────\n` +
      `Enrichment Pending — guest identity could not be confirmed automatically.\n` +
      `The full research and bio pass has been skipped pending manual verification.\n\n` +
      `Possible Matches Found\n` +
      `──────────────────────\n` +
      matchLines + `\n\n` +
      `Next Step\n` +
      `─────────\n` +
      `Audra has been notified via a Verify_Guest_Identity task in Pulse.\n` +
      `Once identity is confirmed, re-run Herald Bio and Herald Brief.`;

    try {
      writeGuestBriefDoc(contactFolderId, displayName, episodeUid, pendingBriefContent);
      logToAuditTrail(actor, "state_change", episodeUid, contactId,
        `Pending brief doc written to Contact Library for ${displayName}.`, "INFO");
    } catch (e) {
      logToAuditTrail(actor, "error", episodeUid, contactId,
        `Failed to write pending brief doc: ${e.message}`, "ERROR");
    }

    if (episodeUid) {
      try {
        const pendingFolderId = getStagingFolderIdByUid(episodeUid);
        if (pendingFolderId) {
          const manifest = getManifest(pendingFolderId) || {};
          manifest.identity_pending = true;
          writeManifest(pendingFolderId, manifest);
          logToAuditTrail(actor, "state_change", episodeUid, contactId,
            `Episode manifest updated: identity_pending = true for ${episodeUid}.`, "INFO");
        }
      } catch (e) {
        logToAuditTrail(actor, "error", episodeUid, contactId,
          `[WARNING] Failed to write identity_pending to episode manifest: ${e.message}`, "WARNING");
        if (e.isManifestCorrupt) {
          spawnTask({
            episodeUid:       episodeUid,
            contactId:        contactId,
            actionTitle:      "BLOCKED: Episode manifest corrupt — manual recovery required",
            assignee:         getGovernance("ASSIGNEE_PRODUCER"),
            assignedBy:       "The Fairy Team",
            status:           "open",
            priority:         "urgent",
            executiveSummary: `episode_manifest.json in folder ${e.folderId} failed JSON.parse. The identity_pending write was blocked to prevent data loss. Manually inspect and repair the manifest file for ${episodeUid}.`
          });
        }
      }
    }

    return; // No JT task in pending path.
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
      assignee:         getGovernance("ASSIGNEE_PRODUCER"),
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
    if (e.isManifestCorrupt) {
      spawnTask({
        episodeUid:       episodeUid,
        contactId:        contactId,
        actionTitle:      "BLOCKED: Episode manifest corrupt — manual recovery required",
        assignee:         getGovernance("ASSIGNEE_PRODUCER"),
        assignedBy:       "The Fairy Team",
        status:           "open",
        priority:         "urgent",
        executiveSummary: `episode_manifest.json in folder ${e.folderId || stagingFolderId} failed JSON.parse. The guest_swipe_folder_id write was blocked to prevent data loss. Manually inspect and repair the manifest file for ${episodeUid}.`
      });
    } else {
      spawnTask({
        actionTitle:      "Herald: Guest Swipe folder creation failed — check manually",
        assignee:         getGovernance("ASSIGNEE_PRODUCER"),
        assignedBy:       "The Fairy Team",
        status:           "open",
        priority:         "normal",
        contactId:        contactId,
        episodeUid:       episodeUid,
        executiveSummary: `Could not create Guest_Swipe subfolder in Staging for ${displayName} / ${episodeUid}.`
      });
    }
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
      assignee:         getGovernance("ASSIGNEE_PRODUCER"),
      assignedBy:       "The Fairy Team",
      status:           "open",
      priority:         "normal",
      contactId:        contactId,
      episodeUid:       episodeUid,
      executiveSummary: `HERALD_BRIEF_PROMPT_KEY missing. Guest brief for ${displayName} was not generated.`
    });
    return;
  }

  // --- Step 4a: Load brand context from Master Template sections ---
  const showPhilosophy = extractPrompt("# Show Philosophy");
  const pillars        = extractPrompt("# Pillars");
  if (!showPhilosophy) logToAuditTrail(actor, "state_change", episodeUid, contactId,
    "extractPrompt returned empty for # Show Philosophy — Guest Brief missing show context.", "WARNING");
  if (!pillars) logToAuditTrail(actor, "state_change", episodeUid, contactId,
    "extractPrompt returned empty for # Pillars — Guest Brief missing pillars context.", "WARNING");
  const brandContext = [showPhilosophy, pillars].filter(s => s.trim()).join("\n\n");

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
    // Enrich cluster (June 2026): post-recording re-briefs get the guest's
    // own words. Pre-recording episodes have no transcript - soft no-op.
    const transcriptForBrief = _heraldFindTranscriptForEpisode_(episodeUid);
    if (transcriptForBrief) {
      briefContextParts.push(
        `EPISODE TRANSCRIPT (recording already happened - ground the brief in what was actually said):\n${transcriptForBrief}`);
    }

    const briefPrompt = briefContextParts.join("\n\n") + "\n\n" + briefPromptTemplate.replace("${brandVoice}", brandContext);

    const systemInstruction = "You are Herald, a research assistant for Don't Waste Your Pain, a podcast hosted by Jennifer Trepanier. Your output is the host's primary prep tool before the interview. Be accurate, specific, and unflinching. The detailed instructions are in the prompt.";
    briefContent = callGeminiAPINoSearch(briefPrompt, systemInstruction, "Herald");
  } catch (e) {
    logToAuditTrail(actor, "error", episodeUid, contactId,
      `Gemini brief generation failed: ${e.message}`, "ERROR");
    spawnTask({
      actionTitle:      "Herald: Guest brief generation failed",
      assignee:         getGovernance("ASSIGNEE_PRODUCER"),
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
      assignee:         getGovernance("ASSIGNEE_PRODUCER"),
      assignedBy:       "The Fairy Team",
      status:           "open",
      priority:         "urgent",
      contactId:        contactId,
      episodeUid:       episodeUid,
      executiveSummary: `Could not write guest brief doc to Contact Library for ${displayName} / ${episodeUid}.`
    });
    return;
  }

  // --- Step 6: Spawn task to Audra — brief ready for enrich/approve ---
  // Two-step chain: Audra reviews and enriches first (#2), then approves to
  // trigger spawnGuestBriefReviewForJT() which sends the brief task to JT (#3).
  const confidenceLevel = identityResult?.possibleMatches?.[0]?.confidence || "not checked";
  spawnTask({
    actionTitle:      `Enrich guest brief: ${displayName}`,
    assignee:         getGovernance("ASSIGNEE_PRODUCER"),
    assignedBy:       "The Fairy Team",
    status:           "open",
    priority:         "normal",
    contactId:        contactId,
    episodeUid:       episodeUid,
    workflowStep:     "Guest_Brief_Enrich",
    payloadLink:      briefDocUrl,
    executiveSummary: `Herald has generated the guest brief for ${displayName} (confidence: ${confidenceLevel}). Review it, add any missing handles or websites using the Enrich button, then approve to send it to JT.`
  });

  logToAuditTrail(actor, "state_change", episodeUid, contactId,
    `Guest brief generated and written to Contact Library for ${displayName}. Audra review task spawned.`, "INFO");
}


// =============================================================================
// GUEST BRIEF REVIEW — JT task (called when Audra approves)
// Called from the web app Approve button on the Enrich task.
// Call site wiring is a separate spoke — do not add it here.
// =============================================================================

function spawnGuestBriefReviewForJT(episodeUid, displayName) {
  // Idempotency gate (AD #131): never spawn a second open JT review for the same
  // episode. The shared Approve handler used to net a new Review_Guest_Brief on
  // every approval — this is the backstop against that loop re-forming.
  if (hasOpenReviewGuestBrief(episodeUid)) {
    logToAuditTrail("Herald", "state_change", episodeUid, "",
      `[INFO] JT guest-brief review spawn skipped — open Review_Guest_Brief already exists for ${episodeUid}.`, "INFO");
    return;
  }

  spawnTask({
    actionTitle:      `Review guest brief: ${displayName}`,
    assignee:         getGovernance("ASSIGNEE_HOST"),
    assignedBy:       "The Fairy Team",
    status:           "open",
    priority:         "normal",
    episodeUid:       episodeUid,
    workflowStep:     "Review_Guest_Brief",
    executiveSummary: `The guest brief for ${displayName} is ready for your review. Tap to open it.`
  });
}

/**
 * True if an open or in_progress Review_Guest_Brief task already exists for the
 * given episode. Header-driven read — immune to column reorder.
 */
function hasOpenReviewGuestBrief(episodeUid) {
  const ss    = SpreadsheetApp.openById(getMasterSheetId());
  const sheet = ss.getSheetByName("Tasks");
  if (!sheet) return false;

  const data    = sheet.getDataRange().getValues();
  const headers = data[0];
  const uidCol  = headers.indexOf("Episode_UID");
  const wsCol   = headers.indexOf("Workflow_Step");
  const stCol   = headers.indexOf("Status");
  if (uidCol === -1 || wsCol === -1 || stCol === -1) return false;

  for (let i = 1; i < data.length; i++) {
    const status = String(data[i][stCol]).trim();
    if (String(data[i][uidCol]).trim() === String(episodeUid).trim() &&
        String(data[i][wsCol]).trim() === "Review_Guest_Brief" &&
        (status === "open" || status === "in_progress")) {
      return true;
    }
  }
  return false;
}


// =============================================================================
// HELPERS — Contact record reads and writes
// =============================================================================

/**
 * Reads a full Contact record from the Contacts tab by Contact_ID.
 * Returns a plain object keyed by column header, or null if not found.
 */
function getContactById(contactId) {
  const ss    = SpreadsheetApp.openById(getMasterSheetId());
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
  // D12 — content-or-blank guard. Strip the "**Bio_Summary:**" markdown label
  // Gemini sometimes prepends, so the cell holds bio prose only.
  const cleanBio = String(bioText == null ? "" : bioText)
    .replace(/^\s*\*{0,2}\s*Bio[_ ]?Summary\s*:\s*\*{0,2}\s*/i, "")
    .trim();

  const ss    = SpreadsheetApp.openById(getMasterSheetId());
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
      sheet.getRange(i + 1, bioCol + 1).setValue(cleanBio);
      bumpVersion("contacts", "writeBioSummary");
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
  const ss    = SpreadsheetApp.openById(getMasterSheetId());
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
      bumpVersion("contacts", "writeContactFolderId");
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

  const ss    = SpreadsheetApp.openById(getMasterSheetId());
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
  let wrote = false;
  SOCIAL_FIELDS.forEach(field => {
    const value = socialData[field];
    if (!value || value === "null") return; // skip null or stringified null
    const colIdx = headers.indexOf(field);
    if (colIdx === -1) return; // field not in sheet — skip silently
    sheet.getRange(targetRow, colIdx + 1).setValue(value);
    wrote = true;
  });
  if (wrote) bumpVersion("contacts", "writeSocialFields");
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
  const ss    = SpreadsheetApp.openById(getMasterSheetId());
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
      bumpVersion("contacts", "writeOrganization");
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
// HELPERS — Transcript lookup (Enrich cluster, June 2026)
// If a transcript already exists for a guest's episode, Herald uses it as a
// research anchor: the guest's own words are the highest-quality signal for
// bio, social, and brief passes. Soft-fail throughout — Herald never blocks
// on transcript absence (pre-recording contacts have none by design).
// findTranscriptInFolder() is owned by vert_fairy.js (GAS global scope);
// promotion to fairy_circle per AD #35 is a flagged janitorial candidate.
// =============================================================================

var HERALD_TRANSCRIPT_CHAR_CAP = 50000;

/**
 * Finds a transcript for a specific episode: Episode/ subfolder first,
 * Staging root fallback. Returns capped text or "" (never throws).
 */
function _heraldFindTranscriptForEpisode_(episodeUid) {
  try {
    const stagingFolderId = getStagingFolderIdByUid(episodeUid);
    if (!stagingFolderId) return "";
    const stagingFolder = DriveApp.getFolderById(stagingFolderId);

    let found = null;
    const episodeFolderIt = stagingFolder.getFoldersByName("Episode");
    if (episodeFolderIt.hasNext()) {
      found = findTranscriptInFolder(episodeFolderIt.next(), "Herald", episodeUid, "Episode/");
    }
    if (!found) {
      found = findTranscriptInFolder(stagingFolder, "Herald", episodeUid, "Staging root");
    }
    if (!found || !found.text) return "";

    let text = found.text;
    if (text.length > HERALD_TRANSCRIPT_CHAR_CAP) {
      text = text.substring(0, HERALD_TRANSCRIPT_CHAR_CAP);
      logToAuditTrail("Herald", "state_change", episodeUid, "",
        `[INFO] Transcript truncated to ${HERALD_TRANSCRIPT_CHAR_CAP} chars for Herald context.`, "INFO");
    }
    return text;
  } catch (e) {
    logToAuditTrail("Herald", "error", episodeUid, "",
      `[WARNING] Transcript lookup failed for ${episodeUid}: ${e.message}. Proceeding without transcript.`, "WARNING");
    return "";
  }
}

/**
 * Finds the most recent transcript across a contact's episodes
 * (Recording_Date desc, undated last). Returns capped text or "".
 */
function _heraldFindTranscriptForContact_(contactId) {
  try {
    const ss    = SpreadsheetApp.openById(getMasterSheetId());
    const sheet = ss.getSheetByName("Episodes");
    if (!sheet) return "";

    const data    = sheet.getDataRange().getValues();
    const headers = data[0];
    const cidCol  = headers.indexOf("Contact_ID");
    const uidCol  = headers.indexOf("Episode_UID");
    const rdCol   = headers.indexOf("Recording_Date");
    if (cidCol === -1 || uidCol === -1) return "";

    const candidates = [];
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][cidCol]).trim() !== String(contactId).trim()) continue;
      candidates.push({
        uid: String(data[i][uidCol]).trim(),
        rd:  (rdCol !== -1 && data[i][rdCol]) ? new Date(data[i][rdCol]).getTime() : 0
      });
    }
    candidates.sort(function(a, b) { return b.rd - a.rd; });

    for (let j = 0; j < candidates.length; j++) {
      const text = _heraldFindTranscriptForEpisode_(candidates[j].uid);
      if (text) return text;
    }
    return "";
  } catch (e) {
    logToAuditTrail("Herald", "error", null, contactId,
      `[WARNING] Contact transcript lookup failed: ${e.message}. Proceeding without transcript.`, "WARNING");
    return "";
  }
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
  const ss    = SpreadsheetApp.openById(getMasterSheetId());
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
    if (rowStatus !== "ready_to_release" && rowStatus !== "archived") continue;

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
// HELPERS — Identity verification
// =============================================================================

/**
 * Checks whether a guest can be confirmed as a real, identifiable person
 * on a reputable website or social platform.
 * FIX 20 — New helper for thin-data hard-stop (Herald 1b.1).
 *
 * Uses callGeminiAPIGrounded() with a narrow identity-confirmation prompt.
 * Honorifics (Dr., Mr., Mrs., Ms., Rev., Pastor, Coach, etc.) are stripped
 * by the prompt before the search runs.
 *
 * Fail-open: on any error (Gemini call failure, JSON parse failure),
 * returns { confirmed: true, possibleMatches: [] } so that a tool failure
 * never blocks the normal Herald flow.
 *
 * @param {string} displayName  - Display name from contact record
 * @param {string} email        - Email address (optional identity signal)
 * @param {string} socialSignal - First populated social field (optional signal)
 * @param {string} website      - Website URL (optional signal)
 * @returns {{ confirmed: boolean, possibleMatches: Array }}
 */
function checkGuestIdentity(displayName, email, socialSignal, website) {
  const prompt =
    `You are performing a narrow identity verification for a podcast guest record.\n\n` +
    `GUEST NAME ON FILE: ${displayName}\n` +
    `SUPPLEMENTARY SIGNALS:\n` +
    `- Social: ${socialSignal || "(none)"}\n` +
    `- Website: ${website || "(none)"}\n` +
    `- Email: ${email || "(none)"}\n\n` +
    `TASK:\n` +
    `1. Strip any honorifics from the name on file (Dr., Mr., Mrs., Ms., Rev., Pastor, Coach, and similar titles).\n` +
    `2. Search for this person by their base name on reputable sources: official personal or organizational websites, LinkedIn, Instagram, X/Twitter, YouTube, Wikipedia, and major news outlets.\n` +
    `3. Determine whether you can confirm an EXACT name match — meaning a real, identifiable, specific person with this name, ideally corroborated by any supplementary signal above.\n\n` +
    `Return ONLY a valid JSON object with this exact structure. No markdown. No explanation. No preamble.\n\n` +
    `{\n` +
    `  "identityConfirmed": <true if you can confirm with high confidence, false if not>,\n` +
    `  "possibleMatches": [\n` +
    `    {\n` +
    `      "name": "<name as found on the platform>",\n` +
    `      "platform": "<platform or site name>",\n` +
    `      "url": "<profile or page URL>",\n` +
    `      "confidence": "<High | Medium | Low>"\n` +
    `    }\n` +
    `  ]\n` +
    `}\n\n` +
    `"possibleMatches" must list all candidates found, even if unconfirmed. Use an empty array if none were found.\n` +
    `"identityConfirmed" is true only when you can confirm with high confidence that a real, specific person has this name.`;

  const systemInstruction = "You are a structured data extractor performing identity verification. Return only valid JSON. No markdown. No explanation.";

  try {
    const raw  = callGeminiAPIGrounded(prompt, systemInstruction, "Herald");
    const data = extractJson(raw);

    if (!data || data.error) {
      logToAuditTrail("Herald", "error", null, "",
        `[WARNING] Identity check JSON parse failed for "${displayName}" — treating as confirmed.`, "WARNING");
      return { confirmed: true, possibleMatches: [] };
    }

    return {
      confirmed:       data.identityConfirmed === true,
      possibleMatches: Array.isArray(data.possibleMatches) ? data.possibleMatches : []
    };
  } catch (e) {
    logToAuditTrail("Herald", "error", null, "",
      `[WARNING] Identity check threw for "${displayName}" — treating as confirmed: ${e.message}`, "WARNING");
    return { confirmed: true, possibleMatches: [] };
  }
}


// =============================================================================
// END OF FILE — herald_fairy.gs
// =============================================================================