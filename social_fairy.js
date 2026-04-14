
// /**
//  * DWYP Social Fairy - The Workshop Engine
//  * Curates existing assets and drafts copy based on the Social Media Index.
//  */
// function runSocialWorkshop(payload) {
//   const ss = SpreadsheetApp.getActiveSpreadsheet();
//   const sheet = ss.getSheetByName("Social_Posts");
 
//   // FIXED: Instead of e.range.getRow(), we use the ID passed from AppSheet
//   // We subtract 0 or use the raw index depending on how AppSheet sends the row number
//   const activeRow = payload.ID;
 
//   const data = sheet.getRange(activeRow, 1, 1, sheet.getLastColumn()).getValues()[0];

//   // Mapping based on your Master Sheet headers
//   const row = {
//     platform: data[2],      // Column C: PLATFORM
//     purpose: data[3],       // Column D: PURPOSE
//     guest: data[4],         // Column E: GUEST_SOURCE
//     sample: data[5],        // Column F: SAMPLE_CAPTION
//     prompt: data[6],        // Column G: WORKSHOP_PROMPT
//   };

//   // 1. Load the "Brain" (The Social Media Index Doc)
//   const indexDoc = DocumentApp.openByUrl("https://docs.google.com/document/d/1yiQNOy2lN2pK1aI20zIKAY3ooO37qv7f5ncU6k39Vcs/edit?tab=t.0");
//   const indexText = indexDoc.getBody().getText();

//   // 2. Load the "Map" (Episode Card & Transcriptions)
//   // Logic to extract specific URL for the Guest from the Index text
//   const episodeCardUrl = extractUrlForGuest(indexText, row.guest);
//   const transcriptionUrl = "https://docs.google.com/document/d/1w7c9n8ufcahDot2wEBIqGOzMplyWZhH8Nyo2uR_uoUQ/edit";
 
//   const episodeCardContent = DocumentApp.openByUrl(episodeCardUrl).getBody().getText();
//   const transcriptionContent = DocumentApp.openByUrl(transcriptionUrl).getBody().getText();

//   // 3. Construct the Workshop Brainstorm
//   const systemInstructions = `
//     ${indexText}
   
//     Current Task Context:
//     - Platform: ${row.platform}
//     - Strategic Purpose: ${row.purpose}
//     - Inspiration: ${row.sample}
//     - Guest Data: ${episodeCardContent}
//     - Available Reels: ${transcriptionContent}
   
//     User Pivot/Prompt: ${row.prompt}
   
//     CRITICAL:
//     1. ASSET MATCHING: Scan the "Available Reels" list. Find the filename (e.g., "35. Star Wars Funeral") that best matches the User Prompt or Guest Data.
//     2. NO JUSTIFICATION: Default to copywriting only. Do not explain why you chose a clip.
//     3. LONG FORM POSTS: If asked for an article, newsletter, email, or script for the user to record, provide it. Otherwise, curate only.
//     4. PLATFORM ADAPTATION: You are writing for: ${row.platform}. If multiple platforms are listed, ensure the caption style works for all (e.g., short, punchy, and hook-driven for Reels/TikTok).
//     5. FORMAT: Return a JSON object with two keys: "caption" (the text) and "assetUrl" (the exact filename from the transcription list).
// `; //

// // 4. Call your AI Engine via fairy_circle
//   const aiResponse = callGemini(systemInstructions, "json");
 
//   // 5. Parse and Write back inside the same block
//   try {
//     const cleanJson = JSON.parse(aiResponse.replace(/```json|```/g, ""));
   
//     // Column H: FINAL_CAPTION, Column I: ASSET_LINK
//     sheet.getRange(activeRow, 8).setValue(cleanJson.caption);
//     sheet.getRange(activeRow, 9).setValue(cleanJson.assetUrl);
   
//     // Update status to show JT the Fairy has finished
//     sheet.getRange(activeRow, 10).setValue("In Workshop");

//   } catch (e) {
//     console.error("Fairy Error parsing JSON: " + e);
//     // Safety: Put the raw text in the caption so JT doesn't lose the draft
//     sheet.getRange(activeRow, 8).setValue("The Fairy had a formatting issue. Raw Response: " + aiResponse);
//   }
// }

// /** * Helper to find the specific Doc link for a guest within your Index Doc
//  */
// function extractUrlForGuest(text, guestName) {
//   const lines = text.split('\n');
//   for (let line of lines) {
//     if (line.includes(guestName) && line.includes('http')) {
//       const urlMatch = line.match(/https?:\/\/[^\s]+/);
//       return urlMatch ? urlMatch[0] : null;
//     }
//   }
//   return null;
// }


