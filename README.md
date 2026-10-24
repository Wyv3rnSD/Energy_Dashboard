# Energy Dashboard

Interactive dashboard on the [Ember](https://ember-energy.org/) global electricity dataset, built for the Database Concepts & Data Science course. Data lives in **MySQL** (normalised, source of truth) and **MongoDB** (country profiles, saved analyses, forecast runs), with Python as the integration layer.

## Repository layout

| Path | What it is |
| --- | --- |
| `release_generation_yearly_global.csv` | Raw Ember yearly dataset |
| `preprocessing.ipynb` | Cleans the raw CSV and writes the files in `processed/` |
| `processed/` | Cleaned CSVs: `countries`, `energy_sources`, `energy_data`, `energy_summary`, `ml_dataset`, `energy_cleaned` |
| `build_databases.py` | Builds the MySQL and MongoDB databases from `processed/` |
| `forecasting.py` | Backtests three models and saves 2026–2030 forecasts to MongoDB |
| `queries.py` | Query layer: every SQL and MongoDB read/write the dashboard uses |
| `api.py` | FastAPI JSON API over `queries.py` for the frontend |
| `frontend/` | React + Vite + Tailwind dashboard that calls the API |
| `setup_dashboard.bat`, `start_dashboard.bat`, `start_dashboard_hidden.vbs`, `stop_dashboard.bat` | Start and stop the whole dashboard on Windows without typing commands |
| `test_queries.py`, `test_api.py` | Check the queries and API against the built databases |
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

Requirements: Python 3.10+, MySQL 8, MongoDB Community Server 7.0+ (running locally or a connection string), Node.js 22 LTS (or 20.19+) for the frontend.

```bash
pip install -r requirements.txt
cp .env.example .env        # then fill in your MySQL password / MongoDB URI
```

## Run

```bash
python build_databases.py   # build both databases (--mysql-only / --mongo-only)
python forecasting.py       # backtest models, save forecasts (--target total_generation_twh)
python test_queries.py      # verify the queries
python test_api.py          # verify the API
python -m uvicorn api:app --reload    # start the API on http://localhost:8000
```

Interactive API docs (every endpoint, try-it-out buttons) are at http://localhost:8000/docs while the API runs.

Re-running `build_databases.py` is safe: it rebuilds the tables and `country_profiles` from scratch and leaves saved analyses and forecast runs untouched.

### Dashboard

With the API running, open a second terminal:

```bash
cd frontend
npm install                 # first time only
npm run dev                 # dashboard on http://localhost:5173
```

The dev server forwards `/api` requests to the API on port 8000. Every filter is stored in the page URL, so the address bar is a shareable link to the exact view. `npm run build` writes a static production build to `frontend/dist/`.

### One-click start (Windows)

First time on a new PC: install Python, Node.js, MySQL and MongoDB, then double-click `setup_dashboard.bat`. It installs the Python packages, creates `.env` (and opens it so you can enter your MySQL password), builds both databases, runs all three forecasts and builds the website. Running it again is safe: finished steps are skipped.

Double-click `start_dashboard.bat`. The first time, it builds the website into `frontend/dist/`. After that, the API serves both the data and the dashboard at http://localhost:8000, so you only run one process and no dev server. `stop_dashboard.bat` stops it.

To start the dashboard automatically at login with no terminal window, press Win+R, type `shell:startup`, and put a shortcut to `start_dashboard_hidden.vbs` in that folder. After editing the frontend, run `npm run build` in `frontend/` (or delete `frontend/dist/`) so the served site picks up the changes.

To regenerate `processed/` from the raw CSV, run `preprocessing.ipynb` top to bottom.

## Roadmap

- [x] Preprocessing
- [x] MySQL + MongoDB build
- [x] Query layer with advanced SQL (window functions, CTEs, ROLLUP, stored procedures)
- [x] Forecasting (naive baseline vs linear trend vs pooled Ridge on lagged log values)
- [x] API layer for the frontend (FastAPI)
- [x] Dashboard frontend (React + Vite + Tailwind + Recharts)
