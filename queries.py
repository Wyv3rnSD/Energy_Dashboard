"""Query layer for the dashboard: every MySQL and MongoDB read/write lives here.

The dashboard imports these functions and never writes SQL itself. Every
function returns a pandas DataFrame (MySQL) or plain dicts (MongoDB).

Column names can't be bound as SQL parameters, so any function that takes a
metric name checks it against a fixed whitelist first.
"""

import os
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path

import pandas as pd
from dotenv import load_dotenv
from sqlalchemy import URL, create_engine, text
from sqlalchemy.engine import Engine

load_dotenv(Path(__file__).resolve().parent / ".env")

DATA_METRICS = {
    "generation_twh", "generation_yoy_twh", "generation_yoy_percent",
    "generation_share_percent", "generation_share_yoy_points", "capacity_gw",
    "emissions_mtco2e", "emissions_yoy_mtco2e", "emissions_yoy_percent",
    "emissions_share_percent", "emissions_intensity_gco2e_kwh",
}
SUMMARY_METRICS = {
    "total_generation_twh", "renewable_generation_twh", "renewable_share_percent",
    "fossil_generation_twh", "fossil_share_percent",
}
MEMBERSHIPS = {"EU": "eu_member", "OECD": "oecd_member", "G20": "g20_member",
               "G7": "g7_member", "ASEAN": "asean_member"}


def _check(value: str, allowed: set[str], what: str) -> str:
    if value not in allowed:
        raise ValueError(f"Unknown {what} {value!r}; choose from {sorted(allowed)}")
    return value


# --------------------------------------------------------------------------
# Connections
# --------------------------------------------------------------------------

@lru_cache(maxsize=1)
def get_engine() -> Engine:
    url = URL.create(
        "mysql+pymysql",
        username=os.getenv("MYSQL_USER", "root"),
        password=os.getenv("MYSQL_PASSWORD", ""),
        host=os.getenv("MYSQL_HOST", "localhost"),
        port=int(os.getenv("MYSQL_PORT", "3306")),
        database=os.getenv("MYSQL_DB", "energy_db"),
        query={"charset": "utf8mb4"},
    )
    return create_engine(url, pool_pre_ping=True, pool_recycle=3600)


@lru_cache(maxsize=1)
def get_mongo():
    from pymongo import MongoClient
    client = MongoClient(os.getenv("MONGO_URI", "mongodb://localhost:27017"),
                         serverSelectionTimeoutMS=5000)
    return client[os.getenv("MONGO_DB", "energy_nosql")]


def run_sql(sql: str, **params) -> pd.DataFrame:
    with get_engine().connect() as conn:
        return pd.read_sql(text(sql), conn, params=params)


def call_procedure(name: str, *args) -> pd.DataFrame:
    """Call a stored procedure and return its first result set."""
    raw = get_engine().raw_connection()
    try:
        cursor = raw.cursor()
        cursor.callproc(name, args)
        columns = [d[0] for d in cursor.description]
        frame = pd.DataFrame(cursor.fetchall(), columns=columns)
        cursor.close()
        return frame
    finally:
        raw.close()


# --------------------------------------------------------------------------
# Lookups (filters for the dashboard's dropdowns)
# --------------------------------------------------------------------------

def list_countries(include_regions: bool = False, continent: str | None = None,
                   membership: str | None = None) -> pd.DataFrame:
    """Countries (and optionally regions like EU or World), filterable by
    continent and by group membership (EU, OECD, G20, G7, ASEAN)."""
    where = ["1 = 1"]
    params = {}
    if not include_regions:
        where.append("area_type = 'Country or economy'")
    if continent:
        where.append("continent = :continent")
        params["continent"] = continent
    if membership:
        where.append(f"{MEMBERSHIPS[_check(membership, set(MEMBERSHIPS), 'membership')]} = TRUE")
    return run_sql(f"""
        SELECT country_id, area, iso_code, continent, ember_region, area_type
        FROM countries WHERE {' AND '.join(where)} ORDER BY area""", **params)


def list_sources(include_aggregates: bool = False) -> pd.DataFrame:
    sql = "SELECT * FROM energy_sources"
    if not include_aggregates:
        sql += " WHERE is_aggregated_source = FALSE"
    return run_sql(sql + " ORDER BY electricity_source")


def list_continents() -> list[str]:
    return run_sql("""SELECT DISTINCT continent FROM countries
                      WHERE continent IS NOT NULL ORDER BY continent""")["continent"].tolist()


def year_range() -> tuple[int, int]:
    row = run_sql("SELECT MIN(year) AS lo, MAX(year) AS hi FROM energy_data").iloc[0]
    return int(row.lo), int(row.hi)


# --------------------------------------------------------------------------
# Time series and comparisons
# --------------------------------------------------------------------------

def source_timeseries(country_ids: list[int], source: str = "Total generation",
                      metric: str = "generation_twh", year_from: int = 1985,
                      year_to: int = 2100) -> pd.DataFrame:
    """One metric for one source over time, for several countries (line chart)."""
    _check(metric, DATA_METRICS, "metric")
    if not country_ids:
        return pd.DataFrame(columns=["area", "year", metric])
    ids = {f"c{i}": cid for i, cid in enumerate(country_ids)}
    return run_sql(f"""
        SELECT c.area, e.year, e.{metric}
        FROM energy_data e
        JOIN countries c ON c.country_id = e.country_id
        JOIN energy_sources s ON s.source_id = e.source_id
        WHERE e.country_id IN ({', '.join(':' + k for k in ids)})
          AND s.electricity_source = :source
          AND e.year BETWEEN :y0 AND :y1
        ORDER BY c.area, e.year""", source=source, y0=year_from, y1=year_to, **ids)


def summary_timeseries(country_ids: list[int], metric: str = "renewable_share_percent"
                       ) -> pd.DataFrame:
    """A summary metric (e.g. renewable share) over time for several countries."""
    _check(metric, SUMMARY_METRICS, "metric")
    if not country_ids:
        return pd.DataFrame(columns=["area", "year", metric])
    ids = {f"c{i}": cid for i, cid in enumerate(country_ids)}
    return run_sql(f"""
        SELECT area, year, {metric} FROM v_country_year
        WHERE country_id IN ({', '.join(':' + k for k in ids)})
        ORDER BY area, year""", **ids)


def generation_mix_over_time(country_id: int) -> pd.DataFrame:
    """Every real source's generation per year for one country (stacked area chart)."""
    return run_sql("""
        SELECT e.year, s.electricity_source, s.energy_category, e.generation_twh
        FROM energy_data e
        JOIN energy_sources s ON s.source_id = e.source_id
        WHERE e.country_id = :cid AND s.is_aggregated_source = FALSE
          AND s.electricity_source <> 'Net imports'
          AND e.generation_twh IS NOT NULL
        ORDER BY e.year, s.electricity_source""", cid=country_id)


def country_mix(country_id: int, year: int) -> pd.DataFrame:
    """Generation mix for one country and year (pie chart), via stored procedure."""
    return call_procedure("get_country_mix", country_id, year)


# --------------------------------------------------------------------------
# Advanced SQL: window functions, CTEs, ROLLUP
# --------------------------------------------------------------------------

def yoy_growth(country_id: int, source: str = "Solar") -> pd.DataFrame:
    """Year-on-year change computed in SQL with LAG(), plus a 3-year moving
    average, compared against Ember's own published YoY column."""
    return run_sql("""
        SELECT e.year,
               e.generation_twh,
               LAG(e.generation_twh) OVER w AS prev_twh,
               e.generation_twh - LAG(e.generation_twh) OVER w AS yoy_twh,
               ROUND(100 * (e.generation_twh - LAG(e.generation_twh) OVER w)
                     / NULLIF(LAG(e.generation_twh) OVER w, 0), 2) AS yoy_percent,
               AVG(e.generation_twh) OVER (w ROWS BETWEEN 2 PRECEDING AND CURRENT ROW)
                   AS moving_avg_3yr,
               e.generation_yoy_twh AS ember_yoy_twh
        FROM energy_data e
        JOIN energy_sources s ON s.source_id = e.source_id
        WHERE e.country_id = :cid AND s.electricity_source = :source
        WINDOW w AS (ORDER BY e.year)
        ORDER BY e.year""", cid=country_id, source=source)


def top_countries(year: int, metric: str = "renewable_share_percent", n: int = 10,
                  continent: str | None = None, min_total_twh: float = 1.0) -> pd.DataFrame:
    """Top-N countries for a summary metric in a year, ranked with RANK().
    Countries generating under min_total_twh are skipped so tiny grids don't dominate."""
    _check(metric, SUMMARY_METRICS, "metric")
    return run_sql(f"""
        WITH ranked AS (
            SELECT area, continent, {metric} AS value, total_generation_twh,
                   RANK() OVER (ORDER BY {metric} DESC) AS overall_rank,
                   RANK() OVER (PARTITION BY continent ORDER BY {metric} DESC) AS continent_rank
            FROM v_country_year
            WHERE year = :year AND total_generation_twh >= :min_twh
              AND {metric} IS NOT NULL
        )
        SELECT * FROM ranked
        WHERE (:continent IS NULL OR continent = :continent)
        ORDER BY overall_rank
        LIMIT :n""", year=year, n=n, continent=continent, min_twh=min_total_twh)


def rank_movers(year_from: int, year_to: int, metric: str = "renewable_share_percent",
                n: int = 10, min_total_twh: float = 1.0) -> pd.DataFrame:
    """Countries whose rank changed most between two years (two ranked CTEs joined)."""
    _check(metric, SUMMARY_METRICS, "metric")
    return run_sql(f"""
        WITH r0 AS (
            SELECT country_id, {metric} AS v0,
                   RANK() OVER (ORDER BY {metric} DESC) AS rank_from
            FROM energy_summary WHERE year = :y0 AND total_generation_twh >= :min_twh
        ), r1 AS (
            SELECT country_id, {metric} AS v1,
                   RANK() OVER (ORDER BY {metric} DESC) AS rank_to
            FROM energy_summary WHERE year = :y1 AND total_generation_twh >= :min_twh
        )
        SELECT c.area, r0.v0 AS value_from, r1.v1 AS value_to,
               r0.rank_from, r1.rank_to,
               CAST(r0.rank_from AS SIGNED) - CAST(r1.rank_to AS SIGNED) AS places_gained
        FROM r0 JOIN r1 USING (country_id)
        JOIN countries c USING (country_id)
        ORDER BY places_gained DESC
        LIMIT :n""", y0=year_from, y1=year_to, n=n, min_twh=min_total_twh)


def continent_totals(year: int) -> pd.DataFrame:
    """Generation by continent and energy category with subtotals (GROUP BY ROLLUP).
    Rows where energy_category is NULL are continent subtotals; the row where both
    are NULL is the grand total."""
    return run_sql("""
        SELECT c.continent, s.energy_category, ROUND(SUM(e.generation_twh), 2) AS generation_twh
        FROM energy_data e
        JOIN countries c ON c.country_id = e.country_id
        JOIN energy_sources s ON s.source_id = e.source_id
        WHERE e.year = :year AND c.area_type = 'Country or economy'
          AND s.is_aggregated_source = FALSE AND s.electricity_source <> 'Net imports'
        GROUP BY c.continent, s.energy_category WITH ROLLUP""", year=year)


def renewable_share_check(year: int) -> pd.DataFrame:
    """Recompute renewable share from source-level rows with a CTE and compare it
    with the stored energy_summary value; a data-quality check worth showing."""
    return run_sql("""
        WITH by_source AS (
            SELECT e.country_id,
                   SUM(CASE WHEN s.is_renewable THEN e.generation_twh END) AS renewable_twh,
                   MAX(CASE WHEN s.electricity_source = 'Total generation'
                            THEN e.generation_twh END) AS total_twh
            FROM energy_data e
            JOIN energy_sources s ON s.source_id = e.source_id
            WHERE e.year = :year
            GROUP BY e.country_id
        )
        SELECT c.area,
               ROUND(100 * b.renewable_twh / NULLIF(b.total_twh, 0), 2) AS computed_share,
               ROUND(es.renewable_share_percent, 2) AS stored_share,
               ROUND(ABS(100 * b.renewable_twh / NULLIF(b.total_twh, 0)
                         - es.renewable_share_percent), 3) AS difference
        FROM by_source b
        JOIN energy_summary es ON es.country_id = b.country_id AND es.year = :year
        JOIN countries c ON c.country_id = b.country_id
        ORDER BY difference DESC""", year=year)


def emissions_vs_renewables(year: int, min_total_twh: float = 1.0) -> pd.DataFrame:
    """Each country's renewable share against its grid carbon intensity (scatter plot)."""
    return run_sql("""
        SELECT c.area, c.continent, es.renewable_share_percent, es.total_generation_twh,
               e.emissions_intensity_gco2e_kwh
        FROM energy_summary es
        JOIN countries c ON c.country_id = es.country_id
        JOIN energy_data e ON e.country_id = es.country_id AND e.year = es.year
        JOIN energy_sources s ON s.source_id = e.source_id
        WHERE es.year = :year AND s.electricity_source = 'Total generation'
          AND es.total_generation_twh >= :min_twh
          AND e.emissions_intensity_gco2e_kwh IS NOT NULL""", year=year, min_twh=min_total_twh)


def top_renewable(year: int, n: int = 10, min_total_twh: float = 1.0) -> pd.DataFrame:
    """Top-N renewable share via the get_top_renewable stored procedure."""
    return call_procedure("get_top_renewable", year, n, min_total_twh)


def ml_training_data(country_id: int | None = None) -> pd.DataFrame:
    """Features for forecasting: lag/growth features joined to the yearly summary."""
    sql = """
        SELECT c.area, f.country_id, f.year, s.renewable_generation_twh,
               s.total_generation_twh, s.renewable_share_percent,
               f.generation_lag_1, f.generation_lag_2, f.generation_lag_3,
               f.renewable_growth_percent, f.renewable_3yr_growth_percent
        FROM ml_features f
        JOIN energy_summary s ON s.country_id = f.country_id AND s.year = f.year
        JOIN countries c ON c.country_id = f.country_id"""
    if country_id is None:
        return run_sql(sql + " ORDER BY f.country_id, f.year")
    return run_sql(sql + " WHERE f.country_id = :cid ORDER BY f.year", cid=country_id)


# --------------------------------------------------------------------------
# MongoDB
# --------------------------------------------------------------------------

def get_country_profile(country_id: int) -> dict | None:
    return get_mongo()["country_profiles"].find_one({"_id": int(country_id)})


def find_profiles(membership: str | None = None, continent: str | None = None) -> list[dict]:
    """Country profiles filtered by group and/or continent, without the long series."""
    query = {}
    if membership:
        query["memberships"] = _check(membership, set(MEMBERSHIPS), "membership")
    if continent:
        query["continent"] = continent
    return list(get_mongo()["country_profiles"].find(query, {"series": 0}).sort("area", 1))


def latest_renewable_leaders(n: int = 10) -> list[dict]:
    """Aggregation pipeline: each country's latest renewable share, highest first."""
    pipeline = [
        {"$project": {"area": 1, "continent": 1, "latest": {"$last": "$series"}}},
        {"$match": {"latest.total_generation_twh": {"$gte": 1}}},
        {"$project": {"area": 1, "continent": 1, "year": "$latest.year",
                      "renewable_share_percent": "$latest.renewable_share_percent"}},
        {"$sort": {"renewable_share_percent": -1}},
        {"$limit": n},
    ]
    return list(get_mongo()["country_profiles"].aggregate(pipeline))


def save_analysis(name: str, filters: dict, chart: dict | None = None) -> str:
    doc = {"name": name, "filters": filters, "chart": chart or {},
           "created_at": datetime.now(timezone.utc)}
    return str(get_mongo()["saved_analyses"].insert_one(doc).inserted_id)


def list_saved_analyses(limit: int = 20) -> list[dict]:
    return list(get_mongo()["saved_analyses"].find().sort("created_at", -1).limit(limit))


def delete_analysis(analysis_id: str) -> bool:
    from bson import ObjectId
    return get_mongo()["saved_analyses"].delete_one({"_id": ObjectId(analysis_id)}).deleted_count == 1


def save_forecast_run(model: str, target: str, country_id: int, metrics: dict,
                      predictions: list[dict], params: dict | None = None) -> str:
    doc = {"model": model, "target": target, "country_id": int(country_id),
           "params": params or {}, "metrics": metrics, "predictions": predictions,
           "created_at": datetime.now(timezone.utc)}
    return str(get_mongo()["forecast_runs"].insert_one(doc).inserted_id)


def latest_forecast(country_id: int, target: str = "renewable_generation_twh") -> dict | None:
    return get_mongo()["forecast_runs"].find_one(
        {"country_id": int(country_id), "target": target}, sort=[("created_at", -1)])
