-- CrowdSec Bouncer for OpenResty/Nginx
-- Queries CrowdSec LAPI to check if client IP should be blocked

local _M = {}

-- Configuration (loaded from environment variables at init time)
local api_url = nil
local api_key = nil
local enabled = false
local cache_ttl = 60  -- Cache decisions for 60 seconds

-- Paths to exclude from bouncer checks
local excluded_paths = {
    ["/health"] = true,
    ["/metrics"] = true,
    ["/nginx_status"] = true,
    ["/ready"] = true,
    ["/live"] = true,
}

-- Initialize the bouncer (called once at nginx startup)
function _M.init()
    api_url = os.getenv("CROWDSEC_LAPI_URL") or "http://crowdsec:8080"
    api_key = os.getenv("CROWDSEC_BOUNCER_API_KEY")

    if api_key and api_key ~= "" then
        enabled = true
        ngx.log(ngx.NOTICE, "[CrowdSec] Bouncer enabled - LAPI: ", api_url)
    else
        enabled = false
        ngx.log(ngx.WARN, "[CrowdSec] Bouncer disabled - CROWDSEC_BOUNCER_API_KEY not set")
    end
end

-- Check if an IP is banned by querying CrowdSec LAPI
-- Returns: true if banned, false otherwise
local function check_ip_banned(ip)
    if not enabled then
        return false
    end

    local ok, result = pcall(function()
        -- Query CrowdSec LAPI for decisions about this IP
        local http = require("resty.http")
        local httpc = http.new()
        httpc:set_timeout(500)  -- 500ms timeout

        local res, err = httpc:request_uri(api_url .. "/v1/decisions", {
            method = "GET",
            query = "ip=" .. ip,
            headers = {
                ["X-Api-Key"] = api_key,
                ["Content-Type"] = "application/json",
            },
        })

        if not res then
            ngx.log(ngx.ERR, "[CrowdSec] Failed to query LAPI: ", err)
            return false  -- Fail open - don't block if we can't reach LAPI
        end

        if res.status == 200 then
            -- Check if response contains any decisions
            local cjson = require("cjson.safe")
            local decisions, decode_err = cjson.decode(res.body)

            if decode_err then
                ngx.log(ngx.ERR, "[CrowdSec] Failed to decode response: ", decode_err)
                return false
            end

            if decisions and type(decisions) == "table" and #decisions > 0 then
                -- IP has active ban decisions
                local decision = decisions[1]
                ngx.log(ngx.INFO, "[CrowdSec] Blocking IP ", ip, " - reason: ",
                        decision.scenario or "unknown", ", duration: ", decision.duration or "unknown")
                return true
            end
        elseif res.status == 403 then
            ngx.log(ngx.ERR, "[CrowdSec] API key rejected (403) - check CROWDSEC_BOUNCER_API_KEY")
            return false
        elseif res.status ~= 200 then
            ngx.log(ngx.ERR, "[CrowdSec] LAPI returned status ", res.status)
            return false
        end

        return false
    end)

    if not ok then
        ngx.log(ngx.ERR, "[CrowdSec] check_ip_banned error (failing open): ", tostring(result))
        return false
    end

    return result
end

-- Main access check function (called for each request via access_by_lua)
function _M.check()
    if not enabled then
        return  -- Bouncer not enabled, allow all requests
    end

    local ok, err = pcall(function()
        -- Skip excluded paths
        local path = ngx.var.uri
        if excluded_paths[path] then
            return
        end

        -- Get client IP (handles X-Forwarded-For via real_ip module)
        local ip = ngx.var.remote_addr
        if not ip then
            return
        end

        -- Check cache first
        local cache = ngx.shared.crowdsec_cache
        if cache then
            local cached_decision = cache:get(ip)
            if cached_decision ~= nil then
                if cached_decision == "ban" then
                    ngx.log(ngx.INFO, "[CrowdSec] Blocking IP ", ip, " (cached)")
                    ngx.status = 403
                    ngx.header["Content-Type"] = "application/json"
                    ngx.say('{"error":"Forbidden","message":"Access denied by security policy"}')
                    ngx.exit(403)
                    return
                end
                return  -- Cached as allowed
            end
        end

        -- Query CrowdSec LAPI
        local banned = check_ip_banned(ip)

        -- Cache the result
        if cache then
            local decision = banned and "ban" or "allow"
            cache:set(ip, decision, cache_ttl)
        end

        -- Block if banned
        if banned then
            ngx.status = 403
            ngx.header["Content-Type"] = "application/json"
            ngx.say('{"error":"Forbidden","message":"Access denied by security policy"}')
            ngx.exit(403)
            return
        end
    end)

    if not ok then
        ngx.log(ngx.ERR, "[CrowdSec] access check error (failing open): ", tostring(err))
    end
end

return _M
