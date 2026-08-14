import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer as createTcpServer } from "node:net";
import { join, resolve } from "node:path";

const BOT_TOKEN = "123456789:stella-fitness-e2e";
const USER_ID = 424242;
const CHAT_ID = 515151;
const BOT_ID = 616161;
const REQUEST_TIMEOUT_MS = 20_000;
const GATEWAY_TOKEN = "stella-fitness-clean-install-gateway-token";

export async function verifyTelegramChannelFlow(options) {
  const personalDataDirectory = join(options.temporaryRoot, "personal-data");
  mkdirSync(personalDataDirectory, { recursive: true });
  const telegram = await createFakeTelegramApi();
  const gatewayPort = await availablePort();
  const fixtureProvider = resolve(
    options.workspace,
    "test/fixtures/openclaw-e2e-provider",
  );
  let gateway;
  let gatewayStarts = 0;
  const progress = (message) =>
    process.stderr.write(`[channel-e2e] ${message}\n`);
  try {
    options.run(options.openclaw, [
      "plugins",
      "install",
      fixtureProvider,
      "--link",
    ]);
    configureOpenClaw(options, {
      personalDataDirectory,
      telegramBaseUrl: telegram.baseUrl,
      gatewayPort,
    });

    gateway = startGateway(options, gatewayPort);
    gatewayStarts += 1;
    await telegram.waitForCall(({ method }) => method === "getme");
    progress("gateway ready");

    const restartGateway = async (checkpoint) => {
      progress(`restarting after ${checkpoint}`);
      await stopGateway(gateway);
      gateway = startGateway(options, gatewayPort);
      gatewayStarts += 1;
      await telegram.waitForCall(
        ({ method, sequence }) =>
          method === "getme" && sequence >= gatewayStarts,
      );
      progress(`recovered after ${checkpoint}`);
    };

    await verifyWebChatFlow(options, gatewayPort);
    progress("WebChat dedicated-agent journey and workbook download verified");

    telegram.pushText("/stella-start");
    await telegram.waitForText((text) =>
      text.includes("journey: PREREQUISITES_REQUIRED"),
    );

    telegram.pushText("/stella-print");
    const workbookCall = await telegram.waitForCall(
      ({ method }) => method === "senddocument",
    );
    if (
      restoreStagedFileName(workbookCall.body.fileName) !==
        "zhuoshu-workout-log.xlsx" ||
      workbookCall.body.mimeType !== "application/octet-stream" ||
      workbookCall.body.bytes !== 20_964 ||
      workbookCall.body.sha256 !==
        "a113a16f9844ceb518307369bd45979af3aa703e67da8eb3bbb6b5e991aebcca"
    ) {
      throw new Error(
        `Telegram workbook attachment mismatch: ${JSON.stringify(workbookCall.body)}`,
      );
    }

    const prerequisites = [
      ["adjustable-dumbbells", "我已准备好可拆卸哑铃"],
      ["pull-up-bar", "我已准备好引体向上杆"],
      ["printed-workout-log", "我已打印训练日志"],
      ["recording-protocol", "我已了解训练记录协议"],
    ];
    for (const [index, [, acknowledgement]] of prerequisites.entries()) {
      telegram.pushText(acknowledgement, 2_000 + index);
      const remaining = prerequisites.slice(index + 1).map(([id]) => id);
      try {
        await telegram.waitForText((text) =>
          text.includes(`Built-in Program: zhuoshu-12-week@0.2.0`) &&
          (remaining.length === 0
            ? text.includes("journey: BASELINE_WEIGHT_REQUIRED")
            : text.includes(`missing-prerequisites: ${remaining.join(", ")}`)),
        );
      } catch (error) {
        throw new Error(
          `${String(error)}\nPrerequisite: ${acknowledgement}\nTelegram: ${JSON.stringify(telegram.snapshot())}\nGateway tail: ${gateway.logs().slice(-12_000)}`,
        );
      }
      await restartGateway(acknowledgement);
    }
    const setupPath = join(personalDataDirectory, "program", "setup.json");
    const setupAfterPrerequisites = JSON.parse(readFileSync(setupPath, "utf8"));
    const acknowledgements = Object.values(
      setupAfterPrerequisites.prerequisiteAcknowledgements,
    );
    if (
      acknowledgements.length !== 4 ||
      acknowledgements.some((acknowledgement) =>
        typeof acknowledgement.acknowledgedAt !== "string" ||
        acknowledgement.source?.kind !== "user-text" ||
        acknowledgement.source?.channel !== "telegram" ||
        typeof acknowledgement.source?.text !== "string" ||
        !/^sha256:[0-9a-f]{64}$/u.test(acknowledgement.idempotencyKey)
      )
    ) {
      throw new Error(
        `Prerequisite acknowledgements lack persisted time, provenance or idempotency: ${JSON.stringify(acknowledgements)}`,
      );
    }
    telegram.pushText("我已了解训练记录协议", 2_003);
    await telegram.waitForText((text) =>
      text.includes("journey: BASELINE_WEIGHT_REQUIRED"),
    );
    const setupAfterReplay = JSON.parse(readFileSync(setupPath, "utf8"));
    if (
      JSON.stringify(setupAfterReplay.prerequisiteAcknowledgements) !==
        JSON.stringify(setupAfterPrerequisites.prerequisiteAcknowledgements)
    ) {
      throw new Error("Duplicate prerequisite message changed persisted facts");
    }
    telegram.pushText("体重 68.4");
    const pendingBaseline = await telegram.waitForText((text) =>
      text.includes("Program Journey needs confirmation:"),
    );
    const baselineConfirmationId =
      /Program Journey needs confirmation: ([0-9a-f-]{36})/u.exec(
        pendingBaseline,
      )?.[1];
    if (baselineConfirmationId === undefined) {
      throw new Error(`Baseline confirmation ID was missing: ${pendingBaseline}`);
    }
    await restartGateway("pending baseline confirmation");
    telegram.pushText(`/stella-confirm ${baselineConfirmationId} {"unit":"kg"}`);
    await telegram.waitForText((text) =>
      text.startsWith("baseline body weight recorded: 68.4 kg"),
    );
    await restartGateway("baseline body weight");
    for (const [exercise, value] of [
      ["goblet-squat", 32],
      ["dumbbell-bench-press", 24],
      ["dumbbell-deadlift", 40],
    ]) {
      telegram.pushText(`/stella-12rm ${exercise} ${value} kg confirm`);
      await telegram.waitForText((text) =>
        text.startsWith(`Initial 12RM recorded: ${exercise} ${value} kg`),
      );
      await restartGateway(`${exercise} 12RM`);
    }
    telegram.pushText("/stella-activate 2026-07-13");
    await telegram.waitForText((text) =>
      text.startsWith("Program State activated:") &&
      text.includes("today Planned Session: 2026-07-13") &&
      text.includes("rest:"),
    );
    await restartGateway("Program State activation");
    const state = JSON.parse(readFileSync(
      join(personalDataDirectory, "program", "state.json"),
      "utf8",
    ));
    const expectedInitialBindings = [
      ["goblet-squat", 32],
      ["dumbbell-bench-press", 24],
      ["dumbbell-deadlift", 40],
    ];
    if (
      expectedInitialBindings.some(([exerciseId, value]) =>
        state.symbolicLoadBindings?.[exerciseId]?.A?.value !== value ||
        typeof state.symbolicLoadBindings?.[exerciseId]?.A?.observationId !== "string"
      )
    ) {
      throw new Error(`Program State has incomplete initial A bindings: ${JSON.stringify(state)}`);
    }
    const checkpointGateCursor = telegram.messageCount();
    telegram.pushText(
      "/stella-weight 2026-08-10T08:00:00.000Z 体重 69 kg",
    );
    await telegram.waitForTextAfter(
      checkpointGateCursor,
      (text) => text.startsWith("checkpoint body weight recorded: 69 kg"),
    );
    await restartGateway("Week 4 body-weight checkpoint");
    const checkpointRecoveryCursor = telegram.messageCount();
    telegram.pushText("/stella-facts weight");
    await telegram.waitForTextAfter(
      checkpointRecoveryCursor,
      (text) =>
        text.startsWith("Weight Facts:") &&
        text.includes("baseline: 68.4 kg") &&
        text.includes("week-4: 69 kg"),
    );
    telegram.pushText("/stella-facts today 2026-08-10");
    const today = await telegram.waitForText((text) =>
      text.startsWith("today Planned Session: 2026-08-10"),
    );
    telegram.pushText("/stella-facts next 2026-08-10");
    await telegram.waitForText((text) =>
      text.startsWith("next Planned Session: 2026-08-11"),
    );
    telegram.pushText("我应该怎么调整训练和饮食？");
    await telegram.waitForText((text) =>
      text.includes("only reports source-program, Program State and recorded facts") &&
      text.includes("does not diagnose, advise or adjust the plan"),
    );
    telegram.pushText("/stella-facts weight");
    await telegram.waitForText((text) =>
      text.startsWith("Weight Facts:") &&
      text.includes("baseline: 68.4 kg") &&
      text.includes("current: 68.4 kg") &&
      text.includes("week-4: 69 kg") &&
      text.includes("toward-goal"),
    );
    await restartGateway("Program Facts questions");
    const recoveryMessageCursor = telegram.messageCount();
    telegram.pushText("/stella-facts today 2026-08-10");
    const recoveredToday = await telegram.waitForTextAfter(recoveryMessageCursor, (text) =>
      text.startsWith("today Planned Session: 2026-08-10"),
    );
    if (today !== recoveredToday) {
      throw new Error("Program Facts changed after Gateway restart");
    }
    telegram.pushPhoto("训练日志");
    let pendingStrength;
    try {
      pendingStrength = await telegram.waitForText((text) =>
        text.includes("Workout log needs confirmation:") &&
        text.includes("testResults.3.result.value"),
      );
    } catch (error) {
      throw new Error(
        `${String(error)}\nStrength photo: ${JSON.stringify(telegram.snapshot())}\nGateway tail: ${gateway.logs().slice(-12_000)}`,
      );
    }
    const strengthConfirmationId =
      /Workout log needs confirmation: ([0-9a-f-]{36})/u.exec(pendingStrength)?.[1];
    if (strengthConfirmationId === undefined) {
      throw new Error(`Strength confirmation ID was missing: ${pendingStrength}`);
    }
    const ordinaryPendingCursor = telegram.messageCount();
    telegram.pushPhoto("普通训练日志");
    const pendingOrdinary = await telegram.waitForTextAfter(
      ordinaryPendingCursor,
      (text) =>
        text.includes("Workout log needs confirmation:") &&
        text.includes("exercises.0.load.value"),
    );
    const ordinaryConfirmationId =
      /Workout log needs confirmation: ([0-9a-f-]{36})/u.exec(pendingOrdinary)?.[1];
    if (ordinaryConfirmationId === undefined) {
      throw new Error(`Ordinary confirmation ID was missing: ${pendingOrdinary}`);
    }
    telegram.pushText(
      `/stella-confirm ${strengthConfirmationId} {"testResults.0.result.value":{"kind":"kg","value":34,"unit":"kg","raw":"34"},"testResults.1.result.value":{"kind":"kg","value":26,"unit":"kg","raw":"26"},"testResults.2.result.value":{"kind":"kg","value":42,"unit":"kg","raw":"42"},"testResults.3.result.value":{"kind":"repetitions","value":9,"raw":"9"}}`,
    );
    let recorded;
    try {
      recorded = await telegram.waitForText((text) =>
        text.startsWith("Workout recorded: stage 1, week 4, friday, strength_test"),
      );
    } catch (error) {
      throw new Error(
        `${String(error)}\nStrength confirmation: ${JSON.stringify(telegram.snapshot())}\nGateway tail: ${gateway.logs().slice(-12_000)}`,
      );
    }
    await restartGateway("pending ordinary workout confirmation");
    telegram.pushText("/stella-facts symbol goblet-squat N");
    await telegram.waitForText((text) => text === "goblet-squat N: 34 kg");
    const observationId = /observation: ([0-9a-f-]{36})/u.exec(recorded)?.[1];
    if (observationId === undefined) {
      throw new Error(`Workout Observation ID was missing: ${recorded}`);
    }
    const observationPath = join(
      personalDataDirectory,
      "observations",
      "workout-log",
      `${observationId}.json`,
    );
    const observation = JSON.parse(readFileSync(observationPath, "utf8"));
    const confirmationRecords = readdirSync(
      join(personalDataDirectory, "processing", "workout-log"),
    )
      .filter((file) => file.endsWith(".json"))
      .map((file) =>
        JSON.parse(
          readFileSync(
            join(personalDataDirectory, "processing", "workout-log", file),
            "utf8",
          ),
        ),
      )
      .filter((record) =>
        record.operation === "workout-log-confirmation" &&
        record.status === "succeeded",
      );
    if (
      observation.provenance?.confirmedFields?.[0] !==
        "testResults[0].result.value" ||
      !confirmationRecords.some((record) =>
        record.result?.observationId === observationId
      )
    ) {
      throw new Error("Telegram channel flow did not persist confirmed facts");
    }
    const expectedRecoveredWeightFacts = await requestTelegramText(
      telegram,
      "/stella-facts weight",
      (text) => text.startsWith("Weight Facts:"),
    );
    const expectedRecoveredStrengthBinding = await requestTelegramText(
      telegram,
      "/stella-facts symbol goblet-squat N",
      (text) => text === "goblet-squat N: 34 kg",
    );

    const canonicalBeforeLifecycle = canonicalDataSnapshot(personalDataDirectory);
    const stableStateId = state.id;
    progress("cycling Plugin disable/enable");
    await stopGateway(gateway);
    gateway = undefined;
    options.run(options.openclaw, ["plugins", "disable", "stella-fitness"]);
    options.run(options.openclaw, ["plugins", "enable", "stella-fitness"]);
    gateway = startGateway(options, gatewayPort);
    gatewayStarts += 1;
    await telegram.waitForCall(
      ({ method, sequence }) => method === "getme" && sequence >= gatewayStarts,
    );
    await assertRecoveredJourney({
      telegram,
      personalDataDirectory,
      stableStateId,
      expectedCanonical: canonicalBeforeLifecycle,
      expectedWeightFacts: expectedRecoveredWeightFacts,
      expectedStrengthBinding: expectedRecoveredStrengthBinding,
      checkpoint: "Plugin disable/enable",
    });

    progress("deleting rebuildable Runtime Directory");
    await stopGateway(gateway);
    gateway = undefined;
    const pluginRuntimeDirectory = join(options.stateDir, "stella-fitness");
    rmSync(pluginRuntimeDirectory, { recursive: true, force: true });
    if (existsSync(pluginRuntimeDirectory)) {
      throw new Error("Runtime Directory was not deleted");
    }
    gateway = startGateway(options, gatewayPort);
    gatewayStarts += 1;
    await telegram.waitForCall(
      ({ method, sequence }) => method === "getme" && sequence >= gatewayStarts,
    );
    await assertRecoveredJourney({
      telegram,
      personalDataDirectory,
      stableStateId,
      expectedCanonical: canonicalBeforeLifecycle,
      expectedWeightFacts: expectedRecoveredWeightFacts,
      expectedStrengthBinding: expectedRecoveredStrengthBinding,
      checkpoint: "Runtime Directory rebuild",
    });

    const factsBeforeLegacyUpgrade = canonicalFactSnapshot(personalDataDirectory);
    const setupPathForUpgrade = join(personalDataDirectory, "program", "setup.json");
    const statePathForUpgrade = join(personalDataDirectory, "program", "state.json");
    const legacySetup = JSON.parse(readFileSync(setupPathForUpgrade, "utf8"));
    const legacyState = JSON.parse(readFileSync(statePathForUpgrade, "utf8"));
    legacySetup.checkpointObservationIds = legacyState.phaseCheckpointObservationIds;
    delete legacyState.setup;
    delete legacyState.phaseCheckpointObservationIds;
    for (const [exerciseId, bindings] of Object.entries(legacyState.symbolicLoadBindings)) {
      delete bindings.A;
      if (Object.keys(bindings).length === 0) {
        delete legacyState.symbolicLoadBindings[exerciseId];
      }
    }
    writeFileSync(setupPathForUpgrade, `${JSON.stringify(legacySetup, null, 2)}\n`);
    writeFileSync(statePathForUpgrade, `${JSON.stringify(legacyState, null, 2)}\n`);
    const firstUpgradeCursor = telegram.messageCount();
    telegram.pushText("/stella-start");
    await telegram.waitForTextAfter(
      firstUpgradeCursor,
      (text) => text.includes("journey: ACTIVE"),
    );
    const upgradedState = readFileSync(statePathForUpgrade, "utf8");
    const upgradedStateValue = JSON.parse(upgradedState);
    if (
      upgradedStateValue.setup?.baselineObservationId === undefined ||
      upgradedStateValue.phaseCheckpointObservationIds?.["4"] === undefined ||
      ["goblet-squat", "dumbbell-bench-press", "dumbbell-deadlift"].some(
        (exerciseId) => upgradedStateValue.symbolicLoadBindings?.[exerciseId]?.A === undefined,
      )
    ) {
      throw new Error(`Legacy Program State upgrade is incomplete: ${upgradedState}`);
    }
    const secondUpgradeCursor = telegram.messageCount();
    telegram.pushText("/stella-start");
    await telegram.waitForTextAfter(
      secondUpgradeCursor,
      (text) => text.includes("journey: ACTIVE"),
    );
    if (readFileSync(statePathForUpgrade, "utf8") !== upgradedState) {
      throw new Error("Legacy Program State upgrade was not idempotent");
    }
    if (
      JSON.stringify(canonicalFactSnapshot(personalDataDirectory)) !==
        JSON.stringify(factsBeforeLegacyUpgrade)
    ) {
      throw new Error("Legacy Program State upgrade changed canonical facts or confirmations");
    }

    const ordinaryConfirmationCursor = telegram.messageCount();
    telegram.pushText(
      `/stella-confirm ${ordinaryConfirmationId} {"exercises.0.load.value":{"kind":"kg","value":20,"unit":"kg","raw":"20"}}`,
    );
    await telegram.waitForTextAfter(
      ordinaryConfirmationCursor,
      (text) => text.startsWith("Workout recorded: stage 1, week 1, monday, full-body"),
    );

    const stateBeforeActionRequired = readFileSync(statePathForUpgrade, "utf8");
    const setupBeforeActionRequired = readFileSync(setupPathForUpgrade, "utf8");
    const actionRequiredFacts = canonicalFactSnapshot(personalDataDirectory);
    const incompleteSetup = JSON.parse(setupBeforeActionRequired);
    const incompleteState = JSON.parse(stateBeforeActionRequired);
    delete incompleteSetup.baselineObservationId;
    delete incompleteState.setup;
    writeFileSync(setupPathForUpgrade, `${JSON.stringify(incompleteSetup, null, 2)}\n`);
    writeFileSync(statePathForUpgrade, `${JSON.stringify(incompleteState, null, 2)}\n`);
    await requestTelegramText(
      telegram,
      "/stella-start",
      (text) =>
        text.includes("journey: BASELINE_WEIGHT_REQUIRED") &&
        text.includes("next: RECORD_BASELINE_WEIGHT"),
    );
    if (
      JSON.stringify(canonicalFactSnapshot(personalDataDirectory)) !==
        JSON.stringify(actionRequiredFacts)
    ) {
      throw new Error("Missing legacy baseline fabricated canonical facts");
    }
    writeFileSync(setupPathForUpgrade, setupBeforeActionRequired);
    const missingASetup = JSON.parse(setupBeforeActionRequired);
    const missingAState = JSON.parse(stateBeforeActionRequired);
    delete missingASetup.initial12RMObservationIds["goblet-squat"];
    delete missingAState.symbolicLoadBindings["goblet-squat"];
    writeFileSync(setupPathForUpgrade, `${JSON.stringify(missingASetup, null, 2)}\n`);
    writeFileSync(statePathForUpgrade, `${JSON.stringify(missingAState, null, 2)}\n`);
    await requestTelegramText(
      telegram,
      "/stella-start",
      (text) =>
        text.includes("journey: INITIAL_12RM_REQUIRED") &&
        text.includes("missing-initial-12rm: goblet-squat") &&
        text.includes("next: RECORD_INITIAL_12RM"),
    );
    if (
      JSON.stringify(canonicalFactSnapshot(personalDataDirectory)) !==
        JSON.stringify(actionRequiredFacts)
    ) {
      throw new Error("Missing legacy A binding fabricated canonical facts");
    }
    writeFileSync(setupPathForUpgrade, setupBeforeActionRequired);
    writeFileSync(statePathForUpgrade, stateBeforeActionRequired);

    const invalidEditCursor = telegram.messageCount();
    telegram.pushText("/stella-weight 2026-08-11T08:00:00.000Z 体重 70 kg");
    const currentWeight = await telegram.waitForTextAfter(
      invalidEditCursor,
      (text) => text.startsWith("Body weight recorded: 70 kg"),
    );
    const currentWeightId = /observation: ([0-9a-f-]{36})/u.exec(currentWeight)?.[1];
    if (currentWeightId === undefined) {
      throw new Error(`Current body-weight Observation ID was missing: ${currentWeight}`);
    }
    const invalidRelativePath = join(
      "observations",
      "body-weight",
      `${currentWeightId}.json`,
    );
    writeFileSync(join(personalDataDirectory, invalidRelativePath), "{}\n");
    const invalidEditFactsCursor = telegram.messageCount();
    telegram.pushText("/stella-facts weight");
    await telegram.waitForTextAfter(
      invalidEditFactsCursor,
      (text) =>
        text.includes(`error: ${invalidRelativePath} - Body-weight Observation is schema-invalid`) &&
        text.includes("baseline: 68.4 kg") &&
        text.includes("week-4: 69 kg") &&
        !text.includes("current: 70 kg"),
    );

    return {
      channel: "telegram",
      dedicatedAgentRouted: true,
      webChatStart: true,
      webChatWorkbookDownload: true,
      builtInProgram: true,
      prerequisites: true,
      prerequisiteReplayIdempotent: true,
      baseline: true,
      baselineConfirmationRecovered: true,
      initial12RM: true,
      activated: true,
      initialBindings: true,
      facts: true,
      nextFacts: true,
      scopeRefusal: true,
      checkpointGate: true,
      weightFacts: true,
      strengthBindings: true,
      factsRecovered: true,
      printableWorkbook: true,
      imageIngress: true,
      gatewayRestarts: gatewayStarts - 1,
      confirmationRecovered: true,
      checkpointRecovered: true,
      pluginDisableEnableRecovered: true,
      runtimeDirectoryRebuilt: true,
      legacyMigrationIdempotent: true,
      pendingConfirmationUpgraded: true,
      legacyActionRequired: true,
      invalidManualEditIsolated: true,
      observationId,
    };
  } finally {
    if (gateway !== undefined) {
      await stopGateway(gateway).catch(() => undefined);
    }
    await telegram.close();
  }
}

function restoreStagedFileName(fileName) {
  return typeof fileName === "string"
    ? fileName.replace(
        /---[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?=\.[^.]+$)/iu,
        "",
      )
    : fileName;
}

async function assertRecoveredJourney(input) {
  const cursor = input.telegram.messageCount();
  input.telegram.pushText("/stella-start");
  await input.telegram.waitForMessageAfter(
    cursor,
    (message) => message.text.includes("journey: ACTIVE"),
  );
  const state = JSON.parse(readFileSync(
    join(input.personalDataDirectory, "program", "state.json"),
    "utf8",
  ));
  if (state.id !== input.stableStateId) {
    throw new Error(`${input.checkpoint} changed the stable Program State ID`);
  }
  const actualCanonical = canonicalDataSnapshot(input.personalDataDirectory);
  if (JSON.stringify(actualCanonical) !== JSON.stringify(input.expectedCanonical)) {
    throw new Error(`${input.checkpoint} changed canonical Personal Data`);
  }
  const weightFacts = await requestTelegramText(
    input.telegram,
    "/stella-facts weight",
    (text) => text.startsWith("Weight Facts:"),
  );
  if (weightFacts !== input.expectedWeightFacts) {
    throw new Error(`${input.checkpoint} changed the rebuilt Weight Facts View`);
  }
  const strengthBinding = await requestTelegramText(
    input.telegram,
    "/stella-facts symbol goblet-squat N",
    (text) => text === "goblet-squat N: 34 kg",
  );
  if (strengthBinding !== input.expectedStrengthBinding) {
    throw new Error(`${input.checkpoint} changed rebuilt strength facts`);
  }
}

async function requestTelegramText(telegram, text, predicate) {
  const cursor = telegram.messageCount();
  telegram.pushText(text);
  return await telegram.waitForTextAfter(cursor, predicate);
}

function canonicalDataSnapshot(root) {
  const files = [];
  const visit = (directory, relativeDirectory = "") => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const relativePath = join(relativeDirectory, entry.name);
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(path, relativePath);
      } else if (entry.isFile()) {
        files.push({
          path: relativePath,
          sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
        });
      }
    }
  };
  visit(root);
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function canonicalFactSnapshot(personalDataDirectory) {
  return canonicalDataSnapshot(personalDataDirectory).filter(({ path }) =>
    path.startsWith(join("observations", "")) ||
    path.startsWith(join("raw-artifacts", "")) ||
    path.startsWith(join("processing", "")) ||
    path.startsWith(join("program", "pending-confirmations", ""))
  );
}


function configureOpenClaw(options, input) {
  const set = (path, value, extra = []) =>
    options.run(options.openclaw, [
      "config",
      "set",
      path,
      JSON.stringify(value),
      "--strict-json",
      ...extra,
    ]);
  set("gateway.mode", "local");
  set("gateway.port", input.gatewayPort);
  set("gateway.auth", { mode: "token", token: GATEWAY_TOKEN });
  set(
    "plugins.allow",
    ["telegram", "stella-fitness", "stella-fitness-e2e-provider"],
    ["--replace"],
  );
  set("plugins.entries.stella-fitness.hooks.allowConversationAccess", true);
  set("plugins.entries.stella-fitness.config", {
    dedicatedAgentId: "fitness",
    personalDataDirectory: input.personalDataDirectory,
    extraction: { provider: "stella-e2e", model: "fixture-v1" },
  });
  set("agents.list", [
    { id: "main" },
    {
      id: "fitness",
      workspace: join(input.personalDataDirectory, "..", "workspace-fitness"),
      model: "stella-e2e/fixture-v1",
    },
  ], ["--replace"]);
  set("bindings", [
    {
      agentId: "fitness",
      match: { channel: "telegram", accountId: "default" },
    },
  ], ["--replace"]);
  set("models.providers.stella-e2e", {
    baseUrl: "http://127.0.0.1:9/v1",
    api: "openai-completions",
    models: [{ id: "fixture-v1", name: "Fixture v1" }],
  });
  set("agents.defaults.models", { "stella-e2e/fixture-v1": {} }, ["--replace"]);
  set("channels.telegram", {
    enabled: true,
    botToken: BOT_TOKEN,
    apiRoot: input.telegramBaseUrl,
    dmPolicy: "allowlist",
    allowFrom: [String(USER_ID)],
    groupPolicy: "disabled",
    capabilities: { inlineButtons: "all" },
    pollingStallThresholdMs: 30_000,
  });
}

async function verifyWebChatFlow(options, gatewayPort) {
  const sessionKey = "agent:fitness:stella-clean-install-webchat";
  const send = (message, idempotencyKey) => options.run(options.openclaw, [
    "gateway",
    "call",
    "chat.send",
    "--expect-final",
    "--json",
    "--token",
    GATEWAY_TOKEN,
    "--timeout",
    String(REQUEST_TIMEOUT_MS),
    "--params",
    JSON.stringify({
      sessionKey,
      agentId: "fitness",
      message,
      deliver: false,
      idempotencyKey,
    }),
  ]);
  const history = () => JSON.parse(options.run(options.openclaw, [
    "gateway",
    "call",
    "chat.history",
    "--json",
    "--token",
    GATEWAY_TOKEN,
    "--params",
    JSON.stringify({ sessionKey, agentId: "fitness", limit: 10 }),
  ]));
  const latestAssistantText = (snapshot) => snapshot.messages
    ?.filter((message) => message.role === "assistant")
    .flatMap((message) => Array.isArray(message.content) ? message.content : [])
    .findLast((content) => content.type === "text")?.text;

  send(
    "/stella-start",
    "adf81630-f739-4d59-b70d-9be6b088a7de",
  );
  const replyText = latestAssistantText(history());
  if (
    typeof replyText !== "string" ||
    !replyText.includes("journey: PREREQUISITES_REQUIRED") ||
    replyText.includes("conversation-binding")
  ) {
    throw new Error(`WebChat dedicated-agent start failed: ${replyText}`);
  }

  send(
    "/stella-print",
    "0149c3d7-bc18-475d-9f5d-9404acdc658e",
  );
  const printReplyText = latestAssistantText(history());
  const downloadPath = typeof printReplyText === "string"
    ? /\[下载 zhuoshu-workout-log\.xlsx\]\((\/plugins\/stella-fitness\/printable-log\/[0-9a-f-]+\/zhuoshu-workout-log\.xlsx)\)/u.exec(printReplyText)?.[1]
    : undefined;
  if (downloadPath === undefined) {
    throw new Error(`WebChat workbook download link missing: ${printReplyText}`);
  }
  const download = await fetch(`http://127.0.0.1:${gatewayPort}${downloadPath}`);
  const workbook = Buffer.from(await download.arrayBuffer());
  if (
    !download.ok ||
    download.headers.get("content-disposition") !==
      'attachment; filename="zhuoshu-workout-log.xlsx"' ||
    workbook.byteLength !== 20_964 ||
    createHash("sha256").update(workbook).digest("hex") !==
      "a113a16f9844ceb518307369bd45979af3aa703e67da8eb3bbb6b5e991aebcca"
  ) {
    throw new Error(
      `WebChat workbook download mismatch: status=${download.status} bytes=${workbook.byteLength}`,
    );
  }
}

function startGateway(options, port) {
  const output = [];
  const child = spawn(
    options.openclaw,
    [
      "gateway",
      "run",
      "--allow-unconfigured",
      "--bind",
      "loopback",
      "--port",
      String(port),
      "--auth",
      "token",
    ],
    {
      cwd: options.workspace,
      env: options.commandEnvironment,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const append = (chunk) => {
    output.push(String(chunk));
    if (output.join("").length > 80_000) output.shift();
  };
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  child.result = new Promise((resolveResult) => {
    child.once("exit", (code, signal) =>
      resolveResult({ code, signal, output: output.join("") }),
    );
  });
  child.logs = () => output.join("");
  return child;
}

async function stopGateway(gateway) {
  if (gateway.exitCode !== null) return;
  gateway.kill("SIGTERM");
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("OpenClaw Gateway did not stop")), 10_000),
  );
  const result = await Promise.race([gateway.result, timeout]);
  if (result.code !== 0 && result.signal !== "SIGTERM") {
    throw new Error(`OpenClaw Gateway failed: ${result.output}`);
  }
}

async function createFakeTelegramApi() {
  const calls = [];
  const messages = [];
  const updates = [];
  let updateId = 1;
  let messageId = 100;
  let inboundMessageId = 1_000;
  let getMeCount = 0;
  const image = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
  const server = createServer(async (request, response) => {
    try {
      if (request.url === `/file/bot${BOT_TOKEN}/photos/workout.png`) {
        response.writeHead(200, { "content-type": "image/png" });
        response.end(image);
        return;
      }
      const method = request.url
        ?.split("?")[0]
        .split("/")
        .filter(Boolean)
        .at(-1)
        ?.toLowerCase();
      const body = await requestBody(request);
      calls.push({ method, body, sequence: method === "getme" ? ++getMeCount : 0 });
      if (method === "getupdates") {
        if (updates.length === 0) await delay(80);
        reply(response, updates.splice(0));
        return;
      }
      if (method === "getme") {
        reply(response, {
          id: BOT_ID,
          is_bot: true,
          first_name: "Stella E2E Bot",
          username: "stella_e2e_bot",
          can_join_groups: true,
          can_read_all_group_messages: false,
          supports_inline_queries: false,
        });
        return;
      }
      if (method === "getfile") {
        reply(response, {
          file_id: "workout-photo",
          file_unique_id: "workout-photo-unique",
          file_size: image.length,
          file_path: "photos/workout.png",
        });
        return;
      }
      if (method === "sendmessage") {
        const platformMessage = {
          message_id: messageId++,
          date: nowSeconds(),
          chat: telegramChat(),
          from: telegramBot(),
          text: String(body.text ?? ""),
          ...(body.reply_markup === undefined
            ? {}
            : { reply_markup: parsedJson(body.reply_markup) }),
        };
        const message = {
          text: platformMessage.text,
          replyMarkup: platformMessage.reply_markup,
          platformMessage,
        };
        messages.push(message);
        reply(response, platformMessage);
        return;
      }
      if (method === "senddocument") {
        reply(response, {
          message_id: messageId++,
          date: nowSeconds(),
          chat: telegramChat(),
          from: telegramBot(),
          document: {
            file_id: "printable-log",
            file_unique_id: "printable-log-unique",
            file_name: "zhuoshu-workout-log.xlsx",
            mime_type: "application/octet-stream",
          },
        });
        return;
      }
      if (method === "getmycommands") {
        reply(response, []);
        return;
      }
      reply(response, true);
    } catch (error) {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: false, description: String(error) }));
    }
  });
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  if (typeof address === "string" || address === null) {
    throw new Error("Fake Telegram server did not expose a TCP port");
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    pushText(text, fixedMessageId) {
      updates.push({
        update_id: updateId++,
        message: userMessage(fixedMessageId ?? inboundMessageId++, { text }),
      });
    },
    pushPhoto(caption) {
      updates.push({
        update_id: updateId++,
        message: userMessage(inboundMessageId++, {
          caption,
          photo: [
            {
              file_id: "workout-photo",
              file_unique_id: "workout-photo-unique",
              width: 1,
              height: 1,
              file_size: image.length,
            },
          ],
        }),
      });
    },
    pushCallback(data, platformMessage) {
      updates.push({
        update_id: updateId++,
        callback_query: {
          id: `callback-${updateId}`,
          from: telegramUser(),
          message: platformMessage,
          chat_instance: "stella-e2e-chat",
          data,
        },
      });
    },
    async waitForText(predicate) {
      return (await waitFor(() => messages.find((message) => predicate(message.text))))
        .text;
    },
    async waitForTextAfter(index, predicate) {
      return (await waitFor(() =>
        messages.slice(index).find((message) => predicate(message.text))
      )).text;
    },
    messageCount() {
      return messages.length;
    },
    callCount() {
      return calls.length;
    },
    waitForMessage(predicate) {
      return waitFor(() => messages.find(predicate));
    },
    waitForMessageAfter(index, predicate) {
      return waitFor(() => messages.slice(index).find(predicate));
    },
    waitForCall(predicate) {
      return waitFor(() => calls.find(predicate));
    },
    waitForCallAfter(index, predicate) {
      return waitFor(() => calls.slice(index).find(predicate));
    },
    snapshot() {
      return {
        messages: messages.map(({ text }) => text),
        calls: calls.slice(-20).map(({ method, body }) => ({ method, body })),
      };
    },
    waitForCallbackData(label) {
      return waitFor(() => {
        for (const { body } of calls) {
          const markup = parsedJson(body.reply_markup ?? body.replyMarkup);
          const button = markup?.inline_keyboard
            ?.flat()
            .find((candidate) => candidate.text === label);
          if (typeof button?.callback_data === "string") {
            return button.callback_data;
          }
        }
        return undefined;
      });
    },
    close() {
      return new Promise((resolveClose, reject) =>
        server.close((error) => error ? reject(error) : resolveClose()),
      );
    },
  };
}

function userMessage(messageId, content) {
  return {
    message_id: messageId,
    date: nowSeconds(),
    chat: telegramChat(),
    from: telegramUser(),
    ...content,
  };
}

function telegramChat() {
  return { id: CHAT_ID, type: "private", first_name: "Stella E2E" };
}

function telegramUser() {
  return {
    id: USER_ID,
    is_bot: false,
    first_name: "Stella E2E User",
    username: "stella_e2e_user",
    language_code: "zh-hans",
  };
}

function telegramBot() {
  return {
    id: BOT_ID,
    is_bot: true,
    first_name: "Stella E2E Bot",
    username: "stella_e2e_bot",
  };
}

async function requestBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const bytes = Buffer.concat(chunks);
  if (bytes.length === 0) return {};
  const contentType = request.headers["content-type"] ?? "";
  if (contentType.includes("application/json")) {
    return JSON.parse(bytes.toString("utf8"));
  }
  if (contentType.includes("multipart/form-data")) {
    return multipartFileSummary(bytes, contentType);
  }
  return Object.fromEntries(new URLSearchParams(bytes.toString("utf8")));
}

function multipartFileSummary(bytes, contentType) {
  const boundary = /boundary="?([^";]+)"?/u.exec(contentType)?.[1];
  if (boundary === undefined) return { multipart: true, bytes: bytes.length };
  const separator = Buffer.from(`\r\n--${boundary}`);
  let cursor = 0;
  while (cursor < bytes.length) {
    const headerEnd = bytes.indexOf(Buffer.from("\r\n\r\n"), cursor);
    if (headerEnd < 0) break;
    const headers = bytes.subarray(cursor, headerEnd).toString("latin1");
    const fileNameMatch = /filename=(?:"([^"]+)"|([^;\r\n]+))/iu.exec(headers);
    const fileName = fileNameMatch?.[1] ?? fileNameMatch?.[2]?.trim();
    const bodyStart = headerEnd + 4;
    const bodyEnd = bytes.indexOf(separator, bodyStart);
    if (bodyEnd < 0) break;
    if (fileName !== undefined) {
      const file = bytes.subarray(bodyStart, bodyEnd);
      return {
        fileName,
        mimeType: /content-type:\s*([^\r\n]+)/iu.exec(headers)?.[1],
        bytes: file.length,
        sha256: createHash("sha256").update(file).digest("hex"),
      };
    }
    cursor = bodyEnd + separator.length;
  }
  return { multipart: true, bytes: bytes.length };
}

function parsedJson(value) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function reply(response, result) {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({ ok: true, result }));
}

async function availablePort() {
  const server = createTcpServer();
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  await new Promise((resolveClose) => server.close(resolveClose));
  if (port === 0) throw new Error("Could not allocate an OpenClaw Gateway port");
  return port;
}

async function waitFor(read) {
  const deadline = Date.now() + REQUEST_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const result = read();
    if (result !== undefined) return result;
    await delay(50);
  }
  throw new Error("Timed out waiting for Telegram channel E2E event");
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function nowSeconds() {
  return Math.floor(Date.now() / 1_000);
}
