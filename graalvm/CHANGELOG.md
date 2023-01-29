# Change Log

## Version 0.5.24
* Don't set JAVA_HOME to `/usr` on macOS
* Get Java project packages from MS Java Ext Pack
* Removed dependency on Apache NetBeans Language Server for Java
* Register GraalVM as JDK for MS Java Ext Pack

## Version 0.5.23
* Update of 3rd party libraries
* Updated documentation
* VisualVM and Native image agent launcher work with MS Java Ext pack
* Clean up of java8+ launchers  

## Version 0.5.22
* Prevent `403 Forbidden` while trying to verify native-image-maven-plugin
* Improved messages when working with Native Image Plugin
* Update of 3rd party libraries

## Version 0.5.21
* Do not use `'*'` for GraalVM VSCode extension activation
* Debug Adapter Protocol is the default over Chrome Inspector
* GDS URL can be customized via Settings.

## Version 0.5.20
* Update of terser npm to v. 5.14.12 due to CVE-2022-25858 
* Allow for run without debugging for launch configurations with the Debug Adapter protocol specified

## Version 0.5.19
* Special preconfigured terminal for building native image on Windows. GraalVM 22.2.0 and later is required

## Version 0.5.18
* GraalVM settings like `graalvm.home` are Remote SSH aware
* Documentation updates

## Version 0.5.17
* Disable VisualVM integration for Remote SSH development sessions

## Version 0.5.16
* Installs Oracle JDBC driver to NetBeans Language Server
* Native Image control panel added to the Gr view, providing settings for the Native Image Agent in the first version
* GraalVM Insight Heap replay functionality added
* Image pull secret fixed for Kubernetes debugging
* Proxy settings fixes for GDS service

## Version 0.5.15
* Oracle DB JDBC driver installed
* Setting GraalVM as JAVA_HOME improved for terminal,...
* Documentation improvements 
* Option `graalvm.languageServer.start` for switching off the GraalVM Language Server added
* Fixed download of GraalVM binaries
## Version 0.5.14
* Thread dump / Heap dump / CPU sampler commands for the NBLS process to enable quick troubleshooting
* SDKMan support fixes
* README.MD improvements

## Version 0.5.13
* Read GraalVM CE releases using GitHub API

## Version 0.5.12
* Add GraalVM installed by system utility like yum
* Number of stability improvements

## Version 0.5.11
* Guess the GraalVM target directory before download of binary starts

## Version 0.5.10
* Added remote K8s debugger
* Support GraalVM installations without GU, e.g. yum managed
* Other improvements in GraalVM installations handling

## Version 0.5.9
* Integration with VisualVM in GraalVM activity panel. Requires GraalVM 21.2.0 or newer
* Support for running projects with Native Image Agent
* Added dependency on "asf.apache-netbeans-java" extension
* Renamed to "GraalVM Tools for Java"

## Version 0.5.8
* Security: updated dependencies

## Version 0.5.7
* Support for SDKMAN installations

## Version 0.5.6
* MacOS SDKMAN installation path support

## Version 0.5.5
* Various improvements and fixes for GraalVM components management

## Version 0.5.4
* Check writable permission before GraalVM is downloaded
* Fix injectTos and scopeNames
* User has to always accept GraalVM EE license

## Version 0.5.3
* GraalVM EE JDK 11 bits are not offered for download

## Version 0.5.2
* Bug fixes
* Repository moved

## Version 0.5.0
* GraalVM DAP support added
* GraalVM installations management added
* GraalVM EE download supported
* GraalVM for Windows supported

## Version 0.0.10
* Usability improvements

## Version 0.0.9
* Bug fixes

## Version 0.0.8
* Support Python, R, and Ruby languages merged from their separate extensions
* Code coverage support added

## Version 0.0.7
* Security: updated dependencies

## Version 0.0.6
* Documentation enhanced

## Version 0.0.5
* GraalVM LSP support added

## Version 0.0.4
* Published on Visual Studio Marketplace

## Version 0.0.3
* Support for Simple Language polyglot embeddings added
* Basic support for native-image added

## Version 0.0.2
* Basic editor support for Simple Language added
* Lauch configuration for polyglot applications added
* Code snippets for polyglot programming added

## Version 0.0.1
* Initial release
