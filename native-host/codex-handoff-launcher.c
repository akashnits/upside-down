#include <fcntl.h>
#include <stdio.h>
#include <unistd.h>

int main(int argc, char **argv) {
    const char *log_path = "/tmp/upside-down-codex-native-worker.log";
    int log_fd = open(log_path, O_WRONLY | O_CREAT | O_APPEND, 0600);
    if (log_fd >= 0) {
        dprintf(log_fd, "HOST_PROCESS_STARTED (native launcher)\n");
        close(log_fd);
    }

    char *node_argv[16];
    node_argv[0] = "/opt/homebrew/bin/node";
    node_argv[1] = "/Users/akash/Documents/personal/projects/upside-down/native-host/codex-handoff-host.js";
    int node_argc = 2;
    for (int i = 1; i < argc && node_argc < 15; i++) {
        node_argv[node_argc++] = argv[i];
    }
    node_argv[node_argc] = NULL;

    execv(node_argv[0], node_argv);
    return 127;
}
