Feature: Version visibility
  As a user or AI agent
  I want to see the application version from both CLI and MCP
  So that I know which build I am running

  Background:
    Given the app was built with version "1.2.3" baked in at build time

  # -- CLI --

  Scenario: CLI prints version with --version flag
    When I run "rw --version"
    Then the output should contain "1.2.3"

  Scenario: CLI prints version with -V shorthand
    When I run "rw -V"
    Then the output should contain "1.2.3"

  # -- MCP --

  Scenario: MCP server reports version in server info
    When a client connects and completes the initialize handshake
    Then the serverInfo response should contain version "1.2.3"

  Scenario: MCP server exposes version via dedicated tool
    When a client calls "server_version"
    Then the response should contain version "1.2.3"

  # -- Build-time injection --

  Scenario: Version matches package.json
    Given package.json contains version "1.2.3"
    When the project is built with "npm run build"
    Then the baked-in version constant should equal "1.2.3"

  Scenario: Version matches the latest git tag
    Given the repository has tag "v1.2.3"
    And package.json contains version "1.2.3"
    When the project is built
    Then the baked-in version should equal "1.2.3"

  Scenario: Build fails when git tag and package.json disagree
    Given the repository has tag "v1.2.3"
    But package.json contains version "1.3.0"
    When the project is built
    Then the build should warn about the version mismatch

  # -- Docker --

  Scenario: Docker build receives version as build arg
    When I run "docker build --build-arg APP_VERSION=1.2.3 -t rewelo-mcp."
    Then the image should contain the baked-in version "1.2.3"

  Scenario: Docker image is labelled with the version
    Given the image was built with "--build-arg APP_VERSION=1.2.3"
    When I inspect the image labels
    Then the label "org.opencontainers.image.version" should equal "1.2.3"

  Scenario: Docker image serves the correct version via MCP
    Given the Docker image was built with "--build-arg APP_VERSION=1.2.3"
    When a client connects to the MCP server in the container
    Then the serverInfo response should contain version "1.2.3"

  Scenario: Docker build without version arg defaults to package.json version
    When I run "docker build -t rewelo-mcp."
    Then the baked-in version should fall back to the package.json version
