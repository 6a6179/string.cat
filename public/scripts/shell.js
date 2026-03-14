(() => {
const shellData = window.__STRING_CAT_SHELL_DATA__;

if (!shellData) {
  throw new Error("Shell data failed to load.");
}

const { bootLines, fileSystem, shellConfig } = shellData;

const $ = (selector) => document.querySelector(selector);

const shellBody = $("#shell-body");
const historyNode = $("#history");
const form = $("#command-form");
const input = $("#command-input");
const promptPathNode = $("#prompt-path");
const shellTitleNode = $("#shell-title");
const yearNode = $("#year");

yearNode.textContent = new Date().getFullYear();

const state = {
  cwd: shellConfig.home,
  previousDirectory: shellConfig.home,
  commandHistory: [],
  historyIndex: -1,
  draft: "",
  lastStatus: 0,
  lastCompletionKey: "",
  sessionStartedAt: Date.now()
};

const aliases = Object.freeze({
  "?": "help",
  la: "ls -a",
  ll: "ls -la",
  printenv: "env"
});

const unsupportedCommands = new Set([
  "cp",
  "curl",
  "git",
  "mkdir",
  "mv",
  "nano",
  "rm",
  "ssh",
  "sudo",
  "touch",
  "vim"
]);

const view = {
  empty(status = 0) {
    return { kind: "empty", status };
  },

  clear() {
    return { kind: "clear", status: 0 };
  },

  lines(lines, options = {}) {
    return {
      kind: "lines",
      lines: Array.isArray(lines) ? lines : [lines],
      status: options.status ?? 0,
      tone: options.tone || ""
    };
  },

  error(lines) {
    return {
      kind: "lines",
      lines: Array.isArray(lines) ? lines : [lines],
      status: 1,
      tone: "error"
    };
  }
};

const commands = {
  help: {
    description: "show available commands",
    usage: "help [command]",
    details: "List available commands or show a short summary for one command.",
    examples: ["help", "help ls"],
    run(args) {
      if (args.length > 1) {
        return view.error(["usage: help [command]"]);
      }

      if (args.length === 1) {
        const resolvedName = resolveCommandName(args[0]);
        const command = commands[resolvedName];

        if (!command) {
          return view.error([`help: no such command: ${args[0]}`]);
        }

        return view.lines(buildManual(resolvedName, command));
      }

      const names = Object.keys(commands).sort();
      const width = Math.max(...names.map((name) => name.length)) + 2;
      const lines = names.map((name) =>
        segmentedLine([
          segment(name.padEnd(width, " "), "token-accent"),
          segment(commands[name].description)
        ])
      );

      lines.push("");
      lines.push(textLine("aliases: ?, la, ll, printenv", "line-dim"));
      return view.lines(lines);
    }
  },

  man: {
    description: "show a command manual page",
    usage: "man <command>",
    details: "Display a short manual entry for an available shell command.",
    examples: ["man cd", "man tree"],
    run(args) {
      if (args.length !== 1) {
        return view.error(["usage: man <command>"]);
      }

      const resolvedName = resolveCommandName(args[0]);
      const command = commands[resolvedName];

      if (!command) {
        return view.error([`No manual entry for ${args[0]}`]);
      }

      return view.lines(buildManual(resolvedName, command));
    }
  },

  pwd: {
    description: "print working directory",
    usage: "pwd",
    details: "Print the current working directory.",
    examples: ["pwd"],
    run(args) {
      if (args.length > 0) {
        return view.error(["usage: pwd"]);
      }

      return view.lines([state.cwd]);
    }
  },

  cd: {
    description: "change current directory",
    usage: "cd [path]",
    details: "Change the current working directory. With no argument it returns to the home directory.",
    examples: ["cd bin", "cd /var/log", "cd -"],
    run(args) {
      if (args.length > 1) {
        return view.error(["usage: cd [path]"]);
      }

      const targetArg = args[0] || "~";
      const nextPath = targetArg === "-" ? state.previousDirectory : resolvePath(targetArg);
      const node = getNode(nextPath);

      if (!node) {
        return view.error([`cd: ${targetArg}: No such file or directory`]);
      }

      if (node.type !== "directory") {
        return view.error([`cd: ${targetArg}: Not a directory`]);
      }

      const previous = state.cwd;
      state.cwd = nextPath;
      state.previousDirectory = previous;
      updatePrompt();

      if (targetArg === "-") {
        return view.lines([nextPath]);
      }

      return view.empty();
    }
  },

  ls: {
    description: "list directory contents",
    usage: "ls [-al] [path ...]",
    details: "List files from the current directory or a requested path. Use -a to include dotfiles and -l for long format.",
    examples: ["ls", "ls -la", "ls /var/log"],
    run(args) {
      const parsed = parseShortFlags(args, new Set(["a", "l"]), "ls");

      if (parsed.error) {
        return parsed.error;
      }

      const includeHidden = parsed.flags.has("a");
      const longFormat = parsed.flags.has("l");
      const operands = parsed.operands.length > 0 ? parsed.operands : ["."];
      const lines = [];
      const multipleTargets = operands.length > 1;
      let hadError = false;

      operands.forEach((operand, index) => {
        const resolved = resolvePath(operand);
        const node = getNode(resolved);

        if (!node) {
          lines.push(textLine(`ls: cannot access '${operand}': No such file or directory`, "line-error"));
          hadError = true;
          return;
        }

        if (multipleTargets) {
          if (index > 0) {
            lines.push("");
          }

          lines.push(textLine(`${operand}:`, "line-heading"));
        }

        if (node.type === "file") {
          if (longFormat) {
            lines.push(formatLongEntry(resolved, node, basename(resolved)));
          } else {
            lines.push(segmentedLine([nameSegment(node, basename(resolved))]));
          }

          return;
        }

        getDirectoryEntries(resolved, node, {
          includeHidden,
          includeNavigation: includeHidden
        }).forEach((entry) => {
          lines.push(
            longFormat
              ? formatLongEntry(entry.path, entry.node, entry.name)
              : segmentedLine([nameSegment(entry.node, entry.name)])
          );
        });
      });

      return view.lines(lines, { status: hadError ? 1 : 0 });
    }
  },

  tree: {
    description: "show a directory tree",
    usage: "tree [-a] [path]",
    details: "Render a small ASCII directory tree. Hidden files stay hidden unless -a is used.",
    examples: ["tree", "tree bin", "tree -a /home/visitor"],
    run(args) {
      const parsed = parseShortFlags(args, new Set(["a"]), "tree");

      if (parsed.error) {
        return parsed.error;
      }

      if (parsed.operands.length > 1) {
        return view.error(["usage: tree [-a] [path]"]);
      }

      const includeHidden = parsed.flags.has("a");
      const operand = parsed.operands[0] || ".";
      const resolved = resolvePath(operand);
      const node = getNode(resolved);

      if (!node) {
        return view.error([`tree: ${operand}: No such file or directory`]);
      }

      if (node.type !== "directory") {
        return view.lines([segmentedLine([nameSegment(node, basename(resolved) || resolved)])]);
      }

      const treeResult = buildTree(resolved, node, includeHidden);
      const lines = [
        segmentedLine([nameSegment(node, basename(resolved) || resolved)]),
        ...treeResult.lines,
        "",
        `${treeResult.directoryCount} directories, ${treeResult.fileCount} files`
      ];

      return view.lines(lines);
    }
  },

  cat: {
    description: "print file contents",
    usage: "cat <file ...>",
    details: "Print one or more text files from the fake filesystem.",
    examples: ["cat about.txt", "cat services.txt contact.txt"],
    run(args) {
      if (args.length === 0) {
        return view.error(["usage: cat <file ...>"]);
      }

      const lines = [];
      let hadError = false;

      args.forEach((operand, index) => {
        const resolved = resolvePath(operand);
        const node = getNode(resolved);

        if (!node) {
          lines.push(textLine(`cat: ${operand}: No such file or directory`, "line-error"));
          hadError = true;
          return;
        }

        if (node.type !== "file") {
          lines.push(textLine(`cat: ${operand}: Is a directory`, "line-error"));
          hadError = true;
          return;
        }

        if (args.length > 1) {
          if (index > 0) {
            lines.push("");
          }

          lines.push(textLine(`==> ${operand} <==`, "line-dim"));
        }

        node.content.split("\n").forEach((line) => {
          lines.push(line);
        });
      });

      return view.lines(lines, { status: hadError ? 1 : 0 });
    }
  },

  file: {
    description: "describe a path",
    usage: "file <path ...>",
    details: "Print a simple file-type description for one or more paths.",
    examples: ["file about.txt", "file /srv/http/index.html"],
    run(args) {
      if (args.length === 0) {
        return view.error(["usage: file <path ...>"]);
      }

      const lines = [];
      let hadError = false;

      args.forEach((operand) => {
        const resolved = resolvePath(operand);
        const node = getNode(resolved);

        if (!node) {
          lines.push(textLine(`file: cannot open '${operand}'`, "line-error"));
          hadError = true;
          return;
        }

        lines.push(`${operand}: ${describeNode(node)}`);
      });

      return view.lines(lines, { status: hadError ? 1 : 0 });
    }
  },

  stat: {
    description: "show path metadata",
    usage: "stat <path ...>",
    details: "Print metadata about one or more filesystem entries.",
    examples: ["stat about.txt", "stat /var/log/mail.log"],
    run(args) {
      if (args.length === 0) {
        return view.error(["usage: stat <path ...>"]);
      }

      const lines = [];
      let hadError = false;

      args.forEach((operand, index) => {
        const resolved = resolvePath(operand);
        const node = getNode(resolved);

        if (!node) {
          lines.push(textLine(`stat: cannot stat '${operand}': No such file or directory`, "line-error"));
          hadError = true;
          return;
        }

        if (index > 0) {
          lines.push("");
        }

        lines.push(`  File: ${resolved}`);
        lines.push(`  Size: ${String(getNodeSize(node)).padEnd(8, " ")} Type: ${node.type === "directory" ? "directory" : "regular file"}`);
        lines.push(`Access: (${modeToOctal(node.mode)}/${node.mode})  Uid: (${lookupUid(node.owner)}/${node.owner})   Gid: (${lookupGid(node.group)}/${node.group})`);
        lines.push(`Modify: ${formatStatTimestamp(node.mtime)}`);
      });

      return view.lines(lines, { status: hadError ? 1 : 0 });
    }
  },

  whoami: {
    description: "print current user",
    usage: "whoami",
    details: "Print the current login name.",
    examples: ["whoami"],
    run(args) {
      if (args.length > 0) {
        return view.error(["usage: whoami"]);
      }

      return view.lines([shellConfig.user]);
    }
  },

  id: {
    description: "print user and group IDs",
    usage: "id",
    details: "Print the numeric user and group identifiers for the current shell user.",
    examples: ["id"],
    run(args) {
      if (args.length > 0) {
        return view.error(["usage: id"]);
      }

      return view.lines([
        `uid=${lookupUid(shellConfig.user)}(${shellConfig.user}) gid=${lookupGid(shellConfig.group)}(${shellConfig.group}) groups=${lookupGid(shellConfig.group)}(${shellConfig.group})`
      ]);
    }
  },

  hostname: {
    description: "print host name",
    usage: "hostname",
    details: "Print the current host name.",
    examples: ["hostname"],
    run(args) {
      if (args.length > 0) {
        return view.error(["usage: hostname"]);
      }

      return view.lines([shellConfig.host]);
    }
  },

  uname: {
    description: "print system information",
    usage: "uname [-a]",
    details: "Print the operating system name. Use -a for the full fake kernel string.",
    examples: ["uname", "uname -a"],
    run(args) {
      const parsed = parseShortFlags(args, new Set(["a"]), "uname");

      if (parsed.error) {
        return parsed.error;
      }

      if (parsed.operands.length > 0) {
        return view.error(["usage: uname [-a]"]);
      }

      if (parsed.flags.has("a")) {
        return view.lines([
          `${shellConfig.os} ${shellConfig.host} ${shellConfig.kernel} #1 SMP PREEMPT_DYNAMIC ${shellConfig.arch} GNU/Linux`
        ]);
      }

      return view.lines([shellConfig.os]);
    }
  },

  date: {
    description: "print the current date",
    usage: "date [-u]",
    details: "Print the current local time or UTC with -u.",
    examples: ["date", "date -u"],
    run(args) {
      if (args.length > 1) {
        return view.error(["usage: date [-u]"]);
      }

      if (args.length === 1 && args[0] !== "-u") {
        return view.error([`date: invalid option -- '${args[0].replace(/^-+/, "")}'`]);
      }

      const now = new Date();
      return view.lines([args[0] === "-u" ? now.toUTCString() : now.toString()]);
    }
  },

  uptime: {
    description: "show session uptime",
    usage: "uptime",
    details: "Print how long this page session has been open.",
    examples: ["uptime"],
    run(args) {
      if (args.length > 0) {
        return view.error(["usage: uptime"]);
      }

      return view.lines([`up ${formatDuration(Date.now() - state.sessionStartedAt)}`]);
    }
  },

  echo: {
    description: "print text",
    usage: "echo [-n] [text ...]",
    details: "Print arguments after variable expansion. The visual shell still renders on a new line.",
    examples: ["echo $PWD", "echo hello world"],
    run(args) {
      let index = 0;

      while (args[index] === "-n") {
        index += 1;
      }

      return view.lines([args.slice(index).join(" ")]);
    }
  },

  env: {
    description: "print environment variables",
    usage: "env",
    details: "Print the small environment exported by the fake shell.",
    examples: ["env"],
    run(args) {
      if (args.length > 0) {
        return view.error(["usage: env"]);
      }

      return view.lines(
        Object.entries(getEnvironment())
          .filter(([name]) => name !== "?")
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([name, value]) => `${name}=${value}`)
      );
    }
  },

  history: {
    description: "show command history",
    usage: "history",
    details: "Print the commands entered in this page session.",
    examples: ["history"],
    run(args) {
      if (args.length > 0) {
        return view.error(["usage: history"]);
      }

      return view.lines(
        state.commandHistory.map(
          (command, index) => `${String(index + 1).padStart(4, " ")}  ${command}`
        )
      );
    }
  },

  clear: {
    description: "clear terminal history",
    usage: "clear",
    details: "Clear the visible terminal history.",
    examples: ["clear"],
    run(args) {
      if (args.length > 0) {
        return view.error(["usage: clear"]);
      }

      return view.clear();
    }
  },

  exit: {
    description: "close the pretend session",
    usage: "exit",
    details: "Log out of the pretend session without leaving the page.",
    examples: ["exit"],
    run(args) {
      if (args.length > 0) {
        return view.error(["usage: exit"]);
      }

      return view.lines([
        "logout",
        "Session remains attached; reload the page to reconnect."
      ]);
    }
  }
};

init();

function init() {
  updatePrompt();
  appendBootSequence();
  focusInput();

  form.addEventListener("submit", handleSubmit);
  input.addEventListener("keydown", handleInputKeyDown);
  input.addEventListener("input", () => {
    state.lastCompletionKey = "";
  });

  shellBody.addEventListener("pointerdown", () => {
    requestAnimationFrame(() => {
      focusInput();
    });
  });

  document.addEventListener("keydown", (event) => {
    if (document.activeElement === input) {
      return;
    }

    if (event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }

    if (event.key.length === 1 || event.key === "Backspace") {
      focusInput();
    }
  });
}

function handleSubmit(event) {
  event.preventDefault();

  const raw = input.value;
  const trimmed = raw.trim();

  if (!trimmed) {
    input.value = "";
    focusInput();
    return;
  }

  const promptSnapshot = formatPromptPath(state.cwd);
  pushHistory(raw);
  const response = execute(raw);

  if (response.kind === "clear") {
    historyNode.replaceChildren();
  } else {
    appendEntry(raw, response, promptSnapshot);
  }

  state.lastStatus = response.status ?? 0;
  input.value = "";
  resetHistoryNavigation();
  state.lastCompletionKey = "";
  scrollToBottom();
  focusInput();
}

function handleInputKeyDown(event) {
  if (event.ctrlKey && event.key.toLowerCase() === "l") {
    event.preventDefault();
    clearScreen();
    return;
  }

  if (event.ctrlKey && event.key.toLowerCase() === "c") {
    event.preventDefault();
    input.value = "";
    state.lastStatus = 130;
    state.lastCompletionKey = "";
    return;
  }

  if (event.key === "ArrowUp") {
    event.preventDefault();
    navigateHistory(-1);
    return;
  }

  if (event.key === "ArrowDown") {
    event.preventDefault();
    navigateHistory(1);
    return;
  }

  if (event.key === "Tab") {
    event.preventDefault();
    attemptCompletion();
    return;
  }

  if (event.key === "Escape") {
    input.value = "";
    resetHistoryNavigation();
    state.lastCompletionKey = "";
  }
}

function execute(raw) {
  const parsed = tokenize(raw.trim());

  if (parsed.error) {
    return view.error([parsed.error]);
  }

  const expandedTokens = applyAlias(parsed.tokens);
  const [name, ...args] = expandedTokens;

  if (!name) {
    return view.empty();
  }

  if (unsupportedCommands.has(name)) {
    const message =
      name === "sudo"
        ? "sudo: this session is read-only"
        : `${name}: command is unavailable in this read-only shell`;

    return view.error([message]);
  }

  const command = commands[name];

  if (!command) {
    const executable = resolveExecutable(name);

    if (executable) {
      return runExecutable(executable, args);
    }

    return view.error([
      `command not found: ${name}`,
      'type "help" to see available commands'
    ]);
  }

  return command.run(args);
}

function resolveExecutable(name) {
  if (!name) {
    return null;
  }

  if (name.includes("/")) {
    const path = resolvePath(name);
    const node = getNode(path);

    if (!node) {
      return { name, path, node: null };
    }

    return { name, path, node };
  }

  for (const basePath of getSearchPaths()) {
    const path = joinPath(basePath, name);
    const node = getNode(path);

    if (node) {
      return { name, path, node };
    }
  }

  return null;
}

function runExecutable(executable, args) {
  if (!executable.node) {
    return view.error([`${executable.name}: No such file or directory`]);
  }

  if (executable.node.type === "directory") {
    return view.error([`${executable.name}: is a directory`]);
  }

  if (!executable.node.executable) {
    return view.error([`${executable.name}: Permission denied`]);
  }

  return executeScriptFile(executable, args);
}

function executeScriptFile(executable, args) {
  const lines = executable.node.content.split("\n");
  const body = lines[0].startsWith("#!") ? lines.slice(1) : lines;
  const output = [];

  body.forEach((line) => {
    const trimmed = line.trim();

    if (!trimmed) {
      return;
    }

    if (trimmed.startsWith("echo ")) {
      output.push(expandEchoArgument(trimmed.slice(5), executable.path, args));
      return;
    }

    output.push(`${basename(executable.path)}: unsupported script instruction: ${trimmed}`);
  });

  return view.lines(output);
}

function expandEchoArgument(source, scriptPath, args) {
  let text = source.trim();

  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    text = text.slice(1, -1);
  }

  return text
    .replace(/\$0/g, basename(scriptPath))
    .replace(/\$\*/g, args.join(" "))
    .replace(/\$@/g, args.join(" "));
}

function appendBootSequence() {
  const lines = [
    textLine(`Last login: ${formatBootTimestamp(new Date())} on tty1`, "line-dim"),
    "",
    textLine(bootLines[0], "line-heading"),
    textLine(bootLines[1], "line-dim"),
    textLine(bootLines[2], "line-dim"),
    textLine("Up/down recalls history. Ctrl+L clears the screen.", "line-dim")
  ];

  appendSystemOutput(view.lines(lines), "system");
}

function appendEntry(commandText, response, promptPath) {
  const entry = document.createElement("div");
  entry.className = `entry ${response.tone || ""}`.trim();
  entry.append(createPrompt(commandText, promptPath));

  if (response.kind !== "empty") {
    entry.append(createOutput(response));
  }

  historyNode.append(entry);
}

function appendSystemOutput(response, className = "system") {
  const entry = document.createElement("div");
  entry.className = `entry ${className}`.trim();
  entry.append(createOutput(response));
  historyNode.append(entry);
}

function createPrompt(commandText, promptPath) {
  const row = document.createElement("div");
  row.className = "prompt";

  const label = document.createElement("span");
  label.className = "prompt-label";
  label.append(
    createTokenSpan(shellConfig.user, "prompt-user"),
    document.createTextNode("@"),
    createTokenSpan(shellConfig.host, "prompt-host"),
    document.createTextNode(":"),
    createTokenSpan(promptPath, "prompt-path"),
    document.createTextNode("$")
  );

  const command = document.createElement("span");
  command.className = "command";
  command.textContent = commandText;

  row.append(label, command);
  return row;
}

function createOutput(response) {
  const output = document.createElement("div");
  output.className = `output ${response.tone || ""}`.trim();

  response.lines.forEach((line) => {
    output.append(createLineNode(line));
  });

  return output;
}

function createLineNode(line) {
  const node = document.createElement("div");
  node.className = "line";

  if (typeof line === "string") {
    node.textContent = line || " ";
    return node;
  }

  if (line.className) {
    node.classList.add(line.className);
  }

  if (typeof line.text === "string") {
    node.textContent = line.text || " ";
    return node;
  }

  (line.segments || []).forEach((part) => {
    node.append(createTokenSpan(part.text, part.className));
  });

  if (!line.segments || line.segments.length === 0) {
    node.textContent = " ";
  }

  return node;
}

function createTokenSpan(text, className = "") {
  const span = document.createElement("span");
  span.textContent = text;

  if (className) {
    span.className = className;
  }

  return span;
}

function navigateHistory(direction) {
  if (state.commandHistory.length === 0) {
    return;
  }

  if (state.historyIndex === -1) {
    state.draft = input.value;
  }

  if (direction < 0) {
    state.historyIndex =
      state.historyIndex === -1
        ? state.commandHistory.length - 1
        : Math.max(0, state.historyIndex - 1);
  } else if (state.historyIndex === -1) {
    return;
  } else if (state.historyIndex >= state.commandHistory.length - 1) {
    state.historyIndex = -1;
    input.value = state.draft;
    focusInput();
    return;
  } else {
    state.historyIndex += 1;
  }

  input.value = state.commandHistory[state.historyIndex];
  focusInput();
}

function pushHistory(raw) {
  state.commandHistory.push(raw);

  if (state.commandHistory.length > 200) {
    state.commandHistory.shift();
  }

  resetHistoryNavigation();
}

function resetHistoryNavigation() {
  state.historyIndex = -1;
  state.draft = "";
}

function clearScreen() {
  historyNode.replaceChildren();
  state.lastStatus = 0;
  state.lastCompletionKey = "";
  scrollToBottom();
  focusInput();
}

function focusInput() {
  input.focus();
  const end = input.value.length;
  input.setSelectionRange(end, end);
}

function scrollToBottom() {
  requestAnimationFrame(() => {
    shellBody.scrollTop = shellBody.scrollHeight;
  });
}

function updatePrompt() {
  const promptPath = formatPromptPath(state.cwd);
  promptPathNode.textContent = promptPath;
  shellTitleNode.textContent = `${shellConfig.user}@${shellConfig.host}:${promptPath}`;
}

function tokenize(source) {
  const tokens = [];
  let current = "";
  let quote = "";
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];

    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (!quote && (char === "|" || char === ";" || char === "&")) {
      return {
        error: "pipelines and command chaining are not available in this shell"
      };
    }

    if (quote === "'") {
      if (char === "'") {
        quote = "";
      } else {
        current += char;
      }

      continue;
    }

    if (quote === '"') {
      if (char === '"') {
        quote = "";
        continue;
      }

      if (char === "\\") {
        escaped = true;
        continue;
      }

      if (char === "$") {
        const expansion = readVariable(source, index);

        if (expansion) {
          current += expansion.value;
          index = expansion.endIndex;
          continue;
        }
      }

      current += char;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }

      continue;
    }

    if (char === "$") {
      const expansion = readVariable(source, index);

      if (expansion) {
        current += expansion.value;
        index = expansion.endIndex;
        continue;
      }
    }

    current += char;
  }

  if (quote) {
    return { error: "unterminated quote" };
  }

  if (escaped) {
    return { error: "unfinished escape sequence" };
  }

  if (current) {
    tokens.push(current);
  }

  return { tokens };
}

function readVariable(source, index) {
  const next = source[index + 1];

  if (!next) {
    return null;
  }

  if (next === "?") {
    return {
      value: String(state.lastStatus),
      endIndex: index + 1
    };
  }

  if (!/[A-Za-z_]/.test(next)) {
    return null;
  }

  let endIndex = index + 1;

  while (/[A-Za-z0-9_]/.test(source[endIndex + 1] || "")) {
    endIndex += 1;
  }

  const name = source.slice(index + 1, endIndex + 1);
  return {
    value: getEnvironment()[name] ?? "",
    endIndex
  };
}

function applyAlias(tokens) {
  if (tokens.length === 0) {
    return tokens;
  }

  const alias = aliases[tokens[0]];

  if (!alias) {
    return tokens;
  }

  const parsed = tokenize(alias);
  return parsed.tokens ? [...parsed.tokens, ...tokens.slice(1)] : tokens;
}

function resolveCommandName(name) {
  const expanded = applyAlias([name]);
  return expanded[0];
}

function parseShortFlags(args, allowedFlags, commandName) {
  const flags = new Set();
  const operands = [];
  let parsingFlags = true;

  for (const arg of args) {
    if (parsingFlags && arg === "--") {
      parsingFlags = false;
      continue;
    }

    if (parsingFlags && arg.startsWith("-") && arg.length > 1) {
      for (const flag of arg.slice(1)) {
        if (!allowedFlags.has(flag)) {
          return {
            error: view.error([`${commandName}: invalid option -- '${flag}'`])
          };
        }

        flags.add(flag);
      }

      continue;
    }

    operands.push(arg);
  }

  return { flags, operands };
}

function resolvePath(inputPath) {
  if (!inputPath || inputPath === ".") {
    return state.cwd;
  }

  let raw = inputPath;

  if (raw === "~") {
    raw = shellConfig.home;
  } else if (raw.startsWith("~/")) {
    raw = `${shellConfig.home}/${raw.slice(2)}`;
  } else if (!raw.startsWith("/")) {
    raw = state.cwd === "/" ? `/${raw}` : `${state.cwd}/${raw}`;
  }

  return normalizePath(raw);
}

function normalizePath(path) {
  const isAbsolute = path.startsWith("/");
  const parts = [];

  path.split("/").forEach((part) => {
    if (!part || part === ".") {
      return;
    }

    if (part === "..") {
      parts.pop();
      return;
    }

    parts.push(part);
  });

  if (!isAbsolute) {
    return parts.join("/") || ".";
  }

  return `/${parts.join("/")}`.replace(/\/+/g, "/") || "/";
}

function getNode(path) {
  const normalized = normalizePath(path);

  if (normalized === "/") {
    return fileSystem;
  }

  let node = fileSystem;

  for (const part of normalized.slice(1).split("/")) {
    if (!node || node.type !== "directory") {
      return null;
    }

    node = node.children[part];
  }

  return node || null;
}

function joinPath(parent, name) {
  return parent === "/" ? `/${name}` : `${parent}/${name}`;
}

function parentPath(path) {
  if (path === "/") {
    return "/";
  }

  const parts = path.split("/").filter(Boolean);
  parts.pop();
  return parts.length ? `/${parts.join("/")}` : "/";
}

function basename(path) {
  if (path === "/") {
    return "/";
  }

  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] || "/";
}

function formatPromptPath(path) {
  if (path === shellConfig.home) {
    return "~";
  }

  if (path.startsWith(`${shellConfig.home}/`)) {
    return `~/${path.slice(shellConfig.home.length + 1)}`;
  }

  return path;
}

function getDirectoryEntries(path, node, options = {}) {
  const includeHidden = Boolean(options.includeHidden);
  const includeNavigation = Boolean(options.includeNavigation);
  const entries = [];

  if (includeNavigation) {
    entries.push({ name: ".", path, node });
    entries.push({
      name: "..",
      path: parentPath(path),
      node: getNode(parentPath(path))
    });
  }

  Object.keys(node.children)
    .filter((name) => includeHidden || !name.startsWith("."))
    .sort((left, right) => compareEntries(node.children[left], left, node.children[right], right))
    .forEach((name) => {
      entries.push({
        name,
        path: joinPath(path, name),
        node: node.children[name]
      });
    });

  return entries;
}

function compareEntries(leftNode, leftName, rightNode, rightName) {
  if (leftNode.type !== rightNode.type) {
    return leftNode.type === "directory" ? -1 : 1;
  }

  return leftName.localeCompare(rightName);
}

function buildTree(path, node, includeHidden, prefix = "") {
  const entries = getDirectoryEntries(path, node, { includeHidden });
  const lines = [];
  let directoryCount = 0;
  let fileCount = 0;

  entries.forEach((entry, index) => {
    const isLast = index === entries.length - 1;
    const branch = isLast ? "`-- " : "|-- ";

    lines.push(
      segmentedLine([
        segment(`${prefix}${branch}`, "token-muted"),
        nameSegment(entry.node, entry.name)
      ])
    );

    if (entry.node.type === "directory") {
      directoryCount += 1;

      const childTree = buildTree(
        entry.path,
        entry.node,
        includeHidden,
        `${prefix}${isLast ? "    " : "|   "}`
      );

      lines.push(...childTree.lines);
      directoryCount += childTree.directoryCount;
      fileCount += childTree.fileCount;
    } else {
      fileCount += 1;
    }
  });

  return { lines, directoryCount, fileCount };
}

function nameSegment(node, name) {
  if (node.type === "directory") {
    return segment(name, "token-dir");
  }

  if (node.executable) {
    return segment(name, "token-exec");
  }

  if (node.mime.includes("html")) {
    return segment(name, "token-link");
  }

  return segment(name);
}

function formatLongEntry(path, node, displayName) {
  const links =
    node.type === "directory"
      ? 2 + Object.values(node.children).filter((child) => child.type === "directory").length
      : 1;

  return segmentedLine([
    segment(node.mode),
    segment(` ${String(links).padStart(2, " ")} `, "token-muted"),
    segment(`${node.owner.padEnd(7, " ")} `, "token-muted"),
    segment(`${node.group.padEnd(7, " ")} `, "token-muted"),
    segment(`${String(getNodeSize(node)).padStart(5, " ")} `, "token-muted"),
    segment(`${formatLsTimestamp(node.mtime)} `, "token-muted"),
    nameSegment(node, displayName)
  ]);
}

function getNodeSize(node) {
  if (node.type === "directory") {
    return 96 + Object.keys(node.children).length * 32;
  }

  return new TextEncoder().encode(node.content).length;
}

function modeToOctal(mode) {
  const permissionGroups = mode.slice(1).match(/.{1,3}/g) || [];
  return permissionGroups
    .map((group) =>
      String(
        (group[0] === "r" ? 4 : 0) +
          (group[1] === "w" ? 2 : 0) +
          (group[2] === "x" ? 1 : 0)
      )
    )
    .join("")
    .padStart(4, "0");
}

function lookupUid(owner) {
  return {
    root: 0,
    visitor: 1000,
    www: 33
  }[owner] ?? 1000;
}

function lookupGid(group) {
  return {
    wheel: 0,
    staff: 20,
    www: 33
  }[group] ?? 20;
}

function describeNode(node) {
  if (node.type === "directory") {
    return "directory";
  }

  if (node.mime.includes("shellscript")) {
    return "POSIX shell script, ASCII text executable";
  }

  if (node.mime.includes("html")) {
    return "HTML document, ASCII text";
  }

  return "ASCII text";
}

function buildManual(name, command) {
  const lines = [
    textLine("NAME", "line-heading"),
    `    ${name} - ${command.description}`,
    "",
    textLine("SYNOPSIS", "line-heading"),
    `    ${command.usage}`,
    "",
    textLine("DESCRIPTION", "line-heading"),
    `    ${command.details}`
  ];

  if (command.examples && command.examples.length > 0) {
    lines.push("");
    lines.push(textLine("EXAMPLES", "line-heading"));

    command.examples.forEach((example) => {
      lines.push(`    ${example}`);
    });
  }

  return lines;
}

function getEnvironment() {
  return {
    HOME: shellConfig.home,
    HOSTNAME: shellConfig.host,
    LANG: "en_US.UTF-8",
    LOGNAME: shellConfig.user,
    OLDPWD: state.previousDirectory,
    PATH: `${shellConfig.home}/bin:/usr/local/bin:/usr/bin:/bin`,
    PWD: state.cwd,
    SHELL: shellConfig.shell,
    TERM: shellConfig.term,
    USER: shellConfig.user,
    "?": String(state.lastStatus)
  };
}

function formatBootTimestamp(date) {
  return `${date.toLocaleString("en-US", { month: "short" })} ${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}:${String(date.getSeconds()).padStart(2, "0")} ${date.getFullYear()}`;
}

function formatLsTimestamp(value) {
  const date = new Date(value);
  return `${date.toLocaleString("en-US", { month: "short" })} ${String(date.getDate()).padStart(2, " ")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function formatStatTimestamp(value) {
  const date = new Date(value);
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const hours = String(Math.floor(Math.abs(offsetMinutes) / 60)).padStart(2, "0");
  const minutes = String(Math.abs(offsetMinutes) % 60).padStart(2, "0");

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}:${String(date.getSeconds()).padStart(2, "0")} ${sign}${hours}${minutes}`;
}

function formatDuration(milliseconds) {
  const totalSeconds = Math.max(1, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [];

  if (hours) {
    parts.push(`${hours}h`);
  }

  if (minutes || hours) {
    parts.push(`${minutes}m`);
  }

  parts.push(`${seconds}s`);
  return parts.join(" ");
}

function textLine(text, className = "") {
  return { text, className };
}

function segment(text, className = "") {
  return { text, className };
}

function segmentedLine(segments, className = "") {
  return { segments, className };
}

function getSearchPaths() {
  return getEnvironment()
    .PATH.split(":")
    .map((path) => path.trim())
    .filter(Boolean)
    .map((path) => resolvePath(path));
}

function getPathExecutables() {
  const names = new Set();

  getSearchPaths().forEach((path) => {
    const node = getNode(path);

    if (!node || node.type !== "directory") {
      return;
    }

    Object.entries(node.children).forEach(([name, child]) => {
      if (child.type === "file" && child.executable) {
        names.add(name);
      }
    });
  });

  return [...names];
}

function attemptCompletion() {
  if (input.selectionStart !== input.value.length || input.selectionEnd !== input.value.length) {
    return;
  }

  const raw = input.value;
  const trailingSpace = /\s$/.test(raw);
  const trimmedStart = raw.trimStart();
  let fragment = "";
  let matches = [];

  if (!trimmedStart) {
    matches = getCommandMatches("");
  } else {
    const parts = raw.split(/\s+/).filter(Boolean);
    const completingCommand = parts.length === 1 && !trailingSpace;

    if (completingCommand) {
      fragment = parts[0];
      matches = getCommandMatches(fragment);
    } else {
      fragment = trailingSpace ? "" : parts[parts.length - 1];
      matches = getPathMatches(fragment);
    }
  }

  if (matches.length === 0) {
    return;
  }

  if (matches.length === 1) {
    const onlyMatch = matches[0];
    input.value = replaceFragment(raw, fragment, onlyMatch.replacement + (onlyMatch.appendSpace ? " " : ""));
    state.lastCompletionKey = "";
    focusInput();
    return;
  }

  const sharedPrefix = longestCommonPrefix(matches.map((match) => match.replacement));

  if (sharedPrefix.length > fragment.length) {
    input.value = replaceFragment(raw, fragment, sharedPrefix);
    state.lastCompletionKey = "";
    focusInput();
    return;
  }

  const completionKey = `${raw}\n${matches.map((match) => match.replacement).join("\n")}`;

  if (state.lastCompletionKey === completionKey) {
    appendSystemOutput(view.lines(matches.map((match) => match.line)), "completion");
    scrollToBottom();
    state.lastCompletionKey = "";
    return;
  }

  state.lastCompletionKey = completionKey;
}

function getCommandMatches(fragment) {
  return [
    ...new Set([
      ...Object.keys(commands),
      ...Object.keys(aliases),
      ...getPathExecutables()
    ])
  ]
    .sort()
    .filter((name) => name.startsWith(fragment))
    .map((name) => ({
      replacement: name,
      appendSpace: true,
      line: segmentedLine([segment(name, "token-accent")])
    }));
}

function getPathMatches(fragment) {
  if (fragment === "~") {
    return [
      {
        replacement: "~/",
        appendSpace: false,
        line: segmentedLine([segment("~/", "token-dir")])
      }
    ];
  }

  const slashIndex = fragment.lastIndexOf("/");
  const baseInput = slashIndex >= 0 ? fragment.slice(0, slashIndex + 1) : "";
  const namePrefix = slashIndex >= 0 ? fragment.slice(slashIndex + 1) : fragment;
  const resolvedBase = resolveCompletionBase(baseInput);
  const node = getNode(resolvedBase);

  if (!node || node.type !== "directory") {
    return [];
  }

  return getDirectoryEntries(resolvedBase, node, {
    includeHidden: namePrefix.startsWith(".")
  })
    .filter((entry) => entry.name.startsWith(namePrefix))
    .map((entry) => {
      const suffix = entry.node.type === "directory" ? "/" : "";
      const replacement = `${baseInput}${entry.name}${suffix}`;

      return {
        replacement,
        appendSpace: entry.node.type !== "directory",
        line: segmentedLine([nameSegment(entry.node, `${entry.name}${suffix}`)])
      };
    });
}

function resolveCompletionBase(baseInput) {
  if (!baseInput) {
    return state.cwd;
  }

  if (baseInput === "/") {
    return "/";
  }

  if (baseInput.startsWith("~/")) {
    return normalizePath(`${shellConfig.home}/${baseInput.slice(2)}`);
  }

  if (baseInput === "~/" || baseInput === "~") {
    return shellConfig.home;
  }

  return resolvePath(baseInput);
}

function replaceFragment(raw, fragment, replacement) {
  if (!fragment) {
    return `${raw}${replacement}`;
  }

  return `${raw.slice(0, raw.length - fragment.length)}${replacement}`;
}

function longestCommonPrefix(values) {
  if (values.length === 0) {
    return "";
  }

  let prefix = values[0];

  for (let index = 1; index < values.length; index += 1) {
    while (!values[index].startsWith(prefix) && prefix) {
      prefix = prefix.slice(0, -1);
    }
  }

  return prefix;
}
})();
