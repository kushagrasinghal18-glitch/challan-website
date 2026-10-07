// Paste into a Google Sheet: Extensions → Apps Script. Deploy → New deployment →
// Web app, "Execute as: Me", "Who has access: Anyone". Put the web app URL in
// Render as LEADS_WEBHOOK_URL. Every new lead then appears as a row.
function doPost(e) {
  const lead = JSON.parse(e.postData.contents);
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['Received', 'Reference', 'Name', 'Vehicle number', 'Mobile', 'City', 'Language', 'Status']);
    sheet.setFrozenRows(1);
  }
  // Leading ' keeps the mobile number as text so Sheets doesn't mangle it.
  sheet.appendRow([new Date(), lead.ref, lead.name, lead.plate, "'" + lead.phone, lead.city, lead.lang, lead.status]);
  return ContentService.createTextOutput('ok');
}
