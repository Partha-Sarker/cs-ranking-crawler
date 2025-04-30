import puppeteer from "puppeteer";

const TIMEOUT = 240 * 1000;

const browser = await puppeteer.launch({ headless: false });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
await page.setDefaultNavigationTimeout(TIMEOUT);
await page.setDefaultTimeout(TIMEOUT);
await page.setGeolocation({});

await loadPage();

await exitSponsor();

await selectOnlyHCI();

await loadAllRows();

async function loadPage() {
  console.log("Waiting for the page to load...");
  await page.goto("https://csrankings.org/", {
    waitUntil: "domcontentloaded",
    timeout: TIMEOUT,
  });

  await page.waitForSelector("#ranking");
  console.log("Page loaded!");
}

async function exitSponsor() {
  console.log("Searching for sponsor exit button...");
  const sponsor = await page.locator("#overlay-sponsor");

  if (sponsor) {
    console.log("Sponsor dialog found, clicking it...");
    sponsor.setVisibility("hidden");
    console.log("Sponsor successfully closed");
  } else {
    console.log("Exit dialog button not found");
  }
}

async function selectOnlyHCI() {
  console.log(
    "Turning off all interdisciplinary areas and wait until all the checkbox is unchecked...",
  );
  await page.click("#other_areas_off");

  await page.waitForFunction(() => {
    const checkbox = document.querySelector("#chi");
    return checkbox && checkbox.checked === false;
  });
  console.log("All areas are unchecked!");

  console.log("Turning on HCI and wait until HCI is checked...");
  await page.click("#chi");

  await page.waitForFunction(() => {
    const checkbox = document.querySelector("#chi");
    return checkbox && checkbox.checked === true;
  });

  console.log("HCI is checked!");
}

async function loadAllRows() {
  console.log("Scrolling down to load more rows...");
  const initialRowCount = await page.$$eval(
    "#ranking tr",
    (rows) => rows.length,
  );
  console.log("Initial row count:", initialRowCount);

  await page.evaluate(() => {
    const tableParent = document.querySelector("#ranking").parentElement;
    tableParent.scrollTop = tableParent.scrollHeight;
  });

  let currentRowCount = initialRowCount;
  const timeout = 500;
  const pollInterval = 100;

  const start = Date.now();
  while (Date.now() - start < timeout) {
    console.log("Waiting for more rows to load...");
    currentRowCount = await page.$$eval("#ranking tr", (rows) => rows.length);
    if (currentRowCount > initialRowCount) {
      break;
    }
    await new Promise((res) => setTimeout(res, pollInterval));
  }

  console.log("All rows loaded!", currentRowCount);
}
