param(
  [Parameter(Mandatory = $true)][string]$Source,
  [Parameter(Mandatory = $true)][string]$OutputDirectory
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$sourceBitmap = [System.Drawing.Bitmap]::new($Source)
try {
  $sizes = @(16, 24, 32, 48, 64, 128, 256)
  foreach ($size in $sizes) {
    $frame = [System.Drawing.Bitmap]::new($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    try {
      $graphics = [System.Drawing.Graphics]::FromImage($frame)
      try {
        $graphics.Clear([System.Drawing.Color]::Transparent)
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
        $graphics.DrawImage($sourceBitmap, 0, 0, $size, $size)
      } finally { $graphics.Dispose() }
      $frame.Save((Join-Path $OutputDirectory ("icon-{0}.png" -f $size)), [System.Drawing.Imaging.ImageFormat]::Png)
    } finally { $frame.Dispose() }
  }
} finally { $sourceBitmap.Dispose() }
