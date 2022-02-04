---
layout: docs
toc_group: vscode
link_title: Polyglot Runtime and Debugging in VS Code
permalink: /tools/vscode/graalvm-extension/polyglot-runtime/
---

#  Polyglot Runtime and Debugging in VS Code

* [Language Server Protocol Implementation](#language-server-protocol-implementation)
* [Debug Adapter Protocol Implementation](#debug-adapter-protocol-implementation)
* [JavaScript and Node.js Support](polyglot-runtime.md#javascript-and-nodejs-support)
* [Python Support](polyglot-runtime.md#python-support)
* [Ruby Support](polyglot-runtime.md#ruby-support)
* [R Support](polyglot-runtime.md#r-support)
* [Running and Debugging Polyglot Applications](#running-and-debugging-polyglot-applications)
* [Additional Editor Features](#additional-editor-features)

The GraalVM Tools for Java extension enables a polyglot environment in VS Code, providing necessary editing and debugging features for a number of popular languages such as Python, Ruby, R, JavaScript, and Node.JS.
The extension allows for polyglot programming in a bidirectional way: you can embed JavaScript, Ruby, R, and Python in Java, or call Java from those languages.
A host language and a guest language can directly interoperate with each other and pass data back and forth in the same memory space.

GraalVM Tools for Java extension checks for the language server, an implementation of the [Language Server Protocol](https://microsoft.github.io/language-server-protocol/) for a particular language, and provides an option to automatically install it.

## Debug Adapter Protocol Implementation

GraalVM provides a built-in implementation of the [Debug Adapter Protocol (DAP)](https://www.graalvm.org/tools/dap/).
When creating the **Run/Debug Configuration** in VS Code, Chrome DevTools Protocol is provisioned by default. With the GraalVM Tools for Java extension, a user can choose a protocol to use by setting the protocol attribute in the corresponding debug configuration to either `chromeDevTools` or `debugAdapter`.

To open a debugger port serving the Debug Adapter Protocol, you need to pass the `--dap` option to the command line launcher.
Other available options to pass to GraalVM's Debug Adapter Protocol are:
* `--dap.Suspend=false`: Disable the execution suspension at first source line, enabled by default.
* `--dap.WaitAttached`: Do not execute any source code until debugger client is attached. The default is false.
* `--dap=<[[host:]port]>`: Start the debugger on a different port than default (`<host>:4711`).

Then you need a DAP client to connect to the open DAP port.
To connect to the open DAP port, the content of _launch.json_ for a Node.js application, for example, should be:
```json
{
    "version": "0.2.0",
    "configurations": [
        {
            "type": "graalvm",
            "request": "launch",
            "name": "Launch Node App",
            "outputCapture": "std",
            "protocol": "debugAdapter",
            "program": "${workspaceFolder}/App.js"
        }
    ]
}
```

The advantage of using the Debug Adapter Protocol over Chrome Dev Tools is that (1) it is "native" to Visual Studio Code (VS Code), meaning it does not require any intermediate translatation, and (2) it supports multithreading, which can be particually useful to debug, e.g., a Ruby application.

## JavaScript and Node.js debugging

To debug a JavaScript or Node.js application running on GraalVM, create a launch configuration for the application.
To do so, open the application project folder in VS Code (File > Open Folder), then switch to the Debug view by clicking on the "bug" icon in the left-hand side panel.
The newly opened window will suggest you create a _launch.json_ file.

If debugging is not yet configured (no `launch.json` has been created), select `GraalVM` from the list of available debug environmnets.

The following techniques can be used to add a new configuration:
* Use code completion if your cursor is located inside the configurations array.
* Press the Add Configuration button to invoke IntelliSense snippet suggestions at the start of the array.
* Choose the Add Configuration option in the Debug menu.

![Image Debug Configurations](images/debug-config.png)

> Note: The attributes available in launch configurations vary from configuration to configuration. You can use IntelliSense suggestions (_Ctrl+Space_) to find out which attributes exist for a specific debug configuration. Hover help is also available for all attributes.

![Image Select Debug Configuration](images/select-debug-config.png)

The GraalVM extension provides the following debug configurations that can be used to run and debug JavaScript and Node.js applications running on GraalVM:
* __Launch Node.js Application__ - Launches a Node.js application with GraalVM in a debug mode.
* __Launch JavaScript__ - Launches a JavaScript application with GraalVM in a debug mode.
* __Attach__ - Attaches a debugger to a locally running GraalVM runtime.
* __Attach to Remote__ - Attaches a debugger to the debug port of a remote GraalVM runtime.

You now have the possibility to choose which debugging protocol to use ([Debug Adapter Protocol](https://www.graalvm.org/tools/dap/) or [Chrome Dev Tools protocol](https://www.graalvm.org/tools/chrome-debugger/)) by setting the `protocol` attribute in the corresponding debug configuration to either `chromeDevTools` or `debugAdapter`.
For example, to connect to the open Debug Adapter Protocol port, the content of the _launch.json_ should be:
```json
{
    "version": "0.2.0",
    "configurations": [
        {
            "type": "graalvm",
            "request": "launch",
            "name": "Launch Node App",
            "outputCapture": "std",
            "protocol": "debugAdapter",
            "program": "${workspaceFolder}/App.js"
        }
    ]
}
```

In order to start a debug session, first select the proper configuration using the Configuration drop-down in the Debug view.
Once you have your launch configuration set, start your debug session with F5.
Alternatively, you can run your configuration through View > Command Palette (Command Palette can be opened by pressing F1, or the _Ctrl+Shift+P_  hot keys combination for Linux, and _Command+Shift+P_ for macOS).
Set filtering to Debug: Select and Start Debugging, or type "debug" and select the configuration you want to debug.

## Python Support

To debug a Python application running on GraalVM, create a launch configuration for the application.
To do so, open the application project folder in VS Code (File > Open Folder), then switch to the Debug view by clicking on the "bug" icon in the left-hand side panel. The newly opened window will suggest you create a _launch.json_ file.
If debugging is not yet configured (no `launch.json` has been created), select `GraalVM` from the list of available debug environmnets.

Once the `launch.json` file is opened in the editor, one of the following techniques can be used to add a new configuration:
* Use code completion if your cursor is located inside the configurations array.
* Press the Add Configuration button to invoke IntelliSense snippet suggestions at the start of the array.
* Choose Add Configuration option in the Debug menu.

![Image Debug Configurations](images/debug-config-python.png)

The GraalVM Python extension provides the following debug configuration that can be used to debug Python applications/scripts running on GraalVM:
* __Launch Python Script__ - Launches a Python script with GraalVM in a debug mode.

You now have the possibility to choose which debugging protocol to use ([Debug Adapter Protocol](https://www.graalvm.org/tools/dap/) or [Chrome Dev Tools protocol](https://www.graalvm.org/tools/chrome-debugger/)) by setting the `protocol` attribute in the corresponding debug configuration to either `chromeDevTools` or `debugAdapter`.
For example, to connect to the Chrome Dev Tools protocol port, the content of the _launch.json_ should be:
```json
{
    "version": "0.2.0",
    "configurations": [
        {
            "type": "graalvm",
            "request": "launch",
            "name": "Launch Python App",
            "outputCapture": "std",
            "protocol": "chromeDevTools",
            "program": "${workspaceFolder}/App.py"
        }
    ]
}
```

When editing debug configurations, you can use IntelliSense suggestions (_Ctrl+Space_) to find out which attributes exist for a specific debug configuration.
Hover help is also available for all attributes.

![Image Select Python Debug Configuration](images/select-python-debug-config.png)

In order to start a debug session, first select the proper configuration using the Configuration drop-down in the Debug view.
Once you have your launch configuration set, start your debug session with F5.
Alternatively, you can run your configuration through View > Command Palette (Command Palette can be also opened by pressing F1, or _Ctrl+Shift+P_  hot keys combination for Linux and _Command+Shift+P_ for macOS), by filtering on Debug: Select and Start Debugging or typing "debug", and selecting the configuration you want to debug.

## Ruby Debugging

To debug a Ruby application running on GraalVM, create a launch configuration for the application.
To do so, open the application project folder in VS Code (File > Open Folder), then switch to the Debug view by clicking on the "bug" icon in the left-hand side panel. The newly opened window will suggest you create a _launch.json_ file.
If debugging is not yet configured (no `launch.json` has been created), select `GraalVM` from the list of available debug environmnets.

Once the `launch.json` file is opened in the editor, one of the following techniques can be used to add a new configuration:
* Use code completion if your cursor is located inside the configurations array.
* Press the Add Configuration button to invoke IntelliSense snippet suggestions at the start of the array.
* Choose Add Configuration option in the Debug menu.

![Image Debug Configurations](images/debug-config-ruby.png)

The GraalVM Ruby extension provides the following debug configuration that can be used to debug Ruby applications/scripts running on GraalVM:
* __Launch Ruby Script__ - Launches a Ruby script using GraalVM in a debug mode.

You now have the possibility to choose which debugging protocol to use ([Debug Adapter Protocol](https://www.graalvm.org/tools/dap/) or [Chrome Dev Tools protocol](https://www.graalvm.org/tools/chrome-debugger/)) by setting the `protocol` attribute in the corresponding debug configuration to either `chromeDevTools` or `debugAdapter`.
For example, to connect to the Chrome Dev Tools protocol port, the content of the _launch.json_ should be:
```json
{
    "version": "0.2.0",
    "configurations": [
        {
            "type": "graalvm",
            "request": "launch",
            "name": "Launch Ruby App",
            "outputCapture": "std",
            "protocol": "chromeDevTools",
            "program": "${workspaceFolder}/App.rb"
        }
    ]
}
```

When editing debug configurations, you can use IntelliSense suggestions (_Ctrl+Space_) to find out which attributes exist for a specific debug configuration.
Hover help is also available for all attributes.

![Image Select Debug Configuration](images/select-ruby-debug-config.png)

In order to start a debug session, first select the proper configuration using the Configuration drop-down in the Debug view.
Once you have your launch configuration set, start your debug session with F5.
Alternatively, you can run your configuration through View > Command Palette (Command Palette can be also opened by pressing F1, or _Ctrl+Shift+P_  hot keys combination for Linux and _Command+Shift+P_ for macOS), by filtering on Debug: Select and Start Debugging or typing "debug", and selecting the configuration you want to debug.

## R Support

### R Language Server

This extension provides an option to automatically install and run the [languageserver](https://github.com/REditorSupport/languageserver) which is an implementation of the Language Server Protocol for the R language.
Enabling this option, the GraalVM R installation is checked for the presence of the `languageserver` package and the user is provided with the option of an automatic installation of the missing package.

![Image No R Language Server](images/no-r-ls.png)

Once the `languageserver` package is installed, the R Language Server is automatically started and passed to the Language Server Protocol as delegate when necessary.

### R Debugging

To debug an R application running on GraalVM, create a launch configuration for the application.
To do so, open the application project folder in VS Code (File > Open Folder), then switch to the Debug view by clicking on the "bug" icon in the left-hand side panel. The newly opened window will suggest you create a _launch.json_ file.
If debugging is not yet configured (no `launch.json` has been created), select `GraalVM` from the list of available debug environmnets.

Once the `launch.json` file is opened in the editor, one of the following techniques can be used to add a new configuration:
* Use code completion if your cursor is located inside the configurations array.
* Press the Add Configuration button to invoke IntelliSense snippet suggestions at the start of the array.
* Choose Add Configuration option in the Debug menu.

![Image Debug Configurations](images/debug-config-r.png)

The GraalVM R extension provides the following debug configurations that can be used to debug R applications/scripts running on GraalVM:
* __Launch R Script__ - Launches an R script using GraalVM in a debug mode.
* __Launch R Terminal__ - Launches an integrated R terminal running on GraalVM in a debug mode.

You now have the possibility to choose which debugging protocol to use ([Debug Adapter Protocol](https://www.graalvm.org/tools/dap/) or [Chrome Dev Tools protocol](https://www.graalvm.org/tools/chrome-debugger/)) by setting the `protocol` attribute in the corresponding debug configuration to either `chromeDevTools` or `debugAdapter`.
For example, to connect to the Chrome Dev Tools protocol port, the content of the _launch.json_ should be:
```json
{
    "version": "0.2.0",
    "configurations": [
        {
            "type": "graalvm",
            "request": "launch",
            "name": "Launch R Script",
            "outputCapture": "std",
            "protocol": "chromeDevTools",
            "program": "${workspaceFolder}/App.r"
        }
    ]
}
```

When editing debug configurations, you can use IntelliSense suggestions (_Ctrl+Space_) to find out which attributes exist for a specific debug configuration.
Hover help is also available for all attributes.

![Image Select Debug Configuration](images/select-r-debug-config.png)

In order to start a debug session, first select the proper configuration using the Configuration drop-down in the Debug view.
Once you have your launch configuration set, start your debug session with F5.
Alternatively, you can run your configuration through View > Command Palette (Command Palette can be also opened by pressing F1, or _Ctrl+Shift+P_  hot keys combination for Linux and _Command+Shift+P_ for macOS), by filtering on Debug: Select and Start Debugging or typing "debug", and selecting the configuration you want to debug.

## Running and Debugging Polyglot Applications

To run a polyglot application on GraalVM in VS Code, you have to either pass the `--polyglot` option to any of the existing application lauchers (e.g., `js --polyglot` or `node --polyglot`), or use an experimental launcher called `polyglot` that runs code for JavaScript, Python, Ruby, and R without requiring the selection of a primary language.
The `polyglot` launcher does not require the `--polyglot` option, it is enabled by default.
For more information see the [Polyglot Programming guide](https://www.graalvm.org/reference-manual/polyglot-programming/).

To debug a polyglot application on GraalVM in VS Code, create a launch configuration for the application.
To do so, open the application project folder in VS Code (File > Open Folder), switch to the Debug view by clicking on the "bug" icon in the left-hand side panel. The newly opened window will suggest to create a _launch.json_ file.
If debugging is not yet configured (no `launch.json` has been created), select `GraalVM` from the list of available debug environmnets.

Once the `launch.json` file is opened in the editor, one of the following techniques can be used to add a new configuration:
  * Use code completion if your cursor is located inside the configurations array.
  * Press **Add Configuration** to invoke IntelliSense snippet suggestions at the start of the array.
  * Choose **Add Configuration** in the Debug menu.

![Image Debug Configurations](images/debug-config-polyglot.png)

The GraalVM extension provides the following debug configuration that can be used to debug an applications running on GraalVM using the `polyglot` launcher:
* __Launch Polyglot Application__ - Launches a Polyglot Application in a debug mode.

You now have the possibility to choose which protocol ([Debug Adapter Protocol](https://www.graalvm.org/tools/dap/) or [Chrome Dev Tools protocol](https://www.graalvm.org/tools/chrome-debugger/)) to use to debug a polyglot application by setting the `protocol` attribute in the corresponding debug configuration to either `chromeDevTools` or `debugAdapter`.
For example, to connect to the Chrome Dev Tools protocol port, the content of the _launch.json_ can be:
```json
{
    "version": "0.2.0",
    "configurations": [
        {
            "type": "graalvm",
            "request": "launch",
            "name": "Launch Polyglot App",
            "outputCapture": "std",
            "protocol": "chromeDevTools",
            "program": "${workspaceFolder}/polyglot.js"
        }
    ]
}
```

Alternatively, to pass the `--polyglot` option to any of the existing application launchers, add the `runtimeArgs` attribute containing the `--polyglot` value to their respective debug configurations.

> Note: In some cases (polyglot application calls Java or R, or native launcher accesses languages installed with `gu` without [rebuilding images](https://www.graalvm.org/reference-manual/graalvm-updater/#component-uninstallation)), also passing the `--jvm` option is necessary.

![Image Debug Configuration for Python](images/polyglot-debug-config.png)

## Additional Editor Features

Since the easy writing of [polyglot](https://www.graalvm.org/docs/reference-manual/polyglot) applications is one of the defining features of GraalVM, the code completion invoked inside JavaScript sources provides items for `Polyglot.eval(...)`, `Polyglot.evalFile(...)`, and `Java.type(...)` calls.

![Image Code Completion](images/code-completion-js.png)

Similarly, the code completion invoked inside Python sources provides items for `Polyglot.eval(...)`, `Polyglot.eval_file(...)`, and `Java.type(...)` calls.

![Image Code Completion](images/code-completion-python.png)

The code completion invoked inside R sources provides items for `eval.polyglot(...)` and `new("<Java type>", ...)` calls.

![Image Code Completion](images/code-completion-r.png)

And finally, the code completion invoked inside Ruby sources provides items for `Polyglot.eval(...)`, `Polyglot.eval_file(...)`, and `Java.type(...)` calls.

![Image Code Completion](images/code-completion-ruby.png)

For JavaScript, Python, R, and Ruby sources opened in the editor, all the `Polyglot.eval(...)` calls are detected and the respective embedded languages are injected to their locations.
For example, having an R code snippet called via the Polyglot API from inside a JavaScript source, the R language code is embedded inside the corresponding JavaScript String and all VS Code's editing features (syntax highlighting, bracket matching, auto closing pairs, code completion, etc.) treat the content of the String as the R source code.

![Image Language Embedding](images/language-embedding-js.png)

## Language Server Protocol Implementation

GraalVM provides a built-in implementation of the [Language Server Protocol](https://microsoft.github.io/language-server-protocol).
This allows you to attach compatible development tools such as VS Code to GraalVM and to get features like auto complete, go to declaration, or documentation on hover.

Currently, [GraalVM's Language Server Protocol](https://www.graalvm.org/tools/lsp/) implementation supports the following services:
* [Text Document Synchronization](https://microsoft.github.io/language-server-protocol/specifications/specification-current/#textDocument_synchronization)
* [Hover Provider](https://microsoft.github.io/language-server-protocol/specifications/specification-current/#textDocument_hover)
* [Completion Provider](https://microsoft.github.io/language-server-protocol/specifications/specification-current/#textDocument_completion)
* [Signature Help Provider](https://microsoft.github.io/language-server-protocol/specifications/specification-current/#textDocument_signatureHelp)
* [Document Highlight Provider](https://microsoft.github.io/language-server-protocol/specifications/specification-current/#textDocument_documentHighlight)
* [Code Action Provider](https://microsoft.github.io/language-server-protocol/specifications/specification-current/#textDocument_codeAction)
* [Code Lens Provider](https://microsoft.github.io/language-server-protocol/specifications/specification-current/#textDocument_codeLens)
* [Execute Command Provider](https://microsoft.github.io/language-server-protocol/specifications/specification-current/#workspace_executeCommand)

> Note: The Language Server Protocol is offered as a technology preview and requires to pass the `--experimental-options` option for its activation.

To start the Language Server Protocol, pass the `--lsp` option to the command-line launcher as in the following example with a Node.js application:
  ```shell
  node --experimental-options --lsp app.js
  [Graal LSP] Starting server and listening on localhost/127.0.0.1:8123
  Example app listening on port 3000!
  ```

> Important: GraalVM's Language Server Protocol itself does not provide the static data usually gathered by parsing the application sources (as these data are sometimes fuzzy in the case of dynamic languages). Instead, it was designed to provide the accurate dynamic data gathered from the application runtime.

![Image Language Server Completion](images/lsp-dynamic-completion.png)

However, GraalVM's Language Server Protocol implementation could delegate to the existing language servers written specially for the particular languages (using the `--lsp.Delegates` launcher option) and merge the static data returned from these servers with its own dynamic data to a single result.

This extension works as a client to the Language Server Protocol.
By default, a language server is started as a part of every process being executed or debugged via the VS Code user interface.
The other possibility (available on option) is a language server started as a separated process that gets informed about every application being executed or debugged.
It tries to "dry-run" the same code as the original application and serve the run-time data afterwards.
Currently, both approaches start the language server, providing the smart editing features for the following GraalVM-supported languages - JavaScript, Python, R, Ruby, and [SimpleLanguage](https://github.com/graalvm/simplelanguage).

### Ruby Language Server

This extension provides an option to automatically install and run the [solargraph](https://github.com/castwide/solargraph) which is an implementation of the Language Server Protocol for the Ruby language.
Enabling this option, the GraalVM Ruby installation is checked for the presence of the `solargraph` gem and the user is provided with the option of an automatic installation of the missing gem.

![Image No Ruby Language Server](images/no-ruby-ls.png)

Once the `solargraph` gem is installed, the Ruby Language Server is automatically started and passed to the Language Server Protocol as delegate when necessary.

### R Language Server
