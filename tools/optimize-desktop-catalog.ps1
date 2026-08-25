[CmdletBinding()]
param(
  [string]$DistRoot = '',
  [int]$ExpectedCount = 5457,
  [int]$SourceWidth = 832,
  [int]$SourceHeight = 1216,
  [int]$TargetWidth = 416,
  [int]$TargetHeight = 608,
  [int]$Quality = 82
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($DistRoot)) {
  $DistRoot = Join-Path $PSScriptRoot '..\dist'
}

function Stop-Optimizer([string]$Message) {
  throw "Desktop catalog optimizer: $Message"
}

try {
  Add-Type -AssemblyName System.Drawing
} catch {
  Stop-Optimizer "Windows System.Drawing is unavailable. $($_.Exception.Message)"
}

$resolvedDist = [System.IO.Path]::GetFullPath($DistRoot)
$characterDir = Join-Path $resolvedDist 'catalog\cards\character\danbooru-character-tags-v4.5'
if (-not (Test-Path -LiteralPath $characterDir -PathType Container)) {
  Stop-Optimizer "expected character directory was not found: $characterDir"
}
if ($ExpectedCount -lt 1 -or $TargetWidth -lt 1 -or $TargetHeight -lt 1 -or $Quality -lt 1 -or $Quality -gt 100) {
  Stop-Optimizer "invalid optimizer parameters"
}

$files = @(Get-ChildItem -LiteralPath $characterDir -File -Filter '*.jpg' | Sort-Object Name)
if ($files.Count -ne $ExpectedCount) {
  Stop-Optimizer "expected $ExpectedCount character JPGs in $characterDir, found $($files.Count)"
}
$staleTemps = @(Get-ChildItem -LiteralPath $characterDir -File -Filter '*.jpg.optimizing' -ErrorAction SilentlyContinue)
if ($staleTemps.Count -gt 0) {
  Stop-Optimizer "found $($staleTemps.Count) stale optimizer temporary files in $characterDir"
}

$jpegCodec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object MimeType -eq 'image/jpeg' | Select-Object -First 1
if ($null -eq $jpegCodec) {
  Stop-Optimizer 'the Windows JPEG encoder is unavailable'
}
$qualityEncoder = [System.Drawing.Imaging.Encoder]::Quality
$processed = 0
$started = Get-Date

foreach ($file in $files) {
  $source = $null
  $target = $null
  $graphics = $null
  $parameters = $null
  $qualityParameter = $null
  $tempPath = "$($file.FullName).optimizing"
  try {
    $source = [System.Drawing.Image]::FromFile($file.FullName)
    if ($source.Width -ne $SourceWidth -or $source.Height -ne $SourceHeight) {
      Stop-Optimizer "unexpected source dimensions for $($file.Name): $($source.Width)x$($source.Height), expected ${SourceWidth}x${SourceHeight}"
    }

    $target = [System.Drawing.Bitmap]::new($TargetWidth, $TargetHeight, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
    $graphics = [System.Drawing.Graphics]::FromImage($target)
    $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graphics.DrawImage($source, [System.Drawing.Rectangle]::new(0, 0, $TargetWidth, $TargetHeight), 0, 0, $source.Width, $source.Height, [System.Drawing.GraphicsUnit]::Pixel)

    $parameters = [System.Drawing.Imaging.EncoderParameters]::new(1)
    $qualityParameter = [System.Drawing.Imaging.EncoderParameter]::new($qualityEncoder, [long]$Quality)
    $parameters.Param[0] = $qualityParameter
    $target.Save($tempPath, $jpegCodec, $parameters)
  } catch {
    if (Test-Path -LiteralPath $tempPath) { Remove-Item -LiteralPath $tempPath -Force -ErrorAction SilentlyContinue }
    Stop-Optimizer "failed to decode, resize, or encode $($file.Name): $($_.Exception.Message)"
  } finally {
    if ($qualityParameter) { $qualityParameter.Dispose() }
    if ($parameters) { $parameters.Dispose() }
    if ($graphics) { $graphics.Dispose() }
    if ($target) { $target.Dispose() }
    if ($source) { $source.Dispose() }
  }

  try {
    $check = [System.Drawing.Image]::FromFile($tempPath)
    try {
      if ($check.Width -ne $TargetWidth -or $check.Height -ne $TargetHeight) {
        Stop-Optimizer "encoded dimensions for $($file.Name) are $($check.Width)x$($check.Height), expected ${TargetWidth}x${TargetHeight}"
      }
      if ($check.RawFormat.Guid -ne [System.Drawing.Imaging.ImageFormat]::Jpeg.Guid) {
        Stop-Optimizer "encoded file is not JPEG: $($file.Name)"
      }
    } finally {
      $check.Dispose()
    }
    Move-Item -LiteralPath $tempPath -Destination $file.FullName -Force
  } catch {
    if (Test-Path -LiteralPath $tempPath) { Remove-Item -LiteralPath $tempPath -Force -ErrorAction SilentlyContinue }
    Stop-Optimizer "failed to validate or replace $($file.Name): $($_.Exception.Message)"
  }

  $processed++
  if (($processed % 250) -eq 0 -or $processed -eq $files.Count) {
    Write-Host "Desktop catalog optimizer: $processed/$($files.Count) character JPGs resized"
  }
}

$finalFiles = @(Get-ChildItem -LiteralPath $characterDir -File -Filter '*.jpg')
if ($finalFiles.Count -ne $ExpectedCount) {
  Stop-Optimizer "destination count changed during optimization: expected $ExpectedCount, found $($finalFiles.Count)"
}
foreach ($file in $finalFiles) {
  $image = $null
  try {
    $image = [System.Drawing.Image]::FromFile($file.FullName)
    if ($image.Width -ne $TargetWidth -or $image.Height -ne $TargetHeight) {
      Stop-Optimizer "final dimensions for $($file.Name) are $($image.Width)x$($image.Height), expected ${TargetWidth}x${TargetHeight}"
    }
    if ($image.RawFormat.Guid -ne [System.Drawing.Imaging.ImageFormat]::Jpeg.Guid) {
      Stop-Optimizer "final file is not JPEG: $($file.Name)"
    }
  } catch {
    Stop-Optimizer "final JPEG validation failed for $($file.Name): $($_.Exception.Message)"
  } finally {
    if ($image) { $image.Dispose() }
  }
}

$elapsed = ((Get-Date) - $started).TotalSeconds
Write-Host ("Desktop catalog optimizer: completed {0} files at {1}x{2}, JPEG quality {3} in {4:N1}s" -f $processed, $TargetWidth, $TargetHeight, $Quality, $elapsed)
