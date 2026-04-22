// =============================================================================
// FILE: artist_fairy.gs
// Fairy: The Artist Fairy (Visual Asset Architect)
// Trigger: Called automatically at end of runMarcom() in marcom_fairy.gs
// Entry point: runArtistFairy(epUid)
//
// What it does:
//   1. Loads manifest from staging folder
//   2. Resolves guest headshot — reads Contact_Library_Folder_ID from Contacts tab
//      via Contact_ID, searches flat folder for filename containing "headshot"
//   3. Resolves host headshot — scans Raw folder for filename containing "headshot"
//   4. For each of 2 Slides template decks:
//      a. Copies template to target asset subfolder inside Staging
//         (Social_Images)
//      b. Falls back to Staging root if target subfolder not found — logs error
//      c. Replaces all text placeholders across all slides
//      d. Replaces image shapes where alt text matches {{GUEST_HEADSHOT}}
//         or {{HOST_HEADSHOT}} — skips silently if no image file found
//   5. Patches manifest: artist_assets_complete → true
//
//   No tasks are spawned on success. Audra signals readiness via _ready suffix
//   on subfolders. Daily Pulse Loop 4 handles the rest.
//   An Audra task is spawned only on total failure (zero decks populated).
//
// Text placeholders (replaced in all text shapes across all slides):
//   {{HOOK_1}} {{HOOK_2}} {{HOOK_3}} {{HOOK_4}}         — from Episode Card "HOOKS" section
//   {{HOOK_5}} {{HOOK_6}} {{HOOK_7}} {{HOOK_8}}
//   {{GUEST_QUOTE_1}} {{GUEST_QUOTE_2}}                 — from Episode Card "GUEST QUOTES" section
//   {{GUEST_QUOTE_3}} {{GUEST_QUOTE_4}}
//   {{HOST_QUOTE_1}}  {{HOST_QUOTE_2}}                  — from Episode Card "HOST QUOTES" section
//   {{HOST_QUOTE_3}}  {{HOST_QUOTE_4}}
//   {{TITLE_1}} {{TITLE_2}} {{TITLE_3}}                 — from Episode Card "EPISODE TITLES" section
//   {{GUEST_NAME}}                                      — from manifest.guest_name
//   {{HOST_NAME}}                                       — from Governance_Config HOST_NAME
//
// Deck-to-subfolder mapping:
//   ARTIST_SQUARE_DECK_ID   → Social_Images/
//   ARTIST_VERTICAL_DECK_ID → Social_Images/
//
// Image shapes identified by alt text (getDescription()):
//   {{GUEST_HEADSHOT}} — file containing "headshot" in guest Contact Library folder
//   {{HOST_HEADSHOT}}  — file containing "headshot" in Raw folder
//
// GAS image note:
//   replaceWithImage(blob) replaces image content but does NOT preserve crop.
//   Templates use shape masking (decorative shapes layered over image) instead
//   of crop. Audra reviews image positioning before adding _ready to subfolder.
//
// Governance_Config keys required:
//   ARTIST_SQUARE_DECK_ID
//   ARTIST_VERTICAL_DECK_ID
//
// Shared utilities (do not duplicate here):
//   callGeminiAPINoSearch, logToAuditTrail, getGovernance,
//   patchManifest, getManifest, getStagingFolderIdByUid,
//   spawnTask, extractSectionFromProse, getContactIdByEpisodeUid,
//   getContactLibraryFolderIdByContactId — all live in fairy_circle.gs
// =============================================================================


// =============================================================================
// THE ARTIST FAIRY — Entry Point
// =============================================================================

/**
 * Main entry point. Called at end of runMarcom() in marcom_fairy.gs.
 * Loads manifest, resolves headshots, populates all five slide decks.
 */
function runArtistFairy(epUid) {
  const agentName = "Artist_Fairy";
  logToAuditTrail(agentName, "state_change", epUid, null,
    `Artist Fairy starting for: ${epUid}`);

  try {
    // --- Load manifest ---
    const stagingFolderId = getStagingFolderIdByUid(epUid);
    if (!stagingFolderId) throw new Error("Staging folder not found.");

    const manifest = getManifest(stagingFolderId);
    if (!manifest) throw new Error("Manifest not found.");

    const guestName = manifest.guest_name;

    // --- Resolve Episode Card ID for placeholder extraction ---
    // Artist Fairy reads copy directly from the Episode Card doc.
    // extractSectionFromProse() pulls each section by heading.
    const episodeCardId = manifest.asset_ids ? manifest.asset_ids.episode_card : null;
    if (!episodeCardId) {
      logToAuditTrail(agentName, "error", epUid, null,
        "No episode_card ID in manifest. Slide deck placeholders for hooks, quotes, and titles will be blank.");
    }

    // --- Build placeholder map from Episode Card doc ---
    const placeholders = buildPlaceholderMap(manifest, episodeCardId, agentName, epUid);

    // --- Resolve guest headshot blob ---
    // New schema: Contact_ID from Episodes tab → Contact_Library_Folder_ID from
    // Contacts tab → flat search for filename containing "headshot".
    const contactId = getContactIdByEpisodeUid(epUid);
    if (!contactId) {
      logToAuditTrail(agentName, "error", epUid, null,
        "Could not resolve Contact_ID from Episodes tab. Guest headshot will not be inserted.");
    }

    const contactLibraryFolderId = contactId
      ? getContactLibraryFolderIdByContactId(contactId)
      : null;
    if (contactId && !contactLibraryFolderId) {
      logToAuditTrail(agentName, "error", epUid, contactId,
        "Contact_Library_Folder_ID not found on Contacts tab. Guest headshot will not be inserted.");
    }

    const guestHeadshotBlob = resolveGuestHeadshotBlob(
      contactLibraryFolderId,
      agentName,
      epUid,
      contactId
    );

    // --- Resolve host headshot blob ---
    const hostHeadshotBlob = resolveHostHeadshotBlob(
      manifest.raw_folder_id,
      agentName,
      epUid
    );

    // --- Define the two template decks ---
    const decks = [
      { govKey: "ARTIST_SQUARE_DECK_ID",   label: "Square",   subfolder: "Social_Images" },
      { govKey: "ARTIST_VERTICAL_DECK_ID", label: "Vertical", subfolder: "Social_Images" }
    ];

    const populatedDeckIds = [];

    // --- Process each deck ---
    decks.forEach(deck => {
      try {
        const deckId = populateSlideDeck(
          deck.govKey,
          deck.label,
          deck.subfolder,
          stagingFolderId,
          guestName,
          epUid,
          placeholders,
          guestHeadshotBlob,
          hostHeadshotBlob,
          agentName
        );
        if (deckId) populatedDeckIds.push({ label: deck.label, id: deckId });
      } catch (deckErr) {
        // Individual deck failure is logged but does not abort remaining decks
        logToAuditTrail(agentName, "error", epUid, null,
          `${deck.label} deck failed: ${deckErr.message}. Continuing with remaining decks.`);
      }
    });

    // --- Total failure — spawn Audra task ---
    if (populatedDeckIds.length === 0) {
      throw new Error("All five decks failed. Check Audit_Trail for individual deck errors.");
    }

    // --- Patch manifest ---
    patchManifest(stagingFolderId, {
      artist_assets_complete: true,
      fairies_dispatched:     [...(manifest.fairies_dispatched || []), "Artist_Fairy"]
    });

    logToAuditTrail(agentName, "state_change", epUid, null,
      `Artist Fairy complete. ${populatedDeckIds.length} of 5 deck(s) populated for ${guestName}.`);

  } catch (err) {
    logToAuditTrail(agentName, "error", epUid, null, err.message);
    spawnTask({
      episodeUid:       epUid,
      workflowStep:     "Produce_Episode",
      actionTitle:      `Artist Fairy failed for: ${epUid}`,
      assignee:         getGovernance("ASSIGNEE_PRODUCER"),
      assignedBy:       "The Fairy Team",
      status:           "open",
      priority:         "urgent",
      payloadLink:      `https://drive.google.com/drive/folders/${getStagingFolderIdByUid(epUid)}`,
      executiveSummary: `Artist Fairy threw an error: ${err.message}. Slide decks may be missing or incomplete. Check Audit_Trail.`
    });
  }
}


// =============================================================================
// PLACEHOLDER MAP BUILDER
// Extracts all text replacement tokens from the Episode Card doc.
// Reads from Episode Card via extractSectionFromProse() (lives in fairy_circle.gs).
// Any missing values degrade gracefully to "" — no slide errors.
// =============================================================================

/**
 * Builds the complete token → value map for text replacement.
 * Loads Episode Card doc and extracts HOOKS, GUEST QUOTES, HOST QUOTES,
 * and EPISODE TITLES sections via extractSectionFromProse().
 * All values are strings. Missing sections degrade gracefully to "".
 *
 * @param {Object} manifest       - Episode manifest object
 * @param {string} episodeCardId  - Google Doc ID of the Episode Card (may be null)
 * @param {string} agentName      - For audit logging
 * @param {string} epUid          - Episode UID
 */
function buildPlaceholderMap(manifest, episodeCardId, agentName, epUid) {
  const hostName = getGovernance("HOST_NAME") || "JT";

  let hooksLines      = [];
  let guestQuoteLines = [];
  let hostQuoteLines  = [];
  let titleLines      = [];

  // --- Extract sections from Episode Card doc ---
  if (episodeCardId) {
    try {
      const cardText = getBodyTextSkippingHeadings(episodeCardId);
      console.log("cardText sample:\n" + cardText.substring(0, 6000));
      const hooksBlock      = extractSectionFromProse(cardText, "HOOKS");
      const guestQuoteBlock = extractSectionFromProse(cardText, "GUEST QUOTES");
      const hostQuoteBlock  = extractSectionFromProse(cardText, "HOST QUOTES");
      const titlesBlock     = extractSectionFromProse(cardText, "EPISODE TITLES");

      hooksLines      = hooksBlock      ? hooksBlock.split("\n").map(l => l.trim()).filter(l => l)      : [];
      guestQuoteLines = guestQuoteBlock ? guestQuoteBlock.split("\n").map(l => l.trim()).filter(l => l) : [];
      hostQuoteLines  = hostQuoteBlock  ? hostQuoteBlock.split("\n").map(l => l.trim()).filter(l => l)  : [];
      titleLines      = titlesBlock     ? titlesBlock.split("\n").map(l => l.trim()).filter(l => l)     : [];

      logToAuditTrail(agentName, "state_change", epUid, null,
        `Extracted from Episode Card — hooks: ${hooksLines.length}, guest quotes: ${guestQuoteLines.length}, host quotes: ${hostQuoteLines.length}, titles: ${titleLines.length}`);

    } catch (e) {
      logToAuditTrail(agentName, "error", epUid, null,
        `Could not read Episode Card doc: ${e.message}. All content placeholders will be blank.`);
    }
  }

  // Warn on empty sections — decks still run, placeholders resolve to ""
  if (hooksLines.length === 0)
    logToAuditTrail(agentName, "error", epUid, null,
      "HOOKS section empty or not found in Episode Card. {{HOOK_*}} placeholders will be blank.");
  if (guestQuoteLines.length === 0)
    logToAuditTrail(agentName, "error", epUid, null,
      "GUEST QUOTES section empty or not found in Episode Card. {{GUEST_QUOTE_*}} placeholders will be blank.");
  if (hostQuoteLines.length === 0)
    logToAuditTrail(agentName, "error", epUid, null,
      "HOST QUOTES section empty or not found in Episode Card. {{HOST_QUOTE_*}} placeholders will be blank.");
  if (titleLines.length === 0)
    logToAuditTrail(agentName, "error", epUid, null,
      "EPISODE TITLES section empty or not found in Episode Card. {{TITLE_*}} placeholders will be blank.");

  return {
    "{{HOOK_1}}":        hooksLines[0]      || "",
    "{{HOOK_2}}":        hooksLines[1]      || "",
    "{{HOOK_3}}":        hooksLines[2]      || "",
    "{{HOOK_4}}":        hooksLines[3]      || "",
    "{{HOOK_5}}":        hooksLines[4]      || "",
    "{{HOOK_6}}":        hooksLines[5]      || "",
    "{{HOOK_7}}":        hooksLines[6]      || "",
    "{{HOOK_8}}":        hooksLines[7]      || "",
    "{{GUEST_QUOTE_1}}": guestQuoteLines[0] || "",
    "{{GUEST_QUOTE_2}}": guestQuoteLines[1] || "",
    "{{GUEST_QUOTE_3}}": guestQuoteLines[2] || "",
    "{{GUEST_QUOTE_4}}": guestQuoteLines[3] || "",
    "{{HOST_QUOTE_1}}":  hostQuoteLines[0]  || "",
    "{{HOST_QUOTE_2}}":  hostQuoteLines[1]  || "",
    "{{HOST_QUOTE_3}}":  hostQuoteLines[2]  || "",
    "{{HOST_QUOTE_4}}":  hostQuoteLines[3]  || "",
    "{{TITLE_1}}":       titleLines[0]      || "",
    "{{TITLE_2}}":       titleLines[1]      || "",
    "{{TITLE_3}}":       titleLines[2]      || "",
    "{{GUEST_NAME}}":    manifest.guest_name || "",
    "{{HOST_NAME}}":     hostName
  };
}


// =============================================================================
// HEADSHOT BLOB RESOLVERS
// Returns a Drive blob ready for replaceWithImage(), or null if not found.
// All failures are logged and handled gracefully — never throw from here.
// =============================================================================

/**
 * Resolves guest headshot from Contact Library folder.
 * New schema: folder ID comes from Contacts tab via getContactLibraryFolderIdByContactId().
 * Searches flat folder for any file with "headshot" in the filename.
 * Returns blob or null.
 *
 * @param {string} contactLibraryFolderId - From Contacts tab. May be null.
 * @param {string} agentName
 * @param {string} epUid
 * @param {string} contactId - For audit log context. May be null.
 */
function resolveGuestHeadshotBlob(contactLibraryFolderId, agentName, epUid, contactId) {
  if (!contactLibraryFolderId) {
    logToAuditTrail(agentName, "error", epUid, contactId,
      "No Contact_Library_Folder_ID available. Guest headshot will not be inserted.");
    return null;
  }

  try {
    const folder = DriveApp.getFolderById(contactLibraryFolderId);
    const files = folder.getFiles();

    while (files.hasNext()) {
      const file = files.next();
      const name = file.getName().toLowerCase();
      if (name.includes("headshot") &&
          (name.endsWith(".png") || name.endsWith(".jpg") || name.endsWith(".jpeg"))) {
        logToAuditTrail(agentName, "state_change", epUid, contactId,
          `Guest headshot located: ${file.getName()}`);
        return file.getBlob();
      }
    }

    logToAuditTrail(agentName, "error", epUid, contactId,
      `No file with "headshot" in name found in Contact Library folder: ${contactLibraryFolderId}. Guest headshot will not be inserted.`);
    return null;

  } catch (e) {
    logToAuditTrail(agentName, "error", epUid, contactId,
      `Error accessing Contact Library folder: ${e.message}. Guest headshot will not be inserted.`);
    return null;
  }
}

/**
 * Scans the Raw folder for a file containing "headshot" in the filename.
 * Accepts .png, .jpg, or .jpeg.
 * Returns blob or null.
 */
function resolveHostHeadshotBlob(rawFolderId, agentName, epUid) {
  if (!rawFolderId) {
    logToAuditTrail(agentName, "error", epUid, null,
      "No raw_folder_id in manifest. Host headshot will not be inserted.");
    return null;
  }

  try {
    const folder = DriveApp.getFolderById(rawFolderId);
    const files = folder.getFiles();

    while (files.hasNext()) {
      const file = files.next();
      const name = file.getName().toLowerCase();
      if (name.includes("headshot") &&
          (name.endsWith(".png") || name.endsWith(".jpg") || name.endsWith(".jpeg"))) {
        logToAuditTrail(agentName, "state_change", epUid, null,
          `Host headshot located: ${file.getName()}`);
        return file.getBlob();
      }
    }

    logToAuditTrail(agentName, "error", epUid, null,
      `No file with "headshot" in name found in Raw folder: ${rawFolderId}. Host headshot will not be inserted.`);
    return null;

  } catch (e) {
    logToAuditTrail(agentName, "error", epUid, null,
      `Error accessing Raw folder for host headshot: ${e.message}. Host headshot will not be inserted.`);
    return null;
  }
}


// =============================================================================
// SLIDE DECK POPULATOR
// Copies a template deck to the target asset subfolder inside Staging,
// then processes all slides. Falls back to Staging root if subfolder not found.
// =============================================================================

/**
 * Copies the template deck to the target subfolder (or Staging root on fallback),
 * then populates it. Returns the new file ID, or null if template ID is missing.
 *
 * @param {string} govKey           - Governance_Config key for template ID
 * @param {string} label            - Deck label (e.g., "Host_Square")
 * @param {string} subfolderName    - Target subfolder name (e.g., "Host_Graphics")
 * @param {string} stagingFolderId  - Staging folder ID
 * @param {string} guestName        - Guest display name
 * @param {string} epUid            - Episode UID
 * @param {Object} placeholders     - Token → value map
 * @param {Blob}   guestHeadshotBlob
 * @param {Blob}   hostHeadshotBlob
 * @param {string} agentName
 */
function populateSlideDeck(govKey, label, subfolderName, stagingFolderId, guestName, epUid, placeholders, guestHeadshotBlob, hostHeadshotBlob, agentName) {
  const templateId = getGovernance(govKey);
  if (!templateId) {
    logToAuditTrail(agentName, "error", epUid, null,
      `${govKey} not found in Governance_Config. ${label} deck skipped.`);
    return null;
  }

  logToAuditTrail(agentName, "state_change", epUid, null,
    `Processing ${label} deck...`);

  // --- Resolve target folder ---
  // Look for named subfolder inside Staging. Fall back to Staging root if not found.
  let targetFolder = null;
  try {
    const stagingFolder = DriveApp.getFolderById(stagingFolderId);
    const subfolders = stagingFolder.getFoldersByName(subfolderName);
    if (subfolders.hasNext()) {
      targetFolder = subfolders.next();
    } else {
      logToAuditTrail(agentName, "error", epUid, null,
        `Subfolder "${subfolderName}" not found inside Staging. ${label} deck will be copied to Staging root instead.`);
      targetFolder = stagingFolder;
    }
  } catch (e) {
    logToAuditTrail(agentName, "error", epUid, null,
      `Error resolving target folder for ${label} deck: ${e.message}. Falling back to Staging root.`);
    targetFolder = DriveApp.getFolderById(stagingFolderId);
  }

  // --- Copy template to target folder ---
  const templateFile = DriveApp.getFileById(templateId);
  const deckCopy = templateFile.makeCopy(
    `SocialGraphics_${label}_${epUid}_${guestName}`,
    targetFolder
  );
  const deckId = deckCopy.getId();

  logToAuditTrail(agentName, "state_change", epUid, null,
    `${label} deck copied to ${subfolderName}: ${deckId}`);

  // --- Open as Presentation and process all slides ---
  const presentation = SlidesApp.openById(deckId);
  const slides = presentation.getSlides();

  slides.forEach((slide, slideIndex) => {
    try {
      processSlide(slide, slideIndex + 1, placeholders, guestHeadshotBlob, hostHeadshotBlob, agentName, epUid, label);
    } catch (slideErr) {
      logToAuditTrail(agentName, "error", epUid, null,
        `${label} deck, slide ${slideIndex + 1}: ${slideErr.message}. Continuing.`);
    }
  });

  presentation.saveAndClose();

  logToAuditTrail(agentName, "state_change", epUid, null,
    `${label} deck populated successfully: ${deckId}`);

  return deckId;
}


// =============================================================================
// SLIDE PROCESSOR
// Iterates all elements on a slide — replaces text and images.
// =============================================================================

/**
 * Processes all page elements on a single slide.
 * Text replacement: iterates all shapes with text, replaces placeholder tokens.
 * Image replacement: finds pictures by alt text (getDescription()), replaces blob.
 */
function processSlide(slide, slideNumber, placeholders, guestHeadshotBlob, hostHeadshotBlob, agentName, epUid, deckLabel) {
  const elements = slide.getPageElements();

  elements.forEach(element => {
    const elementType = element.getPageElementType();

    if (elementType === SlidesApp.PageElementType.SHAPE) {
      const shape = element.asShape();
      if (shape.getText()) {
        replaceTextPlaceholders(shape.getText(), placeholders);
      }
    }

    else if (elementType === SlidesApp.PageElementType.IMAGE) {
      const image = element.asImage();
      const altText = image.getDescription();

      if (altText === "{{GUEST_HEADSHOT}}") {
        if (guestHeadshotBlob) {
          try {
            image.replace(guestHeadshotBlob);
            logToAuditTrail(agentName, "state_change", epUid, null,
              `${deckLabel} deck, slide ${slideNumber}: Guest headshot inserted.`);
          } catch (e) {
            logToAuditTrail(agentName, "error", epUid, null,
              `${deckLabel} deck, slide ${slideNumber}: Could not insert guest headshot: ${e.message}`);
          }
        } else {
          logToAuditTrail(agentName, "state_change", epUid, null,
            `${deckLabel} deck, slide ${slideNumber}: {{GUEST_HEADSHOT}} slot found but no blob available. Slot left as-is.`);
        }
      }

      else if (altText === "{{HOST_HEADSHOT}}") {
        if (hostHeadshotBlob) {
          try {
            image.replace(hostHeadshotBlob);
            logToAuditTrail(agentName, "state_change", epUid, null,
              `${deckLabel} deck, slide ${slideNumber}: Host headshot inserted.`);
          } catch (e) {
            logToAuditTrail(agentName, "error", epUid, null,
              `${deckLabel} deck, slide ${slideNumber}: Could not insert host headshot: ${e.message}`);
          }
        } else {
          logToAuditTrail(agentName, "state_change", epUid, null,
            `${deckLabel} deck, slide ${slideNumber}: {{HOST_HEADSHOT}} slot found but no blob available. Slot left as-is.`);
        }
      }
    }

    else if (elementType === SlidesApp.PageElementType.GROUP) {
      processGroup(element.asGroup(), slideNumber, placeholders, guestHeadshotBlob, hostHeadshotBlob, agentName, epUid, deckLabel);
    }
  });
}

/**
 * Recurses into a group element to process shapes and images within it.
 * Groups can be nested, so this calls itself recursively.
 */
function processGroup(group, slideNumber, placeholders, guestHeadshotBlob, hostHeadshotBlob, agentName, epUid, deckLabel) {
  const children = group.getChildren();

  children.forEach(child => {
    const childType = child.getPageElementType();

    if (childType === SlidesApp.PageElementType.SHAPE) {
      const shape = child.asShape();
      if (shape.getText()) {
        replaceTextPlaceholders(shape.getText(), placeholders);
      }
    }

    else if (childType === SlidesApp.PageElementType.IMAGE) {
      const image = child.asImage();
      const altText = image.getDescription();

      if (altText === "{{GUEST_HEADSHOT}}" && guestHeadshotBlob) {
        try {
          image.replace(guestHeadshotBlob);
        } catch (e) {
          logToAuditTrail(agentName, "error", epUid, null,
            `${deckLabel} deck, slide ${slideNumber} (group): Could not insert guest headshot: ${e.message}`);
        }
      }
      else if (altText === "{{HOST_HEADSHOT}}" && hostHeadshotBlob) {
        try {
          image.replace(hostHeadshotBlob);
        } catch (e) {
          logToAuditTrail(agentName, "error", epUid, null,
            `${deckLabel} deck, slide ${slideNumber} (group): Could not insert host headshot: ${e.message}`);
        }
      }
    }

    else if (childType === SlidesApp.PageElementType.GROUP) {
      processGroup(child.asGroup(), slideNumber, placeholders, guestHeadshotBlob, hostHeadshotBlob, agentName, epUid, deckLabel);
    }
  });
}


// =============================================================================
// TEXT PLACEHOLDER REPLACEMENT
// Operates on a TextRange object (from shape.getText()).
// Replaces all occurrences of each token across the entire text range.
// =============================================================================

/**
 * Replaces all placeholder tokens in a TextRange.
 * Uses replaceAllText() which handles all runs within the shape atomically.
 * matchCase: false — tokens are always uppercase, this is a safety measure.
 */
function replaceTextPlaceholders(textRange, placeholders) {
  Object.keys(placeholders).forEach(token => {
    const value = placeholders[token];
    try {
      // replaceAllText handles multi-run text and preserves formatting of the
      // first character in the replaced range. This is the correct GAS pattern
      // for placeholder replacement in Slides.
      textRange.replaceAllText(token, value, false);
    } catch (e) {
      // replaceAllText throws if the token is not found — this is expected
      // for most shapes. Swallow silently; only log unexpected errors.
      if (!e.message.includes("not found") && !e.message.includes("No match")) {
        console.warn(`replaceAllText failed for token "${token}": ${e.message}`);
      }
    }
  });
}

function testArtistFairy() {
  runArtistFairy("EP-260326-0107");
}