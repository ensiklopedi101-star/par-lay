---
name: Canonical Frontend Workflow
description: Which frontend workflow should serve the main preview
---

`Start application` adalah workflow canonical untuk development: jalankan frontend di port 5000 dan API di port 8080 dalam satu lifecycle. Workflow artifact `Parlay-Analyzer-System/artifacts/parlay-app: web` dikelola platform sehingga tidak dapat dihapus permanen, tetapi harus tetap stopped agar tidak mengambil port atau membuat preview ambigu. API artifact workflow juga tidak perlu dijalankan terpisah ketika workflow utama sudah aktif.

**Why:** Workflow frontend dan API yang terpisah dapat menyebabkan frontend berjalan sementara API mati, menghasilkan request gagal dan dashboard loading.

**How to apply:** Workflow utama harus membuka port 5000 untuk preview dan memulai API pada 8080. Setelah perubahan server-side, restart `Start application`. Jika workflow artifact frontend muncul kembali, stop workflow tersebut dan jangan mengganti workflow utama.