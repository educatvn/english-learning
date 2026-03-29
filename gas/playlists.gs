/**
 * English Learning — Google Apps Script backend
 *
 * SETUP:
 *  1. Mở Google Sheet mới (hoặc hiện có)
 *  2. Extensions → Apps Script → xóa code cũ, paste toàn bộ file này
 *  3. Deploy → New Deployment → Web app
 *       Execute as:     Me
 *       Who has access: Anyone
 *  4. Copy URL → dán vào .env.local:
 *       VITE_GOOGLE_SCRIPT_URL=https://script.google.com/macros/s/.../exec
 *
 * Mỗi lần sửa code: Deploy → Manage Deployments → Edit → New version → Deploy
 *
 * SHEETS:
 *  - "playlists" : id | name | videoIds (JSON array) | createdAt
 *  - "videos"    : videoId | title | channelName | thumbnailUrl | addedAt
 */

// ── Sheet bootstrap ──────────────────────────────────────────────────────────

function getOrCreateSheet(name, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function playlistSheet() {
  return getOrCreateSheet('playlists', ['id', 'name', 'videoIds', 'createdAt']);
}

function videoSheet() {
  return getOrCreateSheet('videos', ['videoId', 'title', 'channelName', 'thumbnailUrl', 'addedAt']);
}

// ── Generic row helpers ──────────────────────────────────────────────────────

function findRowIndex(sheet, colIndex, value) {
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][colIndex]) === String(value)) return i + 1; // 1-based
  }
  return -1;
}

// ── Playlist helpers ─────────────────────────────────────────────────────────

function getAllPlaylists() {
  var data = playlistSheet().getDataRange().getValues();
  if (data.length <= 1) return [];
  return data.slice(1).map(function(row) {
    return {
      id:        String(row[0]),
      name:      String(row[1]),
      videoIds:  JSON.parse(row[2] || '[]'),
      createdAt: String(row[3]),
    };
  }).filter(function(p) { return p.id; });
}

function upsertPlaylist(playlist) {
  var sheet = playlistSheet();
  var row = [playlist.id, playlist.name, JSON.stringify(playlist.videoIds || []), playlist.createdAt || ''];
  var idx = findRowIndex(sheet, 0, playlist.id);
  if (idx > 0) {
    sheet.getRange(idx, 1, 1, 4).setValues([row]);
  } else {
    sheet.appendRow(row);
  }
}

function deletePlaylist(id) {
  var sheet = playlistSheet();
  var idx = findRowIndex(sheet, 0, id);
  if (idx > 0) sheet.deleteRow(idx);
}

// ── Video helpers ────────────────────────────────────────────────────────────

function getAllVideos() {
  var data = videoSheet().getDataRange().getValues();
  if (data.length <= 1) return [];
  return data.slice(1).map(function(row) {
    return {
      videoId:      String(row[0]),
      title:        String(row[1]),
      channelName:  String(row[2]),
      thumbnailUrl: String(row[3]),
      addedAt:      String(row[4]),
    };
  }).filter(function(v) { return v.videoId; });
}

function upsertVideo(video) {
  var sheet = videoSheet();
  var row = [video.videoId, video.title, video.channelName || '', video.thumbnailUrl || '', video.addedAt || ''];
  var idx = findRowIndex(sheet, 0, video.videoId);
  if (idx > 0) {
    sheet.getRange(idx, 1, 1, 5).setValues([row]);
  } else {
    sheet.appendRow(row);
  }
}

// ── Response helper ──────────────────────────────────────────────────────────

function ok(data) {
  var payload = data !== undefined ? { ok: true, data: data } : { ok: true };
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function err(msg) {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: false, error: msg }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── doGet — kept as health check only ───────────────────────────────────────

function doGet() {
  return ok({ status: 'ok' });
}

// ── doPost — handles ALL actions (reads + writes) ────────────────────────────
// Client sends Content-Type: text/plain;charset=utf-8 to avoid CORS preflight.
// GET query params are dropped after Google's 302 redirect, so reads use POST too.

function doPost(e) {
  try {
    var body   = JSON.parse(e.postData.contents);
    var action = body.action;
    var data   = body.data;

    if (action === 'getPlaylists')   return ok(getAllPlaylists());
    if (action === 'getVideos')      return ok(getAllVideos());
    if (action === 'upsertPlaylist') { upsertPlaylist(data); return ok(null); }
    if (action === 'deletePlaylist') { deletePlaylist(data.id); return ok(null); }
    if (action === 'upsertVideo')    { upsertVideo(data); return ok(null); }

    return err('Unknown action: ' + action);
  } catch (ex) {
    return err(String(ex));
  }
}
