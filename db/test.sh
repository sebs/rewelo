#!/bin/bash

# Run SQLite schema creation (requires the sqlite3 CLI)
DB_FILE=":memory:"

echo "Running schema creation..."
sqlite3 "$DB_FILE" < create.sql
