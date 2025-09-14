import axios from "axios";
import * as cheerio from "cheerio";
import * as dotenv from "dotenv";
import fs from "fs";
import iconv from "iconv-lite";

dotenv.config();

const BASE_URL = "https://lezec.cz";
const LOGIN_URL = `${BASE_URL}/login.php`;
const DIARY_URL = `${BASE_URL}/denik.php?crok=9997&par=1&ckat=1`;

async function main() {
  const USERNAME = process.env.LEZEC_USER;
  const PASSWORD = process.env.LEZEC_PASS;

  if (!USERNAME || !PASSWORD) {
    console.error("❌ Missing LEZEC_USER or LEZEC_PASS in .env file.");
    return;
  }

  const client = axios.create({
    baseURL: BASE_URL,
    withCredentials: true,
    responseType: "arraybuffer",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139 Safari/537.36",
      "Content-Type": "application/x-www-form-urlencoded",
    },
  });

  try {
    // 1. Login
    const loginResponse = await client.post(
      LOGIN_URL,
      new URLSearchParams({
        login: "2",
        uid: USERNAME,
        hes: PASSWORD,
        x: "10",
        y: "10",
      }),
      { responseType: "arraybuffer" }
    );

    const cookies = loginResponse.headers["set-cookie"];
    if (!cookies) {
      console.error("❌ Login failed – no cookies received.");
      return;
    }

    client.defaults.headers.Cookie = cookies.join("; ");
    console.log("✅ Logged in to Lezec.cz");

    // 2. Fetch diary page
    const diaryResponse = await client.get(DIARY_URL);

    // Lezec.cz používá Windows-1250
    const decodedHtml = iconv.decode(
      Buffer.from(diaryResponse.data),
      "win1250"
    );
    const $ = cheerio.load(decodedHtml);

    // 3. Parse climbs
    const climbs: Array<Record<string, string>> = [];

    $("table tr").each((_, row) => {
      const tds = $(row).find("td");

      if (tds.length >= 6) {
        const date = $(tds[0]).text().trim();
        const route = $(tds[1]).text().trim();
        const area = $(tds[2]).text().trim();
        let gradeRaw = $(tds[3]).text().trim();
        const points = $(tds[4]).text().trim();
        const style = $(tds[5]).text().trim();

        if (date.match(/^\d{2}\.\d{2}\.\d{4}$/)) {
          const climb: Record<string, string> = {
            date,
            route,
            area,
            points,
            style,
          };

          // Handle grades
          const match = gradeRaw.match(/^(.+?)\s*\[(.+?)\]$/);
          if (match) {
            climb.suggestedGrade = match[1].trim();
            climb.originGrade = match[2].trim();
          } else if (gradeRaw) {
            climb.originGrade = gradeRaw;
          }

          climbs.push(climb);
        }
      }
    });

    // 4. Save to JSON
    fs.writeFileSync("climbs.json", JSON.stringify(climbs, null, 2), "utf-8");
    console.log(`💾 Saved ${climbs.length} climbs to climbs.json`);
  } catch (err: any) {
    console.error("❌ Scraping error:", err.message);
  }
}

main();
