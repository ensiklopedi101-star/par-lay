---
name: Canonical Frontend Workflow
description: Which frontend workflow should serve the main preview
---

`Start application` adalah workflow frontend canonical dan harus memakai port 5000. Workflow artifact `Parlay-Analyzer-System/artifacts/parlay-app: web` dikelola platform sehingga tidak dapat dihapus permanen, tetapi harus tetap stopped agar tidak mengambil port atau membuat preview ambigu.

**Why:** Menjalankan dua Vite server untuk artifact yang sama membuat preview bisa mengarah ke port dinamis dan terlihat loading atau tidak konsisten.

**How to apply:** Setelah perubahan frontend, restart `Start application`. Jika workflow artifact frontend muncul kembali, stop workflow tersebut dan jangan mengganti workflow utama.