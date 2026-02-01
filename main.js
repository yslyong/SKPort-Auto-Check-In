/** 
 * Get cred, skGameRole, and sign from inspect element and in Network tab, 
 * and collect the value in the POST header for "attendance" request 
**/ 

const profiles = [
    {
        cred: "xxxxxxxxxx",  // Replace with your cred
        skGameRole: "xxxxxxxxxx",  // Replace with your your sk-game-role
        sign: "xxxxxxxxxx", // Replace with your sign
        platform: "3",
        vName: "1.0.0",
        accountName: "Arknight: Endfield Account"
    }
];

// Use this to get Discord Notification (optional)
const discord_notify = true;
const myDiscordID = "xxxxxxxxxx";  // Replace with your Discord ID
const discordWebhook = "https://xxx.discord.com/api/webhooks/xxxxxxxxxxx";  // Replace with your Discord webhook URL

/** The above is the config. Please refer to the instructions on https://github.com/canaria3406/hoyolab-auto-sign for configuration. **/
/** The following is the script code. Please DO NOT modify. **/

const attendanceUrl = 'https://zonai.skport.com/web/v1/game/endfield/attendance';

async function main() {
    const messages = await Promise.all(profiles.map(autoClaimFunction));
    const endfieldResp = `${messages.join('\n\n')}`;

    if (discord_notify && discordWebhook) {
        postWebhook(endfieldResp);
    }
}

function discordPing() {
    return myDiscordID ? `<@${myDiscordID}> ` : '';
}

function autoClaimFunction({ cred, skGameRole, sign, platform, vName, accountName }) {
    const header = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:147.0) Gecko/20100101 Firefox/147.0',
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br, zstd',
        'Referer': 'https://game.skport.com/',
        'Content-Type': 'application/json',
        'sk-language': 'en',
        'sk-game-role': skGameRole,
        'cred': cred,
        'platform': platform,
        'vName': vName,
        'timestamp': Math.floor(Date.now() / 1000).toString(),
        'sign': sign,
        'Origin': 'https://game.skport.com',
        'Connection': 'keep-alive',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-site'
    };

    const options = {
        method: 'POST',
        headers: header,
        muteHttpExceptions: true,
    };

    let response = `Check-in completed for ${accountName}`;

    try {
        const endfieldResponse = UrlFetchApp.fetch(attendanceUrl, options);
        const responseJson = JSON.parse(endfieldResponse.getContentText());

        const checkInResult = responseJson.message;

        if (checkInResult) {
            response += `\nStatus: ${checkInResult}`;
        }

        if (responseJson.code === 0) {
            const awards = responseJson.data.awardIds.map(award => {
                const resource = responseJson.data.resourceInfoMap[award.id];
                return `${resource.name}: ${resource.count}`;
            }).join(', ');

            response += `\nAwards: ${awards}`;
        }

    } catch (error) {
        response += `\n${discordPing()}Failed to claim: ${error.message}`;
    }


    return response;
}

function postWebhook(data) {
    let payload = JSON.stringify({
        'username': 'Nielio | SKPort Auto Check In',
        'avatar_url': 'https://i.imgur.com/ZC1qsD5.png',
        'content': data
    });

    const options = {
        method: 'POST',
        contentType: 'application/json',
        payload: payload,
        muteHttpExceptions: true
    };

    UrlFetchApp.fetch(discordWebhook, options);
}
