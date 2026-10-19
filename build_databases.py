"""Build the MySQL and MongoDB databases from the processed Ember CSVs.

Usage:
    python build_databases.py               # build both databases
    python build_databases.py --mysql-only
    python build_databases.py --mongo-only

Credentials come from a .env file next to this script (see .env.example).
Re-running is safe: MySQL tables and the MongoDB `country_profiles`
collection are rebuilt from scratch. The app collections (`saved_analyses`,
`scenarios`, `forecast_runs`) are created if missing and never emptied.
"""

import argparse
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
from dotenv import load_dotenv
from sqlalchemy import URL, create_engine, text

BASE_DIR = Path(__file__).resolve().parent
PROCESSED_DIR = BASE_DIR / "processed"
MEMBERSHIP_COLUMNS = ["eu_member", "oecd_member", "g20_member", "g7_member", "asean_member"]
CHUNK_SIZE = 5000


# --------------------------------------------------------------------------
# 1. Load and validate the CSVs
# --------------------------------------------------------------------------

def load_frames() -> dict[str, pd.DataFrame]:
    """Read the processed CSVs and reshape them into one DataFrame per table."""
    def read(name: str, **kwargs) -> pd.DataFrame:
        path = PROCESSED_DIR / name
        if not path.is_file():
            sys.exit(f"Missing {path}. Run preprocessing.ipynb first.")
        return pd.read_csv(path, **kwargs)

    countries = read("countries.csv")
    sources = read("energy_sources.csv")
    energy_data = read("energy_data.csv")
    summary = read("energy_summary.csv")
    ml = read("ml_dataset.csv")
    cleaned = read("energy_cleaned.csv", usecols=["country_id", *MEMBERSHIP_COLUMNS])

    # Membership flags only exist in energy_cleaned.csv; they are constant per
    # country, so they belong in the countries table.
    memberships = cleaned.groupby("country_id", as_index=False)[MEMBERSHIP_COLUMNS].first()
    countries = countries.merge(memberships, on="country_id", how="left")
    countries[MEMBERSHIP_COLUMNS] = countries[MEMBERSHIP_COLUMNS].fillna(False).astype(bool)
    countries = countries[["country_id", "area", "iso_code", "continent", "area_type",
                           "ember_region", *MEMBERSHIP_COLUMNS]]

    sources = sources[["source_id", "electricity_source", "energy_category", "is_renewable",
                       "is_fossil", "is_low_carbon", "is_aggregated_source"]]

    # area and iso_code depend on country_id, not on (country_id, year): drop for 3NF.
    summary = summary.drop(columns=["area", "iso_code"])

    # Older runs of preprocessing.ipynb summed every source (including the
    # aggregate ones) into total_generation_twh, about 4x too high. Always take
    # the total from Ember's own "Total generation" row and recompute the shares,
    # so the database is right even if an old CSV is loaded.
    total_id = sources.loc[sources["electricity_source"] == "Total generation", "source_id"].item()
    totals = (energy_data.loc[energy_data["source_id"] == total_id, ["country_id", "year", "generation_twh"]]
              .rename(columns={"generation_twh": "true_total_twh"}))
    summary = summary.merge(totals, on=["country_id", "year"], how="left")
    summary["total_generation_twh"] = summary.pop("true_total_twh")
    with np.errstate(divide="ignore", invalid="ignore"):
        summary["renewable_share_percent"] = (summary["renewable_generation_twh"]
                                              / summary["total_generation_twh"] * 100)
        summary["fossil_share_percent"] = (summary["fossil_generation_twh"]
                                           / summary["total_generation_twh"] * 100)
    summary = summary.replace([np.inf, -np.inf], np.nan)

    # ml_dataset repeats every energy_summary column; keep only the engineered features.
    ml_features = ml[["country_id", "year", "generation_lag_1", "generation_lag_2",
                      "generation_lag_3", "renewable_growth_percent",
                      "renewable_3yr_growth_percent"]]

    # Growth from a zero base comes out as +/-inf in ml_dataset.csv; MySQL and
    # JSON cannot store infinity, so it becomes NULL ("undefined growth").
    ml_features = ml_features.replace([np.inf, -np.inf], np.nan)

    return {
        "countries": countries,
        "energy_sources": sources,
        "energy_data": energy_data,
        "energy_summary": summary,
        "ml_features": ml_features,
    }


def validate(frames: dict[str, pd.DataFrame]) -> None:
    """Stop before touching any database if keys or foreign keys are broken."""
    keys = {
        "countries": ["country_id"],
        "energy_sources": ["source_id"],
        "energy_data": ["country_id", "source_id", "year"],
        "energy_summary": ["country_id", "year"],
        "ml_features": ["country_id", "year"],
    }
    errors = []
    for table, key in keys.items():
        frame = frames[table]
        if frame[key].isna().any().any():
            errors.append(f"{table}: NULL in key {key}")
        duplicates = frame.duplicated(key).sum()
        if duplicates:
            errors.append(f"{table}: {duplicates} duplicate keys on {key}")

    country_ids = set(frames["countries"]["country_id"])
    for table in ("energy_data", "energy_summary", "ml_features"):
        orphans = (~frames[table]["country_id"].isin(country_ids)).sum()
        if orphans:
            errors.append(f"{table}: {orphans} rows with unknown country_id")
    orphans = (~frames["energy_data"]["source_id"].isin(frames["energy_sources"]["source_id"])).sum()
    if orphans:
        errors.append(f"energy_data: {orphans} rows with unknown source_id")
    summary_keys = frames["energy_summary"].set_index(["country_id", "year"]).index
    orphans = (~frames["ml_features"].set_index(["country_id", "year"]).index.isin(summary_keys)).sum()
    if orphans:
        errors.append(f"ml_features: {orphans} rows with no matching energy_summary row")

    if errors:
        sys.exit("Validation failed:\n  " + "\n  ".join(errors))
    print("Validation passed: " + ", ".join(f"{t}={len(f):,}" for t, f in frames.items()))


# --------------------------------------------------------------------------
# 2. MySQL
# --------------------------------------------------------------------------

METRIC = "DOUBLE NULL"
DDL = {
    "countries": """
        CREATE TABLE countries (
            country_id    INT          NOT NULL,
            area          VARCHAR(100) NOT NULL,
            iso_code      CHAR(3)      NULL,
            continent     VARCHAR(50)  NULL,
            area_type     VARCHAR(30)  NOT NULL,
            ember_region  VARCHAR(50)  NULL,
            eu_member     BOOLEAN      NOT NULL DEFAULT FALSE,
            oecd_member   BOOLEAN      NOT NULL DEFAULT FALSE,
            g20_member    BOOLEAN      NOT NULL DEFAULT FALSE,
            g7_member     BOOLEAN      NOT NULL DEFAULT FALSE,
            asean_member  BOOLEAN      NOT NULL DEFAULT FALSE,
            PRIMARY KEY (country_id),
            UNIQUE KEY uq_countries_area (area),
            KEY idx_countries_iso (iso_code),
            KEY idx_countries_continent (continent)
        ) ENGINE=InnoDB""",
    "energy_sources": """
        CREATE TABLE energy_sources (
            source_id             INT         NOT NULL,
            electricity_source    VARCHAR(60) NOT NULL,
            energy_category       VARCHAR(30) NOT NULL,
            is_renewable          BOOLEAN     NOT NULL,
            is_fossil             BOOLEAN     NOT NULL,
            is_low_carbon         BOOLEAN     NOT NULL,
            is_aggregated_source  BOOLEAN     NOT NULL,
            PRIMARY KEY (source_id),
            UNIQUE KEY uq_sources_name (electricity_source)
        ) ENGINE=InnoDB""",
    "energy_data": f"""
        CREATE TABLE energy_data (
            country_id                     INT      NOT NULL,
            source_id                      INT      NOT NULL,
            year                           SMALLINT NOT NULL,
            generation_twh                 {METRIC},
            generation_yoy_twh             {METRIC},
            generation_yoy_percent         {METRIC},
            generation_share_percent       {METRIC},
            generation_share_yoy_points    {METRIC},
            capacity_gw                    {METRIC},
            emissions_mtco2e               {METRIC},
            emissions_yoy_mtco2e           {METRIC},
            emissions_yoy_percent          {METRIC},
            emissions_share_percent        {METRIC},
            emissions_intensity_gco2e_kwh  {METRIC},
            PRIMARY KEY (country_id, source_id, year),
            KEY idx_energy_source_year (source_id, year),
            KEY idx_energy_year (year),
            CONSTRAINT fk_energy_country FOREIGN KEY (country_id)
                REFERENCES countries (country_id) ON DELETE CASCADE,
            CONSTRAINT fk_energy_source FOREIGN KEY (source_id)
                REFERENCES energy_sources (source_id) ON DELETE CASCADE,
            CONSTRAINT chk_energy_year CHECK (year BETWEEN 1900 AND 2100)
        ) ENGINE=InnoDB""",
    "energy_summary": f"""
        CREATE TABLE energy_summary (
            country_id                INT      NOT NULL,
            year                      SMALLINT NOT NULL,
            renewable_generation_twh  {METRIC},
            total_generation_twh      {METRIC},
            renewable_share_percent   {METRIC},
            fossil_generation_twh     {METRIC},
            fossil_share_percent      {METRIC},
            PRIMARY KEY (country_id, year),
            KEY idx_summary_year (year),
            CONSTRAINT fk_summary_country FOREIGN KEY (country_id)
                REFERENCES countries (country_id) ON DELETE CASCADE
        ) ENGINE=InnoDB""",
    "ml_features": f"""
        CREATE TABLE ml_features (
            country_id                    INT      NOT NULL,
            year                          SMALLINT NOT NULL,
            generation_lag_1              {METRIC},
            generation_lag_2              {METRIC},
            generation_lag_3              {METRIC},
            renewable_growth_percent      {METRIC},
            renewable_3yr_growth_percent  {METRIC},
            PRIMARY KEY (country_id, year),
            CONSTRAINT fk_ml_summary FOREIGN KEY (country_id, year)
                REFERENCES energy_summary (country_id, year) ON DELETE CASCADE
        ) ENGINE=InnoDB""",
}
PROCEDURES = {
    # Generation mix of one country in one year, real sources only, with each
    # source's share of the country's total.
    "get_country_mix": """
        CREATE PROCEDURE get_country_mix(IN p_country_id INT, IN p_year SMALLINT)
        BEGIN
            SELECT s.electricity_source, s.energy_category, e.generation_twh,
                   ROUND(100 * e.generation_twh / SUM(e.generation_twh) OVER (), 2) AS share_percent
            FROM energy_data e
            JOIN energy_sources s ON s.source_id = e.source_id
            WHERE e.country_id = p_country_id AND e.year = p_year
              AND s.is_aggregated_source = FALSE
              AND s.electricity_source <> 'Net imports'
              AND e.generation_twh IS NOT NULL
            ORDER BY e.generation_twh DESC;
        END""",
    # Top-N countries by renewable share in a year, ignoring tiny grids.
    "get_top_renewable": """
        CREATE PROCEDURE get_top_renewable(IN p_year SMALLINT, IN p_limit INT,
                                           IN p_min_twh DOUBLE)
        BEGIN
            SELECT c.area, c.continent, s.total_generation_twh, s.renewable_share_percent,
                   RANK() OVER (ORDER BY s.renewable_share_percent DESC) AS share_rank
            FROM energy_summary s
            JOIN countries c ON c.country_id = s.country_id
            WHERE s.year = p_year AND s.total_generation_twh >= p_min_twh
            ORDER BY share_rank
            LIMIT p_limit;
        END""",
}
# Tables are created in this order (parents first) and dropped in reverse.
TABLE_ORDER = ["countries", "energy_sources", "energy_data", "energy_summary", "ml_features"]


def mysql_url(database: str | None = None) -> URL:
    return URL.create(
        "mysql+pymysql",
        username=os.getenv("MYSQL_USER", "root"),
        password=os.getenv("MYSQL_PASSWORD", ""),
        host=os.getenv("MYSQL_HOST", "localhost"),
        port=int(os.getenv("MYSQL_PORT", "3306")),
        database=database,
        query={"charset": "utf8mb4"},
    )


def build_mysql(frames: dict[str, pd.DataFrame]) -> None:
    database = os.getenv("MYSQL_DB", "energy_db")
    if not database.replace("_", "").isalnum():
        sys.exit(f"MYSQL_DB must be letters, digits or underscores, got {database!r}")

    server = create_engine(mysql_url())
    with server.begin() as conn:
        conn.execute(text(f"CREATE DATABASE IF NOT EXISTS `{database}` "
                          "CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"))
    server.dispose()

    engine = create_engine(mysql_url(database), pool_pre_ping=True)
    try:
        # DDL commits implicitly in MySQL, so the schema is rebuilt first ...
        with engine.begin() as conn:
            conn.execute(text("DROP VIEW IF EXISTS v_country_year"))
            for table in reversed(TABLE_ORDER):
                conn.execute(text(f"DROP TABLE IF EXISTS {table}"))
            for table in TABLE_ORDER:
                conn.execute(text(DDL[table]))
            conn.execute(text("""
                CREATE VIEW v_country_year AS
                SELECT c.country_id, c.area, c.iso_code, c.continent, c.ember_region,
                       s.year, s.total_generation_twh, s.renewable_generation_twh,
                       s.renewable_share_percent, s.fossil_generation_twh,
                       s.fossil_share_percent
                FROM energy_summary s
                JOIN countries c ON c.country_id = s.country_id"""))
            for name, body in PROCEDURES.items():
                conn.execute(text(f"DROP PROCEDURE IF EXISTS {name}"))
                conn.execute(text(body))
        print(f"MySQL: schema, view and {len(PROCEDURES)} procedures created in `{database}`")

        # ... and all rows are loaded in one transaction, parents first.
        with engine.begin() as conn:
            for table in TABLE_ORDER:
                frames[table].to_sql(table, conn, if_exists="append", index=False,
                                     chunksize=CHUNK_SIZE, method="multi")
                print(f"MySQL: loaded {len(frames[table]):>7,} rows into {table}")

        with engine.connect() as conn:
            for table in TABLE_ORDER:
                count = conn.execute(text(f"SELECT COUNT(*) FROM {table}")).scalar_one()
                if count != len(frames[table]):
                    sys.exit(f"MySQL: {table} has {count} rows, expected {len(frames[table])}")
        print("MySQL: row counts verified")
    finally:
        engine.dispose()


# --------------------------------------------------------------------------
# 3. MongoDB
# --------------------------------------------------------------------------

APP_COLLECTIONS = {
    "saved_analyses": {
        "validator": {"$jsonSchema": {
            "bsonType": "object",
            "required": ["name", "filters", "created_at"],
            "properties": {
                "name": {"bsonType": "string"},
                "filters": {"bsonType": "object"},
                "chart": {"bsonType": "object"},
                "created_at": {"bsonType": "date"},
            },
        }},
        "indexes": [[("created_at", -1)], [("name", 1)]],
    },
    "scenarios": {
        "validator": {"$jsonSchema": {
            "bsonType": "object",
            "required": ["name", "country_id", "assumptions", "created_at"],
            "properties": {
                "name": {"bsonType": "string"},
                "country_id": {"bsonType": "int"},
                "assumptions": {"bsonType": "object"},
                "created_at": {"bsonType": "date"},
            },
        }},
        "indexes": [[("country_id", 1), ("created_at", -1)]],
    },
    "forecast_runs": {
        "validator": {"$jsonSchema": {
            "bsonType": "object",
            "required": ["model", "target", "country_id", "metrics", "predictions", "created_at"],
            "properties": {
                "model": {"bsonType": "string"},
                "target": {"bsonType": "string"},
                "country_id": {"bsonType": "int"},
                "params": {"bsonType": "object"},
                "metrics": {"bsonType": "object"},
                "predictions": {"bsonType": "array"},
                "created_at": {"bsonType": "date"},
            },
        }},
        "indexes": [[("country_id", 1), ("target", 1), ("created_at", -1)], [("model", 1)]],
    },
}


def clean(value):
    """Convert pandas/numpy values to plain Python types MongoDB can store."""
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    return value.item() if hasattr(value, "item") else value


def country_profiles(frames: dict[str, pd.DataFrame]) -> list[dict]:
    """One document per country with its yearly summary and latest source mix."""
    countries = frames["countries"]
    countries = countries[countries["area_type"] == "Country or economy"]
    sources = frames["energy_sources"].set_index("source_id")["electricity_source"]
    real_sources = frames["energy_sources"].loc[
        ~frames["energy_sources"]["is_aggregated_source"], "source_id"]

    series_by_country = {cid: g.sort_values("year") for cid, g in
                         frames["energy_summary"].groupby("country_id")}
    mix = frames["energy_data"][frames["energy_data"]["source_id"].isin(real_sources)
                                & frames["energy_data"]["generation_twh"].notna()]
    mix_by_country = {cid: g for cid, g in mix.groupby("country_id")}

    now = datetime.now(timezone.utc)
    docs = []
    for row in countries.itertuples(index=False):
        series = series_by_country.get(row.country_id)
        doc = {
            "_id": int(row.country_id),
            "area": row.area,
            "iso_code": clean(row.iso_code),
            "continent": clean(row.continent),
            "ember_region": clean(row.ember_region),
            "memberships": [c.removesuffix("_member").upper() for c in MEMBERSHIP_COLUMNS
                            if getattr(row, c)],
            "series": [] if series is None else [
                {k: clean(v) for k, v in rec.items() if k != "country_id"}
                for rec in series.to_dict("records")
            ],
            "latest_year": None,
            "latest_mix_twh": {},
            "built_at": now,
        }
        country_mix = mix_by_country.get(row.country_id)
        if country_mix is not None:
            latest = int(country_mix["year"].max())
            latest_rows = country_mix[country_mix["year"] == latest]
            doc["latest_year"] = latest
            doc["latest_mix_twh"] = {sources[s]: clean(g) for s, g in
                                     zip(latest_rows["source_id"], latest_rows["generation_twh"])}
        docs.append(doc)
    return docs


def build_mongo(frames: dict[str, pd.DataFrame]) -> None:
    from pymongo import ASCENDING, MongoClient
    from pymongo.errors import ServerSelectionTimeoutError

    uri = os.getenv("MONGO_URI", "mongodb://localhost:27017")
    client = MongoClient(uri, serverSelectionTimeoutMS=5000)
    try:
        try:
            client.admin.command("ping")
        except ServerSelectionTimeoutError:
            sys.exit(f"MongoDB: no server answering at {uri}. Start MongoDB Community "
                     "Server (the 'MongoDB' Windows service) or fix MONGO_URI in .env, "
                     "then run: python build_databases.py --mongo-only")
        db = client[os.getenv("MONGO_DB", "energy_nosql")]

        profiles = country_profiles(frames)
        db.drop_collection("country_profiles")
        db["country_profiles"].insert_many(profiles)
        db["country_profiles"].create_index([("iso_code", ASCENDING)])
        db["country_profiles"].create_index([("continent", ASCENDING)])
        db["country_profiles"].create_index([("memberships", ASCENDING)])
        print(f"MongoDB: loaded {len(profiles):,} documents into country_profiles")

        existing = set(db.list_collection_names())
        for name, spec in APP_COLLECTIONS.items():
            if name in existing:
                db.command("collMod", name, validator=spec["validator"])
            else:
                db.create_collection(name, validator=spec["validator"])
            for keys in spec["indexes"]:
                db[name].create_index(keys)
        print("MongoDB: app collections ready: " + ", ".join(APP_COLLECTIONS))
    finally:
        client.close()


# --------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--mysql-only", action="store_true")
    group.add_argument("--mongo-only", action="store_true")
    args = parser.parse_args()

    load_dotenv(BASE_DIR / ".env")
    frames = load_frames()
    validate(frames)

    if not args.mongo_only:
        build_mysql(frames)
    if not args.mysql_only:
        build_mongo(frames)
    print("Done.")


if __name__ == "__main__":
    main()
