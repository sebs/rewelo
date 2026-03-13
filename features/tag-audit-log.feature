Feature: Tag Audit Log
  As a user
  I want every tag assignment and removal to be logged
  So that I can track how tickets evolved over time

  Background:
    Given a project "Acme" exists
    And a ticket "Login page" exists in project "Acme"
    And tags "state:backlog", "state:wip", and "state:done" exist

  Scenario: Assigning a tag creates an audit entry
    When I assign "state:backlog" to "Login page"
    Then the audit log for "Login page" should contain an "added" entry for "state:backlog"

  Scenario: Removing a tag creates an audit entry
    Given "Login page" has the tag "state:backlog"
    When I remove "state:backlog" from "Login page"
    Then the audit log for "Login page" should contain a "removed" entry for "state:backlog"

  Scenario: Full state transition history
    When I assign "state:backlog" to "Login page"
    And I remove "state:backlog" from "Login page"
    And I assign "state:wip" to "Login page"
    And I remove "state:wip" from "Login page"
    And I assign "state:done" to "Login page"
    Then the audit log for "Login page" should show in order:
      | action  | tag            |
      | added   | state:backlog  |
      | removed | state:backlog  |
      | added   | state:wip      |
      | removed | state:wip      |
      | added   | state:done     |

  Scenario: Audit log preserves timestamps
    When I assign "state:backlog" to "Login page"
    And later I assign "state:wip" to "Login page"
    Then the "state:wip" entry should have a later timestamp than "state:backlog"
