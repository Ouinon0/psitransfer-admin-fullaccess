'use strict';

// Lightweight, crash-proof, in-memory + file-persisted visitor log.
// Used by the admin "Visitors" view. Everything is best-effort: errors are
// swallowed so a tracking hiccup can never break uploads or downloads.
//
// FOCUS: the UPLOADER is the primary target (cross-session id + fingerprint
// via tus metadata, IP/UA/lang at POST time, upload events). The downloader
// is tracked as a secondary signal via the ?t= query on public links.

const fs = require('fs');
const path = require('path');

const MAX_VISITORS = 3000;
const MAX_EVENTS_PER_VISITOR = 120;
const MAX_REFS_PER_VISITOR = 6;

class TrackingStore {
  constructor() {
    this.file = null;
    this.visitors = new Map(); // tid -> visitor record
    this.totals = { visits: 0, uploads: 0, downloads: 0 };
    this._saveTimer = null;
  }

  init(uploadDir) {
    this.file = path.resolve(uploadDir, 'visits.json');
    try {
      if (fs.existsSync(this.file)) {
        const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        if (data && typeof data === 'object') {
          if (data.totals) this.totals = { ...this.totals, ...data.totals };
          if (data.visitors && typeof data.visitors === 'object') {
            Object.keys(data.visitors).forEach(tid => {
              this.visitors.set(String(tid), data.visitors[tid]);
            });
          }
        }
      }
    } catch (e) {}
  }

  _bumpTotals(kind) {
    kind = kind === 'upload' ? 'uploads' : (kind === 'download' ? 'downloads' : 'visits');
    this.totals[kind] = (this.totals[kind] || 0) + 1;
  }

  _visitor(tid) {
    let v = this.visitors.get(tid);
    if (!v) {
      if (this.visitors.size >= MAX_VISITORS) {
        // drop oldest record to keep the file bounded
        const oldest = this.visitors.keys().next().value;
        this.visitors.delete(oldest);
      }
      v = {
        tid,
        fp: '',
        visits: 0,
        uploads: 0,
        downloads: 0,
        firstSeen: Date.now(),
        lastSeen: Date.now(),
ip: '',
        ua: '',
        lang: '',
        tz: '',
        screen: '',
        fp: '',
        email: '',
        refs: [],
        events: []
      };
      this.visitors.set(tid, v);
    }
    return v;
  }

  record(entry) {
    try {
      const tid = String(entry && entry.t ? entry.t : '');
      if (!tid) return;
      const v = this._visitor(tid);
      const now = entry.ts || Date.now();
      const kind = entry.kind === 'upload' ? 'upload'
        : entry.kind === 'download' ? 'download'
          : 'visit';

      v.lastSeen = now;
      if (!v.firstSeen || now < v.firstSeen) v.firstSeen = now;
      if (kind === 'visit') v.visits++;
      else if (kind === 'upload') v.uploads++;
      else v.downloads++;

      if (entry.fp) v.fp = entry.fp;
      if (entry.ip) v.ip = entry.ip;
      if (entry.ua) v.ua = entry.ua;
      if (typeof entry.lang === 'string' && entry.lang) v.lang = entry.lang;
      if (typeof entry.tz === 'string' && entry.tz) v.tz = entry.tz;
      if (typeof entry.scr === 'string' && entry.scr) v.screen = entry.scr;
      if (typeof entry.email === 'string' && entry.email) v.email = entry.email;
      if (entry.ref && v.refs.indexOf(entry.ref) === -1) {
        v.refs.push(entry.ref);
        if (v.refs.length > MAX_REFS_PER_VISITOR) v.refs.shift();
      }

      const ev = { ts: now, kind };
      if (entry.sid) ev.sid = entry.sid;
      if (entry.file && typeof entry.file === 'string') ev.file = entry.file.slice(0, 120);
      v.events.push(ev);
      if (v.events.length > MAX_EVENTS_PER_VISITOR) v.events.shift();

      this._bumpTotals(kind);
      this._scheduleSave();
    } catch (e) {}
  }

  _scheduleSave() {
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this.save();
    }, 1500);
  }

  save() {
    try {
      if (!this.file) return;
      const payload = {
        totals: this.totals,
        visitors: {}
      };
      this.visitors.forEach((v, tid) => {
        payload.visitors[tid] = v;
      });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(payload));
      fs.renameSync(tmp, this.file);
    } catch (e) {}
  }

  all() {
    return Array.from(this.visitors.values());
  }

  get(tid) {
    return this.visitors.get(String(tid)) || null;
  }
}

module.exports = new TrackingStore();