Feature: MCP Server
  As an AI tool or integration
  I want to interact with the relative weight tool via MCP
  So that I can manage tickets and calculations programmatically

  # -- Server lifecycle --

  Scenario: Start the MCP server
    When I run "rw serve"
    Then the MCP server should start and listen for connections
    And it should log the version, the transport method and the database path to stderr

  Scenario: Server uses stdio transport by default
    When I run "rw serve"
    Then the server should communicate over stdin/stdout

  # -- Tool discovery --

  Scenario: List available tools
    When a client connects and requests the tool list
    Then the server should expose tools for:
      | tool                  |
      | server_version        |
      | project_create        |
      | project_list          |
      | project_delete        |
      | project_history       |
      | project_diff          |
      | ticket_create         |
      | ticket_list           |
      | ticket_update         |
      | ticket_upsert         |
      | ticket_delete         |
      | ticket_history        |
      | tag_create            |
      | tag_assign            |
      | tag_remove            |
      | tag_list              |
      | tag_delete            |
      | tag_rename            |
      | weight_get            |
      | weight_set            |
      | weight_reset          |
      | calc_priority         |
      | calc_weights          |
      | simulate              |
      | explain_priority      |
      | report_summary        |
      | report_times          |
      | report_health         |
      | report_distribution   |
      | report_group          |
      | report_dashboard      |
      | event_log             |
      | export_csv            |
      | export_json           |
      | import_csv            |
      | import_json           |
      | relation_create       |
      | relation_remove       |
      | relation_list         |
      | relation_list_all     |

  Scenario: Tools say what they do to the database
    When a client requests the tool list
    Then every tool should carry annotations with openWorldHint false
    And the listing, report, calculation and export tools should be marked read-only
    And "project_delete", "ticket_delete" and "import_json" should be marked destructive
    And "project_create" and "ticket_create" should be marked not destructive
    And "ticket_upsert" and "weight_set" should be marked idempotent

  Scenario: Tools return typed results
    When a client requests the tool list
    Then every tool except "export_csv", "export_json" and "report_dashboard" should declare an outputSchema
    When a client calls "ticket_list" with project "Acme"
    Then the result should carry structuredContent matching the outputSchema
    And a text block with the same data as JSON

  # -- Tool invocation --

  Scenario: Create a project via MCP
    When a client calls "project_create" with name "Acme"
    Then the response should contain the project UUID

  Scenario: List tickets via MCP with tag filter
    Given a project "Acme" exists with tagged tickets
    When a client calls "ticket_list" with project "Acme" and tag "feature:auth"
    Then the response should contain only tickets tagged "feature:auth"

  Scenario: Calculate priorities via MCP
    Given a project "Acme" exists with tickets
    When a client calls "calc_priority" with project "Acme"
    Then the response should contain tickets with their calculated priorities

  # -- What-if --

  Scenario: Simulate a change without writing it
    Given a project "Acme" with tickets A (3.67), B (2), D (1.5) and C (0.63)
    When a client calls "simulate" with C's estimate and risk changed to 1
    Then the response should rank C second, up 2, and B and D each down 1
    And the tickets in the database should be unchanged

  Scenario: Explain what it takes to reach the top
    Given a project "Acme" with tickets A (3.67), B (2), D (1.5) and C (0.63)
    When a client calls "explain_priority" for C with top 2
    Then the response should show "(1.5 × 3 + 1.5 × 2) / (1.5 × 5 + 1.5 × 3) = 7.5 / 12 = 0.63"
    And rank 4 of 4, with priority 2 to beat
    And that benefit 21 or penalty 21 would reach rank 2, and no single estimate or risk change would

  # -- Questions to the user (elicitation) --

  Scenario: Deleting a project asks the user to confirm
    Given a client that can show forms
    And a project "Acme" exists with 1 ticket
    When the client calls "project_delete" with name "Acme"
    Then the user should be asked to confirm deleting "Acme" and its 1 ticket
    And the project should be deleted only when the user confirms
    And otherwise the response should be an MCP error saying the project was not deleted

  Scenario: Deleting a project without a form
    Given a client that cannot show forms
    When the client calls "project_delete" with name "Acme"
    Then the project should be deleted without asking

  Scenario: Creating a ticket asks for the omitted scores
    Given a client that can show forms
    When the client calls "ticket_create" with benefit 5 and estimate 3 only
    Then the user should be asked for penalty and risk, each a choice of 1, 2, 3, 5, 8, 13, 21
    And the ticket should be created with the scores the user chose
    And scores the user leaves empty or declines should default to 1
    And when the user cancels, no ticket should be created

  # -- Resources --

  Scenario: A backlog and a dashboard per project
    Given a project "My Project" exists
    When a client requests the resource list
    Then it should contain "rewelo://My%20Project/backlog" and "rewelo://My%20Project/dashboard"

  Scenario: Read a project's backlog
    Given a project "Acme" with two open tickets and one tagged "state:done"
    When a client reads "rewelo://Acme/backlog"
    Then the content should be JSON with the two open tickets, ranked, with their tags

  Scenario: Read a ticket
    When a client reads "rewelo://Acme/ticket/API%20%2F%20v2"
    Then the content should be the ticket "API / v2" with its description, tags and relations

  Scenario: Read a resource of an unknown project
    When a client reads "rewelo://Nope/backlog"
    Then the response should be an MCP error that the project was not found

  Scenario: A document over 5 MB comes as a link
    Given a project "Big Project" whose JSON export with history is over 5 MB
    When a client calls "export_json" with project "Big Project" and withHistory true
    Then the response should be a resource_link to "rewelo://Big%20Project/export/json-with-history" and a text saying why
    When the client reads that resource
    Then the content should be the whole export

  # -- Prompts --

  Scenario: The skills are offered as prompts
    When a client requests the prompt list
    Then it should contain a prompt for every skill in .claude/skills, with the skill's description

  Scenario: Get a prompt with arguments
    When a client gets the prompt "plan-sprint" with project "Acme" and capacity-points "30"
    Then the message should be the skill's text for project "Acme" with a capacity of 30

  Scenario: Get a prompt without a project
    Given no .rewelo.json with a default project
    When a client gets the prompt "standup" without arguments
    Then the message should tell the model to ask the user which project

  Scenario: Complete prompt arguments
    Given projects "Acme" and "acme-labs", and "Acme" has tickets "Login page" and "Logout"
    When a client completes the "project" argument of "slice" from "acm"
    Then the values should be "Acme" and "acme-labs"
    When a client completes its "ticket-title" argument from "log" with project "Acme"
    Then the values should be "Login page" and "Logout"

  # -- Error handling --

  Scenario: Invalid tool parameters return an error
    When a client calls "ticket_create" without a title
    Then the response should be an MCP error with a descriptive message

  Scenario: Non-existent project returns an error
    When a client calls "ticket_list" with project "DoesNotExist"
    Then the response should be an MCP error indicating the project was not found

  # -- Security --

  Scenario: Input validation applies to all MCP tool parameters
    When a client calls "ticket_create" with title exceeding 500 characters
    Then the response should be an MCP error describing the validation failure

  Scenario: SQL injection via MCP parameters
    When a client calls "project_create" with name "'; DROP TABLE rw.projects; --"
    Then the response should be an MCP error that the name contains invalid characters
    And the projects table should still exist

  Scenario: MCP errors do not expose internal details
    When a client calls "ticket_create" with invalid data that causes a database error
    Then the error response should contain a user-facing message
    And the error response should not contain SQL statements, stack traces, or file paths

  Scenario: A burst of tool calls is paced
    When a client sends 150 requests at once
    Then the first 100 should start at once and the rest a second later
    And none of them should fail

  Scenario: Rate limiting on MCP tool calls
    When a client sends 2000 requests within 1 second
    Then the server should reject the requests that would wait more than 10 seconds
    And the rate limit error should say when to try again

  Scenario: Oversized request payload is rejected
    When a client sends a request with a 10 MB description field
    Then the server should reject the request before processing
