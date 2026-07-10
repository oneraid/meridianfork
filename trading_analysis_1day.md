# Analisis Performa Trading Bot DLMM Meridianfork (1 Hari)

Berikut adalah analisis mendalam mengenai performa trading bot DLMM **meridianfork** selama periode **6 Juli 2026 s/d 7 Juli 2026** (~30 jam log aktif). 

Analisis ini didasarkan pada data historis yang dicatat di `logs/actions-2026-07-06.jsonl`, `logs/actions-2026-07-07.jsonl`, `lessons.json`, dan `state.json`.

---

## 📊 Ringkasan Kinerja Utama (Executive Summary)

Secara keseluruhan, bot beroperasi dalam mode **live trading** (`DRY_RUN=false` di `.env` menimpa config di `user-config.json`) menggunakan wallet `8U4NN5adXg1NshbpE5Z6dwLxWspS1JBK1tcaNQJWFJid`.

| Metrik | Nilai | Catatan / Analisis |
| :--- | :--- | :--- |
| **Total Posisi Ditutup** | 23 | Aktivitas trading cukup tinggi untuk periode 1 hari. |
| **Win Rate** | **52.17%** | 12 Transaksi Profit (Win) vs 11 Transaksi Rugi (Loss). |
| **Total PnL USD (Net)** | **-$2.71 USD** | Hasil bersih setelah memperhitungkan perolehan Meteora fee. |
| **Total Fees Earned** | **+$2.40 USD** | Perolehan fee yang sangat baik, menyumbang bantalan profit yang besar. |
| **Saldo Awal Wallet** | **0.7233 SOL** | Tercatat pada 06 Juli 2026, 04:27 UTC. |
| **Saldo Akhir Wallet** | **0.6504 SOL** | Tercatat pada 07 Juli 2026, 04:25 UTC. |
| **Selisih Saldo SOL** | **-0.0729 SOL** (~-10.1%) | Penurunan saldo riil di wallet (akibat gas fees Solana + slippage). |
| **Pergerakan Harga SOL** | ~-0.5% ($81.42 ➔ $81.00) | SOL relatif stabil, sehingga bot mengalami underperformance dibanding hold SOL. |

> [!IMPORTANT]
> **Kesimpulan Utama:** Meskipun bot memiliki Win Rate di atas 50% dan efisiensi pengumpulan fee yang tinggi (mengumpulkan $2.40 USD fee dari total modal kecil), bot mengalami kerugian bersih. Hal ini disebabkan oleh dua faktor utama: **satu kerugian besar akibat Stop Loss** pada token `NEIL-SOL` (rugi -$3.15 USD) dan **biaya transaksi (gas fees) + slippage** dari aktivitas bongkar-pasang posisi yang sangat sering (23 kali tutup, 24 kali buka).

---

## 🔍 Analisis Mendalam Berdasarkan Alasan Penutupan (Close Reasons)

Untuk memahami di mana letak kebocoran modal dan di mana bot menghasilkan profit, berikut adalah pengelompokan transaksi berdasarkan alasan penutupan posisi:

| Alasan Penutupan (Close Reason) | Jumlah | Win / Loss | Total PnL (USD) | Total Fees Earned (USD) | Insight Strategi |
| :--- | :---: | :---: | :---: | :---: | :--- |
| **Stop Loss** | 1 | 0W - 1L | -$3.15 USD | +$1.94 USD | Transaksi tunggal pada `NEIL-SOL` yang merusak performa harian bot. |
| **Low Yield (60m)** | 14 | 5W - 9L | -$0.31 USD | +$0.25 USD | Terjadi saat posisi berusia 60 menit namun yield fee/TVL < 8%. Ini menyumbang frekuensi trade tertinggi. |
| **Pumped Far Above Range** | 5 | 4W - 1L | +$0.63 USD | +$0.21 USD | Terjadi saat harga melonjak naik melewati batas range atas. Sangat menguntungkan. |
| **Out of Range (30m)** | 3 | 3W - 0L | +$0.13 USD | +$0.01 USD | Terjadi saat harga berada di luar range selama 30 menit. Berhasil mengamankan profit tipis. |

### 1. Kasus Stop Loss `NEIL-SOL` (Rugi Terbesar)
* **Detail Transaksi:** Deployed pada `2026-07-06T19:15:10Z` (Modal awal: $24.56 USD / 0.3 SOL). Ditutup pada `2026-07-07T00:59:57Z` (Hold: 344 menit / ~5.7 jam).
* **Penyebab:** Harga token NEIL turun tajam dari Market Cap $701K (saat masuk) ke $396K (saat keluar) — penurunan harga sekitar **-43.5%**.
* **Dampak Fee:** Karena bot menggunakan strategi concentrated liquidity (`bid_ask`), aktivitas transaksi di pool menghasilkan fee yang masif sebesar **+$1.94 USD** (hampir 8% dari nilai posisi hanya dalam 5.7 jam). Fee ini berhasil meredam kerugian gross USD dari -20.73% menjadi kerugian net **-12.85% (-$3.15 USD)**.
* **Evaluasi:** Mekanisme Stop Loss berjalan dengan baik menyelamatkan sisa modal, dan fee DLMM memberikan bantalan yang signifikan. Namun, masuk ke token dengan tren penurunan market cap yang tajam tetap menjadi risiko utama.

### 2. Kebocoran Halus "Low Yield (60m)" Closes
* Sebanyak 14 dari 23 posisi (60.8%) ditutup karena yield fee terlalu rendah setelah 60 menit.
* PnL per transaksi sangat kecil (rata-rata kerugian sekitar -$0.02 USD per transaksi setelah fee).
* **Masalah:** Meskipun kerugian per transaksi tampak sepele, aktivitas bongkar-pasang posisi sebanyak 14 kali ini memicu pengeluaran gas fees SOL yang konstan di blockchain Solana, yang menjelaskan mengapa saldo SOL berkurang lebih banyak (-0.073 SOL) dibanding kerugian USD bot (-$2.71 USD).

---

## 💡 Insight Penting & Hambatan Konfigurasi (Configuration Bottleneck)

Setelah menganalisis `user-config.json` dan screenshot grafik Meteora, ditemukan dua hambatan kritis yang saling bertentangan:

### 1. Capital Constraint (Keterbatasan Modal)
* Saldo wallet bot berkisar antara `0.65 - 0.72 SOL`.
* Di config, `deployAmountSol` diatur sebesar **0.3 SOL**, dan `gasReserve` sebesar **0.1 SOL**.
* Agar bot dapat membuka posisi baru, bot membutuhkan minimal `deployAmountSol + gasReserve = 0.4 SOL` (`minSolToOpen` diatur `0.3 SOL`, namun pengecekan gas reserve tetap berjalan).
* **Akibatnya:** Ketika bot sudah memiliki **1 posisi terbuka** (mengunci 0.3 SOL), sisa SOL di wallet menjadi `~0.35 SOL` (di bawah threshold 0.4 SOL). Bot **tidak akan pernah bisa membuka posisi ke-2**, meskipun `maxPositions` diatur ke **2**.
* Ini terbukti dari adanya **85 kali "Skip"** screening cycle dengan alasan **"Insufficient SOL"** sepanjang hari. Bot kehilangan kesempatan untuk diversifikasi ke pool potensial lain saat modalnya terjebak di satu pool stagnant atau merugi.

### 2. Akar Masalah Sebenarnya: Penentuan Entry Point & Range yang Kurang Tepat (Studi Kasus `NEIL-SOL`)

> [!NOTE]
> Masalahnya **bukan** tentang menaikkan atau menurunkan angka Stop Loss. Menaikkan SL hanya berarti mengambil risiko lebih besar, bukan menyelesaikan masalah. Akar masalahnya adalah **keputusan screener bot dalam memilih titik entry dan menentukan lebar range** yang tidak memperhitungkan potensi volatilitas harga.

**Data aktual posisi NEIL-SOL:**

| Parameter | Nilai | Implikasi |
| :--- | :--- | :--- |
| **Strategy** | `bid_ask` (single-sided, bid-only ke bawah) | Seluruh 0.3 SOL diposisikan di bawah harga saat entry |
| **Entry Active Bin** | `-476` (harga: `0.00877 SOL/NEIL`) | Bot masuk **tepat di harga pasar saat itu** |
| **Min Bin** | `-526` (harga: `0.00533 SOL/NEIL`) | Batas bawah range hanya 50 bins / ~39.2% di bawah entry |
| **Bins Below** | `50` | Konfigurasi max yang diizinkan di `user-config.json` |
| **Volatility tercatat** | `1.7234` | Volatilitas **tinggi** — seharusnya jadi sinyal waspada |

**Kronologi masalah secara visual:**
```
Harga NEIL (SOL per NEIL)

0.00877  ← [ENTRY] Bot masuk di sini (active bin, harga pasar)
  │
  │  ↘ Harga turun, likuiditas bot mulai menyerap penurunan
  │
0.00533  ← [MIN BIN] Batas bawah range (39.2% di bawah entry)
  │
  ↓  Harga tembus ke bawah Min Bin → posisi OOR, SL terpicu
0.00365  ← [LOW] Harga terendah yang dicapai (~58% di bawah entry!)
  │
  ↑  REBOUND — harga kembali naik ke 0.0786
```

**Mengapa ini adalah masalah entry/range, bukan masalah SL?**

1. **Bot masuk tepat di harga pasar (`active_bin = max_bin = -476`).** Strategi `bid_ask` single-sided ke bawah bermakna bot memasang liquiditas di bawah harga saat ini, berharap harga turun sedikit lalu rebound. Masalahnya, token NEIL pada saat itu **sudah menunjukkan momentum turun** (MCap dari $701K sedang dalam tren penurunan), dan bot masuk di puncak area ini.

2. **Penurunan aktual jauh melampaui kapasitas range.** Harga NEIL turun hingga `0.00365` (~**-58.4%** dari entry), sementara range bot hanya mampu menampung hingga `0.00533` (~**-39.2%**). Begitu harga menembus `Min Bin`, posisi bot otomatis menjadi Out-of-Range (OOR) — tidak ada lagi fee yang diperoleh dan SL jadi satu-satunya mekanisme keluar.

3. **Solusi yang tepat bukan menaikkan SL, tapi memperbaiki entry:**
   - **Opsi A — Entry lebih rendah:** Jika bot menunggu harga menyentuh support yang lebih rendah dulu sebelum deploy (misalnya menunggu konfirmasi harga di `0.007` atau `0.0065` sebelum masuk), maka penurunan ke `0.00365` sudah masuk dalam jangkauan range dan posisi tetap `in-range`, menghasilkan fee, dan siap profit saat rebound.
   - **Opsi B — Range lebih lebar:** Jika `bins_below` dinaikkan dari `50` menjadi misalnya `80` atau `100` bins, area cakupan ke bawah menjadi ~**65-80% di bawah entry**, sehingga penurunan hingga `0.00365` masih bisa tertampung dalam range dan posisi tetap aktif mengumpulkan fee — bukan OOR.

4. **Peran Volatility Signal yang terlewat:** Volatilitas token NEIL tercatat `1.7234` — ini **tinggi**. Seharusnya sinyal ini memicu bot untuk menggunakan `bins_below` yang lebih banyak (range lebih lebar ke bawah) sebagai kompensasi risiko. Konfigurasi `adaptiveStrategy.bidAskBinsBelow: 69` sebenarnya ada, tetapi bot hanya menggunakan `50` bins pada posisi ini — ada kesenjangan antara konfigurasi dan eksekusi yang perlu diinvestigasi.

---

## 🛠️ Rekomendasi Aksi & Optimasi Konfigurasi

Untuk meningkatkan performa bot Meridianfork ke depannya, berikut beberapa rekomendasi perubahan parameter pada `user-config.json`:

### 1. Selesaikan Masalah Capital Constraint (Dua Pilihan)
* **Opsi A (Menambah Saldo):** Tambahkan saldo wallet SOL menjadi minimal **0.9 - 1.0 SOL**. Hal ini memungkinkan bot secara aktif membuka 2 posisi bersamaan (0.3 SOL x 2 + 0.1 SOL cadangan gas = 0.7 SOL). Diversifikasi ini penting agar kinerja tidak didominasi oleh satu token saja.
* **Opsi B (Menurunkan Ukuran Deploy):** Jika tidak ingin menambah saldo wallet, turunkan `deployAmountSol` menjadi **0.15 SOL** atau **0.2 SOL** di `user-config.json`.
  ```json
  "deployAmountSol": 0.2,
  "minSolToOpen": 0.2
  ```

### 2. Kurangi Frekuensi "Low Yield" Closes untuk Hemat Gas Fee
Kebocoran gas fee akibat penutupan Low Yield dalam 60 menit bisa dikurangi dengan memperketat kriteria screening saat memilih pool:
* Naikkan `minVolume` dari `1000` menjadi **`3000`** USD agar bot hanya masuk ke pool yang benar-benar aktif bertransaksi.
* Naikkan `minTvl` dari `10000` menjadi **`20000`** USD untuk menyaring pool dengan likuiditas yang lebih stabil.
* Sesuaikan konfigurasi di `user-config.json`:
  ```json
  "minVolume": 3000,
  "minTvl": 20000
  ```

### 3. Perbaiki Logika Penentuan Entry Point & Lebar Range (Solusi Utama Kasus NEIL-SOL)

Ini adalah rekomendasi terpenting dan langsung menyasar akar masalah:

#### A. Naikkan `maxBinsBelow` untuk Token Volatilitas Tinggi
Untuk token dengan `volatility > 1.5`, bot seharusnya otomatis memperlebar range ke bawah. Saat ini config mengizinkan `bidAskBinsBelow: 69` maksimal, tetapi pada posisi NEIL hanya digunakan `50`. Pastikan nilai ini benar-benar digunakan secara penuh pada token volatil.

```json
"adaptiveStrategy": {
  "bidAskBinsBelow": 80
}
```

#### B. Tambahkan Logika "Volatility-Scaled Bins" ke Screener
Saat ini `bins_below` dihitung berdasarkan formula volatilitas, tetapi untuk kasus NEIL terbukti undersized. Idealnya screener perlu memperhitungkan **depth penurunan yang realistis** sebelum deploy:

- Volatility `1.7` × `bins_step` `100` → potensi swing harga **±17 bins** per periode
- Harga bisa drop 50-60% pada token high-volatility meme dalam 5-6 jam
- `bins_below` minimum yang aman untuk volatility `1.7`: sekitar **70-80 bins** (bukan 50)

#### C. Entry di Level Harga yang Lebih Konservatif
Screener saat ini masuk pada **harga pasar aktif saat itu** (active bin = max bin). Untuk token yang sudah menunjukkan momentum turun (MCap menurun, volume tidak naik), strategi yang lebih baik adalah:

- **Delay entry:** Tunggu konfirmasi bahwa harga sudah menemukan support lokal sebelum deploy
- **Offset entry:** Set `active_bin` sedikit di bawah harga pasar saat ini (misalnya 3-5 bins lebih rendah) sehingga posisi langsung berada lebih dalam range dan memiliki buffer lebih besar ke bawah

