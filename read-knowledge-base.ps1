param(
  [Parameter(Mandatory = $true)]
  [string]$DatabasePath,

  [Parameter(Mandatory = $true)]
  [string]$SnapshotPath
)

$ErrorActionPreference = "Stop"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $utf8NoBom
$OutputEncoding = $utf8NoBom

function Convert-DbValue {
  param($Value)

  if ($null -eq $Value -or [System.DBNull]::Value.Equals($Value)) {
    return ""
  }

  $text = [string]$Value
  return ($text -replace '[\x00-\x08\x0B\x0C\x0E-\x1F]', ' ')
}

if (-not (Test-Path -LiteralPath $DatabasePath)) {
  throw "Database file not found: $DatabasePath"
}

$snapshotDirectory = Split-Path -Parent $SnapshotPath
New-Item -ItemType Directory -Force -Path $snapshotDirectory | Out-Null
Copy-Item -LiteralPath $DatabasePath -Destination $SnapshotPath -Force

$connection = New-Object System.Data.OleDb.OleDbConnection(
  "Provider=Microsoft.ACE.OLEDB.12.0;Data Source=$SnapshotPath;Mode=Read;"
)

try {
  $connection.Open()
  $command = $connection.CreateCommand()
  $command.CommandText = "SELECT ID, Category, Title, Content, Keywords FROM knowledge_base ORDER BY ID"
  $reader = $command.ExecuteReader()
  $rows = @()

  while ($reader.Read()) {
    $rows += [PSCustomObject]@{
      id = [int]$reader["ID"]
      category = Convert-DbValue $reader["Category"]
      title = Convert-DbValue $reader["Title"]
      content = Convert-DbValue $reader["Content"]
      keywords = Convert-DbValue $reader["Keywords"]
    }
  }

  $reader.Close()
  $rows | ConvertTo-Json -Depth 4 -Compress
}
finally {
  if ($reader) {
    $reader.Dispose()
  }

  $connection.Close()
  $connection.Dispose()
}
