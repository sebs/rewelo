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
    Then I should see:
      | feature | tickets | avg priority |
      | auth    |       3 |         1.40 |
      | pay     |       2 |         2.13 |

  Scenario: Score distribution
    When I view the score distribution for "Acme"
    Then I should see how many tickets use each Fibonacci value per dimension

  Scenario: Backlog health
    When I view the backlog health for "Acme"
    Then I should see the ratio of high-priority to low-priority tickets
    And I should see the total estimated cost of the backlog
