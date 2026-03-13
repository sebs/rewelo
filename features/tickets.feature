Feature: Tickets
  As a user
  I want to create and manage tickets within a project
  So that I can score and prioritise work

  Background:
    Given a project "Acme" exists

  Scenario: Create a ticket with default scores
    When I create a ticket "Login page" in project "Acme"
    Then the ticket should exist with benefit 1, penalty 1, estimate 1, risk 1

  Scenario: Create a ticket with explicit scores
    When I create a ticket "Login page" in project "Acme" with benefit 8, penalty 5, estimate 3, risk 2
    Then the ticket should exist with benefit 8, penalty 5, estimate 3, risk 2

  Scenario: Scores must be Fibonacci values
    When I create a ticket with benefit 4
    Then I should see an error that 4 is not a valid Fibonacci value

  Scenario Outline: Reject invalid Fibonacci values
    When I create a ticket with <field> set to <value>
    Then I should see an error that <value> is not a valid Fibonacci value

    Examples:
      | field    | value |
      | benefit  |     0 |
      | benefit  |     4 |
      | penalty  |     6 |
      | estimate |    10 |
      | risk     |    15 |

  Scenario: Update a ticket's scores
    Given a ticket "Login page" exists with benefit 3, penalty 2, estimate 5, risk 3
    When I update "Login page" to benefit 8, penalty 5, estimate 3, risk 2
    Then the ticket should have benefit 8, penalty 5, estimate 3, risk 2

  Scenario: Update a ticket's title and description
    Given a ticket "Login page" exists
    When I update the title to "Login page v2" and description to "Redesigned flow"
    Then the ticket should have title "Login page v2" and description "Redesigned flow"

  Scenario: Delete a ticket
    Given a ticket "Login page" exists
    When I delete the ticket "Login page"
    Then the ticket should no longer exist

  Scenario: List tickets in a project
    Given a ticket "Login page" exists in project "Acme"
    And a ticket "Signup flow" exists in project "Acme"
    When I list tickets in project "Acme"
    Then I should see "Login page" and "Signup flow"
