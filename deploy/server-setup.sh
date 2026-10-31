#!/usr/bin/env bash
# One-time setup of a fresh Ubuntu 22.04/24.04 server for OrigamiEvolve.
# Run as a user with sudo:  bash deploy/server-setup.sh
set -euo pipefail

echo "==> Installing Docker Engine and the Compose plugin"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sudo sh
fi
sudo usermod -aG docker "$USER"

echo "==> Firewall: allow SSH, HTTP and HTTPS only"
sudo apt-get update -y
sudo apt-get install -y ufw
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 443/udp
sudo ufw --force enable

echo "==> 2 GB swap file (helps small servers while building images)"
if ! swapon --show | grep -q /swapfile; then
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

echo
echo "Done. Log out and back in (so the docker group applies), then follow deploy/DEPLOY.md step 4."
