Feature: Output Formatting
  As a user
  I want to control how results are displayed
  So that I can use the output in scripts or read it comfortably in a terminal

  Background:
    Given a project "Acme" exists
    And the following tickets exist:
      | title   | benefit | penalty | estimate | risk |
      | Story A |       8 |       5 |        3 |    2 |
      | Story B |       2 |       1 |        5 |    3 |

  # -- Table output (default) --

  Scenario: Default table output
    When I list tickets with default formatting
    Then the output should be an aligned table with column headers
    And numeric columns should be right-aligned
    And priority should be formatted to 2 decimal places

  Scenario: Table output with calculated columns
    When I list tickets with calculations
    Then the table should include value, cost, and priority columns

  # -- JSON output --

  Scenario: JSON output for tickets
    When I list tickets with "--json"
    Then the output should be a valid JSON array
    And each ticket should include all fields and calculated values

  Scenario: JSON output for a single ticket
    When I view a ticket with "--json"
    Then the output should be a valid JSON object

  # -- Quiet output --

  Scenario: Quiet mode on create returns only the UUID
    When I create a ticket with "--quiet"
    Then the output should contain only the ticket UUID on a single line

  Scenario: Quiet mode on list returns only titles
    When I list tickets with "--quiet"
    Then the output should contain one ticket title per line

  # -- CSV output --

  Scenario: CSV output for piping
    When I list tickets with "--csv"
    Then the output should be valid CSV with a header row
    And it should be suitable for piping into other tools

  # -- No colour mode --

  Scenario: Disable colour output
    When I list tickets with "--no-color"
    Then the output should not contain ANSI colour codes
