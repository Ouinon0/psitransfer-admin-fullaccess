let tid = '';
let fp = '';
let visitCount = 0;

const KEY_ID = 'pt_tid';
const KEY_FP = 'pt_fp';
const KEY_VC = 'pt_vc';

function getCookie(name) {
  try {
    const m = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/([.*+?^${}()|[\]\\])/g, '\\$1') + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : '';
  } catch (e) {
    return '';
  }
}

function setCookie(name, value, days) {
  try {
    let expires = '';
    if (days) {
      const d = new Date();
      d.setTime(d.getTime() + days * 24 * 3600 * 1000);
      expires = '; expires=' + d.toUTCString();
    }
    document.cookie = name + '=' + encodeURIComponent(value) + expires + '; path=/; SameSite=Lax';
  } catch (e) {}
}

function loadStorage(key) {
  try {
    return window.localStorage.getItem(key) || '';
  } catch (e) {
    return '';
  }
}

function saveStorage(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch (e) {}
}

function randomId() {
  try {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID().replace(/-/g, '');
  } catch (e) {}
  try {
    const bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  } catch (e) {}
  return 'xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(16);
}

function safeScreen() {
  try {
    const s = window.screen || {};
    return [s.width, s.height, s.colorDepth].filter(x => x != null && x !== '').join('x');
  } catch (e) {
    return '';
  }
}

function canvasStamp() {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 240;
    canvas.height = 60;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    ctx.textBaseline = 'top';
    ctx.font = '14px Arial';
    ctx.fillStyle = '#f60';
    ctx.fillRect(0, 0, 240, 60);
    ctx.fillStyle = '#00f';
    ctx.fillText('PsiTransfer-fp-7f3a', 8, 8);
    ctx.fillStyle = '#080';
    ctx.fillText(window.navigator.userAgent || '', 8, 32);
    ctx.save();
    ctx.transform(0.8, 0.1, -0.2, 0.9, 6, 3);
    ctx.fillText('canvas-stamp', 90, 20);
    ctx.restore();
    return canvas.toDataURL && canvas.toDataURL().slice(0, 160);
  } catch (e) {
    return '';
  }
}

function computeFp() {
  const parts = [];
  parts.push(safeScreen());
  try { parts.push((window.navigator.hardwareConcurrency || '')); } catch (e) {}
  try { parts.push(Intl.DateTimeFormat().resolvedOptions().timeZone || ''); } catch (e) {}
  try { parts.push(((window.navigator.languages || []).join(',') || window.navigator.language || '')); } catch (e) {}
  try { parts.push(window.navigator.platform || ''); } catch (e) {}
  try { parts.push(window.navigator.userAgent || ''); } catch (e) {}
  parts.push(canvasStamp());
  return fnv1a(parts.join('|'));
}

function nowScreen() {
  try {
    return [window.screen.width, window.screen.height].join('x');
  } catch (e) {
    return '';
  }
}

function baseHref() {
  try {
    const b = document.head.getElementsByTagName('base')[0];
    return b && b.href ? b.href : '/';
  } catch (e) {
    return '/';
  }
}

export function trackerSignal(extra) {
  try {
    if (!tid) return;
    const payload = {
      t: tid,
      fp,
      vc: visitCount,
      scr: nowScreen(),
      tz: (Intl.DateTimeFormat().resolvedOptions().timeZone || ''),
      lang: ((window.navigator.languages || []).join(',') || window.navigator.language || ''),
      ua: window.navigator.userAgent || '',
      url: window.location.href || '',
      ref: document.referrer || ''
    };
    Object.assign(payload, extra || {});
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    const url = baseHref() + 'track';
    if (window.navigator.sendBeacon) {
      window.navigator.sendBeacon(url, blob);
    } else {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url);
      xhr.setRequestHeader('Content-Type', 'application/json;charset=UTF-8');
      xhr.send(blob);
    }
  } catch (e) {}
}

export function trackerLinkQuery() {
  if (!tid) return '';
  return 't=' + encodeURIComponent(tid);
}

export function loadVisitor() {
  try {
    tid = loadStorage(KEY_ID) || getCookie(KEY_ID);
    if (!tid) {
      tid = randomId();
      saveStorage(KEY_ID, tid);
    }
    if (!getCookie(KEY_ID)) setCookie(KEY_ID, tid, 3650);

    fp = loadStorage(KEY_FP) || getCookie(KEY_FP);
    if (!fp) {
      fp = computeFp();
      saveStorage(KEY_FP, fp);
      setCookie(KEY_FP, fp, 3650);
    }

    visitCount = parseInt(loadStorage(KEY_VC) || '0', 10) || 0;
    visitCount++;
    saveStorage(KEY_VC, String(visitCount));
  } catch (e) {}
}

export function trackDownload(sid, file) {
  trackerSignal({ kind: 'download', sid, file });
}

loadVisitor();

export const visitor = {
  get tid() { return tid; },
  get fp() { return fp; },
  get visitCount() { return visitCount; },
  get screen() { return safeScreen(); },
  get ua() { try { return window.navigator.userAgent || ''; } catch (e) { return ''; } },
  query: trackerLinkQuery
};