#!/usr/bin/env bash
# Menjalankan migrasi + tes otorisasi/RLS pada database Postgres sementara yang bersih.
# Kebutuhan: psql dan akses ke server Postgres 15+ (superuser).
# Variabel: PGHOST, PGPORT, PGUSER (default: localhost/5432/postgres), TEST_DB (default: simaspraja_test)
set -euo pipefail
cd "$(dirname "$0")/../.."

: "${PGHOST:=localhost}" "${PGPORT:=5432}" "${PGUSER:=postgres}" "${TEST_DB:=simaspraja_test}"
export PGHOST PGPORT PGUSER

psql -v ON_ERROR_STOP=1 -q -d postgres -c "drop database if exists ${TEST_DB}" -c "create database ${TEST_DB}"
run() { psql -v ON_ERROR_STOP=1 -q -d "${TEST_DB}" -f "$1"; }

run supabase/tests/00_supabase_shim.sql
for f in supabase/migrations/*.sql; do echo "-- migrasi: $f"; run "$f"; done
psql -v ON_ERROR_STOP=1 -q -d "${TEST_DB}" -f supabase/tests/10_rls_authorization_tests.sql
psql -v ON_ERROR_STOP=1 -q -d "${TEST_DB}" -f supabase/tests/30_workflow_tests.sql
psql -v ON_ERROR_STOP=1 -q -d "${TEST_DB}" -f supabase/tests/40_dpa_tests.sql
psql -v ON_ERROR_STOP=1 -q -d "${TEST_DB}" -f supabase/tests/50_supplier_tests.sql
psql -v ON_ERROR_STOP=1 -q -d "${TEST_DB}" -f supabase/tests/60_realization_tests.sql
psql -v ON_ERROR_STOP=1 -q -d "${TEST_DB}" -f supabase/tests/70_sp2d_status_tests.sql
psql -v ON_ERROR_STOP=1 -q -d "${TEST_DB}" -f supabase/tests/80_import_realisasi_tests.sql
