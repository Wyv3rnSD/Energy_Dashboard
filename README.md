# Energy Dashboard

Interactive dashboard on the [Ember](https://ember-energy.org/) global electricity dataset, built for the Database Concepts & Data Science course. Data lives in **MySQL** (normalised, source of truth) and **MongoDB** (country profiles, saved analyses, forecast runs), with Python as the integration layer.

## Repository layout

| Path | What it is |
| --- | --- |
| `release_generation_yearly_global.csv` | Raw Ember yearly dataset |
| `preprocessing.ipynb` | Cleans the raw CSV and writes the files in `processed/` |
| `processed/` | Cleaned CSVs: `countries`, `energy_sources`, `energy_data`, `energy_summary`, `ml_dataset`, `energy_cleaned` |
| `build_databases.py` | Builds the MySQL and MongoDB databases from `processed/` |
| `queries.py` | Query layer: every SQL and MongoDB read/write the dashboard uses |
| `test_queries.py` | Checks the queries against the built databases |
| `INGESTION_PLAN.md` | Schema design and CSV-to-table mapping |

## Database design

**MySQL (`energy_db`)**

- `countries` (PK `country_id`): name, ISO code, continent, region, EU/OECD/G20/G7/ASEAN membership
- `energy_sources` (PK `source_id`): category and renewable / fossil / low-carbon / aggregate flags
- `energy_data` (PK `country_id, source_id, year`): generation, capacity, emissions and their year-on-year changes
- `energy_summary` (PK `country_id, year`): total, renewable and fossil generation and shares
- `ml_features` (PK `country_id, year`): lag and growth features for forecasting
- View `v_country_year`; stored procedures `get_country_mix`, `get_top_renewable`

**MongoDB (`energy_nosql`)**

- `country_profiles`: one document per country with its yearly series and latest generation mix
- `saved_analyses`, `scenarios`, `forecast_runs`: app collections with schema validation

## Setup

Requirements: Python 3.10+, MySQL 8, MongoDB Community Server (running locally or a connection string).

```bash
pip install -r requirements.txt
cp .env.example .env        # then fill in your MySQL password / MongoDB URI
```

## Run

```bash
python build_databases.py   # build both databases (--mysql-only / --mongo-only)
python test_queries.py      # verify the queries
```

Re-running `build_databases.py` is safe: it rebuilds the tables and `country_profiles` from scratch and leaves saved analyses and forecast runs untouched.

To regenerate `processed/` from the raw CSV, run `preprocessing.ipynb` top to bottom.

## Roadmap

- [x] Preprocessing
- [x] MySQL + MongoDB build
- [x] Query layer with advanced SQL (window functions, CTEs, ROLLUP, stored procedures)
- [ ] Forecasting (baseline vs linear trend vs Ridge with lag features)
- [ ] API layer for the frontend
- [ ] Dashboard frontend
