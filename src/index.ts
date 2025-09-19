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

// --- Types ---
type Climb = {
  date: string;
  route: string;
  area: string;
  originGrade: string;
  suggestedGrade?: string;
  points: string;
  style: string;
  routeKey: string;
  partners?: string;
  note?: string;
  attempts?: number;
  public: boolean;
  sector?: string;
  location?: string;
};

// --- Helpers ---
async function login(username: string, password: string) {
  const loginResponse = await client.post(
    LOGIN_URL,
    new URLSearchParams({
      login: "2",
      uid: username,
      hes: password,
      x: "10",
      y: "10",
    }),
    { responseType: "arraybuffer" }
  );

  const cookies = loginResponse.headers["set-cookie"];
  if (!cookies) throw new Error("❌ Login failed – no cookies received.");
  client.defaults.headers.Cookie = cookies.join("; ");
  console.log("✅ Logged in to Lezec.cz");
}

function parseGrade(raw: string): {
  originGrade: string;
  suggestedGrade?: string;
} {
  const match = raw.match(/^(.+?)\s*\[(.+?)\]$/);
  if (match) {
    return { suggestedGrade: match[1].trim(), originGrade: match[2].trim() };
  }
  return { originGrade: raw };
}

function parseTitle(title: string): { partners?: string; note?: string } {
  if (!title) return {};
  const parts = title.split(" - ");
  return {
    partners: parts[0]?.trim(),
    note: parts[1]?.trim(),
  };
}

function parseDiary(html: string): Climb[] {
  const $ = cheerio.load(html);
  const climbs: Climb[] = [];

  $("table tr").each((_, row) => {
    const tds = $(row).find("td");
    if (tds.length >= 6) {
      const date = $(tds[0]).text().trim();
      if (!date.match(/^\d{2}\.\d{2}\.\d{4}$/)) return;

      const link = $(tds[1]).find("a");
      const href = link.attr("href") || "";
      const title = link.attr("title") || "";
      const mkey = href.match(/key=(\d+)/);
      const routeKey = mkey ? mkey[1] : "";

      const route = $(tds[1]).text().trim();
      const area = $(tds[2]).text().trim();
      const gradeRaw = $(tds[3]).text().trim();
      const points = $(tds[4]).text().trim();
      const style = $(tds[5]).text().trim();
      const attemptsText = tds[6] ? $(tds[6]).text().trim() : "";
      const publicText = tds[7] ? $(tds[7]).text().trim() : "";

      const { originGrade, suggestedGrade } = parseGrade(gradeRaw);
      const { partners, note } = parseTitle(title);

      const climb: Climb = {
        date,
        route,
        area,
        originGrade,
        points,
        style,
        routeKey,
        public: publicText.toLowerCase() === "x",
      };

      if (suggestedGrade) climb.suggestedGrade = suggestedGrade;
      if (partners) climb.partners = partners;
      if (note) climb.note = note;
      if (attemptsText && !isNaN(Number(attemptsText))) {
        climb.attempts = parseInt(attemptsText, 10);
      }

      climbs.push(climb);
    }
  });

  return climbs;
}

// --- Route detail ---
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
          if (label.startsWith("Sektor:")) sector = value;
          if (label.startsWith("Poloha:")) location = value;
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

// --- Main ---
async function main() {
  const USERNAME = process.env.LEZEC_USER;
  const PASSWORD = process.env.LEZEC_PASS;
  if (!USERNAME || !PASSWORD) {
    console.error("❌ Missing LEZEC_USER or LEZEC_PASS in .env file.");
    return;
  }

  await login(USERNAME, PASSWORD);

  const diaryResponse = await client.get(DIARY_URL);
  const decodedHtml = iconv.decode(Buffer.from(diaryResponse.data), "win1250");
  const climbs = parseDiary(decodedHtml);

  const sliced = limit
    ? climbs.slice(offset, offset + limit)
    : climbs.slice(offset);
  console.log(
    `📒 Parsed ${climbs.length} climbs, processing ${
      sliced.length
    } (offset=${offset}, limit=${limit ?? "∞"})`
  );

  if (fetchRouteInfoFlag) {
    console.log("🔎 Fetching route info...");
    let i = 0;
    for (const climb of sliced) {
      i++;
      if (climb.routeKey) {
        const info = await fetchRouteInfo(climb.routeKey);
        climb.sector = info.sector;
        climb.location = info.location;
        console.log(
          `   [${i}/${sliced.length}] ${climb.route} → ${
            climb.sector ?? "?"
          }, ${climb.location ?? "?"}`
        );
        await new Promise((res) => setTimeout(res, 1500));
      }
    }
  }

  const filename = fetchRouteInfoFlag ? "climbs_with_crag.json" : "climbs.json";
  fs.writeFileSync(filename, JSON.stringify(sliced, null, 2), "utf-8");
  console.log(`💾 Saved ${sliced.length} climbs to ${filename}`);
}

main();
