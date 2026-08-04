# 销售开单 + 幂等 + 库存流水 端到端冒烟测试（F7）
#
# 覆盖链路：
#   1. 注册店主（带 inviteCode）→ 拿 token
#   2. 建款 + 1 个 SKU（initialStock=10）
#   3. 用同一 opId 提交销售两次 → 验证幂等（返回同一 orderId，库存只扣一次）
#   4. GET /sales/:id 验证单据详情
#   5. GET /skus/by-barcode/:barcode 验证库存已减 3（10 - 3）
#
# 用法（需服务已起在 localhost:3000，且 .env 里 REGISTER_CODE 与本脚本 $InviteCode 一致）：
#   pwsh -File tools/e2e-sale-flow.ps1
# 可选参数：-Base / -InviteCode / -PhonePrefix
#
# opId 用时间戳生成，重复运行互不冲突（每次新单）。

param(
  [string]$Base = "http://localhost:3000/api/v1",
  [string]$InviteCode = "dev-invite-code",
  [string]$PhonePrefix = "139"
)

$ErrorActionPreference = "Stop"

# ---- HTTP 辅助 ----
function Invoke-Json($method, $path, $body, $token) {
  $headers = @{ "Content-Type" = "application/json" }
  if ($token) { $headers["Authorization"] = "Bearer $token" }
  $uri = "$Base$path"
  if ($null -ne $body) {
    $jsonBody = $body | ConvertTo-Json -Depth 8
    $resp = Invoke-WebRequest -Method $method -Uri $uri -Headers $headers -Body $jsonBody -UseBasicParsing
  } else {
    $resp = Invoke-WebRequest -Method $method -Uri $uri -Headers $headers -UseBasicParsing
  }
  # 204 等空响应直接返回空
  if ($resp.Content -and $resp.Content.Length -gt 0) {
    return $resp.Content | ConvertFrom-Json
  }
  return $null
}

$pass = 0
$fail = 0
function Check($name, $cond, $detail) {
  if ($cond) {
    Write-Host "  [PASS] $name  $detail" -ForegroundColor Green
    $script:pass++
  } else {
    Write-Host "  [FAIL] $name  $detail" -ForegroundColor Red
    $script:fail++
  }
}

Write-Host "=== 销售开单幂等流水 E2E ===" -ForegroundColor Cyan
Write-Host "目标服务: $Base"

# 1. 注册店主
$phone = $PhonePrefix + (Get-Random -Minimum 10000000 -Maximum 99999999)
try {
  $reg = Invoke-Json "Post" "/auth/register" @{
    phone      = $phone
    password   = "pass1234"
    name       = "Owner"
    shopName   = "E2E-Sale-Shop"
    inviteCode = $InviteCode
  } $null
  $token = $reg.token
  Write-Host "1. 注册 OK  phone=$phone  role=$($reg.user.role)"
} catch {
  Write-Host "注册失败：$_  —— 请确认服务已起、REGISTER_CODE 与 .env 一致" -ForegroundColor Red
  exit 1
}

# 2. 建款（1 SKU，库存 10）
$prod = Invoke-Json "Post" "/products" @{
  name = "E2E-TEE"
  skus = @(@{ color = "BLACK"; size = "L"; costPrice = 3000; salePrice = 9900; initialStock = 10 })
} $token
$sid = $prod.skus[0].id
$barcode = $prod.skus[0].barcode
Check "建款" ($prod.name -eq "E2E-TEE") "id=$($prod.id) barcode=$barcode stock=$($prod.skus[0].stock)"

# 3. 提交销售（同一 opId 两次）
$opId = "e2e-sale-" + [int64](Get-Date -UFormat %s)
$saleBody = @{
  opId  = $opId
  items = @(@{ skuId = $sid; quantity = 3; price = 9900 })
}
$order1 = Invoke-Json "Post" "/sales" $saleBody $token
$order2 = Invoke-Json "Post" "/sales" $saleBody $token
Check "幂等：同 opId 两次返回同 orderId" ($order1.id -eq $order2.id) "orderId=$($order1.id)"
Check "单据总额 = 9900 * 3" ($order1.totalAmount -eq 29700) "totalAmount=$($order1.totalAmount)"

# 4. 单据详情
$detail = Invoke-Json "Get" "/sales/$($order1.id)" $token
Check "详情：含 1 行明细，件数=3" ($detail.items.Count -eq 1 -and $detail.items[0].quantity -eq 3) "itemCount=$($detail.itemCount)"

# 5. 库存校验：扫码查 SKU，库存应 = 10 - 3 = 7
$sku = Invoke-Json "Get" "/skus/by-barcode/$barcode" $token
Check "库存扣减：10 - 3 = 7" ($sku.stock -eq 7) "实际 stock=$($sku.stock)"

# ---- 汇总 ----
Write-Host ""
Write-Host "================ 汇总 ================"
Write-Host "  PASS: $pass" -ForegroundColor Green
Write-Host "  FAIL: $fail" -ForegroundColor $(if ($fail -gt 0) { "Red" } else { "Gray" })
if ($fail -gt 0) {
  Write-Host "  结果: FAIL" -ForegroundColor Red
  exit 1
} else {
  Write-Host "  结果: ALL PASS" -ForegroundColor Green
  exit 0
}
