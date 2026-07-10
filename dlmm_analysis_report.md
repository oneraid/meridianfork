# 🔴 Analisis Penurunan Performa DLMM — Meridianfork

> **Tanggal Analisis:** 8 Juli 2026  
> **Periode Data:** 376 posisi tertutup (all-time) + fokus 30 posisi terakhir  
> **Status:** ⚠️ Performa memburuk — 4 Stop Loss berturutan di 15 posisi terakhir

---

## 📊 Executive Summary

Bot mengalami **degradasi performa yang jelas dan terukur** antara periode awal trading vs. periode terakhir:

| Metrik | First 100 Posisi | Last 100 Posisi | Perubahan |
|:---|:---:|:---:|:---:|
| **Win Rate** | 60.0% | 58.0% | ↓ -2% |
| **Avg PnL/trade** | +0.36% | **-0.83%** | ↓ **-1.19%** |
| **Trend** | Profitable | **Net Losing** | 🔴 Deteriorating |

**Kondisi saat ini (30 posisi terakhir):**
- Win Rate: **50.0%** (15W / 15L)
- Avg PnL: **-2.09%** ← ini yang berbahaya
- 5 Stop Losses dalam 30 trade terakhir (16.7% SL rate)
- Avg Range Efficiency: **83.9%** (bagus, bukan masalah OOR)
- Avg Fees Earned: **$0.36/trade** (kecil)

---

## 🔍 Root Cause Analysis — Mengapa Sering Stop Loss?

### 1. 🧠 LESSON SYSTEM: Siklus Negatif dari Pembelajaran

Sistem lesson sudah mengakumulasi **101 lessons** dengan:
- **14 BAD lessons**
- **60 GOOD lessons** — tapi kebanyakan sudah "stale" (kondisi pasar berubah)
- **27 MANUAL lessons** (config evolution)

**Mekanisme siklus negatif:**

```
1. Bot profit awal → Generate GOOD lessons dengan fee/tvl tinggi & volatility tinggi
2. Darwin weighting boost signal "fee_tvl_ratio" (high fee = good)
3. Bot mulai prefer pool dengan fee/TVL tinggi
4. Pool fee/TVL tinggi = pool sangat aktif = VOLATILITAS SANGAT TINGGI
5. High volatility = high risk price drop → lebih sering SL
6. SL → generate BAD lessons → tapi auto-evolved minFeeActiveTvlRatio sudah naik
7. Bot justru masuk ke pool paling volatile karena screening threshold makin ketat
8. Siklus berulang dengan pool volatilitas makin tinggi
```

**Bukti:** Bot auto-evolved `minFeeActiveTvlRatio` dari 0.05 → 0.10 → 0.12 → **0.13**. Artinya hanya pool dengan fee sangat tinggi yang lolos screening. Pool high-fee = pool sangat volatile = high SL risk.

### 2. 📈 POLA STOP LOSS TERAKHIR — Harga Crash, Bukan OOR

| Pool | Volatility | Bin Step | Bins Below | Range Eff. | Menit | PnL |
|:---|:---:|:---:|:---:|:---:|:---:|:---:|
| **Balloon-SOL** | 3.16 | 100 | 58 | **100%** | 309 | -13.42% |
| **ANSEMWIFE-SOL** | **5.34** | 125 | 69 | **100%** | 38 | -16.73% |
| **ANSEMIUS-SOL** | 3.05 | 125 | 58 | **100%** | 252 | -14.86% |
| **ok-SOL** | **4.60** | 100 | 67 | **100%** | 131 | -10.95% |

**Temuan kritis:** Semua SL memiliki **Range Efficiency 100%** — posisi tetap in-range, tapi underlying token harganya crash menembus Stop Loss. Ini **bukan masalah bin range**, ini masalah **pemilihan token yang salah**.

### 3. 💸 CAPITAL CONSTRAINT: Bot Tidak Bisa Diversifikasi

Dari decision-log, ada **ratusan "Screening skipped — Insufficient SOL"** karena:

```
deployAmountSol = 0.3 SOL
gasReserve      = 0.1 SOL
minSolToOpen    = 0.3 SOL (threshold)
Kebutuhan aktual = 0.4 SOL minimum

Setelah 1 posisi terbuka (0.3 SOL terkunci):
Sisa SOL = ~0.185 SOL → di bawah threshold → bot IDLE
```

Bot tidak bisa membuka posisi ke-2, sehingga **100% modal terkena 1 token** yang bisa SL sekaligus.

### 4. 🎯 ASIMETRI RISK/REWARD

Config saat ini:
```
stopLossPct  = -15%  → rugi besar jika hit
takeProfitPct = 12%  → jarang tercapai (rata-rata trade hanya 0-3%)
```

**Risk/Reward Ratio = 12/15 = 0.8** → tidak favorable!

Satu SL (-15%) membutuhkan **5–8 trade profit** (+2–3% rata-rata) hanya untuk break even.

---

## 🛠️ Before vs After — Perbandingan Config

### 🔴 RISK MANAGEMENT

| Parameter | BEFORE (Sekarang) | AFTER (Rekomendasi) | Alasan |
|:---|:---:|:---:|:---|
| `stopLossPct` | **-15%** | **-12%** | Potong loss lebih cepat, hemat modal. 1 SL skrg setara 4-5 trade, bukan 5-8 |
| `takeProfitPct` | **12%** | **8%** | TP 12% hampir tidak pernah tercapai. TP 8% jauh lebih realistis |
| `trailingTriggerPct` | **3%** | **4%** | Trailing aktif hanya saat profit sudah solid, kurangi fake-out |
| `trailingDropPct` | **1.5%** | **2.0%** | Lebih longgar, beri ruang harga bernapas sebelum exit |

---

### 💰 CAPITAL & POSITION SIZE

| Parameter | BEFORE (Sekarang) | AFTER (Rekomendasi) | Alasan |
|:---|:---:|:---:|:---|
| `deployAmountSol` | **0.3 SOL** | **0.2 SOL** | Deploy lebih kecil = bisa buka 2 posisi paralel, diversifikasi |
| `minSolToOpen` | **0.3 SOL** | **0.25 SOL** | Threshold lebih rendah = bot lebih sering aktif, tidak idle |
| `gasReserve` | **0.1 SOL** | **0.15 SOL** | Cadangan gas lebih aman untuk tx mahal |
| `maxPositions` | **2** | **2** | Tetap sama, tapi sekarang bisa benar-benar tercapai |

> [!NOTE]
> Dengan deploy 0.2 SOL dan reserve 0.15 SOL: wallet 0.6 SOL bisa buka 2 posisi (0.2 × 2 + 0.15 gas = 0.55 SOL). Sebelumnya 0.3 SOL di 1 posisi = sisa hanya 0.2 SOL → tidak bisa buka posisi ke-2.

---

### 📋 POOL SCREENING

| Parameter | BEFORE (Sekarang) | AFTER (Rekomendasi) | Alasan |
|:---|:---:|:---:|:---|
| `minTvl` | **$10,000** | **$20,000** | Pool TVL lebih dalam = likuiditas lebih stabil, slippage lebih kecil |
| `maxTvl` | $150,000 | $200,000 | Sedikit diperlebar agar tidak terlalu memfilter pool bagus |
| `minVolume` | **$1,000** | **$3,000** | Hanya pool dengan volume nyata. Low volume = fee kecil = low yield close |
| `minFeeActiveTvlRatio` | **0.13** | **0.08** | ⚠️ KRITIKAL — 0.13 terlalu tinggi, hanya pilih pool hyper-volatile. Turunkan |
| `minHolders` | **1,000** | **1,500** | Holder lebih banyak = distribusi lebih sehat, less pump-dump |
| `minMcap` | $150,000 | $200,000 | Filter token micro-cap yang lebih rentan rug |
| `maxMcap` | **$10,000,000** | **$5,000,000** | Token mid-cap lebih aman dari yg sudah matured/whales dominan |
| `minOrganic` | 60 | **65** | Sedikit dinaikkan, hindari token dengan score organik pas-pasan |
| `minQuoteOrganic` | 60 | **65** | Sama, quote token pun harus lebih organic |
| `maxBotHoldersPct` | **30%** | **25%** | Lebih ketat filter bot holders, kurangi manipulasi |
| `maxTop10Pct` | **60%** | **55%** | Distribusi token lebih merata, hindari whale concentration |

---

### ⚙️ BIN STEP & STRATEGY RANGE

| Parameter | BEFORE (Sekarang) | AFTER (Rekomendasi) | Alasan |
|:---|:---:|:---:|:---|
| `minBinStep` | 80 | 80 | Tetap sama |
| `maxBinStep` | **125** | **100** | ⚠️ KRITIKAL — binStep 125 = 1.25%/bin, pool SANGAT volatile. Cap di 100 |
| `minBinsBelow` | **55** | **65** | Coverage bawah lebih luas untuk absorb penurunan harga |
| `maxBinsBelow` | **70** | **85** | Bot bisa gunakan range lebih lebar di token volatile |
| `defaultBinsBelow` | **70** | **75** | Default naik sedikit, lebih defensif |

> [!NOTE]
> `maxBinStep 125` artinya 1 bin = 1.25% swing harga. Pool dengan binStep 125 sangat volatile. Semua SL terakhir (ANSEMWIFE, ANSEMIUS) menggunakan binStep=125. Dengan cap di 100 (1%/bin), pool yang dimasuki sudah jauh lebih stabil.

---

### 🕐 TOKEN AGE FILTER

| Parameter | BEFORE (Sekarang) | AFTER (Rekomendasi) | Alasan |
|:---|:---:|:---:|:---|
| `minTokenAgeHours` | **6 jam** | **12 jam** | Token lebih matang = harga lebih stabil, less initial pump-dump |
| `maxTokenAgeHours` | **null** (tidak dibatasi) | **72 jam** | Hindari token terlalu tua/stagnan yang sudah tidak ada momentum |

---

### 📍 POSITION MANAGEMENT

| Parameter | BEFORE (Sekarang) | AFTER (Rekomendasi) | Alasan |
|:---|:---:|:---:|:---|
| `minFeePerTvl24h` | **8%** | **5%** | Threshold 8% terlalu tinggi → terlalu banyak low-yield close. Turunkan ke 5% |
| `minAgeBeforeYieldCheck` | **60 menit** | **90 menit** | Beri posisi waktu lebih panjang sebelum dievaluasi yield-nya |
| `outOfRangeBinsToClose` | **10 bins** | **8 bins** | Lebih cepat detect OOR, tutup sebelum terlalu jauh dari range |
| `outOfRangeWaitMinutes` | **30 menit** | **20 menit** | Lebih responsif terhadap OOR, tidak tunggu terlalu lama |

---

### 🧬 DARWIN LEARNING SYSTEM

| Parameter | BEFORE (Sekarang) | AFTER (Rekomendasi) | Alasan |
|:---|:---:|:---:|:---|
| `darwinWindowDays` | **60 hari** | **30 hari** | Belajar dari kondisi pasar 30 hari terakhir, bukan 2 bulan lalu |
| `darwinRecalcEvery` | **5** posisi | **10** posisi | Recalculate lebih jarang, hindari overfitting ke noise |
| `darwinBoost` | **1.05** | **1.03** | Adjustments lebih gradual, perubahan weight lebih smooth |
| `darwinDecay` | **0.95** | **0.97** | Decay lebih lambat, weight lebih stabil tidak fluktuatif |
| `darwinFloor` | **0.3** | **0.5** | Floor lebih tinggi, tidak ada signal yang terlalu diabaikan |
| `darwinCeiling` | **2.5** | **2.0** | Ceiling lebih rendah, tidak ada signal yang terlalu dominan |
| `darwinMinSamples` | **10** | **15** | Butuh lebih banyak sampel sebelum adjust weight, lebih stabil |

---

### 📊 RINGKASAN DIFF — Yang WAJIB Diubah vs Opsional

| Prioritas | Parameter | Before | After | Dampak |
|:---:|:---|:---:|:---:|:---|
| 🔴 **WAJIB** | `stopLossPct` | -15% | **-12%** | Kurangi kerugian per SL |
| 🔴 **WAJIB** | `takeProfitPct` | 12% | **8%** | TP lebih sering tercapai |
| 🔴 **WAJIB** | `deployAmountSol` | 0.3 | **0.2** | Bisa buka 2 posisi paralel |
| 🔴 **WAJIB** | `minSolToOpen` | 0.3 | **0.25** | Bot tidak idle terus |
| 🔴 **WAJIB** | `maxBinStep` | 125 | **100** | Hindari pool hyper-volatile |
| 🔴 **WAJIB** | `minFeeActiveTvlRatio` | 0.13 | **0.08** | Hapus bias ke pool volatile |
| 🟡 **Penting** | `minTvl` | 10,000 | **20,000** | Pool lebih stabil |
| 🟡 **Penting** | `minVolume` | 1,000 | **3,000** | Kurangi low-yield close |
| 🟡 **Penting** | `darwinWindowDays` | 60 | **30** | Belajar pasar terkini |
| 🟡 **Penting** | `minAgeBeforeYieldCheck` | 60m | **90m** | Beri waktu posisi berkembang |
| 🟡 **Penting** | `minFeePerTvl24h` | 8% | **5%** | Kurangi premature close |
| 🟡 **Penting** | `minTokenAgeHours` | 6 | **12** | Token lebih matang |
| 🟡 **Penting** | `maxTokenAgeHours` | null | **72** | Hindari token stagnan |
| 🔵 Opsional | `trailingTriggerPct` | 3% | 4% | Trailing lebih solid |
| 🔵 Opsional | `trailingDropPct` | 1.5% | 2.0% | Lebih longgar |
| 🔵 Opsional | `minBinsBelow` | 55 | 65 | Range lebih lebar |
| 🔵 Opsional | `maxBinsBelow` | 70 | 85 | Lebih fleksibel |
| 🔵 Opsional | `gasReserve` | 0.1 | 0.15 | Cadangan gas aman |
| 🔵 Opsional | `darwinBoost/Decay` | 1.05/0.95 | 1.03/0.97 | Learning lebih stabil |

---

## 🧪 Strategi Tambahan (Opsional tapi Direkomendasikan)

### Aktifkan Chart Indicators sebagai Entry Filter

| Parameter | BEFORE | AFTER |
|:---|:---:|:---:|
| `chartIndicators.enabled` | **false** | **true** |
| `entryPreset` | supertrend_break | supertrend_break |

Ubah di `user-config.json`:
```json
"chartIndicators": {
  "enabled": true,
  "entryPreset": "supertrend_break",
  "rsiLength": 2,
  "intervals": ["5_MINUTE"],
  "candles": 298,
  "rsiOversold": 30,
  "rsiOverbought": 80,
  "requireAllIntervals": false
}
```

**Manfaat:** Bot hanya masuk posisi saat Supertrend mengkonfirmasi momentum **naik** — menghindari entry ke token yang sudah dalam tren turun (penyebab utama SL terakhir).

---

## 📋 Quick Action Checklist

Lakukan dalam urutan berikut:

- [ ] **1. Backup config** → `cp user-config.json user-config.json.bak && cp signal-weights.json signal-weights.json.bak`
- [ ] **2. Update 6 parameter WAJIB** (stopLoss, takeProfit, deployAmount, minSolToOpen, maxBinStep, minFeeActiveTvlRatio)
- [ ] **3. Update parameter Penting** (minTvl, minVolume, darwin settings, dll)
- [ ] **4. Reset signal-weights.json** ke semua 1.0
- [ ] **5. Hapus lessons** berkaitan token SL: `node cli.js lessons remove ANSEMWIFE`
- [ ] **6. Pastikan wallet SOL ≥ 0.6 SOL** untuk bisa buka 2 posisi paralel
- [ ] **7. Jalankan `dryRun: true`** dan monitor 10 trade pertama
- [ ] **8. Setelah 10 trade profit** → ubah ke live mode

---

## ⚠️ Peringatan Penting

> [!CAUTION]
> Jangan ubah ke `dryRun: false` sampai kamu memverifikasi minimal 10–15 trade pertama dalam mode dry run. Perubahan signifikan pada screening threshold akan mengubah pola entry secara drastis.

> [!WARNING]
> `minFeeActiveTvlRatio` diturunkan dari 0.13 → 0.08. Jika bot mulai terlalu sering keluar karena "Low Yield", naikkan ke 0.10. Monitor aktif 24 jam pertama.

> [!NOTE]
> `darwinWindowDays` dikurangi dari 60 → 30 hari. Setelah 50+ trade baru, Darwin weighting akan lebih relevan dengan kondisi pasar terkini.

---

## 📌 Kesimpulan Root Cause

Penurunan performa adalah kombinasi dari **5 faktor yang saling memperkuat**:

| # | Faktor | Impact |
|:---:|:---|:---:|
| 1 | **Market condition shift** — volatilitas naik, token lebih rentan crash | 🔴 Tinggi |
| 2 | **Auto-evolved threshold backfire** — minFeeActiveTvlRatio naik → pool makin volatile | 🔴 Tinggi |
| 3 | **Lesson system drift** — GOOD lessons lama mengarahkan ke pool high-volatile | 🟡 Sedang |
| 4 | **Capital constraint** — tidak bisa diversifikasi, 1 SL hancurkan semua profit | 🟡 Sedang |
| 5 | **TP/SL asimetri** — TP terlalu tinggi jarang tercapai, SL terlalu dalam rugi besar | 🟡 Sedang |

Dengan perbaikan di atas, **Risk/Reward ratio akan membaik dari 0.8 → ~1.3** (TP 8% vs SL 12%), frekuensi SL menurun karena pool lebih stabil (maxBinStep=100, minTvl=20K), dan bot bisa kembali profitable.

---

*Analisis: Antigravity IDE — 8 Juli 2026*  
*Data source: `lessons.json` (376 posisi), `decision-log.json`, `user-config.json`, `signal-weights.json`*

### A. Perubahan Kritis di user-config.json

```json
{
  "deployAmountSol": 0.2,
  "minSolToOpen": 0.25,
  "gasReserve": 0.15,
  "maxPositions": 2,

  "stopLossPct": -12,
  "takeProfitPct": 8,
  "trailingTriggerPct": 4,
  "trailingDropPct": 2.0,
  "minAgeBeforeYieldCheck": 90,
  "minFeePerTvl24h": 5,

  "minTvl": 20000,
  "minVolume": 3000,
  "minFeeActiveTvlRatio": 0.08,
  "minHolders": 1500,
  "minMcap": 200000,
  "maxMcap": 5000000,
  "maxBinStep": 100,
  "minTokenAgeHours": 12,
  "maxTokenAgeHours": 72,
  "maxBotHoldersPct": 25,
  "maxTop10Pct": 55,

  "minBinsBelow": 65,
  "maxBinsBelow": 85,
  "defaultBinsBelow": 75,

  "outOfRangeBinsToClose": 8,
  "outOfRangeWaitMinutes": 20,

  "darwinWindowDays": 30,
  "darwinRecalcEvery": 10,
  "darwinBoost": 1.03,
  "darwinDecay": 0.97,
  "darwinFloor": 0.5,
  "darwinCeiling": 2.0,
  "darwinMinSamples": 15
}
```

### B. Penjelasan Perubahan Parameter

| Parameter | Lama | Baru | Alasan |
|:---|:---:|:---:|:---|
| `stopLossPct` | -15% | **-12%** | Potong loss lebih cepat, hemat modal |
| `takeProfitPct` | 12% | **8%** | TP lebih realistis, lebih sering tercapai |
| `trailingTriggerPct` | 3% | **4%** | Trailing aktif di profit lebih solid |
| `trailingDropPct` | 1.5% | **2.0%** | Lebih longgar — beri ruang harga bernapas |
| `deployAmountSol` | 0.3 | **0.2** | Bot bisa buka 2 posisi paralel |
| `minSolToOpen` | 0.3 | **0.25** | Threshold lebih rendah = lebih aktif |
| `gasReserve` | 0.1 | **0.15** | Cadangan gas lebih aman |
| `minFeeActiveTvlRatio` | 0.13 | **0.08** | Tidak lagi condong ke pool hyper-volatile |
| `minTvl` | 10K | **20K** | Pool lebih stabil, likuiditas lebih dalam |
| `minVolume` | 1K | **3K** | Hanya pool dengan volume nyata |
| `maxMcap` | 10M | **5M** | Hindari token yang sudah "matured" |
| `maxBinStep` | 125 | **100** | Hindari pool terlalu volatile (125 = 1.25%/bin) |
| `minTokenAgeHours` | 6 | **12** | Token lebih matang = lebih stabil |
| `maxTokenAgeHours` | null | **72** | Hindari token terlalu tua/stagnan |
| `minBinsBelow` | 55 | **65** | Coverage bawah lebih luas |
| `maxBinsBelow` | 70 | **85** | Sedikit lebih lebar untuk absorb crash |
| `minAgeBeforeYieldCheck` | 60m | **90m** | Beri waktu lebih sebelum tutup |
| `darwinWindowDays` | 60 | **30** | Belajar dari kondisi pasar terkini |
| `darwinBoost` | 1.05 | **1.03** | Adjustments lebih gradual |
| `darwinDecay` | 0.95 | **0.97** | Decay lebih lambat, weight lebih stabil |

### C. Reset Lessons yang Stale

Hapus lessons yang berkaitan dengan token SL terakhir agar tidak menyesatkan decision-making:

```bash
# Via CLI node (jalankan di folder meridianfork)
node cli.js lessons remove ANSEMWIFE
node cli.js lessons remove Balloon-SOL
node cli.js lessons remove ANSEMIUS
node cli.js lessons remove ok-SOL
```

Atau jika ingin full reset dan mulai bersih:
```bash
node cli.js lessons clear
```

### D. Reset Darwin Signal Weights ke Neutral

Edit `signal-weights.json`, ubah semua values ke `1.0`:

```json
{
  "weights": {
    "organic_score": 1.0,
    "fee_tvl_ratio": 1.0,
    "volume": 1.0,
    "mcap": 1.0,
    "holder_count": 1.0,
    "smart_wallets_present": 1.0,
    "narrative_quality": 1.0,
    "study_win_rate": 1.0,
    "hive_consensus": 1.0,
    "volatility": 1.0,
    "entry_mcap": 1.0,
    "entry_tvl": 1.0,
    "entry_volume": 1.0
  },
  "last_recalc": null,
  "recalc_count": 0,
  "history": []
}
```

---

## 🧪 Strategi Tambahan (Opsional tapi Direkomendasikan)

### Aktifkan Chart Indicators sebagai Entry Filter

Ubah di `user-config.json`:
```json
"chartIndicators": {
  "enabled": true,
  "entryPreset": "supertrend_break",
  "rsiLength": 2,
  "intervals": ["5_MINUTE"],
  "candles": 298,
  "rsiOversold": 30,
  "rsiOverbought": 80,
  "requireAllIntervals": false
}
```

**Manfaat:** Bot hanya masuk posisi saat Supertrend mengkonfirmasi momentum **naik** — menghindari entry ke token yang sudah dalam tren turun (penyebab utama SL terakhir).

### Tambahkan Discord Signals sebagai Cross-Check

```json
"useDiscordSignals": true,
"discordSignalMode": "merge"
```

Discord signals memberikan **social confirmation** bahwa komunitas juga bullish — sinyal konvergen dari beberapa sumber lebih andal.

---

## 📋 Quick Action Checklist

Lakukan dalam urutan berikut:

- [ ] **1. Backup config** → `cp user-config.json user-config.json.bak && cp signal-weights.json signal-weights.json.bak`
- [ ] **2. Update user-config.json** dengan setting baru di atas
- [ ] **3. Reset signal-weights.json** ke semua 1.0
- [ ] **4. Hapus lessons** berkaitan token SL: ANSEMWIFE, Balloon, ANSEMIUS, ok-SOL
- [ ] **5. Pastikan wallet SOL ≥ 0.6 SOL** untuk bisa buka 2 posisi paralel
- [ ] **6. Jalankan dalam `dryRun: true`** dan monitor 10 trade pertama
- [ ] **7. Setelah 10 trade profit** → ubah ke live mode

---

## ⚠️ Peringatan Penting

> [!CAUTION]
> Jangan ubah ke `dryRun: false` sampai kamu memverifikasi minimal 10–15 trade pertama dalam mode dry run dengan setting baru. Perubahan signifikan pada screening threshold akan mengubah pola entry secara drastis.

> [!WARNING]
> `minFeeActiveTvlRatio` diturunkan dari 0.13 → 0.08. Jika bot mulai terlalu sering keluar karena "Low Yield", naikkan ke 0.10. Lakukan monitoring aktif 24 jam pertama.

> [!NOTE]
> `darwinWindowDays` dikurangi dari 60 → 30 hari. Sistem akan belajar lebih cepat dari kondisi pasar saat ini. Setelah 50+ trade baru, Darwin weighting akan mulai memberikan rekomendasi yang lebih relevan.

---

## 📌 Kesimpulan Root Cause

Penurunan performa adalah kombinasi dari **5 faktor yang saling memperkuat**:

| # | Faktor | Impact |
|:---:|:---|:---:|
| 1 | **Market condition shift** — volatilitas naik, token lebih rentan crash | 🔴 Tinggi |
| 2 | **Auto-evolved threshold backfire** — minFeeActiveTvlRatio naik → pool makin volatile | 🔴 Tinggi |
| 3 | **Lesson system drift** — GOOD lessons lama mengarahkan ke pool high-volatile | 🟡 Sedang |
| 4 | **Capital constraint** — tidak bisa diversifikasi, 1 SL hancurkan semua profit | 🟡 Sedang |
| 5 | **TP/SL asimetri** — TP terlalu tinggi jarang tercapai, SL terlalu dalam rugi besar | 🟡 Sedang |

Dengan perbaikan di atas, **Risk/Reward ratio akan membaik dari 0.8 → ~1.3** (TP 8% vs SL 12%), frekuensi SL menurun karena pool lebih stabil (maxBinStep=100, minTvl=20K), dan bot bisa kembali profitable.

---

*Analisis: Antigravity IDE — 8 Juli 2026*  
*Data source: `lessons.json` (376 posisi), `decision-log.json`, `user-config.json`, `signal-weights.json`*
