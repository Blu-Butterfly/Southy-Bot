$ErrorActionPreference = "Stop"

$env:SOUTHYBOT_HOST = "0.0.0.0"
$env:SOUTHYBOT_PORT = "4173"

python .\server.py
