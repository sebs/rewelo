Feature: Weight Configuration
  As a user
  I want to configure the weights used in weighted priority calculations
  So that I can emphasise different factors according to business priorities

  Background:
    Given a project "Acme" exists

  Scenario: Default weights are applied
    When I view the weight configuration for "Acme"
    Then the weights should be w1=1.5, w2=1.5, w3=1.5, w4=1.5

  Scenario: Update weights
    When I set weights for "Acme" to w1=3.0, w2=1.0, w3=1.5, w4=2.0
    Then the weights for "Acme" should be w1=3.0, w2=1.0, w3=1.5, w4=2.0

  Scenario: Weights are persisted per project
    Given a project "Globex" exists
    When I set weights for "Acme" to w1=3.0, w2=1.0, w3=1.5, w4=2.0
    Then the weights for "Globex" should still be w1=1.5, w2=1.5, w3=1.5, w4=1.5

  Scenario: Reset weights to defaults
    Given weights for "Acme" are w1=3.0, w2=1.0, w3=1.5, w4=2.0
    When I reset weights for "Acme"
    Then the weights should be w1=1.5, w2=1.5, w3=1.5, w4=1.5

  Scenario: Weights must be positive numbers
    When I set weights for "Acme" to w1=-1.0, w2=1.5, w3=1.5, w4=1.5
    Then I should see an error that weights must be positive

  Scenario: Zero weight effectively disables a factor
    When I set weights for "Acme" to w1=1.5, w2=0, w3=1.5, w4=1.5
    And a ticket exists with benefit 8, penalty 13, estimate 3, risk 2
    Then the weighted priority should ignore penalty in the calculation
