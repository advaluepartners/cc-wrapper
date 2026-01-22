#!/bin/bash
# Setup script for Claude Code Wrapper on EC2 instance
# This script is called after PostgreSQL is confirmed running

set -e

# Use standard advalue paths
WRAPPER_DIR="${WRAPPER_DIR:-/opt/advalue/cc-wrapper}"
WORKSPACE_DIR="${WORKSPACE_DIR:-/opt/advalue/workspace}"

echo "=== Claude Code Wrapper Setup ==="
echo ""
echo "Wrapper directory: $WRAPPER_DIR"
echo "Workspace directory: $WORKSPACE_DIR"

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
if [ ! -d "$WORKSPACE_DIR" ]; then
    echo "Creating workspace directory: $WORKSPACE_DIR"
    sudo mkdir -p "$WORKSPACE_DIR"
    sudo chown ubuntu:ubuntu "$WORKSPACE_DIR"
else
    echo "Workspace directory already exists: $WORKSPACE_DIR"
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
SERVICE_FILE="/etc/systemd/system/cc-wrapper.service"
echo ""
echo "Creating systemd service..."

sudo tee "$SERVICE_FILE" > /dev/null << EOF
[Unit]
Description=Claude Code Wrapper Service
After=network-online.target postgresql.service
Wants=network-online.target
Documentation=https://github.com/advaluepartners/cc-wrapper

[Service]
Type=simple
User=ubuntu
Group=ubuntu
WorkingDirectory=${WRAPPER_DIR}
ExecStart=/usr/bin/node ${WRAPPER_DIR}/src/server.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production

# Resource limits
MemoryAccounting=true
MemoryMax=1G
CPUQuota=50%

# Security
PrivateTmp=true
NoNewPrivileges=true

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=cc-wrapper

[Install]
WantedBy=multi-user.target
EOF

# Reload systemd
sudo systemctl daemon-reload

echo ""
echo "=== Setup Complete ==="
echo ""
echo "To start the service:"
echo "  sudo systemctl start cc-wrapper"
echo ""
echo "To enable on boot:"
echo "  sudo systemctl enable cc-wrapper"
echo ""
echo "To check status:"
echo "  sudo systemctl status cc-wrapper"
echo ""
echo "To view logs:"
echo "  sudo journalctl -u cc-wrapper -f"
