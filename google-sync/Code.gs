/**
 * HM2 Log web app. The owner deploys this from their own Google account.
 * Set script property HM2_TOKEN to a secret only the phone knows.
 * The phone posts JSON. This file does not contain that secret.
 */
var HEADERS = {
  Trips: ["Id", "Boat", "Title", "Trip ID", "Status", "Departure", "Destination", "Crew", "Hour meter", "Your guess", "App guess", "ETA result", "Conditions", "Best moment", "Starfish", "Departed", "Arrived", "Updated"],
  "Notes & Journal": ["Id", "Boat", "Trip", "When", "Kind", "Text", "Logged by", "Updated"],
  "Boat Activities": ["Id", "Boat", "Trip", "When", "Kind", "Quantity", "Unit", "Cost", "Currency", "Tank", "Notes", "Updated"],
  "Maintenance Tickets": ["Id", "Boat", "Trip", "Title", "Detail", "Status", "Updated"],
  Parts: ["Id", "Boat", "Name", "Part number", "Checked", "Updated"],
  People: ["Id", "Name", "Categories", "Updated"],
  Places: ["Id", "Name", "Notes", "Updated"],
};

var TAB_FOR = {
  trip: "Trips",
  note: "Notes & Journal",
  activity: "Boat Activities",
  ticket: "Maintenance Tickets",
  part: "Parts",
  person: "People",
  place: "Places",
};

function doPost(e) {
  try {
    var body = JSON.parse((e.postData && e.postData.contents) || "{}");
    var expected = PropertiesService.getScriptProperties().getProperty("HM2_TOKEN");
    if (!expected || body.token !== expected) {
      return json_({ ok: false, error: "That token does not match." });
    }
    var props = PropertiesService.getScriptProperties();
    var sheet = openOrCreateSheet_(props);
    var doc = openOrCreateDoc_(props);
    (body.changes || []).forEach(function (change) {
      upsertRow_(sheet, change);
      if (change.journal && change.journal.id) upsertJournal_(doc, change.journal);
    });
    return json_({ ok: true, sheetUrl: sheet.getUrl(), docUrl: doc.getUrl() });
  } catch (error) {
    return json_({ ok: false, error: String(error && error.message ? error.message : error) });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function openOrCreateSheet_(props) {
  var id = props.getProperty("HM2_SHEET_ID");
  var ss = null;
  if (id) {
    try {
      ss = SpreadsheetApp.openById(id);
    } catch (error) {
      ss = null;
    }
  }
  if (!ss) {
    ss = SpreadsheetApp.create("HM2 Log");
    props.setProperty("HM2_SHEET_ID", ss.getId());
  }
  Object.keys(HEADERS).forEach(function (name) {
    var sheet = ss.getSheetByName(name) || ss.insertSheet(name);
    var headers = HEADERS[name];
    if (sheet.getLastRow() === 0 || sheet.getRange(1, 1).getValue() !== "Id") {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    }
  });
  var leftover = ss.getSheetByName("Sheet1");
  if (leftover && ss.getSheets().length > 1) ss.deleteSheet(leftover);
  return ss;
}

function openOrCreateDoc_(props) {
  var id = props.getProperty("HM2_DOC_ID");
  var doc = null;
  if (id) {
    try {
      doc = DocumentApp.openById(id);
    } catch (error) {
      doc = null;
    }
  }
  if (!doc) {
    doc = DocumentApp.create("HM2 Log - Trip Journal");
    props.setProperty("HM2_DOC_ID", doc.getId());
    doc.getBody().appendParagraph("HM2 Log - Trip Journal").setHeading(DocumentApp.ParagraphHeading.TITLE);
  }
  return doc;
}

function upsertRow_(ss, change) {
  var tab = TAB_FOR[change.kind];
  if (!tab) return;
  var sheet = ss.getSheetByName(tab);
  var headers = HEADERS[tab];
  var row = change.row || {};
  var values = headers.map(function (header) {
    var value = header === "Id" ? (row.Id || change.id || "") : row[header];
    return value == null ? "" : String(value);
  });
  var id = String(values[0]);
  var last = sheet.getLastRow();
  if (last >= 2) {
    var ids = sheet.getRange(2, 1, last - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) === id) {
        sheet.getRange(i + 2, 1, 1, headers.length).setValues([values]);
        return;
      }
    }
  }
  sheet.appendRow(values);
}

function upsertJournal_(doc, journal) {
  var body = doc.getBody();
  ensureBoatHeading_(body, journal.boat || "Boat");
  removeMarkedSection_(body, "Ref " + journal.id);
  body.appendParagraph(journal.title || "Trip").setHeading(DocumentApp.ParagraphHeading.HEADING2);
  (journal.lines || []).forEach(function (line) {
    if (line) body.appendParagraph(String(line));
  });
  appendList_(body, "Notes", journal.notes);
  appendList_(body, "Catches", journal.catches);
  appendList_(body, "Repairs", journal.repairs);
}

function appendList_(body, title, items) {
  if (!items || !items.length) return;
  body.appendParagraph(title).setHeading(DocumentApp.ParagraphHeading.HEADING3);
  items.forEach(function (item) {
    if (item) body.appendParagraph(String(item));
  });
}

function ensureBoatHeading_(body, name) {
  for (var i = 0; i < body.getNumChildren(); i++) {
    var child = body.getChild(i);
    if (child.getType() === DocumentApp.ElementType.PARAGRAPH && child.getHeading() === DocumentApp.ParagraphHeading.HEADING1 && child.getText() === name) return;
  }
  body.appendParagraph(name).setHeading(DocumentApp.ParagraphHeading.HEADING1);
}

function removeMarkedSection_(body, marker) {
  var found = body.findText(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!found) return;
  var element = found.getElement();
  var paragraph = element.getType() === DocumentApp.ElementType.TEXT ? element.getParent() : element;
  if (!paragraph || paragraph.getType() !== DocumentApp.ElementType.PARAGRAPH) return;
  var start = body.getChildIndex(paragraph);
  while (start > 0) {
    var previous = body.getChild(start - 1);
    if (previous.getType() === DocumentApp.ElementType.PARAGRAPH && previous.getHeading() === DocumentApp.ParagraphHeading.HEADING2) {
      start -= 1;
      break;
    }
    if (previous.getType() === DocumentApp.ElementType.PARAGRAPH && previous.getHeading() === DocumentApp.ParagraphHeading.HEADING1) break;
    start -= 1;
  }
  var end = start + 1;
  while (end < body.getNumChildren()) {
    var child = body.getChild(end);
    if (child.getType() === DocumentApp.ElementType.PARAGRAPH) {
      var heading = child.getHeading();
      if (heading === DocumentApp.ParagraphHeading.HEADING1 || heading === DocumentApp.ParagraphHeading.HEADING2) break;
    }
    end += 1;
  }
  for (var i = end - 1; i >= start; i--) body.removeChild(body.getChild(i));
}
