import * as vscode from "vscode";


class KubernetesChannel {
    private readonly channel: vscode.OutputChannel = vscode.window.createOutputChannel("Kubernetes");

    public appendLine(value: string) {
        this.channel.appendLine(value);
    }

    public clearAndShow() {
        this.channel.clear();
        this.channel.show();
    }
}

export const kubernetesChannel = new KubernetesChannel();
