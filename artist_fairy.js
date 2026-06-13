// =============================================================================
// FILE: artist_fairy.gs
// runArtistFairy deleted — retired May 2026; Track C (materializeQuoteGraphicAssets) owns this work.
// Dead helpers removed (janitorial spoke, June 2026).
// Sole survivor: exportSlidesToPng — called from Track C / pulse (dev_tools.js Stage 5).
// =============================================================================


// =============================================================================
// SLIDE PNG EXPORTER
// Exports each slide in a presentation as a PNG to the same Drive folder.
// Uses the Slides API thumbnail endpoint (LARGE = ~1600px wide).
// =============================================================================

/**
 * Exports all slides in a presentation as individual PNG files.
 * Saves each PNG to the same Drive folder as the presentation.
 * Files are named: [DeckName]_Slide1.png, _Slide2.png, etc.
 *
 */
function exportSlidesToPng(presentationId) {
  const token            = ScriptApp.getOAuthToken();
  const presentationFile = DriveApp.getFileById(presentationId);
  const targetFolder     = presentationFile.getParents().next();
  const baseName         = presentationFile.getName();
  const slides           = SlidesApp.openById(presentationId).getSlides();

  slides.forEach((slide, index) => {
    const pageId  = slide.getObjectId();
    const thumbUrl =
      `https://slides.googleapis.com/v1/presentations/${presentationId}/pages/${pageId}/thumbnail` +
      `?thumbnailProperties.mimeType=PNG&thumbnailProperties.thumbnailSize=LARGE`;

    const thumbResponse = UrlFetchApp.fetch(thumbUrl, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const contentUrl = JSON.parse(thumbResponse.getContentText()).contentUrl;

    const imageBlob = UrlFetchApp.fetch(contentUrl).getBlob();
    imageBlob.setName(`${baseName}_Slide${index + 1}.png`);
    targetFolder.createFile(imageBlob);
  });

  console.log(`exportSlidesToPng: exported ${slides.length} slide(s) from "${baseName}".`);
}
