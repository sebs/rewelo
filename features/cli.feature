Feature: CLI Commands
  As a user
  I want a clear and consistent command-line interface
  So that I can manage projects, tickets, and tags efficiently

  # -- Project commands --

  Scenario: Create a project
    When I run "rw project create Acme"
    Then the output should confirm the project was created

  Scenario: List projects
    Given projects "Acme" and "Globex" exist
    When I run "rw project list"
    Then the output should list both projects with their UUIDs

  Scenario: Delete a project with confirmation
    Given a project "Acme" exists
    When I run "rw project delete Acme"
    Then I should be prompted to confirm
    When I confirm
    Then the project should be deleted

  Scenario: Delete a project with force flag
    Given a project "Acme" exists
    When I run "rw project delete Acme --force"
    Then the project should be deleted without prompting

  # -- Ticket commands --

  Scenario: Create a ticket
    Given a project "Acme" exists
    When I run "rw ticket create --project Acme --title 'Login page' --benefit 8 --penalty 5 --estimate 3 --risk 2"
    Then the output should confirm the ticket was created with the given scores

  Scenario: Create a ticket with defaults
    Given a project "Acme" exists
    When I run "rw ticket create --project Acme --title 'Login page'"
    Then the ticket should be created with all scores defaulting to 1

  Scenario: List tickets
    Given a project "Acme" exists with tickets
    When I run "rw ticket list --project Acme"
    Then the output should show a table of tickets with scores, value, cost, and priority

  Scenario: List tickets sorted by priority
    Given a project "Acme" exists with tickets
    When I run "rw ticket list --project Acme --sort priority"
    Then tickets should be ordered by priority descending

  Scenario: List tickets filtered by tag
    Given a project "Acme" exists with tagged tickets
    When I run "rw ticket list --project Acme --tag feature:auth"
    Then only tickets with the "feature:auth" tag should appear

  Scenario: Update a ticket
    Given a ticket "Login page" exists in project "Acme"
    When I run "rw ticket update --project Acme --title 'Login page' --benefit 13"
    Then the benefit should be updated to 13
    And a revision should be created

  Scenario: Delete a ticket
    Given a ticket "Login page" exists in project "Acme"
    When I run "rw ticket delete --project Acme --title 'Login page'"
    Then the ticket should be deleted

  Scenario: View ticket history
    Given a ticket "Login page" exists with revisions
    When I run "rw ticket history --project Acme --title 'Login page'"
    Then the output should list all revisions with timestamps and previous values

  # -- Tag commands --

  Scenario: Create a tag
    Given a project "Acme" exists
    When I run "rw tag create --project Acme state:backlog"
    Then the tag should be created

  Scenario: Assign a tag to a ticket
    Given a ticket "Login page" exists in project "Acme"
    And a tag "state:backlog" exists
    When I run "rw tag assign --project Acme --ticket 'Login page' state:backlog"
    Then the tag should be assigned to the ticket

  Scenario: Remove a tag from a ticket
    Given "Login page" has the tag "state:backlog"
    When I run "rw tag remove --project Acme --ticket 'Login page' state:backlog"
    Then the tag should be removed from the ticket

  Scenario: List tags in a project
    Given tags exist in project "Acme"
    When I run "rw tag list --project Acme"
    Then all tags should be listed grouped by prefix

  Scenario: View tag change log for a ticket
    Given "Login page" has tag change history
    When I run "rw tag log --project Acme --ticket 'Login page'"
    Then the output should show all tag additions and removals with timestamps

  # -- Calculation commands --

  Scenario: Show relative weights
    Given a project "Acme" exists with tickets
    When I run "rw calc weights --project Acme"
    Then the output should show a table with relative benefit, penalty, estimate, and risk

  Scenario: Show relative weights scoped to a tag
    Given a project "Acme" exists with tagged tickets
    When I run "rw calc weights --project Acme --tag feature:auth"
    Then relative weights should be calculated only within the tagged subset

  Scenario: Show weighted priority with custom weights
    Given a project "Acme" exists with tickets
    When I run "rw calc priority --project Acme --w1 3.0 --w2 1.0"
    Then the output should use the specified weights for the calculation

  # -- Report commands --

  Scenario: Project summary
    Given a project "Acme" exists with tickets
    When I run "rw report summary --project Acme"
    Then the output should show ticket counts by state and overall statistics

  Scenario: Lead and cycle time report
    Given a project "Acme" exists with completed tickets
    When I run "rw report times --project Acme"
    Then the output should show lead time and cycle time for each completed ticket

  # -- Global options --

  Scenario: JSON output format
    When I run "rw project list --json"
    Then the output should be valid JSON

  Scenario: Quiet mode
    When I run "rw ticket create --project Acme --title 'Login page' --quiet"
    Then the output should only contain the ticket UUID

  Scenario: Custom database path
    When I run "rw project list --db /tmp/custom.duckdb"
    Then the tool should use the specified database file

  Scenario: Help text
    When I run "rw --help"
    Then I should see a summary of all available commands

  Scenario: Version
    When I run "rw --version"
    Then I should see the current version number
