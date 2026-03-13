Feature: Tag-Scoped Calculations
  As a user
  I want to calculate relative weights within a tagged subset of tickets
  So that I can compare priorities within a feature, team, or any grouping

  Background:
    Given a project "Acme" exists
    And the following tickets exist:
      | title     | benefit | penalty | estimate | risk |
      | Story A   |       8 |       5 |        3 |    2 |
      | Story B   |       2 |       1 |        5 |    3 |
      | Story C   |       5 |       3 |        2 |    1 |
      | Story D   |      13 |       8 |        8 |    5 |
    And "Story A" and "Story B" have the tag "feature:auth"
    And "Story C" and "Story D" have the tag "feature:checkout"

  Scenario: Relative benefit scoped to a tag
    When I calculate relative weights for tag "feature:auth"
    Then the relative benefit of "Story A" should be 0.80
    And the relative benefit of "Story B" should be 0.20

  Scenario: Priority within a tag
    When I calculate priorities for tag "feature:checkout"
    Then "Story C" should have priority 2.67
    And "Story D" should have priority 1.62

  Scenario: Scoped calculation ignores tickets outside the tag
    When I calculate relative weights for tag "feature:auth"
    Then "Story C" and "Story D" should not appear in the results

  Scenario: Same ticket in multiple tag scopes
    Given "Story A" also has the tag "team:platform"
    And "Story C" also has the tag "team:platform"
    When I calculate relative weights for tag "team:platform"
    Then only "Story A" and "Story C" should appear
    And their relative weights should sum to 1.0 for each dimension
