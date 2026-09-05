const pug = require('pug');
const express = require('express');
const morgan = require('morgan');
const compression = require('compression');
const path = require('path');
const fs = require("fs");
const assert = require('assert');
const { createHash, randomUUID } = require('node:crypto');
const tar = require('tar-stream');
const config = require('../config');
const eventBus = require('./eventBus');
const tusboy = require('./tusboy');
const Store = require('./store');
const tusMeta = require('./tusboy/tus-metadata');
const utils = require('./utils');
const debug = require('debug')('psitransfer:main');
const { hashPassword, verifyPassword } = require('./passwordHash');

function toAsciiFallbackFilename(name, fallback = 'file') {
  const safe = utils.toSafeBasename(name, fallback);
  const normalized = safe.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  const ascii = normalized.replace(/[^\x20-\x7E]+/g, '').trim();
  const cleaned = ascii.replace(/["\\]/g, '_');
  if (cleaned) return cleaned;
  const fallbackSafe = utils.toSafeBasename(fallback, 'file');
  return fallbackSafe.replace(/[^\x20-\x7E]+/g, '').trim() || 'file';
}

function contentDispositionUtf8Filename(name, fallback = 'file') {
  const safe = utils.toSafeBasename(name, fallback);
  const asciiFallback = toAsciiFallbackFilename(safe, fallback);
  const encoded = encodeURIComponent(safe)
    .replace(/['()]/g, c => `%${ c.charCodeAt(0).toString(16).toUpperCase() }`)
    .replace(/\*/g, '%2A');
  return `attachment; filename="${ asciiFallback }"; filename*=UTF-8''${ encoded }`;
}

function md5Hex(input) {
  return createHash('md5').update(input).digest('hex');
}

function sha256Hex(input) {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Signed token for the admin-only file download link, so the browser can
 * follow a plain <a href> without needing to attach the x-passwd header.
 * Never exposes the actual admin password.
 */
function adminFileToken(fid) {
  return sha256Hex(`${ config.adminPass }:${ fid }`).slice(0, 32);
}

/** Real client IP, accounting for Cloudflare Tunnel / reverse proxies. */
function getClientIp(req) {
  return req.get('CF-Connecting-IP')
    || (req.get('X-Forwarded-For') || '').split(',')[0].trim()
    || req.ip;
}

/** Decoded path segment under the /files mount (must match req.params used by tusboy). */
function decodedUploadPathSegment(req) {
  const raw = req.path.startsWith('/') ? req.path.slice(1) : req.path;
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

const pugVars = {
  baseUrl: config.baseUrl
};

const errorPage = pug.compileFile(path.join(__dirname, '../public/pug/error.pug'), { pretty: true });
const adminPage = pug.compileFile(path.join(__dirname, '../public/pug/admin.pug'), { pretty: true });
const uploadPage = pug.compileFile(path.join(__dirname, '../public/pug/upload.pug'), { pretty: true });
const downloadPage = pug.compileFile(path.join(__dirname, '../public/pug/download.pug'), { pretty: true });

const store = new Store(config.uploadDir);
const Db = require('./db');
const { createGzip } = require("zlib");
const httpErrors = require("http-errors");
const db = new Db(config.uploadDir, store);
db.init();
const tracking = require('./tracking');
tracking.init(config.uploadDir);
const app = express();

app.disable('x-powered-by');
app.use(compression());
app.use(express.json());

if (config.accessLog) {
  app.use(morgan(config.accessLog));
}

if (config.trustProxy) {
  app.set('trust proxy', config.trustProxy);
}

if (config.forceHttps) {
  app.enable('trust proxy');
  app.use(function(req, res, next) {
    if (req.secure) return next();
    const target = config.forceHttps === 'true' ? 'https://' + req.headers.host : config.forceHttps;
    res.redirect(target + req.url);
  });
}

// Static files
app.use(`${ config.baseUrl }app`, express.static(path.join(__dirname, '../public/app')));
app.use(`${ config.baseUrl }assets`, express.static(path.join(__dirname, '../public/assets')));

// Resolve language
app.use((req, res, next) => {
  const lang = req.acceptsLanguages(...Object.keys(config.languages)) || config.defaultLanguage;
  req.translations = config.languages[lang];
  next();
});

// robots.txt
app.get(`${ config.baseUrl }robots.txt`, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/robots.txt'));
});

// Init plugins
config.plugins.forEach(pluginName => {
  require('../plugins/' + pluginName)(eventBus, app, config, db);
});

// Upload App
app.get(config.uploadAppPath, (req, res) => {
  res.send(uploadPage({
    ...pugVars,
    baseUrl: config.baseUrl,
    uploadAppPath: config.uploadAppPath,
    lang: req.translations
  }));
});

// Return translations
app.get(`${ config.baseUrl }lang.json`, (req, res) => {
  eventBus.emit('getLang', req.translations);
  res.json(req.translations);
});

// Config
app.get(`${ config.baseUrl }config.json`, (req, res) => {
  // Upload password protection
  if (config.uploadPass) {
    const bfTimeout = 200;
    if (!req.get('x-passwd')) {
      setTimeout(() => res.status(401).send('Unauthorized'), bfTimeout);
      return;
    }
    if (req.get('x-passwd') !== config.uploadPass) {
      setTimeout(() => res.status(403).send('Forbidden'), bfTimeout);
      return;
    }
  }

  const frontendConfig = {
    retentions: config.retentions,
    defaultRetention: config.defaultRetention,
    mailTemplate: config.mailTemplate,
    requireBucketPassword: config.requireBucketPassword,
    maxFileSize: config.maxFileSize,
    maxBucketSize: config.maxBucketSize,
    disableQrCode: config.disableQrCode,
  };

  eventBus.emit('getFrontendConfig', frontendConfig);

  res.json(frontendConfig);
});

app.get(`${ config.baseUrl }admin`, (req, res, next) => {
  if (!config.adminPass) return next();
  res.send(adminPage({ ...pugVars, lang: req.translations }));
});

app.get(`${ config.baseUrl }admin/data.json`, (req, res, next) => {
  if (!config.adminPass) return next();

  const bfTimeout = 500;
  if (!req.get('x-passwd')) {
    // delay answer to make brute force attacks more difficult
    setTimeout(() => res.status(401).send('Unauthorized'), bfTimeout);
    return;
  }
  if (req.get('x-passwd') !== config.adminPass) {
    setTimeout(() => res.status(403).send('Forbidden'), bfTimeout);
    return;
  }

  let result = JSON.parse(JSON.stringify(db.db));
  Object.values(result).forEach(bucket => {
    bucket.forEach(file => {
      if (file.metadata.password) {
        file.metadata._password = true;
        // Only strip the password hash itself (sensitive, unneeded).
        delete file.metadata.password;
      }
      // Admin gets a direct download link for every file, protected or expired:
      // this dedicated route bypasses both the bucket password and the
      // public-link expiry, authenticated via a signed per-file token.
      const fid = `${ file.metadata.sid }++${ file.key }`;
      file.url = `${ config.baseUrl }admin/files/${ fid }?t=${ adminFileToken(fid) }`;
    });
  });

  setTimeout(() => res.json(result), bfTimeout);
});


// Admin: download a file directly, bypassing expiry/password (signed token, no plaintext password in URL)
app.get(`${ config.baseUrl }admin/files/:fid`, async (req, res) => {
  if (!config.adminPass) return res.status(404).end();
  if (!req.query.t || req.query.t !== adminFileToken(req.params.fid)) {
    return res.status(403).send('Forbidden');
  }
  try {
    if (!utils.isSafeTusUploadId(req.params.fid)) {
      return res.status(404).send('Invalid link');
    }
    const info = await store.info(req.params.fid); // throws on 404
    const safeName = utils.toSafeBasename(info.metadata.name, info.key);
    res.set('Content-Disposition', contentDispositionUtf8Filename(safeName, info.key));
    res.set('Cache-Control', 'no-transform');
    res.sendFile(store.getFilename(req.params.fid));
  } catch (e) {
    res.status(404).send('Not found');
  }
});


// Admin: permanently delete a file from disk
app.delete(`${ config.baseUrl }admin/files/:sid/:key`, async (req, res) => {
  if (!config.adminPass) return res.status(404).end();

  const bfTimeout = 300;
  if (!req.get('x-passwd')) {
    setTimeout(() => res.status(401).send('Unauthorized'), bfTimeout);
    return;
  }
  if (req.get('x-passwd') !== config.adminPass) {
    setTimeout(() => res.status(403).send('Forbidden'), bfTimeout);
    return;
  }

  try {
    await db.remove(req.params.sid, req.params.key);
    res.status(204).end();
  } catch (e) {
    console.error(e);
    res.status(500).send(e.message);
  }
});


// Admin: approximate (city-level) geolocation for an uploader's IP, looked
// up on demand. Never returns anything more precise than city/region — an
// IP address cannot be resolved to a street address or exact position.
app.get(`${ config.baseUrl }admin/geoip/:ip`, async (req, res) => {
  if (!config.adminPass) return res.status(404).end();
  if (!req.get('x-passwd') || req.get('x-passwd') !== config.adminPass) {
    return res.status(403).send('Forbidden');
  }

  const ip = req.params.ip;
  if (!ip || /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|f[cd])/.test(ip)) {
    return res.json({ private: true });
  }

  try {
    const r = await fetch(
      `http://ip-api.com/json/${ encodeURIComponent(ip) }?fields=status,message,country,regionName,city,lat,lon,isp,query`
    );
    const data = await r.json();
    if (data.status !== 'success') {
      return res.status(502).json({ error: data.message || 'lookup failed' });
    }
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});


// Admin: aggregated view of the visitors/uploaders (cross-session tracking).
// Auth identical to admin/data.json. With ?tid=xxx returns that visitor's
// full event history + files.
app.get(`${ config.baseUrl }admin/visitors.json`, (req, res, next) => {
  if (!config.adminPass) return next();

  const bfTimeout = 500;
  if (!req.get('x-passwd')) {
    setTimeout(() => res.status(401).send('Unauthorized'), bfTimeout);
    return;
  }
  if (req.get('x-passwd') !== config.adminPass) {
    setTimeout(() => res.status(403).send('Forbidden'), bfTimeout);
    return;
  }

  const toPlain = (a) => ({
    trackerId: a.trackerId,
    email: a.email || '',
    uploads: a.buckets.size,
    files: a.files,
    size: a.size,
    visits: a.visits || 0,
    downloads: a.downloads || 0,
    firstSeen: a.firstSeen,
    lastSeen: a.lastSeen,
    ip: a.ip,
    ua: a.ua,
    lang: a.lang,
    tz: a.tz,
    screen: a.screen,
    fp: a.fp,
    tracked: !!a.trackerId
  });

  const agg = new Map();
  const byTidFiles = new Map();

  Object.values(db.db).forEach(bucket => {
    bucket.forEach(file => {
      const m = file.metadata || {};
      const tid = (m.trackerId || '').toString();
      const key = tid || '__orphan__';
      if (!agg.has(key)) {
        agg.set(key, {
          trackerId: tid || '',
          buckets: new Set(),
          files: 0,
          size: 0,
          visits: 0,
          downloads: 0,
          firstSeen: null,
          lastSeen: 0,
          ip: '',
          ua: '',
          lang: '',
          tz: '',
          screen: '',
          fp: '',
          email: ''
        });
      }
      const a = agg.get(key);
      a.buckets.add(m.sid);
      a.files++;
      a.size += file.size || 0;
      const c = +m.createdAt || 0;
      const l = +m.lastDownload || 0;
      if (c && (!a.firstSeen || c < a.firstSeen)) a.firstSeen = c;
      const act = Math.max(c, l);
      if (act > a.lastSeen) a.lastSeen = act;
      if (m.uploaderIp) a.ip = m.uploaderIp;
      if (m.uploaderUserAgent) a.ua = m.uploaderUserAgent;
      if (m.uploaderLang) a.lang = m.uploaderLang;
      if (m.timezone) a.tz = m.timezone;
      if (m.screen) a.screen = m.screen;
      if (m.fingerprint) a.fp = m.fingerprint;
      if (m.email) a.email = m.email;
      if (!byTidFiles.has(key)) byTidFiles.set(key, []);
      byTidFiles.get(key).push(file);
    });
  });

  // merge live tracking-log stats (page views, download events, more recent UA/IP)
  tracking.all().forEach(v => {
    const key = String(v.tid);
    let a = agg.get(key);
    if (!a) {
      a = {
        trackerId: key,
        buckets: new Set(),
        files: 0,
        size: 0,
        visits: 0,
        downloads: 0,
        firstSeen: null,
        lastSeen: 0,
        ip: '',
        ua: '',
        lang: '',
        tz: '',
        screen: '',
        fp: ''
      };
      agg.set(key, a);
    }
    a.visits += (v.visits || 0);
    a.downloads += (v.downloads || 0);
    if (!a.firstSeen || v.firstSeen < a.firstSeen) a.firstSeen = v.firstSeen;
    if (v.lastSeen > a.lastSeen) a.lastSeen = v.lastSeen;
    if (!a.ip && v.ip) a.ip = v.ip;
    if (!a.ua && v.ua) a.ua = v.ua;
    if (!a.lang && v.lang) a.lang = v.lang;
    if (!a.tz && v.tz) a.tz = v.tz;
    if (!a.screen && v.screen) a.screen = v.screen;
    if (!a.fp && v.fp) a.fp = v.fp;
    if (!a.email && v.email) a.email = v.email;
  });

  const reqTid = req.query.tid ? String(req.query.tid) : '';
  if (reqTid) {
    const a = agg.get(reqTid);
    if (!a) return res.json({ visitor: null, files: [], events: [] });
    const track = tracking.get(reqTid);
    return res.json({
      visitor: toPlain(a),
      files: (byTidFiles.get(reqTid) || []).map(file => ({
        name: file.metadata && file.metadata.name,
        sid: file.metadata && file.metadata.sid,
        key: file.key,
        size: file.size,
        createdAt: file.metadata && file.metadata.createdAt,
        lastDownload: file.metadata && file.metadata.lastDownload,
        expired: !!(file.metadata && file.metadata.expired)
      })),
      events: (track && track.events) ? track.events.slice(-100) : []
    });
  }

  const listed = Array.from(agg.values()).map(toPlain);
  res.json({
    totals: {
      visitors: listed.length,
      files: listed.reduce((n, v) => n + v.files, 0),
      size: listed.reduce((n, v) => n + v.size, 0),
      uploads: listed.reduce((n, v) => n + v.uploads, 0),
      visits: tracking.totals.visits || 0,
      downloads: tracking.totals.downloads || 0
    },
    visitors: listed
  });
});


// Public, lightweight tracking beacon. Sends a tiny analytics payload per
// page view / download event. Never requires consent popups or device
// permissions; it is a plain HTTP request (sendBeacon). Returns 204 so the
// tracking can never disturb the user or make the UI "error".
app.post(`${ config.baseUrl }track`, (req, res) => {
  try {
    const b = (req.body && typeof req.body === 'object') ? req.body : {};
    tracking.record({
      t: b.t,
      fp: b.fp,
      kind: b.kind === 'download' ? 'download' : (b.kind === 'upload' ? 'upload' : 'visit'),
      sid: b.sid,
      file: b.file,
      ip: getClientIp(req),
      ua: b.ua,
      lang: b.lang,
      tz: b.tz,
      scr: b.scr,
      ref: b.ref
    });
  } catch (e) {}
  res.status(204).end();
});

// Fallback for any client that does not support sendBeacon (GET with params)
app.get(`${ config.baseUrl }track`, (req, res) => {
  try {
    tracking.record({
      t: req.query.t,
      fp: req.query.fp,
      kind: req.query.kind === 'download' ? 'download' : (req.query.kind === 'upload' ? 'upload' : 'visit'),
      sid: req.query.sid,
      file: req.query.file,
      ip: getClientIp(req),
      ua: req.query.ua,
      lang: req.query.lang,
      tz: req.query.tz,
      scr: req.query.scr,
      ref: req.query.ref
    });
  } catch (e) {}
  res.status(204).end();
});


// List files / Download App
app.get(`${ config.baseUrl }:sid`, async (req, res, next) => {
  if (req.url.endsWith('.json')) {
    const sid = req.params.sid.substr(0, req.params.sid.length - 5);
    const bucket = db.get(sid);
    if (!bucket) return res.status(404).end();

    // Expired files stay on disk (for the admin), but disappear from the
    // public share link.
    const activeItems = bucket.filter(f => !f.metadata.expired);
    if (activeItems.length === 0) return res.status(404).end();

    const downloadPassword = req.get('x-download-pass');
    const items = activeItems.map(item => ({
      ...item,
      url: `${ config.baseUrl }files/${ sid }++${ item.key }`
    }));

    res.header('Cache-control', 'private, max-age=0, no-cache, no-store, must-revalidate');

    // Currently, every item in a bucket must have the same password
    try {
      const pass = downloadPassword || '';
      for (const item of items) {
        if (!item.metadata.password) continue;
        const ok = await verifyPassword(item.metadata.password, pass);
        if (!ok) {
          setTimeout(() => res.status(401).send('Unauthorized'), 500);
          return;
        }
      }
    } catch (e) {
      console.error(e);
      setTimeout(() => res.status(401).send('Unauthorized'), 500);
      return;
    }

    const keyList = items.map(item => item.key).join();
    const archiveToken = sha256Hex(keyList).slice(0, 32);

    res.json({
      items,
      archiveToken,
      config: {
        maxPreviewSize: config.maxPreviewSize
      }
    });
  } else {
    const bucket = db.get(req.params.sid);
    const hasActiveFiles = bucket && bucket.some(f => !f.metadata.expired);
    if (!hasActiveFiles) return next();
    res.send(downloadPage({ ...pugVars, lang: req.translations }));
  }
});


// Download files
app.get(`${ config.baseUrl }files/:fid`, async (req, res, next) => {
  // let tusboy handle HEAD requests with Tus Header
  if (req.method === 'HEAD' && req.get('Tus-Resumable')) return next();

  // Disable HTTP transport compression for file downloads.
  // Archives already handle their own compression (zip/gzip), and for single
  // files this preserves Content-Length and Range request support needed for
  // resumable downloads of large files.
  res.set('Cache-Control', 'no-transform');

  const sid = req.params.fid.split('++')[0];

  // Download all files
  if (req.params.fid.match(/^[a-z0-9+]+\.(tar\.gz|zip)$/)) {
    const format = req.params.fid.endsWith('.zip') ? 'zip' : 'tar.gz';
    // Expired files stay on disk but drop out of the public archive link.
    const bucket = (db.get(sid) || []).filter(f => !f.metadata.expired);

    if (!bucket.length) return res.status(404).send(errorPage({
        ...pugVars,
        error: 'Download bucket not found.',
        lang: req.translations,
        uploadAppPath: config.uploadAppPath || config.baseUrl,
      }));

    const keyList = bucket.map(f => f.key).join();
    const legacyMd5 = md5Hex(keyList);
    const newSha256 = sha256Hex(keyList).slice(0, 32);
    const expectedLegacy = `${ sid }++${ legacyMd5 }.${ format }`;
    const expectedNew = `${ sid }++${ newSha256 }.${ format }`;

    if (req.params.fid !== expectedLegacy && req.params.fid !== expectedNew) {
      res.status(404).send(errorPage({
        ...pugVars,
        error: 'Invalid link',
        uploadAppPath: config.uploadAppPath || config.baseUrl,
        lang: req.translations,
      }));
      return;
    }
    debug(`Download Bucket ${ sid }`);

    const filename = `${ sid }.${ format }`;
    res.header('Content-Disposition', `attachment; filename="${ filename }"`);

    try {
      res.on('finish', async () => {
        if (res.statusCode >= 400) return; // don't count failed downloads
        bucket.forEach(async info => {
          if (info.metadata.retention === 'one-time') {
            await db.expire(info.metadata.sid, info.metadata.key);
          } else {
            await db.updateLastDownload(info.metadata.sid, info.metadata.key);
          }
        });

        bucket.forEach(info => {
          tracking.record({
            t: req.query.t,
            kind: 'download',
            sid: info.metadata.sid,
            file: info.metadata.name,
            ip: getClientIp(req),
            ua: req.get('user-agent'),
            lang: req.get('accept-language'),
            tz: info.metadata.timezone
          });
        });

        eventBus.emit('archiveDownloaded', {
          sid,
          file: filename,
          metadata: bucket[0].metadata,
          bucket,
          url: req.protocol + '://' + req.get('host') + req.originalUrl,
        });
      });
    }
    catch (e) {
      console.error(e);
    }

    if(format === 'zip') {
      res.header('ContentType', 'application/zip');
      const { ZipArchive } = await import('archiver');
      const archive = new ZipArchive();
      archive.on('error', function(err) {
        console.error(err);
      });
      archive.pipe(res);

      const usedNames = new Map();
      const uniqueName = (rawName, fallback) => {
        const base = utils.toSafeBasename(rawName, fallback);
        const prev = usedNames.get(base) || 0;
        usedNames.set(base, prev + 1);
        if (prev === 0) return base;
        const ext = path.extname(base);
        const stem = ext ? base.slice(0, -ext.length) : base;
        return `${ stem } (${ prev + 1 })${ ext }`;
      };

      for (const info of bucket) {
        await new Promise((resolve, reject) => {
          const stream = fs.createReadStream(store.getFilename(info.metadata.sid + '++' + info.key));
          stream.on('end', resolve);
          archive.append(stream, { name: uniqueName(info.metadata.name, info.key) });
        });
      }

      await archive.finalize();
    } else {
      res.header('ContentType', 'application/x-gtar');
      const pack = tar.pack();
      pack.pipe(createGzip()).pipe(res);

      const usedNames = new Map();
      const uniqueName = (rawName, fallback) => {
        const base = utils.toSafeBasename(rawName, fallback);
        const prev = usedNames.get(base) || 0;
        usedNames.set(base, prev + 1);
        if (prev === 0) return base;
        const ext = path.extname(base);
        const stem = ext ? base.slice(0, -ext.length) : base;
        return `${ stem } (${ prev + 1 })${ ext }`;
      };

      for (const info of bucket) {
        await new Promise((resolve, reject) => {
          const readStream = fs.createReadStream(store.getFilename(info.metadata.sid + '++' + info.key));
          const entry = pack.entry({ name: uniqueName(info.metadata.name, info.key), size: info.size });
          readStream.on('error', reject);
          entry.on('error', reject);
          entry.on('finish',resolve);
          readStream.pipe(entry);
        });
      }
      pack.finalize();
    }

    return;
  }

  // Download single file
  debug(`Download ${ req.params.fid }`);
  try {
    if (req.params.fid.includes('++') && !utils.isSafeTusUploadId(req.params.fid)) {
      return res.status(404).send(errorPage({
        ...pugVars,
        error: 'Invalid link',
        lang: req.translations,
        uploadAppPath: config.uploadAppPath || config.baseUrl,
      }));
    }
    const info = await store.info(req.params.fid); // throws on 404

    // Expired files stay on disk but stop being reachable via the public link.
    const dbItem = db.get(info.metadata.sid)?.find(i => i.key === info.metadata.key);
    if (dbItem && dbItem.metadata.expired) {
      return res.status(404).send(errorPage({
        ...pugVars,
        error: 'This link has expired.',
        lang: req.translations,
        uploadAppPath: config.uploadAppPath || config.baseUrl,
      }));
    }

    const safeName = utils.toSafeBasename(info.metadata.name, info.key);
    res.set('Content-Disposition', contentDispositionUtf8Filename(safeName, info.key));
    res.sendFile(store.getFilename(req.params.fid));

    // soft-expire one-time files after download (kept on disk for the admin)
res.on('finish', async () => {
        if (res.statusCode >= 400) return; // don't count failed downloads
        if (info.metadata.retention === 'one-time') {
          await db.expire(info.metadata.sid, info.metadata.key);
        } else {
          await db.updateLastDownload(info.metadata.sid, info.metadata.key);
        }

        tracking.record({
          t: req.query.t,
          kind: 'download',
          sid: info.metadata.sid,
          file: info.metadata.name,
          ip: getClientIp(req),
          ua: req.get('user-agent'),
          lang: req.get('accept-language'),
          tz: info.metadata.timezone
        });

        eventBus.emit('fileDownloaded', {
          sid,
          file: info.metadata.name,
          metadata: info.metadata,
          url: req.protocol + '://' + req.get('host') + req.originalUrl,
        });
      });
  }
  catch (e) {
    res.status(404).send(errorPage({
      ...pugVars,
      error: e.message,
      lang: req.translations,
      uploadAppPath: config.uploadAppPath || config.baseUrl,
    }));
  }
});


// Upload file
app.use(`${ config.uploadAppPath }files`,
  async function(req, res, next) {
    // Upload password protection
    if (config.uploadPass) {
      const bfTimeout = 500;
      if (!req.get('x-passwd')) {
        setTimeout(() => res.status(401).send('Unauthorized'), bfTimeout);
        return;
      }
      if (req.get('x-passwd') !== config.uploadPass) {
        setTimeout(() => res.status(403).send('Forbidden'), bfTimeout);
        return;
      }
    }

    if (req.method === 'GET') return res.status(405).end();

    const fid = decodedUploadPathSegment(req);
    if (fid === null) {
      return res.status(400).end('Invalid path encoding');
    }

    // Lock bucket by PATCH /files/:sid?lock=yes
    if (fid && !fid.includes('++') && req.method === 'PATCH' && req.query.lock) {
      if (!utils.isSafeBucketFid(fid)) {
        return res.status(400).end('Invalid bucket id');
      }
      await db.lock(fid);
      return res.status(204).end('Bucket locked');
    }

    if (['POST', 'PATCH'].includes(req.method)) {
      if (fid && !fid.includes('++') && !utils.isSafeBucketFid(fid)) {
        return res.status(400).end('Invalid bucket id');
      }
      if (fid && !fid.includes('++') && db.isLocked(fid)) {
        return res.status(400).end('Bucket locked');
      }
      if (fid) {
        if (fid.includes('++') && !utils.isSafeTusUploadId(fid)) {
          return res.status(400).end('Invalid upload id');
        }
        try {
          const info = await store.info(fid);
          if (info.metadata.locked) {
            return res.status(400).end('Bucket locked');
          }
          if (!info.isPartial) {
            return res.status(400).end('Upload already completed');
          }
        } catch (e) {
          if (!(e instanceof httpErrors.NotFound)) {
            console.error(e);
            return next(e);
          }
        }
      }
    }

    if (req.method === 'POST') {
      // validate meta-data
      // !! tusMeta.encode supports only strings !!
      const meta = tusMeta.decode(req.get('Upload-Metadata'));

      try {
        assert(meta.name, 'tus meta prop missing: name');
        assert(meta.sid, 'tus meta prop missing: sid');
        if (!utils.isSafeBasename(meta.sid)) {
          return res.status(400).end('Invalid bucket id');
        }
        assert(meta.retention, 'tus meta prop missing: retention');
        assert(Object.keys(config.retentions).indexOf(meta.retention) >= 0,
          `invalid tus meta prop retention. Value ${ meta.retention } not in [${ Object.keys(config.retentions).join(',') }]`);

        // Prevent ZipSlip/tar path traversal by requiring a safe basename at upload time.
        // Policy (flat archive): no directories, no absolute paths, no traversal, no control chars.
        if (!utils.isSafeBasename(meta.name)) {
          return res.status(400).end('Invalid file name');
        }

        const uploadLength = req.get('Upload-Length');
        assert(uploadLength, 'missing Upload-Length header');

        // Restrict creating new files for locked buckets
        if(db.isLocked(meta.sid)) {
          return res.status(400).end('Bucket locked');
        }

        meta.uploadLength = uploadLength;
        meta.key = randomUUID();
        meta.createdAt = Date.now().toString();

        // Basic connection metadata, same as any standard web server access
        // log would already capture — visible only to the admin.
        meta.uploaderIp = getClientIp(req);
        meta.uploaderUserAgent = req.get('user-agent') || '';
        meta.uploaderLang = req.get('accept-language') || '';

        // limit file and bucket size
        if (config.maxFileSize && config.maxFileSize < +uploadLength) {
          return res
            .status(413)
            .json({ message: `File exceeds maximum upload size ${ config.maxFileSize }.` });
        } else if (config.maxBucketSize && db.bucketSize(meta.sid) + +uploadLength > config.maxBucketSize) {
          return res
            .status(413)
            .json({ message: `Bucket exceeds maximum upload size ${ config.maxBucketSize }.` });
        }

        // store changed metadata for tusboy
        if (typeof meta.password === 'string' && meta.password.length > 0) {
          meta.password = await hashPassword(meta.password);
        } else {
          delete meta.password;
        }
        req.headers['upload-metadata'] = tusMeta.encode(meta);
        // for tusboy getKey()
        req.FID = meta.sid + '++' + meta.key;

        db.add(meta.sid, meta.key, {
          "isPartial": true,
          metadata: meta
        });
      }
      catch (e) {
        console.error(e);
        return res.status(400).end(e.message);
      }
    }

    next();
  },

  // let tusboy handle the upload
  tusboy(store, {
    getKey: req => req.FID,
    maxUploadLength: config.maxFileSize || Infinity,
    afterComplete: (req, upload, fid) => {
      db.add(upload.metadata.sid, upload.metadata.key, upload);
      debug(`Completed upload ${ fid }, size=${ upload.size } name=${ upload.metadata.name }`);
      eventBus.emit('fileUploaded', upload);
      tracking.record({
        t: upload.metadata.trackerId,
        fp: upload.metadata.fingerprint,
        kind: 'upload',
        sid: upload.metadata.sid,
        file: upload.metadata.name,
        ip: getClientIp(req),
        ua: upload.metadata.uploaderUserAgent,
        lang: upload.metadata.uploaderLang,
        tz: upload.metadata.timezone,
        scr: upload.metadata.screen,
        email: upload.metadata.email
      });
    },
  })
);

app.use((req, res, next) => {
  if (req.url === config.baseUrl) {
    return res.redirect(config.uploadAppPath);
  }

  res.status(404).send(errorPage({
    ...pugVars,
    error: 'Download bucket not found.',
    uploadAppPath: config.uploadAppPath || config.baseUrl,
    lang: req.translations
  }));
});

module.exports = app;
