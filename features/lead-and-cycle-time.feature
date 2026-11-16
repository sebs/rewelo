Feature: Lead Time and Cycle Time
  As a user
  I want to see lead time and cycle time for completed tickets
  So that I can measure how long work takes from creation to delivery

  Background:
    Given a project "Acme" exists
    And tags "state:backlog", "state:wip", and "state:done" exist

  Scenario: Lead time is measured from creation to done
    Given a ticket "Login page" was created on "2026-01-01"
    And "Login page" was tagged "state:backlog" on "2026-01-01"
    And "Login page" was tagged "state:wip" on "2026-01-10"
    And "Login page" was tagged "state:done" on "2026-01-20"
    Then the lead time for "Login page" should be 19 days

  Scenario: Cycle time is measured from wip to done
    Given a ticket "Login page" was created on "2026-01-01"
    And "Login page" was tagged "state:backlog" on "2026-01-01"
    And "Login page" was tagged "state:wip" on "2026-01-10"
    And "Login page" was tagged "state:done" on "2026-01-20"
    Then the cycle time for "Login page" should be 10 days

  Scenario: Ticket without done state has no lead time
    Given a ticket "Login page" exists with tag "state:wip"
    Then the lead time for "Login page" should be undefined

  Scenario: Ticket that was never in wip has no cycle time
    Given a ticket "Login page" was created on "2026-01-01"
    And "Login page" was tagged "state:backlog" on "2026-01-01"
    And "Login page" was tagged "state:done" on "2026-01-15"
    Then the cycle time for "Login page" should be undefined
    And the lead time for "Login page" should be 14 days

  Scenario: Average lead time across tickets
    Given the following completed tickets:
      | title     | created    | done       |
      | Story A   | 2026-01-01 | 2026-01-11 |
      | Story B   | 2026-01-05 | 2026-01-20 |
      | Story C   | 2026-01-10 | 2026-01-17 |
    Then the average lead time should be 11 days

  Scenario: Cumulative flow counts arrived, started and done tickets per day
    Given a ticket "Login page" was created on "2026-01-01"
    And "Login page" was tagged "state:wip" on "2026-01-10"
    And "Login page" was tagged "state:done" on "2026-01-20"
    And a ticket "Signup" was created on "2026-01-05"
    When I generate the dashboard for "Acme" on "2026-01-25"
    Then its cumulative flow should count at the end of these days:
      | day        | arrived | started | done |
      | 2026-01-01 |       1 |       0 |    0 |
      | 2026-01-05 |       2 |       0 |    0 |
      | 2026-01-10 |       2 |       1 |    0 |
      | 2026-01-20 |       2 |       1 |    1 |

  Scenario: A ticket done without being wip counts as started when it was done
    Given a ticket "Hotfix" was created on "2026-01-01"
    And "Hotfix" was tagged "state:done" on "2026-01-03"
    When I generate the dashboard for "Acme" on "2026-01-05"
    Then its cumulative flow should count 1 started and 1 done ticket on "2026-01-03"

  Scenario: The cumulative flow window
    Given tickets in "Acme" moved through their states over the last year
    When I open the dashboard for "Acme"
    Then the cumulative flow should show the last 30 days
    And I should be able to switch it to the last 14, 90 or 365 days, or to all days since the first ticket, without a script
    And its y axis should start 3 tickets below the lowest done count in the window, or at 0
    And hovering a day should show its counts
