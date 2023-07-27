# GraalVM Tools for Java Extension
*** **Technology Preview** ***

## Features

The extension helps you to manage GraalVM installations and their components by VS Code. It includes the GraalVM Installation and Configuration Wizard. 

Setting GraalVM as the default Java runtime in VS Code enables both just-in-time ([Graal](http://www.graalvm.org/reference-manual/java/compiler.md)) and ahead-of-time ([Native Image](http://www.graalvm.org/reference-manual/native-image/README.md)) compilers.

The GraalVM Tools for Java extension performs the work of several extensions in one.

Key features include:
* The GraalVM installations manager
* The just-in-time Graal compiler, ensuring your code runs fast
* The ahead-of-time compiler (provided by GraalVM Native Image) to turn your Java application into a tiny native executable, perfect for deploying to the cloud
* Debugging of Native Image processes at run time
* Integration with VisualVM - for even easier and more powerful debugging
* Native support for the Micronaut framework

> Note: The extension is a Technology Preview.

## Requirements

<details closed>
<summary>Java Development and Debugging</summary>

[Extension Pack for Java from Microsoft](https://marketplace.visualstudio.com/items?itemName=vscjava.vscode-java-pack) has to be installed to develop Java. 

The [Apache NetBeans Language Server](https://marketplace.visualstudio.com/items?itemName=ASF.apache-netbeans-java) enables Java language support as well. If VS Code detects the Extension Pack for Java from Microsoft installed, it deactivates the Apache NetBeans Language Server.
</details>

<details closed>
<summary>Proxy Settings</summary>
If you are working behind a firewall, set the proxy for the GraalVM Installation Wizard and components installation. The extension will ask for setting this initially. Set:
1. __Http: Proxy:__ to the proxy server and port
2. __Http: Proxy Support: on__ when behind a firewall and __OFF__ when working without the proxy.

For more information about GraalVM's installation and setup, consult the [extension documentation](https://www.graalvm.org/dev/tools/vscode/graalvm-extension/#graalvm-installation-wizard).
</details>

## Usage

<details closed>
<summary>GraalVM Installation Wizard</summary>

After installing the extension, you can install GraalVM by using the built-in installation wizard (click the **Gr** icon in the left side Activity Bar).

You can either add an existing GraalVM installation (if you already have GraalVM), or download it directly from within VS Code.
The **Download & Install GraalVM** action is recommended as it eliminates the fuss around setting environment variables and prepares the GraalVM runtime in VS Code for you.
Choose either the Community distribution (free for all purposes) or Enterprise distribution (free for evaluation and development). You can also choose to install additional components (such as JavaScript and Node.js support).

![GraalVM Install Dialog](images/graalvm_install_actions.png)
</details>

<details closed>
<summary>Integration with VisualVM</summary>

The GraalVM Tools for Java extension provides integration with [VisualVM](https://visualvm.github.io), the all-in-one Java (and polyglot) monitoring and troubleshooting tool.
VisualVM brings powerful, yet easy-to-use, visual Java tooling to VS Code.

![VisualVM and VS Code Integration](images/vscode_visualvm.png)

For more information, see the [dedicated guide](https://www.graalvm.org/dev/tools/vscode/graalvm-extension/visualvm-integration/) about VisualVM and VS Code integration using the extension.
</details>

<details closed>
<summary>Support for Micronaut</summary>

The GraalVM Tools for Java extension in combination with the [GraalVM Tools for Micronaut](https://marketplace.visualstudio.com/items?itemName=oracle-labs-graalvm.micronaut) extension brings native support for the Micronaut framework in VS Code and opens many more possibilities for Java developers. See the [Micronaut extension documentation](https://www.graalvm.org/dev/tools/vscode/micronaut-extension/) to learn more.
</details>

<details closed>
<summary>GraalVM Native Image</summary>

With the GraalVM Tools for Java extension you can compile your Java application into a native executable using [GraalVM Native Image](https://www.graalvm.org/reference-manual/native-image/)
directly in VS Code. The advantages are many:
* Your application is compiled into a small executable file, using a fraction of customary resources - so it runs lightning fast.
* Your application achieves fast startup and peak performance with no warmup time.
* Your application has improved security by greatly reducing attack surfaces and thwarting reverse engineering.

Learn how you can do that from the [extension documentation](https://www.graalvm.org/dev/tools/vscode/graalvm-extension/#native-image-building-and-debugging).
</details>

<details closed>
<summary>Native Image Debugging</summary>

The GraalVM Tools for Java extension provides Java-like debugging of a native executable in a running state directly from within VS Code.
You can set breakpoints, inspect the state of your application, even attach the debugger to a Native Image process in VS Code and step over the Java application source code!

Read more about this and find a demo application in the [Native Image Debugging guide](https://www.graalvm.org/dev/tools/vscode/graalvm-extension/debugging-native-image/).
</details>

## Basic Usage
Do animated screenshots? How to create it here?

## Available Commands
| Name | Description |
|---|---|
| `extension.graalvm.selectGraalVMHome` | Set Active GraalVM Installation |
| `extension.graalvm.installGraalVM` | Download & Install GraalVM |
| `extension.graalvm.addExistingGraalVM` | Add Existing GraalVM |
| `extension.graalvm.refreshInstallations` | Refresh Installations |
| `extension.graalvm.installGraalVMComponent` | Install GraalVM Component |
| `extension.graalvm.uninstallGraalVMComponent` | Uninstall GraalVM Component |
| `extension.graalvm.gds.showConfiguration` | Show GU Configuration |
| `extension.graalvm.addNativeImageToPOM` | Add Maven Native Image Plugin |
| `extension.graalvm.toggleCodeCoverage` | Toggle Code Coverage |
| `extension.graalvm.installRLanguageServer` | Install R Language Server |
| `extension.graalvm.installRubyLanguageServer` | Install Ruby Language Server |
| `extension.graalvm.setupProxy` | Setup Proxy |
| `extension.graalvm.removeInstallation` | Remove GraalVM Installation |
| `extension.graalvm.runVisualVMForPID` | Open Process In VisualVM |
| `extension.graalvm.startVisualVM` | Start VisualVM |
| `extension.graalvm.threadDumpVisualVM` | Take thread dump |
| `extension.graalvm.heapDumpVisualVM` | Take heap dump |
| `extension.graalvm.startCPUSamplerVisualVM` | Start CPU sampling |
| `extension.graalvm.startMemorySamplerVisualVM` | Start memory sampling |
| `extension.graalvm.startJFRRecordingVisualVM` | Start flight recording |
| `extension.graalvm.openWindowsNITerminal` | Open Terminal Preconfigured For Native Image |
| `extension.graalvm.troubleshootNBLSThreadDump` | Thread Dump |
| `extension.graalvm.troubleshootNBLSHeapDump` | Heap Dump |
| `extension.graalvm.troubleshootNBLSCpuSampler` | CPU Sampler |
| `extension.graalvm.heapReplay` | Replay Heap Recording |

## Settings
| Name | Description | Default Value / Possible Values |
|---|---|---|
| `graalvm.home` | Path to the active GraalVM installation. | "" |
| `graalvm.installations` | Paths to GraalVM installations. | [] |
| `graalvm.languageServer.start` | Start GraalVM Language Server. | "**none**", "single", "inProcess" |
| `graalvm.languageServer.currentWorkDir` | Absolute path to the working directory of the GraalVM Language Server. | "" |
| `graalvm.languageServer.delegateServers` | Comma-separated list of "language@[host:]port" where other language servers run. | "" |
| `graalvm.languageServer.startRLanguageServer` | Start R Language Server. | false |
| `graalvm.languageServer.startRubyLanguageServer` | Start Ruby Language Server. | false |
| `graalvm.systemDetect` | Detect system GraalVM installations. | true |
| `graalvm.gu.config` | Path to the custom GU configuration file. | "" |
| `native.buildtools.config.windows` | Optional path to Windows Build Tools Configuration Script | "" |

## Contributing
To submit pull requests to vscode-extensions, you need to sign the Oracle Contributor Agreement.

Project members with write access to the repository will determine and assign an appropriate Assignee for the pull request. The assignee will work with the pull request owner to address any issues and then merge the pull request.

## Provide Feedback or Seek Help
* [Request a feature](https://github.com/graalvm/vscode-extensions/issues/new?labels=enhancement)
* [File a bug](https://github.com/graalvm/vscode-extensions/issues/new?labels=bug)

## Privacy Policy
Read the [Oracle Privacy Policy](https://www.oracle.com/legal/privacy/privacy-policy.html) to learn more.