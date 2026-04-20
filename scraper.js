const https = require("https");
const http = require("http");

// ─── 설정 ───────────────────────────────────────────────
const GIST_ID = process.env.GIST_ID;         // GitHub Secret
const GITHUB_TOKEN = process.env.GITHUB_TOKEN; // GitHub Secret
const TARGET_URL = "https://kbsg.co.kr/?page_id=19";
// ────────────────────────────────────────────────────────

function fetchPage(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : http;
    client.get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchPage(res.headers.location).then(resolve).catch(reject);
      }
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve(data));
    }).on("error", reject);
  });
}

function parseMenu(html) {
  // 탭별 테이블 추출
  const result = { scraped_at: new Date().toISOString(), restaurants: {} };

  const restaurantNames = ["본관", "신관", "별관"];

  // 각 식당 테이블 파싱
  const tableRegex = /<table[\s\S]*?<\/table>/gi;
  const tables = html.match(tableRegex) || [];

  tables.forEach((table, idx) => {
    if (idx >= restaurantNames.length) return;
    const name = restaurantNames[idx];
    result.restaurants[name] = parseTable(table);
  });

  return result;
}

function stripTags(html) {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\*\*/g, "")
    .trim();
}

function cellToItems(html) {
  return stripTags(html)
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function parseTable(tableHtml) {
  const days = {};
  const rows = tableHtml.match(/<tr[\s\S]*?<\/tr>/gi) || [];

  // 헤더행 제외하고 데이터 행만 처리
  const dataRows = rows.filter((row) => /<td/i.test(row));

  // 헤더에서 컬럼명 추출
  const headerRow = rows.find((row) => /<th/i.test(row)) || "";
  const headers = (headerRow.match(/<th[\s\S]*?<\/th>/gi) || [])
    .map((th) => cellToItems(th).join(" "))
    .filter((h) => h);

  dataRows.forEach((row) => {
    const cells = row.match(/<td[\s\S]*?<\/td>/gi) || [];
    if (cells.length === 0) return;

    const dayRaw = cellToItems(cells[0]).join(" ");
    // "월 (04.20)" 형태에서 요일과 날짜 추출
    const dayMatch = dayRaw.match(/(월|화|수|목|금|토|일)/);
    const dateMatch = dayRaw.match(/\((\d{2}\.\d{2})\)/);
    if (!dayMatch) return;

    const day = dayMatch[1];
    const date = dateMatch ? dateMatch[1] : "";

    const entry = { date };
    // 나머지 셀을 헤더에 매핑 (헤더가 없으면 col1, col2... 사용)
    cells.slice(1).forEach((cell, i) => {
      const colName = headers[i + 1] || `col${i + 1}`;
      const items = cellToItems(cell);
      if (items.length > 0 && items[0] !== "휴무" && items[0] !== "") {
        entry[colName] = items;
      }
    });

    days[day] = entry;
  });

  return days;
}

async function updateGist(data) {
  const body = JSON.stringify({
    description: `KBS 공제회 금주의 식단 (${new Date().toLocaleDateString("ko-KR")})`,
    files: {
      "menu.json": {
        content: JSON.stringify(data, null, 2),
      },
    },
  });

  return new Promise((resolve, reject) => {
    const options = {
      hostname: "api.github.com",
      path: `/gists/${GIST_ID}`,
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        "User-Agent": "menu-scraper",
        "Content-Length": Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if (res.statusCode === 200) {
          const parsed = JSON.parse(data);
          console.log("✅ Gist 업데이트 완료:", parsed.html_url);
          resolve(parsed);
        } else {
          reject(new Error(`Gist 업데이트 실패: ${res.statusCode} ${data}`));
        }
      });
    });

    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  try {
    console.log("📥 페이지 가져오는 중...");
    const html = await fetchPage(TARGET_URL);

    console.log("🍱 식단 파싱 중...");
    const menu = parseMenu(html);

    const restaurantCount = Object.keys(menu.restaurants).length;
    console.log(`✅ 파싱 완료: ${restaurantCount}개 식당`);
    Object.entries(menu.restaurants).forEach(([name, days]) => {
      console.log(`   ${name}: ${Object.keys(days).length}일치`);
    });

    if (!GIST_ID || !GITHUB_TOKEN) {
      // 로컬 테스트용: JSON 출력
      console.log("\n⚠️  GIST_ID/GITHUB_TOKEN 미설정 → 로컬 출력:");
      console.log(JSON.stringify(menu, null, 2));
      return;
    }

    console.log("☁️  Gist 업데이트 중...");
    await updateGist(menu);
  } catch (err) {
    console.error("❌ 오류:", err.message);
    process.exit(1);
  }
}

main();
