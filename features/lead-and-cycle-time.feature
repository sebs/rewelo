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
