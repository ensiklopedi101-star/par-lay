---
name: Risk Center Health
description: Durable rules for dashboard risk visibility and AI pipeline health
---

Health monitor harus membedakan prediksi aktif yang tersimpan dari proses AI yang sedang berjalan. Status `ready` berarti pipeline bisa dipakai; jumlah `activePredictions`, `reviewPredictions`, dan `invalidatedPredictions` ditampilkan terpisah.

**Why:** Query Supabase dengan `head: true` tidak mengembalikan rows untuk menentukan apakah pipeline sedang menghitung. Menyamakan prediksi aktif dengan status `calculating` membuat dashboard memberi sinyal kesehatan yang keliru.

**How to apply:** Risk Center hanya mengambil `ai_predictions.status = active` dan fixture dengan `fixture_date` di masa depan. Status revalidasi ditampilkan sebagai tindakan operasional, tanpa mengubah settlement atau histori `parlay_legs`.