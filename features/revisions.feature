Feature: Revisions
  As a user
  I want to see the full history of changes to tickets and tags
  So that I can understand how decisions evolved

  Background:
    Given a project "Acme" exists
    And a ticket "Login page" exists with benefit 3, penalty 2, estimate 5, risk 3
    And "Login page" has the tag "state:backlog"

  # -- Ticket revisions --

  Scenario: Updating scores creates a revision
    When I update "Login page" to benefit 8, penalty 5, estimate 3, risk 2
    Then a revision should exist for "Login page" with the previous scores 3, 2, 5, 3

  Scenario: Updating title creates a revision
    When I update the title of "Login page" to "Login page v2"
    Then a revision should exist with the previous title "Login page"

  Scenario: Revision captures tag snapshot
    When I update "Login page" to benefit 8, penalty 5, estimate 3, risk 2
    Then the revision should include a tag snapshot containing "state:backlog"

  Scenario: Multiple revisions preserve full history
    When I update "Login page" to benefit 5, penalty 3, estimate 3, risk 2
    And I update "Login page" to benefit 8, penalty 5, estimate 2, risk 1
    Then there should be 2 revisions for "Login page"
    And the revisions should be ordered by time ascending

  Scenario: View a specific revision
    When I update "Login page" to benefit 5, penalty 3, estimate 3, risk 2
    And I update "Login page" to benefit 8, penalty 5, estimate 2, risk 1
    Then I should be able to view revision 1 with scores 3, 2, 5, 3
    And I should be able to view revision 2 with scores 5, 3, 3, 2

  # -- Tag revisions --

  Scenario: Renaming a tag creates a tag revision
    Given a tag "feature:login" exists in project "Acme"
    When I rename "feature:login" to "feature:auth"
    Then a tag revision should exist with the previous value "feature:login"
