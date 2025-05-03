import puppeteer from "puppeteer";
import installMouseHelper from "puppeteer-mouse-helper";

const TIMEOUT = 240 * 1000;
const SPONSOR_DIALOG_SELECTOR = "#overlay-sponsor";
const INSTITUTES_SELECTOR = "#ranking > tbody > tr";

const removeElement = (element) => element.remove();
const getNumber = (element) => Number(element.textContent) || 0;
const getText = (element) => element.textContent;

const browser = await puppeteer.launch({ headless: false, timeout: TIMEOUT });
const [page] = await browser.pages();
await page.setViewport({ width: 1280, height: 720 });
await installMouseHelper(page, undefined, "width: 50px; height: 50px;");

await loadPage();

await exitSponsor();

await selectOnlyHCI();

await loadAllRows();

await iterateOverAllInstitutesAndGatherInformation();

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
    INSTITUTES_SELECTOR,
    (rows) => rows.length,
  );
  console.log("Initial row count:", initialRowCount);

  await page.evaluate(() => {
    const tableParent = document.querySelector("#ranking").parentElement;
    tableParent.scrollTop = tableParent.scrollHeight;
  });

  console.log("Waiting for more rows to load...");
  await page.waitForFunction(
    (initialRowCount, INSTITUTES_SELECTOR) => {
      return (
        document.querySelectorAll(INSTITUTES_SELECTOR).length > initialRowCount
      );
    },
    undefined,
    initialRowCount,
    INSTITUTES_SELECTOR,
  );

  const updatedRowCount = await page.$$eval(
    INSTITUTES_SELECTOR,
    (rows) => rows.length,
  );
  console.log(
    `All ${updatedRowCount} rows = ${updatedRowCount / 3} institutes loaded!`,
  );

  console.log("Scrolling to top...");
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    const tableParent = document.querySelector("#ranking").parentElement;
    tableParent.scrollTop = 0;
  });
}

async function iterateOverAllInstitutesAndGatherInformation() {
  const institutes = await page.$$("#ranking > tbody > tr");
  const institutesInformation = {};

  for (let i = 0; i < institutes.length; i += 3) {
    const institute = institutes[i];
    const chart = institutes[i + 1];
    const professors = institutes[i + 2];

    const instituteName = await institute.$$eval(
      "td span",
      (spans) => spans[1].textContent,
    );

    console.log("Gathering information from:", instituteName);

    institutesInformation[instituteName] = await collectInstituteInformation(
      institute,
      chart,
      professors,
    );
  }

  console.log(institutesInformation);
}

async function collectInstituteInformation(institute, chart, professors) {
  const instituteData = {};

  await institute.scrollIntoView();
  const instituteDataTds = await institute.$$("td");
  const instituteNameTd = instituteDataTds[1];

  instituteData.total = await getHCICountAndRemoveChart(chart, instituteNameTd);

  console.log("Expanding professor list and waiting for them to load...");
  const expandIcon = await instituteNameTd.$("td > span");
  expandIcon.click();
  await professors.waitForSelector("td > div", { visible: true });
  console.log("Professor list loaded!");

  console.log("Removing institute from the dom");
  await Promise.all([
    institute.evaluate(removeElement),
    professors.evaluate(removeElement),
  ]);

  await Promise.all([institute.isHidden(), professors.isHidden()]);
  return instituteData;
}

async function getHCICountAndRemoveChart(chart, instituteNameTd) {
  console.log("Clicking chart icon and waiting for chart to load...");
  const chartIcon = await instituteNameTd.$("span > .chart_icon");
  await chartIcon.click();
  await chart.waitForSelector("canvas");
  console.log("Chart loaded!");

  const chartInfo = await chart.$eval("canvas", (canvas) => {
    const boundingClientRect = canvas.getBoundingClientRect();
    return {
      width: boundingClientRect.width,
      height: boundingClientRect.height,
      left: boundingClientRect.left,
      top: boundingClientRect.top,
    };
  });

  console.log(
    "Moving mouse cursor to appropriate position in the chart for HCI tooltip",
  );
  await page.mouse.move(
    chartInfo.left + 434,
    chartInfo.top + (chartInfo.height - 63),
  );
  try {
    const [interdisciplinaryArea, count] = await Promise.all([
      page.$eval("#vg-tooltip-element.visible tr .value", getText),
      page.$eval(
        "#vg-tooltip-element.visible tr:nth-child(2) .value",
        getNumber,
      ),
    ]);
    return interdisciplinaryArea === "HCI" ? count : 0;
  } catch (e) {
    return 0;
  } finally {
    await Promise.all([chart.evaluate(removeElement), chart.isHidden()]);
  }
}
