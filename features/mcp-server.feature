Feature: MCP Server
  As an AI tool or integration
  I want to interact with the relative weight tool via MCP
  So that I can manage tickets and calculations programmatically

  # -- Server lifecycle --

  Scenario: Start the MCP server
    When I run "rw serve"
    Then the MCP server should start and listen for connections
    And it should log the transport method being used

  Scenario: Server uses stdio transport by default
    When I run "rw serve"
    Then the server should communicate over stdin/stdout

  # -- Tool discovery --

  Scenario: List available tools
    When a client connects and requests the tool list
    Then the server should expose tools for:
      | tool                  |
      | project_create        |
      | project_list          |
      | project_delete        |
      | ticket_create         |
      | ticket_list           |
      | ticket_update         |
      | ticket_delete         |
      | ticket_history        |
      | tag_create            |
      | tag_assign            |
      | tag_remove            |
      | tag_list              |
      | calc_priority         |
      | calc_weights          |
      | report_summary        |
      | report_times          |
      | export                |
      | import                |

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

  Scenario: Rate limiting on MCP tool calls
    When a client sends 1000 requests within 1 second
    Then the server should reject excess requests with a rate limit error

  Scenario: Oversized request payload is rejected
    When a client sends a request with a 10 MB description field
    Then the server should reject the request before processing
