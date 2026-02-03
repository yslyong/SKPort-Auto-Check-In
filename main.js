/** 
 * Get cred and skGameRole from inspect element and in Network tab, 
 * Collect the value in the POST header for "attendance" request 
**/ 

/** --- CONFIGURATION START --- **/


// API Endpoints
const URLS = {
    refresh: 'https://zonai.skport.com/web/v1/auth/refresh',
    attendance: 'https://zonai.skport.com/web/v1/game/endfield/attendance'
};

async function main() {
    let results = [];

    // Process each profile sequentially
    for (let i = 0; i < profiles.length; i++) {
        let profile = profiles[i];

        console.log(`[${profile.accountName}] Checking credentials and performing check-in...`);
        
        try {
            // 1. Attempt to refresh the Token
            // This ensures we have a valid key for signing the request and bypasses login CAPTCHA.
            const newToken = refreshToken(profile);
            

            profile.token = newToken;
            console.log(`[${profile.accountName}] Token refreshed successfully.`);
            
            // 2. Perform Check-in
            let claimResult = autoClaimFunction(profile);
            results.push(claimResult);

        } catch (e) {
            console.error(`[${profile.accountName}] Error: ${e.message}`);
            results.push({
                name: profile.accountName,
                success: false,
                status: "⛔ Auth/Refresh Failed",
                rewards: "Please update your 'cred': " + e.message
            });
        }
        
        // Sleep for 1 second to avoid rate limiting
        Utilities.sleep(1000); 
    }
    
    if (ENABLE_DISCORD_NOTIFY && DISCORD_WEBHOOK_URL) {
        sendDiscordEmbed(results);
    }
}

/**
 * Exchanges the existing 'cred' for a new 'token'.
 * This is the key to maintaining a persistent session without manual login.
 */
function refreshToken(profile) {
    const { cred, platform, vName } = profile;
    
    const header = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'cred': cred, 
        'platform': platform,
        'vName': vName,
        'Origin': 'https://game.skport.com',
        'Referer': 'https://game.skport.com/'
    };

    const options = {
        method: 'GET',
        headers: header,
        muteHttpExceptions: true
    };

    const response = UrlFetchApp.fetch(URLS.refresh, options);
    const json = JSON.parse(response.getContentText());

    if (json.code === 0 && json.data && json.data.token) {
        return json.data.token;
    } else {
        // If code is not 0, the cred might be expired.
        if (json.code !== 0) {
            throw new Error(`Refresh Failed (Code: ${json.code}, Msg: ${json.message})`);
        }
        return null;
    }
}

/**
 * Main Check-in Function
 */
function autoClaimFunction(profile) {
    const { cred, token, skGameRole, platform, vName, accountName } = profile;
    
    // 1. Prepare Parameters
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const path = "/web/v1/game/endfield/attendance"; 
    const body = ""; 
    
    // 2. Generate Signature
    const sign = generateSign(path, body, timestamp, token, platform, vName);

    const header = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Content-Type': 'application/json',
        'sk-language': 'en_US', // Changed to en_US for English response (if supported), or keep zh_Hant
        'sk-game-role': skGameRole,
        'cred': cred, 
        'platform': platform,
        'vName': vName,
        'timestamp': timestamp,
        'sign': sign, 
        'Origin': 'https://game.skport.com',
        'Referer': 'https://game.skport.com/'
    };

    const options = {
        method: 'POST',
        headers: header,
        muteHttpExceptions: true,
        payload: body
    };

    let result = {
        name: accountName,
        success: false,
        status: "",
        rewards: ""
    };

    try {
        const response = UrlFetchApp.fetch(URLS.attendance, options);
        const json = JSON.parse(response.getContentText());

        console.log(`[${accountName}] API Response: ${JSON.stringify(json, null, 2)}`);
        
        if (json.code === 0) {
            result.success = true;
            result.status = `Check-in Successful. ${json.message || ''}`;
            
            if (json.data && json.data.awardIds) {
                const awards = json.data.awardIds.map(award => {
                    const resource = json.data.resourceInfoMap ? json.data.resourceInfoMap[award.id] : null;
                    return resource ? `${resource.name} x${resource.count}` : (award.id || "Unknown Item");
                }).join('\n');
                result.rewards = awards;
            } else {
                result.rewards = "No detailed reward info.";
            }

        } else if (json.code === 10001) {
            result.success = true;
            result.status = `Already Checked In. ${json.message || ''}`;
            result.rewards = "Nothing to claim";
        } else {
            result.success = false;
            result.status = `Error (Code: ${json.code})`;
            result.rewards = json.message || "Unknown Error";
        }
    } catch (error) {
        result.success = false;
        result.status = "💥 Exception";
        result.rewards = error.message;
        console.error(error);
    }

    return result;
}

/**
 * Endfield Signature Algorithm (HMAC-SHA256 -> MD5)
 */
function generateSign(path, body, timestamp, token, platform, vName) {
    let str = path + body + timestamp;
    const headerJson = `{"platform":"${platform}","timestamp":"${timestamp}","dId":"","vName":"${vName}"}`;
    str += headerJson;
    
    // Sign using the token obtained from refresh
    const hmacBytes = Utilities.computeHmacSha256Signature(str, token);
    const hmacHex = bytesToHex(hmacBytes);
    
    const md5Bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, hmacHex);
    return bytesToHex(md5Bytes);
}

/**
 * Helper: Convert Byte Array to Hex String
 */
function bytesToHex(bytes) {
    return bytes.map(function(byte) {
        return ('0' + (byte & 0xFF).toString(16)).slice(-2);
    }).join('');
}

/**
 * Send Report to Discord
 */
function sendDiscordEmbed(results) {
    const allSuccess = results.every(r => r.success);
    const hasError = !allSuccess;
    const embedColor = allSuccess ? 5763719 : 15548997;
    
    const fields = results.map(r => {
        return {
            name: r.name,
            value: `**Status:** ${r.status}\n**Rewards:**\n${r.rewards ? r.rewards : 'None'}`,
            inline: true
        };
    });

    const payload = {
        username: "Nielio | SKPort Auto Check In",
        avatar_url: "https://i.imgur.com/ZC1qsD5.png",
        embeds: [{
            title: "Check-in completed!",
            color: embedColor,
            fields: fields,
            footer: {
                text: `Time: ${new Date().toLocaleString('en-US', { timeZone: 'UTC' })} (UTC)`,
                icon_url: "https://assets.skport.com/assets/favicon.ico"
            }
        }]
    };

    if (hasError && DISCORD_USER_ID) {
        payload.content = `<@${DISCORD_USER_ID}> Script encountered an error, please check logs!`;
    }

    const options = {
        method: 'POST',
        contentType: 'application/json',
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
    };

    try {
        UrlFetchApp.fetch(DISCORD_WEBHOOK_URL, options);
    } catch (e) {
        console.error("Failed to send Discord webhook: " + e.message);
    }
}
