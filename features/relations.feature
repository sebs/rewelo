Feature: Ticket Relations
  As a user
  I want to define typed, bidirectional relations between tickets
  So that dependencies, sequencing, and logical links are tracked automatically

  Background:
    Given a project "Acme" exists
    And a ticket "Auth service" exists in project "Acme"
    And a ticket "Login page" exists in project "Acme"
    And a ticket "Signup flow" exists in project "Acme"

  # ── Dependency relations ──────────────────────────────────────────

  Scenario: blocks / is blocked by
    When I create a relation "Auth service" blocks "Login page" in project "Acme"
    Then "Auth service" should have relation blocks "Login page"
    And "Login page" should have relation is-blocked-by "Auth service"

  Scenario: depends on / is depended on by
    When I create a relation "Login page" depends-on "Auth service" in project "Acme"
    Then "Login page" should have relation depends-on "Auth service"
    And "Auth service" should have relation is-depended-on-by "Login page"

  # ── Logical / Semantic relations ──────────────────────────────────

  Scenario: relates to (symmetric)
    When I create a relation "Auth service" relates-to "Login page" in project "Acme"
    Then "Auth service" should have relation relates-to "Login page"
    And "Login page" should have relation relates-to "Auth service"

  Scenario: duplicates / is duplicated by
    When I create a relation "Signup flow" duplicates "Login page" in project "Acme"
    Then "Signup flow" should have relation duplicates "Login page"
    And "Login page" should have relation is-duplicated-by "Signup flow"

  Scenario: supersedes / is superseded by
    When I create a relation "Signup flow" supersedes "Login page" in project "Acme"
    Then "Signup flow" should have relation supersedes "Login page"
    And "Login page" should have relation is-superseded-by "Signup flow"

  # ── Temporal / Sequencing relations ───────────────────────────────

  Scenario: precedes / follows
    When I create a relation "Auth service" precedes "Login page" in project "Acme"
    Then "Auth service" should have relation precedes "Login page"
    And "Login page" should have relation follows "Auth service"

  # ── Scope / Verification relations ───────────────────────────────

  Scenario: tests / is tested by
    Given a ticket "Auth tests" exists in project "Acme"
    When I create a relation "Auth tests" tests "Auth service" in project "Acme"
    Then "Auth tests" should have relation tests "Auth service"
    And "Auth service" should have relation is-tested-by "Auth tests"

  Scenario: implements / is implemented by
    When I create a relation "Auth service" implements "Login page" in project "Acme"
    Then "Auth service" should have relation implements "Login page"
    And "Login page" should have relation is-implemented-by "Auth service"

  Scenario: addresses / is addressed by
    When I create a relation "Login page" addresses "Auth service" in project "Acme"
    Then "Login page" should have relation addresses "Auth service"
    And "Auth service" should have relation is-addressed-by "Login page"

  # ── Effort / Scope relations ────────────────────────────────────

  Scenario: splits into / is split from
    When I create a relation "Login page" splits-into "Login form" in project "Acme"
    Then "Login page" should have relation splits-into "Login form"
    And "Login form" should have relation is-split-from "Login page"

  # ── Knowledge / Reference relations ──────────────────────────────

  Scenario: informs / is informed by
    When I create a relation "Auth service" informs "Login page" in project "Acme"
    Then "Auth service" should have relation informs "Login page"
    And "Login page" should have relation is-informed-by "Auth service"

  Scenario: see also (symmetric)
    When I create a relation "Auth service" see-also "Login page" in project "Acme"
    Then "Auth service" should have relation see-also "Login page"
    And "Login page" should have relation see-also "Auth service"

  # ── Guard rails ───────────────────────────────────────────────────

  Scenario: A ticket cannot relate to itself
    When I create a relation "Auth service" blocks "Auth service" in project "Acme"
    Then I should see an error that a ticket cannot relate to itself

  Scenario: Duplicate relations are rejected
    Given a relation "Auth service" blocks "Login page" exists in project "Acme"
    When I create a relation "Auth service" blocks "Login page" in project "Acme"
    Then I should see an error that the relation already exists

  Scenario: Deleting a ticket removes all its relations
    Given a relation "Auth service" blocks "Login page" exists in project "Acme"
    And a relation "Auth service" precedes "Signup flow" exists in project "Acme"
    When I delete the ticket "Auth service"
    Then "Login page" should have no relation is-blocked-by "Auth service"
    And "Signup flow" should have no relation follows "Auth service"

  Scenario: List all relations for a ticket
    Given a relation "Auth service" blocks "Login page" exists in project "Acme"
    And a relation "Auth service" precedes "Signup flow" exists in project "Acme"
    When I list relations for "Auth service" in project "Acme"
    Then I should see 2 relations

  Scenario: Remove a relation removes both sides
    Given a relation "Auth service" blocks "Login page" exists in project "Acme"
    When I remove the relation "Auth service" blocks "Login page" in project "Acme"
    Then "Auth service" should have no relation blocks "Login page"
    And "Login page" should have no relation is-blocked-by "Auth service"

  # -- Blocked tickets in the ranking --

  Scenario: The ranking names a ticket's open blockers
    Given a relation "Auth service" blocks "Login page" exists in project "Acme"
    And a relation "Login page" depends-on "Signup flow" exists in project "Acme"
    When I calculate priorities for "Acme"
    Then "Login page" should be blocked by "Auth service" and "Signup flow"
    And it should keep its rank

  Scenario: A done blocker blocks nothing
    Given a relation "Auth service" blocks "Login page" exists in project "Acme"
    And "Auth service" is tagged state:done
    When I calculate priorities for "Acme"
    Then "Login page" should not be blocked

  Scenario: Only blocks and depends-on block
    Given a relation "Auth service" precedes "Login page" exists in project "Acme"
    When I calculate priorities for "Acme"
    Then "Login page" should not be blocked

  Scenario: List what can be started now
    Given a relation "Auth service" blocks "Login page" exists in project "Acme"
    When I calculate priorities for "Acme" with unblocked
    Then "Login page" should not be listed

  Scenario: The dashboard draws the dependencies
    Given ticket "Base" blocks "Middle" and "Middle" blocks "Top"
    And "Top" depends on "Side"
    When I generate the dashboard
    Then its dependency graph should show "Base" and "Side" first, then "Middle", then "Top"
    And "Base" should hold up 2 open tickets
    And done tickets should not be in it

  Scenario: The dashboard shows a ticket waiting for one with a lower priority
    Given ticket "Low" with priority 1.00 blocks "High" with priority 11.00
    When I generate the dashboard
    Then the edge from "Low" to "High" should be drawn as an inversion
    And the dashboard should say that "High" waits for "Low"

  Scenario: The dashboard lists only the relations between open tickets on demand
    Given ticket "Open A" relates to "Open B" and "Open A" relates to "Shipped"
    And "Shipped" is tagged "state:done"
    When I generate the dashboard
    Then its relations should list both relations, with "Shipped" marked done
    And when I switch on "Only between open tickets" only "Open A" relates to "Open B" should be listed
