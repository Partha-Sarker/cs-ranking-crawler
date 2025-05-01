import puppeteer from "puppeteer";
import installMouseHelper from "puppeteer-mouse-helper";

const TIMEOUT = 240 * 1000;
const SPONSOR_DIALOG_SELECTOR = "#overlay-sponsor";

const browser = await puppeteer.launch({ headless: false, timeout: TIMEOUT });
const [page] = await browser.pages();
await page.setViewport({ width: 1280, height: 720 });
await installMouseHelper(page, undefined, "width: 50px; height: 50px;");

await loadPage();

await exitSponsor();

await selectOnlyHCI();

await loadAllRows();

const rows = await page.$$("#ranking tr");

for (let i = 0; i < rows.length; i++) {
  const institute = rows[i];
  const tds = await institute.$$("td");

  if (tds.length < 4) {
    console.log(`Row ${i} skipped (only ${tds.length} <td>s).`);
    continue;
  }
  await collectInstituteInformation(institute);

  break;
}

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
  try {
    console.log("Searching for sponsor exit button...");
    await page.waitForSelector(SPONSOR_DIALOG_SELECTOR, {
      timeout: 500,
      visible: true,
    });

    console.log("Sponsor dialog found, closing...");
    await page.$eval(SPONSOR_DIALOG_SELECTOR, (sponsorDialog) =>
      sponsorDialog.remove(),
    );
    await page.waitForSelector(SPONSOR_DIALOG_SELECTOR, { hidden: true });
    console.log("Sponsor dialog successfully closed");
  } catch (error) {
    console.log("Sponsor dialog not found");
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

  let updatedRowCount = initialRowCount;

  console.log("Waiting for more rows to load...");
  await page.waitForFunction(
    (initialRowCount) => {
      updatedRowCount = document.querySelectorAll("#ranking tr").length;
      return updatedRowCount > initialRowCount;
    },
    undefined,
    initialRowCount,
  );

  console.log(`All ${updatedRowCount} rows loaded!`);

  console.log("Scrolling to top...");
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    const tableParent = document.querySelector("#ranking").parentElement;
    tableParent.scrollTop = 0;
  });
}

async function collectInstituteInformation(institute) {
  const tds = await institute.$$("td");
  const secondTd = tds[1];
  const chartIcon = await secondTd.$('img[alt="closed chart"]');
  chartIcon.click();

  console.log("Clicked image in row. Waiting for chart to load...");
  await page.waitForFunction(
    (institute) => {
      const found = !!institute.nextElementSibling?.querySelector("canvas");
      console.log("Chart found:", found);
      return found;
    },
    undefined,
    institute,
  );
  console.log("Chart loaded!");

  const chartInfo = await page.$eval("canvas", (canvas) => {
    const boundingClientRect = canvas.getBoundingClientRect();
    console.log({
      boundingClientRect,
    });
    return {
      width: boundingClientRect.width,
      height: boundingClientRect.height,
      left: boundingClientRect.left,
      top: boundingClientRect.top,
    };
  });

  console.log(chartInfo);

  // target pixel: 435, 63

  // Move mouse to the calculated position
  await page.mouse.move(
    chartInfo.left + 435,
    chartInfo.top + (chartInfo.height - 63),
  );
}
