import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { createServer as createTcpServer } from "node:net";
import { join, resolve } from "node:path";

const BOT_TOKEN = "123456789:stella-fitness-e2e";
const USER_ID = 424242;
const CHAT_ID = 515151;
const BOT_ID = 616161;
const REQUEST_TIMEOUT_MS = 20_000;

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

    telegram.pushText("/stella-start");
    const approval = await telegram.waitForMessage((message) =>
      message.text.includes("Plugin bind approval required"),
    );
    const approvalData = await telegram.waitForCallbackData("Always allow");
    telegram.pushCallback(approvalData, approval.platformMessage);
    await telegram.waitForCall(({ method }) => method === "answercallbackquery");
    await restartGateway("conversation binding approval");

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
        acknowledgement.source?.channel !== "telegram" ||
        typeof acknowledgement.source?.messageId !== "string" ||
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
    telegram.pushText("/stella-activate 2026-08-10");
    const activation = await telegram.waitForText((text) =>
      text.startsWith("Program State activated:") &&
      text.includes("today Planned Session: 2026-08-10") &&
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
    telegram.pushText("/stella-facts today 2026-08-10");
    const today = await telegram.waitForText((text) =>
      text.startsWith("today Planned Session: 2026-08-10"),
    );
    telegram.pushText("/stella-facts next 2026-08-10");
    await telegram.waitForText((text) =>
      text.startsWith("next Planned Session: 2026-08-12"),
    );
    telegram.pushText("我应该怎么调整训练和饮食？");
    await telegram.waitForText((text) =>
      text.includes("only reports source-program, Program State and recorded facts") &&
      text.includes("does not diagnose, advise or adjust the plan"),
    );
    await restartGateway("Program Facts questions");
    const recoveryMessageCursor = telegram.messageCount();
    telegram.pushText("/stella-facts today 2026-08-10");
    const recoveredToday = await telegram.waitForTextAfter(recoveryMessageCursor, (text) =>
      text.startsWith("today Planned Session: 2026-08-10"),
    );
    if (today !== recoveredToday || !activation.includes(today)) {
      throw new Error("Program Facts changed after Gateway restart");
    }
    telegram.pushText("/stella-print today 2026-08-10");
    await telegram.waitForCall(({ method }) => method === "senddocument");

    telegram.pushPhoto("训练日志");
    const pending = await telegram.waitForText((text) =>
      text.includes("Workout log needs confirmation:"),
    );
    const confirmationId =
      /Workout log needs confirmation: ([0-9a-f-]{36})/u.exec(pending)?.[1];
    if (confirmationId === undefined) {
      throw new Error(`Workout confirmation ID was missing: ${pending}`);
    }

    await restartGateway("pending workout-log confirmation");

    telegram.pushText(
      `/stella-confirm ${confirmationId} {"exercises[0].load.value":{"kind":"kg","value":20,"unit":"kg","raw":"20"}}`,
    );
    let recorded;
    try {
      recorded = await telegram.waitForText((text) =>
        text.startsWith("Workout recorded: stage 1, week 1, monday, full-body"),
      );
    } catch (error) {
      throw new Error(
        `${String(error)}\nTelegram: ${JSON.stringify(telegram.snapshot())}\nGateway tail: ${gateway.logs().slice(-12_000)}`,
      );
    }
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
        "exercises[0].load.value" ||
      confirmationRecords.length !== 1
    ) {
      throw new Error("Telegram channel flow did not persist confirmed facts");
    }

    return {
      channel: "telegram",
      bindingApproved: true,
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
      factsRecovered: true,
      printablePdf: true,
      imageIngress: true,
      gatewayRestarts: gatewayStarts - 1,
      confirmationRecovered: true,
      observationId,
    };
  } finally {
    if (gateway !== undefined) {
      await stopGateway(gateway).catch(() => undefined);
    }
    await telegram.close();
  }
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
  set(
    "plugins.allow",
    ["telegram", "stella-fitness", "stella-fitness-e2e-provider"],
    ["--replace"],
  );
  set("plugins.entries.stella-fitness.hooks.allowConversationAccess", true);
  set("plugins.entries.stella-fitness.config", {
    personalDataDirectory: input.personalDataDirectory,
    extraction: { provider: "stella-e2e", model: "fixture-v1" },
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
      "none",
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
            file_name: "stella-printable-log.pdf",
            mime_type: "application/pdf",
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
    waitForMessage(predicate) {
      return waitFor(() => messages.find(predicate));
    },
    waitForCall(predicate) {
      return waitFor(() => calls.find(predicate));
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
  const source = Buffer.concat(chunks).toString("utf8");
  if (!source) return {};
  if (request.headers["content-type"]?.includes("application/json")) {
    return JSON.parse(source);
  }
  return Object.fromEntries(new URLSearchParams(source));
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
