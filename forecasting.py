"""Forecast each country's yearly electricity numbers and store the results in MongoDB.

Three models are compared on a held-out backtest, then refit on all years to
forecast ahead:

  naive         next year = last known year (the baseline every model must beat)
  linear_trend  straight line through the last TREND_WINDOW years
  ridge_lags    one Ridge regression pooled across all countries, predicting
                log(value) from the log of the previous LAGS years; forecasts
                more than one year ahead feed predictions back in as lags

Usage:
    python forecasting.py                                   # renewable generation
    python forecasting.py --target total_generation_twh
    python forecasting.py --test-start 2020 --horizon 2030

Results go to the MongoDB `forecast_runs` collection: one document per country
and model, holding the backtest metrics, backtest predictions and the forecast.
Re-running replaces the previous run for the same target.
"""

import argparse
import sys
import uuid
from datetime import datetime, timezone

import numpy as np
import pandas as pd
from sklearn.linear_model import Ridge

import queries as q

TARGETS = {"renewable_generation_twh", "total_generation_twh", "fossil_generation_twh"}
MODELS = ["naive", "linear_trend", "ridge_lags"]
LAGS = 3
TREND_WINDOW = 10
RIDGE_ALPHA = 1.0
MIN_TRAIN_YEARS = 8


# --------------------------------------------------------------------------
# Data
# --------------------------------------------------------------------------

def load_series(target: str) -> pd.DataFrame:
    """One row per country and year with the target value, from MySQL."""
    return q.run_sql(f"""
        SELECT s.country_id, c.area, s.year, s.{target} AS value
        FROM energy_summary s
        JOIN countries c ON c.country_id = s.country_id
        WHERE s.{target} IS NOT NULL
        ORDER BY s.country_id, s.year""")


def add_lags(frame: pd.DataFrame) -> pd.DataFrame:
    frame = frame.copy()
    frame["log_value"] = np.log1p(frame["value"].clip(lower=0))
    for lag in range(1, LAGS + 1):
        frame[f"lag_{lag}"] = frame.groupby("country_id")["log_value"].shift(lag)
    return frame


# --------------------------------------------------------------------------
# Models: each takes a country's known history and returns predictions for
# the requested future years
# --------------------------------------------------------------------------

def predict_naive(history: pd.DataFrame, years: list[int], _model=None) -> np.ndarray:
    return np.full(len(years), history["value"].iloc[-1])


def predict_linear_trend(history: pd.DataFrame, years: list[int], _model=None) -> np.ndarray:
    recent = history.tail(TREND_WINDOW)
    slope, intercept = np.polyfit(recent["year"], recent["value"], 1)
    return np.clip(slope * np.array(years) + intercept, 0, None)


def fit_ridge(train: pd.DataFrame) -> Ridge:
    rows = add_lags(train).dropna(subset=[f"lag_{i}" for i in range(1, LAGS + 1)])
    features = [f"lag_{i}" for i in range(1, LAGS + 1)]
    return Ridge(alpha=RIDGE_ALPHA).fit(rows[features], rows["log_value"])


def predict_ridge(history: pd.DataFrame, years: list[int], model: Ridge) -> np.ndarray:
    """Recursive multi-step forecast: each prediction becomes the next lag."""
    window = list(np.log1p(history["value"].clip(lower=0)).tail(LAGS))
    features = [f"lag_{i}" for i in range(1, LAGS + 1)]
    out = []
    for _ in years:
        x = pd.DataFrame([window[::-1]], columns=features)   # lag_1 = most recent
        log_pred = float(model.predict(x)[0])
        out.append(max(np.expm1(log_pred), 0.0))
        window = window[1:] + [log_pred]
    return np.array(out)


PREDICTORS = {"naive": predict_naive, "linear_trend": predict_linear_trend,
              "ridge_lags": predict_ridge}


def metrics(actual: np.ndarray, predicted: np.ndarray) -> dict:
    error = predicted - actual
    nonzero = np.abs(actual) > 1e-9
    mape = (float(np.mean(np.abs(error[nonzero] / actual[nonzero])) * 100)
            if nonzero.any() else None)
    return {"mae": float(np.mean(np.abs(error))),
            "rmse": float(np.sqrt(np.mean(error ** 2))),
            "mape": mape}


# --------------------------------------------------------------------------
# Backtest and forecast
# --------------------------------------------------------------------------

def run(target: str, test_start: int, horizon: int) -> tuple[list[dict], pd.DataFrame]:
    data = load_series(target)
    last_year = int(data["year"].max())
    if not test_start < last_year < horizon:
        sys.exit(f"Need test_start < last data year ({last_year}) < horizon")

    # Ridge is pooled across countries: one fit on the training years for the
    # backtest, one on all years for the real forecast.
    ridge_backtest = fit_ridge(data[data["year"] < test_start])
    ridge_full = fit_ridge(data)
    models = {"ridge_lags": (ridge_backtest, ridge_full)}

    run_id = uuid.uuid4().hex[:12]
    docs, scores = [], []
    for country_id, series in data.groupby("country_id"):
        train = series[series["year"] < test_start]
        test = series[series["year"] >= test_start]
        if len(train) < MIN_TRAIN_YEARS or test.empty:
            continue
        future_years = list(range(int(series["year"].max()) + 1, horizon + 1))

        for name in MODELS:
            backtest_model, full_model = models.get(name, (None, None))
            backtest = PREDICTORS[name](train, test["year"].tolist(), backtest_model)
            forecast = PREDICTORS[name](series, future_years, full_model)
            score = metrics(test["value"].to_numpy(), backtest)
            scores.append({"country_id": country_id, "area": series["area"].iloc[0],
                           "model": name, **score})
            docs.append({
                "model": name,
                "target": target,
                "country_id": int(country_id),
                "area": series["area"].iloc[0],
                "params": {"run_id": run_id, "test_start": test_start, "lags": LAGS,
                           "trend_window": TREND_WINDOW, "ridge_alpha": RIDGE_ALPHA},
                "metrics": score,
                "predictions": (
                    [{"year": int(y), "value": float(v), "actual": float(a), "kind": "backtest"}
                     for y, v, a in zip(test["year"], backtest, test["value"])]
                    + [{"year": int(y), "value": float(v), "kind": "forecast"}
                       for y, v in zip(future_years, forecast)]
                ),
                "created_at": datetime.now(timezone.utc),
            })
    return docs, pd.DataFrame(scores)


def save(docs: list[dict], target: str) -> None:
    collection = q.get_mongo()["forecast_runs"]
    collection.delete_many({"target": target, "model": {"$in": MODELS}})
    if docs:
        collection.insert_many(docs)


def report(scores: pd.DataFrame) -> pd.DataFrame:
    summary = scores.groupby("model").agg(
        countries=("country_id", "nunique"),
        median_mae_twh=("mae", "median"),
        median_mape=("mape", "median"),
    )
    best = scores.loc[scores.groupby("country_id")["mae"].idxmin(), "model"]
    summary["best_for_countries"] = best.value_counts()
    return summary.fillna(0).sort_values("median_mae_twh")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--target", default="renewable_generation_twh", choices=sorted(TARGETS))
    parser.add_argument("--test-start", type=int, default=2020,
                        help="first year held out for the backtest (default 2020)")
    parser.add_argument("--horizon", type=int, default=2030,
                        help="last year to forecast (default 2030)")
    args = parser.parse_args()

    docs, scores = run(args.target, args.test_start, args.horizon)
    if scores.empty:
        sys.exit("No country had enough history to forecast.")
    print(f"Backtest for {args.target}: trained on years < {args.test_start}, "
          f"tested on {args.test_start} onwards\n")
    print(report(scores).to_string(float_format=lambda v: f"{v:,.2f}"))
    save(docs, args.target)
    print(f"\nSaved {len(docs):,} forecast documents to MongoDB forecast_runs "
          f"({scores['country_id'].nunique()} countries x {len(MODELS)} models).")


if __name__ == "__main__":
    main()
