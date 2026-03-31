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
 *  - "playlists"      : id | name | videoIds (JSON array) | createdAt | ownerId | isSystem | isPublic
 *  - "videos"         : videoId | title | channelName | thumbnailUrl | addedAt
 *  - "quiz_results"   : userId | videoId | cueStartMs | targetWord | userAnswer | correct | answeredAt
 *  - "watch_sessions" : userId | videoId | date | seconds | updatedAt
 *  - "view_history"   : userId | videoId | viewedAt
 *
 * ADMIN CONFIG:
 *  Set VITE_ADMIN_EMAILS in .env.local (client-side).
 *  GAS does not enforce admin — it trusts the client to send correct ownerId/isSystem values.
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
  return getOrCreateSheet('playlists', ['id', 'name', 'videoIds', 'createdAt', 'ownerId', 'isSystem', 'isPublic']);
}

function videoSheet() {
  return getOrCreateSheet('videos', ['videoId', 'title', 'channelName', 'thumbnailUrl', 'addedAt']);
}

function quizResultSheet() {
  return getOrCreateSheet('quiz_results', ['userId', 'videoId', 'cueStartMs', 'targetWord', 'userAnswer', 'correct', 'answeredAt']);
}

function watchSessionSheet() {
  return getOrCreateSheet('watch_sessions', ['userId', 'videoId', 'date', 'seconds', 'updatedAt']);
}

function viewHistorySheet() {
  return getOrCreateSheet('view_history', ['userId', 'videoId', 'viewedAt']);
}

function videoProgressSheet() {
  return getOrCreateSheet('video_progress', ['userId', 'videoId', 'positionMs', 'durationMs', 'updatedAt']);
}

function videoNotesSheet() {
  return getOrCreateSheet('video_notes', ['userId', 'videoId', 'positionMs', 'text', 'createdAt']);
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

// Returns system playlists + playlists owned by userId + public user playlists
function getPlaylistsForUser(data) {
  var userId = String(data.userId);
  var rows = playlistSheet().getDataRange().getValues();
  if (rows.length <= 1) return [];
  return rows.slice(1).map(function(row) {
    return {
      id:        String(row[0]),
      name:      String(row[1]),
      videoIds:  JSON.parse(row[2] || '[]'),
      createdAt: String(row[3]),
      ownerId:   String(row[4] || ''),
      isSystem:  row[5] === 'TRUE' || row[5] === true,
      isPublic:  row[6] === 'TRUE' || row[6] === true,
    };
  }).filter(function(p) {
    if (!p.id) return false;
    if (p.isSystem) return true;
    if (String(p.ownerId) === userId) return true;
    if (p.isPublic) return true;
    return false;
  });
}

function upsertPlaylist(playlist) {
  var sheet = playlistSheet();
  var row = [
    playlist.id,
    playlist.name,
    JSON.stringify(playlist.videoIds || []),
    playlist.createdAt || '',
    playlist.ownerId || '',
    playlist.isSystem ? 'TRUE' : 'FALSE',
    playlist.isPublic ? 'TRUE' : 'FALSE',
  ];
  var idx = findRowIndex(sheet, 0, playlist.id);
  if (idx > 0) {
    sheet.getRange(idx, 1, 1, 7).setValues([row]);
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

// Returns newest-first page of videos + total count
function getVideosPaged(data) {
  var offset = Number(data.offset) || 0;
  var limit  = Number(data.limit)  || 24;
  var all    = getAllVideos().reverse(); // newest first
  var total  = all.length;
  var page   = all.slice(offset, offset + limit);
  return { videos: page, total: total };
}

// Full-text search across videos (title, channel) and playlists (name)
function searchContent(data) {
  var q      = String(data.query || '').toLowerCase().trim();
  var userId = String(data.userId || '');
  if (!q) return { videos: [], playlists: [] };

  var videos = getAllVideos().reverse().filter(function(v) {
    return v.title.toLowerCase().indexOf(q) !== -1 ||
           v.channelName.toLowerCase().indexOf(q) !== -1;
  }).slice(0, 20);

  var allPlaylists = getPlaylistsForUser({ userId: userId });
  var playlists = allPlaylists.filter(function(p) {
    return p.name.toLowerCase().indexOf(q) !== -1;
  }).slice(0, 10);

  return { videos: videos, playlists: playlists };
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

// ── Quiz result helpers ──────────────────────────────────────────────────────

function saveQuizAttempt(attempt) {
  var sheet = quizResultSheet();
  sheet.appendRow([
    attempt.userId,
    attempt.videoId,
    attempt.cueStartMs,
    attempt.targetWord,
    attempt.userAnswer,
    attempt.correct ? 'TRUE' : 'FALSE',
    attempt.answeredAt,
  ]);
}

// ── Watch session helpers ────────────────────────────────────────────────────

function incrementWatchTime(data) {
  var sheet = watchSessionSheet();
  var sheetData = sheet.getDataRange().getValues();
  // Find existing row for (userId, videoId, date)
  for (var i = 1; i < sheetData.length; i++) {
    if (String(sheetData[i][0]) === String(data.userId) &&
        String(sheetData[i][1]) === String(data.videoId) &&
        String(sheetData[i][2]) === String(data.date)) {
      var current = Number(sheetData[i][3]) || 0;
      sheet.getRange(i + 1, 4).setValue(current + data.seconds);
      sheet.getRange(i + 1, 5).setValue(data.updatedAt);
      return;
    }
  }
  sheet.appendRow([data.userId, data.videoId, data.date, data.seconds, data.updatedAt]);
}

// ── Progress data (watch + quiz for a user) ──────────────────────────────────

function getProgressData(data) {
  var userId = String(data.userId);

  var watchData = watchSessionSheet().getDataRange().getValues();
  var sessions = watchData.slice(1)
    .filter(function(r) { return String(r[0]) === userId; })
    .map(function(r) {
      return {
        userId:    String(r[0]),
        videoId:   String(r[1]),
        date:      String(r[2]),
        seconds:   Number(r[3]) || 0,
        updatedAt: String(r[4]),
      };
    });

  var quizData = quizResultSheet().getDataRange().getValues();
  var quizzes = quizData.slice(1)
    .filter(function(r) { return String(r[0]) === userId; })
    .map(function(r) {
      return {
        userId:      String(r[0]),
        videoId:     String(r[1]),
        cueStartMs:  Number(r[2]) || 0,
        targetWord:  String(r[3]),
        userAnswer:  String(r[4]),
        correct:     r[5] === 'TRUE' || r[5] === true,
        answeredAt:  String(r[6]),
      };
    });

  return { sessions: sessions, quizzes: quizzes };
}

// ── View history helpers ─────────────────────────────────────────────────────

function recordView(entry) {
  viewHistorySheet().appendRow([entry.userId, entry.videoId, entry.viewedAt]);
}

// ── Video progress helpers ────────────────────────────────────────────────────

function saveVideoProgress(data) {
  var sheet = videoProgressSheet();
  var rows = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(data.userId) && String(rows[i][1]) === String(data.videoId)) {
      sheet.getRange(i + 1, 3).setValue(data.positionMs);
      sheet.getRange(i + 1, 4).setValue(data.durationMs || 0);
      sheet.getRange(i + 1, 5).setValue(data.updatedAt);
      return;
    }
  }
  sheet.appendRow([data.userId, data.videoId, data.positionMs, data.durationMs || 0, data.updatedAt]);
}

function getVideoProgress(data) {
  var userId = String(data.userId);
  var videoId = String(data.videoId);
  var rows = videoProgressSheet().getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === userId && String(rows[i][1]) === videoId) {
      return { userId: userId, videoId: videoId, positionMs: Number(rows[i][2]) || 0, durationMs: Number(rows[i][3]) || 0, updatedAt: String(rows[i][4]) };
    }
  }
  return null;
}

// Returns in-progress videos (positionMs > 0) sorted by updatedAt desc
function getRecentProgress(data) {
  var userId = String(data.userId);
  var limit = data.limit || 10;
  var rows = videoProgressSheet().getDataRange().getValues();
  if (rows.length <= 1) return [];
  return rows.slice(1)
    .filter(function(r) { return String(r[0]) === userId && Number(r[2]) > 0; })
    .map(function(r) {
      return { userId: String(r[0]), videoId: String(r[1]), positionMs: Number(r[2]) || 0, durationMs: Number(r[3]) || 0, updatedAt: String(r[4]) };
    })
    .sort(function(a, b) { return b.updatedAt.localeCompare(a.updatedAt); })
    .slice(0, limit);
}

function getViewHistory(data) {
  var userId = String(data.userId);
  var rows = viewHistorySheet().getDataRange().getValues();
  if (rows.length <= 1) return [];
  return rows.slice(1)
    .filter(function(r) { return String(r[0]) === userId; })
    .map(function(r) { return { userId: String(r[0]), videoId: String(r[1]), viewedAt: String(r[2]) }; })
    .reverse(); // newest first
}

// ── Video notes helpers ───────────────────────────────────────────────────────

function saveNote(data) {
  videoNotesSheet().appendRow([data.userId, data.videoId, data.positionMs, data.text, data.createdAt]);
}

function getNotesForVideo(data) {
  var userId = String(data.userId);
  var videoId = String(data.videoId);
  var rows = videoNotesSheet().getDataRange().getValues();
  if (rows.length <= 1) return [];
  return rows.slice(1)
    .filter(function(r) { return String(r[0]) === userId && String(r[1]) === videoId; })
    .map(function(r) {
      return { userId: String(r[0]), videoId: String(r[1]), positionMs: Number(r[2]), text: String(r[3]), createdAt: String(r[4]) };
    })
    .sort(function(a, b) { return a.positionMs - b.positionMs; });
}

function deleteNote(data) {
  var sheet = videoNotesSheet();
  var rows = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(data.userId) && String(rows[i][4]) === String(data.createdAt)) {
      sheet.deleteRow(i + 1);
      return;
    }
  }
}

// Returns all notes for a user, sorted newest-first (used by NotesPage initial load)
function getAllNotes(data) {
  var userId = String(data.userId);
  var rows = videoNotesSheet().getDataRange().getValues();
  if (rows.length <= 1) return [];
  return rows.slice(1)
    .filter(function(r) { return String(r[0]) === userId; })
    .map(function(r) {
      return { userId: String(r[0]), videoId: String(r[1]), positionMs: Number(r[2]), text: String(r[3]), createdAt: String(r[4]) };
    })
    .sort(function(a, b) { return b.createdAt.localeCompare(a.createdAt); });
}

// Server-side search across note text + video titles, with pagination
// Returns { notes: NoteWithMeta[], total: number }
function searchNotes(data) {
  var userId = String(data.userId);
  var query  = String(data.query  || '').toLowerCase().trim();
  var offset = Number(data.offset) || 0;
  var limit  = Number(data.limit)  || 15;

  // Build video lookup: videoId → { title, thumbnailUrl }
  var videoRows = videoSheet().getDataRange().getValues();
  var videoMap = {};
  for (var i = 1; i < videoRows.length; i++) {
    videoMap[String(videoRows[i][0])] = {
      title:        String(videoRows[i][1]),
      thumbnailUrl: String(videoRows[i][3]),
    };
  }

  // Fetch all notes for user, newest-first
  var noteRows = videoNotesSheet().getDataRange().getValues();
  var all = noteRows.length <= 1 ? [] : noteRows.slice(1)
    .filter(function(r) { return String(r[0]) === userId; })
    .map(function(r) {
      var v = videoMap[String(r[1])] || { title: '', thumbnailUrl: '' };
      return {
        userId:           String(r[0]),
        videoId:          String(r[1]),
        positionMs:       Number(r[2]),
        text:             String(r[3]),
        createdAt:        String(r[4]),
        videoTitle:       v.title,
        videoThumbnailUrl: v.thumbnailUrl,
      };
    })
    .sort(function(a, b) { return b.createdAt.localeCompare(a.createdAt); });

  // Filter by query (note text OR video title)
  var filtered = query ? all.filter(function(n) {
    return n.text.toLowerCase().indexOf(query) !== -1 ||
           n.videoTitle.toLowerCase().indexOf(query) !== -1;
  }) : all;

  return {
    notes: filtered.slice(offset, offset + limit),
    total: filtered.length,
  };
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

    if (action === 'getPlaylists')      return ok(getPlaylistsForUser(data));
    if (action === 'getVideos')         return ok(getAllVideos());
    if (action === 'getVideosPaged')    return ok(getVideosPaged(data));
    if (action === 'searchContent')     return ok(searchContent(data));
    if (action === 'upsertPlaylist')    { upsertPlaylist(data); return ok(null); }
    if (action === 'deletePlaylist')    { deletePlaylist(data.id); return ok(null); }
    if (action === 'upsertVideo')       { upsertVideo(data); return ok(null); }
    if (action === 'saveQuizAttempt')   { saveQuizAttempt(data); return ok(null); }
    if (action === 'incrementWatchTime'){ incrementWatchTime(data); return ok(null); }
    if (action === 'getProgressData')   return ok(getProgressData(data));
    if (action === 'recordView')        { recordView(data); return ok(null); }
    if (action === 'getViewHistory')    return ok(getViewHistory(data));
    if (action === 'saveVideoProgress') { saveVideoProgress(data); return ok(null); }
    if (action === 'getVideoProgress')  return ok(getVideoProgress(data));
    if (action === 'getRecentProgress') return ok(getRecentProgress(data));
    if (action === 'saveNote')          { saveNote(data); return ok(null); }
    if (action === 'getNotesForVideo')  return ok(getNotesForVideo(data));
    if (action === 'getAllNotes')        return ok(getAllNotes(data));
    if (action === 'searchNotes')        return ok(searchNotes(data));
    if (action === 'deleteNote')        { deleteNote(data); return ok(null); }

    return err('Unknown action: ' + action);
  } catch (ex) {
    return err(String(ex));
  }
}
