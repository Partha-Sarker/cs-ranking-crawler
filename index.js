import puppeteer from "puppeteer";
import installMouseHelper from "puppeteer-mouse-helper";
import { writeFile } from "fs";

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

    console.log("Gathering information from institute:", instituteName);

    const instituteInformation = await collectInstituteInformation(
      institute,
      chart,
      professors,
    );

    if (instituteInformation.total)
      institutesInformation[instituteName] = instituteInformation;
  }

  return Object.keys(institutesInformation)
    .sort(
      (i1, i2) =>
        institutesInformation[i2].total - institutesInformation[i1].total,
    )
    .reduce((orderedInstitutesInformation, i) => {
      orderedInstitutesInformation[i] = institutesInformation[i];
      return orderedInstitutesInformation;
    }, {});
}

async function collectInstituteInformation(institute, chart, professors) {
  const instituteData = {};

  instituteData.rank = await institute.$eval("td", getNumber);
  instituteData.total = await getHCICountAndRemoveChart(chart, institute);
  if (instituteData.total) {
    instituteData.professors =
      await iterateOverProfessorsAndCollectionInformation(
        professors,
        institute,
      );
  }

  console.log("Removing institute from the dom");
  await Promise.all([
    institute.evaluate(removeElement),
    professors.evaluate(removeElement),
  ]);

  await Promise.all([institute.isHidden(), professors.isHidden()]);
  return instituteData;
}

async function getHCICountAndRemoveChart(chart, row) {
  console.log("Clicking chart icon and waiting for chart to load...");
  const chartIcon = await row.$("td span > .chart_icon");
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
  const bottomOffset = 63;

  await page.mouse.move(
    chartInfo.left + chartInfo.width * 0.92,
    chartInfo.top + (chartInfo.height - bottomOffset),
  );
  try {
    const [interdisciplinaryArea, count] = await Promise.all([
      page.$eval("#vg-tooltip-element.visible tr .value", getText),
      page.$eval(
        "#vg-tooltip-element.visible tr:nth-child(2) .value",
        getNumber,
      ),
    ]);

    const tooltip = await page.$("#vg-tooltip-element");
    await Promise.all([tooltip.evaluate(removeElement), tooltip.isHidden()]);

    if (interdisciplinaryArea !== "HCI") {
      console.log("Invalid area detected");
      return 0;
    }

    return count;
  } catch (e) {
    return 0;
  } finally {
    await Promise.all([chart.evaluate(removeElement), chart.isHidden()]);
  }
}

async function iterateOverProfessorsAndCollectionInformation(
  professors,
  institute,
) {
  console.log("Expanding professor list and waiting for them to load...");
  const expandIcon = await institute.$("td > span");
  await expandIcon.click();
  await professors.isVisible();
  console.log("Expanded professor list. Now iterating over professors");

  const professorRows = await professors.$$("table > tbody > tr");
  console.log(`${professorRows / 2} Professors loaded!`);

  const professorsInformation = {};

  for (let i = 0; i < professorRows.length; i += 2) {
    const professor = professorRows[i];
    const professorName = await professor.$eval("td small a", getText);
    console.log("Gathering information from professor:", professorName);

    const count = await collectInformationFromProfessor(
      professor,
      professorRows[i + 1],
    );
    if (count) professorsInformation[professorName] = count;
  }

  return Object.keys(professorsInformation)
    .sort((p1, p2) => professorsInformation[p2] - professorsInformation[p1])
    .reduce((orderedProfessorsInformation, p) => {
      orderedProfessorsInformation[p] = professorsInformation[p];
      return orderedProfessorsInformation;
    }, {});
}

async function collectInformationFromProfessor(professor, chart) {
  const count = await getHCICountAndRemoveChart(chart, professor);

  await Promise.all([
    professor.evaluate(removeElement),
    chart.evaluate(removeElement),
    professor.isHidden(),
    chart.isHidden(),
  ]);

  return count;
}

async function scrapCsRanking() {
  await loadPage();

  await exitSponsor();

  await selectOnlyHCI();

  await loadAllRows();

  const institutesHciInformation =
    await iterateOverAllInstitutesAndGatherInformation();

  writeFile(
    "cs-ranking-hci.json",
    JSON.stringify(institutesHciInformation, null, 2),
    "utf8",
    (err) => {
      if (err) {
        console.error("Error writing to file", err);
      } else {
        console.log("Data written to file");
      }
    },
  );

  await browser.close();
}

await scrapCsRanking();
