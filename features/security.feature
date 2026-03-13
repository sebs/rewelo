Feature: Security
  As a user
  I want the tool to handle untrusted input safely
  So that malicious or malformed data cannot compromise the system

  # -- SQL Injection Prevention --

  Scenario: SQL injection in ticket title
    Given a project "Acme" exists
    When I create a ticket with title "'; DROP TABLE rw.tickets; --"
    Then the ticket should be created with the literal title
    And the tickets table should still exist

  Scenario: SQL injection in ticket description
    Given a project "Acme" exists
    When I create a ticket with description "x' OR '1'='1"
    Then the ticket should be created with the literal description

  Scenario: SQL injection in tag prefix
    Given a project "Acme" exists
    When I create a tag with prefix "state'; DELETE FROM rw.tags; --"
    Then I should see an error that the prefix contains invalid characters

  Scenario: SQL injection in tag value
    Given a project "Acme" exists
    When I create a tag with value "backlog' OR '1'='1"
    Then I should see an error that the value contains invalid characters

  Scenario: SQL injection in project name
    When I create a project named "'; DROP SCHEMA rw CASCADE; --"
    Then I should see an error that the name contains invalid characters

  Scenario: SQL injection via CSV import
    Given a project "Acme" exists
    And a CSV file contains a title "'; DROP TABLE rw.tickets; --"
    When I import the CSV into project "Acme"
    Then the ticket should be created with the literal title
    And the tickets table should still exist

  # -- Path Traversal Prevention --

  Scenario: Path traversal in database flag
    When I run "rw project list --db ../../../etc/passwd"
    Then I should see an error that the database path is invalid

  Scenario: Path traversal in database flag with encoded characters
    When I run "rw project list --db /data/%2e%2e/%2e%2e/etc/passwd"
    Then I should see an error that the database path is invalid

  Scenario: Symlink in database path
    Given a symlink at "/tmp/evil.duckdb" pointing to "/etc/passwd"
    When I run "rw project list --db /tmp/evil.duckdb"
    Then I should see an error that the database path resolves to a disallowed location

  Scenario: Database path must have .duckdb extension
    When I run "rw project list --db /tmp/data.txt"
    Then I should see an error that the database file must have a .duckdb extension

  Scenario: Path traversal in export output path
    Given a project "Acme" exists
    When I run "rw export --project Acme --output ../../../etc/cron.d/pwned"
    Then I should see an error that the output path is invalid

  Scenario: Path traversal in import file path
    When I run "rw import --project Acme --file ../../../etc/shadow"
    Then I should see an error that the file path is invalid

  Scenario: Symlink in export output path
    Given a symlink at "/tmp/export.csv" pointing to "/etc/passwd"
    When I export to "/tmp/export.csv"
    Then I should see an error that the output path resolves to a disallowed location

  # -- Input Validation --

  Scenario: Ticket title must not exceed 500 characters
    When I create a ticket with a title of 501 characters
    Then I should see an error that the title exceeds the maximum length

  Scenario: Ticket description must not exceed 10000 characters
    When I create a ticket with a description of 10001 characters
    Then I should see an error that the description exceeds the maximum length

  Scenario: Tag prefix must be alphanumeric and lowercase
    When I create a tag with prefix "State!"
    Then I should see an error that the prefix contains invalid characters

  Scenario: Tag value must be alphanumeric, lowercase, with hyphens allowed
    When I create a tag with value "back log!"
    Then I should see an error that the value contains invalid characters

  Scenario: Tag prefix has a maximum length of 50 characters
    When I create a tag with a prefix of 51 characters
    Then I should see an error that the prefix exceeds the maximum length

  Scenario: Tag value has a maximum length of 100 characters
    When I create a tag with a value of 101 characters
    Then I should see an error that the value exceeds the maximum length

  Scenario: Project name must not exceed 100 characters
    When I create a project with a name of 101 characters
    Then I should see an error that the name exceeds the maximum length

  Scenario: Null bytes in input are rejected
    When I create a ticket with title "hello\x00world"
    Then I should see an error that the input contains invalid characters

  Scenario: Unicode normalisation is consistent
    When I create a ticket with title containing combining characters
    Then the title should be stored in NFC-normalised form

  # -- Import Safety --

  Scenario: CSV import enforces row limit
    Given a CSV file with 100001 rows
    When I import the CSV into project "Acme"
    Then I should see an error that the import exceeds the maximum of 100000 rows

  Scenario: CSV import enforces file size limit
    Given a CSV file of 51 MB
    When I import the CSV into project "Acme"
    Then I should see an error that the file exceeds the maximum size of 50 MB

  Scenario: JSON import rejects deeply nested structures
    Given a JSON file with nesting depth exceeding 10 levels
    When I import the JSON into project "Acme"
    Then I should see an error that the JSON structure is too deeply nested

  Scenario: Import rejects files that are not regular files
    When I run "rw import --project Acme --file /dev/zero"
    Then I should see an error that the path is not a regular file

  # -- Audit Log Integrity --

  Scenario: Revisions cannot be deleted through the application
    Given a ticket "Login page" exists with revisions
    When I attempt to delete revisions for "Login page"
    Then I should see an error that revisions are immutable

  Scenario: Tag change log cannot be deleted through the application
    Given a ticket "Login page" has tag change history
    When I attempt to delete tag change entries for "Login page"
    Then I should see an error that the audit log is immutable

  Scenario: Revision timestamps are server-generated
    Given a ticket "Login page" exists
    When I update "Login page" with a forged revised_at timestamp
    Then the revision should use the actual server time, not the provided timestamp

  # -- Multi-Project Isolation --

  Scenario: Cannot access a ticket by UUID without project context
    Given a project "Acme" with ticket "Secret Plan" exists
    And a project "Globex" exists
    When I try to access a ticket UUID from "Acme" in the context of "Globex"
    Then I should see an error that the ticket was not found

  Scenario: Tags from one project cannot be assigned in another
    Given a project "Acme" with tag "state:backlog" exists
    And a project "Globex" with a ticket "Public Item" exists
    When I try to assign Acme's "state:backlog" tag to Globex's ticket
    Then I should see an error that the tag does not belong to this project

  Scenario: Calculations do not leak data across projects
    Given a project "Acme" with tickets exists
    And a project "Globex" with tickets exists
    When I calculate relative weights for "Acme"
    Then no ticket data from "Globex" should appear in the results

  Scenario: Export only includes data from the specified project
    Given a project "Acme" with tickets exists
    And a project "Globex" with tickets exists
    When I export project "Acme" as JSON
    Then the export should not contain any data from "Globex"
