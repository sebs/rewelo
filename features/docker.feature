Feature: Docker
  As a user
  I want to run the tool in a Docker container
  So that I can use it without installing Node.js or DuckDB locally

  Scenario: Build the Docker image
    When I run "docker build -t rewelo-mcp ."
    Then the image should build successfully

  Scenario: Run a CLI command in Docker
    Given the Docker image is built
    When I run "docker run --rm -v ./data:/data rewelo-mcp project create Acme"
    Then the project should be created in the mounted database

  Scenario: Database persists via volume mount
    Given I run the tool in Docker with a volume mount at "/data"
    When I create a project and then stop the container
    And I start a new container with the same volume mount
    Then the project should still exist

  Scenario: Run the MCP server in Docker
    Given the Docker image is built
    When I run "docker run -i rewelo-mcp serve"
    Then the MCP server should start and accept stdio connections

  Scenario: Environment variable for database path
    When I run the container with "RW_DB_PATH=/data/custom.duckdb"
    Then the tool should use "/data/custom.duckdb" as the database file

  # -- Security --

  Scenario: Container runs as non-root user
    Given the Docker image is built
    When I inspect the running container's user
    Then the process should not be running as root

  Scenario: Container filesystem is read-only except for data volume
    Given the Docker image is built
    When I run the container with "--read-only" and a writable volume at "/data"
    Then the tool should function correctly
    And no writes should occur outside "/data"

  Scenario: Container has minimal capabilities
    Given the Docker image is built
    When I inspect the container's capabilities
    Then it should drop all capabilities except those strictly required

  Scenario: Database path environment variable is validated
    When I run the container with "RW_DB_PATH=/etc/passwd"
    Then the tool should reject the path as outside the allowed data directory

  Scenario: Container resource limits are respected
    When I run the container with memory limit of 256 MB
    And I attempt to import a very large dataset
    Then the container should fail gracefully instead of being OOM-killed
