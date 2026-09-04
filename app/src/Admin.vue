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
      table.table.table-hover
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
                  a.btn.btn-xs.btn-danger(@click="deleteFile(file)", title="Permanently delete this file")
                    icon.fa-fw(name="trash")
        tfoot
          tr
            td(colspan="3")
            td.text-right(colspan="2") Sum: {{ humanFileSize(sizeSum) }}
            td

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

</template>


<script>
  import 'vue-awesome/icons/exclamation-triangle';
  import 'vue-awesome/icons/sync-alt';
  import 'vue-awesome/icons/sign-in-alt';
  import 'vue-awesome/icons/key';
  import 'vue-awesome/icons/download';
  import 'vue-awesome/icons/trash';
  import 'vue-awesome/icons/info-circle';


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
        dataFile: null,
        geoInfo: null,
        geoLoading: false
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

      closeData() {
        this.dataFile = null;
        this.geoInfo = null;
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
</style>
