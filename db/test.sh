#!/bin/bash

# Run DuckDB schema creation and tests
DB_FILE=":memory:"

echo "Running schema creation..."
duckdb "$DB_FILE" < create.sql

echo "Running tests..."
duckdb "$DB_FILE" -c ".read create.sql" -c ".read test.sql"
