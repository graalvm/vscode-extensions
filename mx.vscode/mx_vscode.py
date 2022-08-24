#
# Copyright (c) 2018, 2019, Oracle and/or its affiliates. All rights reserved.
# DO NOT ALTER OR REMOVE COPYRIGHT NOTICES OR THIS FILE HEADER.
#
# The Universal Permissive License (UPL), Version 1.0
#
# Subject to the condition set forth below, permission is hereby granted to any
# person obtaining a copy of this software, associated documentation and/or
# data (collectively the "Software"), free of charge and under any and all
# copyright rights in the Software, and any and all patent rights owned or
# freely licensable by each licensor hereunder covering either (i) the
# unmodified Software as contributed to or provided by such licensor, or (ii)
# the Larger Works (as defined below), to deal in both
#
# (a) the Software, and
#
# (b) any piece of software and/or hardware listed in the lrgrwrks.txt file if
# one is included with the Software each a "Larger Work" to which the Software
# is contributed by such licensors),
#
# without restriction, including without limitation the rights to copy, create
# derivative works of, display, perform, and distribute the Software and make,
# use, sell, offer for sale, import, export, have made, and have sold the
# Software and the Larger Work(s), and to sublicense the foregoing rights on
# either these or other terms.
#
# This license is subject to the following condition:
#
# The above copyright notice and either this complete permission notice or at a
# minimum a reference to the UPL must be included in all copies or substantial
# portions of the Software.
#
# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
# IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
# FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
# AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
# LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
# OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
# SOFTWARE.
#
import mx
import os
import mx_gate
from os.path import join, isfile, exists
from mx_gate import Task

_suite = mx.suite('vscode')

BUILD_NUMBER = mx.get_env("BUILD_NUMBER", None)
JOB_NAME = mx.get_env("JOB_NAME", None)

def _vscode_gate_runner(args, tasks):
    with Task('VSCode UnitTests', tasks, tags=['test']) as t:
        if t: mx.run(['mx', 'build'], nonZeroIsFatal=True)

mx_gate.add_gate_runner(_suite, _vscode_gate_runner)

class VSCodeExtensionProject(mx.ArchivableProject):
    def __init__(self, suite, name, deps, workingSets, theLicense, mxLibs=None, **args):
        mx.ArchivableProject.__init__(self, suite, name, deps, workingSets, theLicense)
        self.dir = join(suite.dir, name)

    def archive_prefix(self):
        return ''

    def output_dir(self):
        return self.dir

    def getResults(self, replaceVar=False):
        results = []
        for root, _, files in os.walk(self.output_dir()):
            for fil in files:
                if fil.endswith(".vsix"):
                    results.append(join(root, fil))
        return results

    def getBuildTask(self, args):
        return VSCodeExtensionBuildTask(self, args)

class VSCodeExtensionBuildTask(mx.ArchivableBuildTask):
    def __init__(self, subject, args):
        mx.ArchivableBuildTask.__init__(self, subject, args, 1)

    def __str__(self):
        return 'Building VS Code Extension for {}'.format(self.subject)

    def newestInput(self):
        inputPaths = []
        for path in [join(self.subject.dir, m) for m in ['', 'images', 'snippets', 'src', 'syntaxes']]:
            if exists(path):
                inputPaths.extend(join(path, f) for f in os.listdir(path) if isfile(join(path, f)))
        return mx.TimeStampFile.newest(inputPaths)

    def needsBuild(self, newestInput):
        out = self.newestOutput()
        if not out or self.newestInput().isNewerThan(out):
            return (True, None)
        return (False, None)

    def build(self):
        vsce = join(_suite.dir, 'node_modules', '.bin', 'vsce')
        if not exists(vsce):
            mx.run(['npm', 'install'], nonZeroIsFatal=True, cwd=_suite.dir)
        mx.run(['npm', 'install'], nonZeroIsFatal=True, cwd=self.subject.dir)
        if JOB_NAME and 'release' not in JOB_NAME: # Append BUILD_NUMBER to non-release Jenkins builds.
            command_output = mx.OutputCapture()
            mx.run(['node', '-pe', 'require(\'./package.json\').version'], nonZeroIsFatal=True, cwd=self.subject.dir, out=command_output)
            mx.run(['npm', 'version', command_output.data.strip() + '-' + BUILD_NUMBER], nonZeroIsFatal=True, cwd=self.subject.dir)
            mx.run([vsce, 'package', '--allow-star-activation', '--baseImagesUrl', 'https://github.com/graalvm/vscode-extensions/raw/master/' + self.subject.name], nonZeroIsFatal=True, cwd=self.subject.dir)
            mx.run(['npm', 'version', command_output.data.strip()], nonZeroIsFatal=True, cwd=self.subject.dir)
        else:
            mx.run([vsce, 'package', '--allow-star-activation', '--baseImagesUrl', 'https://github.com/graalvm/vscode-extensions/raw/master/' + self.subject.name], nonZeroIsFatal=True, cwd=self.subject.dir)

    def clean(self, forBuild=False):
        for fil in self.subject.getResults():
            os.remove(fil)
        for path in [join(self.subject.dir, m) for m in ['dist', 'node_modules']]:
            if exists(path):
                mx.rmtree(path)
