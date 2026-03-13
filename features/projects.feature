Feature: Projects
  As a user
  I want to manage projects
  So that I can organise tickets into separate workspaces

  Scenario: Create a project
    When I create a project named "Acme"
    Then a project "Acme" should exist
    And it should have a UUID assigned

  Scenario: List projects
    Given a project "Acme" exists
    And a project "Globex" exists
    When I list all projects
    Then I should see "Acme" and "Globex"

  Scenario: Project names are unique
    Given a project "Acme" exists
    When I create a project named "Acme"
    Then I should see an error that the project already exists

  Scenario: Delete a project
    Given a project "Acme" exists
    And the project has tickets and tags
    When I delete the project "Acme"
    Then the project should no longer exist
    And all its tickets, tags, and history should be removed
