# Ingestion Plan: processed CSVs → MySQL + MongoDB

## 1. What the processed CSVs contain (checked 2026-10-18)

| File | Rows × cols | Grain / key | Notes |
| --- | --- | --- | --- |
| `countries.csv` | 224 × 6 | `country_id` (unique), `area` unique | 209 "Country or economy" + 15 "Region" (ASEAN, EU, World…). Regions have no ISO/continent. |
| `energy_sources.csv` | 17 × 7 | `source_id` | 7 of 17 are aggregates (`Total generation`, `Demand`, `Fossil`, `Clean`, `Renewables`, `Wind and solar`, `Hydro, bioenergy and other renewables`). |
| `energy_data.csv` | 104,273 × 14 | (`country_id`, `source_id`, `year`), no duplicates, no orphan FKs | Years 1985–2025. Wide fact table: generation, YoY, share, capacity, emissions, intensity. Many NULLs (capacity ~27%, intensity ~39%). 44,082 rows are aggregate sources. |
| `energy_summary.csv` | 5,910 × 9 | (`country_id`, `year`) | Countries only (209). Repeats `area`, `iso_code` from `countries`. |
| ⚠ `energy_summary` bug | | | `preprocessing.ipynb` cell 23 sums *all* sources (incl. aggregates, Demand, Net imports) into `total_generation_twh`, ~4.4× too high, so both share columns are too low (Germany 2024: 11% renewable instead of 58%). Fixed in the notebook on 2026-10-18 (cell 23 now uses the `Total generation` row; cell 31 turns ±inf growth into NaN) and the two CSVs regenerated. `build_databases.py` still recomputes the shares as a safeguard. |
| `ml_dataset.csv` | 5,283 × 14 | (`country_id`, `year`) | Countries only. Repeats every `energy_summary` column, adds lag_1..3 and growth features. Starts 2003 for AFG (first 3 years dropped for lags). |
| `energy_cleaned.csv` | 104,273 × 31 | same as `energy_data` | Fully denormalised join of the files above, row-for-row identical to `energy_data`. **Only file holding `eu/oecd/g20/g7/asean_member` flags** (constant per country). |

## 2. Review of the 8-step workflow

| Step | Verdict | Change |
| --- | --- | --- |
| 1 Scope & snapshot | Already done by `preprocessing.ipynb`. | Make `processed/` the single source of truth (Amey's version reads `ember_country_snapshot.csv`; pick one). **Keep** aggregated sources in SQL and filter with `is_aggregated_source` instead of deleting them: `Total generation` and `Demand` are what the dashboard's headline numbers and shares need, and re-summing them is error-prone. |
| 2 3NF schema | Good idea, but switch shape. | Use the wide `energy_data` fact table the CSVs already have instead of `indicators` + `observations` (EAV). EAV turns every chart into a pivot, forces one numeric type for all metrics, and Amey's version only kept 3 of the 11 metrics. Move the membership flags into `countries`. Drop repeated `area`/`iso_code` from summary and ML tables (transitive dependency, breaks 3NF). |
| 3 pandas ETL `ingest.py` | Good. | One script builds both databases (see §5). Explicit DDL first, then bulk insert in FK order, in one transaction. |
| 4 Advanced SQL | Good, keep. | Good showcases: YoY via `LAG()`, top-N per year with `RANK()`, renewable share via CTE over `energy_data` (can be checked against `energy_summary`), a view `v_country_year`, a stored procedure `get_country_mix(country, year)`. |
| 5 MongoDB | Good choice of collections. | Also seed one `country_profiles` collection from the CSVs, so "CSV → NoSQL" is real data, not only empty app collections. |
| 6 Forecasting | Fine for a course project. | Only ~20–40 yearly points per country, so: time-based split (e.g. train ≤ 2019, test 2020+), compare against a naive "last value / linear trend" baseline, report MAE/MAPE. Store run metadata + predictions in `forecast_runs`. |
| 7–8 Streamlit | Good. | Read MySQL through cached, parameterised queries (`st.cache_data`); Mongo for profiles/saved analyses/forecasts. |

## 3. MySQL tables (database `energy_db`)

| Table | From | Columns kept | Keys / indexes |
| --- | --- | --- | --- |
| `countries` | `countries.csv` + flags from `energy_cleaned.csv` | country_id, area, iso_code, continent, area_type, ember_region, eu/oecd/g20/g7/asean_member | PK `country_id`; UNIQUE `area`; INDEX `iso_code`, `continent` |
| `energy_sources` | `energy_sources.csv` | all 7 | PK `source_id`; UNIQUE `electricity_source` |
| `energy_data` | `energy_data.csv` | all 14 (metrics NULLable `DOUBLE`) | PK (`country_id`,`source_id`,`year`); FKs → countries, energy_sources; INDEX (`source_id`,`year`), (`year`) |
| `energy_summary` | `energy_summary.csv` | country_id, year, 5 metrics (drop area, iso_code) | PK (`country_id`,`year`); FK → countries |
| `ml_features` | `ml_dataset.csv` | country_id, year, lag_1..3, renewable_growth_percent, renewable_3yr_growth_percent (drop summary columns, join `energy_summary` for them) | PK (`country_id`,`year`); FK → (`energy_summary`.`country_id`,`year`) |

`energy_cleaned.csv` is **not** loaded as a table; it is only read to extract membership flags.

## 4. MongoDB collections (database `energy_nosql`)

| Collection | Filled by ingest? | Document shape | Why Mongo |
| --- | --- | --- | --- |
| `country_profiles` | Yes, from the CSVs | `{_id: iso_code or area, country_id, area, continent, memberships:[…], series:[{year, total_twh, renewable_share, fossil_share}…], latest_mix:{Solar: …, Coal: …}}` | One read per country page instead of several joins; nested arrays are natural here. |
| `saved_analyses` | Empty + indexes | user-saved filter sets and chart configs (varying fields) | Schema varies per chart type. |
| `scenarios` | Empty + indexes | "what if solar grows X%" inputs/outputs | Free-form parameters. |
| `forecast_runs` | Empty + indexes (filled by step 6) | `{model, params, features, train_years, metrics, predictions:[…], created_at}` | Each model has different params/metrics. |

MySQL stays the source of truth; `country_profiles` is a rebuildable read model.

## 5. One script: `build_databases.py`

1. Load `.env` (`MYSQL_HOST/PORT/USER/PASSWORD/DB`, `MONGO_URI`, `MONGO_DB`) via python-dotenv.
2. Read the processed CSVs with pandas; validate PK uniqueness, FK coverage and row counts; stop on failure.
3. MySQL (SQLAlchemy + PyMySQL): `CREATE DATABASE IF NOT EXISTS`, drop tables in reverse FK order, run explicit `CREATE TABLE` DDL, bulk insert in order countries → energy_sources → energy_data → energy_summary → ml_features (chunked `executemany`, NaN → NULL), all in one transaction; print row counts.
4. MongoDB (PyMongo): drop and rebuild `country_profiles` from the DataFrames (`insert_many`), create indexes and JSON-schema validators on the app collections.
5. Flags: `--mysql-only`, `--mongo-only`. Re-running is safe (full rebuild).

Files: `build_databases.py`, `.env.example`, `requirements.txt` (pandas, SQLAlchemy, PyMySQL, pymongo, python-dotenv, cryptography for MySQL 8 auth).
