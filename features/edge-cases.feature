Feature: Edge Cases
  As a user
  I want the tool to handle boundary conditions gracefully
  So that I get correct results or clear errors instead of crashes

  # -- Empty project --

  Scenario: Calculations on an empty project
    Given a project "Acme" exists with no tickets
    When I calculate priorities for "Acme"
    Then the result should be an empty list
    And no errors should occur

  Scenario: Relative weights on an empty project
    Given a project "Acme" exists with no tickets
    When I calculate relative weights for "Acme"
    Then the result should be an empty list

  Scenario: Summary on an empty project
    Given a project "Acme" exists with no tickets
    When I view the summary for "Acme"
    Then all counts should be 0

  # -- Single ticket --

  Scenario: Relative weights with a single ticket
    Given a project "Acme" exists
    And a single ticket exists with benefit 5, penalty 3, estimate 2, risk 1
    When I calculate relative weights
    Then relative benefit should be 1.00
    And relative penalty should be 1.00
    And relative estimate should be 1.00
    And relative risk should be 1.00

  # -- Tag-scoped edge cases --

  Scenario: Tag-scoped calculation with no matching tickets
    Given a project "Acme" exists with tickets
    And a tag "feature:empty" exists but is not assigned to any ticket
    When I calculate relative weights for tag "feature:empty"
    Then the result should be an empty list

  Scenario: Tag-scoped calculation with a single matching ticket
    Given a project "Acme" exists
    And a ticket "Solo" exists with tag "feature:lonely"
    When I calculate relative weights for tag "feature:lonely"
    Then all relative weights for "Solo" should be 1.00

  # -- Division safety --

  Scenario: Priority with minimum cost
    Given a ticket with benefit 1, penalty 1, estimate 1, risk 1
    Then the priority should be 1.00
    And no division error should occur

  Scenario: Weighted priority with all zero weights
    Given weights w1=0, w2=0, w3=0, w4=0
    And a ticket exists
    When I calculate weighted priority
    Then I should see an error that weights result in a zero denominator

  Scenario: Weighted priority with zero denominator weights only
    Given weights w1=1.5, w2=1.5, w3=0, w4=0
    And a ticket exists
    When I calculate weighted priority
    Then I should see an error that weights result in a zero denominator

  # -- Duplicate operations --

  Scenario: Assigning the same tag twice is idempotent
    Given a ticket "Login page" has the tag "state:backlog"
    When I assign "state:backlog" to "Login page" again
    Then the ticket should still have exactly one "state:backlog" tag
    And the audit log should not contain a duplicate entry

  Scenario: Removing a tag that is not assigned
    Given a ticket "Login page" exists without tag "state:wip"
    When I remove "state:wip" from "Login page"
    Then I should see a warning that the tag was not assigned

  # -- Large Fibonacci values --

  Scenario: All dimensions at maximum Fibonacci value
    Given a ticket with benefit 21, penalty 21, estimate 21, risk 21
    Then its value should be 42
    And its cost should be 42
    And its priority should be 1.00

  # -- Concurrent-safe audit log --

  Scenario: Rapid tag changes maintain correct order
    Given a ticket "Login page" exists
    When I assign and remove tags in rapid succession:
      | action | tag           |
      | assign | state:backlog |
      | remove | state:backlog |
      | assign | state:wip     |
    Then the audit log should reflect the exact order of operations

  # -- Error message safety --

  Scenario: Database errors do not expose internal paths
    Given a corrupted database
    When I run any command
    Then the error message should not contain absolute file paths or SQL internals

  Scenario: Invalid input errors do not echo raw input back
    When I create a ticket with title containing a script tag "<script>alert(1)</script>"
    Then the error or confirmation should not render the raw HTML
