Feature: Calculations
  As a user
  I want the tool to calculate priority scores from ticket dimensions
  So that I can identify the highest-value work

  Background:
    Given a project "Acme" exists

  # -- Basic calculations --

  Scenario: Value is benefit plus penalty
    Given a ticket with benefit 8 and penalty 5
    Then its value should be 13

  Scenario: Cost is estimate plus risk
    Given a ticket with estimate 3 and risk 2
    Then its cost should be 5

  Scenario: Priority is value divided by cost
    Given a ticket with benefit 8, penalty 5, estimate 3, risk 2
    Then its priority should be 2.60

  Scenario: Priority with high cost
    Given a ticket with benefit 1, penalty 1, estimate 13, risk 8
    Then its priority should be 0.10

  # -- Relative weight calculations --

  Scenario: Relative benefit across tickets
    Given the following tickets exist:
      | title   | benefit | penalty | estimate | risk |
      | Story A |       8 |       5 |        3 |    2 |
      | Story B |       2 |       1 |        5 |    3 |
      | Story C |       5 |       3 |        2 |    1 |
    Then the relative benefit of "Story A" should be 0.53
    And the relative benefit of "Story B" should be 0.13
    And the relative benefit of "Story C" should be 0.33

  Scenario: Relative penalty across tickets
    Given the following tickets exist:
      | title   | benefit | penalty | estimate | risk |
      | Story A |       3 |       8 |        2 |    1 |
      | Story B |       5 |       2 |        3 |    2 |
    Then the relative penalty of "Story A" should be 0.80
    And the relative penalty of "Story B" should be 0.20

  Scenario: Relative estimate across tickets
    Given the following tickets exist:
      | title   | benefit | penalty | estimate | risk |
      | Story A |       3 |       2 |       13 |    1 |
      | Story B |       5 |       3 |        8 |    2 |
    Then the relative estimate of "Story A" should be 0.62
    And the relative estimate of "Story B" should be 0.38

  Scenario: Relative risk across tickets
    Given the following tickets exist:
      | title   | benefit | penalty | estimate | risk |
      | Story A |       3 |       2 |        5 |   13 |
      | Story B |       5 |       3 |        3 |    8 |
    Then the relative risk of "Story A" should be 0.62
    And the relative risk of "Story B" should be 0.38

  # -- Weighted priority --

  Scenario: Weighted priority with default weights
    Given default weights w1=1.5, w2=1.5, w3=1.5, w4=1.5
    And a ticket with benefit 8, penalty 5, estimate 3, risk 2
    Then the weighted priority should be 2.60

  Scenario: Weighted priority emphasising benefit
    Given weights w1=3.0, w2=1.0, w3=1.5, w4=1.5
    And a ticket with benefit 8, penalty 5, estimate 3, risk 2
    Then the weighted priority should be 3.87

  Scenario: Weighted priority emphasising risk
    Given weights w1=1.5, w2=1.5, w3=1.0, w4=3.0
    And a ticket with benefit 8, penalty 5, estimate 3, risk 2
    Then the weighted priority should be 2.17

  # -- Sorting --

  Scenario: Tickets sorted by priority descending
    Given the following tickets exist:
      | title   | benefit | penalty | estimate | risk |
      | Story A |       2 |       1 |        8 |    5 |
      | Story B |       8 |       5 |        2 |    1 |
      | Story C |       5 |       3 |        3 |    2 |
    When I sort tickets by priority descending
    Then the order should be "Story B", "Story C", "Story A"

  # -- Capacity plans --

  Scenario: Fill a capacity by priority
    Given tickets ranked "A" (estimate 3), "C" (estimate 1), "B" (estimate 8) and "D" (estimate 2)
    When I plan a capacity of 6
    Then the plan should be "A", "C" and "D", with 6 used and 0 left
    And "B" should be named as not fitting, needing 8

  Scenario: A ticket's blockers come first
    Given "Base" blocks "Top", and "Top" ranks first
    When I plan a capacity that fits both
    Then "Base" should be planned before "Top", for "Top"

  Scenario: A ticket whose blockers don't fit is skipped with them
    Given "Base" (estimate 5) blocks "Top" (estimate 2)
    When I plan a capacity of 5
    Then neither "Top" nor "Base" should be planned
    And "Top" should be named as not fitting, needing 7

  Scenario: Effort as cost
    When I plan a capacity with effort cost
    Then each ticket should take its estimate + risk

  Scenario: Leave out work under way
    Given "Wip" is tagged state:wip
    When I plan a capacity excluding state:wip
    Then "Wip" should be planned only as a blocker of a planned ticket
