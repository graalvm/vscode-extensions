
<!-- 1. Short description -->

# GraalVM Tools for Java Extension

Harness the power of GraalVM from right inside VS Code!
<!-- OR: Level up your dev abilities and harness the power of GraalVM from right inside VS Code!-->
The GraalVM Tools for Java extension provides full-fledged support for the Java language, but it also includes the industry-leading power of the GraalVM runtime, full polyglot support and debugging, and lightning fast just-in-time as well as ahead-of-time compilers - all without ever leaving the comfort of VS Code.

<!-- OR, alternate: You want the power of Java and the ease of VS Code? You've written your project in VS Code and now you want to run and debug it? You want to prepare to hit the microservices marketplace like a boss? You've come to the right place. -->

<!-- insert image tbd  -->


The GraalVM Tools for Java extension does the work of several extensions in one. Key features include:
* Full-grown Java development support and debugging
* The GraalVM runtime, enabling you to run your code without leaving VS Code
* The just-in-time Graal compiler, ensuring your code runs fast
* The ahead-of-time GraalVM Native Image compiler, leaving a tiny, binary footprint stored in the cloud, perfect for the heavy lifting associated wtih microservices
* The debugging of native images at run time
* Integration with VisualVM - for even easier and more powerful debugging
* Native support for the Micronaut framework, enabling you to launch your apps from right inside VS Code <!-- is that correct??  -->
* Polyglot programming and debugging for polyglot applications, with support for JavaScript, Node.js, Python, R, and Ruby
* Built-in implementation of Debug Adapter Protocol (DAP)
* Smart editing features like auto complete, go to declaration, documentation on hover, etc

The power of VS Code just got boosted.

Let's get started!

<!-- 2. Extension and GraalVM installations  -->

## Extension Installation

<!-- insert image tbd  -->

To install the GraalVM Tools for Java extension in VS Code:

1. Navigate to Extensions in the left-hand side Activity Bar (or use the _Ctrl+Shift+X_ hot keys combination).
2. Search for "GraalVM" in the search field.
3. Once found, press Install.
4. Reload when required.


## GraalVM Installation Wizard

After installing the extension, you can install GraalVM by using the built-in installation wizard (click the "Gr" icon in the left side Activity Bar).

You can either add existing GraalVM (if you have GraalVM already), or download it immediately from within VS Code. The "Download & Install GraalVM" action is preferable, as it eliminates the fuss around setting up environment variables and prepares the GraalVM runtime in VS Code for you.

Choose either the Community (free for all purposes) or Enterprise distribution (free for evaluation and development). You can also choose from the optional components (JavaScript & Node.js support, LLVM, etc.). <!-- what are these?  -->

For more information about GraalVM installation and setup, check the [extension documentation](README.md#graalvm-installation).

<!-- 3. Get started with Java development and debugging -->

## Java Development and Debugging
<!-- consider adding an image of JAVA -->
The GraalVM Tools for Java extension brings complete support for Java language development and debugging in VS Code, including popular features like auto completion, code navigation, and refactoring, etc.

Any application that runs on a JVM can run on GraalVM unmodified.
GraalVM includes a JDK based on the Java HotSpot VM, and integrates an optimizing, just-in-time (JIT) compiler, written in Java: the [Graal compiler](../../../reference-manual/java/compiler.md).

There are several launch configurations available by default, or you can add more.
Check the [extension documentation](README.md#java-development-and-debugging) to learn more.

<!-- 4.  VisualVM Integration -->

## Integration with VisualVM

GraalVM Tools for Java extension provides integration with [VisualVM](https://visualvm.github.io), which is the all-in-one Java (and polyglot) monitoring and troubleshooting tool.
This brings powerful yet easy-to-use visual Java tooling to VS Code.

A special launch configuration - **Launch VisualVM & Java 8+ Application** - is provided by the GraalVM Tools for Java extension to start VisualVM along with the project.

![VisualVM and VS Code Integration](images/vscode_visualvm.png)

Check the [dedicated guide](visualvm-integration.md) about VisualVM and VS Code integration using the extension.

## Support for the Micronaut Framework
<!-- I only put this here because we have it as a bulletpoint, above... maybe either provide a few sentences here about it, or remove that bulletpoint? I took the below from the GVM Micronaut extension page... as I recall, it has something to do with launching apps? or no? if so, I think it's worth mentioning-->
In combination with the GraalVM Tools for Micronaut extension, you can run Micronaut projects on GraalVM and debug them directly from VS Code with different debugging protocols.


<!-- 5.  Ahead-of-time compilation with GraalVM Native Image -->


## Native Image

<!-- The GraalVM download includes GraalVM Native Image, which allows you to ahead-of-time compile your Java code to a standalone executable - directly in VS Code. Only the code that is required by the application at run time will be compiled and linked into the final native executable. The advantages are many, especially for microservices. -->

With GraalVM Tools for Java extension you can turn your Java projects into native executables directly in VS Code.
Your apps will:
* Be compiled into small footprints, on cloud, using a fraction of customary resources - so they run lightning fast.
* Achieve super fast startup, achieving peak performance with no warmup time
* Enjoy improved security by greatly reducing attack surfaces and thwarting reverse engineering

Learn more about the benefits of Native Image [here](../../../reference-manual/native-image/README.md).

### Tracing Agent <!-- MAYBE this tracing agent part can be omitted in this intro page? -->
GraalVM Tools for Java extension also provides experimental support for the Java [Tracing agent](../../../reference-manual/native-image/Agent.md) to automate the process of tracking and registering dynamic feature calls, making it even easier to build native images in VS Code.

A special launch configuration - **Launch Native Image Agent & Java 8+ Application** - is provided by the GraalVM Tools for Java extension to start a Java project with the Tracing agent.

Check the extension documentation to learn [how to build a native image and apply the Tracing agent from within VS Code](README.md#build-a-native-image).

### Native Image Debugging

The GraalVM Tools for Java extension provides Java-like debugging of native images directly from within [Visual Studio Code](https://code.visualstudio.com/). You can set breakpoints, create watches, inspect the state of your application, even attach the debugger to a native image process in VS Code and step over the application source code!

Read more about this and find a demo application in the [Native Image Debugging guide](../../../reference-manual/native-image/Debugging.md).

![Native Image Debugging in VS Code](images/debugging_ni_vscode.png)


<!-- 6. Popular Languages Support or GraalVM Languages Support or Features -->

## Polyglot Languages Support

<!-- Besides enabling a complete development environment for Java, GraalVM Tools for Java extension also provides full support for a number of popular languages such as
JavaScript, Ruby, R, Python. -->

The GraalVM Tools for Java extension enables a polyglot environment in VS Code, providing necessary editing and debugging features for a number of popular languages such as Python, Ruby, R, JavaScript, and Node.JS.
The extension allows for polyglot programming in a bidirectional way: you can embed JavaScript, Ruby, R, and Python in Java, or call Java from those languages.
<!-- maybe insert image of these languages' logos -->
<!-- A host JVM-based language and a guest language can directly interoperate with each other and pass data back and forth in the same memory space.
 -->
 Check the dedicated guide how to run and debug JavaScript and Node.js, Python, Ruby, and R applications with GraalVM Tools for Java extension in VS Code:
* [JavaScript and Node.js](polyglot-runtime.md#javascript-and-nodejs-support)
* [Python](polyglot-runtime.md#python-support)
* [Ruby](polyglot-runtime.md#ruby-support)
* [R](polyglot-runtime.md#r-support)

Thanks to GraalVM's [built-in implementation of the Language Server Protocol](https://www.graalvm.org/22.0/tools/lsp/), smart editing features are provided for the guest languages like code-completion, find usages, go to declaration, and documentation on hover, etc.

It includes full debugging capabilities for those languages.
<!-- 7.  Popular Languages Debugging and Debug Adapter Protocol -->

## Polyglot Languages Debugging

Thanks to GraalVM's built-in implementation of the [Debug Adapter Protocol (DAP)](https://www.graalvm.org/22.0/tools/dap/), a user can choose a debugging protocol in VS Code by setting to either `chromeDevTools` or `debugAdapter`.
<!-- The debug configurations differ per supported language.
 -->
The advantage of using the Debug Adapter Protocol over Chrome Dev Tools is that (1) it is "native" to VS Code, meaning it does not require any intermediate translatation, and (2) it supports multithreading, which can be particually useful to debug, e.g., a Ruby application.

Check the documentation for more information on [Polyglot Programming and Debugging in VS Code](polyglot-runtime.md).

<!-- 8.  Extension Settings – a bullet list -->
<!-- ## Extension Settings

This extension supports the following settings:

* __graalvm.home__ - the path to the GraalVM installation
* __graalvm.installations__ - all registered GraalVM installations
* __graalvm.systemDetect__ - detect GraalVM's installation from the system environment variables
* __graalvm.languageServer.currentWorkDir__ - an absolute path to the working directory of GraalVM's Language Server Protocol
* __graalvm.languageServer.inProcessServer__ - start GraalVM's Language Server Protocol within processes being run or debugged
* __graalvm.languageServer.delegateServers__ - a comma-separated list of `language@[host:]port` where other language servers run
* __graalvm.languageServer.startRLanguageServer__ - start the R Language Server
* __graalvm.languageServer.startRubyLanguageServer__ - start the Ruby Language Server
 -->
### Provide Feedback or Seek Help

* [Request a feature](https://github.com/graalvm/vscode-extensions/issues/new?labels=enhancement)
* [File a bug](https://github.com/graalvm/vscode-extensions/issues/new?labels=bug)

### Privacy Policy

Read the [Oracle Privacy Policy](https://www.oracle.com/legal/privacy/privacy-policy.html) to learn more.
