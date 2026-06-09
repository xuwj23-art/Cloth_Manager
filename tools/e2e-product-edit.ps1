$ErrorActionPreference = "Stop"
$base = "http://localhost:3000/api/v1"
$phone = "139" + (Get-Random -Minimum 10000000 -Maximum 99999999)

function Post($path, $body, $token) {
  $headers = @{ "Content-Type" = "application/json" }
  if ($token) { $headers["Authorization"] = "Bearer $token" }
  return Invoke-RestMethod -Method Post -Uri "$base$path" -Headers $headers -Body ($body | ConvertTo-Json -Depth 8)
}
function Patch($path, $body, $token) {
  $headers = @{ "Content-Type" = "application/json"; "Authorization" = "Bearer $token" }
  return Invoke-RestMethod -Method Patch -Uri "$base$path" -Headers $headers -Body ($body | ConvertTo-Json -Depth 8)
}
function Get_($path, $token) {
  $headers = @{ "Authorization" = "Bearer $token" }
  return Invoke-RestMethod -Method Get -Uri "$base$path" -Headers $headers
}

# 1. 娉ㄥ唽搴椾富
$reg = Post "/auth/register" @{ phone = $phone; password = "pass1234"; name = "Owner"; shopName = "Shop" } $null
$token = $reg.token
Write-Host "1. register OK, role=$($reg.user.role)"

# 2. 寤烘。锛? 涓?SKU锛屽簱瀛?2
$prod = Post "/products" @{
  name = "TEE"
  skus = @(@{ color = "WHITE"; size = "M"; costPrice = 2000; salePrice = 5900; initialStock = 2 })
} $token
$prodId = $prod.id
$sid = $prod.skus[0].id
$barcode = $prod.skus[0].barcode
Write-Host "2. create OK, stock=$($prod.skus[0].stock), barcode=$barcode"

# 3. 缂栬緫锛氭敼鍚?+ 鏀瑰敭浠?6900 + 鐩樼偣搴撳瓨=5
$upd = Patch "/products/$prodId" @{
  name = "TEE-PRO"
  skus = @(@{ id = $sid; salePrice = 6900; stock = 5 })
} $token
if ($upd.name -ne "TEE-PRO" -or $upd.skus[0].salePrice -ne 6900 -or $upd.skus[0].stock -ne 5) {
  throw "3. FAIL edit: name=$($upd.name) price=$($upd.skus[0].salePrice) stock=$($upd.skus[0].stock)"
}
Write-Host "3. edit OK -> name=$($upd.name) price=$($upd.skus[0].salePrice) stock=$($upd.skus[0].stock)"

# 4. 鍗栧厜 5 浠?-> 搴撳瓨 0 -> 鑷姩褰掓。
$null = Post "/sales" @{
  opId = [guid]::NewGuid().ToString()
  items = @(@{ skuId = $sid; quantity = 5 })
} $token
$active = Get_ "/products?scope=active" $token
$archived = Get_ "/products?scope=archived" $token
$inActive = @($active | Where-Object { $_.id -eq $prodId }).Count
$inArchived = @($archived | Where-Object { $_.id -eq $prodId }).Count
if ($inActive -ne 0 -or $inArchived -ne 1) {
  throw "4. FAIL auto-archive: active=$inActive archived=$inArchived"
}
Write-Host "4. sell-out auto-archive OK (active=$inActive, archived=$inArchived)"

# 5. 鎵嬪姩鎭㈠鍦ㄥ敭
$null = Post "/products/$prodId/unarchive" @{} $token
$active2 = Get_ "/products?scope=active" $token
$inActive2 = @($active2 | Where-Object { $_.id -eq $prodId }).Count
if ($inActive2 -ne 1) { throw "5. FAIL unarchive: active=$inActive2" }
Write-Host "5. unarchive OK (active=$inActive2)"

# 6. 鎵嬪姩涓嬫灦
$null = Post "/products/$prodId/archive" @{} $token
$archived2 = Get_ "/products?scope=archived" $token
$inArchived2 = @($archived2 | Where-Object { $_.id -eq $prodId }).Count
if ($inArchived2 -ne 1) { throw "6. FAIL archive: archived=$inArchived2" }
Write-Host "6. manual archive OK (archived=$inArchived2)"

Write-Host "ALL PASS"

