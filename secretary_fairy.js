// =============================================================================
// SECRETARY — Calendar Intake + Identity Resolution
// Fairy job: Detect interview events, resolve guest identity, create episode
//            records, create Raw + Staging folders, write initial manifest,
//            and hand off to Herald.
// Concierge logic is internal to this file — not a separate fairy.
//
// Triggers:
//   Time-based  → checkCalendarForInterviews() every N hours
//   Form submit → processFormSubmission(e) on Google Form submission
//
// Manual:  Run checkCalendarForInterviews() from Apps Script menu
//
// Calls:   runHerald() and runHeraldBio() in herald_fairy
// Schema:  DWYP_Platform_Schema_v1_5 (Handoff v33)
//
// FIX LOG (applied this session):
//   #1 — Deleted local generateEpisodeUid() override. fairy_circle.gs is sole authority.
//   #4 — Fixed all logToAuditTrail() eventCategory values to valid enum:
//          error | state_change | human_action
//   #5 — Fixed all spawnTask() keys to camelCase. Removed Source from all calls.
//   #6 — Added createEpisodeFolder() helper and folder creation block in
//          runSecretaryForNewEvent(). Raw + Staging folders now created at
//          scheduling time. Folder IDs passed into upsertEpisodes(). Initial
//          manifest written to Staging folder via writeManifest().
//
// PATCH LOG (form handler session):
//   #7  — Added processFormSubmission(e) — form submit entry point.
//   #8  — Added buildFormContextFile() — writes verbatim Q&A to Contact Library.
//   #9  — runSecretaryForNewEvent() patched — checks manifest for
//           herald_form_data: true before Herald handoff; skips if present.
//   #10 — fairyNudge → executiveSummary key rename at all spawnTask() call sites.
//           Content unchanged.
//   #11 — createContactStub() rewritten to header-driven write. Guest tab retired.
//   #12 — FormContext folder lookup retargeted from Guest → Contacts tab.
//
// PATCH LOG (Missing Tasks Part 2):
//   #20 — runSecretaryForNewEvent(): Recording_Reminder spawn removed.
//           Moved to dailyPulse() Loop 1 — fires D-1 and day-of only,
//           matching Release_Reminder pattern. Secretary no longer spawns
//           reminder tasks at episode creation regardless of recording proximity.
//   #21 — checkCalendarForInterviews(): switched from CalendarApp.getCalendarById()
//           to Calendar.Events.list() (Advanced Service) so all DWYP calendar
//           events are captured regardless of who created them. Added
//           Utilities.sleep(3000) between events to avoid Drive API rate limits
//           when multiple recordings exist. wrapCalendarApiEvent() adapter added
//           so processInterviewEvent and downstream functions are unchanged.
//
// PATCH LOG (v1.5 schema sweep — Handoff v33):
//   #13 — createContactStub(): removed stale v1.4 fields (Workstream,
//           Cultural_Identity, Geography, Social_Handle, Is_Guest, Is_Sponsor,
//           Is_Donor, Relationship_Status, Episode_Count, NotebookLM_Link,
//           Last_Modified). Added v1.5 fields (Social_Instagram, Social_YouTube,
//           Social_Podcast, Social_LinkedIn, Social_X, Social_Other,
//           Influence_Tier).
//   #14 — createEpisodeRecord(): removed stale fields (Internal_Deadline,
//           Pipeline_Status, Video_File_ID, Email_Draft_Status, Janitor_Handoff,
//           Production_Status, Release_Reminder_Sent, Workstream). Renamed
//           Staging_Folder_ID → Production_Folder_ID.
//   #15 — All spawnTask() calls: removed workstream: key; normalized
//           assignedBy: to "The Fairy Team" at all call sites.
//   #16 — runSecretaryForNewEvent(): added Episode, Reels/Approved, Reels/DNU
//           subfolder creation.
//   #17 — findContactBySocialHandle() retired — no intake path provides a social
//           handle signal. resolveIdentity() Priority 2 block removed.
//           Post-run patch queue: restore when intake path exists.
//   #18 — updateLastActivity(): removed Last_Modified write (field retired in v1.5).
//   #19 — processFormSubmission(): renamed Staging_Folder_ID → Production_Folder_ID
//           in episode lookup block.
// =============================================================================




// =============================================================================
// ENTRY POINT — FORM SUBMISSION
// Trigger: Install as onFormSubmit trigger in Apps Script.
//
// Setup steps (manual — one time):
//   1. Open Apps Script project.
//   2. Left sidebar → Triggers (clock icon).
//   3. Click "+ Add Trigger" (bottom right).
//   4. Choose function: processFormSubmission
//   5. Event source: From spreadsheet  (if form is linked to Master Sheet)
//      OR From form (if triggering directly from the Form).
//      Recommendation: From form → On form submit. More reliable than sheet trigger.
//   6. Select your form from the dropdown.
//   7. Event type: On form submit.
//   8. Save. Authorize when prompted.
// =============================================================================


function processFormSubmission(e) {
  const agentName = "Secretary";
  const namedValues = e.namedValues || {};


  // --- Step 1: Pull identity fields via governance keys ---
  // Only these three fields require governance keys. Everything else is
  // written verbatim from namedValues — form question changes require no
  // code updates, only governance key updates for these three.
  const get = key => {
    const val = namedValues[key];
    return (val && val[0]) ? val[0].trim() : "";
  };


  const nameKey     = getGovernance("INTAKE_NAME_KEY");
  const emailKey    = getGovernance("INTAKE_EMAIL_KEY");
  const referralKey = getGovernance("INTAKE_REFERRAL_KEY");


  const guestName = get(nameKey)     || "Unknown Guest";
  const email     = get(emailKey)    || "";
  const referral  = get(referralKey) || "";


  logToAuditTrail(agentName, "human_action", "", "",
    `[INFO] Form submission received for: ${guestName} (${email || "no email"}).`, "INFO");


  // --- Step 2: Resolve identity ---
  const signals = {
    name:         guestName,
    email:        email     || null,
    organization: null,
    referral:     referral  || null,
    website:      null,
    source:       "form"
  };


  let contactId, isNew;
  try {
    const resolution = resolveIdentity(signals);
    contactId = resolution.contactId;
    isNew     = resolution.isNew;
    const confidence = resolution.confidence;


    logToAuditTrail(agentName, "state_change", "", contactId,
      `[INFO] Identity resolved for "${guestName}". Confidence: ${confidence}. New record: ${isNew}.`, "INFO");


    if (confidence === "low") {
      spawnTask({
        actionTitle:      `Possible duplicate contact — verify: ${guestName}`,
        assignee:         getGovernance("ASSIGNEE_PRODUCER"),
        assignedBy:       "The Fairy Team",
        status:           "open",
        priority:         "urgent",
        contactId:        contactId,
        workflowStep:     "Intake",
        executiveSummary: `Secretary matched "${guestName}" to an existing contact by name only (low confidence) via form submission. Please verify this is the correct person and merge or correct if needed.`
      });
    }
  } catch (err) {
    logToAuditTrail(agentName, "error", "", "",
      `[ERROR] Identity resolution failed for form submission "${guestName}": ${err.message}`, "ERROR");
    spawnTask({
      actionTitle:      `Form submission identity resolution failed — ${guestName}`,
      assignee:         getGovernance("ASSIGNEE_PRODUCER"),
      assignedBy:       "The Fairy Team",
      status:           "open",
      priority:         "urgent",
      workflowStep:     "Intake",
      executiveSummary: `Secretary could not resolve identity for form submission from "${guestName}" (${email}): ${err.message}. Review the form response manually.`
    });
    return;
  }


  // --- Step 3: Fire Herald Bio ---
  // Runs immediately on form submission — creates Contact Library folder
  // and updates Bio_Summary. Brief is skipped here; it requires an episode.
  // contactFolderId is read back from Contacts tab after Bio runs so
  // buildFormContextFile() knows where to write.
  try {
    runHeraldBio(contactId);
  } catch (err) {
    logToAuditTrail(agentName, "error", "", contactId,
      `[ERROR] Herald Bio failed on form path for "${guestName}": ${err.message}`, "ERROR");
    spawnTask({
      actionTitle:      `Herald Bio failed on form submission — ${guestName}`,
      assignee:         getGovernance("ASSIGNEE_PRODUCER"),
      assignedBy:       "The Fairy Team",
      status:           "open",
      priority:         "urgent",
      contactId:        contactId,
      workflowStep:     "Intake",
      executiveSummary: `Herald Bio threw an error during form submission processing for "${guestName}". Contact Library folder may not have been created. Re-run Herald Bio manually once resolved.`
    });
    // Non-fatal — continue. FormContext write will fail gracefully if folder missing.
  }


  // --- Step 4: Write FormContext file to Contact Library ---
  // Read Contact Library folder ID from Contacts tab — Herald Bio should have
  // just written it. If missing, log and spawn task but continue.
  try {
    const ss            = SpreadsheetApp.openById(getMasterSheetId());
    const contactSheet  = ss.getSheetByName("Contacts");
    const contactData   = contactSheet.getDataRange().getValues();
    const cHeaders      = contactData[0];
    const cIdCol        = cHeaders.indexOf("Contact_ID");
    const cFolCol       = cHeaders.indexOf("Contact_Library_Folder_ID");
    let contactFolderId = "";


    for (let i = 1; i < contactData.length; i++) {
      if (String(contactData[i][cIdCol]).trim() === String(contactId).trim()) {
        contactFolderId = contactData[i][cFolCol] || "";
        break;
      }
    }


    if (contactFolderId) {
      buildFormContextFile(contactId, contactFolderId, namedValues, guestName, email, referral);
    } else {
      logToAuditTrail(agentName, "error", "", contactId,
        `[WARNING] Contact Library folder ID not found for ${guestName} — FormContext file not written.`, "WARNING");
      spawnTask({
        actionTitle:      `FormContext file not written — Contact Library folder missing: ${guestName}`,
        assignee:         getGovernance("ASSIGNEE_PRODUCER"),
        assignedBy:       "The Fairy Team",
        status:           "open",
        priority:         "urgent",
        contactId:        contactId,
        workflowStep:     "Intake",
        executiveSummary: `The FormContext file could not be written for "${guestName}" because the Contact Library folder ID was not found on the Contacts tab. Re-run Herald Bio, then re-run processFormSubmission or write the file manually.`
      });
    }
  } catch (err) {
    logToAuditTrail(agentName, "error", "", contactId,
      `[ERROR] FormContext file write failed for "${guestName}": ${err.message}`, "ERROR");
  }


  // --- Step 5: Check for existing episode record ---
  // If an episode already exists for this contact (e.g. calendar fired first,
  // or returning guest), fire full Herald so the brief is generated with form context.
  // Patch manifest with herald_form_data: true so calendar path skips Herald.
  try {
    const ss              = SpreadsheetApp.openById(getMasterSheetId());
    const epSheet         = ss.getSheetByName("Episodes");
    const epData          = epSheet.getDataRange().getValues();
    const epHeaders       = epData[0];
    const epContactCol    = epHeaders.indexOf("Contact_ID");
    const epUidCol        = epHeaders.indexOf("Episode_UID");
    const epStatusCol     = epHeaders.indexOf("Status");
    const epProdFolCol    = epHeaders.indexOf("Production_Folder_ID");   // #19 — renamed from Staging_Folder_ID


    // Find the most recent non-complete episode for this contact
    let matchedEpisodeUid    = null;
    let matchedProdFolderId  = null;


    for (let i = 1; i < epData.length; i++) {
      if (String(epData[i][epContactCol]).trim() === String(contactId).trim()) {
        const status = epData[i][epStatusCol] || "";
        if (status !== "archived") {
          matchedEpisodeUid   = epData[i][epUidCol]    || null;
          matchedProdFolderId = epData[i][epProdFolCol] || null;
          break;
        }
      }
    }


    if (matchedEpisodeUid && matchedProdFolderId) {
      logToAuditTrail(agentName, "state_change", matchedEpisodeUid, contactId,
        `[INFO] Existing episode found for "${guestName}" (${matchedEpisodeUid}). Firing full Herald and patching manifest.`, "INFO");


      // Patch manifest — signals calendar path to skip Herald
      try {
        const manifest = getManifest(matchedProdFolderId) || {};
        manifest.herald_form_data = true;
        writeManifest(matchedProdFolderId, manifest);
      } catch (err) {
        logToAuditTrail(agentName, "error", matchedEpisodeUid, contactId,
          `[WARNING] Could not patch herald_form_data into manifest: ${err.message}`, "WARNING");
        if (err.isManifestCorrupt) {
          spawnTask({
            episodeUid:       matchedEpisodeUid,
            contactId:        contactId,
            actionTitle:      "BLOCKED: Episode manifest corrupt — manual recovery required",
            assignee:         getGovernance("ASSIGNEE_PRODUCER"),
            assignedBy:       "The Fairy Team",
            status:           "open",
            priority:         "urgent",
            executiveSummary: `episode_manifest.json in folder ${err.folderId || matchedProdFolderId} failed JSON.parse. The herald_form_data write was blocked to prevent data loss. Manually inspect and repair the manifest file for ${matchedEpisodeUid}.`
          });
        }
        // Non-fatal — Herald may run twice if manifest patch fails. Acceptable.
      }


      // Fire full Herald — Bio already ran in Step 3, but runHerald() calls
      // Bio again safely (it is idempotent). Brief now has form context available.
      try {
        runHerald(contactId, matchedEpisodeUid);
      } catch (err) {
        logToAuditTrail(agentName, "error", matchedEpisodeUid, contactId,
          `[ERROR] Full Herald failed on form path for "${guestName}": ${err.message}`, "ERROR");
        spawnTask({
          actionTitle:      `Herald failed on form submission (episode exists) — ${guestName}`,
          assignee:         getGovernance("ASSIGNEE_PRODUCER"),
          assignedBy:       "The Fairy Team",
          status:           "open",
          priority:         "urgent",
          contactId:        contactId,
          episodeUid:       matchedEpisodeUid,
          workflowStep:     "Intake",
          executiveSummary: `Herald threw an error during form submission processing for "${guestName}" / ${matchedEpisodeUid}. Brief may be incomplete. Re-run Herald manually once the issue is resolved.`
        });
      }
    } else {
      logToAuditTrail(agentName, "state_change", "", contactId,
        `[INFO] No active episode found for "${guestName}". Herald Brief will fire when calendar event is detected.`, "INFO");
    }
  } catch (err) {
    logToAuditTrail(agentName, "error", "", contactId,
      `[ERROR] Episode lookup failed on form path for "${guestName}": ${err.message}`, "ERROR");
  }
}




// =============================================================================
// FORM CONTEXT FILE BUILDER
// Writes a clean, verbatim Q&A file to the Contact Library folder.
// Herald reads this file as Priority 1 context when generating the brief.
//
// Structure:
//   Header block — name, email, referral, submission timestamp
//   Q&A block   — every namedValues entry except name, email, referral,
//                 written verbatim: question text followed by answer.
//
// File named: FormContext_[contactId].txt
// Overwrites any existing file with the same name.
//
// @param {string} contactId       - Contact_ID (used in filename)
// @param {string} contactFolderId - Drive ID of Contact Library subfolder
// @param {Object} namedValues     - e.namedValues from form submit trigger
// @param {string} name            - Resolved guest name (from INTAKE_NAME_KEY)
// @param {string} email           - Resolved email (from INTAKE_EMAIL_KEY)
// @param {string} referral        - Resolved referral (from INTAKE_REFERRAL_KEY)
// =============================================================================


function buildFormContextFile(contactId, contactFolderId, namedValues, name, email, referral) {
  const agentName  = "Secretary";
  const fileName   = `FormContext_${contactId}.txt`;
  const folder     = DriveApp.getFolderById(contactFolderId);
  const nameKey    = getGovernance("INTAKE_NAME_KEY")     || "";
  const emailKey   = getGovernance("INTAKE_EMAIL_KEY")    || "";
  const refKey     = getGovernance("INTAKE_REFERRAL_KEY") || "";
  const skipKeys   = new Set([nameKey, emailKey, refKey, "Timestamp"]);


  // Build header block
  const lines = [
    `FORM CONTEXT — ${name}`,
    `Contact ID: ${contactId}`,
    `Email: ${email || "(not provided)"}`,
    `Referred by: ${referral || "(not provided)"}`,
    `Submitted: ${new Date().toDateString()}`,
    ``,
    `---`,
    ``
  ];


  // Write every remaining field verbatim — question text then answer
  // Skips identity fields already captured in header, and Timestamp
  Object.keys(namedValues).forEach(question => {
    if (skipKeys.has(question)) return;
    const answer = (namedValues[question] && namedValues[question][0])
      ? namedValues[question][0].trim()
      : "(no answer provided)";
    lines.push(question);
    lines.push(answer);
    lines.push("");
  });


  const content = lines.join("\n");


  // Trash any existing FormContext file for this contact
  const existing = folder.getFilesByName(fileName);
  while (existing.hasNext()) {
    existing.next().setTrashed(true);
  }


  // Write new file
  folder.createFile(fileName, content, MimeType.PLAIN_TEXT);


  logToAuditTrail(agentName, "state_change", "", contactId,
    `[INFO] FormContext file written to Contact Library for contact ${contactId}.`, "INFO");
}




// =============================================================================
// ENTRY POINT — CALENDAR SCAN
// =============================================================================


function checkCalendarForInterviews() {
  const agentName = "Secretary";

  logToAuditTrail(agentName, "human_action", "", "",
    "[INFO] Secretary scanning DWYP calendar for interview events.", "INFO");

  try {
    const calendarId = getGovernance("DWYP_CALENDAR_ID");
    const prefix     = getGovernance("CALENDAR_TRIGGER_PREFIX");
    const now        = new Date();
    const scanEnd    = new Date();
    scanEnd.setDate(now.getDate() + 60);

    // Use Calendar Advanced Service so all events on the DWYP calendar are
    // returned regardless of who created them — not just events where the
    // script account is the organizer.
    const matchingEvents = [];
    let pageToken;
    do {
      const response = Calendar.Events.list(calendarId, {
        timeMin:      now.toISOString(),
        timeMax:      scanEnd.toISOString(),
        singleEvents: true,
        orderBy:      "startTime",
        maxResults:   250,
        pageToken:    pageToken || undefined
      });
      for (const apiEvent of (response.items || [])) {
        if ((apiEvent.summary || "").startsWith(prefix)) {
          matchingEvents.push(apiEvent);
        }
      }
      pageToken = response.nextPageToken;
    } while (pageToken);

    let processed = 0;

    for (let i = 0; i < matchingEvents.length; i++) {
      if (i > 0) Utilities.sleep(3000);  // rate-limit Drive API between episodes
      processInterviewEvent(wrapCalendarApiEvent(matchingEvents[i]), agentName, prefix);
      processed++;
    }

    logToAuditTrail(agentName, "state_change", "", "",
      `[INFO] Scan complete. ${processed} DWYP interview event(s) processed.`, "INFO");

  } catch (err) {
    logToAuditTrail(agentName, "error", "", "",
      `[ERROR] Calendar scan threw an error: ${err.message}`, "ERROR");
  }
}


// Wraps a Calendar API v3 event object (from Calendar.Events.list) into the
// CalendarApp-style interface expected by processInterviewEvent and downstream
// functions. Keeps the rest of the code unchanged.
function wrapCalendarApiEvent(apiEvent) {
  return {
    getId:        ()  => apiEvent.id,
    getTitle:     ()  => apiEvent.summary || "",
    getStartTime: ()  => new Date(apiEvent.start.dateTime || apiEvent.start.date),
    getGuestList: ()  => (apiEvent.attendees || []).map(a => ({ getEmail: () => a.email || "" }))
  };
}




// =============================================================================
// EVENT ROUTING
// =============================================================================


function processInterviewEvent(event, agentName, prefix) {
  const eventId = event.getId();
  const title = event.getTitle();
  const recordingDate = event.getStartTime();
  const guestName = extractGuestNameFromTitle(title, prefix);


  if (!guestName) {
    logToAuditTrail(agentName, "error", "", "",
      `[ERROR] Could not extract guest name from event title: "${title}". Expected format: "${prefix} [Guest Name]"`, "ERROR");
    spawnTask({
      actionTitle:      `Calendar event title could not be parsed: "${title}"`,
      assignee:         getGovernance("ASSIGNEE_PRODUCER"),
      assignedBy:       "The Fairy Team",
      status:           "open",
      priority:         "urgent",
      workflowStep:     "Intake",
      executiveSummary: `A calendar event was detected with the DWYP trigger prefix but the guest name could not be parsed. Please rename the event to the format: "${prefix} [Guest Name]" and Secretary will pick it up on the next scan.`
    });
    return;
  }


  // Check whether this event already has an episode record
  const existingEpisode = lookupEpisodeByEventId(eventId);


  if (existingEpisode) {
    handlePotentialReschedule(existingEpisode, event, guestName, agentName);
  } else {
    runSecretaryForNewEvent(event, guestName, recordingDate, agentName, prefix);
  }
}




// =============================================================================
// GUEST NAME EXTRACTION
// =============================================================================


function extractGuestNameFromTitle(title, prefix) {
  // Strip the trigger prefix and any leading punctuation or whitespace
  const raw = title.replace(new RegExp("^" + prefix + "[:\\-–]?\\s*", "i"), "").trim();
  if (!raw) return null;


  // Strip co-host suffix e.g. "Guest Name and Jennifer Trepanier"
  const clean = raw.replace(/\s+and\s+.+$/i, "").trim();
  return clean || null;
}




// =============================================================================
// EPISODE LOOKUP BY CALENDAR EVENT ID
// =============================================================================


function lookupEpisodeByEventId(eventId) {
  const ss = SpreadsheetApp.openById(
    getMasterSheetId()
  );
  const sheet = ss.getSheetByName("Episodes");
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const eventIdCol = headers.indexOf("Calendar_Event_ID");


  for (let i = 1; i < data.length; i++) {
    if (data[i][eventIdCol] === eventId) {
      const row = {};
      headers.forEach((h, j) => row[h] = data[i][j]);
      return row;
    }
  }
  return null;
}




// =============================================================================
// IDENTITY RESOLUTION (Concierge logic — internal to Secretary)
// =============================================================================


function resolveIdentity(signals) {
  // signals: { name, email, organization, referral, website, source }
  // Returns: { contactId, confidence, isNew }
  //
  // Priority 2 (social handle) retired in patch #17 — no intake path currently
  // provides a social handle signal. Restore when one exists.


  // Priority 1: Email — most reliable
  if (signals.email) {
    const match = findContactByEmail(signals.email);
    if (match) {
      updateLastActivity(match.Contact_ID);
      return { contactId: match.Contact_ID, confidence: "high", isNew: false };
    }
  }


  // Priority 2: Name + organization — moderate confidence
  if (signals.name && signals.organization) {
    const match = findContactByNameAndOrg(signals.name, signals.organization);
    if (match) {
      updateLastActivity(match.Contact_ID);
      return { contactId: match.Contact_ID, confidence: "medium", isNew: false };
    }
  }


  // Priority 3: Name alone — weak signal
  if (signals.name) {
    const match = findContactByName(signals.name);
    if (match) {
      // Low confidence — flag for review
      return { contactId: match.Contact_ID, confidence: "low", isNew: false };
    }
  }


  // No match — create new contact stub
  const newContactId = createContactStub(signals);
  return { contactId: newContactId, confidence: "none", isNew: true };
}




// =============================================================================
// CONTACT LOOKUP HELPERS
// =============================================================================


function getContactsData() {
  const ss = SpreadsheetApp.openById(
    getMasterSheetId()
  );
  const sheet = ss.getSheetByName("Contacts");
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  return data.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => obj[h] = row[i]);
    return obj;
  });
}


function findContactByEmail(email) {
  const contacts = getContactsData();
  return contacts.find(c =>
    c.Email && c.Email.toString().toLowerCase().trim() === email.toLowerCase().trim()
  ) || null;
}


function findContactByNameAndOrg(name, org) {
  const contacts = getContactsData();
  return contacts.find(c =>
    c.Display_Name && c.Display_Name.toString().toLowerCase().trim() === name.toLowerCase().trim() &&
    c.Organization && c.Organization.toString().toLowerCase().trim() === org.toLowerCase().trim()
  ) || null;
}


function findContactByName(name) {
  const contacts = getContactsData();
  return contacts.find(c =>
    c.Display_Name && c.Display_Name.toString().toLowerCase().trim() === name.toLowerCase().trim()
  ) || null;
}


function updateLastActivity(contactId) {
  // #18 — Last_Modified removed from v1.5 schema. Writing Last_Activity only.
  const ss = SpreadsheetApp.openById(
    getMasterSheetId()
  );
  const sheet = ss.getSheetByName("Contacts");
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const contactIdCol    = headers.indexOf("Contact_ID");
  const lastActivityCol = headers.indexOf("Last_Activity");


  for (let i = 1; i < data.length; i++) {
    if (data[i][contactIdCol] === contactId) {
      sheet.getRange(i + 1, lastActivityCol + 1).setValue(new Date());
      bumpVersion("contacts", "updateLastActivity");
      return;
    }
  }
}




// =============================================================================
// CONTACT STUB CREATION
// Header-driven write against v1.5 Contacts schema.
// Herald writes Bio_Summary, Contact_Library_Folder_ID, and all social fields
// after research runs. Personal_Note and Influence_Tier are JT-only — never
// written by system.
// =============================================================================


function createContactStub(signals) {
  const ss = SpreadsheetApp.openById(
    getMasterSheetId()
  );
  const contactSheet = ss.getSheetByName("Contacts");
  const headerRow = contactSheet.getRange(1, 1, 1, contactSheet.getLastColumn()).getValues()[0];


  const contactId = generateContactId();
  const now = new Date();


  // v1.5 Contacts schema — 23 columns.
  // Fields omitted here are written by Herald (social fields, Bio_Summary,
  // Contact_Library_Folder_ID, Organization) or are JT-managed
  // (Personal_Note, Tags, Influence_Tier, Relationship_Type).
  const fields = {
    Contact_ID:                contactId,
    Display_Name:              signals.name     || "",
    Influence_Tier:            "",
    Email:                     signals.email    || "",
    Phone:                     "",
    Website:                   signals.website  || "",
    Social_Instagram:          "",
    Social_YouTube:            "",
    Social_Podcast:            "",
    Social_LinkedIn:           "",
    Social_X:                  "",
    Social_Other:              "",
    Organization:              "",
    Referred_By:               signals.referral || "",
    Personal_Note:             "",
    Bio_Summary:               "",
    Tags:                      "",
    Source:                    signals.source   || "system",
    Created_At:                now,
    Last_Activity:             now,
    Headshot_URL:              "",
    Contact_Library_Folder_ID: "",
    Relationship_Type:         ""
  };


  // Map keyed object to row array using live header order.
  // Any field in the sheet not present in fields{} writes as empty string.
  // Any field in fields{} not present in the sheet is silently ignored.
  const row = headerRow.map(header => {
    const val = fields[header];
    return (val !== undefined && val !== null) ? val : "";
  });


  contactSheet.appendRow(row);
  bumpVersion("contacts", "createContactStub");

  return contactId;
}


// =============================================================================
// FOLDER CREATION HELPER
// Private to Secretary — episode folder creation is Secretary's sole responsibility.
// Nothing else in the system creates episode folders.
//
// @param {string} parentFolderId - Drive ID of the parent folder (from Governance_Config
//                                  or a previously created folder ID)
// @param {string} folderName     - Name for the new subfolder
// @returns {string}              - Drive ID of the newly created folder
// =============================================================================


function createEpisodeFolder(parentFolderId, folderName) {
  const parentFolder = DriveApp.getFolderById(parentFolderId);
  const newFolder = parentFolder.createFolder(folderName);
  return newFolder.getId();
}

// =============================================================================
// NEW EVENT ORCHESTRATOR
// =============================================================================


function runSecretaryForNewEvent(event, guestName, recordingDate, agentName, prefix) {
  const eventId = event.getId();


  // Pull identity signals from calendar event
  const attendees = event.getGuestList();
  const guestEmail = attendees.length > 0 ? attendees[0].getEmail() : null;


  const signals = {
    name:         guestName,
    email:        guestEmail  || null,
    organization: null,         // Not available from calendar
    referral:     null,
    website:      null,
    source:       "system"
  };


  // Resolve identity
  const resolution = resolveIdentity(signals);
  const { contactId, confidence, isNew } = resolution;


  logToAuditTrail(agentName, "state_change", "", contactId,
    `[INFO] Identity resolution complete for "${guestName}". Confidence: ${confidence}. New record: ${isNew}.`, "INFO");


  // Spawn duplicate flag if low confidence match
  if (confidence === "low") {
    spawnTask({
      actionTitle:      `Possible duplicate contact — verify: ${guestName}`,
      assignee:         getGovernance("ASSIGNEE_PRODUCER"),
      assignedBy:       "The Fairy Team",
      status:           "open",
      priority:         "urgent",
      contactId:        contactId,
      workflowStep:     "Intake",
      executiveSummary: `Secretary matched "${guestName}" to an existing contact by name only (low confidence). Please verify this is the correct person and merge or correct if needed.`
    });
  }


  // Thin new stub (no email): no eager task. Herald's identity check (Fix 20,
  // herald_fairy.js) is the sole gate — it spawns Verify_Guest_Identity only
  // when it cannot confirm identity with enough confidence to write the brief.
  // Handoff failure is covered by the "Herald failed to run" recovery task below.
  if (isNew && !guestEmail) {
    logToAuditTrail(agentName, "state_change", "", contactId,
      `[INFO] New stub contact for "${guestName}" with no email. Deferring identity verification to Herald.`, "INFO");
  }


  // Generate episode UID — fairy_circle.gs is the sole authority
  const episodeUid = generateEpisodeUid();


  // Build folder name — consistent format used for both Raw and Staging
  const folderName = `${episodeUid}_${guestName}`;


  // Create Raw Production folder
  const rawFolderId = createEpisodeFolder(
    getGovernance("RAW_PRODUCTION"),
    folderName
  );


  logToAuditTrail(agentName, "state_change", episodeUid, contactId,
    `[INFO] Raw Production folder created: ${rawFolderId}`, "INFO");


  // Create Staging folder (Production_Folder_ID at episode creation;
  // Filing Fairy overwrites with Finished folder ID at archive)
  const stagingFolderId = createEpisodeFolder(
    getGovernance("STAGING_DRAFTS"),
    folderName
  );


  logToAuditTrail(agentName, "state_change", episodeUid, contactId,
    `[INFO] Staging folder created: ${stagingFolderId}`, "INFO");


  // #16 — Create asset subfolders inside Staging.
  // Episode: finished video lands here (Audra uploads).
  // Images: Artist Fairy populates (replaces Host_Graphics + Guest_Graphics).
  // Thumbnails: Artist Fairy populates.
  // Reels/Approved, Reels/Save, Reels/Delete: Audra sorts clips; Filing packages from Approved.
  const episodeFolderId    = createEpisodeFolder(stagingFolderId, "Episode");
  const reelsFolderId      = createEpisodeFolder(stagingFolderId, "Reels");
  const imagesFolderId     = createEpisodeFolder(stagingFolderId, "Images");
  createEpisodeFolder(imagesFolderId,  "Approved");
  createEpisodeFolder(imagesFolderId,  "Save");
  createEpisodeFolder(imagesFolderId,  "Delete");
  createEpisodeFolder(stagingFolderId, "Thumbnails");
  createEpisodeFolder(reelsFolderId,   "Approved");
  createEpisodeFolder(reelsFolderId,   "Save");
  createEpisodeFolder(reelsFolderId,   "Delete");


  logToAuditTrail(agentName, "state_change", episodeUid, contactId,
    `[INFO] Asset subfolders created in Staging: Episode, Images/Approved, Images/Save, Images/Delete, Thumbnails, Reels/Approved, Reels/Save, Reels/Delete.`, "INFO");


  // Write initial manifest to Staging folder
  writeManifest(stagingFolderId, {
    episode_uid:           episodeUid,
    contact_id:            contactId,
    guest_name:            guestName,
    recording_date:        recordingDate.toISOString(),
    raw_folder_id:         rawFolderId,
    staging_folder_id:     stagingFolderId,
    status:                "active",
    phase:                 "1_Intake",
    created_at:            new Date().toISOString(),
    herald_form_data:      false,
    asset_ids:             {}
  });


  logToAuditTrail(agentName, "state_change", episodeUid, contactId,
    `[INFO] Initial manifest written to Staging folder.`, "INFO");

  // Create episode record — folder IDs now available
  createEpisodeRecord(contactId, guestName, eventId, recordingDate, episodeUid, rawFolderId, stagingFolderId);

  logToAuditTrail(agentName, "state_change", episodeUid, contactId,
    `[INFO] Episode record created for "${guestName}". Episode_UID: ${episodeUid}.`, "INFO");

  // New-interview notification (backlog #15, 2026-06-12). Audra attends
  // recordings - a completable task carries the date AND time. Workflow_Step
  // "Scheduling" is generic-completable on all surfaces; one spawn per
  // episode creation, so naturally idempotent. Non-fatal on failure.
  try {
    const recWhen = Utilities.formatDate(
      recordingDate, Session.getScriptTimeZone(), "EEEE, MMM d 'at' h:mm a");
    spawnTask({
      actionTitle:      `New Interview Scheduled: ${guestName} - ${recWhen}`,
      assignee:         getGovernance("ASSIGNEE_PRODUCER"),
      assignedBy:       "The Fairy Team",
      status:           "open",
      priority:         "normal",
      dueDate:          recordingDate,
      contactId:        contactId,
      episodeUid:       episodeUid,
      workflowStep:     "Scheduling",
      executiveSummary: `Secretary picked up a new calendar event for "${guestName}" - recording ${recWhen}. Complete this once it's on your radar.`
    });
  } catch (err) {
    logToAuditTrail(agentName, "error", episodeUid, contactId,
      `[WARNING] New-interview notification task spawn failed: ${err.message}`, "WARNING");
  }

  // --- Herald handoff ---
  // Check manifest for herald_form_data: true before firing Herald.
  // If form was submitted before calendar event was detected, Herald Bio has
  // already run and FormContext file is in place. Skip Herald to avoid
  // redundant research and bio overwrite.
  let skipHerald = false;
  try {
    const manifest = getManifest(stagingFolderId) || {};
    if (manifest.herald_form_data === true) {
      skipHerald = true;
      logToAuditTrail(agentName, "state_change", episodeUid, contactId,
        `[INFO] herald_form_data: true found in manifest. Skipping Herald handoff — already ran on form path.`, "INFO");
    }
  } catch (err) {
    logToAuditTrail(agentName, "error", episodeUid, contactId,
      `[WARNING] Could not read manifest for Herald skip check: ${err.message}. Firing Herald as normal.`, "WARNING");
    if (err.isManifestCorrupt) {
      spawnTask({
        episodeUid:       episodeUid,
        contactId:        contactId,
        actionTitle:      "BLOCKED: Episode manifest corrupt — manual recovery required",
        assignee:         getGovernance("ASSIGNEE_PRODUCER"),
        assignedBy:       "The Fairy Team",
        status:           "open",
        priority:         "urgent",
        executiveSummary: `episode_manifest.json in folder ${err.folderId || stagingFolderId} failed JSON.parse during the Herald skip check. Herald will run as normal. Manually inspect and repair the manifest file for ${episodeUid}.`
      });
    }
  }


  if (!skipHerald) {
    try {
      runHerald(contactId, episodeUid);
    } catch (err) {
      logToAuditTrail(agentName, "error", episodeUid, contactId,
        `[ERROR] Secretary could not hand off to Herald: ${err.message}`, "ERROR");
      spawnTask({
        actionTitle:      `Herald failed to run for: ${guestName}`,
        assignee:         getGovernance("ASSIGNEE_PRODUCER"),
        assignedBy:       "The Fairy Team",
        status:           "open",
        priority:         "urgent",
        contactId:        contactId,
        episodeUid:       episodeUid,
        workflowStep:     "Intake",
        executiveSummary: `Secretary completed identity resolution and created the episode record for "${guestName}" but Herald threw an error on handoff. Check the Audit Trail and re-run Herald manually once the issue is resolved.`
      });
    }
  }
}




// =============================================================================
// EPISODE RECORD CREATION
// Accepts pre-generated episodeUid and folder IDs from runSecretaryForNewEvent().
// UID and folders are created upstream so they can be used in the manifest
// before the row is written.
//
// Production_Folder_ID holds the Staging folder ID at episode creation.
// Filing Fairy overwrites it with the Finished folder ID at archive.
// =============================================================================


function createEpisodeRecord(contactId, guestName, eventId, recordingDate, episodeUid, rawFolderId, stagingFolderId) {
  // v1.5 Episodes schema — 14 columns.
  // Episode_Sequence and Release_Date: manual, Audra-owned, never written by GAS.
  // Video_Status and Images_Status: web app–written, initialized to "pending".
  // Episode_URL: manual, Audra populates at release.
  // Episode_Type: defaults to "standard"; Secretary has no signal to override.

  upsertEpisodes({
    Episode_UID:          episodeUid,
    Contact_ID:           contactId,
    Guest_Name:           guestName,
    Status:               "upcoming",
    Raw_Folder_ID:        rawFolderId,
    Production_Folder_ID: stagingFolderId,
    Recording_Date:       recordingDate,
    Calendar_Event_ID:    eventId,
    Video_Status:         "pending",
    Images_Status:        "pending",
    Episode_URL:          "",
    Episode_Type:         "standard"
  });
}




// =============================================================================
// RESCHEDULE HANDLER
// =============================================================================


function handlePotentialReschedule(existingEpisode, event, guestName, agentName) {
  const episodeUid = existingEpisode.Episode_UID;
  const contactId  = existingEpisode.Contact_ID;
  const newDate    = event.getStartTime();
  const oldDate    = existingEpisode.Recording_Date;


  // No change — nothing to do
  if (oldDate && newDate && oldDate.toString() === newDate.toString()) return;


  logToAuditTrail(agentName, "state_change", episodeUid, contactId,
    `[INFO] Recording date changed for "${guestName}". Old: ${oldDate}. New: ${newDate}.`, "INFO");


  // Patch the episode record
  patchEpisodes(episodeUid, {
    Recording_Date: newDate
  });


  // Log to Episode_Log
  appendEpisodeLog({
    episodeUid:  episodeUid,
    author:      getGovernance("ASSIGNEE_PRODUCER"),
    entryType:   "system",
    assetType:   "general",
    body:        `Recording date updated by Secretary. Previous date: ${oldDate ? oldDate.toDateString() : "not set"}. New date: ${newDate.toDateString()}.`,
    visibleTo:   "both"
  });


  // Spawn notification tasks (date AND time - backlog #15, 2026-06-12).
  // Both users attend recordings: one task each (Audra decision 2026-06-12),
  // independently completable. Security filter scopes JT to her own row.
  const newWhen = Utilities.formatDate(
    newDate, Session.getScriptTimeZone(), "EEEE, MMM d 'at' h:mm a");
  [getGovernance("ASSIGNEE_HOST"), getGovernance("ASSIGNEE_PRODUCER")].forEach(function(who) {
    spawnTask({
      actionTitle:      `Recording date changed: ${guestName} - ${newWhen}`,
      assignee:         who,
      assignedBy:       "The Fairy Team",
      status:           "open",
      priority:         "urgent",
      dueDate:          newDate,
      contactId:        contactId,
      episodeUid:       episodeUid,
      workflowStep:     "Scheduling",
      executiveSummary: `The calendar event for "${guestName}" has been moved. Recording is now ${newWhen}. Please confirm all downstream deadlines are still accurate.`
    });
  });


  logToAuditTrail(agentName, "state_change", episodeUid, contactId,
    `[INFO] Reschedule handled for "${guestName}". Episode record and log updated.`, "INFO");
}