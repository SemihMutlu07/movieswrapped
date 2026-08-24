# 🎬 Letterboxd Wrapped - Outbound Desktop Scrape Worker Kurulum Kılavuzu

Bu kılavuz, Render üzerinde çalışan bulut backend sunucusunun (datacenter IP engellemelerinden kaçınmak için) ağır kazıma (scraping) ve TMDB analiz işlemlerini yerel makinenize (evdeki masaüstü bilgisayara) yönlendirmesini sağlayan **Outbound Desktop Scrape Worker** sisteminin kurulumunu ve otomatik başlatılmasını adım adım anlatmaktadır.

---

## 🛠️ Ön Gereksinimler

1. **Python 3.11+** (Windows üzerinde yüklü olmalı ve PATH değişkenine eklenmiş olmalıdır).
2. **Git** (Projeyi clone etmek ve güncellemek için).
3. **Render Backend Hesabı** (Ortam değişkenlerini yapılandırmak için).

---

## 🚀 Adım Adım Kurulum

### Adım 1: Repo Kurulumu ve Güncelleme
Masaüstünüzde PowerShell veya Windows Terminal açıp aşağıdaki komutlarla projeyi çekin ve `main` branch'ine geçiş yapın:

```powershell
cd $HOME\Desktop
# Eğer repo daha önce klonlanmadıysa:
git clone https://github.com/SemihMutlu07/letterboxd_wrapped.git
cd letterboxd_wrapped
git checkout main

# Eğer zaten klonlanmış durumdaysa:
git fetch origin
git checkout main
git pull origin main
```

---

### Adım 2: Sanal Ortam (venv) ve Bağımlılıkların Kurulumu
`backend/` klasörüne girip Python sanal ortamını oluşturun ve gerekli kütüphaneleri yükleyin:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\activate
python -m pip install --upgrade pip
pip install -r requirements.txt
```

---

### Adım 3: Yerel `.env` Yapılandırması
`backend/` dizini altında `.env` adında bir dosya oluşturun ve içerisine aşağıdaki değişkenleri yerleştirin:

```env
TMDB_API_KEY=BURAYA_TMDB_API_ANAHTARINIZ
WORKER_TOKEN=BURAYA_GUCLU_RASTGELE_SECRET
WORKER_BACKEND_URL=https://wrapped-backend.onrender.com
# Opsiyonel: worker açıldığında @semihmutsuz ile gerçek scrape smoke test koşturur.
# Sadece bilinçli test günlerinde açın; her restart Letterboxd'a istek atar.
WORKER_SELF_TEST_ON_START=0
WORKER_SELF_TEST_USERNAME=semihmutsuz
```

> [!NOTE]
> ScraperAPI entegrasyonu 2026-07-02'de tümüyle kaldırıldı. Eski `.env` dosyanızda `SCRAPER_API_KEY` satırı varsa silin — artık hiçbir etkisi yok; sistem her zaman yerel IP adresiniz üzerinden kazır.

---

### Adım 4: Render Tarafının Yapılandırılması (Çok Önemli)
Masaüstündeki worker'ın backend ile güvenli haberleşebilmesi ve backend'in iş kuyruğu modunu aktif edebilmesi için:

1. **Render Dashboard**'a girin.
2. Backend servisinize (`wrapped-backend` veya ilgili servis) tıklayın.
3. **Environment** sekmesine gidin.
4. Yeni bir environment variable ekleyin:
   * **Key:** `WORKER_TOKEN`
   * **Value:** Masaüstündeki `WORKER_TOKEN` ile birebir aynı güçlü secret.
5. Ayarları kaydedin ve servisinizi **Redeploy** edin.

---

### Adım 5: Manuel Başlatma ve Doğrulama
Hâlâ `backend/` klasöründeyken terminalde şu komutu çalıştırarak worker'ı başlatın:

```powershell
$env:PYTHONUTF8="1"
python -m app.worker.desktop_scrape_worker
```

**Başarılı Çalışma Belirtileri:**
* Terminal loglarında `Desktop scrape worker starting — backend=https://wrapped-backend.onrender.com...` görünmelidir.
* Dashboard'da heartbeat yaşı güncel kalmalı ve worker `Live` görünmelidir.
* Eğer `401` hatası alıyorsanız, Render'daki `WORKER_TOKEN` ile yerel `.env` içindeki değer uyuşmuyor demektir.
* Eğer `404` alıyorsanız, Render backend'inize `main` branch'indeki kodlar henüz başarıyla deploy edilmemiştir.

### Adım 5.1: Admin Dashboard'dan Canlılık Kontrolü

Backend çalışırken şu sayfadan desktop worker durumunu kontrol edin:

```text
https://wrapped-backend.onrender.com/admin/dashboard
```

`ADMIN_SECRET` değerini giriş formuna girin. (Güvenlik notu: dashboard artık
URL'deki `?key=` parametresiyle kimlik doğrulamıyor; query parametreli eski
linkler temizlenip login form'una yönlendirilir.)

Dashboard'daki **Desktop Worker** sekmesi şunları gösterir:

* Worker live/offline/disabled durumu.
* Son heartbeat yaşı.
* Kuyruktaki ve çalışan scrape işleri.
* Worker startup/shutdown zamanı.
* Opsiyonel startup self-test sonucu (`WORKER_SELF_TEST_ON_START=1` ise @semihmutsuz scrape testi).

> [!NOTE]
> Worker aniden kapanırsa shutdown bilgisi gelmeyebilir; bu normaldir. Bu durumda dashboard, heartbeat süresi dolunca worker'ı offline gösterir.

### Adım 5.2: Direkt Scrape Kabul Testi

Render ve desktop worker aynı commit'e güncellendikten, worker
`WORKER_SELF_TEST_ON_START=1` ile başlatıldıktan sonra `backend/` dizininde:

```powershell
python scripts/verify_desktop_direct_scrape.py --username semihmutsuz
```

Script `ADMIN_SECRET` değerini güvenli prompt ile ister ve şu koşulların tamamı
sağlanmazsa hata koduyla çıkar: worker online, startup self-test films > 0,
transport `direct_cloudscraper`, scrape isteği HTTP 202, poll sonucu `done` ve
`total_films > 0`.

---

### Adım 6: Çalıştırma Betiği
Repo içinde hazır bir başlatıcı var; masaüstünde ayrı bir `.bat` yazmanıza
gerek yok:

```bat
backend\start-worker.bat
```

Bu betik `start-worker-supervisor.ps1`'i çalıştırır: worker çökerse otomatik
yeniden başlatır, tek-instance mutex ile çift başlatmayı engeller ve logları
`worker-supervisor.log` / `worker.log` altına yazar.

---

### Adım 7: Windows Açılışında Otomatik Başlatma (Task Scheduler)
Sistemin kesintisiz çalışması için bilgisayar açıldığında bu betiği otomatik çalışacak şekilde ayarlayın:

1. Başlat menüsüne **Task Scheduler (Görev Zamanlayıcı)** yazıp açın.
2. Sağdaki eylemler menüsünden **Create Basic Task (Temel Görev Oluştur)** seçin.
3. **Name (Ad):** `Letterboxd Desktop Worker`
4. **Trigger (Tetikleyici):** *When I log on* (Oturum açtığımda).
5. **Action (Eylem):** *Start a program*.
6. **Program/Script:** repodaki `C:\...\letterboxd_wrapped\backend\start-worker.bat` dosyasının tam yolunu seçin.
7. Görev oluştuktan sonra listeden bulup sağ tıklayın ve **Properties (Özellikler)** penceresini açın:
   * **General (Genel) Sekmesi:** *"Run only when user is logged on"* ve *"Run with highest privileges"* kutucuklarını işaretleyin.
   * **Settings (Ayarlar) Sekmesi:** *"If the task fails, restart every: 1 minute"* ve *"Attempt to restart up to: 3 times"* seçeneklerini açın.
8. Kaydedip kapatın. Artık sisteminiz her açıldığında worker arka planda hazır olacaktır!
