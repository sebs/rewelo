Feature: Export and Import
  As a user
  I want to export and import project data
  So that I can share data, create backups, or migrate between environments

  Background:
    Given a project "Acme" exists
    And the following tickets exist in "Acme":
      | title     | benefit | penalty | estimate | risk |
      | Story A   |       8 |       5 |        3 |    2 |
      | Story B   |       2 |       1 |        5 |    3 |
    And "Story A" has tags "state:wip" and "feature:auth"
    And "Story B" has tags "state:backlog" and "feature:auth"

  # -- CSV Export --

  Scenario: Export tickets as CSV
    When I export project "Acme" as CSV
    Then I should receive a CSV file with headers: title, description, benefit, penalty, estimate, risk, tags
    And it should contain 2 rows of ticket data
    And tags should be formatted as "state:wip,feature:auth" in the tags column

  Scenario: Export includes calculated fields
    When I export project "Acme" as CSV with calculations
    Then the CSV should include additional columns: value, cost, priority

  # -- JSON Export --

  Scenario: Export project as JSON
    When I export project "Acme" as JSON
    Then I should receive a JSON file containing tickets, tags, and their assignments

  Scenario: Export includes revision history
    When I export project "Acme" as JSON with history
    Then the JSON should include ticket revisions and tag change audit log

  # -- Import --

  Scenario: Import tickets from CSV
    Given a CSV file with ticket data:
      | title     | benefit | penalty | estimate | risk | tags              |
      | Story C   |       5 |       3 |        2 |    1 | feature:checkout  |
      | Story D   |      13 |       8 |        8 |    5 | feature:checkout  |
    When I import the CSV into project "Acme"
    Then "Story C" and "Story D" should exist in "Acme"
    And the tag "feature:checkout" should be created if it did not exist

  Scenario: Import creates missing tags automatically
    Given a CSV file references tags "team:mobile" and "state:backlog"
    And those tags do not exist in project "Acme"
    When I import the CSV into project "Acme"
    Then the tags "team:mobile" and "state:backlog" should be created

  Scenario: Import rejects invalid Fibonacci values
    Given a CSV file contains a ticket with benefit 4
    When I import the CSV into project "Acme"
    Then I should see an error that row 1 has an invalid Fibonacci value
    And no tickets should be imported

  Scenario: Import into a new project
    Given no project "NewProject" exists
    When I import a JSON file as project "NewProject"
    Then the project "NewProject" should be created
    And all tickets, tags, and assignments should be restored

  # -- Backup and restore across version upgrades --

  Scenario: Backup exports all projects with metadata envelope
    Given a project "Acme" with tickets, tags, and assignments
    And a project "Globex" with tickets, tags, and assignments
    When I run "backup --output backup.json"
    Then a JSON file should be created with:
      | field         | value                          |
      | schemaVersion | 1                              |
      | appVersion    | the current application version|
      | createdAt     | an ISO 8601 timestamp          |
    And it should contain 2 projects with their tickets, tags, and assignments

  Scenario: Backup includes weight configuration
    Given a project "Acme" with custom weights w1=2, w2=3, w3=1, w4=1
    When I run "backup --output backup.json"
    Then the backup for "Acme" should include weights { w1: 2, w2: 3, w3: 1, w4: 1 }

  Scenario: Backup omits default weights
    Given a project "Acme" with default weights
    When I run "backup --output backup.json"
    Then the backup for "Acme" should have weights as null

  Scenario: Restore from backup into a fresh database
    Given a JSON backup file with schemaVersion 1
    And an empty database
    When I run "restore backup.json"
    Then all projects should be restored
    And all tickets should be restored with their original scores
    And all tags and assignments should be restored
    And weight configurations should be restored

  Scenario: Restore rejects duplicate project names
    Given a project "Acme" already exists in the database
    And a backup file containing a project "Acme"
    When I run "restore backup.json"
    Then I should see an error that project "Acme" already exists

  Scenario: Restore aborts cleanly on schema mismatch
    Given a JSON backup file with schemaVersion 99
    When I run "restore backup.json"
    Then I should see an error about incompatible schema version
    And the database should remain unchanged

  Scenario: Full roundtrip preserves all data
    Given a project "Acme" with tickets, tags, assignments, and custom weights
    When I run "backup --output backup.json"
    And I restore the backup into a fresh database
    Then the restored data should match the original exactly
