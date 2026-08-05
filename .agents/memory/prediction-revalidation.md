---
name: Prediction Revalidation
description: Durable rules for checking already-scanned predictions before kickoff
---

Revalidasi prediksi pre-kickoff harus memakai kolom/sinyal terpisah dari `ai_predictions.status`. Status settlement tetap `active` sampai fixture selesai; gunakan status risiko seperti `keep`, `review`, atau `invalidated` untuk perubahan odds/EV.

**Why:** Settlement mengambil `status = active` sebagai sumber prediksi yang belum diselesaikan. Mengganti status itu menjadi `review` atau `invalidated` akan membuat settlement melewatkan fixture dan merusak pencatatan hasil.

**How to apply:** Revalidasi hanya memeriksa prediksi aktif untuk fixture yang belum kickoff, membandingkan odds terbaru dengan baseline odds saat analisis, dan tidak mengubah `parlays`/`parlay_legs`. Prediksi lama tanpa baseline odds harus diberi `review`, bukan dianggap `keep`.