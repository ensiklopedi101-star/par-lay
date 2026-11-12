(function () {
  'use strict';

  // Jangan inject dua kali
  if (document.getElementById('fsi-root')) return;

// ============================================================
  // KONSTANTA (SINKRON DENGAN DATABASE SUPABASE)
  // ============================================================
  // === PATCH 5 ===
  var VERSION          = '3.2.0';
  // Endpoint default = route ingest aplikasi, BUKAN Edge Function Supabase.
  // Route itu punya validasi yang tidak dimiliki Edge Function: penolakan blok
  // yang labelnya bertentangan dengan stat_type (PATCH 4), resolusi league_slug
  // ("la-liga" → "spain-la-liga"), dan dedupe lewat team_key.
  var DEFAULT_ENDPOINT = 'https://parwon.vercel.app/api/stats/ingest';
  // Server menolak statistik lebih tua dari TEAM_STATS_STALE_DAYS (14 hari).
  var STALE_DAYS       = 14;
  var PUSH_HISTORY_KEY = 'pushHistory';

  var STAT_TYPE_MAP = [
    { keywords: ['xg-table', 'xg'],               stat: 'stats_xg'             },
    { keywords: ['failed-to-score'],              stat: 'stats_fts'            },
    { keywords: ['btts'],                         stat: 'stats_btts'           },
    { keywords: ['goals-conceded'],               stat: 'stats_goals_conceded' },
    { keywords: ['goals-scored'],                 stat: 'stats_goals_scored'   },
    { keywords: ['shots'],                        stat: 'stats_shots'          },
    { keywords: ['over-25', 'over-2-5'],          stat: 'stats_over_25'        },
    { keywords: ['over-35', 'over-3-5'],          stat: 'stats_over_35'        },
    { keywords: ['under'],                        stat: 'stats_under'          },
    { keywords: ['form'],                         stat: 'stats_team_form'      },
    { keywords: ['half-time', 'halftime', 'ht'],  stat: 'stats_ht'             }
  ];
  var TEAM_COL_KEYWORDS = ['team', 'club', 'name', 'klub'];

  // Daftar stat_type untuk dropdown manual (dipakai saat URL tidak
  // mengandung slug stats — mis. halaman musim lalu: .../premier-league#)
  var STAT_TYPE_OPTIONS = [
    { value: 'stats_xg',             label: 'xG' },
    { value: 'stats_fts',            label: 'Failed To Score' },
    { value: 'stats_btts',           label: 'BTTS' },
    { value: 'stats_goals_conceded', label: 'Goals Conceded' },
    { value: 'stats_goals_scored',   label: 'Goals Scored' },
    { value: 'stats_shots',          label: 'Shots' },
    { value: 'stats_over_25',        label: 'Over 2.5' },
    { value: 'stats_over_35',        label: 'Over 3.5' },
    { value: 'stats_under',          label: 'Under X' },
    { value: 'stats_team_form',      label: 'Team Form' },
    { value: 'stats_ht',             label: 'Half Time' }
  ];

  // Deteksi stat_type dari HEADER paste — lebih akurat dari URL untuk
  // halaman yang memuat beberapa tabel sekaligus (mis. over-25-goals-table)
  var HEADER_STAT_MAP = [
    { pattern: /\bover\s*0\.5\b/i,  stat: null             },
    { pattern: /\bover\s*1\.5\b/i,  stat: null             },
    { pattern: /\bover\s*2\.5\b/i,  stat: 'stats_over_25'  },
    { pattern: /\bover\s*3\.5\b/i,  stat: 'stats_over_35'  },
    { pattern: /\bover\s*4\.5\b/i,  stat: null             },
    { pattern: /\bover\s*5\.5\b/i,  stat: null             },
    { pattern: /\bunder\s*\d/i,      stat: 'stats_under'    },
    { pattern: /\bbtts\b/i,           stat: 'stats_btts'     },
    { pattern: /\bxg[a]?\b/i,        stat: 'stats_xg'       },
    { pattern: /\bshots?\b/i,        stat: 'stats_shots'    },
    { pattern: /\bfts\b|failed.to.score/i, stat: 'stats_fts' },
    { pattern: /\bform\b/i,          stat: 'stats_team_form'},
    { pattern: /\bhalf.time\b|\bht\b/i, stat: 'stats_ht'  },
    { pattern: /\bgoals?\s*conceded\b/i, stat: 'stats_goals_conceded' },
    { pattern: /\bgoals?\s*scored\b/i,   stat: 'stats_goals_scored'  },
  ];

  function detectStatTypeFromHeaders(headers) {
    // -- Signature check DULU untuk tabel ambigu --

    // Tabel Form: W + D + L + Pts hadir bersamaan (standar league table)
    // Meskipun di dalamnya juga ada kolom FTS/BTTS/Over 2.5
    var hasW   = headers.some(function(h){ return /^W$/.test(h); });
    var hasD   = headers.some(function(h){ return /^D$/.test(h); });
    var hasL   = headers.some(function(h){ return /^L$/.test(h); });
    var hasPts = headers.some(function(h){ return /^Pts$/i.test(h); });
    if (hasW && hasD && hasL && hasPts) return 'stats_team_form';

    // Tabel Shots: Over 10.5 / Over 11.5 / Over 12.5 dst
    var hasShots = headers.some(function(h){ return /\bover\s*1[0-9]\.5\b/i.test(h); });
    if (hasShots) return 'stats_shots';

    // -- Fallback: cek tiap header satu per satu --
    for (var i = 0; i < headers.length; i++) {
      var h = headers[i];
      for (var j = 0; j < HEADER_STAT_MAP.length; j++) {
        if (HEADER_STAT_MAP[j].pattern.test(h)) {
          return HEADER_STAT_MAP[j].stat;
        }
      }
    }
    return undefined; // tidak ada match — gunakan deteksi URL
  }

  // ============================================================
  // === PATCH 4 === GUARD:START — label vs stat_type
  // ============================================================
  // Kenapa ini ada: 18/18 baris La Liga 2026-27 menyimpan blok berlabel
  // "Conceded" di kolom stats_goals_scored. Penyebabnya mode manual: dropdown
  // dipilih "Goals Scored" sementara tabel yang di-paste adalah tabel
  // "Goals Conceded", dan satu-satunya koreksi (detectStatTypeFromHeaders)
  // hanya berjalan saat mode auto. Guard ini berjalan di SEMUA mode, saat
  // paste maupun tepat sebelum push.
  var STAT_LABEL_RULES = {
    stats_goals_scored: {
      forbidden: /conceded/i,
      required:  /scored/i,
      label:     'Goals Conceded',
      shouldBe:  'stats_goals_conceded'
    },
    stats_goals_conceded: {
      forbidden: /\bscored\b/i,
      required:  /conceded/i,
      label:     'Goals Scored',
      shouldBe:  'stats_goals_scored'
    }
  };

  function statBlockText(statData) {
    if (!statData || typeof statData !== 'object') return '';
    var chunks = [];
    Object.keys(statData).forEach(function (k) {
      var v = statData[k];
      chunks.push(String(k), v == null ? '' : String(v));
    });
    return chunks.join(' ').toLowerCase();
  }

  function contradictingTeams(statType, teams) {
    var rule = STAT_LABEL_RULES[statType];
    if (!rule || !teams || !teams.length) return [];
    var out = [];
    for (var i = 0; i < teams.length; i++) {
      var team = teams[i] || {};
      var text = statBlockText(team.stat_data);
      if (!text) continue;
      if (rule.forbidden.test(text) && !rule.required.test(text)) {
        out.push(String(team.raw_team_name || 'UNKNOWN'));
      }
    }
    return out;
  }

  /**
   * Pesan siap-tampil, atau null kalau payload aman.
   */
  function describeContradiction(statType, teams) {
    var rule = STAT_LABEL_RULES[statType];
    var bad  = contradictingTeams(statType, teams);
    if (!bad.length) return null;
    var preview = bad.slice(0, 3).join(', ') + (bad.length > 3 ? ', +' + (bad.length - 3) + ' lain' : '');
    return '❌ ' + bad.length + '/' + teams.length + ' tim berlabel "' + rule.label + '"\n' +
           '(' + preview + ')\n' +
           'Kolom tujuan: ' + statType + ' — seharusnya ' + rule.shouldBe + '.\n' +
           'Pilih "' + rule.label + '" di dropdown Stat Type.';
  }
  // === GUARD:END ===

  // ============================================================
  // === PATCH 8 === riwayat push & peringatan data basi
  // ============================================================
  function ageInDays(iso) {
    var t = new Date(iso).getTime();
    if (!isFinite(t)) return null;
    return Math.floor((Date.now() - t) / 86400000);
  }

  function newestPushAgeDays(leagueSlug) {
    var newest = null;
    Object.keys(pushHistory).forEach(function (k) {
      if (k.split('|')[0] !== leagueSlug) return;
      var iso = pushHistory[k];
      if (!iso) return;
      if (!newest || new Date(iso).getTime() > new Date(newest).getTime()) newest = iso;
    });
    return newest ? ageInDays(newest) : null;
  }

  function recordPush(leagueSlug, season, statType) {
    if (!leagueSlug) return;
    pushHistory[leagueSlug + '|' + season + '|' + statType] = new Date().toISOString();
    var patch = {};
    patch[PUSH_HISTORY_KEY] = pushHistory;
    chrome.storage.local.set(patch);
  }

  /**
   * Server menolak statistik lebih tua dari STALE_DAYS. Peringatkan SEBELUM
   * push, karena gejalanya di aplikasi hanya "data statistik belum lengkap".
   */
  function showStaleness() {
    if (!ctx.league_slug) return;
    var age = newestPushAgeDays(ctx.league_slug);
    if (age === null)  return;
    if (age > STALE_DAYS) {
      showStatus('err',
        '⚠️ Liga ini terakhir dipush ' + age + ' hari lalu.\n' +
        'Server menolak statistik lebih tua dari ' + STALE_DAYS + ' hari — push ulang semua tabel.');
    } else if (age >= 7) {
      showStatus('warn', '⏳ Liga ini terakhir dipush ' + age + ' hari lalu (batas ' + STALE_DAYS + ' hari).');
    }
  }


  // ============================================================
  // STATE
  // ============================================================
  var CFG     = { endpoint: '', apiKey: '' };
  // === PATCH 8 === riwayat push per (liga|season|stat_type), ISO timestamp.
  var pushHistory = {};
  var ctx     = { raw_url_path: '', stat_type: '', season: '', league_slug: '' };
  var payload = null;
  var jsonOpen  = false;
  var statMode  = 'auto'; // 'auto' | 'manual' — auto pakai deteksi URL/header, manual pakai pilihan dropdown

  // ============================================================
  // CSS — semua di-scope ke #fsi-root agar tidak konflik
  // ============================================================
  var CSS = `
  #fsi-root * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Segoe UI', system-ui, sans-serif; }

  #fsi-fab {
    position: fixed; bottom: 20px; right: 20px; z-index: 2147483646;
    width: 46px; height: 46px; border-radius: 50%;
    background: linear-gradient(135deg, #1e3a5f, #16a34a);
    border: 2px solid #22c55e; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    font-size: 22px; box-shadow: 0 4px 16px rgba(0,0,0,.55);
    transition: transform .18s, box-shadow .18s;
    user-select: none;
  }
  #fsi-fab:hover { transform: scale(1.1); box-shadow: 0 6px 22px rgba(0,0,0,.7); }
  #fsi-fab.hidden { display: none; }

  #fsi-widget {
    position: fixed; bottom: 20px; right: 20px; z-index: 2147483647;
    width: 290px;
    background: #0f172a; border: 1px solid #1e293b; border-radius: 10px;
    box-shadow: 0 8px 32px rgba(0,0,0,.7);
    font-size: 12px; color: #e2e8f0;
    display: flex; flex-direction: column;
    overflow: hidden;
    transition: opacity .15s, transform .15s;
  }
  #fsi-widget.hidden { display: none; }

  #fsi-header {
    background: linear-gradient(135deg, #1e3a5f, #16a34a);
    padding: 7px 10px;
    display: flex; align-items: center; justify-content: space-between;
    cursor: move; user-select: none; flex-shrink: 0;
  }
  .fsi-header-left { display: flex; align-items: center; gap: 6px; }
  .fsi-title { font-size: 12px; font-weight: 700; color: #fff; }
  .fsi-sub   { font-size: 9px; color: #86efac; }
  .fsi-btn-min {
    background: none; border: none; color: #86efac;
    font-size: 16px; line-height: 1; cursor: pointer; padding: 0 3px;
  }

  #fsi-body { padding: 10px; overflow-y: auto; max-height: 460px; }

  .fsi-ctx {
    background: #1e293b; border: 1px solid #334155; border-radius: 6px;
    padding: 6px 9px; margin-bottom: 8px; font-size: 10px;
  }
  .fsi-ctx-row { display: flex; align-items: center; gap: 5px; margin-bottom: 2px; }
  .fsi-ctx-row:last-child { margin-bottom: 0; }
  .fsi-ctx-lbl { color: #475569; width: 54px; flex-shrink: 0; }
  .fsi-ctx-val { color: #38bdf8; font-family: monospace; font-size: 10px; }
  .fsi-ctx-val.stat { color: #a78bfa; }
  .fsi-ctx-val.none { color: #475569; font-style: italic; }
  .fsi-season-sel {
    padding: 2px 4px;
    background: #0f172a; border: 1px solid #334155; border-radius: 4px;
    color: #38bdf8; font-size: 10px; font-family: monospace; cursor: pointer;
  }
  .fsi-season-sel:focus { outline: none; border-color: #38bdf8; }
  .fsi-season-sel option { background: #0f172a; }

  .fsi-stat-sel { color: #a78bfa; flex: 1; }
  .fsi-stat-sel option { background: #0f172a; }

  .fsi-stat-resolved {
    font-size: 9px; color: #64748b; margin-top: 2px; padding-left: 59px;
  }
  .fsi-stat-resolved .val { color: #a78bfa; font-family: monospace; }
  .fsi-mode-badge {
    font-size: 8px; padding: 0 4px; border-radius: 3px; margin-left: 4px;
    white-space: nowrap;
  }
  .fsi-mode-badge.auto   { background: #0d1f13; border: 1px solid #16a34a; color: #4ade80; }
  .fsi-mode-badge.manual { background: #1c1408; border: 1px solid #d97706; color: #fcd34d; }

  .fsi-btn-cfg-toggle {
    width: 100%; padding: 4px 7px; margin-bottom: 8px;
    background: #1e293b; border: 1px dashed #334155; border-radius: 5px;
    color: #64748b; font-size: 10px; cursor: pointer; text-align: left;
    transition: all .15s;
  }
  .fsi-btn-cfg-toggle:hover { border-color: #475569; color: #94a3b8; }

  .fsi-cfg-panel { display: none; margin-bottom: 8px; }
  .fsi-cfg-panel.show { display: block; }
  .fsi-cfg-field { margin-bottom: 6px; }
  .fsi-cfg-field label { display: block; font-size: 9px; color: #64748b; margin-bottom: 2px; }
  .fsi-cfg-field input {
    width: 100%; padding: 5px 7px;
    background: #0f172a; border: 1px solid #334155; border-radius: 4px;
    color: #e2e8f0; font-size: 10px; font-family: monospace;
  }
  .fsi-cfg-field input:focus { outline: none; border-color: #38bdf8; }

  #fsi-textarea {
    width: 100%; height: 90px; resize: vertical;
    padding: 6px 8px; margin-bottom: 5px;
    background: #1e293b; border: 1px solid #334155; border-radius: 5px;
    color: #e2e8f0; font-size: 10px; font-family: 'Consolas', monospace; line-height: 1.5;
  }
  #fsi-textarea:focus { outline: none; border-color: #38bdf8; }
  #fsi-textarea::placeholder { color: #334155; }

  .fsi-badge { font-size: 10px; color: #64748b; margin-bottom: 6px; min-height: 13px; }
  .fsi-badge.ok   { color: #4ade80; }
  .fsi-badge.err  { color: #f87171; }
  .fsi-badge.warn { color: #fcd34d; }

  .fsi-btn-row { display: flex; gap: 5px; margin-bottom: 5px; }

  .fsi-btn-paste {
    flex: 1; padding: 6px;
    background: #0284c7; color: #fff;
    border: none; border-radius: 5px;
    font-size: 10px; font-weight: 600; cursor: pointer;
    transition: background .15s;
  }
  .fsi-btn-paste:hover { background: #0369a1; }

  .fsi-btn-push {
    flex: 2; padding: 7px;
    background: #7c3aed; color: #fff;
    border: none; border-radius: 5px;
    font-size: 11px; font-weight: 700; cursor: pointer;
    display: flex; align-items: center; justify-content: center; gap: 5px;
    transition: background .15s;
  }
  .fsi-btn-push:hover:not(:disabled) { background: #6d28d9; }
  .fsi-btn-push:disabled { background: #2d1b69; color: #7c3aed; cursor: not-allowed; }
  .fsi-btn-push.loading  { background: #1e3a5f; }

  .fsi-btn-dl {
    width: 100%; padding: 6px; margin-bottom: 5px;
    background: transparent; color: #38bdf8;
    border: 1px solid #334155; border-radius: 5px;
    font-size: 10px; font-weight: 600; cursor: pointer;
    transition: all .15s;
  }
  .fsi-btn-dl:hover:not(:disabled) { border-color: #38bdf8; background: #1e293b; }
  .fsi-btn-dl:disabled { color: #334155; border-color: #1e293b; cursor: not-allowed; }

  .fsi-spin {
    width: 11px; height: 11px;
    border: 2px solid rgba(255,255,255,.3);
    border-top-color: #fff; border-radius: 50%;
    animation: fsi-spin .7s linear infinite; display: none; flex-shrink: 0;
  }
  @keyframes fsi-spin { to { transform: rotate(360deg); } }

  .fsi-status {
    margin-top: 6px; padding: 6px 8px; border-radius: 5px;
    font-size: 10px; line-height: 1.5; white-space: pre-wrap; display: none;
  }
  .fsi-status.ok   { background: #0d1f13; border: 1px solid #16a34a; color: #86efac; display: block; }
  .fsi-status.err  { background: #1e1215; border: 1px solid #dc2626; color: #fca5a5; display: block; }
  .fsi-status.warn { background: #1c1408; border: 1px solid #d97706; color: #fcd34d; display: block; }

  .fsi-json-toggle { margin-top: 6px; font-size: 10px; color: #475569; cursor: pointer; display: none; }
  .fsi-json-toggle.show { display: block; }
  .fsi-json-box {
    margin-top: 3px; padding: 6px 8px;
    background: #0a0f1e; border: 1px solid #1e293b; border-radius: 5px;
    font-size: 9px; font-family: monospace; color: #64748b;
    white-space: pre; overflow-x: auto; max-height: 100px; overflow-y: auto; display: none;
  }
  .fsi-json-box.show { display: block; }
  `;

  // ============================================================
  // HTML WIDGET
  // ============================================================
  var HTML = `
  <div id="fsi-fab" title="Parlay Data Ingest">⚽</div>

  <div id="fsi-widget" class="hidden">
    <div id="fsi-header">
      <div class="fsi-header-left">
        <span>⚽</span>
        <div>
          <div class="fsi-title">Parlay Data Ingest</div>
          <div class="fsi-sub">Table Capture → API Push · v<span id="fsi-ver">?</span></div>
        </div>
      </div>
      <button class="fsi-btn-min" id="fsi-btn-min">−</button>
    </div>

    <div id="fsi-body">
      <button class="fsi-btn-cfg-toggle" id="fsi-btn-cfg-toggle">⚙ API Config</button>

      <div class="fsi-cfg-panel" id="fsi-cfg-panel">
        <div class="fsi-cfg-field">
          <label>API Endpoint</label>
          <input type="text" id="fsi-endpoint" placeholder="https://your-api.com/api/stats/ingest">
        </div>
        <div class="fsi-cfg-field">
          <label>API Key</label>
          <input type="password" id="fsi-apikey" placeholder="your-secret-key">
        </div>
      </div>

      <div class="fsi-ctx">
        <div class="fsi-ctx-row">
          <span class="fsi-ctx-lbl">League</span>
          <span class="fsi-ctx-val" id="fsi-league">—</span>
        </div>
        <div class="fsi-ctx-row">
          <span class="fsi-ctx-lbl">Stat Type</span>
          <select class="fsi-season-sel fsi-stat-sel" id="fsi-stat-select"></select>
        </div>
        <div class="fsi-stat-resolved" id="fsi-stat-resolved">
          → <span class="val" id="fsi-stat-resolved-val">—</span>
          <span class="fsi-mode-badge auto" id="fsi-mode-badge">auto</span>
        </div>
        <div class="fsi-ctx-row">
          <span class="fsi-ctx-lbl">Season</span>
          <select class="fsi-season-sel" id="fsi-season"></select>
        </div>
      </div>

      <textarea id="fsi-textarea" placeholder="Copy tabel dari Table Capture, lalu klik Paste ↓"></textarea>
      <div class="fsi-badge" id="fsi-badge"></div>

      <div class="fsi-btn-row">
        <button class="fsi-btn-paste" id="fsi-btn-paste">📋 Paste</button>
        <button class="fsi-btn-push" id="fsi-btn-push" disabled>
          <span class="fsi-spin" id="fsi-spin"></span>
          <span id="fsi-btn-label">🚀 Push API</span>
        </button>
      </div>

      <button class="fsi-btn-dl" id="fsi-btn-dl" disabled>⬇ Download CSV</button>
      <div class="fsi-status" id="fsi-status"></div>
      <div class="fsi-json-toggle" id="fsi-json-toggle">▶ Lihat JSON payload</div>
      <div class="fsi-json-box"   id="fsi-json-box"></div>
    </div>
  </div>
  `;

  // ============================================================
  // INJECT KE DOM
  // ============================================================
  var styleEl = document.createElement('style');
  styleEl.textContent = CSS;
  document.head.appendChild(styleEl);

  var rootEl = document.createElement('div');
  rootEl.id = 'fsi-root';
  rootEl.innerHTML = HTML;
  document.body.appendChild(rootEl);
  document.getElementById('fsi-ver').textContent = VERSION;

  // ============================================================
  // REFERENSI ELEMEN
  // ============================================================
  var fab        = document.getElementById('fsi-fab');
  var widget     = document.getElementById('fsi-widget');
  var btnMin     = document.getElementById('fsi-btn-min');
  var btnCfgTgl  = document.getElementById('fsi-btn-cfg-toggle');
  var cfgPanel   = document.getElementById('fsi-cfg-panel');
  var inpEndpt   = document.getElementById('fsi-endpoint');
  var inpKey     = document.getElementById('fsi-apikey');
  var elLeague     = document.getElementById('fsi-league');
  var elStatSelect = document.getElementById('fsi-stat-select');
  var elStatResVal = document.getElementById('fsi-stat-resolved-val');
  var elModeBadge  = document.getElementById('fsi-mode-badge');
  var elSeason   = document.getElementById('fsi-season');
  var textarea   = document.getElementById('fsi-textarea');
  var elBadge    = document.getElementById('fsi-badge');
  var btnPaste   = document.getElementById('fsi-btn-paste');
  var btnPush    = document.getElementById('fsi-btn-push');
  var btnLabel   = document.getElementById('fsi-btn-label');
  var spinEl     = document.getElementById('fsi-spin');
  var btnDl      = document.getElementById('fsi-btn-dl');
  var elStatus   = document.getElementById('fsi-status');
  var jsonToggle = document.getElementById('fsi-json-toggle');
  var jsonBox    = document.getElementById('fsi-json-box');

  // ============================================================
  // INIT — load config & context
  // ============================================================
  chrome.storage.local.get(
    ['apiEndpoint', 'apiKey', 'fsiCollapsed', 'selectedSeason', 'showConfig', PUSH_HISTORY_KEY],
    function (saved) {
      if (saved.apiEndpoint) {
        CFG.endpoint = saved.apiEndpoint;
        inpEndpt.value = saved.apiEndpoint;
      } else {
        // === PATCH 5 === endpoint lama (Edge Function) tidak dipakai lagi.
        CFG.endpoint = DEFAULT_ENDPOINT;
        inpEndpt.value = DEFAULT_ENDPOINT;
        chrome.storage.local.set({ apiEndpoint: DEFAULT_ENDPOINT });
      }
      if (saved.apiKey)      { CFG.apiKey   = saved.apiKey;      inpKey.value   = saved.apiKey; }
      if (saved[PUSH_HISTORY_KEY] && typeof saved[PUSH_HISTORY_KEY] === 'object') {
        pushHistory = saved[PUSH_HISTORY_KEY];
      }
      if (saved.showConfig)  openConfig(true);
      if (saved.fsiCollapsed === false) showWidget(true);

      buildStatTypeOptions();
      buildSeasonOptions(saved.selectedSeason);
      readContext();
    }
  );

  // ============================================================
  // STAT TYPE DROPDOWN (Auto-detect + manual override)
  // ============================================================
  function buildStatTypeOptions() {
    elStatSelect.innerHTML = '';

    var autoOpt = document.createElement('option');
    autoOpt.value = '__auto__';
    autoOpt.textContent = '🔍 Auto-detect';
    elStatSelect.appendChild(autoOpt);

    STAT_TYPE_OPTIONS.forEach(function (o) {
      var opt = document.createElement('option');
      opt.value = o.value;
      opt.textContent = o.label;
      elStatSelect.appendChild(opt);
    });

    elStatSelect.value = '__auto__';
  }

  elStatSelect.addEventListener('change', function () {
    if (elStatSelect.value === '__auto__') {
      statMode = 'auto';
      readContext(); // recompute dari URL
    } else {
      statMode = 'manual';
      ctx.stat_type = elStatSelect.value;
      updateStatResolvedDisplay();
      // Re-parse data yang sudah di-paste (jika ada) dengan stat_type baru
      if (textarea.value.trim()) onInput();
    }
  });

  function updateStatResolvedDisplay() {
    elStatResVal.textContent = ctx.stat_type || '—';
    elModeBadge.textContent  = statMode;
    elModeBadge.className    = 'fsi-mode-badge ' + statMode;
  }

  // ============================================================
  // DRAGGABLE HEADER
  // ============================================================
  var dragState = { on: false, startX: 0, startY: 0, origR: 0, origB: 0 };

  document.getElementById('fsi-header').addEventListener('mousedown', function (e) {
    if (e.target === btnMin) return;
    dragState.on     = true;
    dragState.startX = e.clientX;
    dragState.startY = e.clientY;
    var r = parseInt(widget.style.right  || '20', 10);
    var b = parseInt(widget.style.bottom || '20', 10);
    dragState.origR = r;
    dragState.origB = b;
    e.preventDefault();
  });

  document.addEventListener('mousemove', function (e) {
    if (!dragState.on) return;
    var dx = e.clientX - dragState.startX;
    var dy = e.clientY - dragState.startY;
    var newR = Math.max(0, dragState.origR - dx);
    var newB = Math.max(0, dragState.origB - dy);
    widget.style.right  = newR + 'px';
    widget.style.bottom = newB + 'px';
    fab.style.right  = newR + 'px';
    fab.style.bottom = newB + 'px';
  });

  document.addEventListener('mouseup', function () { dragState.on = false; });

  // ============================================================
  // FAB & MINIMIZE
  // ============================================================
  fab.addEventListener('click', function () { showWidget(true); });
  btnMin.addEventListener('click', function () { showWidget(false); });

  function showWidget(open) {
    widget.classList.toggle('hidden', !open);
    fab.classList.toggle('hidden', open);
    chrome.storage.local.set({ fsiCollapsed: !open });
  }

  // ============================================================
  // CONFIG PANEL
  // ============================================================
  btnCfgTgl.addEventListener('click', function () {
    var isOpen = cfgPanel.classList.contains('show');
    openConfig(!isOpen);
    chrome.storage.local.set({ showConfig: !isOpen });
  });

  function openConfig(open) {
    cfgPanel.classList.toggle('show', open);
    btnCfgTgl.textContent = open ? '⚙ Tutup Config' : '⚙ API Config';
  }

  inpEndpt.addEventListener('change', saveConfig);
  inpKey.addEventListener('change',   saveConfig);

  function saveConfig() {
    CFG.endpoint = inpEndpt.value.trim();
    CFG.apiKey   = inpKey.value.trim();
    chrome.storage.local.set({ apiEndpoint: CFG.endpoint, apiKey: CFG.apiKey });
  }

  // ============================================================
  // DETEKSI KONTEKS DARI URL
  // ============================================================
  function readContext() {
    var pathname   = window.location.pathname.replace(/^\//, '');
    var parts      = pathname.split('/').filter(Boolean);
    var rawPath    = parts.length >= 2 ? (parts[0] + '/' + parts[1]) : (parts[0] || '');
    var statType   = detectStatType(pathname);
    // === PATCH 1 === FootyStats memakai /{negara}/{kompetisi} dan slug liga di
    // database adalah gabungan keduanya: "spain" + "la-liga" → "spain-la-liga".
    // parts[1] saja menghasilkan "la-liga" — slug yang tidak pernah di-join.
    var leagueSlug = parts.length >= 2 ? (parts[0] + '-' + parts[1]) : (parts[0] || '');

    // Navigasi ke halaman baru → reset ke mode auto (URL sebelumnya sudah tidak relevan)
    statMode = 'auto';
    elStatSelect.value = '__auto__';

    ctx = { raw_url_path: rawPath, stat_type: statType, season: elSeason.value || '', league_slug: leagueSlug };

    elLeague.textContent = leagueSlug ? leagueSlug.replace(/-/g, ' ') : '—';
    elLeague.className   = 'fsi-ctx-val' + (leagueSlug ? '' : ' none');

    updateStatResolvedDisplay();

    textarea.value = '';
    payload = null;

    // Jika URL tidak mengandung slug stats (mis. halaman musim lalu:
    // .../premier-league#), beri hint agar user pilih manual
    if (!statType || statType === 'stats_unknown') {
      setBadge('warn', '⚠️ Stat type tidak terdeteksi dari URL — pilih manual di dropdown ↑');
    } else {
      setBadge('', '');
    }
    elStatus.className = 'fsi-status';
    jsonToggle.className = 'fsi-json-toggle';
    jsonBox.className    = 'fsi-json-box';
    showStaleness();
    updateUI();
  }

  function detectStatType(pathname) {
    var p = pathname.toLowerCase();
    
    // 1. Cek dulu berdasarkan kamus STAT_TYPE_MAP (Metode paling aman)
    for (var i = 0; i < STAT_TYPE_MAP.length; i++) 
{
      var entry = STAT_TYPE_MAP[i];
      for (var j = 0; j < entry.keywords.length; j++) {
        if (p.indexOf(entry.keywords[j]) !== -1) return entry.stat;
      }
}
   

    // 2. Fallback: Jika tidak ketemu di kamus, ambil bagian terakhir URL
    var parts = p.split('/').filter(Boolean);
    if (parts.length === 0) return 'stats_unknown';
    
    var last = parts.pop(); // Ambil elemen terakhir
    
    // Pastikan last adalah string dan bersihkan dari karakter aneh
    if (typeof last !== 'string') return 'stats_unknown';
    
    // Bersihkan: ganti strip dengan underscore, hapus karakter non-alfanumerik
    var sanitized = last.replace(/-/g, '_').replace(/[^a-z0-9_]/g, '');
    
    // Jika setelah dibersihkan ternyata kosong, kembalikan unknown
    return sanitized ? ('stats_' + sanitized) : 'stats_unknown';
  }
  // ============================================================
  // SEASON DROPDOWN
  // ============================================================
  function buildSeasonOptions(savedSeason) {
    var now      = new Date();
    var year     = now.getFullYear();
    var month    = now.getMonth() + 1;
    var curY     = month >= 8 ? year : year - 1;
    var prevY    = curY - 1;
    var prev2Y   = curY - 2;

    function fmt(y) { return y + '-' + String(y + 1).slice(2); }

    var weeksSince = Math.floor((now - new Date(curY, 7, 1)) / (7 * 24 * 3600 * 1e3));
    var useCur     = weeksSince >= 5;

    var choices = [
      { v: fmt(curY),   label: fmt(curY)   + (useCur ? ' (aktif)'       : ' (baru ~' + Math.max(0, weeksSince) + ' pekan)') },
      { v: fmt(prevY),  label: fmt(prevY)  + (useCur ? ' (sebelumnya)'  : ' (aktif)')                                       },
      { v: fmt(prev2Y), label: fmt(prev2Y)                                                                                    }
    ];
    if (!useCur) choices = [choices[1], choices[0], choices[2]];

    elSeason.innerHTML = '';
    choices.forEach(function (c) {
      var opt = document.createElement('option');
      opt.value = c.v; opt.textContent = c.label;
      elSeason.appendChild(opt);
    });

    var vals = choices.map(function (c) { return c.v; });
    if (savedSeason && vals.indexOf(savedSeason) !== -1) elSeason.value = savedSeason;
    if (ctx) ctx.season = elSeason.value;
  }

  elSeason.addEventListener('change', function () {
    ctx.season = elSeason.value;
    chrome.storage.local.set({ selectedSeason: elSeason.value });
    if (textarea.value.trim()) onInput();
  });

  // ============================================================
  // PASTE DARI CLIPBOARD
  // ============================================================
  btnPaste.addEventListener('click', function () {
    textarea.focus();
    if (navigator.clipboard && navigator.clipboard.readText) {
      navigator.clipboard.readText()
        .then(function (text) {
          if (!text.trim()) {
            showStatus('warn', '⚠️ Clipboard kosong. Copy dulu dari Table Capture.');
            return;
          }
          textarea.value = text;
          onInput();
          showStatus('ok', '✓ Data clipboard berhasil dibaca');
        })
        .catch(function () {
          textarea.placeholder = 'Izin clipboard ditolak browser.\nKlik area ini lalu tekan Ctrl+V.';
          showStatus('warn', '⚠️ Tekan Ctrl+V di area teks untuk paste manual.');
        });
    } else {
      showStatus('warn', '⚠️ Tekan Ctrl+V di area teks untuk paste manual.');
    }
  });

  textarea.addEventListener('input', onInput);
  textarea.addEventListener('paste', function () { setTimeout(onInput, 0); });

  // ============================================================
  // PARSE INPUT
  // ============================================================
  function onInput() {
    payload = null;
    updateUI();
    var raw = textarea.value.trim();
    if (!raw) { setBadge('', ''); jsonToggle.className = 'fsi-json-toggle'; return; }

    var result = parsePaste(raw);
    if (!result) { setBadge('err', '❌ Gagal parse — pastikan copy dengan benar dari Table Capture'); return; }

    // Auto-detect stat_type dari header paste — override URL detection
    // untuk halaman yang memuat beberapa tabel (mis. over-25-goals-table).
    // TIDAK dijalankan jika user sudah memilih stat_type manual dari dropdown —
    // pilihan manual selalu menang.
    if (statMode !== 'manual') {
      var headerStat = detectStatTypeFromHeaders(result.headers || []);
      if (headerStat === null) {
        // null = tabel ini tidak di-track (o0.5, o1.5, o4.5, o5.5)
        setBadge('err', '⚠️ Tabel ini tidak di-track (hanya Over 2.5 & Over 3.5 yang disimpan). Atau pilih manual di dropdown ↑');
        return;
      }
      if (headerStat !== undefined) {
        ctx.stat_type = headerStat; // override URL-based detection
        updateStatResolvedDisplay();
      }
    }

    if (!ctx.stat_type || ctx.stat_type === 'stats_unknown') {
      setBadge('err', '❌ Stat type belum ditentukan — pilih manual di dropdown ↑');
      return;
    }

    payload = buildPayload(result);

    // === PATCH 4 === guard juga berlaku di mode manual — di sinilah tabel
    // "Goals Conceded" sebelumnya lolos sebagai stats_goals_scored.
    var contradiction = describeContradiction(payload.stat_type, payload.teams);
    if (contradiction) {
      payload = null; // matikan tombol Push: data ini tidak boleh dikirim
      setBadge('err', contradiction.split('\n')[0]);
      showStatus('err', contradiction);
      updateUI();
      return;
    }

    var colCount = (result.headers && result.headers.length) ? result.headers.length : Object.keys((result.rows[0] || {}).stat_data || {}).length;
    setBadge('ok', '✓ ' + result.rows.length + ' tim · ' + colCount + ' kolom');
    showJsonPreview(payload);
    updateUI();
  }

 // ============================================================
  // SMART TSV PARSER (FIXED FOR FOOTYSTATS MULTI-COLUMN)
  // ============================================================
  // ============================================================
  // PARSER: Right-align strategy + Next Match fix + apostrophe handling
  // ============================================================
  var NON_STAT_HEADER_RE = /^(#|no\.?|team|club|name|klub|badge|logo)$/i;
  // Kolom yang dibuang dari stat_data (tidak relevan untuk analisis)
  var SKIP_STAT_HEADER_RE = /^next\s*match$/i;

  function extractTeamName(identityCols) {
    var candidates = identityCols.filter(function(c) {
      return c && isNaN(Number(c));
    });
    if (candidates.length === 0) return null;

    candidates = candidates.map(function(c) {
      // Fix apostrof terpotong: "Côte d" → tetap, tidak bisa recover
      // tapi minimal bersihkan Badge/Logo
      var dupMatch = c.match(/^(.+?)\s+(?:Logo|Badge)\s+\1$/i);
      if (dupMatch) return dupMatch[1].trim();
      return c.replace(/^\s*(Logo|Badge)\s+/i, '').replace(/\s*(Logo|Badge)\s*$/i, '').trim();
    }).filter(Boolean);
    if (candidates.length === 0) return null;

    // Tangani card-stat-panel mega-text
    candidates = candidates.map(function(teamName) {
      if (teamName.length > 60 || /\bLeague Pos\.\b|\bStatistics\b|\bWin %|\bUpgrade to FootyStats\b/i.test(teamName)) {
        var words = teamName.split(/\s+/);
        var candidate = [];
        var stopWords = ['Serie', 'League', 'Premier', 'La', 'Bundesliga', 'Ligue', 'Form', 'Statistics', 'Overall', 'Want'];
        for (var w = 0; w < words.length; w++) {
          if (stopWords.indexOf(words[w]) !== -1) break;
          candidate.push(words[w]);
          if (candidate.length >= 4) {
            var half = candidate.length / 2;
            if (Number.isInteger(half)) {
              var first = candidate.slice(0, half).join(' ');
              var second = candidate.slice(half).join(' ');
              if (first === second) { candidate = candidate.slice(0, half); break; }
            }
          }
        }
        return candidate.length ? candidate.join(' ') : teamName.slice(0, 40).trim();
      }
      return teamName;
    });

    if (candidates.length > 1) return candidates[candidates.length - 1];
    return candidates[0];
  }

  function parsePaste(raw) {
    var lines = raw.split(/\r?\n/).filter(function (l) { return l.trim(); });
    if (lines.length < 2) return null;

    var parsed = lines.map(function(line) { return line.split('\t').map(function(c) { return c.trim(); }); });
    var rawHeaders = parsed[0];
    var rawDataRows = parsed.slice(1);
    if (rawDataRows.length === 0) return null;

    // Kolom stat = semua header yang bukan identitas dan bukan skip
    var headers = [];
    for (var hi = 0; hi < rawHeaders.length; hi++) {
      var hv = rawHeaders[hi].trim();
      if (NON_STAT_HEADER_RE.test(hv)) continue;
      if (SKIP_STAT_HEADER_RE.test(hv)) continue; // buang "Next Match"
      if (!hv) continue;
      headers.push(hv);
    }
    var statColCount = headers.length;

    // Hitung berapa banyak kolom "Next Match" dan posisinya di rawHeaders
    // sehingga kita bisa buang kolom tersebut dari data row juga
    var skipColPositions = [];
    for (var si = 0; si < rawHeaders.length; si++) {
      if (SKIP_STAT_HEADER_RE.test(rawHeaders[si].trim())) {
        skipColPositions.push(si);
      }
    }

    var rows = [];
    for (var r = 0; r < rawDataRows.length; r++) {
      var row = rawDataRows[r];

      // Jika ada kolom "Next Match" di header, buang kolom di posisi yang sama dari data row
      // SEBELUM menghitung identityCols/statValues
      // Ini penting karena "Next Match" bisa mengandung tab tersembunyi → row jadi lebih panjang
      // Strategi: rebuild row tanpa kolom skip, tapi hati-hati dengan row yang sudah lebih panjang.
      // Kita buang kolom skipColPositions dari row HANYA jika row.length == rawHeaders.length
      // (artinya tidak ada tab tersembunyi). Kalau row lebih panjang, kita trim dari kanan.
      var cleanRow = row;
      if (skipColPositions.length > 0) {
        if (row.length === rawHeaders.length) {
          // Buang kolom skip
          cleanRow = row.filter(function(_, idx) {
            return skipColPositions.indexOf(idx) === -1;
          });
        } else {
          // Row lebih panjang dari header (tab tersembunyi di Next Match)
          // Trim row ke panjang = rawHeaders.length - skipColPositions.length
          var targetLen = rawHeaders.length - skipColPositions.length;
          cleanRow = row.slice(0, targetLen);
        }
      }

      if (cleanRow.length <= statColCount) continue;

      var identityCols = cleanRow.slice(0, cleanRow.length - statColCount);
      var statValues   = cleanRow.slice(cleanRow.length - statColCount);

      var teamName = extractTeamName(identityCols);
      if (!teamName) continue;

      var obj = {};
      headers.forEach(function(hd, idx) {
        obj[hd] = statValues[idx] !== undefined ? statValues[idx] : '';
      });

      rows.push({ raw_team_name: teamName, stat_data: obj });
    }

    return { rows: rows, headers: headers };
  }


  // ============================================================
  // BUILD PAYLOAD (Sesuaikan dengan format baru)
  // ============================================================
  function buildPayload(result) {
    ctx.season = elSeason.value;
    return {
      raw_url_path: ctx.raw_url_path,
      // === PATCH 7 === slug lengkap (negara-kompetisi) ikut dikirim supaya
      // server tidak perlu menebak dari raw_url_path.
      league_slug:  ctx.league_slug || '',
      stat_type:    ctx.stat_type || 'stats_unknown',
      season:       ctx.season,
      teams:        result.rows // Langsung pakai hasil rows yang sudah rapi
    };
  }

  // ============================================================
  // PUSH TO API
  // ============================================================
  btnPush.addEventListener('click', function () {
    if (!payload) return;

    if (!CFG.endpoint) {
      showStatus('warn', '⚠️ Isi API Endpoint di ⚙ API Config.');
      openConfig(true); return;
    }
    if (!CFG.apiKey) {
      showStatus('warn', '⚠️ Isi API Key di ⚙ API Config.');
      openConfig(true); return;
    }

    var sent = payload; // payload bisa berubah kalau user paste lagi saat request jalan

    // === PATCH 4 === pertahanan terakhir: jangan pernah kirim blok yang
    // labelnya bertentangan dengan kolom tujuan, apa pun yang terjadi di UI.
    var contradiction = describeContradiction(sent.stat_type, sent.teams);
    if (contradiction) {
      showStatus('err', contradiction);
      return;
    }

    setLoading(true);

    fetch(CFG.endpoint, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': CFG.apiKey },
      body:    JSON.stringify(sent)
    })
    .then(function (res) {
      var status = res.status;
      return res.text().then(function (text) {
        var body = null;
        try { body = JSON.parse(text); } catch (e) { body = null; }
        var head = 'Stat: ' + sent.stat_type + ' · Season: ' + sent.season +
                   ' · ' + sent.teams.length + ' tim';

        if (status >= 200 && status < 300) {
          // === PATCH 6 === server mengembalikan result_rows[] per tim; tim yang
          // ditolak (mis. blok tidak cocok, slug aneh) sebelumnya tidak terlihat.
          var rows   = (body && (body.result_rows || body.details || body.results)) || [];
          var failed = rows.filter(function (r) { return r && r.success === false; });
          var okCount   = body && typeof body.success_count === 'number' ? body.success_count : (sent.teams.length - failed.length);
          var failCount = body && typeof body.fail_count === 'number' ? body.fail_count : failed.length;

          recordPush(sent.league_slug || ctx.league_slug, sent.season, sent.stat_type);

          if (failCount > 0) {
            var lines = failed.slice(0, 6).map(function (r) {
              return '• ' + (r.team || 'UNKNOWN') + ': ' + (r.error || 'gagal');
            });
            if (failed.length > 6) lines.push('• +' + (failed.length - 6) + ' tim lain');
            showStatus('warn',
              '⚠️ ' + okCount + ' tersimpan, ' + failCount + ' ditolak\n' + head + '\n' + lines.join('\n'));
          } else {
            showStatus('ok', '✅ ' + okCount + ' tim tersimpan\n' + head +
              (body && body.league_slug ? '\nLiga: ' + body.league_slug : ''));
          }
          return;
        }

        // === PATCH 6 === tampilkan alasan penolakan yang sebenarnya, bukan
        // hanya `message` yang sering kosong pada respons 4xx/422.
        var detail = (body && (body.error || body.message)) || text || '(tanpa pesan)';
        var rejected = (body && body.rejected) || [];
        if (rejected.length) {
          detail += '\n' + rejected.slice(0, 5).map(function (r) {
            return '• ' + (r.team || 'UNKNOWN') + ': ' + (r.reason || 'ditolak');
          }).join('\n');
        }
        var suggestions = (body && body.suggestions) || [];
        if (suggestions.length) detail += '\nSlug mirip: ' + suggestions.join(', ');
        if (body && body.resolved_slug) detail += '\nSlug terbaca: ' + body.resolved_slug;

        showStatus('err', '❌ HTTP ' + status + '\n' + detail);
      });
    })
    .catch(function (e) {
      showStatus('err',
        '❌ Koneksi gagal:\n' + e.message +
        '\nPastikan host endpoint ada di host_permissions manifest.json.');
    })
    .finally(function ()  { setLoading(false); });
  });

  // ============================================================
  // DOWNLOAD CSV
  // ============================================================
  btnDl.addEventListener('click', function () {
    if (!payload) return;
    var teams    = payload.teams;
    var statType = payload.stat_type;
    var season   = payload.season;
    if (!teams.length) return;

    var statKeys = Object.keys(teams[0].stat_data);
    var hdrs     = ['Team'].concat(statKeys);

    function esc(v) {
      var s = String(v == null ? '' : v).replace(/\r?\n/g, ' ').trim();
      return (s.indexOf(';') !== -1 || s.indexOf('"') !== -1) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }

    var rows = teams.map(function (t) {
      return [t.raw_team_name].concat(statKeys.map(function (k) { return t.stat_data[k] || ''; })).map(esc).join(';');
    });

    var csv      = '\uFEFF' + [hdrs.map(esc).join(';')].concat(rows).join('\r\n');
    var league   = ctx.league_slug.replace(/[^a-z0-9]/gi, '-') || 'unknown';
    var filename = league + '_' + statType + '_' + season + '.csv';

    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    var url  = URL.createObjectURL(blob);
    var a    = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showStatus('ok', '✅ Downloaded: ' + filename);
  });

  // ============================================================
  // JSON PREVIEW TOGGLE
  // ============================================================
  jsonToggle.addEventListener('click', function () {
    jsonOpen = !jsonOpen;
    jsonBox.className    = 'fsi-json-box'    + (jsonOpen ? ' show' : '');
    jsonToggle.className = 'fsi-json-toggle' + (jsonOpen ? ' show' : '');
    jsonToggle.textContent = (jsonOpen ? '▼' : '▶') + ' Lihat JSON payload';
  });

  function showJsonPreview(data) {
    jsonBox.textContent    = JSON.stringify(data, null, 2);
    jsonOpen               = true;
    jsonBox.className      = 'fsi-json-box show';
    jsonToggle.className   = 'fsi-json-toggle show';
    jsonToggle.textContent = '▼ Lihat JSON payload';
  }

  // ============================================================
  // UI HELPERS
  // ============================================================
  function updateUI() {
    var ok = !!payload;
    btnPush.disabled = !ok;
    btnDl.disabled   = !ok;
  }

  function setLoading(on) {
    btnPush.disabled       = on;
    btnPush.className      = 'fsi-btn-push' + (on ? ' loading' : '');
    spinEl.style.display   = on ? 'block' : 'none';
    btnLabel.textContent   = on ? 'Mengirim...' : '🚀 Push API';
  }

  function setBadge(type, msg) {
    elBadge.textContent = msg;
    elBadge.className   = 'fsi-badge' + (type ? ' ' + type : '');
  }

  function showStatus(type, msg) {
    elStatus.className   = 'fsi-status ' + type;
    elStatus.textContent = msg;
  }

  // ============================================================
  // SPA NAVIGATION
  // ============================================================
  var lastHref = location.href;

  function onNavigation() {
    if (location.href !== lastHref) {
      lastHref = location.href;
      readContext();
    }
  }

  (function () {
    var orig = history.pushState;
    history.pushState = function () {
      orig.apply(history, arguments);
      onNavigation();
    };
    var origR = history.replaceState;
    history.replaceState = function () {
      origR.apply(history, arguments);
      onNavigation();
    };
  })();

  window.addEventListener('popstate', onNavigation);
  setInterval(onNavigation, 2000);

})();