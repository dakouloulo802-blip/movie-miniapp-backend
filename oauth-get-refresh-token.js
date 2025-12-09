// oauth-get-refresh-token.js
// Usage: node oauth-get-refresh-token.js

const { google } = require('googleapis');
const readline = require('readline');

const CLIENT_ID = process.env.BLOGGER_CLIENT_ID || "";
const CLIENT_SECRET = process.env.BLOGGER_CLIENT_SECRET || "";
const REDIRECT_URI = "urn:ietf:wg:oauth:2.0:oob"; 

async function main() {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error("ERROR: Set environment variables BLOGGER_CLIENT_ID and BLOGGER_CLIENT_SECRET first.");
    process.exit(1);
  }

  const oauth2Client = new google.auth.OAuth2(
    CLIENT_ID,
    CLIENT_SECRET,
    REDIRECT_URI
  );

  const scopes = ["https://www.googleapis.com/auth/blogger"];

  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: scopes,
    prompt: "consent"
  });

  console.log("\n1) Open the following URL in your browser (copy & paste):\n");
  console.log(url);
  console.log("\n2) Sign in and allow access. Google will show you a code.\n");

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question("3) Paste the code here: ", async (code) => {
    try {
      const { tokens } = await oauth2Client.getToken(code.trim());
      console.log("\n===== COPY THIS REFRESH TOKEN (save it somewhere) =====");
      console.log(tokens.refresh_token);
      console.log("======================================================\n");
    } catch (err) {
      console.error("ERROR GETTING TOKEN:", err.message || err);
    } finally {
      rl.close();
    }
  });
}

main().catch(console.error);
