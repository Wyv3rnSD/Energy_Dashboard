"""Smoke tests for queries.py against the databases built by build_databases.py.

Run:  python test_queries.py        (or: pytest test_queries.py)
"""

import queries as q


def _country(area: str) -> int:
    countries = q.list_countries(include_regions=True)
    return int(countries.loc[countries["area"] == area, "country_id"].item())


def test_lookups():
    countries = q.list_countries()
    assert len(countries) == 209
    assert len(q.list_countries(include_regions=True)) == 224
    assert "Germany" in set(q.list_countries(membership="EU")["area"])
    assert "India" not in set(q.list_countries(membership="EU")["area"])
    assert set(q.list_countries(continent="Europe")["continent"]) == {"Europe"}
    assert len(q.list_sources()) == 10 and len(q.list_sources(include_aggregates=True)) == 17
    assert "Asia" in q.list_continents()
    lo, hi = q.year_range()
    assert lo <= 2000 and hi >= 2024


def test_timeseries_and_mix():
    de, fr = _country("Germany"), _country("France")
    ts = q.source_timeseries([de, fr], "Solar", year_from=2010, year_to=2020)
    assert set(ts["area"]) == {"Germany", "France"} and ts["year"].between(2010, 2020).all()
    share = q.summary_timeseries([de])
    assert 50 < share.loc[share["year"] == 2024, "renewable_share_percent"].item() < 65
    mix = q.country_mix(de, 2024)
    assert abs(mix["share_percent"].sum() - 100) < 0.1
    assert "Total generation" not in set(mix["electricity_source"])
    assert not q.generation_mix_over_time(de).empty


def test_advanced_sql():
    de = _country("Germany")
    growth = q.yoy_growth(de, "Solar").dropna(subset=["yoy_twh", "ember_yoy_twh"])
    assert ((growth["yoy_twh"] - growth["ember_yoy_twh"]).abs() < 0.01).all()

    top = q.top_countries(2024, n=5)
    assert len(top) == 5 and top["overall_rank"].is_monotonic_increasing
    assert set(q.top_countries(2024, n=5, continent="Africa")["continent"]) == {"Africa"}

    movers = q.rank_movers(2010, 2024, n=5)
    assert movers["places_gained"].is_monotonic_decreasing

    totals = q.continent_totals(2024)
    grand = totals[totals["continent"].isna() & totals["energy_category"].isna()]
    assert len(grand) == 1 and grand["generation_twh"].item() > 20000

    check = q.renewable_share_check(2024)
    assert check["difference"].dropna().max() < 0.01

    assert not q.emissions_vs_renewables(2024).empty
    assert len(q.top_renewable(2024, 5)) == 5
    assert set(q.ml_training_data(de)["country_id"]) == {de}


def test_bad_metric_is_rejected():
    try:
        q.top_countries(2024, metric="1; DROP TABLE countries")
    except ValueError:
        return
    raise AssertionError("unsafe metric name was accepted")


def test_mongo():
    de = _country("Germany")
    profile = q.get_country_profile(de)
    assert profile["area"] == "Germany" and "EU" in profile["memberships"]
    assert all("series" not in p for p in q.find_profiles(membership="G7"))
    assert len(q.latest_renewable_leaders(5)) == 5

    analysis_id = q.save_analysis("test", {"countries": [de]})
    assert any(str(a["_id"]) == analysis_id for a in q.list_saved_analyses())
    assert q.delete_analysis(analysis_id)

    run_id = q.save_forecast_run("test", "renewable_generation_twh", de, {"mae": 1.0},
                                 [{"year": 2026, "value": 300.0}])
    assert str(q.latest_forecast(de)["_id"]) == run_id
    q.get_mongo()["forecast_runs"].delete_many({"model": "test"})


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
