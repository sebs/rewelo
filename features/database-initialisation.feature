Feature: Database Initialisation
  As a user
  I want the database to be set up automatically on first use
  So that I can start working without manual setup steps

  Scenario: First run creates the database
    Given no database file exists
    When I run any command
    Then a DuckDB database file should be created
    And the schema should be initialised with all required tables

  Scenario: Existing database is reused
    Given a database file already exists with data
    When I run a command
    Then the existing data should be preserved
    And no schema errors should occur

  Scenario: Database file location defaults to current directory
    When I run the tool without specifying a database path
    Then the database should be created at "./relative-weight.duckdb"

  Scenario: Custom database file path
    When I run the tool with "--db /tmp/my-project.duckdb"
    Then the database should be created at "/tmp/my-project.duckdb"

  Scenario: Corrupted database shows a clear error
    Given a corrupted database file exists
    When I run a command
    Then I should see an error explaining the database is corrupted
    And the tool should not silently create a new database
