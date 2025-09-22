import * as cp from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";

// Module-level cache for mdformat availability
let mdformatFound: boolean | undefined;
let pythonPathUsedForLastCheck: string | undefined;
let outputChannel: vscode.LogOutputChannel = null!;
const isWindows = process.platform == "win32";

/**
 * Attempt to find a suitable Python interpreter path in the following order:
 * 1. User-defined "mdformat.pythonPath" setting.
 * 2. Python interpreter selected via the 'ms-python.python' VS Code extension.
 * 3. Common global Python executables ('python3', 'python', 'py') found in the system PATH.
 *
 * @param documentUri Optional URI of the document to get context for Python extension.
 * @returns The path to the Python interpreter, or undefined if none is found.
 */
async function getPythonInterpreter(
  documentUri?: vscode.Uri,
): Promise<string | undefined> {
  const config = vscode.workspace.getConfiguration("mdformat", documentUri);
  const userPythonPath = config.get<string | null>("pythonPath");

  // 1. User-defined path (highest priority)
  if (
    userPythonPath &&
    userPythonPath.trim() !== "" &&
    userPythonPath !== "null"
  ) {
    outputChannel.info(
      `Using Python interpreter from "mdformat.pythonPath": ${userPythonPath}`,
    );
    try {
      fs.accessSync(userPythonPath, fs.constants.F_OK);
      return userPythonPath;
    } catch {
      outputChannel.error(
        `Provided pythonPath ${userPythonPath} is not a valid file. Trying to find another interpreter.`,
      );
    }
  }

  // 2. Python extension's selected interpreter
  try {
    const pythonExtension = vscode.extensions.getExtension("ms-python.python");
    if (pythonExtension) {
      if (!pythonExtension.isActive) {
        outputChannel.info(
          "Attempting to activate ms-python.python extension for interpreter path...",
        );
        await pythonExtension.activate();
      }
      if (
        pythonExtension.isActive &&
        pythonExtension.exports &&
        pythonExtension.exports.settings
      ) {
        const executionDetails =
          pythonExtension.exports.settings.getExecutionDetails(documentUri);
        if (
          executionDetails?.execCommand &&
          executionDetails.execCommand.length > 0
        ) {
          const interpreterFromExtension = executionDetails.execCommand[0];
          outputChannel.info(
            `Using Python interpreter from ms-python.python extension: ${interpreterFromExtension}`,
          );
          return interpreterFromExtension;
        } else {
          outputChannel.info(
            "ms-python.python extension is active, but no interpreter selected or found through it.",
          );
        }
      } else {
        outputChannel.info(
          "ms-python.python extension present but not fully active or exports not available when queried for path.",
        );
      }
    } else {
      outputChannel.info(
        "ms-python.python extension not installed. Skipping its interpreter discovery.",
      );
    }
  } catch (error) {
    outputChannel.error(
      "Error while trying to get interpreter from ms-python.python extension:",
      error,
    );
    // Continue to fallback
  }

  // 3. Common global Python executables
  outputChannel.info("Trying to find a global Python interpreter in PATH...");
  const commonPythons = isWindows
    ? ["python.exe", "python3.exe", "py.exe"] // Windows specific, py.exe is the launcher
    : ["python3", "python"]; // Common for Unix-like

  for (const pyCmd of commonPythons) {
    try {
      const commandOutput = cp.execSync(`"${pyCmd}" --version`, {
        encoding: "utf8",
        stdio: "pipe",
      });
      if (commandOutput.toLowerCase().includes("python")) {
        outputChannel.info(`Found global Python: ${pyCmd}`);
        return pyCmd; // Return the command itself, OS will resolve it from PATH
      }
    } catch {
      console.debug(
        `Command '${pyCmd} --version' failed, trying next global Python.`,
      );
    }
  }

  outputChannel.warn(
    "No suitable Python interpreter found through settings, Python extension, or system PATH.",
  );
  return undefined;
}

/**
 * Check for mdformat availability using a specific Python interpreter.
 * Update global `mdformatFound` and `pythonPathUsedForLastCheck`.
 * @param documentUri URI of the document being formatted, for context.
 * @param pythonToCheck The specific Python interpreter path to use for checking.
 * @returns True if mdformat is found, false otherwise.
 */
async function checkMdformatAvailability(
  documentUri?: vscode.Uri, // For context, not strictly used if pythonToCheck is provided
  pythonToCheck?: string,
): Promise<boolean> {
  const interpreterPath =
    pythonToCheck || (await getPythonInterpreter(documentUri));

  if (!interpreterPath) {
    outputChannel.warn(
      "No Python interpreter path provided or found for mdformat check.",
    );
    mdformatFound = false;
    pythonPathUsedForLastCheck = undefined;
    return false;
  }

  outputChannel.info(`Checking for mdformat using Python: ${interpreterPath}`);
  return new Promise<boolean>((resolve) => {
    const command = `"${interpreterPath}" -m mdformat --version`;
    cp.exec(command, (error, stdout, stderr) => {
      pythonPathUsedForLastCheck = interpreterPath;
      if (error) {
        outputChannel.error(
          `mdformat check failed for ${interpreterPath}:`,
          error.message,
        );
        if (stderr) outputChannel.error("mdformat stderr:", stderr.trim());
        mdformatFound = false;
        resolve(false);
      } else {
        outputChannel.info(
          `mdformat found with ${interpreterPath}. Version: ${stdout.trim()}`,
        );
        mdformatFound = true;
        resolve(true);
      }
    });
  });
}

/**
 * Display an error message when mdformat is not found in the established Python path
 * @param attemptedPythonPath The Python path that was use in the attempt
 */
function showMdformatNotAvailableError(attemptedPythonPath?: string) {
  const interpreterMsg = attemptedPythonPath
    ? `the Python interpreter ('${attemptedPythonPath}')`
    : "your Python environment (no interpreter was selected/found, or the path was invalid)";

  vscode.window.showErrorMessage(
    `mdformat was not found using ${interpreterMsg}. ` +
      `Make sure you have selected the right Python interpreter (or set "mdformat.pythonPath") and have mdformat installed in that environment (e.g., 'pip install mdformat').`,
  );
}

export function activate(context: vscode.ExtensionContext) {
  outputChannel = vscode.window.createOutputChannel("mdformat", {
    log: true,
  });
  outputChannel.info('Extension "mdformat" is now active!');
  context.subscriptions.push(outputChannel);

  // Listen for Python interpreter changes to invalidate our cache
  const pythonExtension = vscode.extensions.getExtension("ms-python.python");
  if (pythonExtension) {
    if (pythonExtension.isActive) {
      pythonExtension.exports.settings.onDidChangeExecutionDetails(
        () => {
          outputChannel.info(
            "Python execution details changed. mdformat availability will be re-evaluated on next format attempt.",
          );
          mdformatFound = undefined; // Invalidate cache
          // pythonPathUsedForLastCheck will be updated by the next check
        },
        null,
        context.subscriptions,
      );
    } else {
      pythonExtension.activate().then(() => {
        pythonExtension.exports.settings.onDidChangeExecutionDetails(
          () => {
            outputChannel.info(
              "Python execution details changed (after activation). mdformat availability will be re-evaluated on next format attempt.",
            );
            mdformatFound = undefined;
          },
          null,
          context.subscriptions,
        );
      });
    }
  }

  const formatter = vscode.languages.registerDocumentFormattingEditProvider(
    "markdown",
    {
      async provideDocumentFormattingEdits(
        document: vscode.TextDocument,
        _options: vscode.FormattingOptions,
        token: vscode.CancellationToken,
      ): Promise<vscode.TextEdit[]> {
        const config = vscode.workspace.getConfiguration(
          "mdformat",
          document.uri,
        );
        const currentInterpreterForFormatting = await getPythonInterpreter(
          document.uri,
        );

        if (!currentInterpreterForFormatting) {
          vscode.window.showErrorMessage(
            "mdformat: Cannot format. No Python interpreter found. " +
              "Please ensure Python is installed and in your PATH, or select an interpreter using the Python extension, " +
              'or set the "mdformat.pythonPath" setting.',
          );
          return [];
        }

        // Determine if a check/re-check for mdformat is needed:
        // 1. mdformat's status is unknown (mdformatFound is undefined).
        // 2. The Python interpreter we intend to use now is different from the one last checked.
        // 3. mdformat was previously not found (mdformatFound === false) - allows retry if user installed it.
        const needsCheck =
          mdformatFound === undefined ||
          pythonPathUsedForLastCheck !== currentInterpreterForFormatting ||
          mdformatFound === false;

        if (needsCheck) {
          outputChannel.info(
            `Formatting: Re-evaluating mdformat availability for interpreter: ${currentInterpreterForFormatting}`,
          );
          await checkMdformatAvailability(
            document.uri,
            currentInterpreterForFormatting,
          );
        }

        if (!mdformatFound || !pythonPathUsedForLastCheck) {
          // pythonPathUsedForLastCheck should be currentInterpreterForFormatting if a check was just run,
          // or the path that previously failed if mdformatFound is false and no new check was run (though 'needsCheck' should cover this).
          showMdformatNotAvailableError(
            pythonPathUsedForLastCheck || currentInterpreterForFormatting,
          );
          return [];
        }

        const pythonExecutableForMdformat = pythonPathUsedForLastCheck;

        outputChannel.info(
          `Formatting with mdformat using: ${pythonExecutableForMdformat}`,
        );

        const args: string[] = ["-m", "mdformat"];

        const wrap = config.get<string | number>("wrap", "keep");
        // Only pass the argument if it's different from "keep" or if it's an integer.
        if (wrap !== "keep" || typeof wrap === "number") {
          args.push("--wrap", String(wrap));
        }

        const endOfLine = config.get<string>("endOfLine");
        args.push("--end-of-line", endOfLine!);

        if (config.get<boolean>("noValidate")) {
          args.push("--no-validate");
        }

        const customArgs = config.get<string[]>("args", []);
        args.push(...customArgs);

        // Plugins listed in 'mdformat.plugins' are for user awareness;
        // mdformat auto-discovers them if installed in the 'pythonExecutableForMdformat' environment.
        // If a plugin needs specific CLI activation beyond just being present,
        // users should add those flags to 'mdformat.args'.

        args.push("-"); // Read from stdin

        const originalText = document.getText();
        const execOptions: cp.SpawnOptions = {
          cwd: path.dirname(document.uri.fsPath),
          env: { ...process.env, PYTHONIOENCODING: "utf-8" },
        };
        if (isWindows) {
          // Ensure PATH is correctly inherited on Windows
          execOptions.shell = true;
        }

        return new Promise<vscode.TextEdit[]>((resolve, reject) => {
          const command = isWindows
            ? "cmd /c chcp 65001>nul &&" + pythonExecutableForMdformat
            : pythonExecutableForMdformat;
          const proc = cp.spawn(command, args, execOptions);
          let stdout = "";
          let stderr = "";

          proc.stdout?.on("data", (data) => {
            stdout += data.toString("utf-8");
          });
          proc.stderr?.on("data", (data) => {
            stderr += data.toString("utf-8");
          });

          proc.on("error", (err) => {
            outputChannel.error("Failed to start mdformat process:", err);
            vscode.window.showErrorMessage(
              `mdformat failed to start: ${err.message}. Is "${pythonExecutableForMdformat}" a valid Python path?`,
            );
            mdformatFound = false; // Mark as not found due to spawn error
            pythonPathUsedForLastCheck = pythonExecutableForMdformat; // Path that failed
            reject(err);
          });

          proc.on("close", (code, signal) => {
            if (token.isCancellationRequested) {
              outputChannel.info("Formatting cancelled by user.");
              return reject("Cancelled");
            }

            if (signal) {
              // Process terminated by signal
              outputChannel.error(
                `mdformat process terminated by signal: ${signal}`,
              );
              vscode.window.showErrorMessage(
                `mdformat process terminated unexpectedly (signal: ${signal}).`,
              );
              return reject(`Terminated by signal ${signal}`);
            }

            if (code !== 0) {
              outputChannel.error(`mdformat process exited with code ${code}.`);
              outputChannel.error("mdformat stderr:", stderr.trim());
              let detailedError = stderr.trim();
              if (!detailedError) {
                detailedError = `mdformat exited with code ${code}. Check "Output > mdformat" for details.`;
              }
              vscode.window.showErrorMessage(
                `mdformat formatting failed: ${detailedError}`,
              );
              // Consider if this implies mdformat is "not found" or just a formatting error.
              // For now, assume mdformat is there but failed on the file.
              return reject(stderr || `mdformat exited with code ${code}`);
            }

            if (stdout.length > 0 && stdout !== originalText) {
              const fullRange = new vscode.Range(
                document.positionAt(0),
                document.positionAt(originalText.length),
              );
              outputChannel.info("Formatted successfully.");
              resolve([vscode.TextEdit.replace(fullRange, stdout)]);
            } else {
              resolve([]); // No changes or empty output
            }
          });

          proc.stdin?.write(originalText, "utf-8");
          proc.stdin?.end();
        });
      },
    },
  );

  context.subscriptions.push(formatter);

  const disposableCommand = vscode.commands.registerCommand(
    "mdformat.checkInstallation",
    async () => {
      mdformatFound = undefined; // Force re-check
      const currentEditor = vscode.window.activeTextEditor;
      const documentUri = currentEditor?.document.uri;
      const interpreterToManuallyCheck =
        await getPythonInterpreter(documentUri);

      if (!interpreterToManuallyCheck) {
        vscode.window.showInformationMessage(
          'Cannot check mdformat: No Python interpreter selected or configured via "mdformat.pythonPath".',
        );
        showMdformatNotAvailableError(undefined);
        return;
      }

      const available = await checkMdformatAvailability(
        documentUri,
        interpreterToManuallyCheck,
      );
      if (available && pythonPathUsedForLastCheck) {
        // pythonPathUsedForLastCheck should be interpreterToManuallyCheck now
        vscode.window.showInformationMessage(
          `mdformat is available with: ${pythonPathUsedForLastCheck}`,
        );
      } else {
        showMdformatNotAvailableError(interpreterToManuallyCheck);
      }
    },
  );
  context.subscriptions.push(disposableCommand);
}

export function deactivate() {
  outputChannel.info('Extension "mdformat" is now deactivated.');
}
