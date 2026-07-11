/**
 * Backup receiver — paste into a NEW standalone Apps Script project
 * (script.google.com > New project), then:
 *
 *   1. Set SPREADSHEET_ID to the game spreadsheet's ID (the long token in
 *      its URL, between /d/ and /edit).
 *   2. Set SECRET to a long random string (the same value goes on the Pi).
 *   3. Deploy > New deployment > Web app; Execute as: Me; Who has access:
 *      Anyone. Copy the /exec URL — that's SHEETS_BACKUP_URL on the Pi.
 *
 * The Pi's scripts/backup_to_sheets.py POSTs the trainers/pokemon tables
 * here nightly. This overwrites the data rows (row 2 and down) of the two
 * tabs, keeping the header row, so the tabs stay exactly importable by
 * import_sheets.py. Older days are recoverable via the spreadsheet's
 * File > Version history.
 */
const SPREADSHEET_ID = 'PASTE_SPREADSHEET_ID_HERE';
const SECRET = 'PASTE_A_LONG_RANDOM_SECRET_HERE';

// The only tabs the Pi is allowed to overwrite.
const ALLOWED_TABS = ['Trainer Data', 'Pokemon Data'];

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (!body || body.secret !== SECRET) {
      return respond({ status: 'error', error: 'bad secret' });
    }
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const written = {};
    for (const name of ALLOWED_TABS) {
      const rows = body.tables && body.tables[name];
      if (!rows) continue;
      if (!rows.length) {
        return respond({ status: 'error', error: name + ': empty payload, refusing to wipe the tab' });
      }
      const sheet = ss.getSheetByName(name);
      if (!sheet) {
        return respond({ status: 'error', error: 'tab not found: ' + name });
      }
      const lastRow = sheet.getLastRow();
      if (lastRow > 1) {
        sheet.getRange(2, 1, lastRow - 1, sheet.getMaxColumns()).clearContent();
      }
      const width = Math.max.apply(null, rows.map(function (r) { return r.length; }));
      const padded = rows.map(function (r) {
        return r.concat(new Array(width - r.length).fill(''));
      });
      sheet.getRange(2, 1, padded.length, width).setValues(padded);
      written[name] = padded.length;
    }
    return respond({ status: 'ok', written: written, at: new Date().toISOString() });
  } catch (err) {
    return respond({ status: 'error', error: String(err) });
  }
}

function respond(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
