#!/data/data/com.termux/files/usr/bin/bash
set -e

echo "Installiere Hermes in Termux über den offiziellen Installer …"
pkg update -y
pkg install -y curl git python
curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash

echo "Fertig. Danach in Termux typischerweise:"
echo "  source ~/.bashrc"
echo "  hermes setup"
echo "  hermes"
