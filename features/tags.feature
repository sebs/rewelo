Feature: Tags
  As a user
  I want to organise tickets using prefix:value tags
  So that I can classify tickets by state, feature, team, or any other dimension

  Background:
    Given a project "Acme" exists
    And a ticket "Login page" exists in project "Acme"

  Scenario: Create a tag
    When I create a tag "state:backlog" in project "Acme"
    Then the tag "state:backlog" should exist

  Scenario: Tags are unique per project
    Given a tag "state:backlog" exists in project "Acme"
    When I create a tag "state:backlog" in project "Acme"
    Then I should see an error that the tag already exists

  Scenario: Same tag value in different projects
    Given a project "Globex" exists
    When I create a tag "state:backlog" in project "Acme"
    And I create a tag "state:backlog" in project "Globex"
    Then both tags should exist independently

  Scenario: Assign a tag to a ticket
    Given a tag "state:backlog" exists in project "Acme"
    When I assign "state:backlog" to "Login page"
    Then "Login page" should have the tag "state:backlog"

  Scenario: Remove a tag from a ticket
    Given "Login page" has the tag "state:wip"
    When I remove "state:wip" from "Login page"
    Then "Login page" should not have the tag "state:wip"

  Scenario: A ticket can have multiple tags
    Given a tag "state:wip" exists
    And a tag "feature:auth" exists
    And a tag "team:platform" exists
    When I assign "state:wip", "feature:auth", and "team:platform" to "Login page"
    Then "Login page" should have all three tags

  Scenario: List tickets by tag
    Given a ticket "Signup flow" exists in project "Acme"
    And "Login page" has the tag "feature:auth"
    And "Signup flow" has the tag "feature:auth"
    When I list tickets with tag "feature:auth"
    Then I should see "Login page" and "Signup flow"

  Scenario: Rename a tag
    Given a tag "feature:login" exists in project "Acme"
    And "Login page" has the tag "feature:login"
    When I rename the tag "feature:login" to "feature:auth"
    Then "Login page" should have the tag "feature:auth"
    And the tag "feature:login" should no longer exist
