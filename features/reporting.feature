Feature: Reporting
  As a user
  I want summary reports and dashboards for a project
  So that I can quickly understand the state and priorities of my backlog

  Background:
    Given a project "Acme" exists
    And the following tickets exist:
      | title     | benefit | penalty | estimate | risk | tags                       |
      | Story A   |       8 |       5 |        3 |    2 | state:done,feature:auth    |
      | Story B   |       2 |       1 |        5 |    3 | state:wip,feature:auth     |
      | Story C   |       5 |       3 |        2 |    1 | state:backlog,feature:pay  |
      | Story D   |      13 |       8 |        8 |    5 | state:backlog,feature:pay  |
      | Story E   |       3 |       2 |        3 |    2 | state:wip,feature:auth     |

  Scenario: Project summary
    When I view the summary for project "Acme"
    Then I should see:
      | metric         | value |
      | total tickets  |     5 |
      | state:backlog  |     2 |
      | state:wip      |     2 |
      | state:done     |     1 |

  Scenario: Top tickets by priority
    When I view the top 3 tickets by priority in "Acme"
    Then I should see the 3 tickets with the highest priority scores
    And they should be ordered by priority descending

  Scenario: Summary by tag prefix
    When I view the summary grouped by "feature" in "Acme"
    Then I should see, highest average first:
      | feature | tickets | avg priority |
      | pay     |       2 |         2.14 |
      | auth    |       3 |         1.33 |

  Scenario: Score distribution
    When I view the score distribution for "Acme"
    Then I should see how many tickets use each Fibonacci value per dimension

  Scenario: Backlog health
    When I view the backlog health for "Acme"
    Then I should see the ratio of high-priority to low-priority tickets
    And I should see the total estimated cost of the backlog

  Scenario: Stale scores
    Given ticket "Old" in "Acme" was scored 120 days ago and not re-scored since
    And ticket "Renamed" in "Acme" was scored 120 days ago and renamed yesterday
    And ticket "Recent" in "Acme" was re-scored yesterday
    When I view the backlog health for "Acme"
    Then "Old" and "Renamed" should be listed as not re-scored for 90 days or more, the oldest first
    And "Recent" should not be listed

  Scenario: Stale scores after a chosen number of days
    Given ticket "Old" in "Acme" was scored 120 days ago
    When I view the backlog health for "Acme" with 150 stale days
    Then no ticket should be listed as stale

  Scenario: A dashboard that keeps itself up to date
    Given I ran "rw report dashboard --project Acme --output dash.html --watch"
    And "dash.html" is open in a browser
    When a ticket is added to "Acme" from another terminal
    Then "dash.html" should be written again within seconds
    And the page should reload itself and show the ticket, keeping the choices made on it and the dialogs open
    And it should not reload while nothing changes
    When I press Ctrl-C
    Then the command should end with exit code 0

  Scenario: Browsing every ticket on the dashboard
    Given "Acme" has 45 tickets, 10 of them tagged "state:done" and 5 "state:wip"
    When I generate the dashboard for "Acme"
    And I choose "Browse all tickets"
    Then a dialog should list every ticket, done ones too, highest priority first, 20 to a page
    And I should be able to filter it by "done", "wip" or "No state", and page through each, without a script
    When I choose a ticket
    Then a dialog should show its scores, value, cost, priority, description, tags and relations

  Scenario: What changed in the ranking, and why
    Given on "2026-03-01" the open tickets ranked "A", "B", "C"
    And "C" was re-scored on "2026-03-05" from benefit 3 to 21
    When I view the ranking changes for "Acme" since "2026-03-01"
    Then "C" should be listed as "#3 → #1", re-scored: benefit 3 → 21
    And "A" and "B" should not be listed, but counted as moved only because "C" did

  Scenario: New, done and reopened tickets, and blockers
    Given since last week a ticket was created, one was done and one was reopened
    And a ticket got a new blocker, and another one's blocker was done
    When I view the ranking changes for "Acme" for the last 7 days
    Then each should be listed with what changed about it
    And the dashboard should show the same changes
