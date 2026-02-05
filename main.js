/*
  Node.js version of SKPort Auto Check-in
  - Expects Node 18+ (global fetch available). Use Dockerfile provided which uses node:18-alpine.
  - Configuration is provided via .env. See .env.example for format.
*/

"use strict"
try {
    require("dotenv").config()
} catch (e) {
    console.warn("dotenv not installed; proceeding using environment variables provided by Docker or the host environment")
}
const { createHmac, createHash } = require("crypto")

// Environment / configuration
const ENABLE_DISCORD_NOTIFY = (process.env.ENABLE_DISCORD_NOTIFY || "true") === "true"
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || ""
const DISCORD_USER_ID = process.env.DISCORD_USER_ID || ""
const RUN_ONCE = (process.env.RUN_ONCE || "false") === "true"

// PROFILES must be a JSON array string in the env. Example in .env.example
let profiles = []
if (process.env.PROFILES) {
    try {
        profiles = JSON.parse(process.env.PROFILES)
        if (!Array.isArray(profiles)) throw new Error("PROFILES must be a JSON array")
    } catch (err) {
        console.error("Failed to parse PROFILES from .env:", err.message)
        process.exit(1)
    }
} else {
    console.error("PROFILES not set in .env. See .env.example")
    process.exit(1)
}

const URLS = {
    refresh: "https://zonai.skport.com/web/v1/auth/refresh",
    attendance: "https://zonai.skport.com/web/v1/game/endfield/attendance",
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function generateSign(path, body, timestamp, token, platform, vName) {
    let str = path + body + timestamp
    const headerJson = `{"platform":"${platform}","timestamp":"${timestamp}","dId":"","vName":"${vName}"}`
    str += headerJson

    const hmacHex = createHmac("sha256", token).update(str).digest("hex")
    const md5Hex = createHash("md5").update(hmacHex).digest("hex")
    return md5Hex
}

async function refreshToken(profile) {
    const { cred, platform, vName } = profile
    const headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        Accept: "application/json, text/plain, */*",
        cred,
        platform,
        vName,
        Origin: "https://game.skport.com",
        Referer: "https://game.skport.com/",
    }

    const res = await fetch(URLS.refresh, { method: "GET", headers })
    const text = await res.text()
    let json = null
    try {
        json = JSON.parse(text)
    } catch (e) {
        throw new Error(`Invalid JSON from refresh: ${text}`)
    }

    if (json.code === 0 && json.data && json.data.token) return json.data.token
    throw new Error(`Refresh Failed (Code: ${json.code}, Msg: ${json.message || "no message"})`)
}

async function autoClaimFunction(profile) {
    const { cred, token, skGameRole, platform, vName, accountName } = profile
    const timestamp = Math.floor(Date.now() / 1000).toString()
    const path = "/web/v1/game/endfield/attendance"
    const body = ""

    const sign = generateSign(path, body, timestamp, token, platform, vName)

    const headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        Accept: "application/json, text/plain, */*",
        "Content-Type": "application/json",
        "sk-language": "en_US",
        "sk-game-role": skGameRole,
        cred,
        platform,
        vName,
        timestamp,
        sign,
        Origin: "https://game.skport.com",
        Referer: "https://game.skport.com/",
    }

    const result = { name: accountName, success: false, status: "", rewards: "" }

    try {
        const res = await fetch(URLS.attendance, { method: "POST", headers, body })
        const text = await res.text()
        let json = null
        try {
            json = JSON.parse(text)
        } catch (e) {
            throw new Error(`Invalid JSON from attendance: ${text}`)
        }

        console.log(`[${accountName}] API Response: ${JSON.stringify(json, null, 2)}`)

        if (json.code === 0) {
            result.success = true
            result.status = `Check-in Successful. ${json.message || ""}`
            if (json.data && json.data.awardIds) {
                const awards = (json.data.awardIds || [])
                    .map((award) => {
                        const resource = json.data.resourceInfoMap ? json.data.resourceInfoMap[award.id] : null
                        return resource ? `${resource.name} x${resource.count}` : award.id || "Unknown Item"
                    })
                    .join("\n")
                result.rewards = awards || "None"
            } else {
                result.rewards = "No detailed reward info."
            }
        } else if (json.code === 10001) {
            result.success = true
            result.status = `Already Checked In. ${json.message || ""}`
            result.rewards = "Nothing to claim"
        } else {
            result.success = false
            result.status = `Error (Code: ${json.code})`
            result.rewards = json.message || "Unknown Error"
        }
    } catch (err) {
        result.success = false
        result.status = "💥 Exception"
        result.rewards = err.message
        console.error(err)
    }

    return result
}

async function sendDiscordEmbed(results) {
    if (!ENABLE_DISCORD_NOTIFY || !DISCORD_WEBHOOK_URL) return

    const allSuccess = results.every((r) => r.success)
    const embedColor = allSuccess ? 5763719 : 15548997

    const fields = results.map((r) => ({ name: r.name, value: `**Status:** ${r.status}\n**Rewards:**\n${r.rewards || "None"}`, inline: true }))

    const payload = {
        username: "SKPort Auto Check In",
        avatar_url: "https://i.imgur.com/ZC1qsD5.png",
        embeds: [{ title: "Check-in completed!", color: embedColor, fields, footer: { text: `Time: ${new Date().toLocaleString("en-US", { timeZone: "UTC" })} (UTC)` } }],
    }

    if (!allSuccess && DISCORD_USER_ID) payload.content = `<@${DISCORD_USER_ID}> Script encountered an error, please check logs!`

    try {
        await fetch(DISCORD_WEBHOOK_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
        console.log("Discord report sent")
    } catch (err) {
        console.error("Failed to send Discord webhook:", err.message)
    }
}

async function runOnce() {
    console.log("Starting run...")
    const results = []

    for (let i = 0; i < profiles.length; i++) {
        const profile = Object.assign({}, profiles[i])
        console.log(`[${profile.accountName}] Working...`)
        try {
            profile.token = await refreshToken(profile)
            console.log(`[${profile.accountName}] Token refreshed`)
            const res = await autoClaimFunction(profile)
            results.push(res)
        } catch (err) {
            console.error(`[${profile.accountName}] Error:`, err.message)
            results.push({ name: profile.accountName || "Unknown", success: false, status: "Error", rewards: err.message })
        }

        await sleep(1000)
    }

    if (ENABLE_DISCORD_NOTIFY && DISCORD_WEBHOOK_URL) await sendDiscordEmbed(results)
    console.log("Run complete")
}

// Orchestrate: run once at startup
;(async () => {
    await runOnce()
    process.exit(0)
})()
