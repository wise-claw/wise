#!/usr/bin/env bash
set -e

echo "=== SWE-bench Evaluation Environment ==="
echo "Run Mode: ${RUN_MODE:-vanilla}"
echo "Claude Code version: $(claude --version 2>/dev/null || echo 'not installed')"

# Configure Claude Code if auth token is provided
if [ -n "$ANTHROPIC_AUTH_TOKEN" ]; then
    echo "Anthropic auth token configured"
    export ANTHROPIC_AUTH_TOKEN="$ANTHROPIC_AUTH_TOKEN"
else
    echo "WARNING: ANTHROPIC_AUTH_TOKEN not set"
fi

# Configure custom base URL if provided
if [ -n "$ANTHROPIC_BASE_URL" ]; then
    echo "Using custom Anthropic base URL: $ANTHROPIC_BASE_URL"
    export ANTHROPIC_BASE_URL="$ANTHROPIC_BASE_URL"
fi

# Install WISE if in wise mode
if [ "$RUN_MODE" = "wise" ]; then
    echo "Installing wise for enhanced mode..."

    # Check if WISE source is mounted
    if [ -d "/workspace/wise-source" ]; then
        echo "Installing WISE from mounted source..."
        cd /workspace/wise-source && npm install && npm link
    else
        echo "Installing WISE from npm..."
        npm install -g wise
    fi

    # Initialize WISE configuration
    mkdir -p ~/.claude

    echo "WISE installation complete"
fi

# Execute the command passed to the container
exec "$@"
