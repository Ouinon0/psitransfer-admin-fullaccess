<template lang="pug">
  .download-app
    a.btn.btn-sm.btn-info.btn-admin-refresh(@click='login()', title='Refresh', v-if="loggedIn")
      icon(name="sync-alt")

    .alert.alert-danger(v-show="error")
      strong
        icon.fa-fw(name="exclamation-triangle")
        |  {{ error }}
    form.well(v-if='!loggedIn', @submit.stop.prevent="login")
      h3 Password
      .form-group
        input.form-control(type='password', v-model='password', autofocus="")
      p.text-danger(v-show='passwordWrong')
        strong Access denied!
      |
      button.btn.btn-primary(type="submit", :disabled="!password")
        icon.fa-fw(name="sign-in-alt")
        |  login

    div(v-if="loggedIn")
      .btn-group.btn-admin-switch
        button.btn.btn-sm(:class="{'btn-primary': view==='files'}", @click="view='files'") Files
        button.btn.btn-sm(:class="{'btn-primary': view==='visitors'}", @click="view='visitors'; if(!visitorsLoaded) fetchVisitors()") Visitors

      table.table.table-hover(v-if="view==='files'")
        thead
          tr
            th SID
            th Created
            th Downloaded
            th Expire
            th Size
            th
        template(v-for="(bucket, sid) in db")
          tbody(:class="{expanded: expand===sid}")
            tr.bucket(@click="expandView(sid)")
              td
                | {{ sid }}
                icon.pull-right(name="key", v-if="sum[sid].password", title="Password protected")
              td {{ sum[sid].created | date }}
              td
                template(v-if="sum[sid].lastDownload") {{ sum[sid].lastDownload | date}}
                template(v-else="") -
              td
                template(v-if="typeof sum[sid].firstExpire === 'number'") {{ sum[sid].firstExpire | date }}
                template(v-else)  {{ sum[sid].firstExpire }}
              td.text-right {{ humanFileSize(sum[sid].size) }}
          tbody.expanded(v-if="expand === sid")
            template(v-for="file in bucket")
              tr.file
                td {{ file.metadata.name }}
                td {{+file.metadata.createdAt | date}}
                td
                  template(v-if="file.metadata.lastDownload") {{ +file.metadata.lastDownload | date}}
                  template(v-else="") -
                td
                  template(v-if="typeof file.expireDate === 'number'") {{ file.expireDate | date }}
                  template(v-else) {{ file.expireDate }}
                  span.label.label-default.expired-badge(v-if="file.metadata.expired") expired
                td.text-right {{ humanFileSize(file.size) }}
                td.text-right
                  a.btn.btn-xs.btn-default(v-if="file.url", :href="file.url", target="_blank", title="Download (works even if bucket is password protected or expired)")
                    icon.fa-fw(name="download")
                  |
                  a.btn.btn-xs.btn-default(@click="showData(file)", title="Known info about the uploader")
                    icon.fa-fw(name="info-circle")
                  |
                  a.btn.btn-xs.btn-default(v-if="isImage(file)", @click="showExif(file)", title="Read image EXIF metadata")
                    icon.fa-fw(name="camera")
                  |
                  a.btn.btn-xs.btn-danger(@click="deleteFile(file)", title="Permanently delete this file")
                    icon.fa-fw(name="trash")
          tfoot
            tr
              td(colspan="3")
              td.text-right(colspan="2") Sum: {{ humanFileSize(sizeSum) }}
              td

      template(v-if="view==='visitors'")
        p.text-muted(v-if="visitorsLoading") Loading visitors…
        table.table.table-hover(v-else="")
          thead
            tr
              th Email
              th TID
              th IP
              th Up
              th Files
              th Visits
              th Dl
              th Last seen
              th
          tbody
            tr(v-for="v in sortedVisitors", :key="v.trackerId || v.ip")
              td {{ v.email || '-' }}
              td
                code {{ (v.trackerId || '').slice(0, 8) || '-' }}
              td {{ v.ip || '-' }}
              td {{ v.uploads }}
              td {{ v.files }}
              td {{ v.visits }}
              td {{ v.downloads }}
              td {{ v.lastSeen | date }}
              td.text-right
                a.btn.btn-xs.btn-default(@click="showVisitorDetail(v)") Details

    .data-modal-backdrop(v-if="dataFile", @click.self="closeData")
      .data-modal
        a.btn.btn-xs.btn-default.data-modal-close(@click="closeData") ×
        h4 Uploader info
        dl.dl-horizontal
          dt IP address
          dd {{ dataFile.metadata.uploaderIp || 'unknown' }}
          dt Location
          dd
            template(v-if="geoLoading") looking up…
            template(v-else-if="geoInfo && geoInfo.private") Private/local network
            template(v-else-if="geoInfo && geoInfo.city") {{ geoInfo.city }}, {{ geoInfo.regionName }}, {{ geoInfo.country }}
            template(v-else-if="geoInfo && geoInfo.error") lookup failed
            template(v-else) -
          dt E-mail
          dd {{ dataFile.metadata.email || '-' }}
          dt Tracker ID
          dd
            code {{ dataFile.metadata.trackerId || dataFile.metadata.fingerprint || '-' }}
          dt Timezone
          dd {{ dataFile.metadata.timezone || 'unknown' }}
          dt ISP
          dd {{ (geoInfo && geoInfo.isp) || '-' }}
          dt Language
          dd {{ (dataFile.metadata.uploaderLang || '').split(',')[0] || 'unknown' }}
          dt Browser
          dd {{ parseUserAgent(dataFile.metadata.uploaderUserAgent).browser }}
          dt OS
          dd {{ parseUserAgent(dataFile.metadata.uploaderUserAgent).os }}

    .visitor-modal-backdrop(v-if="detailVisitor", @click.self="closeVisitorDetail")
      .data-modal
        a.btn.btn-xs.btn-default.data-modal-close(@click="closeVisitorDetail") ×
        h4 Visitor
        dl.dl-horizontal
          dt E-mail
          dd {{ detailVisitor.info.email || '-' }}
          dt Tracker ID
          dd
            code {{ detailVisitor.info.trackerId || '-' }}
          dt IP
          dd {{ detailVisitor.info.ip || '-' }}
          dt Activity
          dd {{ detailVisitor.info.uploads }} up · {{ detailVisitor.info.files }} files · {{ detailVisitor.info.visits }} visits · {{ detailVisitor.info.downloads }} dl
          dt Browser
          dd {{ parseUserAgent(detailVisitor.info.ua).browser }} — {{ parseUserAgent(detailVisitor.info.ua).os }}
        h5 Files ({{ detailVisitor.files.length }})
        table.table.table-condensed(v-if="detailVisitor.files.length")
          tbody
            tr(v-for="f in detailVisitor.files", :key="f.sid + f.key")
              td {{ f.name }}
              td {{ +f.createdAt | date }}
              td.text-right {{ humanFileSize(f.size) }}
        h5(v-if="detailVisitor.events.length") Events ({{ detailVisitor.events.length }})
        ul.list-group(v-if="detailVisitor.events.length")
          li.list-group-item(v-for="e in detailVisitor.events", :key="e.ts + e.kind + (e.file || '')")
            span.label(:class="e.kind==='upload' ? 'label-success' : (e.kind==='download' ? 'label-info' : 'label-default')")  {{ e.kind }}
            span.visitor-evt  {{ +e.ts | date }} — {{ e.file || e.sid || '' }}

    .data-modal-backdrop(v-if="exifFile", @click.self="closeExif")
      .data-modal.exif-modal
        a.btn.btn-xs.btn-default.data-modal-close(@click="closeExif") ×
        h4 EXIF metadata
        p.text-muted(v-if="exifLoading") Reading image metadata…
        p.text-danger(v-else-if="exifError") {{ exifError }}
        p.text-muted(v-else-if="!exifEntries.length") No EXIF metadata found.
        table.table.table-condensed.table-striped(v-else)
          tbody
            tr(v-for="entry in exifEntries", :key="entry.key")
              th {{ entry.key }}
              td.text-break {{ entry.value }}

</template>


<script>
  import 'vue-awesome/icons/exclamation-triangle';
  import 'vue-awesome/icons/sync-alt';
  import 'vue-awesome/icons/sign-in-alt';
  import 'vue-awesome/icons/key';
  import 'vue-awesome/icons/download';
  import 'vue-awesome/icons/trash';
  import 'vue-awesome/icons/info-circle';
  import 'vue-awesome/icons/camera';
  import exifr from 'exifr';


  export default {
    name: 'app',

    data () {
      return {
        db: {},
        sum: {},
        loggedIn: false,
        password: '',
        error: '',
        passwordWrong: false,
        expand: false,
        sizeSum: 0,
        view: 'files',
        dataFile: null,
        geoInfo: null,
        geoLoading: false,
        exifFile: null,
        exifEntries: [],
        exifLoading: false,
        exifError: '',
        visitors: [],
        visitorsLoaded: false,
        visitorsLoading: false,
        detailVisitor: null
      }
    },

    computed: {
      sortedVisitors() {
        return this.visitors.slice().sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
      }
    },

    methods: {
      expandView(sid) {
        if(this.expand === sid) return this.expand = false;
        this.expand = sid;
      },

      login() {
        if(!this.password) return;
        const xhr = new XMLHttpRequest();
        xhr.open('GET', 'admin/data.json');
        xhr.setRequestHeader("x-passwd", this.password);
        xhr.onload = () => {
          if(xhr.status === 200) {
            try {
              this.db = JSON.parse(xhr.responseText);
              this.loggedIn = true;
              this.error = '';
              this.passwordWrong = false;
              this.expandDb();
            }
            catch(e) {
              this.error = e.toString();
            }
          } else {
            if(xhr.status === 403) this.passwordWrong = true;
            else this.error = `${xhr.status} ${xhr.statusText}: ${xhr.responseText}`;
          }
        };
        xhr.send();
      },

      expandDb() {
        this.sizeSum = 0;
        Object.keys(this.db).forEach(sid => {
          const bucketSum = {
            firstExpire: Number.MAX_SAFE_INTEGER,
            lastDownload: 0,
            created: Number.MAX_SAFE_INTEGER,
            password: false,
            size: 0
          };
          this.db[sid].forEach(file => {
            bucketSum.size += file.size;
            if(file.metadata._password) {
              bucketSum.password = true;
            }
            if(+file.metadata.createdAt < bucketSum.created) {
              bucketSum.created = +file.metadata.createdAt;
            }
            if(file.metadata.lastDownload && +file.metadata.lastDownload > bucketSum.lastDownload) {
              bucketSum.lastDownload = +file.metadata.lastDownload;
            }
            if(file.metadata.retention === 'one-time') {
              bucketSum.firstExpire = 'one-time';
              file.expireDate = file.metadata.retention;
            }
            else {
              file.expireDate = +file.metadata.createdAt + (+file.metadata.retention * 1000);
              if(bucketSum.firstExpire > file.expireDate) bucketSum.firstExpire = file.expireDate;
            }
          });
          this.sizeSum += bucketSum.size;
          this.$set(this.sum, sid, bucketSum);
        });
      },

      humanFileSize(fileSizeInBytes) {
        let i = -1;
        const byteUnits = [' kB', ' MB', ' GB', ' TB', 'PB', 'EB', 'ZB', 'YB'];
        do {
          fileSizeInBytes = fileSizeInBytes / 1024;
          i++;
        } while(fileSizeInBytes > 1024);
        return Math.max(fileSizeInBytes, 0.00).toFixed(2) + byteUnits[i];
      },

      deleteFile(file) {
        const name = file.metadata.name || file.key;
        if (!window.confirm(`Delete "${name}" permanently? This cannot be undone.`)) return;

        const sid = file.metadata.sid;
        const key = file.key;
        const xhr = new XMLHttpRequest();
        xhr.open('DELETE', `admin/files/${sid}/${key}`);
        xhr.setRequestHeader('x-passwd', this.password);
        xhr.onload = () => {
          if (xhr.status === 204) {
            const bucket = this.db[sid];
            const idx = bucket.findIndex(f => f.key === key);
            if (idx !== -1) bucket.splice(idx, 1);
            if (bucket.length === 0) this.$delete(this.db, sid);
            this.expandDb();
          } else {
            this.error = `${xhr.status} ${xhr.statusText}: ${xhr.responseText}`;
          }
        };
        xhr.onerror = () => {
          this.error = 'Network error while deleting the file.';
        };
        xhr.send();
      },

      showData(file) {
        this.dataFile = file;
        this.geoInfo = null;
        const ip = file.metadata.uploaderIp;
        if (!ip) return;
        this.geoLoading = true;
        const xhr = new XMLHttpRequest();
        xhr.open('GET', `admin/geoip/${encodeURIComponent(ip)}`);
        xhr.setRequestHeader('x-passwd', this.password);
        xhr.onload = () => {
          this.geoLoading = false;
          try {
            this.geoInfo = JSON.parse(xhr.responseText);
          } catch (e) {
            this.geoInfo = { error: true };
          }
        };
        xhr.onerror = () => {
          this.geoLoading = false;
          this.geoInfo = { error: true };
        };
        xhr.send();
      },

      isImage(file) {
        return !!(file && file.metadata && /^image\//.test(file.metadata.type || ''));
      },

      async showExif(file) {
        this.exifFile = file;
        this.exifEntries = [];
        this.exifError = '';
        this.exifLoading = true;
        try {
          const response = await fetch(file.url);
          if (!response.ok) throw new Error(`Unable to read image (${response.status})`);
          const metadata = await exifr.parse(await response.blob());
          this.exifEntries = Object.keys(metadata || {})
            .sort()
            .map(key => ({ key, value: this.formatExifValue(metadata[key]) }));
        } catch (e) {
          this.exifError = e.message || 'Unable to read image metadata.';
        } finally {
          this.exifLoading = false;
        }
      },

      formatExifValue(value) {
        if (value instanceof Date) return value.toISOString();
        if (Array.isArray(value)) return value.map(item => this.formatExifValue(item)).join(', ');
        if (value && typeof value === 'object') return JSON.stringify(value);
        if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'unknown';
        return String(value);
      },

      closeExif() {
        this.exifFile = null;
        this.exifEntries = [];
        this.exifError = '';
      },

      closeData() {
        this.dataFile = null;
        this.geoInfo = null;
      },

      fetchVisitors() {
        this.visitorsLoading = true;
        const xhr = new XMLHttpRequest();
        xhr.open('GET', 'admin/visitors.json');
        xhr.setRequestHeader('x-passwd', this.password);
        xhr.onload = () => {
          this.visitorsLoading = false;
          if (xhr.status === 200) {
            try {
              const data = JSON.parse(xhr.responseText);
              this.visitors = data.visitors || [];
              this.visitorsLoaded = true;
            } catch (e) {
              this.error = 'Error parsing visitors: ' + e.message;
            }
          } else {
            this.error = `Visitors: ${xhr.status} ${xhr.statusText}`;
          }
        };
        xhr.onerror = () => { this.visitorsLoading = false; };
        xhr.send();
      },

      showVisitorDetail(v) {
        this.detailVisitor = { info: v, files: [], events: [] };
        if (!v.trackerId) return;
        const xhr = new XMLHttpRequest();
        xhr.open('GET', 'admin/visitors.json?tid=' + encodeURIComponent(v.trackerId));
        xhr.setRequestHeader('x-passwd', this.password);
        xhr.onload = () => {
          try {
            const data = JSON.parse(xhr.responseText);
            this.detailVisitor = {
              info: data.visitor || v,
              files: (data.files || []).slice(0, 200).reverse(),
              events: (data.events || []).slice().reverse()
            };
          } catch (e) {
            this.error = e.message;
          }
        };
        xhr.send();
      },

      closeVisitorDetail() {
        this.detailVisitor = null;
      },

      parseUserAgent(ua) {
        if (!ua) return { browser: 'unknown', os: 'unknown' };

        let os = 'unknown';
        if (/Windows NT 10/.test(ua)) os = 'Windows 10/11';
        else if (/Windows NT 6\.3/.test(ua)) os = 'Windows 8.1';
        else if (/Windows NT 6\.1/.test(ua)) os = 'Windows 7';
        else if (/Windows/.test(ua)) os = 'Windows';
        else if (/Android/.test(ua)) {
          const m = ua.match(/Android (\d+(\.\d+)?)/);
          os = m ? `Android ${m[1]}` : 'Android';
        } else if (/iPhone|iPad|iPod/.test(ua)) {
          const m = ua.match(/OS (\d+[_.]\d+)/);
          os = m ? `iOS ${m[1].replace('_', '.')}` : 'iOS';
        } else if (/Mac OS X/.test(ua)) {
          const m = ua.match(/Mac OS X (\d+[_.]\d+)/);
          os = m ? `macOS ${m[1].replace('_', '.')}` : 'macOS';
        } else if (/Linux/.test(ua)) os = 'Linux';

        let browser = 'unknown';
        let m;
        if ((m = ua.match(/Edg\/([\d.]+)/))) browser = `Edge ${m[1]}`;
        else if ((m = ua.match(/OPR\/([\d.]+)/))) browser = `Opera ${m[1]}`;
        else if ((m = ua.match(/Firefox\/([\d.]+)/))) browser = `Firefox ${m[1]}`;
        else if (/Chrome\//.test(ua) && !/Chromium/.test(ua) && (m = ua.match(/Chrome\/([\d.]+)/))) browser = `Chrome ${m[1]}`;
        else if (/Safari\//.test(ua) && (m = ua.match(/Version\/([\d.]+)/))) browser = `Safari ${m[1]}`;

        return { browser, os };
      },

    },


  }
</script>

<style>
  .bucket {
    cursor: pointer;
  }
  .expanded {
    background: #fafafa;
  }
  .expanded .bucket td {
    font-weight: bold;
  }
  tfoot {
    font-weight: bold;
  }
  .expired-badge {
    margin-left: 6px;
    vertical-align: middle;
  }
  .data-modal-backdrop {
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0,0,0,0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }
  .data-modal {
    background: #fff;
    border-radius: 4px;
    padding: 20px 24px;
    max-width: 480px;
    width: 90%;
    position: relative;
    box-shadow: 0 4px 20px rgba(0,0,0,0.3);
  }
  .exif-modal {
    max-height: 90vh;
    overflow-y: auto;
  }
  .exif-modal th {
    width: 35%;
  }
  .data-modal-close {
    position: absolute;
    top: 10px;
    right: 10px;
  }
  .dl-horizontal dt {
    width: 130px;
  }
  .dl-horizontal dd {
    margin-left: 140px;
  }
  .text-break {
    word-break: break-all;
  }
  .btn-admin-switch {
    margin: 8px 0 14px;
  }
  .visitor-modal-backdrop {
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0,0,0,0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }
  .visitor-modal-backdrop .data-modal {
    max-width: 640px;
    max-height: 90vh;
    overflow-y: auto;
  }
  .visitor-evt {
    margin-left: 10px;
    color: #555;
  }
</style>
