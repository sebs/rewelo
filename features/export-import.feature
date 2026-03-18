Feature: Export and Import
  As a user
  I want to export and import project data
  So that I can share data or migrate between environments

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
