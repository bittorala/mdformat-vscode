# mdformat-vscode

This is an **unofficial** extension to use [mdformat](https://github.com/hukkin/mdformat)
in VS Code. mdformat is an opinionated Markdown formatter that can be used to enforce a
consistent style in Markdown files.

## Usage

In order to use this extension, you must have Python installed, as well as `mdformat`. You
can also install any plugins, as they are auto-detected by `mdformat`. This is how the
extension will look for the `python` binary and the `mdformat` library:

1. User-defined "mdformat.pythonPath" setting.
1. Python interpreter selected via the `ms-python.python` VS Code extension.
1. Common global executables found in the system PATH.

The extension will be registered as a formatter, and you can set it as your default
Markdown formatter with:

```json
  "[markdown]": {
    "editor.defaultFormatter": "bittorala.mdformat",
  },
```

This extension does not provide a full-fledged LSP Server as other formatters for other
languages do. A simpler approach invoking `python -m mdformat` for each formatting was
taken. A potential implementation with such LSP Server is not ruled out for the future.

## Settings

See
[Options](https://mdformat.readthedocs.io/en/stable/users/installation_and_usage.html#options)
for full reference.

| Setting             | Default | Description                                                                                            |
| ------------------- | ------- | ------------------------------------------------------------------------------------------------------ |
| mdformat.pythonPath | `null`  | Path to the Python interpreter to use for mdformat. If null, uses the interpreter selected in VS Code. |
| mdformat.wrap       | `keep`  | How to wrap text. Can be 'keep', 'no', or an integer (e.g., 88).                                       |
| mdformat.endOfLine  | `keep`  | End of line character, {keep, lf, crlf}                                                                |
| mdformat.noValidate | `false` | Disable validation. Allows formatting even if inconsistent HTML outputs are detected.                  |
| mdformat.args       | `[]`    | Custom arguments. Check out CLI for available options.                                                 |
