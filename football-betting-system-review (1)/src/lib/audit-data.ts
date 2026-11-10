export type Area = "data" | "analisis" | "penggunaan" | "kematangan" | "pembelajaran";
export type Severity = "kritis" | "tinggi" | "sedang";
export type FixStatus = "diimplementasi" | "butuh-integrasi" | "rekomendasi";

export interface Finding {
  id: string;
  area: Area;
  severity: Severity;
  title: string;
  /** bukti di repo par-lay */
  evidence: string[];
  impact: string;
  fix: string;
  status: FixStatus;
  module?: string;
}

export const AREA_LABEL: Record<Area, string> = {
  data: "Pemilihan Data",
  analisis: "Proses Analisis",
  penggunaan: "Penggunaan Data (Staking & Parlay)",
  kematangan: "Kematangan Analisa",
  pembelajaran: "Pembelajaran Mandiri",
};

export const findings: Finding[] = [
  /* ───────────── DATA ───────────── */
  {
    id: "D1",
    area: "data",
    severity: "kritis",
    title: "Tidak ada closing odds → CLV tidak bisa diukur",
    evidence: [
      "services/odds-fetcher.ts: sync tiap 3 jam, cap 80 event/siklus",
      "odds_movement_history hanya ditulis saat odds berubah",
      "tidak ada kolom odds_close / closing fair probability",
    ],
    impact:
      "CLV adalah satu-satunya metrik yang konvergen dalam puluhan bet. Tanpa itu sistem hanya bisa menilai diri lewat hit-rate/ROI yang butuh ratusan–ribuan bet. Snapshot terakhir sebelum kickoff bisa berumur sampai 3 jam.",
    fix:
      "Job T-10 menit khusus fixture yang punya prediksi aktif (hemat kuota: hanya fixture yang di-bet), simpan odds_close + de-vig. Ledger baru sudah punya kolom & perhitungan CLV.",
    status: "butuh-integrasi",
    module: "evaluation.ts → clvOf, summarizeLedger",
  },
  {
    id: "D2",
    area: "data",
    severity: "tinggi",
    title: "Satu bandar soft (Bet365 free plan), tanpa referensi sharp",
    evidence: [
      ".agents/memory/odds-api-free-bookmaker.md: hanya Bet365 yang berhasil; Sbobet butuh plan berbayar",
    ],
    impact:
      "Harga bandar soft mengandung margin lebih besar dan bergerak karena manajemen risiko sendiri, bukan hanya informasi. 'Sharp money' yang dibaca dari satu soft-book sering hanya noise. Tidak ada harga acuan efisien untuk menilai kebenaran probabilitas.",
    fix:
      "Tambahkan SATU sumber harga sharp (Pinnacle/Sbobet/exchange) hanya sebagai acuan fair-probability & closing. Bet tetap boleh di bandar Anda. Pipeline sudah menerima odds apa pun dan melakukan de-vig.",
    status: "butuh-integrasi",
    module: "devig.ts, pipeline.ts",
  },
  {
    id: "D3",
    area: "data",
    severity: "tinggi",
    title: "Identitas tim lewat fuzzy-name; statistik ter-skip dan label musim tidak cocok",
    evidence: [
      "attached_assets/Pasted-Info-untuk-debug-7-dari-16-tim-skipped…: 7 dari 16 tim CSL ter-skip",
      "payload CSL memakai season '2025-26' padahal CSL liga kalender; sampel MP = 6",
      "lib/team-name-map.ts, team-name-cleaner.ts, team-stats-merge.ts (alias manual)",
    ],
    impact:
      "Tim yang tidak cocok → statistik kosong/salah pasangan tanpa disadari. Alias manual tidak skala-able dan 'ambiguous' match (United/City, Real/…) bisa menyatukan klub berbeda.",
    fix:
      "Tabel teams kanonik (team_id) + team_aliases per liga/provider; ingest menolak nama tak dikenal ke antrean review, bukan skip diam-diam. Simpan season_type (calendar/european) per liga.",
    status: "butuh-integrasi",
  },
  {
    id: "D4",
    area: "data",
    severity: "tinggi",
    title: "Tidak ada data informasi laga (line-up, cedera, jadwal padat, motivasi)",
    evidence: [
      "research/notes.md: API-Football/NewsAPI masih 'researching', belum terintegrasi",
      "persona: informasi ini hanya disimpulkan dari pergerakan odds",
    ],
    impact:
      "Faktor yang paling sering membuat statistik musiman menyesatkan tidak masuk model. LLM ditugaskan menebaknya dari angka odds — itu inferensi, bukan data.",
    fix:
      "Pipeline berita/line-up → LLM sebagai EKSTRAKTOR berbukti (persona v5): hanya boleh menggeser λ ±12% dengan bukti URL. Tanpa bukti → pengali 1.00.",
    status: "diimplementasi",
    module: "llm-contract.ts → PERSONA_V5, strength.ts → sanitizeLlmAdjustment",
  },
  {
    id: "D5",
    area: "data",
    severity: "sedang",
    title: "Statistik berupa persentase agregat tanpa penyesuaian lawan & recency",
    evidence: ["11 'laci' stats: BTTS%, Over 2.5%, FTS%, Under, Shots… ditempel sebagai JSON ke prompt"],
    impact:
      "BTTS 60% dari tim yang melawan lawan lemah ≠ BTTS 60% melawan lawan kuat. Persentase mentah tidak membawa informasi kekuatan relatif dan sebagian besar redundan satu sama lain (Over 2.5, BTTS, GF/GA berkorelasi tinggi) sehingga memberi ilusi '11 konfirmasi independen'.",
    fix:
      "Kurangi ke inti prediktif: gol & xG for/against per laga, dinormalisasi ke rata-rata liga, di-shrink ke prior. Sisanya (BTTS%, Over%) cukup jadi cek kewajaran, bukan sinyal.",
    status: "diimplementasi",
    module: "strength.ts → modelLambdas",
  },
  {
    id: "D6",
    area: "data",
    severity: "sedang",
    title: "Kesegaran statistik diukur dari updated_at, bukan dari tanggal laga terakhir",
    evidence: ["lib/team-stats-freshness.ts: TEAM_STATS_STALE_DAYS = 14 dibandingkan updated_at"],
    impact:
      "Statistik yang di-upload kemarin tetapi dihitung sampai 3 minggu lalu terlihat 'segar'.",
    fix: "Simpan through_match_date dan matches_played pada tiap upload; gerbang berdasarkan jumlah laga baru sejak statistik itu.",
    status: "butuh-integrasi",
  },
  {
    id: "D7",
    area: "data",
    severity: "sedang",
    title: "Label musim di prompt memakai tahun kalender",
    evidence: ["services/ai-analysis.ts buildPrompt: `MUSIM BERJALAN (${getFullYear()})` / `${getFullYear() - 1}`"],
    impact:
      "Untuk liga Eropa (musim 2025/26) pada Januari 2026 prompt menulis 'berjalan 2026, sebelumnya 2025' — ambigu dan bisa membuat LLM menukar prioritas musim.",
    fix: "Gunakan season_id eksplisit per liga (mis. '2025-26' vs '2026') dari tabel liga, bukan tahun kalender. Dengan shrinkage Bayesian, label tidak lagi menentukan keputusan.",
    status: "rekomendasi",
  },

  /* ───────────── ANALISIS ───────────── */
  {
    id: "A1",
    area: "analisis",
    severity: "kritis",
    title: "Probabilitas 'nyata' ditulis oleh LLM, bukan dihitung",
    evidence: [
      "services/ai-analysis.ts DEFAULT_SYSTEM_INSTRUCTION: 'Prob. Nyata' diisi Gemini; extractPredictionRecommendation membaca selection.probability",
      "generateWithGroq temperature 0.2 + AI_PROVIDER=auto: fallback Groq mengganti 'estimator' diam-diam",
    ],
    impact:
      "LLM bukan estimator probabilitas terkalibrasi: tidak melakukan aritmetika andal, tidak koheren antar-market (p Over 2.5, BTTS, 1X2 bisa bertentangan), tidak deterministik, dan berbeda antar provider. Seluruh rantai EV → Kelly → parlay berdiri di atas angka ini. Ini kelemahan #1 sistem.",
    fix:
      "Mesin probabilitas deterministik: Poisson + Dixon-Coles dari SATU matriks skor sehingga semua market koheren. LLM dipensiunkan dari peran penghasil angka.",
    status: "diimplementasi",
    module: "poisson.ts, strength.ts, pipeline.ts",
  },
  {
    id: "A2",
    area: "analisis",
    severity: "kritis",
    title: "Tidak ada de-vig: '(1/odds)' dianggap probabilitas implisit",
    evidence: [
      "ai-analysis.ts impliedProb(): (1/odds)*100",
      "persona prinsip #1: 'Prob. implisit bandar = (1/Odds) × 100%'",
    ],
    impact:
      "Σ(1/odds) pada 1X2 tipikal 104–108%. Tanpa menghapus margin, probabilitas pasar bias dan perbandingan 'prob nyata vs implisit' tidak bermakna. Metode proporsional juga bias terhadap longshot (favourite-longshot bias).",
    fix: "De-vig dengan Shin (default) / power / proporsional; semua perbandingan memakai fair probability.",
    status: "diimplementasi",
    module: "devig.ts",
  },
  {
    id: "A3",
    area: "analisis",
    severity: "kritis",
    title: "Pasar tidak dipakai sebagai prior; 'value' = selisih LLM vs harga",
    evidence: ["persona: EV = (p_LLM × odds) − 1; tidak ada baseline pasar dalam estimasi"],
    impact:
      "Pada pasar yang cukup efisien, selisih besar antara estimasi sendiri dan harga hampir selalu berarti ESTIMASI Anda yang salah, bukan pasar. Sistem justru memberi hadiah pada selisih terbesar.",
    fix:
      "Model berjangkar pasar: invers harga fair → λ pasar; λ akhir = pooling geometrik(λ pasar, λ model; bobot w kecil). Edge hanya muncul bila model punya informasi tambahan; w dipelajari dari ledger.",
    status: "diimplementasi",
    module: "poisson.ts → fitMarketLambdas, blend.ts",
  },
  {
    id: "A4",
    area: "analisis",
    severity: "tinggi",
    title: "Winner's curse: memilih EV tertinggi dari banyak market ber-noise",
    evidence: ["kontrak prompt: 'Bandingkan semua market… pilih tepat satu' (ML, HT, Totals, AH, BTTS + banyak garis)"],
    impact:
      "Dari 6–20 estimasi ber-noise, yang dipilih secara sistematis adalah yang paling dioverestimasi. Simulasi demo di app ini (160 bet, model tanpa shrinkage): EV yang diklaim ≈ +16%, tetapi ROI nyata ≈ −3% dan CLV ≈ −3% — vonis otomatis 'refuted'.",
    fix: "EV konservatif = EV − σ·odds (σ naik saat data sedikit), minEv nominal, peringatan jumlah market dibandingkan.",
    status: "diimplementasi",
    module: "pipeline.ts → SelectionEval.evConservative",
  },
  {
    id: "A5",
    area: "analisis",
    severity: "tinggi",
    title: "Aturan 'odds turun > 0.10 → menang lawan statistik' tidak skala-invarian",
    evidence: ["persona prinsip #5 + ANALISIS TREN PASAR; formatOddsMovementTrend memakai selisih odds absolut 0.05/0.10"],
    impact:
      "0.10 pada odds 1.30 ≈ 5.9 poin probabilitas implisit; pada odds 4.00 ≈ 0.6 poin. Ambang yang sama berarti hal berbeda. Satu bandar soft juga bergerak karena eksposur sendiri.",
    fix: "Pasar sudah jadi prior permanen (A3). Pergerakan dinilai pada skala probabilitas fair, bukan odds mentah, dan hanya sebagai fitur setelah tervalidasi di ledger.",
    status: "diimplementasi",
    module: "blend.ts",
  },
  {
    id: "A6",
    area: "analisis",
    severity: "tinggi",
    title: "Confidence 0–10 (self-report LLM) dipakai sebagai gerbang keputusan",
    evidence: [
      "routes/analyze.ts: recommendation.confidence >= 6.5",
      "services/parlay-builder.ts: confidence < 6.5 ditolak; learning-policy.ts minConfidence",
    ],
    impact: "Angka ini tidak terkalibrasi dan tidak terbukti berkorelasi dengan hasil, tetapi menjadi filter di scanner, parlay, dan kebijakan belajar.",
    fix: "Gerbang = EV konservatif, kualitas data, dan kinerja CLV historis. Confidence hanya informasi.",
    status: "diimplementasi",
    module: "pipeline.ts (passes / rejectReasons)",
  },
  {
    id: "A7",
    area: "analisis",
    severity: "sedang",
    title: "Jalur fallback probabilitas dari prosa masih ada",
    evidence: ["lib/kelly-criterion.ts extractProbFromPrediction (regex 'prob. nyata: 55%')"],
    impact: "Walau fail-closed, ini tetap jalur mengubah teks bebas menjadi angka taruhan.",
    fix: "Hapus setelah A1 terintegrasi; probabilitas hanya dari mesin.",
    status: "rekomendasi",
  },
  {
    id: "A8",
    area: "analisis",
    severity: "sedang",
    title: "Market HT dan market lain tanpa model sendiri",
    evidence: ["ai-analysis.ts: HT termasuk MARKET_FAMILIES tetapi hanya 'HT Win/Loss %' mentah"],
    impact: "Tanpa model setengah-waktu, probabilitas HT hanya tebakan LLM.",
    fix: "Sampai ada model λ_HT (≈ 45% λ penuh, dikalibrasi), perlakukan HT sebagai NO_BET.",
    status: "rekomendasi",
  },

  /* ───────────── PENGGUNAAN ───────────── */
  {
    id: "U1",
    area: "penggunaan",
    severity: "kritis",
    title: "Parlay: error probabilitas dan margin bandar menumpuk perkalian",
    evidence: ["services/parlay-builder.ts calculateParlayMetrics: winProbability = Π p_i; EV = P × Π odds − 1"],
    impact:
      "Jika tiap leg dioverestimasi 3 poin, parlay 4-leg dioverestimasi ≈ 20% relatif. Margin 5%/leg pada 5 leg ≈ 22% nilai hilang. Parlay memperbesar kelemahan A1–A4 secara eksponensial.",
    fix: "Analisis parlay: independen vs berkorelasi (copula), skenario pesimis (p−σ), titik impas bias per-leg, dan margin yang dibayar. Keputusan memakai nilai terkecil.",
    status: "diimplementasi",
    module: "parlay.ts → analyzeParlay",
  },
  {
    id: "U2",
    area: "penggunaan",
    severity: "tinggi",
    title: "Parlay tidak mensyaratkan EV positif per leg; batas 7 leg",
    evidence: ["parlay-builder.ts createMergedParlay: hanya odds>1, confidence≥6.5, 0<p<1; maks 7 leg"],
    impact: "Leg EV-negatif lolos selama 'confidence' tinggi; 7 leg memperlebar varians dan perkalian error.",
    fix: "Setiap leg wajib lolos EV konservatif; default maks 3–4 leg sampai CLV terbukti positif.",
    status: "butuh-integrasi",
  },
  {
    id: "U3",
    area: "penggunaan",
    severity: "tinggi",
    title: "Kelly memakai p mentah LLM; stake hingga 5% per bet",
    evidence: ["lib/kelly-criterion.ts: bucket '5% (max)'; persona: 'maks 5% jika confidence > 9.5'"],
    impact: "Kelly sangat sensitif terhadap p; error 3 poin dapat menggandakan stake. 5% per bet pada edge yang belum terbukti → risiko drawdown besar.",
    fix: "Quarter-Kelly dengan p − z·σ dan cap 2% bankroll. Stake dikalikan stakingMode() (circuit breaker CLV).",
    status: "diimplementasi",
    module: "kelly.ts → stakePlan, evaluation.ts → stakingMode",
  },
  {
    id: "U4",
    area: "penggunaan",
    severity: "sedang",
    title: "Tidak ada manajemen eksposur harian / drawdown",
    evidence: ["tidak ditemukan batas eksposur gabungan, stop-loss, atau jeda otomatis"],
    impact: "Banyak bet berkorelasi pada hari yang sama (liga/market sama) menumpuk risiko.",
    fix: "Batas eksposur harian ≤ 5% bankroll, batas per liga; jeda otomatis dari stakingMode().",
    status: "rekomendasi",
  },
  {
    id: "U5",
    area: "penggunaan",
    severity: "sedang",
    title: "Harga saat bet tidak dibandingkan dengan harga saat analisis",
    evidence: ["prediksi immutable per fixture; validitas odds 3 jam (MAX_VERIFIED_ODDS_AGE_MS)"],
    impact: "Edge 3% bisa hilang dalam beberapa menit; bet pada harga lebih buruk adalah EV negatif.",
    fix: "Setiap rekomendasi membawa minOdds (odds minimum agar EV ≥ batas); jangan bet di bawah itu.",
    status: "diimplementasi",
    module: "pipeline.ts → minOdds",
  },

  /* ───────────── KEMATANGAN ───────────── */
  {
    id: "M1",
    area: "kematangan",
    severity: "kritis",
    title: "Tidak ada pengukuran apakah sistem benar-benar punya edge",
    evidence: ["performance_log: wins/losses/hit_rate/total_roi harian; tanpa CI, tanpa baseline pasar, tanpa CLV"],
    impact:
      "Pada odds ≈ 2.0 simpangan baku satu bet ≈ 1 unit. Dengan n = 30 galat baku ROI ≈ ±18%; n = 10 → ±32%. Hasil jangka pendek tidak bisa dibedakan dari keberuntungan.",
    fix: "Ledger + ringkasan: ROI dengan CI bootstrap, CLV (uji-t), skill log-loss vs pasar, kalibrasi, dan estimasi jumlah bet yang dibutuhkan. Vonis dibuat otomatis dan konservatif.",
    status: "diimplementasi",
    module: "evaluation.ts → summarizeLedger; halaman Ledger",
  },
  {
    id: "M2",
    area: "kematangan",
    severity: "tinggi",
    title: "Hanya bet terpilih yang dievaluasi; NO_BET dan market lain dibuang",
    evidence: ["prediction_learning_evaluations hanya dari prediksi settled dengan market_bet terpilih"],
    impact: "Sampel tumbuh ≈ 1 titik per laga dan terbias (hanya yang tampak bernilai). Kalibrasi tak bisa dinilai tanpa melihat prediksi yang TIDAK dipilih.",
    fix: "Shadow logging: simpan p_final dan p_market semua market tiap fixture (tanpa bet). Sampel kalibrasi tumbuh 10–20× lebih cepat dan tidak bias seleksi.",
    status: "butuh-integrasi",
    module: "pipeline.ts → selections[] (sudah menghasilkan semua market)",
  },
  {
    id: "M3",
    area: "kematangan",
    severity: "sedang",
    title: "Fallback Gemini → Groq mengubah 'model' tanpa stratifikasi metrik",
    evidence: ["generateAIResponse: AI_PROVIDER=auto; provider/model disimpan di snapshot tapi metrik tidak dipisah"],
    impact: "Hasil campuran dari dua estimator berbeda tidak bisa dievaluasi secara bersih.",
    fix: "Mesin deterministik menghilangkan masalah; kolom model_version dipakai agar tiap perubahan metodologi dievaluasi terpisah.",
    status: "diimplementasi",
    module: "schema ledger → model_version",
  },

  /* ───────────── PEMBELAJARAN ───────────── */
  {
    id: "L1",
    area: "pembelajaran",
    severity: "kritis",
    title: "Ambang belajar terlalu kecil secara statistik (20 training / 10 holdout)",
    evidence: [
      "services/prompt-learning.ts: MIN_TRAINING_SAMPLES = 20, MIN_VALIDATION_SAMPLES = 10",
      "backtestLearningPromptProposal: roiImproved ≥ baseline + 0.02; Brier regresi ≤ 0.01",
    ],
    impact:
      "Dengan 10 bet holdout, galat baku ROI ≈ ±30% sehingga syarat '+2% ROI' sepenuhnya noise. Proposal yang diuji berulang pada holdout yang sama = p-hacking; auto-promotion bisa terjadi dari keberuntungan.",
    fix: "Gerbang perubahan kebijakan: ≥ 300 bet selesai, CLV t ≥ 2, skill vs pasar > 0, holdout dikunci (tidak dipakai ulang), maksimal satu uji per periode.",
    status: "diimplementasi",
    module: "evaluation.ts → verdict (insufficient/early/supported/refuted)",
  },
  {
    id: "L2",
    area: "pembelajaran",
    severity: "kritis",
    title: "Pelajaran LLM per LOSS = narasi atas noise (resulting), lalu disuntik ke prompt",
    evidence: [
      "services/settlement.ts generateLossLesson: 'Hasil BERBEDA… faktor kunci yang tidak terprediksi'",
      "ai-analysis.ts formatLessonsBlock: 'Sesuaikan analisis Anda… berdasarkan catatan di atas'",
    ],
    impact:
      "Bet +EV yang kalah bukan kesalahan. Meminta LLM mencari 'faktor kunci' memaksa cerita pasca-hoc (outcome bias) yang kemudian memengaruhi analisis berikutnya. WIN hanya template kosong, jadi RAG berat sebelah ke arah koreksi berlebihan.",
    fix: "classifyResult(): hanya 'process_error' (CLV < −3% atau cacat data) yang boleh menghasilkan pelajaran; kekalahan 'variance' dicatat tanpa narasi; kemenangan dengan CLV negatif ditandai 'lucky'.",
    status: "diimplementasi",
    module: "llm-contract.ts → classifyResult, buildProcessLessonPrompt",
  },
  {
    id: "L3",
    area: "pembelajaran",
    severity: "tinggi",
    title: "Retrieval pelajaran memakai kata pertama nama tim",
    evidence: ["ai-analysis.ts fetchRelevantLessons: homeTeam.split(' ')[0] → ilike %kata%"],
    impact: "'Manchester' cocok ke United & City, 'Real' ke Madrid & Sociedad, 'Atletico', 'Inter', 'FC' dst. Pelajaran klub lain mencemari konteks.",
    fix: "Cocokkan berdasarkan team_id kanonik dan liga (lessonQueryKey), bukan ilike.",
    status: "diimplementasi",
    module: "llm-contract.ts → lessonQueryKey",
  },
  {
    id: "L4",
    area: "pembelajaran",
    severity: "tinggi",
    title: "Hasil 5 hari terakhir disuntik ke prompt ('sesuaikan kepercayaan')",
    evidence: ["ai-analysis.ts formatPerformanceBlock: 'Sesuaikan kepercayaan analisis hari ini berdasarkan tren di atas.'"],
    impact: "Mendorong tilt/chasing setelah kalah atau overconfidence setelah menang (hot-hand/gambler's fallacy) berdasarkan sampel yang pada dasarnya acak.",
    fix: "Hapus dari prompt. Penyesuaian risiko dilakukan otomatis oleh kode melalui stakingMode() berbasis CLV rolling.",
    status: "diimplementasi",
    module: "evaluation.ts → stakingMode",
  },
  {
    id: "L5",
    area: "pembelajaran",
    severity: "tinggi",
    title: "Kebijakan belajar hanya mengetatkan filter confidence/EV/market (ratchet satu arah)",
    evidence: ["learning-policy.ts isPolicyStrictlyTighter + isPolicyNoWeaker; minConfidence maks 9.5"],
    impact: "Volume bet menyusut menuju nol dan yang dioptimalkan adalah filter pada confidence (tak terkalibrasi). Tidak ada pembelajaran terhadap penyebab sebenarnya: kalibrasi probabilitas.",
    fix: "Parameter yang dipelajari: bobot model vs pasar w (fitBlendWeight, log-loss), σ, K shrinkage, ρ Dixon-Coles — dibatasi, diberi versi, dan boleh naik maupun turun sesuai bukti. Jika w* ≈ 0, sistem otomatis berhenti mengklaim edge.",
    status: "diimplementasi",
    module: "blend.ts → fitBlendWeight",
  },
  {
    id: "L6",
    area: "pembelajaran",
    severity: "sedang",
    title: "Brier hanya dibandingkan dengan kebijakan lama sendiri, bukan pasar",
    evidence: ["evaluatePolicyBacktest: brierScore kandidat vs baseline kebijakan"],
    impact: "Model yang kalah dari harga penutupan tetap bisa 'membaik' relatif terhadap dirinya sendiri.",
    fix: "Skill vs pasar = 1 − LL_model / LL_pasar pada himpunan bet yang sama.",
    status: "diimplementasi",
    module: "evaluation.ts → scores.skillVsMarket",
  },
  {
    id: "L7",
    area: "pembelajaran",
    severity: "sedang",
    title: "Promosi otomatis mensyaratkan 'Gemini confidence ≥ 0.9'",
    evidence: ["prompt-learning.ts AUTO_PROMOTION_CONFIDENCE_THRESHOLD = 0.9"],
    impact: "LLM menilai kualitas usulannya sendiri — circular. Tidak ada bukti keyakinan itu berkorelasi dengan perbaikan out-of-sample.",
    fix: "Gerbang promosi murni statistik (L1). LLM hanya menjelaskan hasil, tidak ikut memutuskan.",
    status: "rekomendasi",
  },
];

export interface Strength {
  title: string;
  detail: string;
  evidence: string;
}

export const strengths: Strength[] = [
  {
    title: "Desain fail-closed yang disiplin",
    detail: "Odds basi/tidak ada, statistik tidak lengkap, market tidak terverifikasi, atau sumber settlement tidak lengkap → sistem menolak, bukan menebak. Ini jarang ada di sistem amatir dan melindungi dari data sampah.",
    evidence: "assessOddsAvailability, assessTeamStatsQuality, settlement-provider-fail-closed.md",
  },
  {
    title: "Settlement matematis benar, termasuk garis seperempat, dan diuji",
    detail: "Win/half-win/push/half-loss/loss dihitung kode, bukan LLM; garis ±0.25/0.75 benar; ada unit test.",
    evidence: "lib/bet-settlement.ts + bet-settlement.test.ts",
  },
  {
    title: "Audit anti-kebocoran data pada pembelajaran",
    detail: "Sampel belajar harus punya snapshot versi 2, waktu analisis cocok, provider odds terverifikasi, settlement terverifikasi, dan split kronologis tanpa kebocoran timestamp sama.",
    evidence: "services/learning-audit.ts, learning-policy.ts → splitChronologicalSamples",
  },
  {
    title: "Snapshot evaluasi lengkap & versi (schemaVersion 2) serta prediksi immutable",
    detail: "Seluruh input analisis disimpan sehingga bisa direplay/di-backtest; re-analysis disimpan sebagai revision terpisah; baseline odds tidak pernah dikarang dari harga sekarang.",
    evidence: "evaluation-snapshot.md, odds-baseline-revisions.md, ai_prediction_revisions",
  },
  {
    title: "Confidence tidak pernah dijadikan probabilitas; market & garis terstruktur",
    detail: "Totals dan AH wajib cocok garis persis; market keluar sebagai field terstruktur, bukan parsing prosa. Ini mencegah banyak bug diam-diam.",
    evidence: "stats-quality-gates.md, prediction-board-readiness.md",
  },
  {
    title: "Perubahan kebijakan belajar dibatasi, berjejak, dan bisa di-rollback",
    detail: "Kebijakan punya batas, versi, riwayat, dan holdout kronologis. Fondasi tata kelola ini yang membuat perbaikan di laporan ini aman diterapkan bertahap.",
    evidence: "controlled-gemini-learning.md, ai_learning_prompt_versions",
  },
  {
    title: "Matematika sudah dipisah sebagian dari LLM; kuota & integritas operasional dijaga",
    detail: "EV/Kelly/settlement di backend; rate-limit 100 req/jam dihormati; pagination PostgREST; keep-alive; dokumentasi keputusan di .agents/memory menjaga kontinuitas.",
    evidence: "AI_BACKEND_RULES.md, odds-api-rate-limit.md, supabase-postgrest-pagination.md",
  },
];

export interface MaturityRow {
  key: string;
  label: string;
  now: number;
  target: number;
  note: string;
}

/** Penilaian subjektif reviewer berdasarkan kode & dokumentasi, skala 0–10. */
export const maturity: MaturityRow[] = [
  { key: "data", label: "Pemilihan data", now: 4, target: 7, note: "Satu bandar soft, tanpa closing odds, identitas tim fuzzy, tanpa data line-up/cedera." },
  { key: "analisis", label: "Proses analisis", now: 3, target: 7, note: "Probabilitas dari LLM, tanpa de-vig & tanpa jangkar pasar." },
  { key: "penggunaan", label: "Penggunaan (staking & parlay)", now: 4, target: 7, note: "Kelly dari p tak terverifikasi, parlay perkalian tanpa uji sensitivitas." },
  { key: "kematangan", label: "Kematangan evaluasi", now: 3, target: 8, note: "Belum ada CLV, CI, atau baseline pasar; sampel kecil." },
  { key: "pembelajaran", label: "Pembelajaran mandiri", now: 4, target: 7, note: "Tata kelola bagus, tetapi sinyal yang dipelajari adalah noise dan narasi." },
  { key: "rekayasa", label: "Integritas rekayasa", now: 8, target: 8, note: "Fail-closed, audit kebocoran, snapshot versi, tes unit — keunggulan terbesar." },
];

export interface RoadmapPhase {
  phase: string;
  title: string;
  when: string;
  items: string[];
  exit: string;
}

export const roadmap: RoadmapPhase[] = [
  {
    phase: "Fase 0",
    title: "Berhenti menambah kerusakan (hari ini)",
    when: "Hari 1",
    items: [
      "Hapus blok performance_log & lessons WIN/LOSS dari prompt (L2, L4).",
      "Turunkan cap stake ke ≤ 2% dan matikan bucket '5% (max)' (U3).",
      "Matikan auto-promotion kebijakan belajar sampai gerbang statistik baru aktif (L1, L7).",
      "Tambahkan kolom p_market_fair, odds_close, model_version ke ai_predictions.",
    ],
    exit: "Tidak ada lagi umpan-balik LLM yang mengejar noise.",
  },
  {
    phase: "Fase 1",
    title: "Ganti penghasil probabilitas",
    when: "Minggu 1–2",
    items: [
      "Salin src/lib/quant ke api-server/src/lib/quant (tanpa dependensi, murni TypeScript).",
      "Di analyzeFixture: setelah assess data, panggil analyzeMatch(); LLM dipanggil hanya dengan PERSONA_V5 untuk λ-adjustment berbukti.",
      "Simpan SEMUA selections (shadow logging) ke tabel baru prediction_selections, bukan hanya yang dipilih.",
    ],
    exit: "Setiap fixture punya probabilitas koheren semua market + p_market_fair.",
  },
  {
    phase: "Fase 2",
    title: "Perbaiki data & ukuran kebenaran",
    when: "Minggu 2–4",
    items: [
      "Job closing-odds T-10 menit untuk fixture yang diprediksi (hemat kuota).",
      "Tabel teams/team_aliases kanonik; ingest tak lagi skip diam-diam.",
      "Satu sumber harga sharp sebagai acuan fair & closing.",
      "Sumber line-up/cedera → ekstraksi berbukti (PERSONA_V5).",
    ],
    exit: "CLV dapat dihitung otomatis untuk setiap bet.",
  },
  {
    phase: "Fase 3",
    title: "Kumpulkan bukti (jangan optimasi dulu)",
    when: "Bulan 2–3",
    items: [
      "Kumpulkan ≥ 300 selection ber-hasil (shadow + bet).",
      "Jalankan fitBlendWeight: apakah w* > 0? Apakah skill vs pasar > 0?",
      "Evaluasi kalibrasi per market & per liga; matikan market/liga tanpa skill.",
    ],
    exit: "Vonis ledger 'supported' atau 'refuted' dengan CI — bukan firasat.",
  },
  {
    phase: "Fase 4",
    title: "Naik kelas hanya jika terbukti",
    when: "Setelah Fase 3",
    items: [
      "Jika supported: naikkan bobot model & batas stake bertahap; aktifkan parlay ≤ 4 leg dengan evDecision dan evPessimistic > 0.",
      "Jika refuted: pertahankan mode pasar-murni (w=0) sebagai alat pemilihan harga terbaik + pantau CLV saja.",
    ],
    exit: "Setiap peningkatan risiko didukung bukti statistik.",
  },
];

export const goLiveGates: string[] = [
  "≥ 300 bet/selection selesai pada model_version yang sama",
  "CLV rata-rata > 0 dengan t-stat ≥ 2 (n ≥ 30 untuk uji, idealnya 100+)",
  "Skill log-loss vs pasar > 0 pada himpunan yang sama",
  "ROI aktual dalam kisaran EV yang diklaim (kalibrasi, bukan sekadar profit)",
  "Kalibrasi tiap bin probabilitas tidak menyimpang > 5 poin dengan n ≥ 20",
];
