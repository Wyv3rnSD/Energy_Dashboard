"""JSON API over queries.py for the dashboard frontend (React, Next.js, ...).

Run:
    uvicorn api:app --reload            # http://localhost:8000
    open http://localhost:8000/docs     # interactive docs for every endpoint

All endpoints live under /api and return JSON. Tables come back as a list of
row objects, e.g. [{"area": "Germany", "year": 2024, "value": 58.3}, ...].
The browser origins allowed to call the API are set with CORS_ORIGINS in .env
(comma-separated); the defaults cover the React/Vite and Next.js dev servers.
"""

import math
import os
from datetime import date, datetime

import pandas as pd
from bson import ObjectId
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

import queries as q

app = FastAPI(
    title="Energy Dashboard API",
    description="Ember global electricity data from MySQL and MongoDB.",
    version="1.0.0",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in os.getenv(
        "CORS_ORIGINS", "http://localhost:3000,http://localhost:5173").split(",") if o.strip()],
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["*"],
)

Target = Query("renewable_generation_twh",
               pattern="^(renewable|total|fossil)_generation_twh$")


@app.exception_handler(ValueError)
def bad_value(_request, error: ValueError):
    """queries.py raises ValueError for unknown metrics or groups: a client error."""
    return JSONResponse(status_code=400, content={"detail": str(error)})


# --------------------------------------------------------------------------
# JSON conversion: DataFrames and MongoDB documents -> plain JSON values
# --------------------------------------------------------------------------

def clean(value):
    if isinstance(value, dict):
        return {k: clean(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [clean(v) for v in value]
    if isinstance(value, ObjectId):
        return str(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
        return None
    if hasattr(value, "item"):          # numpy scalars
        return clean(value.item())
    if value is pd.NA or value is pd.NaT:
        return None
    return value


def rows(frame: pd.DataFrame) -> list[dict]:
    return clean(frame.to_dict(orient="records"))


# --------------------------------------------------------------------------
# Lookups
# --------------------------------------------------------------------------

@app.get("/api/health", tags=["meta"])
def health():
    return {"status": "ok"}


@app.get("/api/meta", tags=["meta"])
def meta():
    """Everything the filter controls need: year range, continents, groups, metrics."""
    first, last = q.year_range()
    return {
        "year_min": first,
        "year_max": last,
        "continents": q.list_continents(),
        "memberships": sorted(q.MEMBERSHIPS),
        "data_metrics": sorted(q.DATA_METRICS),
        "summary_metrics": sorted(q.SUMMARY_METRICS),
    }


@app.get("/api/countries", tags=["lookups"])
def countries(continent: str | None = None, membership: str | None = None,
              include_regions: bool = False):
    return rows(q.list_countries(include_regions, continent, membership))


@app.get("/api/sources", tags=["lookups"])
def sources(include_aggregates: bool = False):
    return rows(q.list_sources(include_aggregates))


# --------------------------------------------------------------------------
# One country
# --------------------------------------------------------------------------

@app.get("/api/countries/{country_id}/profile", tags=["country"])
def profile(country_id: int):
    """MongoDB country profile: details, memberships, yearly series, latest mix."""
    doc = q.get_country_profile(country_id)
    if doc is None:
        raise HTTPException(404, f"No profile for country {country_id}")
    return clean(doc)


@app.get("/api/countries/{country_id}/mix", tags=["country"])
def mix(country_id: int, year: int):
    """Generation mix for one year (stored procedure get_country_mix)."""
    return rows(q.country_mix(country_id, year))


@app.get("/api/countries/{country_id}/mix-history", tags=["country"])
def mix_history(country_id: int):
    return rows(q.generation_mix_over_time(country_id))


@app.get("/api/countries/{country_id}/growth", tags=["country"])
def growth(country_id: int, source: str = "Solar"):
    """Year-on-year change and 3-year moving average (LAG / AVG window functions)."""
    return rows(q.yoy_growth(country_id, source))


# --------------------------------------------------------------------------
# Comparisons and rankings
# --------------------------------------------------------------------------

@app.get("/api/timeseries/source", tags=["compare"])
def source_timeseries(country_ids: list[int] = Query(..., description="repeat: ?country_ids=1&country_ids=2"),
                      source: str = "Total generation", metric: str = "generation_twh",
                      year_from: int = 1985, year_to: int = 2100):
    return rows(q.source_timeseries(country_ids, source, metric, year_from, year_to))


@app.get("/api/timeseries/summary", tags=["compare"])
def summary_timeseries(country_ids: list[int] = Query(...),
                       metric: str = "renewable_share_percent"):
    return rows(q.summary_timeseries(country_ids, metric))


@app.get("/api/rankings/top", tags=["rankings"])
def rankings_top(year: int, metric: str = "renewable_share_percent",
                 n: int = Query(10, ge=1, le=250), continent: str | None = None,
                 min_total_twh: float = 1.0):
    return rows(q.top_countries(year, metric, n, continent, min_total_twh))


@app.get("/api/rankings/movers", tags=["rankings"])
def rankings_movers(year_from: int, year_to: int, metric: str = "renewable_share_percent",
                    n: int = Query(10, ge=1, le=250), min_total_twh: float = 1.0):
    return rows(q.rank_movers(year_from, year_to, metric, n, min_total_twh))


@app.get("/api/rankings/leaders", tags=["rankings"])
def rankings_leaders(n: int = Query(10, ge=1, le=250)):
    """Latest renewable share leaders (MongoDB aggregation pipeline)."""
    return clean(q.latest_renewable_leaders(n))


@app.get("/api/continents/totals", tags=["rankings"])
def continents_totals(year: int):
    """Generation by continent and category with ROLLUP subtotals (null = subtotal)."""
    return rows(q.continent_totals(year))


@app.get("/api/scatter/emissions", tags=["compare"])
def scatter_emissions(year: int, min_total_twh: float = 1.0):
    return rows(q.emissions_vs_renewables(year, min_total_twh))


@app.get("/api/quality/renewable-share", tags=["meta"])
def quality_renewable_share(year: int):
    """Renewable share recomputed with a CTE vs the stored value."""
    return rows(q.renewable_share_check(year))


# --------------------------------------------------------------------------
# Forecasts (written by forecasting.py)
# --------------------------------------------------------------------------

@app.get("/api/forecasts/summary", tags=["forecasts"])
def forecasts_summary(target: str = Target):
    return clean(q.forecast_model_summary(target))


@app.get("/api/forecasts/{country_id}", tags=["forecasts"])
def forecasts(country_id: int, target: str = Target):
    """Every model's backtest and 2026+ forecast for one country, best model first."""
    runs = q.forecasts_for_country(country_id, target)
    if not runs:
        raise HTTPException(404, "No forecasts yet; run forecasting.py")
    return clean(runs)


# --------------------------------------------------------------------------
# Saved analyses (MongoDB)
# --------------------------------------------------------------------------

class AnalysisIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    filters: dict
    chart: dict = Field(default_factory=dict)


@app.get("/api/analyses", tags=["saved analyses"])
def analyses_list(limit: int = Query(20, ge=1, le=100)):
    return clean(q.list_saved_analyses(limit))


@app.post("/api/analyses", status_code=201, tags=["saved analyses"])
def analyses_create(analysis: AnalysisIn):
    return {"id": q.save_analysis(analysis.name, analysis.filters, analysis.chart)}


@app.delete("/api/analyses/{analysis_id}", status_code=204, tags=["saved analyses"])
def analyses_delete(analysis_id: str):
    if not ObjectId.is_valid(analysis_id) or not q.delete_analysis(analysis_id):
        raise HTTPException(404, "Analysis not found")
