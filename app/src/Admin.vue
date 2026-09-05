<template lang="pug">
  .admin-shell
    transition(name="fade")
      .error-banner(v-show="error")
        icon.fa-fw(name="exclamation-triangle")
        span  {{ error }}
        a.banner-close(@click="error=''") ×

    .login-card(v-if='!loggedIn')
      .login-inner
        h2
          svg.fa-icon(role='presentation' viewbox='0 0 1920 1792' style='fill:#2563eb')
            path(d='M1280 864q0-14-9-23l-352-352q-9-9-23-9t-23 9l-351 351q-10 12-10 24 0 14 9 23t23 9h224v352q0 13 9.5 22.5t22.5 9.5h192q13 0 22.5-9.5t9.5-22.5v-352h224q13 0 22.5-9.5t9.5-22.5zM1920 1152q0 159-112.5 271.5t-271.5 112.5h-1088q-185 0-316.5-131.5t-131.5-316.5q0-130 70-240t188-165q-2-30-2-43 0-212 150-362t362-150q156 0 285.5 87t188.5 231q71-62 166-62 106 0 181 75t75 181q0 76-41 138 130 31 213.5 135.5t83.5 238.5z')
          span  PsiTransfer Admin
        p.sub-txt Accès complet — fichiers, expiration douce, tracking
        form(@submit.stop.prevent="login")
          .field
            label Mot de passe
            input.form-control(type='password', v-model='password', autofocus, placeholder='••••••••')
          p.error-txt(v-show='passwordWrong') Accès refusé — mot de passe incorrect.
          button.btn.btn-primary.btn-block(type="submit", :disabled="!password")
            icon.fa-fw(name="sign-in-alt")
            span  Se connecter

    template(v-else)
      header.dash-head
        .dash-title
          h1
            span.lock-dot
            PsiTransfer Admin
          p.sub-txt Accès complet — fichiers, expiration douce, tracking cross-session
        .dash-actions
          button.btn.btn-ghost(@click="refreshAll", :title="'Actualiser'")
            icon.fa-fw(name="sync-alt", :class="{'spin': refreshing}")
            span  Actualiser

      section.stat-grid
        .stat-card
          .stat-icon.blue
            icon(name="database")
          .stat-body
            b {{ stats.files }}
            span Fichiers
          .stat-sub
            span {{ humanFileSize(stats.size) }}
        .stat-card
          .stat-icon.indigo
            icon(name="folder-open")
          .stat-body
            b {{ stats.buckets }}
            span Sessions
          .stat-sub
            span {{ stats.bucketsActive }} actives · {{ stats.bucketsExpired }} expirées
        .stat-card
          .stat-icon.green
            icon(name="users")
          .stat-body
            b {{ stats.visitors }}
            span Visiteurs suivis
          .stat-sub
            span {{ stats.uploads }} uploads · {{ stats.downloads }} téléch.
        .stat-card
          .stat-icon.amber
            icon(name="clock-o")
          .stat-body
            b {{ stats.visits }}
            span Vues de page
          .stat-sub
            span dernière {{ ago(stats.lastSeen) }}
        .stat-card
          .stat-icon.red
            icon(name="expired")
          .stat-body
            b {{ stats.expired }}
            span Fichiers expirés
          .stat-sub
            span toujours en admin

      nav.tabbar
        button.tab(:class="{active: tab==='files'}", @click="tab='files'")
          icon.fa-fw(name="file")
          span  Fichiers
          b.cnt {{ filesCount }}
        button.tab(:class="{active: tab==='visitors'}", @click="tab='visitors'; if(!visitorsLoaded) fetchVisitors()")
          icon.fa-fw(name="users")
          span  Visiteurs
          b.cnt {{ visitors.length }}
        .tabbar-spacer

      .toolbar
        .search-box
          icon(name="search")
          input(type="text", :placeholder="tab==='files' ? 'Rechercher : SID, fichier, IP, tracker…' : 'Rechercher un visiteur (ID, IP, UA)…'", v-model="search")
        .filters(v-if="tab==='files'")
          button.filter-pill(v-for="f in statusFilters", :key="f.key", :class="{active: status===f.key}", @click="status=f.key")
            span.dot(:class="'dot-'+f.key")
            span  {{ f.label }}
        select.sort-select(v-if="tab==='files'", v-model="sort")
          option(value="newest") Plus récents
          option(value="oldest") Plus anciens
          option(value="size") Plus gros d'abord
          option(value="name") Nom A→Z

      section.files-view(v-if="tab==='files'")
        .empty-state(v-if="!buckets.length")
          icon(name="inbox")
          p Aucun fichier ne correspond.
        .bucket-card(v-for="bucket in buckets", :key="bucket.sid")
          .bucket-head(@click="toggleExpand(bucket.sid)")
            .bucket-info
              button.expand-btn(:class="{rotated: expanded===bucket.sid}")
                icon.fa-fw(name="chevron-right")
              .sid-box
                code.sid {{ bucket.sid }}
                span.badges
                  span.badge.lock(v-if="bucket.password", :title="'Protégé par mot de passe'")
                    icon.fa-fw(name="lock")
                    |  protégé
                  span.badge.expire(v-if="bucket.anyOneTime", :title="'Fichier à usage unique'")
                    icon.fa-fw(name="hourglass")
                    |  1 usage
                  span.badge.expired-badge(v-if="bucket.expiredAll", :title="'Tous les fichiers sont expirés'")
                    icon.fa-fw(name="ban")
                    |  expiré
            .bucket-contact(v-if="bucket.email")
              span.contact-chip
                icon.fa-fw(name="envelope")
                span  {{ bucket.email }}
            .bucket-count
              span {{ bucket.filteredFiles.length }} fichier(s)
          .bucket-meta
            .meta-item
              span.k Créé
              span.v {{ ago(bucket.created) }}
            .meta-item
              span.k Dern. téléch.
              span.v {{ bucket.lastDownload ? ago(bucket.lastDownload) : '—' }}
            .meta-item
              span.k Expire
              span.v {{ bucket.expireLabel }}
            .meta-item
              span.k Taille
              span.v {{ humanFileSize(bucket.size) }}
            .meta-item.link-meta
              a.copy-link(@click.stop.prevent="copyText(shareUrl(bucket.sid))", :title="'Copier le lien public'")
                icon.fa-fw(name="link")
                |  copier le lien
          .file-list(v-if="expanded===bucket.sid")
            .file-row(v-for="file in bucket.filteredFiles", :key="file.key", :class="{'is-expired': file._status==='expired'}")
              .file-main
                .file-ico
                  file-icon(:file="file")
                .file-txt
                  .file-name
                    strong {{ file.metadata.name }}
                    span.fsize  {{ humanFileSize(file.size) }}
                  .file-line
                    span.pill(:class="'pill-'+file._status")
                      template(v-if="file._status==='expired'") expiré
                      template(v-else-if="file._status==='one-time'") 1 usage
                      template(v-else) actif
                    template(v-if="file.metadata.email")
                      span.contact-chip.sm
                        icon.fa-fw(name="envelope")
                        span  {{ file.metadata.email }}
                    span.sep ·
                    span.muted  créé {{ ago(file.metadata.createdAt) }}
                    span.sep ·
                    span.muted  dl {{ file.metadata.lastDownload ? ago(file.metadata.lastDownload) : '—' }}
                    template(v-if="file._expireDate")
                      span.sep ·
                      span.muted  expire {{ ago(file._expireDate) }}
                    span.badge.lock-sm(v-if="file.metadata._password", :title="'Protégé par mot de passe'")
                      icon.fa-fw(name="lock")
                .tracker-chip(v-if="file.metadata.trackerId", @click="openVisitorFromFile(file)", :title="'Voir ce visiteur'")
                  icon.fa-fw(name="user")
                  span  {{ shortId(file.metadata.trackerId) }}
                  span.chip-meta  {{ parseUserAgent(file.metadata.uploaderUserAgent).browserShort }}
                .tracker-chip.untracked(v-else, :title="'Non suivi (upload antérieur au tracking)'")
                  icon.fa-fw(name="user-slash")
                  span  non suivi
              .file-actions
                a.btn-icon(@click="showData(file)", :title="'Infos uploader & tracking'")
                  icon.fa-fw(name="info-circle")
                a.btn-icon(v-if="isImage(file)", @click="showExif(file)", :title="'EXIF / GPS'")
                  icon.fa-fw(name="camera")
                a.btn-icon.dl(v-if="file.url", :href="file.url", target="_blank", :title="'Téléchargement admin (contourne mdp + expiration)'")
                  icon.fa-fw(name="download")
                a.btn-icon.danger(@click="openDelete(file)", :title="'Supprimer définitivement'")
                  icon.fa-fw(name="trash")
        .sum-row
          span  Totaux
          span.big  {{ buckets.length }} sessions · {{ stats.files }} fichiers
          span.big  {{ humanFileSize(stats.size) }}

      section.visitors-view(v-if="tab==='visitors'")
        .empty-state(v-if="visitorsLoading")
          icon(name="spinner", spin="")
          p Chargement des visiteurs…
        .empty-state(v-else-if="!filteredVisitors.length")
          icon(name="users")
          p Aucun visiteur pour le moment.
        .visitor-card(v-for="v in filteredVisitors", :key="v.trackerId || v.ip", :class="{'untracked': !v.tracked}")
          .visitor-main
            .visitor-ident
              .tracker-id
                icon.fa-fw(name="id-card")
                code {{ v.trackerId || v.ip || '(inconnu)' }}
                button.copy-btn(@click.stop.prevent="copyText(v.trackerId || '')", :title="'Copier l\\'ID'")
                  icon.fa-fw(name="copy")
              .visitor-contact(v-if="v.email")
                span.contact-chip
                  icon.fa-fw(name="envelope")
                  span  {{ v.email }}
              .visitor-meta
                span.pill(:class="v.tracked ? 'pill-active' : 'pill-untracked'")
                  | {{ v.tracked ? 'suivi cross-session' : 'non suivi' }}
                span.sep ·
                span.muted  {{ parseUserAgent(v.ua).device }} — {{ parseUserAgent(v.ua).browser }}
                template(v-if="parseUserAgent(v.ua).os !== 'unknown'")
                  span.sep ·
                  span.muted  {{ parseUserAgent(v.ua).os }}
              .visitor-geo(v-if="v.ip")
                span.muted  ip&nbsp;
                code.ip {{ v.ip }}
                a.geo-btn(@click.stop.prevent="lookupGeo(v.ip).then(setVisitorGeo(v))", :title="'Localisation approx.'")
                  icon.fa-fw(name="globe")
                span.geo-result(v-if="v._geo")  {{ v._geo }}
            .visitor-stats
              .vs
                b {{ v.uploads }}
                span uploads
              .vs
                b {{ v.files }}
                span fichiers
              .vs
                b {{ v.visits }}
                span vues
              .vs
                b {{ v.downloads }}
                span téléch.
              .vs
                b {{ humanFileSize(v.size) }}
                span volume
            .visitor-times
              .meta-item
                span.k 1re activité
                span.v  {{ ago(v.firstSeen) }}
              .meta-item
                span.k Dernière activité
                span.v  {{ ago(v.lastSeen) }}
          .visitor-foot
            a.btn-view(@click="showVisitor(v)")
              icon.fa-fw(name="eye")
              span  Détails & historique
            template(v-if="v.tz")
              span.muted.chip-detail  fuseau : {{ v.tz }}
            template(v-if="v.lang")
              span.muted.chip-detail  lang : {{ (v.lang || '').split(',')[0] }}
            template(v-if="v.screen")
              span.muted.chip-detail  écran : {{ v.screen }}
            template(v-if="v.fp")
              span.muted.chip-detail.fp  fp : {{ v.fp }}

    // ---- Info uploader / tracking modal ----
    .adm-backdrop(v-if="dataFile", @click.self="closeData")
      .adm-modal.info-modal
        a.adm-close(@click="closeData") ×
        h3
          icon.fa-fw(name="info-circle")
          span  Fichier
        div.file-title
          strong {{ dataFile.metadata.name }}
          span.size  {{ humanFileSize(dataFile.size) }}
        .pill-row
          span.pill(:class="'pill-'+dataFile._status")
            template(v-if="dataFile._status==='expired'") expiré
            template(v-else-if="dataFile._status==='one-time'") 1 usage
            template(v-else) actif
          span.pill.pill-socket(v-if="dataFile.metadata.sid")  sid {{ dataFile.metadata.sid }}
          span.pill.pill-type(v-if="dataFile.metadata.type")  {{ dataFile.metadata.type }}
        .info-grid
          .info-block
            h4
              icon.fa-fw(name="user")
              span  Uploader
            dl
              dt E-mail
              dd
                template(v-if="dataFile.metadata.email")
                  a.mailto(:href="'mailto:'+dataFile.metadata.email") {{ dataFile.metadata.email }}
                template(v-else) —
              dt IP
              dd
                code {{ dataFile.metadata.uploaderIp || 'inconnue' }}
                a.geo-btn(@click="lookupGeo(dataFile.metadata.uploaderIp).then(geo => geoInfo = geo)", :title="'Localisation'")
                  icon.fa-fw(name="globe")
              dt Localisation
              dd
                template(v-if="geoLoading") recherche…
                template(v-else-if="geoInfo && geoInfo.private") réseau privé/local
                template(v-else-if="geoInfo && geoInfo.city") {{ geoInfo.city }}, {{ geoInfo.regionName }}, {{ geoInfo.country }}
                template(v-else-if="geoInfo && geoInfo.error") échec de la recherche
                template(v-else) —
              dt FAI / ISP
              dd {{ (geoInfo && geoInfo.isp) || '—' }}
              dt Navigateur
              dd {{ parseUserAgent(dataFile.metadata.uploaderUserAgent).browser }}
              dt Système
              dd {{ parseUserAgent(dataFile.metadata.uploaderUserAgent).os }} ({{ parseUserAgent(dataFile.metadata.uploaderUserAgent).device }})
              dt Langue
              dd {{ (dataFile.metadata.uploaderLang || '').split(',')[0] || 'inconnue' }}
              dt Fuseau
              dd {{ dataFile.metadata.timezone || 'inconnu' }}
          .info-block.tracking
            h4
              icon.fa-fw(name="users")
              span  Tracking cross-session
            dl
              dt ID visiteur
              dd.code-cell
                template(v-if="dataFile.metadata.trackerId")
                  code {{ dataFile.metadata.trackerId }}
                  button.copy-btn(@click="copyText(dataFile.metadata.trackerId)", :title="'Copier'")
                    icon.fa-fw(name="copy")
                template(v-else) non suivi
              dt Visites cumulées
              dd {{ dataFile.metadata.visitCount || '—' }}
              dt Empreinte (fp)
              dd.code-cell
                code.mono-small {{ dataFile.metadata.fingerprint || '—' }}
              dt Écran
              dd {{ dataFile.metadata.screen || '—' }}
              dt Commentaire
              dd {{ dataFile.metadata.comment || '—' }}
            .tracking-actions
              a.btn-secondary(@click="openVisitorFromFile(dataFile)")
                icon.fa-fw(name="users")
                span  Voir l'historique du visiteur
          .info-block.small
            h4
              icon.fa-fw(name="clock")
              span  Horodatages
            dl
              dt Créé
              dd {{ fmt(dataFile.metadata.createdAt) }} ({{ ago(dataFile.metadata.createdAt) }})
              dt Dern. téléch.
              dd {{ dataFile.metadata.lastDownload ? fmt(dataFile.metadata.lastDownload) + ' (' + ago(dataFile.metadata.lastDownload) + ')' : '—' }}
              dt Expiration
              dd
                template(v-if="dataFile._status==='expired'") expiré
                template(v-else-if="dataFile._status==='one-time'") après 1 téléch.
                template(v-else-if="dataFile._expireDate") {{ fmt(dataFile._expireDate) }} ({{ ago(dataFile._expireDate) }})
                template(v-else) —
        .adm-actions
          a.btn-secondary(v-if="dataFile.url", :href="dataFile.url", target="_blank")
            icon.fa-fw(name="download")
            span  Télécharger (admin)
          a.btn-link(v-if="dataFile.metadata.sid", :href="shareUrl(dataFile.metadata.sid)", target="_blank") lien public

    // ---- EXIF modal ----
    .adm-backdrop(v-if="exifFile", @click.self="closeExif")
      .adm-modal.exif-modal
        a.adm-close(@click="closeExif") ×
        h3
          icon.fa-fw(name="camera")
          span  Métadonnées EXIF
        p.text-muted(v-if="exifLoading") Lecture des métadonnées…
        p.error-txt(v-else-if="exifError") {{ exifError }}
        p.text-muted(v-else-if="!exifEntries.length") Aucune métadonnée EXIF trouvée.
        table.exif-table(v-else)
          tbody
            tr(v-for="entry in exifEntries", :key="entry.key")
              th {{ entry.key }}
              td.text-break {{ entry.value }}

    // ---- Visitor detail modal ----
    .adm-backdrop(v-if="detailFile", @click.self="closeDetail")
      .adm-modal.wide-modal
        a.adm-close(@click="closeDetail") ×
        template(v-if="detailLoading")
          p Chargement…
        template(v-else-if="detailView")
          h3
            icon.fa-fw(name="id-card")
            span  Visiteur
          div.tracker-id.big
            code {{ detailView.trackerId || '—' }}
            button.copy-btn(@click="copyText(detailView.trackerId || '')", :title="'Copier'")
              icon.fa-fw(name="copy")
          .visitor-contact(v-if="detailView.email")
            span.contact-chip
              icon.fa-fw(name="envelope")
              span  {{ detailView.email }}
          .detail-stats
            .vs
              b {{ detailView.uploads }}
              span uploads
            .vs
              b {{ detailView.files }}
              span fichiers
            .vs
              b {{ detailView.visits }}
              span vues
            .vs
              b {{ detailView.downloads }}
              span téléch.
            .vs
              b {{ humanFileSize(detailView.size) }}
              span volume
          .two-col
            .info-block
              h4 Enrichissement
              dl
                dt IP
                dd
                  code {{ detailView.ip || '—' }}
                  a.geo-btn(@click="lookupGeo(detailView.ip).then(geo => detailGeo = geo)", :title="'Localisation'")
                    icon.fa-fw(name="globe")
                  span.geo-result(v-if="detailGeo && detailGeo.city")  {{ detailGeo.city }}, {{ detailGeo.regionName }}, {{ detailGeo.country }}
                  span.geo-result(v-else-if="detailGeo && detailGeo.private")  réseau privé
                  span.geo-result(v-else-if="detailGeo && detailGeo.error")  échec lookup
                dt Navigateur
                dd {{ parseUserAgent(detailView.ua).browser }} — {{ parseUserAgent(detailView.ua).os }} ({{ parseUserAgent(detailView.ua).device }})
                dt Langue / Fuseau
                dd {{ (detailView.lang || '—').split(',')[0] }} · {{ detailView.tz || '—' }}
                dt Écran
                dd {{ detailView.screen || '—' }}
                dt Empreinte
                dd.code-cell
                  code.mono-small {{ detailView.fp || '—' }}
            .info-block
              h4 Fichiers liés ({{ detailFiles.length }})
              ul.file-list-mini
                li(v-for="f in detailFiles", :key="f.sid + f.key", :class="{expired: f.expired}")
                  span.dot-status(:class="{red: f.expired}")
                  span.fname {{ f.name }}
                  span.fmeta  {{ humanFileSize(f.size) }} · {{ ago(f.createdAt) }}
          .info-block
            h4 Historique des événements ({{ detailEvents.length }})
            .timeline
              .evt(v-for="e in detailEvents", :key="e.ts + e.kind + (e.file || '')")
                span.evt-time  {{ fmt(e.ts) }}
                span.evt-kind(:class="'kind-'+e.kind")  {{ eventKindLabel(e) }}
                span.evt-detail  {{ e.file || '' }} {{ e.sid ? '[' + e.sid + ']' : '' }}

    // ---- Delete confirm modal ----
    .adm-backdrop(v-if="deleteTarget", @click.self="closeDelete")
      .adm-modal.confirm-modal
        a.adm-close(@click="closeDelete") ×
        h3
          icon.fa-fw(name="trash")
          span  Supprimer définitivement
        p.confirm-txt
          | Le fichier <strong>{{ deleteTarget.metadata.name }}</strong> ({{ humanFileSize(deleteTarget.size) }})
          | sera supprimé du disque. Cette action est irréversible.
        .adm-actions.center
          button.btn-ghost(@click="closeDelete") Annuler
          button.btn-danger(@click="confirmDelete")
            icon.fa-fw(name="trash")
            span  Oui, supprimer
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
  import 'vue-awesome/icons/search';
  import 'vue-awesome/icons/users';
  import 'vue-awesome/icons/user';
  import 'vue-awesome/icons/user-slash';
  import 'vue-awesome/icons/id-card';
  import 'vue-awesome/icons/database';
  import 'vue-awesome/icons/folder-open';
  import 'vue-awesome/icons/file';
  import 'vue-awesome/icons/clock';
  import 'vue-awesome/icons/lock';
  import 'vue-awesome/icons/hourglass';
  import 'vue-awesome/icons/ban';
import 'vue-awesome/icons/link';
  import 'vue-awesome/icons/globe';
  import 'vue-awesome/icons/copy';
  import 'vue-awesome/icons/chevron-right';
  import 'vue-awesome/icons/eye';
  import 'vue-awesome/icons/spinner';
  import 'vue-awesome/icons/inbox';
  import exifr from 'exifr';
  import FileIcon from './common/FileIcon.vue';


  export default {
    name: 'AdminApp',
    components: { FileIcon },

    data () {
      return {
        db: {},
        loggedIn: false,
        password: '',
        error: '',
        passwordWrong: false,
        refreshing: false,
        tab: 'files',
        search: '',
        status: 'all',
        sort: 'newest',
        expanded: false,
        sizeSum: 0,
        dataFile: null,
        geoInfo: null,
        geoLoading: false,
        detailFile: null,
        detailView: null,
        detailFiles: [],
        detailEvents: [],
        detailGeo: null,
        detailLoading: false,
        exifFile: null,
        exifEntries: [],
        exifLoading: false,
        exifError: '',
        deleteTarget: null,
        deleting: false,
        visitors: [],
        visitorsTotals: { visits: 0, downloads: 0, uploads: 0 },
        visitorsLoaded: false,
        visitorsLoading: false
      }
    },

    computed: {
      statusFilters() {
        return [
          { key: 'all', label: 'Tous' },
          { key: 'active', label: 'Actifs' },
          { key: 'expired', label: 'Expirés' },
          { key: 'one-time', label: '1 usage' },
          { key: 'password', label: 'Protégés' }
        ];
      },

      allFiles() {
        const out = [];
        Object.keys(this.db).forEach(sid => this.db[sid].forEach(f => out.push(f)));
        return out;
      },

      filesCount() {
        return this.buckets.reduce((n, b) => n + b.filteredFiles.length, 0);
      },

      stats() {
        const files = this.allFiles;
        const size = files.reduce((n, f) => n + (f.size || 0), 0);
        const expired = files.filter(f => f.metadata && f.metadata.expired).length;
        const visitors = this.visitors.filter(v => v.tracked);
        let lastSeen = 0;
        visitors.forEach(v => { if (v.lastSeen > lastSeen) lastSeen = v.lastSeen; });
        return {
          files: files.length,
          size: size,
          buckets: Object.keys(this.db).length,
          bucketsActive: this.buckets.filter(b => !b.expiredAll).length,
          bucketsExpired: this.buckets.filter(b => b.expiredAll).length,
          expired: expired,
          visitors: this.visitors.length,
          uploads: this.visitorsTotals.uploads || this.visitors.reduce((n, v) => n + v.uploads, 0),
          downloads: this.visitorsTotals.downloads || 0,
          visits: this.visitorsTotals.visits || 0,
          lastSeen
        };
      },

      buckets() {
        const out = [];
        Object.keys(this.db).forEach(sid => {
          const bucket = {
            sid,
            email: '',
            files: [],
            filteredFiles: [],
            size: 0,
            created: null,
            lastDownload: 0,
            firstExpire: null,
            password: false,
            anyOneTime: false,
            expiredAll: true,
            expireLabel: '—'
          };
          this.db[sid].forEach(file => {
            const m = file.metadata || {};
            const size = file.size || 0;
            bucket.size += size;
            const c = +m.createdAt || 0;
            if (c && (!bucket.created || c < bucket.created)) bucket.created = c;
            const ld = +m.lastDownload || 0;
            if (ld > bucket.lastDownload) bucket.lastDownload = ld;
            if (m._password) bucket.password = true;
            if (m.email && !bucket.email) bucket.email = m.email;

            if (m.expired) {
              file._status = 'expired';
              file._expireDate = null;
            } else if (m.retention === 'one-time') {
              file._status = 'one-time';
              file._expireDate = null;
              bucket.anyOneTime = true;
            } else {
              file._status = 'active';
              const exp = c ? c + (+m.retention * 1000) : null;
              file._expireDate = exp;
              if (exp && (!bucket.firstExpire || exp < bucket.firstExpire)) bucket.firstExpire = exp;
              bucket.expiredAll = false;
            }

            if (file._status !== 'expired') bucket.expiredAll = false;
            bucket.files.push(file);
          });

          bucket.filteredFiles = bucket.files
            .filter(f => this.fileMatches(f))
            .sort((a, b) => (+(b.metadata.createdAt) || 0) - (+(a.metadata.createdAt) || 0));

          if (bucket.expiredAll) bucket.expireLabel = 'expiré';
          else if (bucket.anyOneTime) bucket.expireLabel = '1 usage';
          else if (bucket.firstExpire) bucket.expireLabel = this.ago(bucket.firstExpire);

          out.push(bucket);
        });

        out.sort((a, b) => {
          switch (this.sort) {
            case 'oldest': return (a.created || 0) - (b.created || 0);
            case 'size': return b.size - a.size;
            case 'name': return a.sid.localeCompare(b.sid);
            default: return (b.created || 0) - (a.created || 0);
          }
        });
        return out.filter(b => b.filteredFiles.length > 0);
      },

      filteredVisitors() {
        const q = this.search.toLowerCase().trim();
        const list = this.visitors.slice().sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
        if (!q) return list;
        return list.filter(v =>
          (v.trackerId || '').toLowerCase().includes(q) ||
          (v.email || '').toLowerCase().includes(q) ||
          (v.ip || '').includes(q) ||
          (v.ua || '').toLowerCase().includes(q) ||
          (v.tz || '').toLowerCase().includes(q)
        );
      }
    },

    methods: {
      fileMatches(file) {
        const m = file.metadata || {};
        if (this.status === 'password' && !m._password) return false;
        if (this.status === 'active' && file._status !== 'active') return false;
        if (this.status === 'expired' && file._status !== 'expired') return false;
        if (this.status === 'one-time' && file._status !== 'one-time') return false;

        if (this.search) {
          const q = this.search.toLowerCase();
          const hay = [
            m.name, m.sid, file.key, m.uploaderIp, m.trackerId || '', m.email || '',
            this.parseUserAgent(m.uploaderUserAgent).browser,
            this.parseUserAgent(m.uploaderUserAgent).os
          ].join(' ').toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      },

      toggleExpand(sid) {
        this.expanded = this.expanded === sid ? false : sid;
      },

      shareUrl(sid) {
        return document.head.getElementsByTagName('base')[0].href + sid;
      },

      login() {
        if (!this.password) return;
        const xhr = new XMLHttpRequest();
        xhr.open('GET', 'admin/data.json');
        xhr.setRequestHeader("x-passwd", this.password);
        xhr.onload = () => {
          if (xhr.status === 200) {
            try {
              this.db = JSON.parse(xhr.responseText);
              this.loggedIn = true;
              this.error = '';
              this.passwordWrong = false;
              this.visitorsLoaded = false;
            }
            catch (e) {
              this.error = e.toString();
            }
          } else {
            if (xhr.status === 403) this.passwordWrong = true;
            else this.error = `${xhr.status} ${xhr.statusText}: ${xhr.responseText}`;
          }
        };
        xhr.send();
      },

      refreshAll() {
        this.refreshing = true;
        const done = () => { this.refreshing = false; };
        this.login();
        this.fetchVisitors().then(done, done);
      },

      fetchVisitors() {
        return new Promise((resolve) => {
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
                this.visitorsTotals = data.totals || {};
                this.visitorsLoaded = true;
              } catch (e) {
                this.error = 'Erreur de parsing visiteurs: ' + e.message;
              }
            } else {
              this.error = `Visiteurs: ${xhr.status} ${xhr.statusText}`;
            }
            resolve();
          };
          xhr.onerror = () => { this.visitorsLoading = false; this.error = 'Erreur réseau visiteurs.'; resolve(); };
          xhr.send();
        });
      },

      showVisitor(v) {
        this.detailFile = true;
        this.detailView = null;
        this.detailFiles = [];
        this.detailEvents = [];
        this.detailGeo = null;
        this.detailLoading = true;
        const q = v.trackerId ? '?tid=' + encodeURIComponent(v.trackerId) : '';
        const xhr = new XMLHttpRequest();
        xhr.open('GET', 'admin/visitors.json' + q);
        xhr.setRequestHeader('x-passwd', this.password);
        xhr.onload = () => {
          this.detailLoading = false;
          try {
            const data = JSON.parse(xhr.responseText);
            this.detailView = data.visitor || v;
            this.detailFiles = (data.files || []).slice(0, 200).reverse();
            this.detailEvents = (data.events || []).slice().reverse();
          } catch (e) {
            this.error = e.message;
          }
        };
        xhr.send();
      },

      openVisitorFromFile(file) {
        const tid = file.metadata && file.metadata.trackerId;
        if (!tid) return;
        const match = this.visitors.find(v => v.trackerId === tid);
        if (match) {
          this.closeData();
          this.closeExif();
          this.showVisitor(match);
        } else {
          this.fetchVisitors().then(() => {
            const m2 = this.visitors.find(v => v.trackerId === tid);
            if (m2) {
              this.closeData();
              this.closeExif();
              this.showVisitor(m2);
            }
          });
        }
      },

      closeDetail() { this.detailFile = false; this.detailView = null; },

      lookupGeo(ip) {
        return new Promise((resolve) => {
          if (!ip) return resolve(null);
          const xhr = new XMLHttpRequest();
          xhr.open('GET', 'admin/geoip/' + encodeURIComponent(ip));
          xhr.setRequestHeader('x-passwd', this.password);
          xhr.onload = () => {
            try { resolve(JSON.parse(xhr.responseText)); }
            catch (e) { resolve({ error: true }); }
          };
          xhr.onerror = () => resolve({ error: true });
          xhr.send();
        });
      },

      setVisitorGeo(v) {
        return (geo) => { this.$set(v, '_geo', geo && geo.city ? `${geo.city}, ${geo.regionName}, ${geo.country}` : (geo && geo.private ? 'réseau privé' : (geo && geo.error ? 'échec' : ''))); };
      },

      showData(file) {
        this.dataFile = file;
        this.geoInfo = null;
        this.geoLoading = true;
        this.lookupGeo(file.metadata.uploaderIp).then(geo => {
          this.geoLoading = false;
          this.geoInfo = geo;
        });
      },

      closeData() { this.dataFile = null; this.geoInfo = null; },

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
          if (!response.ok) throw new Error(`Impossible de lire l'image (${response.status})`);
          const metadata = await exifr.parse(await response.blob());
          this.exifEntries = Object.keys(metadata || {})
            .sort()
            .map(key => ({ key, value: this.formatExifValue(metadata[key]) }));
        } catch (e) {
          this.exifError = e.message || 'Impossible de lire les métadonnées.';
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

      closeExif() { this.exifFile = null; this.exifEntries = []; this.exifError = ''; },

      openDelete(file) {
        this.deleteTarget = file;
      },

      closeDelete() {
        this.deleteTarget = null;
        this.deleting = false;
      },

      confirmDelete() {
        const file = this.deleteTarget;
        const sid = file.metadata.sid;
        const key = file.key;
        this.deleting = true;
        const xhr = new XMLHttpRequest();
        xhr.open('DELETE', `admin/files/${sid}/${key}`);
        xhr.setRequestHeader('x-passwd', this.password);
        xhr.onload = () => {
          this.deleting = false;
          if (xhr.status === 204) {
            const bucket = this.db[sid];
            const idx = bucket.findIndex(f => f.key === key);
            if (idx !== -1) bucket.splice(idx, 1);
            if (bucket.length === 0) this.$delete(this.db, sid);
            this.closeDelete();
          } else {
            this.error = `${xhr.status} ${xhr.statusText}: ${xhr.responseText}`;
            this.closeDelete();
          }
        };
        xhr.onerror = () => {
          this.deleting = false;
          this.error = 'Erreur réseau lors de la suppression.';
        };
        xhr.send();
      },

      copyText(text) {
        if (!text) return;
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).catch(() => {});
          } else {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            try { document.execCommand('copy'); } catch (e) {}
            document.body.removeChild(ta);
          }
        } catch (e) {}
      },

      shortId(id) {
        if (!id) return '';
        return id.length > 12 ? id.slice(0, 6) + '…' + id.slice(-4) : id;
      },

      fmt(ts) {
        if (!ts) return '—';
        const d = new Date(+ts);
        if (isNaN(d)) return '—';
        const p = n => (n < 10 ? '0' : '') + n;
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
      },

      ago(ts) {
        if (!ts) return '—';
        const t = +ts;
        const diff = Date.now() - t;
        const s = Math.floor(diff / 1000);
        if (s < 60) return 'à l\'instant';
        if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
        if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`;
        if (s < 604800) return `il y a ${Math.floor(s / 86400)} j`;
        return this.fmt(t);
      },

      eventKindLabel(e) {
        if (e.kind === 'upload') return 'upload';
        if (e.kind === 'download') return 'téléchargement';
        return 'visite de page';
      },

      humanFileSize(fileSizeInBytes) {
        if (!fileSizeInBytes && fileSizeInBytes !== 0) return '—';
        let i = -1;
        const byteUnits = [' kB', ' MB', ' GB', ' TB', 'PB', 'EB', 'ZB', 'YB'];
        let size = fileSizeInBytes;
        do {
          size = size / 1024;
          i++;
        } while (size > 1024);
        return Math.max(size, 0.00).toFixed(2) + byteUnits[i];
      },

      parseUserAgent(ua) {
        const res = { browser: 'inconnu', browserShort: '', os: 'inconnu', device: 'ordi' };
        if (!ua) return res;
        let m;
        if ((m = ua.match(/Edg\/([\d.]+)/))) res.browser = `Edge ${m[1]}`;
        else if ((m = ua.match(/OPR\/([\d.]+)/))) res.browser = `Opera ${m[1]}`;
        else if ((m = ua.match(/Firefox\/([\d.]+)/))) res.browser = `Firefox ${m[1]}`;
        else if (/Chrome\//.test(ua) && !/Chromium/.test(ua) && (m = ua.match(/Chrome\/([\d.]+)/))) res.browser = `Chrome ${m[1]}`;
        else if (/Safari\//.test(ua) && (m = ua.match(/Version\/([\d.]+)/))) res.browser = `Safari ${m[1]}`;
        res.browserShort = (res.browser.split(' ')[0] || res.browser).toLowerCase();

        if (/Windows NT 10/.test(ua)) res.os = 'Windows 10/11';
        else if (/Windows NT 6\.3/.test(ua)) res.os = 'Windows 8.1';
        else if (/Windows NT 6\.1/.test(ua)) res.os = 'Windows 7';
        else if (/Windows/.test(ua)) res.os = 'Windows';
        else if (/Android/.test(ua)) {
          const am = ua.match(/Android (\d+(\.\d+)?)/);
          res.os = am ? `Android ${am[1]}` : 'Android';
        } else if (/iPhone|iPad|iPod/.test(ua)) {
          const im = ua.match(/OS (\d+[_.]\d+)/);
          res.os = im ? `iOS ${im[1].replace('_', '.')}` : 'iOS';
        } else if (/Mac OS X/.test(ua)) {
          const mm = ua.match(/Mac OS X (\d+[_.]\d+)/);
          res.os = mm ? `macOS ${mm[1].replace('_', '.')}` : 'macOS';
        } else if (/Linux/.test(ua)) res.os = 'Linux';

        if (/iPhone/i.test(ua)) res.device = 'mobile';
        else if (/Android/i.test(ua) && /Mobile/i.test(ua)) res.device = 'mobile';
        else if (/iPad/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) res.device = 'tablette';
        else if (/Tablet|Silk/i.test(ua)) res.device = 'tablette';
        return res;
      }
    }
  }
</script>

<style>
  .admin-shell {
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    color: #1f2937;
    line-height: 1.45;
    margin: -15px;
  }
  .admin-shell a { color: inherit; text-decoration: none; }
  .admin-shell code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }
  .admin-shell .spin { animation: oc-spin 1s linear infinite; }
  @keyframes oc-spin { to { transform: rotate(360deg); } }

  /* ---------- error banner ---------- */
  .error-banner {
    background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca;
    border-radius: 10px; padding: 12px 16px; margin: 16px; font-weight: 500;
    display: flex; align-items: center; gap: 10px;
  }
  .error-banner .banner-close { margin-left: auto; cursor: pointer; color: #b91c1c; font-weight: 700; font-size: 18px; }
  .fade-enter-active, .fade-leave-active { transition: opacity .2s; }
  .fade-enter, .fade-leave-to { opacity: 0; }

  /* ---------- login ---------- */
  .login-card {
    min-height: 60vh; display: flex; align-items: center; justify-content: center; padding: 24px;
  }
  .login-inner {
    background: #fff; border: 1px solid #e5e7eb; border-radius: 16px;
    padding: 36px 40px; width: 100%; max-width: 400px; box-shadow: 0 10px 30px rgba(0,0,0,.08);
  }
  .login-inner h2 { display: flex; align-items: center; gap: 12px; margin: 0 0 6px; font-size: 22px; }
  .login-inner h2 svg { width: 28px; }
  .login-inner .sub-txt { color: #6b7280; margin: 0 0 24px; }
  .field { margin-bottom: 16px; }
  .field label { display: block; font-size: 13px; font-weight: 600; margin-bottom: 6px; color: #374151; }
  .field input {
    width: 100%; padding: 10px 12px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 14px; outline: none;
  }
  .field input:focus { border-color: #2563eb; box-shadow: 0 0 0 3px rgba(37,99,235,.15); }
  .error-txt { color: #dc2626; font-weight: 500; margin: 8px 0; }
  .btn-block { width: 100%; }

  /* ---------- header ---------- */
  .dash-head {
    display: flex; align-items: center; justify-content: space-between;
    padding: 20px 24px 8px; flex-wrap: wrap; gap: 12px;
  }
  .dash-title h1 { display: flex; align-items: center; gap: 12px; margin: 0; font-size: 24px; font-weight: 700; }
  .lock-dot { width: 12px; height: 12px; border-radius: 50%; background: #2563eb; display: inline-block; box-shadow: 0 0 0 4px rgba(37,99,235,.15); }
  .dash-title .sub-txt { color: #6b7280; margin: 4px 0 0; font-size: 13px; }
  .dash-actions { display: flex; gap: 8px; }
  .btn-ghost {
    background: #fff; border: 1px solid #d1d5db; color: #374151; border-radius: 9px;
    padding: 8px 14px; font-size: 13px; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 7px;
  }
  .btn-ghost:hover { background: #f3f4f6; }

  /* ---------- stat grid ---------- */
  .stat-grid {
    display: grid; grid-template-columns: repeat(5, 1fr); gap: 14px; padding: 16px 24px 4px;
  }
  .stat-card {
    background: #fff; border: 1px solid #e5e7eb; border-radius: 14px; padding: 16px;
    display: flex; align-items: center; gap: 14px; box-shadow: 0 1px 3px rgba(0,0,0,.05);
  }
  .stat-icon {
    width: 44px; height: 44px; border-radius: 12px; display: flex; align-items: center; justify-content: center;
    color: #fff; font-size: 18px; flex-shrink: 0;
  }
  .stat-icon.blue { background: linear-gradient(135deg, #3b82f6, #2563eb); }
  .stat-icon.indigo { background: linear-gradient(135deg, #818cf8, #6366f1); }
  .stat-icon.green { background: linear-gradient(135deg, #34d399, #10b981); }
  .stat-icon.amber { background: linear-gradient(135deg, #fbbf24, #f59e0b); }
  .stat-icon.red { background: linear-gradient(135deg, #f87171, #ef4444); }
  .stat-body { min-width: 0; }
  .stat-body b { display: block; font-size: 24px; line-height: 1.1; }
  .stat-body span { color: #6b7280; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; }
  .stat-sub { margin-top: 2px; font-size: 12px; color: #9ca3af; }

  .stat-card {
    transition: transform .15s ease, box-shadow .15s ease;
  }
  .stat-card:hover {
    transform: translateY(-2px);
    box-shadow: 0 6px 16px rgba(0,0,0,.08);
  }

  /* ---------- tabs ---------- */
  .tabbar {
    display: flex; align-items: center; gap: 6px; margin: 18px 24px 0; padding-bottom: 12px;
    border-bottom: 1px solid #e5e7eb;
  }
  .tab {
    background: transparent; border: none; cursor: pointer; display: inline-flex; align-items: center; gap: 8px;
    padding: 9px 16px; font-size: 14px; font-weight: 600; color: #6b7280; border-radius: 10px 10px 0 0;
    border-bottom: 2px solid transparent; margin-bottom: -1px;
  }
  .tab:hover { color: #1f2937; }
  .tab.active { color: #2563eb; border-bottom-color: #2563eb; background: rgba(37,99,235,.05); }
  .tab .cnt {
    background: #e5e7eb; color: #4b5563; font-size: 11px; font-weight: 700; border-radius: 999px; padding: 1px 8px;
  }
  .tab.active .cnt { background: #2563eb; color: #fff; }
  .tabbar-spacer { flex: 1; }

  /* ---------- toolbar ---------- */
  .toolbar { display: flex; align-items: center; gap: 14px; padding: 14px 24px 6px; flex-wrap: wrap; }
  .search-box {
    position: relative; flex: 1; min-width: 240px; max-width: 480px;
  }
  .search-box svg {
    position: absolute; left: 11px; top: 50%; transform: translateY(-50%); color: #9ca3af; font-size: 14px;
  }
  .search-box input {
    width: 100%; padding: 9px 12px 9px 34px; border: 1px solid #d1d5db; border-radius: 9px; font-size: 14px; outline: none;
    background: #fff;
  }
  .search-box input:focus { border-color: #2563eb; box-shadow: 0 0 0 3px rgba(37,99,235,.12); }
  .filters { display: flex; gap: 6px; flex-wrap: wrap; }
  .filter-pill {
    background: #fff; border: 1px solid #d1d5db; color: #4b5563; border-radius: 999px; padding: 6px 12px;
    font-size: 12px; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 6px;
  }
  .filter-pill .dot { width: 8px; height: 8px; border-radius: 50%; background: #9ca3af; }
  .filter-pill .dot.dot-active { background: #10b981; }
  .filter-pill .dot.dot-expired { background: #9ca3af; }
  .filter-pill .dot.dot-one-time { background: #f59e0b; }
  .filter-pill .dot.dot-password { background: #6366f1; }
  .filter-pill.active { background: #2563eb; border-color: #2563eb; color: #fff; }
  .sort-select {
    background: #fff; border: 1px solid #d1d5db; border-radius: 9px; padding: 8px 10px; font-size: 13px; color: #374151;
  }

  /* ---------- sections ---------- */
  .files-view, .visitors-view { padding: 12px 24px 40px; }

  .empty-state {
    text-align: center; color: #6b7280; padding: 60px 0; font-size: 14px;
  }
  .empty-state svg { font-size: 34px; color: #c4cbd6; margin-bottom: 12px; display: inline-block; }
  .empty-state p { margin: 0; }

  /* ---------- bucket cards ---------- */
  .bucket-card {
    background: #fff; border: 1px solid #e5e7eb; border-radius: 14px; margin-bottom: 14px; overflow: hidden;
    box-shadow: 0 1px 3px rgba(0,0,0,.05); transition: box-shadow .15s ease, border-color .15s ease;
  }
  .bucket-card:hover { box-shadow: 0 8px 20px rgba(0,0,0,.07); border-color: #d1d5db; }
  .bucket-head { display: flex; align-items: center; gap: 14px; padding: 14px 16px; cursor: pointer; }
  .bucket-head:hover { background: #f9fafb; }
  .bucket-info { display: flex; align-items: center; gap: 12px; flex: 1; min-width: 0; }
  .expand-btn {
    background: none; border: none; cursor: pointer; color: #6b7280; font-size: 13px; padding: 4px;
    transition: transform .18s;
  }
  .expand-btn.rotated { transform: rotate(90deg); }
  .sid-box { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .sid {
    font-size: 15px; font-weight: 600; color: #111827; letter-spacing: .02em; background: #f3f4f6;
    border: 1px solid #e5e7eb; border-radius: 8px; padding: 3px 10px;
  }
  .badges { display: inline-flex; gap: 6px; }
  .badge {
    display: inline-flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 700; border-radius: 999px; padding: 2px 9px;
  }
  .badge.lock { background: #eef2ff; color: #4338ca; }
  .badge.expire { background: #fffbeb; color: #b45309; }
  .badge.expired-badge { background: #f3f4f6; color: #6b7280; }
  .bucket-count { font-size: 12px; color: #9ca3af; font-weight: 600; white-space: nowrap; }

  /* ---------- contact chips ---------- */
  .bucket-contact { margin-left: 2px; min-width: 0; }
  .visitor-contact { margin-top: 6px; }
  .contact-chip {
    display: inline-flex; align-items: center; gap: 6px;
    background: #fdf2f8; color: #be185d; border: 1px solid #fbcfe8;
    border-radius: 999px; padding: 2px 10px; font-size: 11.5px; font-weight: 600;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 260px;
  }
  .contact-chip.sm { font-size: 10.5px; padding: 1px 8px; max-width: 200px; }
  a.mailto { color: #be185d; font-weight: 600; }
  a.mailto:hover { text-decoration: underline; }

  .bucket-meta {
    display: flex; align-items: center; gap: 24px; padding: 8px 16px 10px; background: #fafafa;
    border-top: 1px solid #f3f4f6; overflow-x: auto;
  }
  .meta-item { display: flex; flex-direction: column; }
  .meta-item .k { font-size: 10.5px; text-transform: uppercase; letter-spacing: .05em; color: #9ca3af; font-weight: 700; }
  .meta-item .v { font-size: 13px; color: #374151; }
  .link-meta { margin-left: auto; }
  .copy-link { color: #2563eb; font-size: 12.5px; font-weight: 600; display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }
  .copy-link:hover { text-decoration: underline; }

  /* ---------- file rows ---------- */
  .file-list { border-top: 1px solid #f3f4f6; }
  .file-row {
    display: flex; align-items: center; gap: 12px; padding: 11px 16px 11px 22px;
    border-bottom: 1px solid #f3f4f6; transition: background .12s;
  }
  .file-row:last-child { border-bottom: none; }
  .file-row:hover { background: #f8fafc; }
  .file-row.is-expired { background: #fafafa; }
  .file-row.is-expired .file-name strong { color: #9ca3af; text-decoration: line-through; }
  .file-main { display: flex; align-items: center; gap: 12px; flex: 1; min-width: 0; }
  .file-ico { font-size: 20px; color: #6b7280; width: 26px; text-align: center; flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; }
  .file-ico svg { width: 20px !important; height: 20px !important; }
  .file-txt { min-width: 0; }
  .file-name { display: flex; align-items: baseline; gap: 10px; }
  .file-name strong { font-size: 14px; color: #111827; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 380px; }
  .fsize { font-size: 12px; color: #6b7280; }
  .file-line { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 3px; font-size: 12.5px; }
  .muted { color: #9ca3af; }
  .sep { color: #d1d5db; }
  .pill {
    display: inline-flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 700; border-radius: 999px; padding: 2px 9px;
  }
  .pill-active { background: #ecfdf5; color: #047857; }
  .pill-expired { background: #f3f4f6; color: #6b7280; }
  .pill-one-time { background: #fffbeb; color: #b45309; }
  .pill-untracked { background: #f3f4f6; color: #6b7280; }
  .pill-socket { background: #eff6ff; color: #1d4ed8; }
  .pill-type { background: #faf5ff; color: #7c3aed; }
  .badge.lock-sm { background: #eef2ff; color: #4338ca; padding: 1px 7px; }
  .tracker-chip {
    display: inline-flex; align-items: center; gap: 6px; background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe;
    border-radius: 999px; padding: 2px 10px; font-size: 11.5px; font-weight: 700; cursor: pointer; white-space: nowrap; flex-shrink: 0;
  }
  .tracker-chip:hover { background: #dbeafe; }
  .tracker-chip.untracked { background: #f3f4f6; color: #9ca3af; border-color: #e5e7eb; cursor: default; }
  .chip-meta { font-weight: 400; color: #60a5fa; }

  .file-actions { display: flex; gap: 4px; flex-shrink: 0; }
  .btn-icon {
    width: 32px; height: 32px; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center;
    color: #6b7280; cursor: pointer; border: 1px solid transparent; font-size: 14px;
  }
  .btn-icon:hover { background: #f3f4f6; border-color: #e5e7eb; color: #111827; }
  .btn-icon.dl:hover { background: #eff6ff; border-color: #bfdbfe; color: #1d4ed8; }
  .btn-icon.danger:hover { background: #fef2f2; border-color: #fecaca; color: #dc2626; }

  .sum-row {
    display: flex; align-items: center; justify-content: flex-end; gap: 18px; padding: 14px 6px 4px;
    font-size: 13px; color: #6b7280; font-weight: 600;
  }
  .sum-row .big { color: #111827; font-size: 14px; }

  /* ---------- visitor cards ---------- */
  .visitor-card {
    background: #fff; border: 1px solid #e5e7eb; border-radius: 14px; margin-bottom: 12px; overflow: hidden;
    box-shadow: 0 1px 3px rgba(0,0,0,.05); transition: box-shadow .15s ease, border-color .15s ease;
  }
  .visitor-card:hover { box-shadow: 0 8px 20px rgba(0,0,0,.07); border-color: #d1d5db; }
  .visitor-card.untracked { opacity: .8; }
  .visitor-main { padding: 16px; display: flex; gap: 20px; flex-wrap: wrap; align-items: flex-start; }
  .visitor-ident { flex: 1; min-width: 280px; }
  .tracker-id { display: flex; align-items: center; gap: 10px; }
  .tracker-id code {
    font-size: 15px; font-weight: 700; color: #111827; background: #eff6ff; border: 1px solid #bfdbfe;
    border-radius: 8px; padding: 3px 10px; word-break: break-all;
  }
  .tracker-id.big code { font-size: 18px; }
  .copy-btn {
    background: #fff; border: 1px solid #d1d5db; color: #6b7280; border-radius: 7px; cursor: pointer;
    width: 26px; height: 26px; display: inline-flex; align-items: center; justify-content: center; font-size: 12px;
  }
  .copy-btn:hover { color: #2563eb; border-color: #93c5fd; }
  .visitor-meta { margin-top: 6px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 12.5px; }
  .visitor-geo { margin-top: 8px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 12.5px; }
  .visitor-geo .ip { color: #374151; background: #f3f4f6; border-radius: 6px; padding: 1px 8px; }
  .geo-btn { color: #2563eb; cursor: pointer; font-size: 13px; }
  .geo-result { color: #059669; font-weight: 600; }

  .visitor-stats { display: flex; gap: 20px; flex-wrap: wrap; }
  .vs { text-align: center; }
  .vs b { display: block; font-size: 17px; color: #111827; }
  .vs span { font-size: 11px; color: #9ca3af; font-weight: 600; text-transform: uppercase; letter-spacing: .03em; }
  .visitor-times { display: flex; gap: 22px; flex-wrap: wrap; }
  .visitor-times .meta-item .v { color: #111827; }

  .visitor-foot {
    display: flex; align-items: center; gap: 14px; flex-wrap: wrap; padding: 10px 16px; background: #fafafa;
    border-top: 1px solid #f3f4f6; font-size: 12.5px;
  }
  .btn-view {
    display: inline-flex; align-items: center; gap: 7px; background: #2563eb; color: #fff; font-weight: 600;
    font-size: 12.5px; border-radius: 9px; padding: 7px 14px; cursor: pointer;
  }
  .btn-view:hover { background: #1d4ed8; }
  .chip-detail { color: #6b7280; }
  .chip-detail.fp { font-family: ui-monospace, monospace; font-size: 11px; color: #9ca3af; }

  /* ---------- modals ---------- */
  .adm-backdrop {
    position: fixed; inset: 0; background: rgba(17,24,39,.55); backdrop-filter: blur(3px);
    display: flex; align-items: flex-start; justify-content: center; z-index: 1000; overflow-y: auto; padding: 40px 16px;
  }
  .adm-modal {
    background: #fff; border-radius: 16px; padding: 24px 26px; max-width: 520px; width: 100%;
    position: relative; box-shadow: 0 24px 60px rgba(0,0,0,.25); animation: oc-pop .16s ease-out;
  }
  @keyframes oc-pop { from { transform: translateY(8px); opacity: 0; } to { transform: none; opacity: 1; } }
  .adm-modal.wide-modal { max-width: 780px; }
  .adm-modal.exif-modal { max-height: 90vh; overflow-y: auto; }
  .adm-modal h3 { display: flex; align-items: center; gap: 10px; margin: 0 0 14px; font-size: 18px; }
  .adm-modal h4 { display: flex; align-items: center; gap: 8px; margin: 0 0 10px; font-size: 13.5px; color: #111827; text-transform: uppercase; letter-spacing: .04em; }
  .adm-close {
    position: absolute; top: 14px; right: 16px; font-size: 22px; color: #9ca3af; cursor: pointer; line-height: 1;
  }
  .adm-close:hover { color: #111827; }
  .file-title { display: flex; align-items: baseline; gap: 10px; margin-bottom: 8px; }
  .file-title strong { font-size: 15px; overflow-wrap: anywhere; }
  .file-title .size { color: #6b7280; font-size: 12.5px; }
  .pill-row { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px; }

  .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .info-block {
    background: #f9fafb; border: 1px solid #f3f4f6; border-radius: 12px; padding: 14px 16px;
  }
  .info-block.small { grid-column: span 2; }
  .info-block dl { margin: 0; }
  .info-block dt { font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: #9ca3af; font-weight: 700; margin-top: 8px; }
  .info-block dt:first-child { margin-top: 0; }
  .info-block dd { margin: 1px 0 0; font-size: 13.5px; color: #1f2937; overflow-wrap: anywhere; }
  .info-block dd code { background: #eef2ff; color: #1e3a8a; border-radius: 6px; padding: 1px 7px; }
  .code-cell { display: flex; align-items: center; gap: 8px; }
  .mono-small { font-size: 11.5px; word-break: break-all; }
  .tracking-actions { margin-top: 12px; }

  .btn-secondary {
    display: inline-flex; align-items: center; gap: 7px; background: #fff; border: 1px solid #d1d5db; color: #374151;
    border-radius: 9px; padding: 7px 13px; font-size: 12.5px; font-weight: 600; cursor: pointer;
  }
  .btn-secondary:hover { background: #f3f4f6; }
  .btn-link { color: #2563eb; font-size: 13px; font-weight: 600; }
  .btn-danger {
    display: inline-flex; align-items: center; gap: 7px; background: #dc2626; color: #fff; border: none;
    border-radius: 9px; padding: 8px 16px; font-size: 13px; font-weight: 700; cursor: pointer;
  }
  .btn-danger:hover { background: #b91c1c; }
  .adm-actions { display: flex; align-items: center; gap: 14px; margin-top: 18px; flex-wrap: wrap; }
  .adm-actions.center { justify-content: center; }
  .confirm-txt { color: #4b5563; font-size: 14px; }
  .confirm-txt strong { color: #111827; }

  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 16px; }

  .detail-stats { display: flex; gap: 26px; flex-wrap: wrap; margin: 14px 0 4px; }
  .detail-stats .vs b { font-size: 19px; }
  .file-list-mini { list-style: none; margin: 0; padding: 0; max-height: 170px; overflow-y: auto; }
  .file-list-mini li {
    display: flex; align-items: center; gap: 8px; padding: 5px 0; border-bottom: 1px dashed #e5e7eb; font-size: 13px;
  }
  .file-list-mini li:last-child { border-bottom: none; }
  .file-list-mini .dot-status { width: 8px; height: 8px; border-radius: 50%; background: #10b981; flex-shrink: 0; }
  .file-list-mini .dot-status.red { background: #ef4444; }
  .file-list-mini .fname { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .file-list-mini .fmeta { color: #9ca3af; font-size: 12px; margin-left: auto; white-space: nowrap; }
  .file-list-mini li.expired .fname { color: #9ca3af; }

  .timeline { max-height: 300px; overflow-y: auto; }
  .evt {
    display: grid; grid-template-columns: 150px 130px 1fr; gap: 10px; padding: 6px 0;
    border-bottom: 1px dashed #e5e7eb; font-size: 12.5px; align-items: center;
  }
  .evt:last-child { border-bottom: none; }
  .evt-time { color: #6b7280; font-family: ui-monospace, monospace; font-size: 11.5px; }
  .evt-kind { font-weight: 700; border-radius: 6px; padding: 1px 8px; text-align: center; font-size: 11px; }
  .kind-visit { background: #f3f4f6; color: #4b5563; }
  .kind-upload { background: #ecfdf5; color: #047857; }
  .kind-download { background: #eff6ff; color: #1d4ed8; }
  .evt-detail { color: #374151; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .text-muted { color: #6b7280; }
  .text-break { word-break: break-all; }
  .exif-table { width: 100%; border-collapse: collapse; }
  .exif-table th { text-align: left; width: 35%; font-size: 12px; text-transform: uppercase; color: #9ca3af; padding: 5px 8px 5px 0; vertical-align: top; }
  .exif-table td { font-size: 13px; color: #1f2937; padding: 5px 0; word-break: break-all; }
  .exif-table tr { border-bottom: 1px solid #f3f4f6; }

  @media (max-width: 900px) {
    .stat-grid { grid-template-columns: repeat(2, 1fr); }
    .info-grid, .two-col { grid-template-columns: 1fr; }
    .info-block.small { grid-column: span 1; }
  }
  @media (max-width: 520px) {
    .stat-grid { grid-template-columns: 1fr; }
    .dash-head, .toolbar, .files-view, .visitors-view { padding-left: 14px; padding-right: 14px; }
    .evt { grid-template-columns: 1fr 1fr; }
    .evt-detail { grid-column: span 2; }
  }
</style>