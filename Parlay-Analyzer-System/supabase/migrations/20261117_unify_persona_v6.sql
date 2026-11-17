-- Persona V6 terpadu (17 Nov 2026): kosongkan persona lama
-- "Quant Sniper v4" dari database agar fallback kode (PERSONA_V6)
-- menjadi satu-satunya sumber kebenaran persona. Persona lama
-- menyuruh model menghitung EV/stake dan membaca sharp money,
-- bertabrakan dengan kontrak penutup dan arsitektur pasar-dulu.
update scheduler_config set ai_persona = null, updated_at = now();
