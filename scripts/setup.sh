#!/bin/bash
# Setup script for Claude Code Wrapper on EC2 instance

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WRAPPER_DIR="$(dirname "$SCRIPT_DIR")"

echo "=== Claude Code Wrapper Setup ==="
echo ""

# Check if running as ubuntu user
if [ "$(whoami)" != "ubuntu" ]; then
    echo "Warning: This script should be run as the ubuntu user"
fi

# Install Claude Code CLI if not present
if ! command -v claude &> /dev/null; then
    echo "Installing Claude Code CLI..."
    sudo npm install -g @anthropic-ai/claude-code
    echo "Claude Code CLI installed"
else
    echo "Claude Code CLI already installed: $(claude --version)"
fi

# Create workspace directory
WORKSPACE_DIR="${WORKSPACE_DIR:-/home/ubuntu/workspace}"
if [ ! -d "$WORKSPACE_DIR" ]; then
    echo "Creating workspace directory: $WORKSPACE_DIR"
    sudo mkdir -p "$WORKSPACE_DIR"
    sudo chown ubuntu:ubuntu "$WORKSPACE_DIR"
fi

# Install Node.js dependencies
echo "Installing dependencies..."
cd "$WRAPPER_DIR"
npm install --production

# Check for .env file
if [ ! -f "$WRAPPER_DIR/.env" ]; then
    echo ""
    echo "WARNING: .env file not found!"
    echo "Copy .env.example to .env and configure:"
    echo "  cp $WRAPPER_DIR/.env.example $WRAPPER_DIR/.env"
    echo "  nano $WRAPPER_DIR/.env"
    echo ""
fi

# Run migrations
echo ""
echo "Running database migrations..."
"$SCRIPT_DIR/migrate.sh"

# Create systemd service file
SERVICE_FILE="/etc/systemd/system/claude-code-wrapper.service"
echo ""
echo "Creating systemd service..."

sudo tee "$SERVICE_FILE" > /dev/null << EOF
[Unit]
Description=Claude Code Wrapper Service
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=$WRAPPER_DIR
ExecStart=/usr/bin/node $WRAPPER_DIR/src/server.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

# Reload systemd
sudo systemctl daemon-reload

echo ""
echo "=== Setup Complete ==="
echo ""
echo "To start the service:"
echo "  sudo systemctl start claude-code-wrapper"
echo ""
echo "To enable on boot:"
echo "  sudo systemctl enable claude-code-wrapper"
echo ""
echo "To check status:"
echo "  sudo systemctl status claude-code-wrapper"
echo ""
echo "To view logs:"
echo "  sudo journalctl -u claude-code-wrapper -f"
