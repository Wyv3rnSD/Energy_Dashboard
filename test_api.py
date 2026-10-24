"""Tests for api.py against the databases built by build_databases.py.

Run:  python test_api.py        (or: pytest test_api.py)
Forecast tests need `python forecasting.py` to have run first.
"""

from fastapi.testclient import TestClient

from api import app

client = TestClient(app)


def get(url: str, status: int = 200):
    response = client.get(url)
    assert response.status_code == status, f"{url}: {response.status_code} {response.text}"
    return response.json()


def germany_id() -> int:
    return next(c["country_id"] for c in get("/api/countries?membership=EU")
                if c["area"] == "Germany")


def test_meta_and_lookups():
    assert get("/api/health") == {"status": "ok"}
    meta = get("/api/meta")
    assert meta["year_min"] <= 2000 and meta["year_max"] >= 2024 and "Europe" in meta["continents"]
    assert len(get("/api/countries")) == 209
    assert len(get("/api/countries?include_regions=true")) == 224
    assert len(get("/api/sources")) == 10


def test_country_endpoints():
    de = germany_id()
    profile = get(f"/api/countries/{de}/profile")
    assert profile["area"] == "Germany" and isinstance(profile["built_at"], str)
    mix = get(f"/api/countries/{de}/mix?year=2024")
    assert abs(sum(r["share_percent"] for r in mix) - 100) < 0.1
    assert get(f"/api/countries/{de}/mix-history")
    growth = get(f"/api/countries/{de}/growth?source=Wind")
    assert growth[0]["yoy_twh"] is None          # NaN must come back as null
    get("/api/countries/999999/profile", status=404)


def test_compare_and_rankings():
    de, fr = germany_id(), get("/api/countries?continent=Europe")[0]["country_id"]
    ts = get(f"/api/timeseries/source?country_ids={de}&country_ids={fr}&source=Solar")
    assert len({r["area"] for r in ts}) == 2
    assert get(f"/api/timeseries/summary?country_ids={de}")
    assert len(get("/api/rankings/top?year=2024&n=5")) == 5
    assert len(get("/api/rankings/movers?year_from=2010&year_to=2024&n=5")) == 5
    assert len(get("/api/rankings/leaders?n=5")) == 5
    assert any(r["continent"] is None for r in get("/api/continents/totals?year=2024"))
    assert get("/api/scatter/emissions?year=2024")
    assert get("/api/quality/renewable-share?year=2024")


def test_data_explorer():
    de = germany_id()
    meta = get("/api/meta")
    assert meta["year_min"] < meta["default_year"] <= meta["year_max"]
    page = get(f"/api/data?country_ids={de}&year_from=2020&year_to=2024&limit=10")
    assert page["total"] > 10 and len(page["rows"]) == 10
    assert {r["area"] for r in page["rows"]} == {"Germany"}
    assert all(r["electricity_source"] != "Total generation" for r in page["rows"])
    second = get(f"/api/data?country_ids={de}&year_from=2020&year_to=2024&limit=10&offset=10")
    assert second["rows"][0] != page["rows"][0]
    solar = get(f"/api/data?country_ids={de}&sources=Solar&sources=Wind")
    assert {r["electricity_source"] for r in solar["rows"]} == {"Solar", "Wind"}


def test_bad_input_is_a_400():
    get("/api/rankings/top?year=2024&metric=drop_table", status=400)
    get("/api/countries?membership=NATO", status=400)
    get("/api/forecasts/summary?target=evil", status=422)


def test_forecasts():
    if not get("/api/forecasts/summary"):
        print("  (skipped: run forecasting.py first)")
        return
    runs = get(f"/api/forecasts/{germany_id()}")
    assert {r["model"] for r in runs} == {"naive", "linear_trend", "ridge_lags"}


def test_saved_analyses():
    created = client.post("/api/analyses", json={"name": "api test", "filters": {"year": 2024}})
    assert created.status_code == 201
    analysis_id = created.json()["id"]
    assert any(a["_id"] == analysis_id for a in get("/api/analyses"))
    assert client.delete(f"/api/analyses/{analysis_id}").status_code == 204
    assert client.delete(f"/api/analyses/{analysis_id}").status_code == 404
    assert client.post("/api/analyses", json={"name": "", "filters": {}}).status_code == 422


if __name__ == "__main__":
    import sys
    failed = 0
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"PASS {name}")
            except Exception as error:  # noqa: BLE001 - report every failure
                failed += 1
                print(f"FAIL {name}: {type(error).__name__}: {error}")
    sys.exit(1 if failed else 0)
