# GraalVM Tools for Java Extension
*** **Technology Preview** ***

Improve your developer productivity by leveraging the [GraalVM Tools for Java](http://www.graalvm.org/tools/vscode/graalvm-extension/) extension in VS Code. The extension enables you to manage GraalVM installations and their components in VS Code and locally. It includes the GraalVM Installation and Configuration Wizard. 

Setting GraalVM as the default Java runtime in VS Code enables both just-in-time ([Graal](http://www.graalvm.org/reference-manual/java/compiler.md)) and ahead-of-time ([Native Image](http://www.graalvm.org/reference-manual/native-image/README.md)) compilers, making VS Code a compelling and convenient GraalVM development environment. Any application that runs on a JVM can run unmodified on GraalVM.

The GraalVM Tools for Java extension performs the work of several extensions in one.
Key features include:
* The GraalVM installations manager
* The just-in-time Graal compiler, ensuring your code runs fast
* The ahead-of-time compiler (provided by GraalVM Native Image) to turn your Java application into a tiny native executable, perfect for deploying to the cloud
* Debugging of Native Image processes at run time
* Integration with VisualVM - for even easier and more powerful debugging
* Native support for the Micronaut framework

> Note: The extension is a Technology Preview.

## Installing the Extension

To install the GraalVM Tools for Java extension in VS Code:

1. Navigate to **Extensions** in the left-hand side Activity Bar (or use the _Ctrl+Shift+X_ shortcut keys combination).
2. Search for "GraalVM" in the search field.
3. Once found, click **Install**.
4. Reload when required.

## GraalVM Installation Wizard

After installing the extension, you can install GraalVM by using the built-in installation wizard (click the **Gr** icon in the left side Activity Bar).

You can either add an existing GraalVM installation (if you already have GraalVM), or download it directly from within VS Code.
The **Download & Install GraalVM** action is recommended as it eliminates the fuss around setting environment variables and prepares the GraalVM runtime in VS Code for you.
Choose either the Community distribution (free for all purposes) or Enterprise distribution (free for evaluation and development). You can also choose to install additional components (such as JavaScript and Node.js support).

![GraalVM Install Dialog](images/graalvm_install_actions.png)

### Proxy Settings
If you are working behind a firewall, set the proxy for the GraalVM Installation Wizard and components installation. The extension will ask for setting this initially. Set:
1. __Http: Proxy:__ to the proxy server and port
2. __Http: Proxy Support: on__ when behind a firewall and __OFF__ when working without the proxy.

For more information about GraalVM's installation and setup, consult the [extension documentation](https://www.graalvm.org/dev/tools/vscode/graalvm-extension/#graalvm-installation-wizard).

## Java Development and Debugging

 [Extension Pack for Java from Microsoft](https://marketplace.visualstudio.com/items?itemName=vscjava.vscode-java-pack) has to be installed to develop Java. 

The [Apache NetBeans Language Server](https://marketplace.visualstudio.com/items?itemName=ASF.apache-netbeans-java) enables Java language support as well. If VS Code detects the Extension Pack for Java from Microsoft installed, it deactivates the Apache NetBeans Language Server.

## Integration with VisualVM

The GraalVM Tools for Java extension provides integration with [VisualVM](https://visualvm.github.io), the all-in-one Java (and polyglot) monitoring and troubleshooting tool.
VisualVM brings powerful, yet easy-to-use, visual Java tooling to VS Code.

![VisualVM and VS Code Integration](images/vscode_visualvm.png)

For more information, see the [dedicated guide](https://www.graalvm.org/dev/tools/vscode/graalvm-extension/visualvm-integration/) about VisualVM and VS Code integration using the extension.

## Support for Micronaut

The GraalVM Tools for Java extension in combination with the [GraalVM Tools for Micronaut](https://marketplace.visualstudio.com/items?itemName=oracle-labs-graalvm.micronaut) extension brings native support for the Micronaut framework in VS Code and opens many more possibilities for Java developers. See the [Micronaut extension documentation](https://www.graalvm.org/dev/tools/vscode/micronaut-extension/) to learn more.

## GraalVM Native Image

With the GraalVM Tools for Java extension you can compile your Java application into a native executable using [GraalVM Native Image](https://www.graalvm.org/reference-manual/native-image/)
directly in VS Code. The advantages are many:
* Your application is compiled into a small executable file, using a fraction of customary resources - so it runs lightning fast.
* Your application achieves fast startup and peak performance with no warmup time.
* Your application has improved security by greatly reducing attack surfaces and thwarting reverse engineering.

Learn how you can do that from the [extension documentation](https://www.graalvm.org/dev/tools/vscode/graalvm-extension/#native-image-building-and-debugging).
## Native Image Debugging

The GraalVM Tools for Java extension provides Java-like debugging of a native executable in a running state directly from within VS Code.
You can set breakpoints, inspect the state of your application, even attach the debugger to a Native Image process in VS Code and step over the Java application source code!

Read more about this and find a demo application in the [Native Image Debugging guide](https://www.graalvm.org/dev/tools/vscode/graalvm-extension/debugging-native-image/).

## Provide Feedback or Seek Help

* [Request a feature](https://github.com/graalvm/vscode-extensions/issues/new?labels=enhancement)
* [File a bug](https://github.com/graalvm/vscode-extensions/issues/new?labels=bug)

## Privacy Policy

Read the [Oracle Privacy Policy](https://www.oracle.com/legal/privacy/privacy-policy.html) to learn more.
