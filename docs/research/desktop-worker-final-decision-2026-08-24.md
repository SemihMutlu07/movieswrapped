# Desktop-Worker Final Decision Report

Tarih: 2026-08-24 · Kaynak: yalnız diskteki artifact'ler (agent self-report kanıt sayılmadı)

## Kanıt envanteri (diskten açıldı ve doğrulandı)

| Artifact | Konum | Durum |
|---|---|---|
| 00-baseline | `artifacts/desktop-worker-benchmark/00-baseline/` | ✓ 4 dosya |
| 01-tmdb-observability | `.../01-tmdb-observability/` | ✓ commit e7bf32a |
| 02-cache-safety | `.../02-cache-safety/` | ✓ commit 266500b |
| 03-synthetic | `.../03-synthetic/` | ✓ commit ec005c4 |
| 04-live-topology | `.../04-live-topology/` | ✓ harness a62964b |
| 05-tmdb-1k | `.../05-tmdb-1k/` | ✓ commit cea5945 |
| 06-browser-alternatives | `.../06-browser-alternatives/` | ✓ |
| docs/research/tmdb-prewarm-decision-2026-08-24.md | — | **MEVCUT DEĞİL** (disk + tüm git geçmişi tarandı). İçerik varsayımları P2/P3 prompt'larının UYGULA listelerinden alındı; bu rapor kendi kanıtlarına dayanır. |

---

## Executive verdict

Desktop worker **production'da kalır** — mevcut mimarisiyle: tek process, concurrency 1,
direct cloudscraper transport, mevcut TMDB cache policy. Bugünün verisi ekstra
concurrency/topoloji/karmaşıklık katmanlarının hiçbirinin ölçülebilir kazanç vermediğini
gösteriyor; watchlist Cloudflare bloğu için tek gerçekçi yol Browser-Use fallback adapter'ı
(DEFER → sonraki PR) ve RSS incremental check'tir.

## Bugünkü worker gerçekten nerede zaman harcıyor?

**Letterboxd HTML scrape'i = %97.** Canlı ölçüm (48 job, 04-live-topology):
scrape p50 ≈ 38.5s, analysis p50 ≈ 0.9–4s, TMDB match+metadata p50 ≈ 0.42s toplam,
postback ≈ 0s. Job başına toplam 42.6s'in ~38.5s'i sayfa fetch beklemesi.
TMDB tarafı cache hit %99.6 ile pratikte bedava.

## Güvenli active concurrency kaç?

**Sentetikte 1–8 arası hepsi güvenli** (03-synthetic: 50×1, 100×1/2/4/8 — 0 lost,
0 duplicate, 0 stale lease, thread delta 0). **Canlıda yalnız 1 ve 2 ölçüldü** ve ikisi de
~2.2 job/min verdi — concurrency artışı throughput'u artırmıyor çünkü darboğaz dış servis
latency'si. Güvenli üst sınır olarak **2** (canlı doğrulanmış), production default **1**
(mevcut sözleşme).

## 50 ve 100 request burst drain (queued burst modeli)

Recorded-replay (gerçek service-time dağılımıyla, 04):

| Burst | c=1 | c=2 | c=4 | c=8 |
|---|---|---|---|---|
| 50 makespan | 25.8 dk | 13.0 dk | 7.3 dk | 4.6 dk |
| 100 makespan | 51.6 dk | 25.8 dk | 13.7 dk | 7.6 dk |
| 100 queue p95 | 46.9 dk | 23.3 dk | 11.6 dk | 5.5 dk |

**50/100 "active scrape" (eşzamanlı gerçek Letterboxd yükü): ÖLÇÜLMEDİ.** Bu deney
bilinçli olarak atlandı — 50-100 eşzamanlı gerçek scrape, "ilk 403/429'da dur" kuralıyla
çelişir ve IP'yi riske atar. Eksik deney #1: küçük adımlarla (5, 10 eşzamanlı) gerçek
eşzamanlılık testi.

## Tek process mi, multi-process mi?

**Tek process.** Canlı veri: active 1→2 throughput kazancı yok (~2.2 job/min her ikisi).
Darboğaz Letterboxd latency'si olduğundan process eklemek aynı IP'nin arkasında aynı
latency'yi paylaşıp risk yüzeyini büyütür. Multi-process yalnız farklı IP'lerde anlamlı olur.

## Job-type küçük worker'lar faydalı mı?

**Veri yetersiz — ölçülmedi.** Role-split (D) prototipi quick matris koşulunda test edilmedi
(04 kapsam notu). Tek ipucu: scrape %97 zaman aldığı için "analysis worker" ayrımı
teorik fayda sağlamaz. Eksik deney #2: pages2-only micro-job'ların lifetime job'larla
bir queue'da interference ölçümü.

## TMDB 1K prewarm gerçek kullanıcı işlerinde kazanç sağladı mı?

**Sağladığı gösterilemedi.** Overlap job 144.6s vs baseline medyan 152.5s — gürültü
içinde. Neden: production cache zaten %99.6 hit; prewarm'in hedeflediği cold-miss
senaryosu gerçekte neredeyse yok.

## 5K genişletme kapısı geçti mi?

**Hayır.** Kapı: ≥10s p50 VEYA ≥30s p95 analysis iyileşmesi VEYA ≥20 puan outbound
azalması. Hiçbiri ölçülemedi (overlap farkı istatistiksel anlamsız). 5K yapılmadı;
önce kontrol grubu karşılaştırması gerekli.

## Hermes Browser Use direct scraper'dan daha iyi mi?

**Genel olarak hayır; tek noktada evet.** Parity 5/6 görevde tam, per-page süreler
karşılaştırılabilir (browser toplam 20.7s / 6 görev). Ama watchlist'te direct Cloudflare
tarafından bloklu (canlı doğrulandı) ve browser çalışıyor (100+28 poster). Yani browser
"better scraper" değil, **watchlist fallback adapter'ı**.

## Scrape dışında launch için en doğru veri yolu?

**RSS incremental check.** 54 item canlı doğrulandı; tmdb:movieId + review metni hazır;
returning user'da "değişiklik var mı?" kontrolü ~1.7s. Export-first en tam veri ama
login+manuel sürtünme launch akışını kırar (anon 403 doğrulandı).

## Site desktop worker tamamlanmadan yayınlanabilir mi?

**Evet, şu şartla:** Watchlist-compare özelliği ya kapalı/lansman dışı ya da browser-use
fallback adapter'ı eklenmiş olmalı. Diary/grid/reviews akışı direct worker'da production
kanıtlı (bugün 48+ canlı job, 0 failure). Watchlist bloğu kalıcıysa lansman copy'sinde
watchlist compare vurgulanmamalı.

## Letterboxd/TMDB kullanım şartı riski production kararını nasıl sınırlar?

1. **TMDB:** 175-gün TTL zaten uygulandı (02); rate pacing korunuyor; prewarm 5 req/s
   hard cap'le sınırlı → uyum riski düşük, genişletme (5K+) ancak TTL/pacing belgeleriyle.
2. **Letterboxd:** Watchlist endpoint'i aktif bot-detection hedefi → yüksek hacimli
   watchlist trafiği IP banı riski üretir. Bu, multi-process/eşzamanlılık genişlemesini
   ve proxy kullanımını fiilen yasaklar. RSS (resmî feed) risk taşımayan tek büyüme yolu.

## Tam rollback planı

| Değişiklik | Rollback |
|---|---|
| e7bf32a observability | `git revert e7bf32a` — telemetry additive; eski payload'lar zaten backward-compatible |
| 266500b cache safety | `git revert 266500b` — cache formatı değişmedi; revert sonrası eski davranış sorunsuz çalışır (atomik yazma kaybolur ama dosyalar geçerli) |
| ec005c4 bench lab | Sadece sil (`bench_lab.py`, `worker_bench.py`, test) — production'a import edilmemiş durumda |
| a62964b live harness | `scripts/` altında tek dosya — sil |
| cea5945 prewarm CLI | `scripts/` altında tek dosya — sil; üretilen cache dosyaları geçerli kalabilir (TTL zaten var) |
| Worker process | `worker.ps1 restart` önceki commite: supervisor `git checkout <sha>` + restart; outbox boş olduğundan veri kaybı yok |

---

## Current bottleneck ranking

1. **Letterboxd page-fetch latency** (%97 of job time; p50 38.5s/job)
2. **Watchlist Cloudflare block** (feature-blocking, latency değil)
3. **Analysis pipeline** (~1-4s — ihmal edilebilir)
4. **TMDB enrichment** (~0.4s, %99.6 hit)
5. Postback/queue — ölçülebilir maliyet yok

## Data table

| Metrik | p50 | p95 | Kaynak |
|---|---|---|---|
| Scrape süresi (live) | 38.5s | ~45s | 04 variants.csv |
| Analysis (lifetime) | 3.7s | 4.1s | 01 real-run |
| TMDB match | 0.08s | 0.09s | 04 |
| TMDB metadata | 0.34s | 0.38s | 04 |
| Local statistics | 42.9s* | 44.2s* | 04 (*collector-lifetime türevi; scrape dahil) |
| Queue wait (canlı) | 1.4–4s | — | 00/05 overlap |
| Postback | ~0s | 0s | 04 |
| Jobs/min (active=1) | 2.2 | — | 04 |
| Error rate (canlı) | 0/48 | — | 04 correctness |
| Block (403/429/CF) | 0 | — | 04 |
| Parity (fixture vs prod postback) | %100 | — | 03 tests |
| Threads after 100 jobs | delta 0 | — | 03 system.csv |
| Cache hit rate | %99.6 | — | 04 |
| Cache integrity | 49,659 JSON / 0 invalid | — | 05 scan |

## Recommended production mode (tek seçenek)

**Mevcut haliyle tek desktop process, concurrency=1, direct cloudscraper.**

Exact config:
```
WORKER_CONCURRENCY      (tanımlı değil — loop V1 tek slot)
WORKER_POLL_INTERVAL    5
WORKER_HEARTBEAT_INTERVAL 30
MAX_CONCURRENCY         1
TMDB_REQUESTS_PER_SECOND 25
CACHE_MAX_AGE_SECONDS   15,120,000 (175d)
```

Worker topology: **single-process, single-slot.** Ek topology YOK.

Cache/prewarm policy: mevcut 175d lazy TTL + atomic writes korunur. Prewarm CLI
manual-only kalır; scheduled/cron prewarm YOK; 5K genişletme kapısı geçilmedi.

Export/RSS/browser policy:
- RSS incremental check → bir sonraki PR'da denenecek (SHIP)
- Browser-use watchlist fallback → DEFER'den sonraki PR'a prototip
- Export-first → power-user dokümantasyonu dışında entegrasyon yok

## SLO ve alert thresholds

| Sinyal | Threshold | Aksiyon |
|---|---|---|
| Heartbeat age | >60s | warning |
| Job duration p95 | >180s | investigate |
| Failed jobs (saatlik) | ≥3 | alert |
| Outbox unacked | >10 | alert |
| Letterboxd 403/CF | ilk olay | scrape'i durdur, IP kontrolü |
| TMDB 429 consecutive | ≥3 | prewarm/scrape abort |
| ops_tasks queued | >20 (15 dk sürerse) | capacity review |

## SHIP / KILL / DEFER

| Öğe | Karar |
|---|---|
| Direct worker (mevcut mimari) | **SHIP** |
| Observability telemetry (e7bf32a) | **SHIP** (deploy sonrası aktifleşir) |
| Cache safety atomic writes (266500b) | **SHIP** |
| Bench lab (ec005c4, experiment branch) | **DEFER** — production merge yok; adapter seam ileride işe yarayabilir |
| Multi-process / role workers | **KILL** (veri: kazanç yok; eksik deney notu aşağıda) |
| TMDB 1K→5K prewarm | **KILL** (kapı geçilmedi) |
| Scheduled prewarm | **KILL** |
| Hermes Browser Use genel entegrasyon | **KILL** |
| Browser watchlist fallback adapter | **DEFER** → sonraki PR prototipi |
| RSS incremental preview | **SHIP** (sonraki PR) |
| Export-first entegrasyon | **DEFER** |
| Extension/bookmarklet | **KILL** |
| Proxy/provider | **KILL** |

## Implementation scopes (one PR each)

1. **PR-A:** Deploy current backend (P2/P3 kodu Render'da zaten merge adayı) — observability
   flatten alanları + atomic cache yazımı production'a geçer. Risk: düşük (backward-compatible).
2. **PR-B:** RSS incremental ön-kontrol — worker poll döngüsünde returning-user kısa devresi.
3. **PR-C:** Browser-use watchlist fallback adapter (yalnız `WatchlistScrapeError`
   Cloudflare durumunda tetiklenir).
4. **PR-D (ops):** Supervisor git pull hedefini `desktop_server`→`main` çevirme (ölü ref düzeltmesi).

## Remaining assumptions

1. Karar belgesi (`tmdb-prewarm-decision`) hiçbir yerde bulunamadı — P2/P3 kapsamı prompt
   metinlerinden çıkarıldı; §5 detaylarıyla karşılaştırma yapılamadı.
2. Canlı concurrency ölçümü yalnız 1 ve 2'de; 4/8 sentetikte güvenli ama canlıda
   doğrulanmadı (bilinçli: dış servis riski).
3. total_films parity kanıtı run-record'da persist edilmedi (proxy ile işaretli) — PR-A deployuyla kapanır.
4. Tek profil (@semihmutsuz) corpus'u mutlak değerleri sınırlar; göreli karşılaştırmalar geçerli.
5. Watchlist Cloudflare bloğunun kalıcılığı varsayıldı; blok kalkarsa browser adapter gerekmez.

## Eksik deneyler (kesin sonuç uydurma listesi)

1. **50/100 eşzamanlı GERÇEK scrape** — yapılmadı; IP-ban riski "ilk 429'da dur" kuralıyla çelişir.
2. **Role-split interference ölçümü** — D topolojisi koşulmadı.
3. **Prewarm kontrol-gruplu fayda ölçümü** — prewarmsız vs warm aynı job karşılaştırması yok.
