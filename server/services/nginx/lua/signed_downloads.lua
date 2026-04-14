-- Signed Downloads for OpenResty/Nginx
-- Validates HMAC-signed download URLs for release binaries
-- Allows auto-updater YAML metadata and electron-updater binary downloads through

local _M = {}

local ffi = require("ffi")
local C = ffi.C

ffi.cdef[[
  typedef struct evp_md_st EVP_MD;
  const EVP_MD *EVP_sha256(void);
  unsigned char *HMAC(const EVP_MD *evp_md, const void *key, int key_len,
                      const unsigned char *d, size_t n, unsigned char *md,
                      unsigned int *md_len);
]]

local signing_key = nil
local enabled = false

-- Initialize the module (called once at nginx startup)
function _M.init()
    signing_key = os.getenv("RELEASES_SIGNING_KEY")

    if signing_key and signing_key ~= "" then
        enabled = true
        ngx.log(ngx.NOTICE, "[SignedDownloads] Enabled - signing key configured")
    else
        enabled = false
        ngx.log(ngx.WARN, "[SignedDownloads] Disabled - RELEASES_SIGNING_KEY not set")
    end
end

-- Convert binary string to hex
local function to_hex(s)
    return (s:gsub('.', function(c)
        return string.format('%02x', string.byte(c))
    end))
end

-- Compute HMAC-SHA256 and return hex-encoded first 32 chars
local function hmac_sha256_hex(key, data)
    local md_len = ffi.new("unsigned int[1]")
    local buf = ffi.new("unsigned char[32]")  -- SHA-256 = 32 bytes

    local result = C.HMAC(C.EVP_sha256(), key, #key, data, #data, buf, md_len)
    if result == nil then
        return nil
    end

    local hex = to_hex(ffi.string(buf, md_len[0]))
    return hex:sub(1, 32)
end

-- Main access check function for binary download requests
function _M.check()
    if not enabled then
        return  -- Module not enabled, allow all requests (fail open)
    end

    local ok, err = pcall(function()
        local uri = ngx.var.uri

        -- Allow YAML files (auto-updater metadata)
        if uri:match("%.[yY][mM][lL]$") or uri:match("%.[yY][aA][mM][lL]$") then
            return
        end

        -- Allow Electron auto-updater User-Agents (binary downloads)
        -- electron-updater uses "electron-updater" for HEAD, "electron-builder" for GET downloads
        local ua = ngx.var.http_user_agent or ""
        if ua:find("electron-updater", 1, true)
            or ua:find("electron-builder", 1, true)
            or ua:find("Electron/", 1, true) then
            return
        end

        -- Check for signed URL parameters
        local args = ngx.req.get_uri_args()
        local expires = args.expires
        local sig = args.sig

        if not expires or not sig then
            ngx.log(ngx.WARN, "[SignedDownloads] Missing expires/sig params for: ", uri)
            ngx.status = 403
            ngx.header["Content-Type"] = "text/plain"
            ngx.say("Forbidden: signed URL required")
            ngx.exit(403)
            return
        end

        -- Check expiry
        local expires_num = tonumber(expires)
        if not expires_num then
            ngx.log(ngx.WARN, "[SignedDownloads] Invalid expires value: ", expires)
            ngx.status = 403
            ngx.header["Content-Type"] = "text/plain"
            ngx.say("Forbidden: invalid signature")
            ngx.exit(403)
            return
        end

        local now = ngx.time()
        if now > expires_num then
            ngx.log(ngx.INFO, "[SignedDownloads] Expired URL for: ", uri,
                     " (expired ", now - expires_num, "s ago)")
            ngx.status = 403
            ngx.header["Content-Type"] = "text/plain"
            ngx.say("Forbidden: download link expired")
            ngx.exit(403)
            return
        end

        -- Validate HMAC signature
        -- Decode the URI path for signing (matches how portal-bff generates the signature)
        local decoded_uri = ngx.unescape_uri(uri)
        local sign_data = decoded_uri .. ":" .. expires
        local expected_sig = hmac_sha256_hex(signing_key, sign_data)

        if not expected_sig then
            ngx.log(ngx.ERR, "[SignedDownloads] HMAC computation failed")
            ngx.status = 500
            ngx.header["Content-Type"] = "text/plain"
            ngx.say("Internal server error")
            ngx.exit(500)
            return
        end

        if sig ~= expected_sig then
            ngx.log(ngx.WARN, "[SignedDownloads] Invalid signature for: ", uri,
                     " (got=", sig, " expected=", expected_sig, ")")
            ngx.status = 403
            ngx.header["Content-Type"] = "text/plain"
            ngx.say("Forbidden: invalid signature")
            ngx.exit(403)
            return
        end

        -- Signature valid, allow request
    end)

    if not ok then
        ngx.log(ngx.ERR, "[SignedDownloads] access check error (failing open): ", tostring(err))
    end
end

return _M
