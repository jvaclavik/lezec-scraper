import axios from "axios";
import * as cheerio from "cheerio";
import * as dotenv from "dotenv";
import fs from "fs";
import iconv from "iconv-lite";
import http from "http";
import https from "https";

dotenv.config();

const BASE_URL = "https://lezec.cz";
const LOGIN_URL = `${BASE_URL}/login.php`;
const DIARY_URL = `${BASE_URL}/denik.php?crok=9997&par=1&ckat=1`;

// CLI flags
const fetchRouteInfoFlag = process.argv.includes("--route-info");
const offsetArg = process.argv.find((a) => a.startsWith("--offset="));
const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const offset = offsetArg ? parseInt(offsetArg.split("=")[1], 10) : 0;
const limit = limitArg ? parseInt(limitArg.split("=")[1], 10) : undefined;

// axios client pro login/deník
const client = axios.create({
  baseURL: BASE_URL,
  withCredentials: true,
  responseType: "arraybuffer",
  httpAgent: new http.Agent({ keepAlive: false }),
  httpsAgent: new https.Agent({ keepAlive: false }),
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139 Safari/537.36",
    "Content-Type": "application/x-www-form-urlencoded",
  },
});

// fetch detail cesty
async function fetchRouteInfo(
  routeKey: string,
  retries = 3
): Promise<{ sector?: string; location?: string }> {
  const url = `${BASE_URL}/cesta.php?key=${routeKey}`;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const routeClient = axios.create({
        responseType: "arraybuffer",
        httpAgent: new http.Agent({ keepAlive: false }),
        httpsAgent: new https.Agent({ keepAlive: false }),
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139 Safari/537.36",
        },
      });

      const resp = await routeClient.get(url);
      const decoded = iconv.decode(Buffer.from(resp.data), "win1250");
      const $ = cheerio.load(decoded);

      let sector: string | undefined;
      let location: string | undefined;

      $("table tr").each((_, row) => {
        const cells = $(row).find("td");
        if (cells.length === 2) {
          const label = $(cells[0]).text().trim();
          const value = $(cells[1]).text().trim();
          if (label.startsWith("Sektor:")) {
            sector = value;
          }
          if (label.startsWith("Poloha:")) {
            location = value;
          }
        }
      });

      return { sector, location };
    } catch (err: any) {
      console.warn(
        `⚠️ Error fetching route ${routeKey}, attempt ${attempt}: ${err.message}`
      );
      if (attempt < retries) {
        await new Promise((res) => setTimeout(res, 2000));
      }
    }
  }

  return {};
}

async function main() {
  const USERNAME = process.env.LEZEC_USER;
  const PASSWORD = process.env.LEZEC_PASS;

  if (!USERNAME || !PASSWORD) {
    console.error("❌ Missing LEZEC_USER or LEZEC_PASS in .env file.");
    return;
  }

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
  const decodedHtml = iconv.decode(Buffer.from(diaryResponse.data), "win1250");
  const $ = cheerio.load(decodedHtml);

  type Climb = {
    date: string;
    route: string;
    area: string;
    originGrade: string;
    suggestedGrade?: string;
    points: string;
    style: string;
    routeKey: string;
    sector?: string;
    crag?: string;
    location?: string;
  };

  const climbs: Climb[] = [];

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
        const link = $(tds[1]).find("a").attr("href") || "";
        const mkey = link.match(/key=(\d+)/);
        const routeKey = mkey ? mkey[1] : "";

        let originGrade = "";
        let suggestedGrade: string | undefined = undefined;
        const match = gradeRaw.match(/^(.+?)\s*\[(.+?)\]$/);
        if (match) {
          suggestedGrade = match[1].trim();
          originGrade = match[2].trim();
        } else {
          originGrade = gradeRaw;
        }

        const climb: Climb = {
          date,
          route,
          area,
          originGrade,
          points,
          style,
          routeKey,
        };
        if (suggestedGrade) climb.suggestedGrade = suggestedGrade;

        climbs.push(climb);
      }
    }
  });

  // 3. Apply offset/limit
  const sliced = limit
    ? climbs.slice(offset, offset + limit)
    : climbs.slice(offset);
  console.log(
    `📒 Parsed ${climbs.length} climbs, processing ${
      sliced.length
    } (offset=${offset}, limit=${limit ?? "∞"})`
  );

  // 4. Route info only if flag is set
  if (fetchRouteInfoFlag) {
    console.log("🔎 Fetching route info...");
    let i = 0;
    for (const climb of sliced) {
      i++;
      if (climb.routeKey) {
        const info = await fetchRouteInfo(climb.routeKey);
        climb.sector = info.sector;
        climb.crag = info.crag;
        climb.location = info.location;
        console.log(
          `   [${i}/${sliced.length}] ${climb.route} → ${
            climb.sector ?? "?"
          }, ${climb.crag ?? "?"}, ${climb.location ?? "?"}`
        );
        await new Promise((res) => setTimeout(res, 1500)); // pauza mezi requesty
      }
    }
  }

  // 5. Save file
  const filename = fetchRouteInfoFlag ? "climbs_with_crag.json" : "climbs.json";
  fs.writeFileSync(filename, JSON.stringify(sliced, null, 2), "utf-8");
  console.log(`💾 Saved ${sliced.length} climbs to ${filename}`);
}

main();
